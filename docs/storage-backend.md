# Storage backend decision

**Status:** **Backblaze B2 live** — deployed and verified 2026-09-08, region
`us-east-005`, bucket `crafcube-nexus`. Supabase Storage remains implemented and
selectable via `VITE_STORAGE_BACKEND=supabase`.
**Date:** 2026-09-08
**Affects:** design doc §44 (storage architecture), §77 (file security), §78 (deduplication)

---

## Why this deviates from the design doc

§44 specifies Cloudflare R2. R2 remains the right long-term answer — free
egress, 5 TB objects, 10 GB free storage — but it cannot be reached without a
payment method. Cloudflare's stated prerequisite is *"a Cloudflare account with
an R2 subscription"*, obtained through a dashboard checkout, so a card is
required even though free-tier usage costs nothing.

Rather than block the model library on that, storage sits behind the
`ObjectStore` interface in `apps/desktop/src/lib/storage.ts`. Swapping backends
means adding one implementation; nothing above that file changes.

## Options considered

| Backend | Free tier | Card needed | Max file | Authorization |
|---|---|---|---|---|
| **Supabase Storage** *(current default)* | 1 GB storage, 5 GB egress | No | **50 MB** | RLS — the same policies as the database |
| **Backblaze B2** *(selected)* | 10 GB storage, egress 3× stored | No | 5 TB (S3 multipart) | S3 keys — needs a signing service |
| Cloudinary | 25 credits/month (~25 GB) | No | **10 MB raw** | Signed URLs — needs a signing service |
| Cloudflare R2 (§44) | 10 GB, free egress | **Yes** | 5 TB | S3 keys — needs a signing service |

### The deciding factor is authorization, not capacity

B2 was chosen for capacity and headroom; the note below explains what that
costs, and how the signing function pays it back.

§77 is explicit: *"the actual authorization should be database-driven."*

Supabase Storage is the only option that satisfies this natively. Object keys
lead with the organization id, and the `storage.objects` policies call the same
`is_org_member()` and `has_role_at_least()` functions the rest of the schema
uses. Membership, roles and file access cannot drift apart because they are one
mechanism.

Every other backend authenticates with a static account-wide key. Keeping files
private then requires a service that mints short-lived presigned URLs after
checking the database — a Supabase Edge Function, in practice. That component is
real work and a real place for bugs, and it must never be skipped, because the
alternative is either a public bucket or shipping the secret inside the desktop
app, where Vite would inline it into the bundle for every install to extract.

### Why not Cloudinary

Despite the largest nominal free tier, it fits worst:

- **10 MB cap on raw files** — below Supabase's 50 MB, and well under a dense
  3MF or a long G-code file. Models are `raw` resources; the higher image and
  video limits do not apply.
- Its value is media transformation — resizing, format conversion, optimisation.
  None of that applies to an STL. We would pay complexity for features the
  product cannot use.
- Credits are shared between storage *and* bandwidth, so the effective ceiling
  falls as the library is read.
- Still needs a signing service for private delivery.

### Why B2 is the upgrade path rather than R2

Both need a presigning service, so that work is shared. B2 needs no card, gives
10× the current storage, and is S3-compatible — the same adapter serves B2 and
R2, so choosing between them later is a config change, not a rewrite.

## Current limits to watch

The trigger to migrate is whichever comes first:

- **50 MB per file.** A large multi-plate 3MF or a long G-code file can exceed
  this. It is a hard bucket limit and will surface as an upload failure.
- **1 GB total.** Roughly 200–500 typical STLs, so this is months away rather
  than weeks, but content-hash deduplication (§78) is already in place and
  materially slows growth for a library with repeated uploads.
- **5 GB egress/month.** Only counts downloads, and the desktop client caches
  nothing yet, so re-downloading the same model repeatedly is the risk.

## Verified on B2 (2026-09-08)

