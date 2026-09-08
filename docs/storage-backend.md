# Storage backend decision

**Status:** Supabase Storage in use. Backblaze B2 is the chosen upgrade path.
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
| **Supabase Storage** *(in use)* | 1 GB storage, 5 GB egress | No | **50 MB** | RLS — the same policies as the database |
| **Backblaze B2** | 10 GB storage, egress 3× stored | No | 5 TB (S3 multipart) | S3 keys — needs a signing service |
| Cloudinary | 25 credits/month (~25 GB) | No | **10 MB raw** | Signed URLs — needs a signing service |
| Cloudflare R2 (§44) | 10 GB, free egress | **Yes** | 5 TB | S3 keys — needs a signing service |

### The deciding factor is authorization, not capacity

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

## Migration path

1. Write `B2ObjectStore` (or `R2ObjectStore`) implementing `ObjectStore`.
2. Add a Supabase Edge Function that verifies org membership against
   `organization_members`, then returns a presigned PUT/GET URL. The account key
   lives in the function's secrets, never in the client.
3. Upload from the Electron **main** process rather than the renderer, which
   avoids bucket CORS entirely.
4. Backfill existing objects; `model_files.storage_key` is the only column that
   moves, and `sha256` makes the copy verifiable.

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
