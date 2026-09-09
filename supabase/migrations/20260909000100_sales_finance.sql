-- Phase 5: customers, products, orders, payments and finance
-- Design doc §28-§31, §57-§58, §90, §103.

-- ---------------------------------------------------------------------------
-- Customers (§28)
-- ---------------------------------------------------------------------------

create type public.customer_type as enum ('retail', 'wholesale', 'business', 'internal');

create table public.customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 160),
  type            public.customer_type not null default 'retail',
  phone           text,
  whatsapp        text,
  email           text,
  address         text,
  notes           text,
  archived        boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create index customers_org_idx on public.customers (organization_id) where not archived;

-- ---------------------------------------------------------------------------
-- Products (§29). A product is the commercial item; the model is the asset.
-- One model sells as several products — different colours, finishes, editions —
-- so collapsing them would make "Dragon in gold" a different 3D file.
-- ---------------------------------------------------------------------------

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  model_id        uuid references public.models (id) on delete set null,
  cost_profile_id uuid references public.cost_profiles (id) on delete set null,
  name            text not null check (length(btrim(name)) between 1 and 160),
  sku             text,
  description     text,
  -- Null means "price it from the costing engine each time".
  list_price      numeric(14, 4) check (list_price >= 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create unique index products_sku_idx
  on public.products (organization_id, sku) where sku is not null;

-- ---------------------------------------------------------------------------
-- Orders (§28)
-- ---------------------------------------------------------------------------

create type public.order_status as enum (
  'DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED'
);

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id     uuid references public.customers (id) on delete restrict,
  code            text not null,
  status          public.order_status not null default 'DRAFT',

  -- Money is held in minor-unit-safe numerics and never recomputed from the
  -- catalogue: a past order must not change when a price changes (§105).
  subtotal        numeric(14, 4) not null default 0 check (subtotal >= 0),
  discount        numeric(14, 4) not null default 0 check (discount >= 0),
  delivery_charge numeric(14, 4) not null default 0 check (delivery_charge >= 0),
  total           numeric(14, 4) not null default 0 check (total >= 0),

  due_date        date,
  delivered_at    timestamptz,
  notes           text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create index orders_org_status_idx on public.orders (organization_id, status);
create index orders_customer_idx on public.orders (customer_id);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  product_id      uuid references public.products (id) on delete set null,
  quote_id        uuid references public.quotes (id) on delete set null,
  description     text not null,
  quantity        integer not null default 1 check (quantity > 0),
  unit_price      numeric(14, 4) not null default 0 check (unit_price >= 0),
  -- Snapshotted from the quote so profitability survives later cost changes.
  unit_cost       numeric(14, 4) not null default 0 check (unit_cost >= 0),
  line_total      numeric(14, 4) generated always as (unit_price * quantity) stored,
  created_at      timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);

-- Print jobs can be raised against an order line, linking production to revenue.
alter table public.print_jobs
  add column if not exists order_item_id uuid references public.order_items (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Payments (§103). Cash is not revenue: an order can be delivered and unpaid,
-- or paid in advance and not yet produced. Payments are recorded separately so
-- both stay true.
-- ---------------------------------------------------------------------------

create type public.payment_method as enum ('cash', 'bank', 'mobile', 'card', 'other');

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  amount          numeric(14, 4) not null check (amount > 0),
  method          public.payment_method not null default 'cash',
  reference       text,
  paid_at         timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);

-- ---------------------------------------------------------------------------
-- Finance ledger (§30). Income and expenses in one table with a signed amount:
-- two tables would need every report to union them, and the sign already says
-- which direction the money moved.
-- ---------------------------------------------------------------------------

create type public.finance_direction as enum ('income', 'expense');

