-- Helper functions, triggers and RLS policies.
-- Membership lookups are SECURITY DEFINER so that policies on
-- organization_members can consult membership without recursing into
-- their own RLS check.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger organization_members_touch before update on public.organization_members
  for each row execute function public.touch_updated_at();

-- Every auth.users row gets a profile automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership predicates
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.current_role_in(org uuid)
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.organization_members m
  where m.organization_id = org
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

-- Rank mirrors the enum order, which mirrors ROLES in @crafcube/types.
create or replace function public.role_rank(r public.app_role)
returns int
language sql
immutable
as $$
  select array_position(enum_range(null::public.app_role), r);
$$;

create or replace function public.has_role_at_least(org uuid, minimum public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.role_rank(public.current_role_in(org)) >= public.role_rank(minimum);
$$;

-- ---------------------------------------------------------------------------
-- Organization creation (atomic: org + owner membership)
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_currency text default 'USD',
  p_timezone text default 'UTC'
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into public.organizations (name, slug, currency, timezone, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), upper(p_currency), p_timezone, auth.uid())
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (v_org.id, auth.uid(), 'owner', 'active');

  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit trigger (§48)
-- ---------------------------------------------------------------------------

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_org uuid;
begin
  v_row := to_jsonb(coalesce(new, old));
  begin
    v_org := (v_row ->> 'organization_id')::uuid;
  exception when others then
    v_org := null;
  end;

  -- organizations audit their own id rather than an organization_id column.
  if v_org is null and tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_table, entity_id, before, after
  ) values (
    v_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function public.write_audit_log();

create trigger organization_members_audit
  after insert or update or delete on public.organization_members
  for each row execute function public.write_audit_log();
