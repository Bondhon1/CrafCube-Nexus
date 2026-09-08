-- The seeded cost profiles set margins but left every rate at 0, so a quote
-- from an untouched profile counted material only — no machine time, no
-- electricity, no labour. That prices below cost while looking healthy, which
-- is precisely the failure §95 exists to prevent.
--
-- Seeds now carry the worked-example rates from §21-§24. They are starting
-- points, not truths: the UI flags a profile whose rates are all zero, and
-- these figures should be replaced with the operator's real numbers.

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
    organization_id, name, description,
    electricity_rate_per_kwh, machine_rate_per_hour, labor_rate_per_hour,
    labor_minutes_per_job, packaging_cost, consumables_cost,
    target_margin_percent, minimum_margin_percent, failure_rate_percent, is_default
  ) values
    (p_org, 'Standard Retail', 'Default retail pricing.',
       12, 20, 120, 10, 15, 5, 60, 25, 5,  true),
    (p_org, 'Wholesale',       'Bulk orders at a lower margin.',
       12, 20, 120,  5, 10, 5, 25, 12, 4,  false),
    (p_org, 'Custom Order',    'Bespoke work with design time.',
       12, 20, 120, 30, 20, 8, 65, 30, 8,  false),
    (p_org, 'Premium',         'Show pieces and finishing.',
       12, 25, 150, 45, 40, 15, 70, 35, 10, false),
    (p_org, 'Internal',        'At cost, for internal use.',
       12, 20, 120,  5,  0, 0,  0,  0, 5,  false)
  on conflict (organization_id, name) do nothing;
end;
$$;

-- Repair profiles already seeded with zero rates. Only touches rows that are
-- still entirely unconfigured, so edited profiles are left alone.
update public.cost_profiles
set electricity_rate_per_kwh = 12,
    machine_rate_per_hour    = 20,
    labor_rate_per_hour      = 120,
    packaging_cost           = case when name = 'Internal' then 0 else 15 end,
    consumables_cost         = case when name = 'Internal' then 0 else 5 end
where electricity_rate_per_kwh = 0
  and machine_rate_per_hour = 0
  and labor_rate_per_hour = 0;
