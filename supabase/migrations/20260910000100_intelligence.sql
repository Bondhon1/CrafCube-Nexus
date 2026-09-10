-- Phase 6: intelligence — analytics, calibration and forecasting.
-- Design doc §11-§12, §32-§34, §53-§55, §66, §69-§72, §83-§84, §91.
--
-- §85 is the governing constraint here: no ML, no autonomous pricing, no
-- automatic anything. Everything below is arithmetic over the clean data the
-- first five phases established, and every figure is advisory. Where the data
-- is too thin to say something true, these views return null rather than a
-- confident-looking zero.

-- ---------------------------------------------------------------------------
-- Reorder inputs (§12)
-- ---------------------------------------------------------------------------

-- §11 already gave products warn/critical thresholds. §12 says a threshold on
-- its own is not a recommendation: how much to order depends on how fast the
-- material goes and how long the supplier takes to deliver.
alter table public.filament_products
  add column if not exists lead_time_days   smallint
    check (lead_time_days is null or lead_time_days between 0 and 365),
  add column if not exists safety_stock_g   numeric(12, 3)
    check (safety_stock_g is null or safety_stock_g >= 0),
  add column if not exists reorder_qty_g    numeric(12, 3)
    check (reorder_qty_g is null or reorder_qty_g > 0);

-- ---------------------------------------------------------------------------
-- Maintenance (§54)
-- ---------------------------------------------------------------------------

create type public.maintenance_kind as enum (
  'routine', 'repair', 'upgrade', 'calibration', 'cleaning', 'part_replacement'
);

create table public.maintenance_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  printer_id      uuid not null references public.printers (id) on delete cascade,
  kind            public.maintenance_kind not null default 'routine',
  performed_on    date not null default current_date,
  -- Downtime is why maintenance belongs in analytics rather than in a notes
  -- field: §70 cannot compute utilisation without knowing when a machine was
  -- unavailable.
  downtime_hours  numeric(8, 2) not null default 0 check (downtime_hours >= 0),
  cost            numeric(14, 4) not null default 0 check (cost >= 0),
  description     text,
  next_due_on     date,
  performed_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index maintenance_printer_idx
  on public.maintenance_records (printer_id, performed_on desc);
create index maintenance_org_idx
  on public.maintenance_records (organization_id, performed_on desc);

-- ---------------------------------------------------------------------------
-- Consumables (§55)
-- ---------------------------------------------------------------------------

