# Phase 2 — Smart analyzer

Design doc §87. In progress.

## Done

### Local engine (§37-§40)

`services/local-engine`, a FastAPI service on loopback. Analysis runs out of
process so a crash in trimesh — or later in a slicer — cannot take the UI down.
It is **optional**: the desktop app stays fully usable without it, and the
upload screen degrades to a notice rather than an error.

| Route | Purpose |
|---|---|
| `GET /status` | Liveness |
| `GET /capabilities` | What this machine can do |
| `POST /analyze` | Level A geometry |
| `POST /validate-mesh` | Fast pass/fail |
| `POST /parse-gcode` | Level C extrusion |
| `POST /bed-fit` | Fit for known dimensions |

### Level A — geometry

Dimensions, volume, surface area, triangle count, watertightness, overhang
ratio, centre of mass, bed fit and a rough material figure.

Two decisions worth keeping:

- **Volume is marked unreliable when the mesh is not watertight.** An open mesh
  has no defined enclosed volume, and the number would otherwise flow into
  pricing as a confident wrong cost.
- **Inverted normals never produce a negative volume.** trimesh returns a signed
  figure; taken raw, a flipped mesh would price as negative material.

The material estimate splits shell from infill rather than treating the model as
solid, which would overestimate several-fold. It is returned as `LOW` confidence
with the reason attached, because §4 forbids presenting geometry-only numbers as
costing-grade.

### Level C — G-code

Extrusion is summed from E-axis moves, honouring `G92` resets, `M82`/`M83`
absolute and relative modes, and per-tool totals for multi-material plates.

**Retractions are not subtracted.** Filament pulled back is pushed out again, so
netting them understates usage; only positive deltas count.

The computed total is then compared against the slicer's own summary comments,
and `confidence_from_agreement` returns HIGH only when they agree within 5%.
Disagreement drops to MEDIUM and states the gap. §4 is explicit that silently
trusting one figure is the wrong behaviour.

### Slicer discovery (§41)

Anycubic Slicer Next is preferred, then OrcaSlicer, then nothing.
`/capabilities` reports availability honestly — **no slicer is installed on this
machine**, so Level B currently reports `no slicer installed` and every filament
figure comes from geometry.

### Desktop integration

The main process supervises the engine: it reuses an instance already running,
polls `/status` rather than parsing uvicorn's banner, and stops it on quit.
Analysis results are written onto `model_versions`, whose geometry columns have
been waiting since phase 1.

## Verified

`scripts/verify-phase2.cjs` spawns the engine as the app does and analyses a
hand-built 40×50×60 mm STL through the real IPC bridge:

| Check | Result |
|---|---|
| Dimensions match the source exactly | pass |
| Volume is 120 cm³ | pass |
| Mesh reported watertight | pass |
| Fits the Kobra X plate | pass |
| Estimate labelled LOW confidence | pass |

Unit tests: 31, asserted against primitives with known answers — a 20×30×40 mm
box is exactly 24 cm³ — because a mm³/cm³ mix-up is the likeliest failure and it
would land straight in pricing.

## Not done

- **Slicing (Level B).** Needs a slicer installed; the adapter and discovery are
  in place, the invocation is not.
- **3MF inspection (§16).** Currently flattened as a mesh; slicer settings and
  plate metadata inside the archive are not read yet.
- **Thumbnails and 3D preview (§79, §80).** Carried over from phase 1.

## Level B — real slicing (2026-09-08)

OrcaSlicer 2.4.2 (portable build in `tools/`, gitignored) now slices for real,
using **the vendor's own Anycubic Kobra X profiles**. That matters for accuracy:
the stock profiles carry the true machine limits, flow rates and retraction
behaviour, which a hand-built profile would get wrong in ways that quietly move
the filament figure.

Three things had to be solved to slice non-interactively:

1. **The CLI is not PrusaSlicer's.** Orca rejects `--export-gcode`; it wants
   `--slice 0` with profiles loaded from files.
2. **Profile inheritance must be flattened first.** Vendor profiles use an
   `inherits` chain, and loading a child file alone leaves the parent's values
   unset, so the child's own constraints fail validation.
3. **A validation quirk blocks the stock profiles.** Orca range-checks
   `retraction_distances_when_cut` against [10, 18] even when
   `enable_long_retraction_when_cut` is 0 — and the Anycubic profiles ship 0, so
   an unmodified vendor profile refuses to slice. The feature stays off; only
   the inert value is made legal.

### A bug worth recording

Profile matching originally used plain substring tests, and selected
**"Anycubic Kobra 2 Max"** for printer "Kobra X" — the single letter `x` occurs
inside "Max". It sliced happily and returned a confident number for the wrong
machine, which is the worst failure mode a costing system has. Terms are now
matched on word boundaries, with regression tests.

