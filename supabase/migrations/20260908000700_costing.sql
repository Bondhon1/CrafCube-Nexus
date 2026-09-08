-- Phase 3: costing and pricing (design doc §21-§27, §95-§97, §105).

-- ---------------------------------------------------------------------------
-- Cost profiles (§97). Every rate the costing formula needs, in one row, so a
-- quote can name the profile it used and be reproduced later.
-- ---------------------------------------------------------------------------

create table public.cost_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  description     text,

  -- §21: electricity is priced from average draw, not the printer's peak.
  electricity_rate_per_kwh numeric(12, 4) not null default 0 check (electricity_rate_per_kwh >= 0),
  -- §22: machine time costs money even when power is cheap.
  machine_rate_per_hour    numeric(12, 4) not null default 0 check (machine_rate_per_hour >= 0),
  -- §23: handling, not just printing.
  labor_rate_per_hour      numeric(12, 4) not null default 0 check (labor_rate_per_hour >= 0),
  labor_minutes_per_job    numeric(8, 2) not null default 10 check (labor_minutes_per_job >= 0),

  -- §24: fixed per-job costs.
  packaging_cost           numeric(12, 4) not null default 0 check (packaging_cost >= 0),
  consumables_cost         numeric(12, 4) not null default 0 check (consumables_cost >= 0),
  delivery_cost            numeric(12, 4) not null default 0 check (delivery_cost >= 0),

  -- §25: a business cannot price on successful prints only.
  failure_rate_percent     numeric(5, 2) not null default 5
                             check (failure_rate_percent >= 0 and failure_rate_percent < 100),
  -- Platform/payment fee, taken off the selling price rather than added to cost.
  platform_fee_percent     numeric(5, 2) not null default 0
                             check (platform_fee_percent >= 0 and platform_fee_percent < 100),

  -- §95: target_price = true_cost / (1 - margin). 100% would divide by zero.
  target_margin_percent    numeric(5, 2) not null default 50
                             check (target_margin_percent >= 0 and target_margin_percent < 100),
  -- §26: the floor below which a job is not worth accepting.
  minimum_margin_percent   numeric(5, 2) not null default 15
                             check (minimum_margin_percent >= 0 and minimum_margin_percent < 100),

  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name),
  check (minimum_margin_percent <= target_margin_percent)
);

create unique index cost_profiles_one_default
  on public.cost_profiles (organization_id) where is_default;

-- ---------------------------------------------------------------------------
-- Price rules (§96). Kept as data, and deliberately legible: the doc is
-- explicit that pricing logic must be visible and editable, never hidden.
-- ---------------------------------------------------------------------------

create type public.price_rule_kind as enum (
  'quantity_discount',   -- quantity >= threshold -> percent off
  'multi_color_fee',     -- per additional colour, flat
  'rush_fee',            -- flat or percent uplift
  'margin_override',     -- replaces the profile's target margin
  'minimum_price'        -- absolute floor
);

