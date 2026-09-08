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

## UI pass — brand shell (2026-09-07)

The interface was rebuilt against the brand artwork in `docs/brand/`.

**Palette** sampled from the artwork rather than guessed: near-black teal ground
(`#000f16`) with a mint accent (`#0df8d0`), exposed as `ink-*`, `line-*` and
`mint-*` scales in the Tailwind config.

**Background.** `background-plate.png` carries the brand lockup and a
"CD Print Starts Management System" subtitle baked into the pixels, plus a
MANAGE/PRINT/DELIVER rail. Left in place these fought the app's own lockup and
named the wrong product, so those regions are inpainted — iterated
blur-and-composite through a feathered mask, which diffuses the surrounding
gradient inward instead of smearing the letterforms. The result ships as
`src/assets/auth-bg.webp`: 1.44 MB PNG down to 56 KB.

**Frameless window.** `frame: false` with the app drawing its own title bar:
drag regions via `-webkit-app-region`, brand, organization switcher, user menu,
and custom minimise / maximise / close buttons. The maximise button follows
OS-level changes through a `maximize`/`unmaximize` listener, so snapping or
double-clicking the drag region keeps the glyph correct. macOS keeps its native
traffic lights; the custom buttons render on Windows and Linux only. The setup
and loading screens carry the controls too — otherwise a failed launch would
leave an unclosable window.

**Default window size** is clamped to the display's work area. The preferred
1440x900 overflows 1366x768 and 1536x864 laptop panels, pushing the sign-in card
off screen.

### Module format

The desktop package is CommonJS. `vite-plugin-electron` derives its output
format from the package `type` field and ignores per-entry format overrides, so
with `"type": "module"` both bundles came out as ESM — and a sandboxed preload
cannot be ESM. `postcss.config` and `tailwind.config` are `.mjs` so they keep
`export default`.

### Verified by running the app

Launched the built app and captured the real window: sign-in renders over the
cleaned artwork with the custom controls, and signing in reaches the shell with
the title bar, sidebar and dashboard intact.

Note for future automation: this environment sets `ELECTRON_RUN_AS_NODE=1`,
which makes `electron.exe` run as plain Node — `require('electron')` then
returns the binary path string and the app dies with a confusing
`Cannot read properties of undefined` error. Unset it before launching.

## Phase 1 completed: inventory and printers (2026-09-08)

The first pass stopped after Sprint 1 (auth, organizations, roles) while the
navigation already advertised Inventory, Models and Printers as phase 1 — the
app contradicted itself, showing "scheduled for phase 1" on a screen the user
was already looking at. Design doc §86 puts inventory, models and printers in
phase 1, so the remainder was built.

### Inventory (§6-§12, §50-§51)

- `materials`, `filament_brands`, `filament_products`, `filament_spools`,
  `filament_transactions`
- Every physical spool is its own inventory item with its own landed cost.
  `landed_cost` and `cost_per_gram` are generated columns, so the arithmetic
  cannot drift from the inputs.
- **The ledger is the source of truth.** `remaining_grams` and `reserved_grams`
  are caches, recomputed from the transactions by trigger rather than
  incremented — a corrected or deleted row can never leave a spool out of step.
- A `filament_txn_sign` check enforces direction per type: consumption and waste
  must be negative, purchases and returns positive, adjustments either.
- Reservations move `reserved_grams` and deliberately leave `remaining_grams`
  untouched.
- Each transaction stores an immutable cost snapshot (§105), so editing a
  spool's price never rewrites the value of past movements.
- Registering a spool writes its opening `PURCHASE` row, so the ledger explains
  the full quantity instead of starting mid-story.
- The ledger is append-only to clients: `UPDATE` and `DELETE` are revoked.
- `filament_stock` rolls product stock up across active spools with weighted
  average cost (§9) and low-stock levels (§11). It is `security_invoker`, so the
  underlying RLS still applies.

### Printers (§36)

- `printers` and `printer_profiles`, with build volume, colour slots, supported
  materials and the machine-cost fields the phase 3 pricing engine will need.
- Nothing is hard-coded to the Kobra X. `seed_default_catalog()` seeds nine
  common materials plus the Kobra X (260³ mm, 4 colour slots, 300°C / 100°C) and
  three quality profiles, but any brand can be added.

### Verified against the live database

Run inside a transaction and rolled back:

| Check | Result |
|---|---|
| Nine materials and the Kobra X seeded with three profiles | pass |
| Landed cost 1200+100+50 over 1000 g gives 1.35/g (doc §8) | pass |
| Ledger 1000 −83 −17 +5 −4 settles at 901 g (doc §50) | pass |
| Reservation moves reserved, not remaining | pass |
| Release returns reserved to zero | pass |
| Cost snapshot survives a later spool price change | pass |
| Positive CONSUMPTION rejected by the sign constraint | pass |
| Client DELETE on the ledger denied | pass |

All seven tables and the rollup view return 200 through PostgREST.

### Migration runner

`apply_migrations.py` now records applied files in `public.schema_migrations`,
committing each migration and its ledger row in one transaction so a failure can
never mark a file as applied.

### Screenshot harness

`scripts/capture.cjs` loads the built renderer offscreen, injects a real session
into `localStorage` and captures each hash route. It replaced OS-level input
automation, which types into whatever window happens to be focused and is unsafe
on a desktop in use.

### Still outstanding for phase 1

Models — library, upload, thumbnails, metadata — needs Cloudflare R2 credentials
and is the first task of the next session. The navigation now labels those
screens phase 2 rather than claiming phase 1 while showing a placeholder.
