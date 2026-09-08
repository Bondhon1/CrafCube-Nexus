# Phase 4 — Production

Design doc §18-§20, §35, §50-§51, §83-§84, §89.

## Jobs move stock, not the other way round

A print job is a business transaction (§18), so its status changes and its
material movements happen **in one database transaction**. `set_job_status()`
does both, which is why the job board can never disagree with the ledger.

Nothing writes `remaining_grams` directly. Every movement is a
`filament_transactions` row, reconciled by the trigger built in phase 1 — one
source of truth for stock, as §50 requires.

| Transition | Stock effect |
|---|---|
| → Preparing | `RESERVATION` for the estimate |
| → Printing | none — material is already reserved |
| → Completed | release the reservation, then `CONSUMPTION` of the **actual** weight |
| → Failed | release the reservation, then `WASTE` of what was used |
| → Cancelled | release the reservation, nothing consumed |

### Why failure is waste, not consumption

A failed print really did use filament, so stock must drop. But recording it as
consumption would fold it into production cost and quietly flatter the failure
rate the pricing engine relies on (§25). It is deducted as `WASTE`, which keeps
it visible and out of unit cost.

### Why reservation happens at Preparing

Reserving at queue time would lock material for jobs that may never run;
reserving at print time is too late to stop two jobs planning to use the same
grams. Preparing is the moment someone commits the spool to the job.

The state machine also refuses to skip straight from Queued to Printing, since
that would start a print with nothing reserved, and a Printing job can only
complete or fail — it cannot be cancelled, because the material is already gone.

## Estimate versus actual (§83, §84)

Completion asks for the weight and time that actually happened, and the
`job_accuracy` view exposes the signed error per job. The Completed screen turns
those into correction factors.

`calibrationFactor` **returns null below three completed jobs**. A correction
factor derived from one print is noise presented as insight, and it would feed
straight into pricing.

## Verified against the live database

Run in a transaction and rolled back:

| Check | Result |
|---|---|
| Job codes increment as `PR-2026-00001` | pass |
| Preparing reserves 200 g without touching remaining | pass |
| Printing moves no stock | pass |
| Completion releases the reservation and consumes the measured 214 g | pass |
| Ledger reads RESERVATION → RELEASE → CONSUMPTION | pass |
| Material error +7.00%, time error +13.89% computed correctly | pass |
| A failed job records WASTE, never CONSUMPTION | pass |
| Cancelling frees the reservation and consumes nothing | pass |
| A completed job cannot be reopened | pass |
| Full status history retained | pass |

Plus 12 unit tests on duration formatting, the transition table and calibration.

## Not done

Batch/plate economics (§20). The schema carries a `batched` flag, but printing
five copies on one plate does not take five times as long, and modelling that
properly needs the slicer to report plate time for the arrangement — which pairs
with the multi-plate 3MF work still outstanding from phase 2.

## Follow-up: automatic estimates, multi-colour, and previews (2026-09-08)

Three gaps surfaced once the screens were used in anger.

### The job form asked an operator to guess

Typing grams by hand defeats the point of the analyzer. Selecting a model now
fills the estimate from the version's stored geometry, and **Slice for accuracy**
downloads the source, runs it through OrcaSlicer with the printer's own profile,
and replaces the figure with the sliced one — §41's primary costing source
instead of a guess. The confidence and its reason are shown next to the number,
so a geometry fallback never looks like a slice.

### One spool per job could not describe the printer

The Kobra X is four-colour natively and expandable to nineteen (§2), and §18's
own example job lists two filaments. `print_job_materials` now holds one row per
tool, and the slicer's per-tool extrusion fills them automatically — converted
from millimetres of filament to grams using the density the G-code declares.

Reservation, consumption and waste all iterate materials, so a two-colour job
reserves from two spools and releases both. A trigger keeps the job's headline
estimate equal to the sum of its materials so the two cannot drift.

**One measured weight is split across colours in the estimated proportions.** An
operator weighs the finished part, not each colour, so a 440 g result against a
400 g estimate becomes 330 g and 110 g on a 300/100 job.

### Previews were missing for every real model

Both uploaded models were `.3mf`, and the renderer only parsed STL — so no
preview and no thumbnail, while geometry analysis worked fine because the engine
reads 3MF through trimesh.

Rather than write a 3MF parser in the renderer, the engine gained
`POST /mesh-preview`, which returns any supported format as binary STL and
decimates above 120k faces. One endpoint covers 3MF, OBJ, PLY and the rest.
Opening a model's versions now renders it, and backfills a thumbnail for models
uploaded before previews existed.

### Verified

| Check | Result |
|---|---|
| 3MF converts to STL with dimensions intact | pass |
| Two-colour job rolls 300 + 100 up to 400 g | pass |
| Reservation lands on both spools | pass |
| 440 g measured splits to 330 g / 110 g | pass |
| Failure writes WASTE on every colour | pass |
| flexi_fish.3mf renders in the library | pass |
| Thumbnail backfilled and stored | pass |
