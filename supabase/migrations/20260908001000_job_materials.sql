-- Multi-material print jobs.
--
-- A job carried a single spool_id, which cannot express what the Kobra X
-- actually does: four colours natively, expandable to nineteen (§2). §18's own
-- example job lists two filaments, and §49 names a print_job_materials table.
--
-- The slicer already reports extrusion per tool, so a multi-colour slice can
-- fill these rows automatically rather than being typed in.

create table public.print_job_materials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id          uuid not null references public.print_jobs (id) on delete cascade,
  spool_id        uuid not null references public.filament_spools (id) on delete restrict,
  -- Extruder/tool index the slicer assigned this material to.
  tool_index      smallint not null default 0 check (tool_index >= 0 and tool_index < 64),
  estimated_grams numeric(12, 3) not null default 0 check (estimated_grams >= 0),
  actual_grams    numeric(12, 3) check (actual_grams >= 0),
  created_at      timestamptz not null default now(),
  unique (job_id, tool_index)
);

create index print_job_materials_job_idx on public.print_job_materials (job_id);
create index print_job_materials_spool_idx on public.print_job_materials (spool_id);

alter table public.print_job_materials enable row level security;

create policy print_job_materials_select on public.print_job_materials
  for select using (public.is_org_member(organization_id));
create policy print_job_materials_write on public.print_job_materials
  for all using (public.has_role_at_least(organization_id, 'operator'))
  with check (public.has_role_at_least(organization_id, 'operator'));

-- Existing single-spool jobs become one material row, so the functions below
-- have a single code path rather than two.
insert into public.print_job_materials (organization_id, job_id, spool_id, tool_index, estimated_grams)
select organization_id, id, spool_id, 0, estimated_grams
from public.print_jobs
where spool_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Stock movement, per material
-- ---------------------------------------------------------------------------

