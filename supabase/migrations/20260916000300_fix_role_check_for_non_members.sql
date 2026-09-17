-- Fix: role checks let non-members through.
--
-- has_role_at_least() compared role_rank(current_role_in(org)) with the
-- required rank. For anyone who is not an active member of the organization —
-- an anonymous caller included — current_role_in() is NULL, so the comparison
-- was NULL rather than false.
--
-- Row-level security was unaffected: a NULL policy result denies, the same as
-- false. But the SECURITY DEFINER functions guard themselves with
--
--     if not public.has_role_at_least(org, 'x') then raise ...; end if;
--
-- and `not NULL` is NULL, which PL/pgSQL treats as false, so the exception was
-- never raised. Every such function ran for callers it was meant to refuse:
-- set_job_status, record_payment, create_filament_with_spool,
-- seed_cost_profiles, seed_default_catalog, seed_finance_categories,
-- create_integration_key, and revoke_integration_key (`x is null or not ...`).
-- All of them were executable by the anon role, whose key ships in the app.
--
-- Found while testing that the anon role cannot create an integration key: it
-- could. Fixed at the root so no call site has to remember the NULL case.

create or replace function public.has_role_at_least(org uuid, minimum public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Not a member means no role, and no role is never enough.
  select coalesce(
    public.role_rank(public.current_role_in(org)) >= public.role_rank(minimum),
    false
  );
$$;

-- Key management needs a signed-in admin, so there is no reason to let the
-- anon role reach these functions at all. EXECUTE is granted to PUBLIC by
-- default, which is why revoking it from anon alone changed nothing.
revoke execute on function public.create_integration_key(uuid, text) from public, anon;
revoke execute on function public.revoke_integration_key(uuid) from public, anon;
grant execute on function public.create_integration_key(uuid, text) to authenticated;
grant execute on function public.revoke_integration_key(uuid) to authenticated;

notify pgrst, 'reload schema';