| Check | Result |
|---|---|
| Unauthenticated call to `storage-sign` rejected (401) | pass |
| Signed PUT accepted by B2 | pass |
| Signed GET returns byte-identical content | pass |
| Another organization's prefix refused (403) | pass |
| `../`, absolute and non-UUID prefixes refused (400) | pass |
| 3 MB round trip through the IPC bridge, hash unchanged | pass |

The last row matters on its own: transfers cross a process boundary as an
`ArrayBuffer`, and a structured-clone problem would show up as silent truncation
rather than an error. `scripts/verify-b2.cjs` re-runs that check.

## Switching to B2

Steps 1-3 are built.

### 1. Create the bucket and key (no card)

1. Sign up at [backblaze.com](https://www.backblaze.com/) and open **B2 Cloud
   Storage**.
2. **Create a Bucket** — name it `crafcube-nexus`, **Files in Bucket: Private**.
   Object keys already carry the organization id, and a public bucket would make
   every model world-readable to anyone holding a link.
3. Note the bucket's **Endpoint**, shown as `s3.us-west-004.backblazeb2.com`.
   The region is the middle segment — `us-west-004` in that example.
4. **Application Keys → Add a New Application Key**: scope it to that bucket
   only, with Read and Write access. You get a `keyID` and an `applicationKey`;
   **the application key is shown once**.

### 2. Deploy the signing function

The application key is account-wide, so it never goes near the desktop bundle —
Vite would inline it into every install. It lives only in the function's
secrets.

```bash
# Account → Access Tokens on supabase.com
export SUPABASE_ACCESS_TOKEN=<personal access token>

supabase functions deploy storage-sign --project-ref <project-ref>

supabase secrets set --project-ref <project-ref> \
  B2_REGION=us-west-004 \
  B2_BUCKET=crafcube-nexus \
  B2_KEY_ID=<keyID> \
  B2_APPLICATION_KEY=<applicationKey>
```

### 3. Point the app at it

```
# apps/desktop/.env
VITE_STORAGE_BACKEND=b2
```

### 4. Backfill (only if models were already uploaded)

`model_files.storage_key` is the only column that moves, and `sha256` makes each
copy verifiable.

## How authorization works with B2

B2 has no row-level security, so the database still decides:

1. The renderer asks `storage-sign` for a URL, sending the user's JWT.
2. The function creates a Supabase client **with that JWT**, so its
   `is_org_member` / `has_role_at_least` calls run under the caller's own RLS.
   It never uses the service role.
3. The key's first path segment must be an organization the caller belongs to.
   Keys containing `..`, backslashes or a leading `/` are rejected outright, so
   a caller cannot escape their prefix past the membership check.
4. Reads require membership; writes and deletes require `production_manager`,
   matching the `model_files` insert policy.
5. Only then is a short-lived presigned URL returned — 5 minutes by default,
   capped at 1 hour.

Transfers run in the Electron **main** process. A presigned request from the
renderer is cross-origin and would need bucket CORS rules, while sending
`Origin: null` from a `file://` page; Node applies no CORS check at all.

Object keys already follow the §77 layout
(`<organization_id>/models/<model_id>/v<version>/<sha256><ext>`), which is
backend-agnostic, so keys carry over unchanged.

## Sources

- [Cloudflare R2 get started](https://developers.cloudflare.com/r2/get-started/) — R2 subscription prerequisite
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) — 10 GB-month, free egress
- [Supabase pricing](https://supabase.com/pricing) — 1 GB storage, 5 GB egress, 50 MB upload
- [Cloudinary pricing](https://cloudinary.com/pricing) — free forever, no credit card, 25 monthly credits
- [Cloudinary upload parameters](https://cloudinary.com/documentation/upload_parameters) — `raw` resource type
- [Cloudinary file size limits](https://support.cloudinary.com/hc/en-us/articles/202520592-Do-you-have-a-file-size-limit) — 10 MB raw on free plans
- [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing) — 10 GB free, no card
