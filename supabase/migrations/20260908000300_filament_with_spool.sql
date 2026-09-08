-- Creating a filament and registering its first spool in one step.
-- Two client-side inserts would leave an orphan product whenever the spool
-- failed (a duplicate code, most likely), so this is one transaction.

-- Next free sequence number for a spool code prefix, e.g. PLA-WHT -> PLA-WHT-003.
create or replace function public.next_spool_code(p_org uuid, p_prefix text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p_prefix || '-' || lpad((
    coalesce(max((regexp_match(code, '(\d+)$'))[1]::int), 0) + 1
  )::text, 3, '0')
  from public.filament_spools
  where organization_id = p_org
    and code like p_prefix || '-%';
$$;

-- First three alphanumerics of a label, uppercased; 'XXX' when there is nothing
-- usable, so a code is always well-formed.
create or replace function public.code_token(p_text text, p_fallback text default 'XXX')
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(upper(substring(regexp_replace(coalesce(p_text, ''), '[^a-zA-Z0-9]', '', 'g') from 1 for 3)), ''),
    p_fallback
  );
$$;

create or replace function public.create_filament_with_spool(
  p_org           uuid,
  p_material      uuid,
  p_name          text,
  p_color_name    text default null,
  p_color_hex     text default null,
  p_diameter      numeric default 1.75,
  p_warn          numeric default null,
  p_critical      numeric default null,
  p_supplier      text default null,
  -- Spool is optional: pass a null weight to create the product alone.
  p_spool_grams   numeric default null,
  p_spool_code    text default null,
  p_product_cost  numeric default 0,
  p_shipping      numeric default 0,
  p_tax           numeric default 0,
  p_other         numeric default 0,
  p_lot_code      text default null,
  p_purchased_at  date default null
)
returns public.filament_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.filament_products;
  v_material_name text;
  v_code text;
begin
  -- SECURITY DEFINER bypasses RLS, so the capability check is explicit and
  -- mirrors the filament_products insert policy.
  if not public.has_role_at_least(p_org, 'production_manager') then
    raise exception 'insufficient permissions to create filament';
  end if;

  select name into v_material_name
  from public.materials
  where id = p_material and organization_id = p_org;

  if v_material_name is null then
    raise exception 'material does not belong to this organization';
  end if;

  insert into public.filament_products (
    organization_id, material_id, name, color_name, color_hex,
    diameter_mm, spool_weight_g, warn_grams, critical_grams, supplier
  ) values (
    p_org, p_material, btrim(p_name), nullif(btrim(coalesce(p_color_name, '')), ''),
    p_color_hex, coalesce(p_diameter, 1.75), coalesce(p_spool_grams, 1000),
    p_warn, p_critical, nullif(btrim(coalesce(p_supplier, '')), '')
  )
  returning * into v_product;

  if p_spool_grams is not null and p_spool_grams > 0 then
    v_code := nullif(btrim(coalesce(p_spool_code, '')), '');
    if v_code is null then
      v_code := public.next_spool_code(
        p_org,
        public.code_token(v_material_name) || '-' || public.code_token(p_color_name, 'STD')
      );
    end if;

    -- The spool's own trigger writes the opening PURCHASE row.
    insert into public.filament_spools (
      organization_id, product_id, code, initial_grams,
      product_cost, shipping_cost, tax_cost, other_cost,
      supplier, lot_code, purchased_at
    ) values (
      p_org, v_product.id, v_code, p_spool_grams,
      coalesce(p_product_cost, 0), coalesce(p_shipping, 0),
      coalesce(p_tax, 0), coalesce(p_other, 0),
      nullif(btrim(coalesce(p_supplier, '')), ''), p_lot_code, p_purchased_at
    );
  end if;

  return v_product;
end;
$$;

-- Suggests the next code for the UI to show before saving. The RPC recomputes
-- it at insert time, so a concurrent registration cannot produce a duplicate.
create or replace function public.suggest_spool_code(
  p_org uuid, p_material uuid, p_color text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_material_name text;
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this organization';
  end if;

  select name into v_material_name
  from public.materials where id = p_material and organization_id = p_org;

  return public.next_spool_code(
    p_org,
    public.code_token(v_material_name) || '-' || public.code_token(p_color, 'STD')
  );
end;
$$;
