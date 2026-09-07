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
