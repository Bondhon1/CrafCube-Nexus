-- CrafCube Nexus — Phase 1 continued: filament inventory and printer registry
-- Design doc §6-§12 (filament model, landed cost, low stock), §36 (printers),
-- §50-§51 (ledger as source of truth, transaction types).

-- ---------------------------------------------------------------------------
-- Materials and products
-- ---------------------------------------------------------------------------

create table public.materials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  -- g/cm³, used to convert sliced volume into grams.
  density         numeric(6, 3) not null check (density > 0 and density < 30),
  nozzle_temp_min smallint check (nozzle_temp_min between 0 and 600),
  nozzle_temp_max smallint check (nozzle_temp_max between 0 and 600),
  bed_temp_min    smallint check (bed_temp_min between 0 and 200),
  bed_temp_max    smallint check (bed_temp_max between 0 and 200),
  requires_drying boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name),
  check (nozzle_temp_max is null or nozzle_temp_min is null or nozzle_temp_max >= nozzle_temp_min),
  check (bed_temp_max is null or bed_temp_min is null or bed_temp_max >= bed_temp_min)
);

create table public.filament_brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  website         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- A purchasable SKU: brand + material + colour + diameter. Spools are instances.
create table public.filament_products (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  brand_id         uuid references public.filament_brands (id) on delete set null,
  material_id      uuid not null references public.materials (id) on delete restrict,
  name             text not null check (length(btrim(name)) between 1 and 120),
  color_name       text,
  color_hex        text check (color_hex is null or color_hex ~* '^#[0-9a-f]{6}$'),
  diameter_mm      numeric(4, 2) not null default 1.75 check (diameter_mm > 0),
  -- Overrides the material density when the vendor publishes its own figure.
  density_override numeric(6, 3) check (density_override > 0),
  spool_weight_g   numeric(10, 3) not null default 1000 check (spool_weight_g > 0),
  -- Low-stock thresholds (§11), measured across all active spools of this product.
  warn_grams       numeric(12, 3) check (warn_grams >= 0),
  critical_grams   numeric(12, 3) check (critical_grams >= 0),
  supplier         text,
  discontinued     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);

create index filament_products_org_idx on public.filament_products (organization_id);
create index filament_products_material_idx on public.filament_products (material_id);

-- ---------------------------------------------------------------------------
-- Spools — every physical spool is its own inventory item (§6)
-- ---------------------------------------------------------------------------

create type public.spool_status as enum ('sealed', 'in_use', 'empty', 'retired');

create table public.filament_spools (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  product_id       uuid not null references public.filament_products (id) on delete restrict,
  -- Human-facing identifier, e.g. PLA-BLK-001.
  code             text not null check (length(btrim(code)) between 1 and 40),
  status           public.spool_status not null default 'sealed',

  initial_grams    numeric(12, 3) not null check (initial_grams > 0),
  -- Cached from the ledger by trigger; the transactions remain the source of truth.
  remaining_grams  numeric(12, 3) not null default 0,
  reserved_grams   numeric(12, 3) not null default 0 check (reserved_grams >= 0),

  -- Landed cost (§8): everything paid to get the spool onto the shelf.
  product_cost     numeric(14, 4) not null default 0 check (product_cost >= 0),
  shipping_cost    numeric(14, 4) not null default 0 check (shipping_cost >= 0),
  tax_cost         numeric(14, 4) not null default 0 check (tax_cost >= 0),
  other_cost       numeric(14, 4) not null default 0 check (other_cost >= 0),
  landed_cost      numeric(14, 4) generated always as
                     (product_cost + shipping_cost + tax_cost + other_cost) stored,
  cost_per_gram    numeric(14, 6) generated always as
                     ((product_cost + shipping_cost + tax_cost + other_cost) / initial_grams) stored,

  supplier         text,
  lot_code         text,
  purchased_at     date,
  opened_at        timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);

create index filament_spools_org_status_idx on public.filament_spools (organization_id, status);
create index filament_spools_product_idx on public.filament_spools (product_id);