### Result on a 40×50×60 mm box, Kobra X, 0.20 mm, 15% infill

| Source | Filament | Time |
|---|---|---|
| Level A — geometry | 41.0 g | — |
| Level B — sliced | **33.98 g** | 3261 s, 594 layers |
| Level C — recomputed from the G-code | 35.39 g | — |

Confidence: **HIGH**, slicer and G-code agreeing within 4.2%.

**Geometry was 21% over.** That single number is the argument for §4's insistence
that a geometry estimate must never be presented as costing-grade — a 21% error
on material is the difference between a healthy margin and none.

Level C now reads `filament_density` from the G-code rather than assuming 1.24,
so the two figures are compared on the slicer's own basis instead of disagreeing
for a reason that is not a real error.

## 3MF inspection (§16)

3MF is treated as an archive, not a mesh: object count, unit, metadata and
slicer settings are read from inside. A **sliced** project carries the slicer's
own filament and time figures, which §41 ranks above anything the engine can
recompute — so a sliced 3MF gives costing-grade numbers with no slicer run at
all. A non-millimetre unit raises a warning, since a metre-unit model would
misprice by a factor of a thousand.

Tests: 45.

## 3D preview and thumbnails (§79, §80)

Rendered in the renderer with three.js rather than round-tripping through the
engine: the bytes are already in hand at upload time, and a WebGL render is far
cheaper than shipping an image back over HTTP.

Binary and ASCII STL are distinguished by checking whether the declared triangle
count matches the file length exactly. Sniffing the leading `solid` keyword is
unreliable — plenty of binary exporters write it too, and misreading a binary
file as ASCII yields an empty mesh rather than an error.

ASCII face normals are recomputed rather than trusted, since inconsistent
exporter normals show up as black patches under lighting.

Both preview and thumbnail are best-effort: a WebGL failure never fails an
upload. Contexts and geometries are disposed on unmount, because a leaked
context per upload eventually stops the app rendering anything at all.

### Verified

`scripts/verify-preview.cjs` loads a real STL into the running upload screen
through the file input and reads the rendered values back out of the DOM:

| Check | Result |
|---|---|
| 3D preview canvas rendered | pass |
| Analysis panel shown | pass |
| Dimensions 60 × 60 × 80 mm match the source | pass |
| Volume 96 cm³ — exactly ⅓ of the bounding box for a pyramid | pass |
| 6 triangles counted | pass |
| Bed fit reported | pass |

The first version of this harness reported failures against working code: it
matched `innerText` case-sensitively for a label that CSS uppercases. Assertions
now read the metric elements from the DOM directly.

## Phase 2 status: complete

Levels A, B and C all work, 3MF is inspected as an archive, and preview and
thumbnails are in place. Remaining slicer work is incremental — multi-plate
3MF handling and per-filament assignment for multi-colour prints — and belongs
with the print-job system in phase 4.

## Three bugs behind one "Slice doesn't work" (2026-09-08)

### 1. A stale engine kept answering

`startEngine` adopted whatever was already listening on the port. A uvicorn
process started before the discovery fix was still running, so the app used old
code and reported "no slicer installed" — while a fresh process found the
slicer perfectly. My verification runs kept passing because each started clean.

The engine now reports a version, and the app refuses to adopt one that does not
match the build it expects: it stops it by the pid the service itself reports
and starts a fresh one. The screenshot harness does the same, so captures can
never show stale engine behaviour either.

### 2. OrcaSlicer's CLI rejects mesh-only 3MF

Both `--load-settings` and the file's own config failed identically with a bare
`Slic3r::CLI::run found error` and empty stderr, so it was the file, not the
profiles. trimesh reads these fine, so anything that is not already STL is
converted before slicing. A *sliced project* 3MF is still handled by
`inspect_3mf`, which reads the slicer's own figures — §41 ranks those higher
than anything we can recompute.

### 3. The G-code parser overstated filament by 39%

With the slice finally working, the parser reported 25.6 g against the slicer's
18.41 g, and **3023 layers for a 40-layer print**.

Both had the same root: counting every positive E move as material. In relative
mode an un-retract is a positive move that only pushes back filament previously
withdrawn — it deposits nothing. The parser now tracks outstanding retraction
and counts only the surplus. Layer counts prefer the slicer's declared total,
then explicit `LAYER_CHANGE` markers, and fall back to counting Z rises last,
because a retraction z-hop looks exactly like a layer change.

**The earlier test asserted the wrong answer.** `test_retractions_are_not_
subtracted` expected the un-retract to count, which is what made the bug look
correct. It is now `test_unretracting_is_not_consumption`, with the reasoning
written down.

Result on the real model: **18.411 g computed against 18.41 g declared — 0.01%
apart, HIGH confidence, 40 layers.** The independent check now corroborates the
slicer instead of contradicting it.
