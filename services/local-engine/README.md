# Local engine

CPU-heavy, OS-dependent work that the desktop app cannot do itself: mesh
analysis, G-code parsing and (later) driving a slicer. Design doc §37-§40.

Binds to **loopback only** and is unauthenticated — the desktop app is the only
intended caller. It must never be exposed on a network interface.

## Running

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Scripts -> bin on unix
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

## Endpoints

| Route | Purpose |
|---|---|
| `GET /status` | Liveness and version |
| `GET /capabilities` | What this machine can do, including whether a slicer is installed |
| `POST /analyze` | Level A: dimensions, volume, warnings, bed fit, rough material |
| `POST /validate-mesh` | Fast pass/fail mesh check |
| `POST /parse-gcode` | Level C: extrusion computed from E moves vs the slicer's claim |
| `POST /bed-fit` | Bed fit for known dimensions |

## Analysis levels

`/capabilities` reports these honestly rather than pretending:

- **A — geometry** (always): fast, from the mesh alone. Never costing-grade.
- **B — slicer** (needs Anycubic Slicer Next or OrcaSlicer installed): the
  primary costing source per §4.
- **C — G-code** (always): independent extrusion total used to cross-check B.

`confidence_from_agreement` compares B and C and returns HIGH only when they
agree within tolerance. §4 forbids silently trusting one figure.

## Tests

```bash
.venv/Scripts/python -m pytest
```

Geometry is asserted against primitives with known answers — a 20×30×40 mm box
is exactly 24 cm³ — because a mm³/cm³ mix-up is the most likely way this code
goes wrong, and it would flow straight into pricing.
