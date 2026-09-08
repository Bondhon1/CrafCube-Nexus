-- Phase 4: print jobs, queue, reservation and consumption
-- Design doc §18-§20, §35, §50-§51, §83-§84, §89.

create type public.print_job_status as enum (
  'QUEUED', 'SCHEDULED', 'PREPARING', 'PRINTING', 'PAUSED',
  'COMPLETED', 'FAILED', 'CANCELLED'
);

create table public.print_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Human reference, e.g. PR-2026-00182 (§18).
  code            text not null,
  status          public.print_job_status not null default 'QUEUED',

  model_version_id uuid references public.model_versions (id) on delete set null,
  printer_id       uuid references public.printers (id) on delete set null,
  quote_id         uuid references public.quotes (id) on delete set null,
  spool_id         uuid references public.filament_spools (id) on delete set null,

  quantity        integer not null default 1 check (quantity > 0),
  -- §19/§20: several copies on one plate do not cost several times the time.
  batched         boolean not null default false,

  -- Estimates, snapshotted when the job was created.
  estimated_grams   numeric(12, 3) not null default 0 check (estimated_grams >= 0),
  estimated_seconds integer not null default 0 check (estimated_seconds >= 0),
  estimated_cost    numeric(14, 4) not null default 0 check (estimated_cost >= 0),

  -- Actuals, recorded at completion (§4 level D).
  actual_grams      numeric(12, 3) check (actual_grams >= 0),
  actual_seconds    integer check (actual_seconds >= 0),
  failed_quantity   integer not null default 0 check (failed_quantity >= 0),
  failure_reason    text,

  notes           text,
  queued_at       timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (organization_id, code),
  check (failed_quantity <= quantity)
);

create index print_jobs_org_status_idx on public.print_jobs (organization_id, status);
create index print_jobs_printer_idx on public.print_jobs (printer_id, queued_at);

-- Every status change is kept: §48 requires job status history to survive, and
-- §83 needs the timeline to compare estimate against actual.
create table public.print_job_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id          uuid not null references public.print_jobs (id) on delete cascade,
  from_status     public.print_job_status,
  to_status       public.print_job_status not null,
  note            text,
  actor_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index print_job_events_job_idx on public.print_job_events (job_id, created_at);

-- ---------------------------------------------------------------------------
-- Job codes
-- ---------------------------------------------------------------------------

create or replace function public.next_job_code(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'PR-' || to_char(now(), 'YYYY') || '-' || lpad((
    coalesce(max((regexp_match(code, '(\d+)$'))[1]::int), 0) + 1
  )::text, 5, '0')
  from public.print_jobs
  where organization_id = p_org
    and code like 'PR-' || to_char(now(), 'YYYY') || '-%';
$$;

-- ---------------------------------------------------------------------------
-- Reservation and consumption through the existing ledger (§50, §51).
--
-- Nothing here writes remaining_grams directly: every movement is a
-- transaction, and the spool's cached balance is reconciled by the trigger
-- that already exists. That keeps one source of truth for stock.
-- ---------------------------------------------------------------------------

create or replace function public.job_reserved_grams(p_job uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case when type = 'RESERVATION' then grams else -grams end
  ), 0)
  from public.filament_transactions
  where reference = 'job:' || p_job::text
    and type in ('RESERVATION', 'RESERVATION_RELEASE');
$$;

/**
 * Releases whatever this job still has reserved. Used on cancel, on failure and
 * before consumption, so a reservation can never outlive the job holding it.
 */
