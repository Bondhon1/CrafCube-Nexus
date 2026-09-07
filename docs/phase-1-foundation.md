# Phase 1 — Foundation

Covers MVP Phase 1 (§86) and Sprint 1 (§116) of the design doc: repository,
Electron shell, React UI, Supabase, authentication, organizations and roles.

## Delivered

**Database** (`supabase/migrations`)

- `organizations`, `profiles`, `organization_members`, `audit_logs`
- `app_role` enum in privilege order, mirroring `ROLES` in `@crafcube/types`
- `create_organization()` — creates the org and its owner membership atomically,
  so an ownerless organization cannot exist
- `handle_new_user()` — mirrors every `auth.users` row into `profiles`
- `write_audit_log()` — after-trigger capturing before/after JSON per §48
- `guard_last_owner()` — refuses the demotion or removal of the final owner
- RLS on every table; membership predicates are `SECURITY DEFINER` so policies
  on `organization_members` do not recurse into their own check
- `audit_logs` is insert-only to clients: `INSERT/UPDATE/DELETE` revoked from
  `anon` and `authenticated`, written solely by the definer trigger

**Types** (`packages/types`)

- `Role`, `roleAtLeast()`, and an explicit `ROLE_CAPABILITIES` matrix.
  Ranking alone is insufficient — Finance outranks Operator on money but must
  not reach production configuration — so capabilities are granted explicitly.
- Foundation entity interfaces matching the schema.

**Desktop** (`apps/desktop`)

- Electron main with `contextIsolation` + `sandbox` on, external links forced
  to the system browser; preload bundled as CommonJS (`preload.cjs`) because a
  sandboxed preload cannot be ESM.
- `SessionProvider` — Supabase session, membership list, active-organization
  switching persisted to `localStorage`, capability checks.
- Gate: setup screen → sign in → create organization → shell.
- Sidebar covering the full §114 navigation tree, filtered by capability, with
  unbuilt routes marked by their phase number and resolving to a placeholder.
- Working screens: Dashboard, Settings → Organization, Users, Audit Log.

## Deliberately not done yet

- Member invitations. Adding a member requires creating an `auth.users` row,
  which needs the service-role key — that belongs in an Edge Function, not in
  the desktop client where the key would ship to every install. Roles can be
  changed for anyone who has signed up and been added; the invite flow lands
  with the Edge Functions work.
- Docker was unavailable in the dev environment, so the migrations were written
  against the Supabase CLI/cloud path and have not been executed locally.

## Verified

- `pnpm -r typecheck` clean across both packages.
- `vite build` produces the renderer bundle plus `main.js` and `preload.cjs`.
- The SQL has not been run against a live database — no Postgres was reachable
  here. Applying the three migrations is the first step of Phase 2.
