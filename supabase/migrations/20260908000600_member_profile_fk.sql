-- PostgREST can only embed related rows when a foreign key connects the two
-- tables. `organization_members.user_id` and `profiles.id` both pointed at
-- auth.users but never at each other, so `select=*,profile:profiles(...)`
-- failed with PGRST200 and the Users screen could not show names or emails.
--
-- Safe to add: handle_new_user() creates a profile on the same statement that
-- creates the auth user, so a membership can never precede its profile.
-- The existing FK to auth.users stays, which keeps the referential guarantee
-- even if profiles were ever rebuilt.

alter table public.organization_members
  add constraint organization_members_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- PostgREST caches the schema; without this the new relationship is invisible
-- until the service happens to restart.
notify pgrst, 'reload schema';
