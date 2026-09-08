-- Model library, versioning and file storage (design doc §13-§17).
-- Files live in Supabase Storage for now behind an app-side storage interface;
-- §44 targets R2 later and only the object backend changes.

create type public.generation_method as enum (
  'ai', 'python', 'manual', 'remix', 'purchased', 'customer_supplied'
);

create type public.model_license as enum (
  'commercial', 'personal', 'unknown', 'restricted'
);

create table public.models (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (length(btrim(name)) between 1 and 160),
  category          text,
  description       text,
  tags              text[] not null default '{}',

  -- Provenance (§15). Valuable for commercial licensing, so it is first-class
  -- rather than free text.
  generation_method public.generation_method not null default 'manual',
  generation_tool   text,
  prompt            text,
  source_reference  text,
  license           public.model_license not null default 'unknown',

  -- Recommended print settings from §13; advisory, not enforced.
  rec_layer_height_mm numeric(4, 2) check (rec_layer_height_mm > 0),
  rec_infill_percent  smallint check (rec_infill_percent between 0 and 100),
  rec_wall_count      smallint check (rec_wall_count between 0 and 20),
  rec_material        text,

  archived          boolean not null default false,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, name)
);

create index models_org_idx on public.models (organization_id) where not archived;

-- Versions are never overwritten (§14).
create table public.model_versions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  model_id          uuid not null references public.models (id) on delete cascade,
  version           integer not null check (version > 0),
  notes             text,
  -- Provenance can differ per version: v1 hand-made, v3 an AI remix.
  generation_method public.generation_method,
  generation_tool   text,
  prompt            text,

  -- Populated by the phase 2 analyzer; null until a version is analysed.
  width_mm          numeric(10, 3) check (width_mm > 0),
  depth_mm          numeric(10, 3) check (depth_mm > 0),
  height_mm         numeric(10, 3) check (height_mm > 0),
  volume_cm3        numeric(12, 4) check (volume_cm3 >= 0),
  triangle_count    integer check (triangle_count >= 0),
  is_manifold       boolean,

  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (model_id, version)
);

create index model_versions_model_idx on public.model_versions (model_id, version desc);

create type public.model_file_kind as enum (
  'source', 'mesh', 'project', 'gcode', 'thumbnail', 'render', 'other'
);

create table public.model_files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  version_id       uuid not null references public.model_versions (id) on delete cascade,
  kind             public.model_file_kind not null default 'source',
  filename         text not null check (length(btrim(filename)) between 1 and 260),
  extension        text,
  -- Object key in the storage bucket. Layout mirrors §77:
  -- <organization_id>/models/<model_id>/v<version>/<hash><ext>
  storage_key      text not null,
  byte_size        bigint not null check (byte_size >= 0),
  content_type     text,
  -- SHA-256 of the file contents, for duplicate detection (§17).
  sha256           text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (organization_id, storage_key)
);

-- Dedup is per organization (§78): the same file uploaded twice inside one org
-- should reuse the stored object rather than upload again.
create index model_files_hash_idx on public.model_files (organization_id, sha256);
create index model_files_version_idx on public.model_files (version_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger models_touch before update on public.models
  for each row execute function public.touch_updated_at();
create trigger model_versions_touch before update on public.model_versions
  for each row execute function public.touch_updated_at();

create trigger models_audit
  after insert or update or delete on public.models
  for each row execute function public.write_audit_log();

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger models_stamp before insert on public.models
  for each row execute function public.stamp_created_by();
create trigger model_versions_stamp before insert on public.model_versions
  for each row execute function public.stamp_created_by();
create trigger model_files_stamp before insert on public.model_files
  for each row execute function public.stamp_created_by();

-- ---------------------------------------------------------------------------
-- RLS. Reading needs membership; writing needs models.write, which the
-- capability matrix grants to production_manager and above.
-- ---------------------------------------------------------------------------

alter table public.models         enable row level security;
alter table public.model_versions enable row level security;
alter table public.model_files    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['models', 'model_versions', 'model_files'] loop
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

-- ---------------------------------------------------------------------------
-- Object storage. Private bucket; authorization is database-driven (§77): the
-- first path segment is the organization id and every policy checks membership
-- against it, so one org can never read another's files.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('models', 'models', false, 52428800)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit;

create policy "models_objects_select" on storage.objects
  for select using (
    bucket_id = 'models'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "models_objects_insert" on storage.objects
  for insert with check (
    bucket_id = 'models'
    and public.has_role_at_least(((storage.foldername(name))[1])::uuid, 'production_manager')
  );

create policy "models_objects_update" on storage.objects
  for update using (
    bucket_id = 'models'
    and public.has_role_at_least(((storage.foldername(name))[1])::uuid, 'production_manager')
  );

create policy "models_objects_delete" on storage.objects
  for delete using (
    bucket_id = 'models'
    and public.has_role_at_least(((storage.foldername(name))[1])::uuid, 'admin')
  );

-- ---------------------------------------------------------------------------
-- Creating a model with its first version in one transaction.
-- ---------------------------------------------------------------------------

create or replace function public.next_model_version(p_model uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(version), 0) + 1
  from public.model_versions where model_id = p_model;
$$;

-- Returns the existing file when this organization already stored these exact
-- bytes, so the client can skip the upload entirely (§17, §78).
create or replace function public.find_duplicate_file(p_org uuid, p_sha256 text)
returns table (
  file_id uuid, filename text, storage_key text, byte_size bigint,
  model_id uuid, model_name text, version integer, uploaded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.filename, f.storage_key, f.byte_size,
         m.id, m.name, v.version, f.created_at
  from public.model_files f
  join public.model_versions v on v.id = f.version_id
  join public.models m on m.id = v.model_id
  where f.organization_id = p_org
    and f.sha256 = lower(p_sha256)
    and public.is_org_member(p_org)
  order by f.created_at
  limit 1;
$$;