create or replace function public.release_job_reservation(p_job uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
  v_total numeric := 0;
  v_row record;
begin
  select * into v_job from public.print_jobs where id = p_job;
  if v_job.id is null then
    raise exception 'job not found';
  end if;

  -- Reservations are released per spool, since a multi-colour job holds
  -- material on several spools at once.
  for v_row in
    select m.spool_id,
           coalesce(sum(case when t.type = 'RESERVATION' then t.grams else -t.grams end), 0) as reserved
    from public.print_job_materials m
    left join public.filament_transactions t
      on t.spool_id = m.spool_id
     and t.reference = 'job:' || p_job::text
     and t.type in ('RESERVATION', 'RESERVATION_RELEASE')
    where m.job_id = p_job
    group by m.spool_id
  loop
    if v_row.reserved > 0 then
      insert into public.filament_transactions (
        organization_id, spool_id, type, grams, reason, reference
      ) values (
        v_job.organization_id, v_row.spool_id, 'RESERVATION_RELEASE', v_row.reserved,
        'Reservation released', 'job:' || p_job::text
      );
      v_total := v_total + v_row.reserved;
    end if;
  end loop;

  return v_total;
end;
$$;

create or replace function public.set_job_status(
  p_job uuid,
  p_status public.print_job_status,
  p_note text default null,
  p_actual_grams numeric default null,
  p_actual_seconds integer default null,
  p_failed_quantity integer default null,
  p_failure_reason text default null
)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
  v_from public.print_job_status;
  v_row record;
  v_estimated_total numeric;
  v_scale numeric;
  v_grams numeric;
  v_type public.inventory_txn_type;
begin
  select * into v_job from public.print_jobs where id = p_job;
  if v_job.id is null then
    raise exception 'job not found';
  end if;

  if not public.has_role_at_least(v_job.organization_id, 'operator') then
    raise exception 'insufficient permissions to change job status';
  end if;

  v_from := v_job.status;
  if v_from = p_status then
    return v_job;
  end if;

  if v_from in ('COMPLETED', 'FAILED', 'CANCELLED') then
    raise exception 'job % is already %', v_job.code, v_from;
  end if;

  if p_status = 'PREPARING' then
    for v_row in
      select m.spool_id, m.estimated_grams
      from public.print_job_materials m
      where m.job_id = p_job and m.estimated_grams > 0
    loop
      -- Skip anything already reserved so a repeated transition is harmless.
      if not exists (
        select 1 from public.filament_transactions
        where reference = 'job:' || p_job::text
          and spool_id = v_row.spool_id
          and type = 'RESERVATION'
      ) then
        insert into public.filament_transactions (
          organization_id, spool_id, type, grams, reason, reference
        ) values (
          v_job.organization_id, v_row.spool_id, 'RESERVATION', v_row.estimated_grams,
          'Reserved for ' || v_job.code, 'job:' || p_job::text
        );
      end if;
    end loop;
  end if;

  if p_status in ('COMPLETED', 'FAILED') then
    perform public.release_job_reservation(p_job);

    -- A failed print used material but must not enter production cost, so it
    -- is deducted as waste instead of consumption (§25, §52).
    v_type := case when p_status = 'COMPLETED' then 'CONSUMPTION' else 'WASTE' end;

    select coalesce(sum(estimated_grams), 0) into v_estimated_total
    from public.print_job_materials where job_id = p_job;

    -- One measured total is spread across materials in the proportions the
    -- estimate predicted: an operator weighs the finished part, not each colour.
    v_scale := case
      when p_actual_grams is not null and v_estimated_total > 0
        then p_actual_grams / v_estimated_total
      else 1
    end;

    for v_row in
      select m.id, m.spool_id, m.estimated_grams
      from public.print_job_materials m
      where m.job_id = p_job and m.estimated_grams > 0
    loop
      v_grams := round(v_row.estimated_grams * v_scale, 3);
      if v_grams > 0 then
        insert into public.filament_transactions (
          organization_id, spool_id, type, grams, reason, reference
        ) values (
          v_job.organization_id, v_row.spool_id, v_type, -v_grams,
          case when p_status = 'COMPLETED'
            then 'Consumed by ' || v_job.code
            else coalesce(p_failure_reason, 'Failed print') || ' (' || v_job.code || ')'
          end,
          'job:' || p_job::text
        );
        update public.print_job_materials set actual_grams = v_grams where id = v_row.id;
      end if;
    end loop;
  end if;

  if p_status = 'CANCELLED' then
    perform public.release_job_reservation(p_job);
  end if;

  update public.print_jobs
  set status = p_status,
      started_at = case
        when p_status = 'PRINTING' and started_at is null then now() else started_at end,
      finished_at = case
        when p_status in ('COMPLETED', 'FAILED', 'CANCELLED') then now() else finished_at end,
      actual_grams = coalesce(p_actual_grams, actual_grams),
      actual_seconds = coalesce(p_actual_seconds, actual_seconds),
      failed_quantity = coalesce(p_failed_quantity, failed_quantity),
      failure_reason = coalesce(p_failure_reason, failure_reason)
  where id = p_job
  returning * into v_job;

  insert into public.print_job_events (organization_id, job_id, from_status, to_status, note, actor_id)
  values (v_job.organization_id, p_job, v_from, p_status, p_note, auth.uid());

  return v_job;
end;
$$;

-- Keeps the job's headline estimate equal to the sum of its materials, so the
-- two can never drift apart.
create or replace function public.sync_job_estimated_grams()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid := coalesce(new.job_id, old.job_id);
begin
  update public.print_jobs
  set estimated_grams = coalesce((
    select sum(estimated_grams) from public.print_job_materials where job_id = v_job
  ), 0)
  where id = v_job;
  return coalesce(new, old);
end;
$$;

create trigger print_job_materials_sync
  after insert or update or delete on public.print_job_materials
  for each row execute function public.sync_job_estimated_grams();
