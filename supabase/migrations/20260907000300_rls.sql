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