-- ---------------------------------------------------------------------------
-- Ledger (§50, §51)
-- ---------------------------------------------------------------------------

create type public.inventory_txn_type as enum (
  'PURCHASE',
  'CONSUMPTION',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'WASTE',
  'RETURN',
  'ADJUSTMENT',
  'TRANSFER',
  'SAMPLE',
  'DRYING_LOSS'
);

create table public.filament_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  spool_id        uuid not null references public.filament_spools (id) on delete cascade,
  type            public.inventory_txn_type not null,
  -- Signed: positive adds material, negative removes it. Reservation types move
  -- reserved_grams instead and are always recorded as a positive magnitude.
  grams           numeric(12, 3) not null check (grams <> 0),
  -- Immutable cost snapshot (§105): never recompute historic value from today's price.
  cost_per_gram   numeric(14, 6),
  value           numeric(14, 4),
  reason          text,
  reference       text,
  actor_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint filament_txn_sign check (
    case type
      when 'PURCHASE' then grams > 0
      when 'RETURN' then grams > 0
      when 'RESERVATION' then grams > 0
      when 'RESERVATION_RELEASE' then grams > 0
      when 'CONSUMPTION' then grams < 0
      when 'WASTE' then grams < 0
      when 'SAMPLE' then grams < 0
      when 'DRYING_LOSS' then grams < 0
      else true            -- ADJUSTMENT and TRANSFER may go either way
    end
  )
);

create index filament_transactions_spool_idx
  on public.filament_transactions (spool_id, created_at desc);
create index filament_transactions_org_idx
  on public.filament_transactions (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Printers (§36) — deliberately not hard-coded to the Kobra X
-- ---------------------------------------------------------------------------

create type public.printer_status as enum ('idle', 'printing', 'paused', 'maintenance', 'offline', 'retired');

create table public.printers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (length(btrim(name)) between 1 and 80),
  brand             text,
  model             text,
  serial_number     text,
  status            public.printer_status not null default 'idle',

  build_x_mm        numeric(8, 2) check (build_x_mm > 0),
  build_y_mm        numeric(8, 2) check (build_y_mm > 0),
  build_z_mm        numeric(8, 2) check (build_z_mm > 0),
  max_nozzle_temp_c smallint check (max_nozzle_temp_c between 0 and 600),
  max_bed_temp_c    smallint check (max_bed_temp_c between 0 and 200),
  extruder_count    smallint not null default 1 check (extruder_count between 1 and 32),
  -- Kobra X ships 4-colour and expands to 19, so colour slots are their own figure.
  color_slots       smallint not null default 1 check (color_slots between 1 and 64),
  supported_materials text[] not null default '{}',

  -- Costing inputs (§21, §22); consumed by the Phase 3 pricing engine.
  power_watts       numeric(8, 2) check (power_watts >= 0),
  hourly_machine_cost numeric(14, 4) not null default 0 check (hourly_machine_cost >= 0),
  purchase_cost     numeric(14, 4) check (purchase_cost >= 0),
  purchased_at      date,

  location          text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, name)
);

create index printers_org_idx on public.printers (organization_id);

create table public.printer_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  printer_id      uuid not null references public.printers (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  nozzle_mm       numeric(4, 2) not null default 0.4 check (nozzle_mm > 0),
  layer_height_mm numeric(4, 2) not null default 0.2 check (layer_height_mm > 0),
  infill_percent  smallint not null default 15 check (infill_percent between 0 and 100),
  wall_count      smallint not null default 3 check (wall_count between 0 and 20),
  print_speed_mms smallint check (print_speed_mms > 0),
  supports        boolean not null default false,
  is_default      boolean not null default false,
  -- Slicer settings are stored verbatim so an estimate can be reproduced (§43).
  slicer_settings jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (printer_id, name)
);

-- At most one default profile per printer.
create unique index printer_profiles_one_default
  on public.printer_profiles (printer_id) where is_default;
