# CrafCube Nexus

3D-print business management system — inventory, production, costing, pricing and finance.
Full blueprint: [3D_Artifact_Business_Management_System_Design.md](3D_Artifact_Business_Management_System_Design.md).

## Status — Phase 1: Foundation

| Phase | Scope | State |
|---|---|---|
| 1 | Auth, orgs, roles, audit, inventory, printers, model library | **done** (thumbnails pending) |
| 2 | Geometry analysis, thumbnails, 3D preview, slicer + G-code | **in progress** |
| 3 | Costing and pricing engine | planned |
| 4 | Print jobs, queue, inventory consumption | planned |
| 5 | Sales, orders, finance | planned |
| 6 | Analytics, calibration, forecasting | planned |

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
