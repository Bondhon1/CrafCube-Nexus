-- Ledger reconciliation, RLS and seeding for inventory + printers.

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger materials_touch before update on public.materials
  for each row execute function public.touch_updated_at();
create trigger filament_brands_touch before update on public.filament_brands
  for each row execute function public.touch_updated_at();
create trigger filament_products_touch before update on public.filament_products
  for each row execute function public.touch_updated_at();
create trigger filament_spools_touch before update on public.filament_spools
  for each row execute function public.touch_updated_at();
create trigger printers_touch before update on public.printers
  for each row execute function public.touch_updated_at();
create trigger printer_profiles_touch before update on public.printer_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The ledger is the source of truth (§50). remaining_grams and reserved_grams
-- are caches, always recomputed from the transactions rather than incremented,
-- so a corrected or deleted row can never leave the spool out of step.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_spool(p_spool uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.filament_spools s
  set
    remaining_grams = coalesce((
      select sum(t.grams) from public.filament_transactions t
      where t.spool_id = s.id
        and t.type not in ('RESERVATION', 'RESERVATION_RELEASE')
    ), 0),
    reserved_grams = greatest(coalesce((
      select sum(case when t.type = 'RESERVATION' then t.grams else -t.grams end)
      from public.filament_transactions t
      where t.spool_id = s.id
        and t.type in ('RESERVATION', 'RESERVATION_RELEASE')
    ), 0), 0)
  where s.id = p_spool;
$$;

create or replace function public.on_filament_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_spool(coalesce(new.spool_id, old.spool_id));
  -- An UPDATE that moves a transaction between spools must fix both.
  if tg_op = 'UPDATE' and new.spool_id is distinct from old.spool_id then
    perform public.reconcile_spool(old.spool_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger filament_transactions_reconcile
  after insert or update or delete on public.filament_transactions
  for each row execute function public.on_filament_transaction();

-- Stamp the cost snapshot and actor at insert time so history stays truthful
-- even after the spool's cost fields are edited (§105).
create or replace function public.stamp_filament_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost numeric(14, 6);
begin
  if new.actor_id is null then
    new.actor_id := auth.uid();
  end if;

  if new.cost_per_gram is null then
    select cost_per_gram into v_cost from public.filament_spools where id = new.spool_id;
    new.cost_per_gram := v_cost;
  end if;

  if new.value is null and new.cost_per_gram is not null then
    new.value := round(new.cost_per_gram * new.grams, 4);
  end if;

  return new;
end;
$$;

create trigger filament_transactions_stamp
  before insert on public.filament_transactions
  for each row execute function public.stamp_filament_transaction();

-- Record the opening balance whenever a spool is created, so the ledger
-- explains the full quantity rather than starting mid-story.
create or replace function public.seed_spool_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.filament_transactions (
    organization_id, spool_id, type, grams, cost_per_gram, value, reason
  ) values (
    new.organization_id, new.id, 'PURCHASE', new.initial_grams,
    new.cost_per_gram, new.landed_cost, 'Spool registered'
  );
  return new;
end;
$$;

create trigger filament_spools_seed_purchase
  after insert on public.filament_spools
  for each row execute function public.seed_spool_purchase();

-- Audit the records that carry money or stock (§48).
create trigger filament_spools_audit
  after insert or update or delete on public.filament_spools
  for each row execute function public.write_audit_log();
create trigger filament_products_audit
  after insert or update or delete on public.filament_products
  for each row execute function public.write_audit_log();
create trigger printers_audit
  after insert or update or delete on public.printers
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------------
-- Stock rollup used by the Filaments screen and low-stock checks (§11)
-- ---------------------------------------------------------------------------

create or replace view public.filament_stock as
select
  p.id                as product_id,
  p.organization_id,
  p.name,
  p.color_name,
  p.color_hex,
  p.diameter_mm,
  p.warn_grams,
  p.critical_grams,
  p.discontinued,
  m.name              as material_name,
  coalesce(m.density, 0) as density,
  b.name              as brand_name,
  count(s.id) filter (where s.status in ('sealed', 'in_use'))       as active_spools,
  coalesce(sum(s.remaining_grams) filter (where s.status in ('sealed', 'in_use')), 0) as remaining_grams,
  coalesce(sum(s.reserved_grams) filter (where s.status in ('sealed', 'in_use')), 0)  as reserved_grams,
  coalesce(sum(s.remaining_grams * s.cost_per_gram)
           filter (where s.status in ('sealed', 'in_use')), 0)      as stock_value,
  -- Weighted average cost (§9), null while no stock remains.
  case
    when coalesce(sum(s.remaining_grams) filter (where s.status in ('sealed', 'in_use')), 0) > 0
    then sum(s.remaining_grams * s.cost_per_gram) filter (where s.status in ('sealed', 'in_use'))
         / sum(s.remaining_grams) filter (where s.status in ('sealed', 'in_use'))
  end as weighted_cost_per_gram
from public.filament_products p
join public.materials m on m.id = p.material_id
left join public.filament_brands b on b.id = p.brand_id
left join public.filament_spools s on s.product_id = p.id
group by p.id, m.name, m.density, b.name;

-- The view runs as the caller, so the underlying tables' RLS still applies.
alter view public.filament_stock set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- RLS. Reading needs membership; writing needs production_manager or above,
-- matching ROLE_CAPABILITIES in @crafcube/types (operators run jobs, they do
-- not edit stock definitions).
-- ---------------------------------------------------------------------------

alter table public.materials             enable row level security;
alter table public.filament_brands       enable row level security;
alter table public.filament_products     enable row level security;
alter table public.filament_spools       enable row level security;
alter table public.filament_transactions enable row level security;
alter table public.printers              enable row level security;
alter table public.printer_profiles      enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'materials', 'filament_brands', 'filament_products',
    'filament_spools', 'printers', 'printer_profiles'
  ] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select using (public.is_org_member(organization_id))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert with check (public.has_role_at_least(organization_id, ''production_manager''))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update using (public.has_role_at_least(organization_id, ''production_manager'')) with check (public.has_role_at_least(organization_id, ''production_manager''))', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete using (public.has_role_at_least(organization_id, ''admin''))', t);
  end loop;