create table public.price_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cost_profile_id uuid references public.cost_profiles (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  kind            public.price_rule_kind not null,
  -- Applies when the driving quantity reaches this value; null means always.
  threshold       numeric(12, 3),
  -- Percent for discount/margin/rush kinds, currency for fee/minimum kinds.
  value           numeric(12, 4) not null,
  active          boolean not null default true,
  -- Lower runs first; ties broken by name for determinism.
  priority        smallint not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index price_rules_org_idx on public.price_rules (organization_id, active);

-- ---------------------------------------------------------------------------
-- Quotes: an immutable snapshot of a costing (§105, §106).
--
-- Every rate is copied in rather than referenced. Editing a cost profile or a
-- spool price must never silently rewrite what a past job was costed at.
-- ---------------------------------------------------------------------------

create type public.estimate_basis as enum ('geometry', 'slicer', 'gcode', 'manual');
create type public.confidence_level as enum ('HIGH', 'MEDIUM', 'LOW', 'UNRELIABLE');

create table public.quotes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  model_version_id uuid references public.model_versions (id) on delete set null,
  printer_id      uuid references public.printers (id) on delete set null,
  cost_profile_id uuid references public.cost_profiles (id) on delete set null,

  label           text,
  quantity        integer not null default 1 check (quantity > 0),

  -- What the estimate was based on, and how much it can be trusted (§82).
  basis           public.estimate_basis not null,
  confidence      public.confidence_level not null,
  confidence_reason text,

  -- Inputs, snapshotted.
  filament_grams  numeric(12, 3) not null check (filament_grams >= 0),
  print_seconds   integer not null default 0 check (print_seconds >= 0),
  cost_per_gram   numeric(14, 6) not null default 0 check (cost_per_gram >= 0),
  power_watts     numeric(8, 2) not null default 0 check (power_watts >= 0),
  rates           jsonb not null default '{}'::jsonb,

  -- Outputs, per unit unless stated.
  material_cost   numeric(14, 4) not null default 0,
  electricity_cost numeric(14, 4) not null default 0,
  machine_cost    numeric(14, 4) not null default 0,
  labor_cost      numeric(14, 4) not null default 0,
  consumables_cost numeric(14, 4) not null default 0,
  packaging_cost  numeric(14, 4) not null default 0,
  delivery_cost   numeric(14, 4) not null default 0,
  failure_reserve numeric(14, 4) not null default 0,
  true_cost       numeric(14, 4) not null default 0,

  recommended_price numeric(14, 4) not null default 0,
  minimum_price     numeric(14, 4) not null default 0,
  total_price       numeric(14, 4) not null default 0,
  gross_profit      numeric(14, 4) not null default 0,
  margin_percent    numeric(6, 2) not null default 0,
  applied_rules     jsonb not null default '[]'::jsonb,

  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index quotes_org_created_idx on public.quotes (organization_id, created_at desc);
create index quotes_version_idx on public.quotes (model_version_id);

-- ---------------------------------------------------------------------------
-- Triggers and RLS
-- ---------------------------------------------------------------------------

create trigger cost_profiles_touch before update on public.cost_profiles
  for each row execute function public.touch_updated_at();
create trigger price_rules_touch before update on public.price_rules
  for each row execute function public.touch_updated_at();

create trigger cost_profiles_audit
  after insert or update or delete on public.cost_profiles
  for each row execute function public.write_audit_log();
create trigger price_rules_audit
  after insert or update or delete on public.price_rules
  for each row execute function public.write_audit_log();

create trigger quotes_stamp before insert on public.quotes
  for each row execute function public.stamp_created_by();

alter table public.cost_profiles enable row level security;
alter table public.price_rules   enable row level security;
alter table public.quotes        enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['cost_profiles', 'price_rules'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select using (public.is_org_member(organization_id))', t);
    -- Pricing is a commercial decision: sales and finance may not reshape the
    -- cost model, so writes need admin.
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.has_role_at_least(organization_id, ''admin'')) with check (public.has_role_at_least(organization_id, ''admin''))', t);
  end loop;
end;
$$;

create policy quotes_select on public.quotes
  for select using (public.is_org_member(organization_id));

-- Anyone who can quote work may create one; sales sits above viewer.
create policy quotes_insert on public.quotes
  for insert with check (public.has_role_at_least(organization_id, 'sales'));

-- Quotes are snapshots. Correcting one means issuing another (§105).
revoke update, delete on public.quotes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed the profiles from §97
-- ---------------------------------------------------------------------------

create or replace function public.seed_cost_profiles(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role_at_least(p_org, 'admin') then
    raise exception 'insufficient permissions to seed cost profiles';
  end if;

  insert into public.cost_profiles (
    organization_id, name, description, target_margin_percent, minimum_margin_percent,
    failure_rate_percent, labor_minutes_per_job, is_default
  ) values
    (p_org, 'Standard Retail', 'Default retail pricing.',        60, 25, 5,  10, true),
    (p_org, 'Wholesale',       'Bulk orders at a lower margin.', 25, 12, 4,  5,  false),
    (p_org, 'Custom Order',    'Bespoke work with design time.', 65, 30, 8,  30, false),
    (p_org, 'Premium',         'Show pieces and finishing.',     70, 35, 10, 45, false),
    (p_org, 'Internal',        'At cost, for internal use.',      0,  0, 5,  5,  false)
  on conflict (organization_id, name) do nothing;
end;
$$;
