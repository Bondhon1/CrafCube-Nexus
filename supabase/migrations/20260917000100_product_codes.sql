-- Product codes.
--
-- Every sellable design has one short code (C0001) that orders are taken by.
-- A library model has one directly. A one-off design - the flexi name
-- keychain - is a `custom_design`: one code for the design, with every
-- customer's styled build grouped under it.
--
-- Library models and custom designs share one code space, so a code typed on
-- an order means exactly one thing.

-- ---------------------------------------------------------------------------
-- Custom designs
-- ---------------------------------------------------------------------------

create table public.custom_designs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_code    text not null check (product_code ~ '^[A-Z]{1,4}[0-9]{3,6}$'),
  name            text not null check (length(btrim(name)) between 1 and 160),
  description     text,
  -- Where builds of this design come from, and the sender's name for it, so
  -- the studio's "daisy" lands on the same design every time.
  source          text not null default 'manual'
                    check (source in ('manual', 'flexi-name-studio')),
  design_key      text check (design_key is null or length(design_key) between 1 and 80),
  archived        boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, product_code),
  unique (organization_id, source, design_key)
);

create trigger custom_designs_touch before update on public.custom_designs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Library models get theirs. Existing models are numbered in the order they
-- were added.
-- ---------------------------------------------------------------------------

alter table public.models add column product_code text;

update public.models m
set product_code = 'C' || lpad(numbered.n::text, 4, '0')
from (
  select id, row_number() over (partition by organization_id order by created_at, id) as n
  from public.models
) numbered
where numbered.id = m.id;

alter table public.models
  alter column product_code set not null,
  add constraint models_product_code_format check (product_code ~ '^[A-Z]{1,4}[0-9]{3,6}$'),
  add constraint models_product_code_unique unique (organization_id, product_code);

-- ---------------------------------------------------------------------------
-- Assigning and checking codes
-- ---------------------------------------------------------------------------

create or replace function public.normalize_product_code(p_code text)
returns text
language sql
immutable
as $$
  select nullif(upper(btrim(p_code)), '');
$$;

