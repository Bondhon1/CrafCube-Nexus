-- Stored slices, automatic waste, one-off custom builds, and a way for
-- flexi-name-studio to record its builds in this database.
--
-- 1. slice_results: a slice is done once and kept. Rows are keyed by the
--    file's content hash plus the settings that change the answer, so the
--    same file sliced for the same printer is never sliced again unless
--    someone asks for it. Keying by content rather than by model means a
--    one-off build whose file was never stored can still have its numbers.
--
-- 2. custom_builds: designs made for one customer — a name keychain — where
--    keeping the model file is pointless. Only its description and its slice
--    are stored.
--
-- 3. Waste reaches the ledger. The engine now measures support, skirt/brim
--    and the prime line from the G-code and computes colour-change purge from
--    the slicer's flush table. A completed job records the product as
--    CONSUMPTION and each kind of waste as WASTE, so stock drops by what the
--    printer really used and waste analytics can say where it went.
--
-- 4. integration_keys + ingest_custom_build(): how the studio writes in. It
--    gets a scoped, revocable key that can do exactly one thing, rather than
--    a user password or the service-role key sitting on a public host.

-- ---------------------------------------------------------------------------
-- Stored slices
-- ---------------------------------------------------------------------------

create table public.slice_results (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  file_sha256      text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  -- Everything that changes the result: printer, nozzle, layer height,
  -- infill, material. Built by the app, e.g. "Anycubic|Kobra X|0.4|0.2|15|PLA".
  settings_key     text not null check (length(settings_key) between 1 and 300),
  settings         jsonb not null default '{}'::jsonb,
  file_name        text,
  slicer_name      text,
  engine_version   text,

  product_grams    numeric(12, 3) not null check (product_grams >= 0),
  waste_grams      numeric(12, 3) not null default 0 check (waste_grams >= 0),
  total_grams      numeric(12, 3) not null check (total_grams >= 0),
  print_seconds    integer not null default 0 check (print_seconds >= 0),
  layer_count      integer,
  plate_count      integer,
  part_count       integer,
  tool_changes     integer not null default 0,
  -- {support_g, skirt_brim_g, prime_line_g, purge_g, total_g, purge_basis}
  waste            jsonb not null default '{}'::jsonb,
  -- One entry per filament: {tool, product_g, purge_g, ..., waste_g, total_g}
  per_tool         jsonb not null default '[]'::jsonb,
  confidence       public.confidence_level not null,
  confidence_reason text,
  warnings         jsonb not null default '[]'::jsonb,

  sliced_by        uuid references auth.users (id) on delete set null,
  sliced_at        timestamptz not null default now(),
  unique (organization_id, file_sha256, settings_key),
  check (abs(total_grams - product_grams - waste_grams) < 0.01)
);

create index slice_results_file_idx on public.slice_results (organization_id, file_sha256);

-- ---------------------------------------------------------------------------
-- One-off custom builds
-- ---------------------------------------------------------------------------

create table public.custom_builds (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source          text not null default 'manual'
                    check (source in ('manual', 'flexi-name-studio')),
  -- The sender's own identifier, so re-sending the same build updates it
  -- instead of creating a duplicate.
  external_id     text check (external_id is null or length(external_id) <= 200),
  title           text not null check (length(btrim(title)) between 1 and 200),
  file_name       text check (file_name is null or length(file_name) <= 260),
  -- The model is never stored; its hash is what matches a dropped file, and
  -- what a stored slice is looked up by.
  file_sha256     text check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  -- [{name, hex}] in filament order.
  colours         jsonb not null default '[]'::jsonb,
  -- Whatever the sender describes the build with (text, scale, size, ...).
  params          jsonb not null default '{}'::jsonb,
  status          text not null default 'new'
                    check (status in ('new', 'queued', 'printed', 'archived')),
  notes           text,
  order_id        uuid references public.orders (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, source, external_id)
);

create index custom_builds_org_created_idx on public.custom_builds (organization_id, created_at desc);
create index custom_builds_file_idx on public.custom_builds (organization_id, file_sha256);

create trigger custom_builds_touch before update on public.custom_builds
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Jobs carry their slice, their build, and their waste
-- ---------------------------------------------------------------------------

alter table public.print_jobs
  add column custom_build_id uuid references public.custom_builds (id) on delete set null,
  add column slice_result_id uuid references public.slice_results (id) on delete set null,
  -- Waste inside estimated_grams. estimated_grams - this is what the part
  -- itself should weigh, which is what an operator's scale measures.
  add column estimated_waste_grams numeric(12, 3) not null default 0
    check (estimated_waste_grams >= 0);

