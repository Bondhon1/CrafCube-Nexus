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