/** Next free code with this prefix across both tables. No access check: internal. */
create or replace function public.next_product_code_internal(p_org uuid, p_prefix text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prefix text := coalesce(public.normalize_product_code(p_prefix), 'C');
  v_max int;
begin
  if v_prefix !~ '^[A-Z]{1,4}$' then
    raise exception 'a code prefix is 1-4 letters' using errcode = '22023';
  end if;

  select coalesce(max(substring(code from length(v_prefix) + 1)::int), 0) into v_max
  from (
    select product_code as code from public.models where organization_id = p_org
    union all
    select product_code from public.custom_designs where organization_id = p_org
  ) codes
  where code ~ ('^' || v_prefix || '[0-9]+$');

  return v_prefix || lpad((v_max + 1)::text, 4, '0');
end;
$$;

revoke execute on function public.next_product_code_internal(uuid, text) from public, anon, authenticated;

/** What the app suggests in a code field. */
create or replace function public.next_product_code(p_org uuid, p_prefix text default 'C')
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  return public.next_product_code_internal(p_org, p_prefix);
end;
$$;

revoke execute on function public.next_product_code(uuid, text) from public, anon;
grant execute on function public.next_product_code(uuid, text) to authenticated;

/**
 * Tidies the code, fills it in when left blank, and keeps it unique across
 * models and custom designs. One lock per organization makes "next number"
 * and "is this taken" safe against two people saving at once.
 */
create or replace function public.assign_product_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other boolean;
begin
  if tg_op = 'UPDATE' and new.product_code is not distinct from old.product_code then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product_code:' || new.organization_id::text, 0));

  new.product_code := public.normalize_product_code(new.product_code);
  if new.product_code is null then
    new.product_code := public.next_product_code_internal(new.organization_id, 'C');
    return new;
  end if;

  if tg_table_name = 'models' then
    select exists (select 1 from public.custom_designs
                   where organization_id = new.organization_id and product_code = new.product_code)
      into v_other;
  else
    select exists (select 1 from public.models
                   where organization_id = new.organization_id and product_code = new.product_code)
      into v_other;
  end if;
  if v_other then
    raise exception 'product code % is already used', new.product_code using errcode = '23505';
  end if;
  return new;
end;
$$;

-- Model inserts may leave the code out; the trigger runs before the NOT NULL check.
create trigger models_product_code
  before insert or update of product_code on public.models
  for each row execute function public.assign_product_code();
create trigger custom_designs_product_code
  before insert or update of product_code on public.custom_designs
  for each row execute function public.assign_product_code();

/** Every code in one list: what the order form looks codes up in. */
create or replace view public.product_catalog as
select m.organization_id, m.product_code, 'model'::text as kind, m.id as model_id,
       null::uuid as custom_design_id, m.name, m.category, m.archived
from public.models m
union all
select d.organization_id, d.product_code, 'custom'::text, null::uuid, d.id,
       d.name, null::text, d.archived
from public.custom_designs d;

alter view public.product_catalog set (security_invoker = on);

-- ---------------------------------------------------------------------------
-- Builds belong to a design
-- ---------------------------------------------------------------------------

alter table public.custom_builds
  add column design_id uuid references public.custom_designs (id) on delete restrict;

-- Any builds from before designs existed go under one design per source.
do $$
declare
  r record;
  v_design uuid;
begin
  for r in select distinct organization_id, source from public.custom_builds where design_id is null loop
    insert into public.custom_designs (organization_id, product_code, name, source, design_key)
    values (r.organization_id, null, 'Earlier custom builds', r.source, 'earlier')
    on conflict (organization_id, source, design_key) do update set name = excluded.name
    returning id into v_design;
    update public.custom_builds set design_id = v_design
    where organization_id = r.organization_id and source = r.source and design_id is null;
  end loop;
end $$;

alter table public.custom_builds alter column design_id set not null;
create index custom_builds_design_idx on public.custom_builds (design_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Order lines are taken by code
-- ---------------------------------------------------------------------------

alter table public.order_items
  add column product_code     text,
  add column model_id         uuid references public.models (id) on delete set null,
  add column custom_design_id uuid references public.custom_designs (id) on delete set null,
  -- For a custom design: which customer's build this line is, once known.
  add column custom_build_id  uuid references public.custom_builds (id) on delete set null;

create index order_items_code_idx on public.order_items (organization_id, product_code);

/**
 * Resolves a line's code to what it names. The code is kept on the line as
 * typed, so the order still reads right if the design is later renamed.
 * A line picked by product, with no code, takes its model's code.
 */
create or replace function public.resolve_order_item_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model uuid;
  v_design uuid;
begin
  new.product_code := public.normalize_product_code(new.product_code);

  if new.product_code is null and new.product_id is not null then
    select m.product_code into new.product_code
    from public.products p join public.models m on m.id = p.model_id
    where p.id = new.product_id and p.organization_id = new.organization_id;
  end if;

  if new.product_code is null then
    new.model_id := null;
    new.custom_design_id := null;
    new.custom_build_id := null;
    return new;
  end if;

  select id into v_model from public.models
  where organization_id = new.organization_id and product_code = new.product_code;
  select id into v_design from public.custom_designs
  where organization_id = new.organization_id and product_code = new.product_code;

  if v_model is null and v_design is null then
    raise exception 'no product with code %', new.product_code using errcode = '23503';
  end if;

  new.model_id := v_model;
  new.custom_design_id := v_design;
  if v_design is null then
    new.custom_build_id := null;
  elsif new.custom_build_id is not null and not exists (
    select 1 from public.custom_builds
    where id = new.custom_build_id and design_id = v_design
  ) then
    raise exception 'that build is not a % design', new.product_code using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger order_items_resolve_code
  before insert or update of product_code, product_id, custom_build_id on public.order_items
  for each row execute function public.resolve_order_item_code();

-- ---------------------------------------------------------------------------
-- The studio names its design; the first build of a new one creates it.
-- ---------------------------------------------------------------------------

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
  v_design uuid;
  v_design_key text;
  v_design_name text;
  v_code text;
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

  -- The design: by code if the sender gives one, else by its own key.
  v_code := public.normalize_product_code(p_build ->> 'product_code');
  if v_code is not null then
    select id into v_design from public.custom_designs
    where organization_id = v_key.organization_id and product_code = v_code;
    if v_design is null then
      raise exception 'no custom design with code %', v_code using errcode = '23503';
    end if;
  else
    v_design_key := lower(btrim(coalesce(p_build #>> '{design,key}', '')));
    if v_design_key = '' then
      v_design_key := 'uncategorised';
    end if;
    if v_design_key !~ '^[a-z0-9][a-z0-9_-]{0,79}$' then
      raise exception 'design key must be lowercase letters, digits, - or _' using errcode = '22023';
    end if;
    v_design_name := left(btrim(coalesce(nullif(p_build #>> '{design,name}', ''), v_design_key)), 160);

    select id into v_design from public.custom_designs
    where organization_id = v_key.organization_id
      and source = 'flexi-name-studio' and design_key = v_design_key;
    if v_design is null then
      insert into public.custom_designs (organization_id, product_code, name, source, design_key)
      values (v_key.organization_id, null, v_design_name, 'flexi-name-studio', v_design_key)
      on conflict (organization_id, source, design_key) do update set design_key = excluded.design_key
      returning id into v_design;
    end if;
  end if;

  insert into public.custom_builds (
    organization_id, design_id, source, external_id, title, file_name, file_sha256, colours, params
  ) values (
    v_key.organization_id, v_design, 'flexi-name-studio',
    left(nullif(p_build ->> 'external_id', ''), 200),
    v_title,
    left(nullif(p_build ->> 'file_name', ''), 260),
    v_sha, v_colours,
    coalesce(p_build -> 'params', '{}'::jsonb)
  )
  on conflict (organization_id, source, external_id) do update
    set design_id = excluded.design_id,
        title = excluded.title,
        file_name = excluded.file_name,
        file_sha256 = excluded.file_sha256,
        colours = excluded.colours,
        params = excluded.params
  returning id into v_id;

  update public.integration_keys set last_used_at = now() where id = v_key.id;
  return v_id;
end;
$$;

grant execute on function public.ingest_custom_build(text, jsonb) to anon, authenticated;

-- next_order_code answered anyone; it now answers members only.
create or replace function public.next_order_code(p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  return (
    select 'SO-' || to_char(now(), 'YYYY') || '-' || lpad((
      coalesce(max((regexp_match(code, '(\d+)$'))[1]::int), 0) + 1
    )::text, 5, '0')
    from public.orders
    where organization_id = p_org
      and code like 'SO-' || to_char(now(), 'YYYY') || '-%'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: designs are managed by whoever manages custom builds.
-- ---------------------------------------------------------------------------

alter table public.custom_designs enable row level security;

create policy custom_designs_select on public.custom_designs
  for select using (public.is_org_member(organization_id));
create policy custom_designs_insert on public.custom_designs
  for insert with check (public.has_role_at_least(organization_id, 'sales'));
create policy custom_designs_update on public.custom_designs
  for update using (public.has_role_at_least(organization_id, 'sales'))
  with check (public.has_role_at_least(organization_id, 'sales'));
create policy custom_designs_delete on public.custom_designs
  for delete using (public.has_role_at_least(organization_id, 'admin'));

create trigger custom_designs_audit
  after insert or update or delete on public.custom_designs
  for each row execute function public.write_audit_log();

revoke execute on function public.assign_product_code() from public, anon, authenticated;
revoke execute on function public.resolve_order_item_code() from public, anon, authenticated;

notify pgrst, 'reload schema';
