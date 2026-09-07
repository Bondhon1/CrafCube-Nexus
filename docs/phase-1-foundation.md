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

## Applied and verified against the live database (2026-09-07)

All three migrations ran successfully on the Supabase project.

**Connectivity note.** The direct host `db.<ref>.supabase.co` publishes only an
AAAA record, so it is unreachable from an IPv4-only network. `apply_migrations.py`
detects this and falls back to the regional session pooler
(`aws-0-<region>.pooler.supabase.com`, user `postgres.<ref>`), probing regions
until one accepts the credentials. The connection string is read from
`supabase/.env.local` or `apps/desktop/.env.local`, and the URL is split by hand
because Supabase passwords routinely contain `@`, which `urlparse` mis-splits.

**Behavioural tests** (run in a transaction, rolled back — no test data persists):

| Check | Result |
|---|---|
| `handle_new_user` creates a profile per auth user | pass |
| `create_organization` creates org + active owner atomically | pass |
| Owner sees their organization | pass |
| Non-member sees 0 organizations and 0 members | pass |
| Non-member update matches no rows | pass |
| Audit rows written for org and membership insert | pass |
| Client `INSERT` into `audit_logs` denied | pass |
| Demoting the sole owner rejected | pass |
| Deleting the sole owner rejected | pass |
| Demotion allowed once a second owner exists | pass |

PostgREST exposes both tables and returns `[]` to an anonymous caller, confirming
the schema cache is loaded and RLS denies by default.

## Email confirmation — OTP code flow

Confirmation stays **on**. The app confirms with a 6-digit code rather than a
link: a link has nowhere to land in Electron (no web origin), so the alternative
would be registering a `crafcube://` protocol handler and allow-listing a
redirect URL. The code flow needs neither and behaves the same on every OS.

`SignIn` is a three-step state machine — `signin` → `signup` → `confirm`:

- Signing up without a returned session moves to the code step.
- Signing in with an unconfirmed address is treated as a routing condition, not
  an error: the app resends a code and moves to the same step.
- `verifyOtp({ type: 'signup' })` exchanges the code for a session, which
  arrives through the existing `onAuthStateChange` subscription.
- Resend is rate-limited client-side by a 60-second cooldown.

### Required dashboard change

Authentication → Emails → **Confirm signup** template must contain the code:

```
Your confirmation code is {{ .Token }}
```

The stock template only interpolates `{{ .ConfirmationURL }}`. Without `.Token`
the recipient gets a link and has no code to type.

### Verified against the live project

`verifyOtp` was probed end-to-end without sending mail, by seeding a token
directly and calling `/auth/v1/verify`. GoTrue stores the confirmation token
**hashed** as `sha224(email + otp)` in `auth.users.confirmation_token` — a
plaintext value returns `otp_expired`. With the correct hash the endpoint issued
a session and set `email_confirmed_at`. The probe account was then deleted.

### Default SMTP limitation

Supabase's built-in mailer only delivers to project-team addresses and is capped
at a few messages per hour. Real signups by other users need custom SMTP
configured before the flow works for them.

### Status: confirmation disabled for development (2026-09-07)

Supabase gates email-template editing behind custom SMTP, so `{{ .Token }}`
cannot be added on the default mailer — and the default mailer only delivers to
project-team addresses anyway, so no email flow reaches staff until custom SMTP
exists. Confirmation is therefore switched **off** in the dashboard for now
(Authentication → Sign In / Providers → Confirm email).

The OTP code path stays in `SignIn` and needs no rework when it is re-enabled:
with confirmation off, `signUp` returns a session immediately and the confirm
step is simply never reached. Re-enabling it is two steps — configure custom
SMTP (Resend or Brevo both have adequate free tiers), then add
`{{ .Token }}` to the Confirm signup template.

This is a development posture. Confirmation should be back on before the system
handles real customer data.