alter table public.print_job_materials
  -- Per spool, per kind: {support_g, skirt_brim_g, prime_line_g, purge_g}.
  -- Included in estimated_grams.
  add column estimated_waste jsonb not null default '{}'::jsonb;

create or replace function public.material_waste_total(p_waste jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce((p_waste ->> 'support_g')::numeric, 0)
       + coalesce((p_waste ->> 'skirt_brim_g')::numeric, 0)
       + coalesce((p_waste ->> 'prime_line_g')::numeric, 0)
       + coalesce((p_waste ->> 'purge_g')::numeric, 0);
$$;

-- The job's headline figures stay equal to the sum of its materials.
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
      ), 0),
      estimated_waste_grams = coalesce((
        select sum(least(public.material_waste_total(estimated_waste), estimated_grams))
        from public.print_job_materials where job_id = v_job
      ), 0)
  where id = v_job;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- The ledger knows which kind of waste
-- ---------------------------------------------------------------------------

alter table public.filament_transactions
  add column waste_kind text
    check (waste_kind is null or waste_kind in
           ('failure', 'support', 'skirt_brim', 'prime_line', 'purge'));

-- Before this, WASTE only ever meant a failed print.
update public.filament_transactions
set waste_kind = 'failure'
where type = 'WASTE' and waste_kind is null;

-- ---------------------------------------------------------------------------
-- Completing a job splits product from waste
-- ---------------------------------------------------------------------------

-- Reissued from 20260910000300 with the completion step changed.
--
-- The weight an operator enters is the finished part, and purge never ends up
-- in the part — it is pushed out of the nozzle — so the scale can only correct
-- the product. The product is scaled to the measured weight; each waste kind is
-- recorded at the slice's figure, because nothing weighs it. Scaling purge by
-- the part's weight would have no physical basis, and comparing the part with
-- an estimate that includes purge would make every multi-colour job look
-- badly over-estimated.
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
  v_product_est_total numeric;
  v_scale numeric;
  v_product numeric;
  v_waste numeric;
  v_kind text;
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
      if not exists (
        select 1 from public.filament_transactions
        where reference = 'job:' || p_job::text
          and spool_id = v_row.spool_id
          and type = 'RESERVATION'
      ) then
        -- Reserves product and waste alike: the purge leaves the same spool.
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

    select coalesce(sum(greatest(m.estimated_grams
                                 - public.material_waste_total(m.estimated_waste), 0)), 0)
    into v_product_est_total
    from public.print_job_materials m where m.job_id = p_job;

    -- One measured weight is spread across spools in the proportions the
    -- slice predicted: an operator weighs the part, not each colour.
    v_scale := case
      when p_actual_grams is not null and v_product_est_total > 0
        then p_actual_grams / v_product_est_total
      else 1
    end;

    for v_row in
      select m.id, m.spool_id, m.estimated_grams, m.estimated_waste
      from public.print_job_materials m
      where m.job_id = p_job and m.estimated_grams > 0
    loop
      v_product := round(greatest(v_row.estimated_grams
                                  - public.material_waste_total(v_row.estimated_waste), 0)
                         * v_scale, 3);

      if v_product > 0 then
        insert into public.filament_transactions (
          organization_id, spool_id, type, grams, reason, reference, waste_kind
        ) values (
          v_job.organization_id, v_row.spool_id,
          -- A failed print used the material but must not enter production
          -- cost, so its product share is waste too (§25, §52).
          case when p_status = 'COMPLETED' then 'CONSUMPTION' else 'WASTE' end,
          -v_product,
          case when p_status = 'COMPLETED'
            then 'Consumed by ' || v_job.code
            else coalesce(p_failure_reason, 'Failed print') || ' (' || v_job.code || ')'
          end,
          'job:' || p_job::text,
          case when p_status = 'COMPLETED' then null else 'failure' end
        );
      end if;

      -- Purge, support, brim and priming happened whether the print
      -- succeeded or not, so they are recorded as themselves either way.
      foreach v_kind in array array['purge', 'support', 'skirt_brim', 'prime_line'] loop
        v_waste := round(coalesce((v_row.estimated_waste ->> (v_kind || '_g'))::numeric, 0), 3);
        if v_waste > 0 then
          insert into public.filament_transactions (
            organization_id, spool_id, type, grams, reason, reference, waste_kind
          ) values (
            v_job.organization_id, v_row.spool_id, 'WASTE', -v_waste,
            initcap(replace(v_kind, '_', ' / ')) || ' for ' || v_job.code,
            'job:' || p_job::text, v_kind
          );
        end if;
      end loop;

      update public.print_job_materials
      set actual_grams = v_product + public.material_waste_total(v_row.estimated_waste)
      where id = v_row.id;
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

  if v_job.custom_build_id is not null and p_status = 'COMPLETED' then
    update public.custom_builds set status = 'printed'
    where id = v_job.custom_build_id and status <> 'archived';
  end if;

  insert into public.print_job_events (organization_id, job_id, from_status, to_status, note, actor_id)
  values (v_job.organization_id, p_job, v_from, p_status, p_note, auth.uid());

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accuracy compares like with like
-- ---------------------------------------------------------------------------