create table public.consumables (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  unit            text not null default 'pcs',
  on_hand         numeric(14, 3) not null default 0,
  reorder_point   numeric(14, 3) check (reorder_point >= 0),
  unit_cost       numeric(14, 4) not null default 0 check (unit_cost >= 0),
  supplier        text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- Consumables move through a ledger for the same reason filament does (§50):
-- a stock number nobody can explain is a stock number nobody trusts.
create table public.consumable_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  consumable_id   uuid not null references public.consumables (id) on delete cascade,
  -- Signed: positive restocks, negative uses up.
  quantity        numeric(14, 3) not null check (quantity <> 0),
  unit_cost       numeric(14, 4),
  reason          text,
  actor_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index consumable_txn_idx
  on public.consumable_transactions (consumable_id, created_at desc);

create or replace function public.reconcile_consumable()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid := coalesce(new.consumable_id, old.consumable_id);
begin
  update public.consumables c
  set on_hand = coalesce((
        select sum(quantity) from public.consumable_transactions
        where consumable_id = target
      ), 0)
  where c.id = target;
  return coalesce(new, old);
end;
$fn$;

create trigger consumable_txn_reconcile
  after insert or update or delete on public.consumable_transactions
  for each row execute function public.reconcile_consumable();

-- ---------------------------------------------------------------------------
-- Printer analytics (§32, §70, §72)
-- ---------------------------------------------------------------------------

/**
 * Per-printer production, cost and return.
 *
 * Revenue is deliberately absent. A print job is not attached to an order line
 * in every workflow, and inventing an allocation would produce a per-machine
 * revenue figure nobody could reconcile against the P&L. What a machine
 * demonstrably produces is hours, output and failures; profit attribution
 * lives with the order, where the money actually is.
 */
create or replace view public.printer_analytics as
select
  p.id as printer_id,
  p.organization_id,
  p.name,
  p.status,
  p.purchase_cost,
  p.purchased_at,
  count(j.id) filter (where j.status in ('COMPLETED', 'FAILED')) as finished_jobs,
  count(j.id) filter (where j.status = 'COMPLETED') as successful_jobs,
  count(j.id) filter (where j.status = 'FAILED') as failed_jobs,
  -- Null, not 100%, when nothing has finished: a machine that has never run
  -- has no success rate, and printing one invites trusting it.
  case
    when count(j.id) filter (where j.status in ('COMPLETED', 'FAILED')) = 0 then null
    else round(
      100.0 * count(j.id) filter (where j.status = 'COMPLETED')
      / count(j.id) filter (where j.status in ('COMPLETED', 'FAILED')), 2)
  end as success_rate,
  coalesce(sum(coalesce(j.actual_seconds, j.estimated_seconds))
           filter (where j.status = 'COMPLETED'), 0) as print_seconds,
  coalesce(sum(coalesce(j.actual_grams, j.estimated_grams))
           filter (where j.status in ('COMPLETED', 'FAILED')), 0) as filament_grams,
  coalesce(m.maintenance_cost, 0) as maintenance_cost,
  coalesce(m.downtime_hours, 0) as downtime_hours,
  m.last_maintenance_on,
  m.next_due_on
from public.printers p
left join public.print_jobs j on j.printer_id = p.id
left join lateral (
  select sum(cost) as maintenance_cost,
         sum(downtime_hours) as downtime_hours,
         max(performed_on) as last_maintenance_on,
         min(next_due_on) filter (where next_due_on >= current_date) as next_due_on
  from public.maintenance_records where printer_id = p.id
) m on true
group by p.id, m.maintenance_cost, m.downtime_hours, m.last_maintenance_on, m.next_due_on;

alter view public.printer_analytics set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Failure analytics (§33)
-- ---------------------------------------------------------------------------

/** Failures grouped by the reason the operator gave. */
create or replace view public.failure_analytics as
with finished as (
  select organization_id, status, failure_reason,
         coalesce(actual_grams, estimated_grams) as grams
  from public.print_jobs
  where status in ('COMPLETED', 'FAILED')
)
select
  f.organization_id,
  coalesce(nullif(btrim(f.failure_reason), ''), 'Unrecorded') as reason,
  count(*) as failures,
  coalesce(sum(f.grams), 0) as wasted_grams,
  round(100.0 * count(*) / nullif(
    (select count(*) from finished t
      where t.organization_id = f.organization_id and t.status = 'FAILED'), 0), 2)
    as share_of_failures
from finished f
where f.status = 'FAILED'
group by f.organization_id, coalesce(nullif(btrim(f.failure_reason), ''), 'Unrecorded');

alter view public.failure_analytics set (security_invoker = on);

/** Failure rate per model, so §33's "worst model" is a fact rather than a hunch. */
create or replace view public.model_reliability as
select
  m.id as model_id,
  m.organization_id,
  m.name,
  count(j.id) as finished_jobs,
  count(j.id) filter (where j.status = 'FAILED') as failed_jobs,
  case
    when count(j.id) = 0 then null
    else round(100.0 * count(j.id) filter (where j.status = 'FAILED') / count(j.id), 2)
  end as failure_rate
from public.models m
join public.model_versions v on v.model_id = m.id
join public.print_jobs j
  on j.model_version_id = v.id and j.status in ('COMPLETED', 'FAILED')
group by m.id;

alter view public.model_reliability set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Waste analytics (§52, §53)
-- ---------------------------------------------------------------------------

/**
 * How much filament leaves stock without ending up in a finished product.
 *
 * The ledger already separates CONSUMPTION from WASTE, SAMPLE and DRYING_LOSS,
 * so this is a grouping rather than an estimate — which is the whole reason
 * phase 1 refused to let anything write `remaining_grams` directly.
 */
create or replace view public.waste_analytics as
select
  t.organization_id,
  date_trunc('month', t.created_at)::date as month,
  coalesce(sum(-t.grams) filter (where t.type = 'CONSUMPTION'), 0) as product_grams,
  coalesce(sum(-t.grams) filter (where t.type = 'WASTE'), 0) as waste_grams,
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
-- Stock forecast and reorder advice (§11, §12, §66)
-- ---------------------------------------------------------------------------

/**
 * Current stock per product against how fast it is actually being used.
 *
 * Usage is measured over the trailing 30 days of the ledger. `daily_usage_g`
 * is null when nothing was used in that window — dividing by a fabricated
 * usage figure is how a forecast starts lying — and the depletion estimate is
 * then null too, rather than "infinite days remaining".
 */
create or replace view public.filament_stock_forecast as
select
  fp.id as product_id,
  fp.organization_id,
  fp.name,
  fp.color_hex,
  fp.supplier,
  fp.warn_grams,
  fp.critical_grams,
  fp.lead_time_days,
  fp.safety_stock_g,
  fp.reorder_qty_g,
  coalesce(s.on_hand, 0) as on_hand_g,
  coalesce(s.reserved, 0) as reserved_g,
  coalesce(s.on_hand, 0) - coalesce(s.reserved, 0) as available_g,
  u.used_30d_g,
  case when coalesce(u.used_30d_g, 0) <= 0 then null
       else round(u.used_30d_g / 30.0, 3) end as daily_usage_g,
  case when coalesce(u.used_30d_g, 0) <= 0 then null
       else round((coalesce(s.on_hand, 0) - coalesce(s.reserved, 0))
                  / (u.used_30d_g / 30.0), 1) end as days_remaining
from public.filament_products fp
left join lateral (
  select sum(sp.remaining_grams) as on_hand, sum(sp.reserved_grams) as reserved
  from public.filament_spools sp
  where sp.product_id = fp.id and sp.status in ('sealed', 'in_use')
) s on true
left join lateral (
  select sum(-t.grams) as used_30d_g
  from public.filament_transactions t
  join public.filament_spools sp on sp.id = t.spool_id
  where sp.product_id = fp.id
    and t.type in ('CONSUMPTION', 'WASTE')
    and t.created_at >= now() - interval '30 days'
) u on true
where not fp.discontinued;

alter view public.filament_stock_forecast set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Calibration (§84)
-- ---------------------------------------------------------------------------

/**
 * Historical estimate error per printer and material.
 *
 * Reported as a mean signed error with its sample count, so the UI can refuse
 * to offer a correction factor built on two jobs. §84 requires corrections to
 * be configurable and reversible; nothing here is applied automatically.
 */
create or replace view public.calibration_samples as
select
  j.organization_id,
  j.printer_id,
  pr.name as printer_name,
  mat.id as material_id,
  mat.name as material_name,
  count(*) as samples,
  round(avg(100.0 * (j.actual_grams - j.estimated_grams)
        / nullif(j.estimated_grams, 0))::numeric, 2) as material_error_percent,
  round(avg(100.0 * (j.actual_seconds - j.estimated_seconds)
        / nullif(j.estimated_seconds, 0))::numeric, 2) as time_error_percent
from public.print_jobs j
join public.printers pr on pr.id = j.printer_id
left join public.filament_spools sp on sp.id = j.spool_id
left join public.filament_products fp on fp.id = sp.product_id
left join public.materials mat on mat.id = fp.material_id
where j.status = 'COMPLETED'
  and j.actual_grams is not null
  and j.estimated_grams > 0
group by j.organization_id, j.printer_id, pr.name, mat.id, mat.name;

alter view public.calibration_samples set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Headline KPIs (§69)
-- ---------------------------------------------------------------------------

/**
 * The §69 KPI set, per month.
 *
 * Profit per machine hour and profit per gram are the two the doc singles out,
 * and both are null when the denominator is zero — a month with no print hours
 * has no profit-per-hour, and a huge number produced by dividing by almost
 * nothing is worse than no number at all.
 */
create or replace view public.business_kpis as
with production as (
  select
    j.organization_id,
    date_trunc('month', j.finished_at)::date as month,
    sum(coalesce(j.actual_seconds, j.estimated_seconds))
      filter (where j.status = 'COMPLETED') as print_seconds,
    sum(coalesce(j.actual_grams, j.estimated_grams))
      filter (where j.status in ('COMPLETED', 'FAILED')) as grams,
    count(*) filter (where j.status in ('COMPLETED', 'FAILED')) as finished_jobs,
    count(*) filter (where j.status = 'FAILED') as failed_jobs
  from public.print_jobs j
  where j.finished_at is not null
  group by j.organization_id, date_trunc('month', j.finished_at)
),
sales as (
  select
    o.organization_id,
    date_trunc('month', o.created_at)::date as month,
    count(*) filter (where o.status <> 'CANCELLED') as orders,
    sum(o.total) filter (where o.status <> 'CANCELLED') as order_value
  from public.orders o
  group by o.organization_id, date_trunc('month', o.created_at)
),
-- A month is worth reporting if anything happened in it — money, production
-- or sales. Driving off the P&L alone would hide a month that printed and
-- failed without billing anyone, which is exactly a month worth seeing.
months as (
  select organization_id, month from public.profit_and_loss
  union
  select organization_id, month from production
  union
  select organization_id, month from sales
)
select
  m.organization_id,
  m.month,
  pl.revenue,
  pl.gross_profit,
  pl.net_profit,
  case when coalesce(pl.revenue, 0) <= 0 then null
       else round(100.0 * pl.gross_profit / pl.revenue, 2) end as gross_margin,
  coalesce(pr.print_seconds, 0) as print_seconds,
  coalesce(pr.grams, 0) as filament_grams,
  coalesce(pr.finished_jobs, 0) as finished_jobs,
  case when coalesce(pr.finished_jobs, 0) = 0 then null
       else round(100.0 * pr.failed_jobs / pr.finished_jobs, 2) end as failure_rate,
  coalesce(sa.orders, 0) as orders,
  case when coalesce(sa.orders, 0) = 0 then null
       else round(sa.order_value / sa.orders, 2) end as average_order_value,
  case when coalesce(pr.print_seconds, 0) = 0 or pl.net_profit is null then null
       else round(pl.net_profit / (pr.print_seconds / 3600.0), 2)
  end as profit_per_machine_hour,
  case when coalesce(pr.grams, 0) = 0 or pl.net_profit is null then null
       else round(pl.net_profit / pr.grams, 4) end as profit_per_gram
from months m
left join public.profit_and_loss pl
  on pl.organization_id = m.organization_id and pl.month = m.month
left join production pr
  on pr.organization_id = m.organization_id and pr.month = m.month
left join sales sa
  on sa.organization_id = m.organization_id and sa.month = m.month;

alter view public.business_kpis set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.maintenance_records      enable row level security;
alter table public.consumables              enable row level security;
alter table public.consumable_transactions  enable row level security;

do $rls$
declare
  t text;
begin
  foreach t in array array['maintenance_records', 'consumables', 'consumable_transactions'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select using (public.is_org_member(organization_id))', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.has_role_at_least(organization_id, ''operator'')) with check (public.has_role_at_least(organization_id, ''operator''))', t);
  end loop;
end;
$rls$;

-- A consumable's on_hand is reconciled from its own ledger, exactly as spools
-- are. Letting anyone set it directly would recreate the drift phase 1 removed.
revoke update (on_hand) on public.consumables from anon, authenticated;

-- The ledger is history; corrections are new rows.
revoke update, delete on public.consumable_transactions from anon, authenticated;

create trigger consumables_touch before update on public.consumables
  for each row execute function public.touch_updated_at();

create trigger maintenance_audit
  after insert or update or delete on public.maintenance_records
  for each row execute function public.write_audit_log();

notify pgrst, 'reload schema';
