# CrafCube Nexus

3D-print business management system — inventory, production, costing, pricing and finance.
Full blueprint: [3D_Artifact_Business_Management_System_Design.md](3D_Artifact_Business_Management_System_Design.md).

## Status — all six phases shipped

| Phase | Scope | State |
|---|---|---|
| 1 | Auth, orgs, roles, audit, inventory, printers, model library | **done** |
| 2 | Geometry, slicing, G-code, 3MF, 3D preview, thumbnails | **done** |
| 3 | Costing and pricing engine | **done** |
| 4 | Print jobs, queue, inventory consumption | **done** |
| 5 | Sales, orders, payments, finance, P&L | **done** |
| 6 | Analytics, calibration, forecasting, reorder advice | **done** |

## Phase notes

Each phase records the decisions that are not obvious from the code — and the
ones where the design doc was deliberately not followed.

- [Phase 1 — Foundation](docs/phase-1-foundation.md)
- [Phase 2 — Smart analyzer](docs/phase-2-analyzer.md)
- [Phase 3 — Costing](docs/phase-3-costing.md)
- [Phase 4 — Production](docs/phase-4-production.md)
- [Phase 5 — Sales & finance](docs/phase-5-sales-finance.md)
- [Phase 6 — Intelligence](docs/phase-6-intelligence.md)
- [Storage backend](docs/storage-backend.md)

## Layout

```
apps/desktop      Electron + React + TypeScript + Vite + Tailwind
services/         Python local engine (mesh + G-code analysis)
packages/types    Shared domain types, roles and capability matrix
supabase/         PostgreSQL migrations (schema, functions, RLS)
scripts/          Headless screenshot harness
docs/             Phase notes and decision records
```

Object storage runs on Supabase Storage rather than the Cloudflare R2 of §44,
because R2 needs a payment method. See [docs/storage-backend.md](docs/storage-backend.md).

## Setup

Requires Node 20+, pnpm 10+, and a Supabase project.

```bash
pnpm install
cp apps/desktop/.env.example apps/desktop/.env   # fill in URL + anon key
pnpm dev
```

Apply the migrations in `supabase/migrations` in filename order — via
`supabase db push` with the CLI, or by pasting each file into the SQL editor.
The app renders a setup screen until the env vars are present.

## Commands

```bash
pnpm dev         # Electron + Vite dev server
pnpm build       # typecheck, bundle, package
pnpm typecheck   # all workspace packages
```