-- The actual weight is the part. So is estimated_grams - estimated_waste_grams.
create or replace view public.job_accuracy as
select
  j.id as job_id,
  j.organization_id,
  j.code,
  j.printer_id,
  p.name as printer_name,
  j.finished_at,
  -- Cast back: a view column cannot change type on replace.
  (j.estimated_grams - j.estimated_waste_grams)::numeric(12, 3) as estimated_grams,
  j.actual_grams,
  j.estimated_seconds,
  j.actual_seconds,
  case when j.estimated_grams - j.estimated_waste_grams > 0 and j.actual_grams is not null
    then round(((j.actual_grams - (j.estimated_grams - j.estimated_waste_grams))
                / (j.estimated_grams - j.estimated_waste_grams)) * 100, 2)
  end as material_error_percent,
  case when j.estimated_seconds > 0 and j.actual_seconds is not null
    then round(((j.actual_seconds - j.estimated_seconds)::numeric / j.estimated_seconds) * 100, 2)
  end as time_error_percent
from public.print_jobs j
left join public.printers p on p.id = j.printer_id
where j.status = 'COMPLETED';

alter view public.job_accuracy set (security_invoker = on);

create or replace view public.calibration_samples as
select
  j.organization_id,
  j.printer_id,
  pr.name as printer_name,
  mat.id as material_id,
  mat.name as material_name,
  count(*) as samples,
  round(avg(100.0 * (j.actual_grams - (j.estimated_grams - j.estimated_waste_grams))
        / nullif(j.estimated_grams - j.estimated_waste_grams, 0))::numeric, 2)
    as material_error_percent,
  round(avg(100.0 * (j.actual_seconds - j.estimated_seconds)
        / nullif(j.estimated_seconds, 0))::numeric, 2) as time_error_percent
from public.print_jobs j
join public.printers pr on pr.id = j.printer_id
left join public.filament_spools sp on sp.id = j.spool_id
left join public.filament_products fp on fp.id = sp.product_id
left join public.materials mat on mat.id = fp.material_id
where j.status = 'COMPLETED'
  and j.actual_grams is not null
  and j.estimated_grams - j.estimated_waste_grams > 0
group by j.organization_id, j.printer_id, pr.name, mat.id, mat.name;

alter view public.calibration_samples set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Waste analytics by kind (§53)
-- ---------------------------------------------------------------------------

drop view if exists public.waste_analytics;
create view public.waste_analytics as
select
  t.organization_id,
  date_trunc('month', t.created_at)::date as month,
  coalesce(sum(-t.grams) filter (where t.type = 'CONSUMPTION'), 0) as product_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE'), 0) as waste_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE' and t.waste_kind = 'purge'), 0)
    as purge_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE' and t.waste_kind = 'support'), 0)
    as support_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE' and t.waste_kind = 'skirt_brim'), 0)
    as skirt_brim_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE' and t.waste_kind = 'prime_line'), 0)
    as prime_line_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE'
                                   and coalesce(t.waste_kind, 'failure') = 'failure'), 0)
    as failure_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'SAMPLE'), 0) as sample_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'DRYING_LOSS'), 0) as drying_grams,
  coalesce(sum(-t.grams), 0) as total_grams,
  coalesce(sum(t.value)
    filter (where t.type in ('WASTE', 'SAMPLE', 'DRYING_LOSS')), 0) as waste_value
from public.filament_transactions t
where t.type in ('CONSUMPTION', 'WASTE', 'SAMPLE', 'DRYING_LOSS')
group by t.organization_id, date_trunc('month', t.created_at);

alter view public.waste_analytics set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Integration keys and the studio's way in
-- ---------------------------------------------------------------------------

create table public.integration_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  -- The first characters, shown so a key can be recognised; never enough to use.
  key_prefix      text not null,
  -- Only the hash is kept. A leaked database row is not a working key.
  key_hash        text not null unique,
  scopes          text[] not null default array['custom_builds:create'],
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

