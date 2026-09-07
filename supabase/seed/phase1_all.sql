-- CrafCube Nexus — Phase 1 foundation, all migrations concatenated.
-- Generated from supabase/migrations. Safe to paste into the Supabase SQL editor.
-- Run once, on a fresh project.

-- ============================================================
-- 20260907000100_foundation.sql
-- ============================================================

-- CrafCube Nexus — Phase 1 foundation
-- Organizations, profiles, membership + roles (design doc §46, §47).

create extension if not exists "pgcrypto";

-- Privilege order matters and mirrors ROLES in @crafcube/types.
create type public.app_role as enum (
  'viewer',
  'sales',
  'finance',
  'operator',
  'production_manager',
  'admin',
  'owner'
);

create type public.member_status as enum ('active', 'invited', 'suspended');

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  currency    text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  timezone    text not null default 'UTC',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Mirror of auth.users that the app is allowed to read and join against.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.app_role not null default 'viewer',
  status          public.member_status not null default 'active',
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_org_idx on public.organization_members (organization_id);

-- An organization must never lose its last owner.
create unique index organizations_single_slug_idx on public.organizations (lower(slug));

create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null check (action in ('insert', 'update', 'delete')),
  entity_table    text not null,
  entity_id       text,
  before          jsonb,
  after           jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_table, entity_id);

-- ============================================================
-- 20260907000200_functions.sql
-- ============================================================

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

-- ============================================================
-- 20260907000300_rls.sql
-- ============================================================

-- Row Level Security. Default posture: no row is visible unless the caller is
-- an active member of the owning organization (design doc §46).

alter table public.organizations       enable row level security;
alter table public.profiles            enable row level security;
alter table public.organization_members enable row level security;
alter table public.audit_logs          enable row level security;

-- Organizations -------------------------------------------------------------

create policy organizations_select on public.organizations
  for select using (public.is_org_member(id));

-- Inserts go through create_organization(); a direct insert would leave an
-- ownerless org, so only the definer function may create one.
create policy organizations_update on public.organizations
  for update using (public.has_role_at_least(id, 'admin'))
  with check (public.has_role_at_least(id, 'admin'));

create policy organizations_delete on public.organizations
  for delete using (public.has_role_at_least(id, 'owner'));

-- Profiles ------------------------------------------------------------------

-- You can always see yourself, plus anyone sharing an organization with you.
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = public.profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Members -------------------------------------------------------------------

create policy members_select on public.organization_members
  for select using (
    user_id = auth.uid() or public.is_org_member(organization_id)
  );

create policy members_insert on public.organization_members
  for insert with check (public.has_role_at_least(organization_id, 'admin'));

create policy members_update on public.organization_members
  for update using (public.has_role_at_least(organization_id, 'admin'))
  with check (public.has_role_at_least(organization_id, 'admin'));

create policy members_delete on public.organization_members
  for delete using (public.has_role_at_least(organization_id, 'admin'));

-- Audit logs ----------------------------------------------------------------
-- Read-only to clients; only the SECURITY DEFINER trigger writes here, and
-- nothing may update or delete a log line (§48: history never disappears).

create policy audit_select on public.audit_logs
  for select using (public.has_role_at_least(organization_id, 'admin'));

revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- Guard: an organization must always keep at least one active owner.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owners int;
begin
  if old.role <> 'owner' or old.status <> 'active' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.status = 'active' then
    return new;
  end if;

  select count(*) into v_owners
  from public.organization_members
  where organization_id = old.organization_id
    and role = 'owner'
    and status = 'active'
    and id <> old.id;

  if v_owners = 0 then
    raise exception 'organization must retain at least one active owner';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger organization_members_guard_owner
  before update or delete on public.organization_members
  for each row execute function public.guard_last_owner();

