-- A job must have material assigned before it can reserve any.
--
-- PR-2026-00001 ran the full lifecycle — Preparing, Printing, Completed with
-- 10.1 g recorded — and moved nothing in the ledger. It had no
-- print_job_materials rows at all, because the new-job form lets you queue a
-- job without picking a spool for a colour. Both loops in set_job_status then
-- iterate over an empty set and quietly do nothing, while the final UPDATE
-- still writes actual_grams. The job claims 10.1 g; stock says otherwise.
--
-- That is exactly the drift §50 exists to prevent, so the rule belongs in the
-- database rather than only in the form that happened to cause it.
--
-- The gate is PREPARING alone. It is the reservation point (§89), and the
-- state machine makes it the only door to PRINTING, so nothing can reach a
-- stock-moving transition without passing here. Guarding COMPLETED too would
-- strand any job already mid-print with no way to close it.

create or replace function public.assert_job_has_materials(p_job uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if exists (
    select 1 from public.print_job_materials
    where job_id = p_job and estimated_grams > 0
  ) then
    return;
  end if;

  select code into v_code from public.print_jobs where id = p_job;
  raise exception
    'job % has no filament assigned, so preparing it would reserve nothing. '
    'Assign a spool and estimated weight to each colour first.', coalesce(v_code, p_job::text)
    using errcode = 'check_violation';
end;
$$;

-- Reissued verbatim from 20260908001000 apart from the assertion below.
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
    -- Nothing to reserve means the job cannot be accounted for at all.
    perform public.assert_job_has_materials(p_job);

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

notify pgrst, 'reload schema';