create or replace function public.create_integration_key(p_org uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if not public.has_role_at_least(p_org, 'admin') then
    raise exception 'only an admin can create integration keys';
  end if;
  v_key := 'nxs_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.integration_keys (organization_id, name, key_prefix, key_hash, created_by)
  values (p_org, btrim(p_name), left(v_key, 12),
          encode(extensions.digest(v_key, 'sha256'), 'hex'), auth.uid());
  -- The only time the key is ever visible.
  return v_key;
end;
$$;

create or replace function public.revoke_integration_key(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.integration_keys where id = p_id;
  if v_org is null or not public.has_role_at_least(v_org, 'admin') then
    raise exception 'integration key not found';
  end if;
  update public.integration_keys set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end;
$$;

/**
 * Record a build from an external tool, authenticated by an integration key.
 *
 * Callable with only the public anon key, so everything is checked here:
 * the key must exist, be unrevoked and carry the scope; the payload is size-
 * and shape-checked; and a re-send of the same external id updates the build
 * instead of duplicating it. Errors say nothing about why a key was refused.
 */
create or replace function public.ingest_custom_build(p_key text, p_build jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key public.integration_keys;
  v_id uuid;
  v_title text;
  v_sha text;
  v_colours jsonb;
begin
  if p_key is null or length(p_key) > 200 then
    raise exception 'invalid integration key' using errcode = '28000';
  end if;
  select * into v_key from public.integration_keys
  where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
    and revoked_at is null
    and 'custom_builds:create' = any(scopes);
  if v_key.id is null then
    raise exception 'invalid integration key' using errcode = '28000';
  end if;

  if p_build is null or jsonb_typeof(p_build) <> 'object' then
    raise exception 'build must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(p_build::text) > 65536 then
    raise exception 'build is too large' using errcode = '22023';
  end if;

  v_title := btrim(coalesce(p_build ->> 'title', ''));
  if v_title = '' or length(v_title) > 200 then
    raise exception 'build needs a title of 1-200 characters' using errcode = '22023';
  end if;
  v_sha := lower(nullif(p_build ->> 'file_sha256', ''));
  if v_sha is not null and v_sha !~ '^[a-f0-9]{64}$' then
    raise exception 'file_sha256 must be 64 hex characters' using errcode = '22023';
  end if;
  v_colours := coalesce(p_build -> 'colours', '[]'::jsonb);
  if jsonb_typeof(v_colours) <> 'array' or jsonb_array_length(v_colours) > 16 then
    raise exception 'colours must be an array of at most 16' using errcode = '22023';
  end if;

  insert into public.custom_builds (
    organization_id, source, external_id, title, file_name, file_sha256, colours, params
  ) values (
    v_key.organization_id, 'flexi-name-studio',
    left(nullif(p_build ->> 'external_id', ''), 200),
    v_title,
    left(nullif(p_build ->> 'file_name', ''), 260),
    v_sha, v_colours,
    coalesce(p_build -> 'params', '{}'::jsonb)
  )
  on conflict (organization_id, source, external_id) do update
    set title = excluded.title,
        file_name = excluded.file_name,
        file_sha256 = excluded.file_sha256,
        colours = excluded.colours,
        params = excluded.params
  returning id into v_id;

  update public.integration_keys set last_used_at = now() where id = v_key.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.slice_results    enable row level security;
alter table public.custom_builds    enable row level security;
alter table public.integration_keys enable row level security;

create policy slice_results_select on public.slice_results
  for select using (public.is_org_member(organization_id));
-- Anyone who prices or schedules work slices: sales and up.
create policy slice_results_insert on public.slice_results
  for insert with check (public.has_role_at_least(organization_id, 'sales'));
create policy slice_results_update on public.slice_results
  for update using (public.has_role_at_least(organization_id, 'sales'))
  with check (public.has_role_at_least(organization_id, 'sales'));
create policy slice_results_delete on public.slice_results
  for delete using (public.has_role_at_least(organization_id, 'admin'));

create policy custom_builds_select on public.custom_builds
  for select using (public.is_org_member(organization_id));
create policy custom_builds_write on public.custom_builds
  for all using (public.has_role_at_least(organization_id, 'sales'))
  with check (public.has_role_at_least(organization_id, 'sales'));

-- Keys are visible to admins, and changed only through the functions above.
create policy integration_keys_select on public.integration_keys
  for select using (public.has_role_at_least(organization_id, 'admin'));
revoke insert, update, delete on public.integration_keys from anon, authenticated;

-- Of the three functions, only ingest is meant for callers without a session.
revoke execute on function public.create_integration_key(uuid, text) from anon;
revoke execute on function public.revoke_integration_key(uuid) from anon;
grant execute on function public.ingest_custom_build(text, jsonb) to anon, authenticated;

create trigger custom_builds_audit
  after insert or update or delete on public.custom_builds
  for each row execute function public.write_audit_log();
create trigger integration_keys_audit
  after insert or update or delete on public.integration_keys
  for each row execute function public.write_audit_log();

notify pgrst, 'reload schema';