end;
$$;

-- Ledger rows are append-only: operators may record consumption, but nobody
-- edits or deletes history through the client.
create policy filament_transactions_select on public.filament_transactions
  for select using (public.is_org_member(organization_id));

create policy filament_transactions_insert on public.filament_transactions
  for insert with check (public.has_role_at_least(organization_id, 'operator'));

revoke update, delete on public.filament_transactions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: common materials and the Anycubic Kobra X (§2)
-- ---------------------------------------------------------------------------

create or replace function public.seed_default_catalog(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_printer uuid;
begin
  if not public.has_role_at_least(p_org, 'production_manager') then
    raise exception 'insufficient permissions to seed catalog';
  end if;

  insert into public.materials
    (organization_id, name, density, nozzle_temp_min, nozzle_temp_max, bed_temp_min, bed_temp_max, requires_drying)
  values
    (p_org, 'PLA',      1.240, 190, 230,  50,  60, false),
    (p_org, 'PLA+',     1.240, 205, 230,  50,  60, false),
    (p_org, 'PETG',     1.270, 230, 250,  70,  85, true),
    (p_org, 'TPU',      1.210, 220, 250,  40,  60, true),
    (p_org, 'ABS',      1.040, 230, 260,  90, 110, true),
    (p_org, 'ASA',      1.070, 240, 260,  90, 110, true),
    (p_org, 'PVA',      1.230, 190, 220,  50,  60, true),
    (p_org, 'PLA-CF',   1.300, 210, 240,  50,  60, true),
    (p_org, 'PETG-CF',  1.300, 240, 260,  70,  85, true)
  on conflict (organization_id, name) do nothing;

  insert into public.printers (
    organization_id, name, brand, model, build_x_mm, build_y_mm, build_z_mm,
    max_nozzle_temp_c, max_bed_temp_c, extruder_count, color_slots,
    supported_materials, status
  ) values (
    p_org, 'Kobra X', 'Anycubic', 'Kobra X', 260, 260, 260,
    300, 100, 1, 4,
    array['PLA', 'PETG', 'TPU', 'PVA', 'PLA-CF', 'PETG-CF', 'ASA'], 'idle'
  )
  on conflict (organization_id, name) do nothing
  returning id into v_printer;

  if v_printer is not null then
    insert into public.printer_profiles
      (organization_id, printer_id, name, nozzle_mm, layer_height_mm,
       infill_percent, wall_count, print_speed_mms, is_default)
    values
      (p_org, v_printer, 'Standard 0.20', 0.4, 0.20, 15, 3, 300, true),
      (p_org, v_printer, 'Fine 0.12',     0.4, 0.12, 20, 3, 200, false),
      (p_org, v_printer, 'Draft 0.28',    0.4, 0.28, 10, 2, 300, false);
  end if;
end;
$$;