create table public.finance_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  direction       public.finance_direction not null,
  -- Costs that belong in COGS rather than operating expenses (§31).
  is_cogs         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.finance_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category_id     uuid references public.finance_categories (id) on delete set null,
  direction       public.finance_direction not null,
  amount          numeric(14, 4) not null check (amount > 0),
  occurred_on     date not null default current_date,
  description     text,
  reference       text,
  -- Optional links, so a figure can always be traced to what caused it (§30).
  order_id        uuid references public.orders (id) on delete set null,
  payment_id      uuid references public.payments (id) on delete set null,
  print_job_id    uuid references public.print_jobs (id) on delete set null,
  customer_id     uuid references public.customers (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index finance_org_date_idx on public.finance_transactions (organization_id, occurred_on desc);
create index finance_order_idx on public.finance_transactions (order_id);

-- ---------------------------------------------------------------------------
-- Order totals and payment status
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_order(p_order uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders o
  set subtotal = coalesce((
        select sum(line_total) from public.order_items where order_id = o.id
      ), 0),
      total = greatest(coalesce((
        select sum(line_total) from public.order_items where order_id = o.id
      ), 0) - o.discount + o.delivery_charge, 0)
  where o.id = p_order;
$$;

create or replace function public.on_order_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_order(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

create trigger order_items_recalculate
  after insert or update or delete on public.order_items
  for each row execute function public.on_order_item_change();

/**
 * Recording a payment also records the income, so cash and the ledger cannot
 * drift apart. The transaction carries the payment id, which makes it possible
 * to prove where every income line came from.
 */
create or replace function public.record_payment(
  p_order uuid,
  p_amount numeric,
  p_method public.payment_method default 'cash',
  p_reference text default null,
  p_paid_at timestamptz default now()
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_payment public.payments;
  v_category uuid;
begin
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then
    raise exception 'order not found';
  end if;
  if not public.has_role_at_least(v_order.organization_id, 'sales') then
    raise exception 'insufficient permissions to record a payment';
  end if;
  if p_amount <= 0 then
    raise exception 'payment must be positive';
  end if;

  insert into public.payments (organization_id, order_id, amount, method, reference, paid_at)
  values (v_order.organization_id, p_order, p_amount, p_method, p_reference, p_paid_at)
  returning * into v_payment;

  select id into v_category
  from public.finance_categories
  where organization_id = v_order.organization_id and direction = 'income'
  order by (name = 'Product sales') desc, name
  limit 1;

  insert into public.finance_transactions (
    organization_id, category_id, direction, amount, occurred_on,
    description, order_id, payment_id, customer_id
  ) values (
    v_order.organization_id, v_category, 'income', p_amount, p_paid_at::date,
    'Payment for ' || v_order.code, p_order, v_payment.id, v_order.customer_id
  );

  return v_payment;
end;
$$;

create or replace function public.next_order_code(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'SO-' || to_char(now(), 'YYYY') || '-' || lpad((
    coalesce(max((regexp_match(code, '(\d+)$'))[1]::int), 0) + 1
  )::text, 5, '0')
  from public.orders
  where organization_id = p_org
    and code like 'SO-' || to_char(now(), 'YYYY') || '-%';
$$;

-- ---------------------------------------------------------------------------
-- Reporting views
-- ---------------------------------------------------------------------------

/**
 * Orders with what has actually been paid against them (§103).
 *
 * `total` is revenue once the order is confirmed; `paid` is cash; `balance` is
 * what the customer still owes. Conflating them is the mistake the doc calls
 * out, so all three are reported separately.
 */
create or replace view public.order_balances as
select
  o.id as order_id,
  o.organization_id,
  o.code,
  o.status,
  o.customer_id,
  c.name as customer_name,
  o.total,
  coalesce(p.paid, 0) as paid,
  o.total - coalesce(p.paid, 0) as balance,
  coalesce(i.cost, 0) as cost,
  o.total - coalesce(i.cost, 0) as gross_profit,
  o.created_at,
  o.due_date
from public.orders o
left join public.customers c on c.id = o.customer_id
left join lateral (
  select sum(amount) as paid from public.payments where order_id = o.id
) p on true
left join lateral (
  select sum(unit_cost * quantity) as cost from public.order_items where order_id = o.id
) i on true;

alter view public.order_balances set (security_invoker = on);

/** Lifetime value and outstanding balance per customer (§28, §58). */
create or replace view public.customer_summary as
select
  c.id as customer_id,
  c.organization_id,
  c.name,
  c.type,
  count(o.id) filter (where o.status <> 'CANCELLED') as order_count,
  coalesce(sum(o.total) filter (where o.status <> 'CANCELLED'), 0) as lifetime_value,
  coalesce(sum(o.total) filter (where o.status <> 'CANCELLED'), 0)
    - coalesce(sum(pay.paid), 0) as outstanding,
  max(o.created_at) as last_order_at
from public.customers c
left join public.orders o on o.customer_id = c.id
left join lateral (
  select sum(amount) as paid from public.payments where order_id = o.id
) pay on true
group by c.id;

alter view public.customer_summary set (security_invoker = on);

/**
 * Profit and loss (§31).
 *
 * COGS comes from what orders actually cost to make, not from expense
 * categories, so it stays tied to the jobs that produced them. Expense rows
 * flagged `is_cogs` are added on top for material bought outside a job.
 */
create or replace view public.profit_and_loss as
select
  t.organization_id,
  date_trunc('month', t.occurred_on)::date as month,
  sum(t.amount) filter (where t.direction = 'income') as revenue,
  sum(t.amount) filter (where t.direction = 'expense' and c.is_cogs) as cogs,
  sum(t.amount) filter (where t.direction = 'expense' and not coalesce(c.is_cogs, false))
    as operating_expenses,
  sum(t.amount) filter (where t.direction = 'income')
    - coalesce(sum(t.amount) filter (where t.direction = 'expense' and c.is_cogs), 0)
    as gross_profit,
  sum(t.amount) filter (where t.direction = 'income')
    - coalesce(sum(t.amount) filter (where t.direction = 'expense'), 0)
    as net_profit
from public.finance_transactions t
left join public.finance_categories c on c.id = t.category_id
group by t.organization_id, date_trunc('month', t.occurred_on);

alter view public.profit_and_loss set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Triggers, RLS and seed
-- ---------------------------------------------------------------------------

create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

create trigger customers_stamp before insert on public.customers
  for each row execute function public.stamp_created_by();
create trigger orders_stamp before insert on public.orders
  for each row execute function public.stamp_created_by();
create trigger payments_stamp before insert on public.payments
  for each row execute function public.stamp_created_by();
create trigger finance_stamp before insert on public.finance_transactions
  for each row execute function public.stamp_created_by();

create trigger orders_audit
  after insert or update or delete on public.orders
  for each row execute function public.write_audit_log();
create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.write_audit_log();
create trigger finance_audit
  after insert or update or delete on public.finance_transactions
  for each row execute function public.write_audit_log();

alter table public.customers            enable row level security;
alter table public.products             enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.payments             enable row level security;
alter table public.finance_categories   enable row level security;
alter table public.finance_transactions enable row level security;

do $$
declare
  t text;
begin
  -- Sales own customers, products and orders.
  foreach t in array array['customers', 'products', 'orders', 'order_items'] loop
    execute format(
      'create policy %1$s_select on public.%1$s for select using (public.is_org_member(organization_id))', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.has_role_at_least(organization_id, ''sales'')) with check (public.has_role_at_least(organization_id, ''sales''))', t);
  end loop;
end;
$$;

-- Money is read by finance and above; sales may take a payment but not edit
-- the ledger, and nobody deletes financial history (§48).
create policy payments_select on public.payments
  for select using (public.has_role_at_least(organization_id, 'finance'));
revoke insert, update, delete on public.payments from anon, authenticated;

create policy finance_categories_select on public.finance_categories
  for select using (public.is_org_member(organization_id));
create policy finance_categories_write on public.finance_categories
  for all using (public.has_role_at_least(organization_id, 'admin'))
  with check (public.has_role_at_least(organization_id, 'admin'));

create policy finance_select on public.finance_transactions
  for select using (public.has_role_at_least(organization_id, 'finance'));
create policy finance_insert on public.finance_transactions
  for insert with check (public.has_role_at_least(organization_id, 'finance'));
revoke update, delete on public.finance_transactions from anon, authenticated;

create or replace function public.seed_finance_categories(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role_at_least(p_org, 'admin') then
    raise exception 'insufficient permissions to seed finance categories';
  end if;

  insert into public.finance_categories (organization_id, name, direction, is_cogs) values
    (p_org, 'Product sales',    'income',  false),
    (p_org, 'Custom orders',    'income',  false),
    (p_org, 'Design fees',      'income',  false),
    (p_org, 'Delivery charges', 'income',  false),
    (p_org, 'Other income',     'income',  false),
    (p_org, 'Filament',         'expense', true),
    (p_org, 'Electricity',      'expense', true),
    (p_org, 'Packaging',        'expense', true),
    (p_org, 'Delivery',         'expense', true),
    (p_org, 'Printer',          'expense', false),
    (p_org, 'Maintenance',      'expense', false),
    (p_org, 'Tools',            'expense', false),
    (p_org, 'Software',         'expense', false),
    (p_org, 'Hosting',          'expense', false),
    (p_org, 'Advertising',      'expense', false),
    (p_org, 'Labour',           'expense', false),
    (p_org, 'Refunds',          'expense', false)
  on conflict (organization_id, name) do nothing;
end;
$$;