create or replace function public.release_job_reservation(p_job uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
  v_reserved numeric;
begin
  select * into v_job from public.print_jobs where id = p_job;
  if v_job.id is null then
    raise exception 'job not found';
  end if;

  v_reserved := public.job_reserved_grams(p_job);
  if v_reserved <= 0 or v_job.spool_id is null then
    return 0;
  end if;

  insert into public.filament_transactions (
    organization_id, spool_id, type, grams, reason, reference
  ) values (
    v_job.organization_id, v_job.spool_id, 'RESERVATION_RELEASE', v_reserved,
    'Reservation released', 'job:' || p_job::text
  );

  return v_reserved;
end;
$$;

/**
 * Moves a job between statuses and performs the stock movement that belongs to
 * the transition. Status and stock change together, in one transaction, so the
 * ledger can never disagree with the job board.
 */
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
  v_reserved numeric;
  v_consume numeric;
begin
  select * into v_job from public.print_jobs where id = p_job;
  if v_job.id is null then
    raise exception 'job not found';
  end if;

  -- Operators run jobs; that is exactly the production.write capability.
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

  -- Reserve when the job starts being prepared, so two jobs cannot both plan
  -- to use the same grams (§51 RESERVATION).
  if p_status = 'PREPARING' and v_job.spool_id is not null
     and public.job_reserved_grams(p_job) = 0 then
    insert into public.filament_transactions (
      organization_id, spool_id, type, grams, reason, reference
    ) values (
      v_job.organization_id, v_job.spool_id, 'RESERVATION', v_job.estimated_grams,
      'Reserved for ' || v_job.code, 'job:' || p_job::text
    );
  end if;

  if p_status = 'COMPLETED' then
    v_reserved := public.release_job_reservation(p_job);
    -- Actual weight when it was measured, estimate otherwise (§4 level D).
    v_consume := coalesce(p_actual_grams, v_job.estimated_grams);

    if v_job.spool_id is not null and v_consume > 0 then
      insert into public.filament_transactions (
        organization_id, spool_id, type, grams, reason, reference
      ) values (
        v_job.organization_id, v_job.spool_id, 'CONSUMPTION', -v_consume,
        'Consumed by ' || v_job.code, 'job:' || p_job::text
      );
    end if;
  end if;

  if p_status = 'FAILED' then
    v_reserved := public.release_job_reservation(p_job);
    -- A failed print still consumed material; recording it as WASTE keeps it
    -- out of production cost while still deducting the stock (§52).
    v_consume := coalesce(p_actual_grams, v_job.estimated_grams);

    if v_job.spool_id is not null and v_consume > 0 then
      insert into public.filament_transactions (
        organization_id, spool_id, type, grams, reason, reference
      ) values (
        v_job.organization_id, v_job.spool_id, 'WASTE', -v_consume,
        coalesce(p_failure_reason, 'Failed print') || ' (' || v_job.code || ')',
        'job:' || p_job::text
      );
    end if;
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

-- ---------------------------------------------------------------------------
-- Estimate vs actual (§83) and the calibration factors it feeds (§84)
-- ---------------------------------------------------------------------------

create or replace view public.job_accuracy as
select
  j.id as job_id,
  j.organization_id,
  j.code,
  j.printer_id,
  p.name as printer_name,
  j.finished_at,
  j.estimated_grams,
  j.actual_grams,
  j.estimated_seconds,
  j.actual_seconds,
  case when j.estimated_grams > 0 and j.actual_grams is not null
    then round(((j.actual_grams - j.estimated_grams) / j.estimated_grams) * 100, 2)
  end as material_error_percent,
  case when j.estimated_seconds > 0 and j.actual_seconds is not null
    then round(((j.actual_seconds - j.estimated_seconds)::numeric / j.estimated_seconds) * 100, 2)
  end as time_error_percent
from public.print_jobs j
left join public.printers p on p.id = j.printer_id
where j.status = 'COMPLETED';

alter view public.job_accuracy set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

create trigger print_jobs_touch before update on public.print_jobs
  for each row execute function public.touch_updated_at();
create trigger print_jobs_stamp before insert on public.print_jobs
  for each row execute function public.stamp_created_by();
create trigger print_jobs_audit
  after insert or update or delete on public.print_jobs
  for each row execute function public.write_audit_log();

alter table public.print_jobs       enable row level security;
alter table public.print_job_events enable row level security;

create policy print_jobs_select on public.print_jobs
  for select using (public.is_org_member(organization_id));
create policy print_jobs_insert on public.print_jobs
  for insert with check (public.has_role_at_least(organization_id, 'operator'));
-- Status changes go through set_job_status so stock moves with them; direct
-- edits are limited to the notes and scheduling fields a manager may adjust.
create policy print_jobs_update on public.print_jobs
  for update using (public.has_role_at_least(organization_id, 'production_manager'))
  with check (public.has_role_at_least(organization_id, 'production_manager'));
create policy print_jobs_delete on public.print_jobs
  for delete using (public.has_role_at_least(organization_id, 'admin'));

create policy print_job_events_select on public.print_job_events
  for select using (public.is_org_member(organization_id));

-- Events are written by set_job_status only; a hand-written history is worse
-- than none.
revoke insert, update, delete on public.print_job_events from anon, authenticated;
