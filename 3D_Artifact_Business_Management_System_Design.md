# CrafCube Nexus: 3D Artifact Business Management System
## Smart Inventory, Production, Costing, Pricing & Finance Platform

**Project type:** Multi-user, self-hosted 3D-print business management system  
**Primary printer:** Anycubic Kobra X  
**Desktop client:** Electron  
**Local processing:** Python + slicer engine  
**Central data:** PostgreSQL / Supabase  
**Object storage:** Cloudflare R2  
**Document status:** System design / implementation blueprint  
**Date:** 2026-09-05

---

# 1. Executive Summary

The system should not be designed as a normal inventory or POS application.

The core idea is:

> **A 3D-printing ERP where a model file becomes a measurable production item.**

A user uploads an STL/3MF/OBJ/etc., selects the printer, filament(s), quality/profile and quantity, and the local processing engine determines:

- model dimensions
- printability warnings
- estimated/sliced print time
- filament usage in grams
- filament usage by spool/color/material
- purge/support/waste usage where available
- dynamic filament cost
- electricity cost
- machine-time cost
- labor/handling cost
- packaging cost
- failure/waste allowance
- total estimated production cost
- recommended selling price
- gross profit
- profit margin
- minimum viable price
- quantity economics
- inventory impact

After the job is actually printed, the system should record the actual result and learn from the difference between estimated and actual usage/time.

This creates a feedback loop:

**Model → Slice → Estimate → Price → Produce → Record Actual → Learn → Improve Future Estimates**

The application should therefore be built around five connected systems:

1. **Inventory**
2. **3D Model & Slicing Intelligence**
3. **Production / Print Jobs**
4. **Costing & Pricing**
5. **Finance & Business Analytics**

---

# 2. Important Printer-Specific Context

The correct printer name is **Anycubic Kobra X**.

Anycubic currently lists the Kobra X with:

- 260 × 260 × 260 mm print volume
- native 4-color capability
- expansion up to 19 colors
- recommended print speed of 300 mm/s
- maximum advertised speed of 600 mm/s
- standard 0.4 mm hardened-steel nozzle
- optional 0.25 / 0.6 / 0.8 mm nozzles
- maximum nozzle temperature of 300°C
- maximum bed temperature of 100°C
- PLA, PETG, TPU, PVA, PLA-CF, PETG-CF and ASA support
- filament detection/auto-resume
- AI spaghetti detection
- object skip and area leveling
- 720p camera
- Anycubic's Kobra OS

The system should therefore be designed for multi-material/multi-color printing from the beginning rather than assuming one filament per print.

Reference:
https://store.anycubic.com/products/kobra-x

---

# 3. Core Product Philosophy

## 3.1 Do not make the software a slicer

The application should integrate with the slicer instead of attempting to recreate a slicer.

The local engine should use:

- Anycubic Slicer Next when available
- OrcaSlicer-compatible processing as a fallback
- direct G-code analysis
- 3MF metadata analysis
- Python geometry analysis as a secondary layer

Anycubic Slicer Next is based on OrcaSlicer, and OrcaSlicer is based on Bambu Studio/PrusaSlicer lineage.

References:

https://github.com/ANYCUBIC-3D/AnycubicSlicerNext

https://github.com/OrcaSlicer/OrcaSlicer

https://store.anycubic.com/pages/firmware-software

This is important because the most accurate filament/time estimate comes from the same slicing pipeline that will eventually generate the print G-code.

---

# 4. Accuracy Strategy

A major requirement is:

> **Never pretend that geometry-only estimation is as accurate as a real slice.**

The system should have multiple analysis levels.

## Level A — Geometry Estimate

Used immediately after uploading an STL/OBJ/etc.

Python libraries such as:

- trimesh
- numpy
- scipy
- meshio

can calculate:

- bounding box
- dimensions
- triangle count
- mesh volume
- surface area
- manifold status
- holes/non-manifold edges
- approximate solid volume
- center of mass
- orientation candidates

This gives a quick estimate.

It is useful for:

- instant preview
- printability warnings
- rough pricing
- model cataloguing

It should NOT be treated as the final filament estimate.

---

## Level B — Slicer Estimate

The local engine invokes Anycubic Slicer Next / OrcaSlicer with the selected:

- printer
- nozzle
- filament
- process/quality profile
- supports
- infill
- wall count
- layer height
- speed
- brim/raft
- multi-color settings
- other relevant settings

The resulting slice provides much stronger information.

OrcaSlicer exposes variables including:

- total extruded volume
- extruded weight
- total print time
- layer count
- object count
- instance count

Reference:

https://github.com/OrcaSlicer/OrcaSlicer/wiki/Built-in-placeholders-variables

This should be the system's **primary costing source**.

---

## Level C — G-code Analysis

The application should parse the generated G-code.

This gives an independent verification layer.

For example, the system can calculate extrusion from E-axis movements and compare it against the slicer's reported filament usage.

Store both:

- `slicer_estimated_grams`
- `gcode_calculated_grams`

If they differ beyond a configurable tolerance, show:

> Estimate confidence: Medium

instead of silently trusting one number.

OctoPrint's data model demonstrates the usefulness of tracking estimated print time and filament length/volume at job level.

Reference:

https://docs.octoprint.org/en/main/api/datamodel.html

---

## Level D — Actual Production Data

After a print is completed, record:

- actual print duration
- actual filament consumed if weighed
- failed/successful
- failed quantity
- reason for failure
- operator
- printer
- filament spool
- actual energy usage if measured

The system can then calculate:

`actual / estimated`

and build a calibration factor.

Example:

```text
Estimated filament: 83.2 g
Actual measured usage: 86.5 g

Correction factor = 86.5 / 83.2
                  = 1.0397

Future estimate ≈ slicer estimate × 1.0397
```

This should eventually become printer/profile/filament-specific.

---

# 5. The Smart Analysis Pipeline

## Upload

User uploads:

- STL
- 3MF
- OBJ
- AMF
- optionally STEP/other formats later

The local agent creates a temporary workspace.

---

## Phase 1: File Validation

Check:

- extension
- file size
- corruption
- supported format
- duplicate file hash
- mesh validity
- units
- dimensions
- empty geometry
- extremely high triangle count

Generate:

```text
File Valid
Mesh Valid
Dimensions: 82 × 64 × 110 mm
Volume: 41.8 cm³
Triangles: 86,241
```

---

## Phase 2: Geometry Intelligence

Run:

- bounding-box analysis
- volume calculation
- surface area
- wall/thickness heuristics
- overhang analysis
- manifold analysis
- center of mass
- bed-fit check
- orientation suggestions

Possible warnings:

```text
⚠ Model exceeds Kobra X build volume in current orientation.

⚠ 47% of the surface contains overhangs above 55°.

⚠ Thin wall detected around 0.55 mm.

✓ Model fits the build plate after rotation.

✓ Estimated support requirement: Low.
```

These are advisory warnings, not guaranteed print predictions.

---

## Phase 3: Slicing

Use the selected profile.

Example:

```text
Printer: Anycubic Kobra X
Nozzle: 0.4 mm
Material: PLA
Layer Height: 0.20 mm
Infill: 15%
Walls: 3
Supports: Auto
Brim: Off
```

Generate:

- G-code
- sliced 3MF where supported
- slicer metadata
- preview metadata

---

## Phase 4: Cost Analysis

Calculate:

### Filament

```text
filament_cost =
    estimated_grams × current_cost_per_gram
```

For multiple materials:

```text
filament_cost =
    Σ(material_i_grams × material_i_cost_per_gram)
```

Include purge/wipe/tower waste where the slicer reports it.

---

# 6. Filament Inventory System

Every spool should be an individual inventory item.

Do not only store:

```text
PLA Black = 4.2 kg
```

Instead store:

```text
Spool #PLA-BLK-001
Brand: eSUN
Material: PLA+
Color: Black
Initial weight: 1000 g
Current remaining: 734 g
Purchase cost: ৳1,450
Cost per gram: ৳1.45
Diameter: 1.75 mm
Density: 1.24 g/cm³
Purchase date: ...
Supplier: ...
Lot/Batch: ...
```

This makes costing and inventory auditing much more reliable.

---

# 7. Filament Data Model

Each filament should have:

### Material Definition

- PLA
- PLA+
- PETG
- TPU
- ABS
- ASA
- PVA
- PLA-CF
- PETG-CF
- etc.

### Physical Properties

- density
- nominal diameter
- recommended temperature range
- nozzle temperature
- bed temperature
- drying requirements
- shrinkage
- manufacturer
- brand

OrcaSlicer itself tracks properties such as type, vendor, diameter, density and price.

Reference:

https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_basic_information

### Commercial Properties

- purchase price
- purchase quantity
- shipping cost
- tax
- effective cost
- current cost/gram
- supplier
- currency
- purchase date

---

# 8. Cost Per Gram

Use the actual landed cost.

```text
landed_cost =
    product_cost
    + shipping
    + tax
    + import/other fees
```

Then:

```text
cost_per_gram =
    landed_cost / usable_filament_weight
```

For example:

```text
Spool:
Product = ৳1,200
Shipping = ৳100
Tax/other = ৳50
Usable filament = 1,000 g

Landed cost = ৳1,350

Cost/g = ৳1.35
```

Do not use the original purchase price forever.

Every new spool can have a different effective cost.

---

# 9. Inventory Valuation

Support multiple valuation modes:

### Actual Spool Cost

Each print uses the actual spool selected.

### Weighted Average

Useful for accounting-style inventory reporting.

```text
average_cost =
    total_inventory_value / total_inventory_weight
```

### FIFO

Optional later.

For a small 3D-print business, actual spool cost + weighted average reporting is probably sufficient initially.

---

# 10. Dynamic Filament Deduction

When a production job is created:

```text
Required:

Black PLA = 83 g
White PLA = 17 g
```

The system checks inventory.

If:

```text
Black spool A = 100 g
White spool B = 35 g
```

it can reserve:

```text
A: 83 g
B: 17 g
```

Inventory should first move into:

```text
AVAILABLE
    ↓
RESERVED
    ↓
CONSUMED
```

If the job is cancelled:

```text
RESERVED
    ↓
AVAILABLE
```

If the print fails after consuming filament:

```text
CONSUMED
```

and the failed material becomes:

```text
WASTE
```

This is much better than simply subtracting grams when the user presses "Print."

---

# 11. Low Stock Intelligence

Create configurable thresholds.

Example:

```text
Black PLA
Current: 182 g
Warning: 300 g
Critical: 100 g
```

Notifications:

```text
⚠ Black PLA is low.

182 g remaining.

Estimated remaining production:
2 standard prints
```

Even better:

Calculate projected depletion:

```text
average_daily_usage = 240 g/day
current_stock = 182 g

estimated_days_remaining ≈ 0.76 days
```

Then:

> Black PLA may run out within 1 day.

---

# 12. Smart Reorder Recommendation

Do not only say "low stock."

Use:

- average consumption
- pending jobs
- forecasted demand
- supplier lead time
- minimum safety stock
- current price
- preferred supplier

Example:

```text
Black PLA

Current: 620 g
Reserved: 210 g
Average weekly usage: 1.8 kg
Supplier lead time: 5 days
Safety stock: 500 g

Recommendation:
Order 3 kg within the next 2 days.
```

---

# 13. Model Library

Every model becomes a reusable product/model record.

Example:

```text
Model:
Dragon Statue

Category:
Decor

Source:
AI Generated

Creator:
Bondhon

Version:
v3

Files:
dragon_v3.stl
dragon_v3.3mf
dragon_v3_preview.png

Dimensions:
95 × 82 × 130 mm

Recommended:
0.16 mm layer
15% infill
3 walls
PLA
```

---

# 14. Model Versioning

Never overwrite important production files.

Use:

```text
Dragon Statue
 ├── v1
 ├── v2
 ├── v3
 └── v4
```

Each version stores:

- source file
- hash
- notes
- creator
- creation date
- AI prompt if applicable
- generation tool
- modifications
- print tests
- success rate

This is particularly useful because the business may create models with AI/Python rather than traditional CAD.

---

# 15. AI/Python Model Metadata

Since models may be generated using Python and AI, add optional fields:

```text
generation_method:
    AI
    Python
    Manual
    Remix
    Purchased
    Customer supplied

generation_tool:
    trimesh
    OpenSCAD
    Meshy
    Tripo
    custom Python
    other

prompt:
    ...

source_reference:
    ...

license:
    Commercial
    Personal
    Unknown
    Restricted
```

This will become extremely valuable for commercial licensing and provenance.

---

# 16. 3MF Handling

3MF should be treated as a first-class format.

3MF is an XML/ZIP-based format designed to preserve richer 3D-printing information than simple mesh formats. The 3MF Consortium specification is now ISO/IEC 25422:2025.

Reference:

https://3mf.io/spec/

A 3MF project may contain:

- model geometry
- multiple objects
- materials
- build information
- metadata
- slicer settings
- print settings
- plate information

OrcaSlicer also supports exporting sliced G-code.3MF containing G-code plus printer/material/process information.

Reference:

https://github.com/OrcaSlicer/OrcaSlicer/wiki/import_export

Therefore the analyzer should inspect 3MF contents before blindly treating it as a normal STL.

---

# 17. Duplicate Detection

Calculate:

```text
SHA-256
```

for uploaded files.

If the same file is uploaded again:

```text
✓ Existing model found

Dragon Statue v3
Uploaded previously: 2026-09-01
```

For STL/mesh similarity, optionally add geometry fingerprints later.

---

# 18. Print Job System

A print job should be a real business transaction.

Example:

```text
Job #PR-2026-00182

Customer:
ABC

Product:
Dragon Statue v3

Quantity:
5

Printer:
Kobra X #1

Filament:
Black PLA
Gold PLA

Estimated time:
7h 42m

Estimated material:
421 g

Estimated cost:
৳812

Selling price:
৳1,650 × 5

Status:
QUEUED
```

---

# 19. Quantity-Aware Calculation

Do not simply multiply everything by quantity.

Some costs are per print/job.

Example:

```text
Filament:
৳120 × 5 = ৳600

Electricity:
৳18 × 5 = ৳90

Machine time:
৳50 × 5 = ৳250

Packaging:
৳30 × 5 = ৳150

Design setup:
৳100 × 1 = ৳100

Total:
৳1,190
```

But if five copies can be printed together on one plate, time may not equal 5×.

Therefore the system should support:

### Separate Jobs

5 separate prints.

### Batch / Plate

5 instances on one plate.

The slicer should determine the actual batch time/material usage.

---

# 20. Smart Quantity Optimizer

User enters:

```text
Quantity = 20
```

The system should optionally compare:

### Strategy A

1 object × 20 jobs

### Strategy B

4 objects × 5 plates

### Strategy C

10 objects × 2 plates

Then show:

| Strategy | Total Time | Material | Risk |
|---|---:|---:|---|
| 1 × 20 | 20h | 1.65kg | Low |
| 4 × 5 | 15h | 1.61kg | Medium |
| 10 × 2 | 13h | 1.60kg | Higher |

This can become one of the system's strongest smart features.

---

# 21. Electricity Cost

Electricity should not be calculated only from the printer's maximum rated power.

Create configurable power profiles.

Example:

```text
Printer:
Kobra X

Estimated average draw:
220 W

Idle:
40 W

Heating:
450 W
```

Better:

```text
Electricity rate:
৳12 / kWh
```

Then:

```text
energy_kwh =
    average_power_kw × print_hours

electricity_cost =
    energy_kwh × electricity_rate
```

Example:

```text
0.22 kW × 4 hours
= 0.88 kWh

0.88 × ৳12
= ৳10.56
```

For better accuracy later, install a smart energy meter and record actual consumption.

---

# 22. Machine Cost

Printer time has a business cost even when electricity is cheap.

Define:

```text
machine_hourly_rate
```

Example:

```text
Printer purchase:
৳45,000

Expected useful life:
3,000 hours

Depreciation:
৳15/hour
```

Then add:

- maintenance
- nozzle replacement
- bed replacement
- lubrication
- downtime allowance
- calibration
- repair reserve

Example:

```text
Machine cost/hour =
    depreciation
    + maintenance reserve
```

---

# 23. Labor Cost

Support:

```text
Design labor
Slicing/setup labor
Post-processing labor
Packaging labor
Customer service labor
```

Each can have:

```text
rate/hour
```

For example:

```text
Post-processing:
15 minutes
Labor rate:
৳200/hour

Cost:
৳50
```

---

# 24. Other Direct Costs

Support:

- glue
- tape
- nozzle wear
- build plate wear
- support material
- sanding
- primer
- paint
- magnets
- LEDs
- screws
- packaging
- labels
- delivery
- platform/payment fees

This turns the software into a real production-costing system.

---

# 25. Failure/Waste Cost

A print business cannot price using successful prints only.

Create:

```text
failure_rate
```

Example:

```text
Expected production cost:
৳300

Historical failure rate:
8%

Risk-adjusted cost:
৳300 × 1.08
= ৳324
```

A more advanced model can use failure rate by:

- printer
- material
- model
- layer height
- operator
- print duration
- temperature/profile

---

# 26. Recommended Price Engine

The pricing engine should produce several prices.

## Minimum Price

Covers direct cost.

```text
minimum_price =
    material
    + electricity
    + machine
    + direct labor
    + packaging
```

---

## Target Price

Uses target margin.

If cost = ৳300 and target margin = 40%:

```text
price =
    300 / (1 - 0.40)

= ৳500
```

Do NOT use:

```text
300 × 1.40
```

if the user means 40% margin.

That produces a 28.6% actual margin.

---

## Recommended Retail Price

Can include:

- target margin
- failure allowance
- design value
- complexity
- finishing
- demand
- personalization
- market position

Example:

```text
Production cost: ৳310

Target margin: 45%
Base price: ৳564

Complexity premium: ৳80
Finishing: ৳100

Recommended:
৳744

Suggested retail:
৳749
```

---

# 27. Price Range

Show:

```text
Cost floor:       ৳310
Wholesale price:  ৳450
Recommended:      ৳750
Premium:          ৳900
```

This is much more useful than showing one unexplained number.

---

# 28. Customer / Order System

Add customers with:

- name
- phone
- WhatsApp
- email
- address
- customer type
- notes
- order history
- lifetime value
- outstanding balance

Orders contain:

- products
- quantities
- price
- discount
- delivery
- payment
- production status
- fulfillment status

---

# 29. Product Catalog

Separate:

### Model

The underlying 3D asset.

### Product

The commercial item sold to customers.

For example:

```text
Model:
Dragon v3

Products:
Dragon - Black PLA
Dragon - Gold PLA
Dragon - Painted Premium
Dragon - Custom Name Edition
```

This prevents the 3D file and business product from becoming the same entity.

---

# 30. Finance Module

Track:

### Income

- product sales
- custom orders
- design fees
- delivery charges
- other income

### Expenses

- filament
- printer
- electricity
- maintenance
- tools
- packaging
- delivery
- software
- hosting
- advertising
- labor
- refunds

### Transactions

Every financial transaction should have:

```text
date
type
category
amount
currency
reference
customer/supplier
related order/job
created_by
notes
```

---

# 31. Profit & Loss

Dashboard:

```text
Revenue             ৳85,400
COGS                ৳31,200
Gross Profit        ৳54,200

Operating Expenses  ৳17,500
Net Profit          ৳36,700

Gross Margin        63.5%
Net Margin          43.0%
```

Allow filtering by:

- date
- product
- model
- customer
- printer
- filament
- employee
- category

---

# 32. Printer Analytics

Per printer:

```text
Total print hours
Total jobs
Successful jobs
Failed jobs
Success rate
Filament consumed
Electricity estimate
Revenue generated
Profit generated
Average job duration
Average downtime
Maintenance cost
```

Example:

```text
Kobra X #1

Print hours: 142h
Jobs: 58
Success rate: 93.1%
Filament: 12.8 kg
Revenue: ৳62,400
Estimated profit: ৳31,800
```

---

# 33. Failure Analytics

This is especially important.

Track failure reasons:

- adhesion
- spaghetti
- layer shift
- under-extrusion
- nozzle clog
- filament issue
- warping
- support failure
- model issue
- operator error
- power failure
- unknown

Then show:

```text
Top failure cause:
Bed adhesion — 37%

Worst model:
Dragon v2 — 18% failure

Worst material:
Black PETG — 11% failure

Worst profile:
0.12mm Fine — 9% failure
```

---

# 34. Predictive Failure Risk

Later, build a local ML model.

Features:

- model volume
- height
- surface area
- overhang percentage
- support volume
- layer count
- print duration
- material
- printer
- nozzle
- temperature
- speed
- historical model failure rate

Output:

```text
Estimated print risk:
Low — 4.2%

Recommendation:
Safe to print.
```

or:

```text
Estimated print risk:
High — 21%

Reasons:
• 8.4h print
• narrow contact area
• high support requirement
• previous failures with this model
```

This should remain advisory rather than blocking the operator.

---

# 35. Print Queue

Queue should support:

```text
QUEUED
SCHEDULED
PREPARING
PRINTING
PAUSED
COMPLETED
FAILED
CANCELLED
```

Each printer has its own queue.

Smart scheduling can consider:

- deadline
- print duration
- material availability
- printer compatibility
- current filament
- color changes
- batch opportunities
- failure risk

---

# 36. Multi-Printer Support

Do not hard-code Kobra X.

Create a printer registry:

```text
Printer
 ├── brand
 ├── model
 ├── serial/name
 ├── build volume
 ├── nozzle
 ├── supported materials
 ├── hourly machine cost
 ├── power profile
 ├── slicer profile
 └── status
```

Later you can add:

- Bambu
- Creality
- Prusa
- Elegoo
- Anycubic
- custom machines

---

# 37. Local Processing Architecture

Recommended architecture:

```text
                    CENTRAL SERVER
             ┌────────────────────────┐
             │ Supabase / PostgreSQL  │
             │ Auth                   │
             │ RLS                    │
             │ Realtime               │
             └───────────┬────────────┘
                         │
                  Cloudflare R2
                  Model/File Storage
                         │
             ┌───────────┴────────────┐
             │                        │
        Desktop PC A             Desktop PC B
        Electron App             Electron App
             │                        │
        Local Agent               Local Agent
             │                        │
      ┌──────┴───────┐         ┌─────┴──────┐
      │ Python       │         │ Python      │
      │ Analyzer     │         │ Analyzer    │
      │ trimesh      │         │ trimesh     │
      │ G-code       │         │ G-code      │
      │ 3MF          │         │ 3MF         │
      │ Slicer CLI   │         │ Slicer CLI  │
      └──────────────┘         └─────────────┘
```

The central server stores business truth.

The local computer performs expensive/OS-dependent processing.

---

# 38. Why Local Processing Is the Correct Choice

3D slicing can be CPU intensive.

There is no reason to upload every raw model to a remote processing server just to calculate:

- geometry
- slicing
- previews
- G-code analysis

Local processing gives:

- privacy
- speed
- no server CPU cost
- offline capability
- easier AI/Python integration
- access to installed slicers
- better control of proprietary models

Only necessary results should synchronize to the central server.

---

# 39. Electron Application

Recommended responsibilities:

### Electron Main Process

- application lifecycle
- local filesystem
- secure IPC
- local agent lifecycle
- OS notifications
- printer/local integration

### Renderer

Use:

- React
- TypeScript
- Tailwind
- component library

### Local Agent

Prefer a separate Python process:

```text
FastAPI / local HTTP
localhost:PORT
```

Electron communicates with:

```text
Electron
    ↓
localhost API
    ↓
Python worker
    ↓
trimesh
    ↓
slicer
    ↓
G-code parser
    ↓
analysis JSON
```

Do not put all Python logic directly inside Electron.

---

# 40. Local Agent API

Example:

```http
POST /analyze
POST /slice
POST /parse-gcode
POST /analyze-3mf
POST /validate-mesh
POST /generate-preview
GET  /capabilities
GET  /status
```

Example response:

```json
{
  "status": "success",
  "geometry": {
    "width_mm": 82.4,
    "depth_mm": 63.1,
    "height_mm": 109.7,
    "volume_cm3": 41.8
  },
  "slice": {
    "print_time_seconds": 12480,
    "filament_grams": 83.2,
    "layers": 548
  },
  "confidence": "high"
}
```

---

# 41. Slicer Integration Strategy

Preferred hierarchy:

```text
1. Anycubic Slicer Next
2. OrcaSlicer
3. Existing sliced 3MF/G-code metadata
4. G-code parser
5. Geometry-only estimate
```

Anycubic Slicer Next is open source and based on OrcaSlicer.

OrcaSlicer supports command-line slicing workflows and loading printer/process/filament settings, although CLI compatibility should be tested against the exact versions used in production.

Useful CLI references:

https://github.com/OrcaSlicer/OrcaSlicer/wiki/

https://github.com/OrcaSlicer/OrcaSlicer/discussions/1603

Important:

**Pin the slicer version used by the application.**

Do not let automatic slicer updates silently change business costing.

---

# 42. Slicer Profile Registry

The system should maintain:

```text
Slicer Version
Printer Profile
Process Profile
Filament Profile
Nozzle
Profile Hash
```

Example:

```text
Anycubic Slicer Next
v1.x.x

Printer:
Kobra X 0.4

Process:
0.20 Standard

Filament:
Generic PLA

Profile hash:
abc123...
```

When a calculation is performed, save these IDs.

This makes old cost estimates reproducible.

---

# 43. Estimate Reproducibility

Every estimate should be traceable.

Example:

```text
Estimate #EST-00182

Model hash:
a82f...

Slicer:
Anycubic Slicer Next x.x

Printer:
Kobra X #1

Nozzle:
0.4mm

Filament:
PLA Black / Spool #42

Process:
0.20 Standard

Quantity:
4

Generated:
2026-09-05 23:20
```

If the result is questioned later, the business can reproduce the calculation.

---

# 44. Storage Architecture

Use:

### PostgreSQL

For:

- users
- organizations
- roles
- models
- products
- filament
- spools
- printers
- jobs
- orders
- customers
- transactions
- estimates
- analytics

### Cloudflare R2

For:

- STL
- 3MF
- OBJ
- G-code
- thumbnails
- renders
- reports
- backups/archives

Cloudflare R2 currently provides S3-compatible object storage and free internet egress. Its current standard-storage free tier includes 10 GB-month storage, 1 million Class A requests and 10 million Class B requests per month.

Reference:

https://developers.cloudflare.com/r2/pricing/

---

# 45. Supabase Recommendation

Supabase is a good fit for:

- PostgreSQL
- authentication
- Row Level Security
- realtime events
- API
- database tooling

Self-hosted Supabase can be deployed with Docker.

However, self-hosted Supabase has operational responsibilities such as:

- server maintenance
- backups
- security
- updates
- monitoring
- disaster recovery

Reference:

https://supabase.com/docs/guides/self-hosting

Important architecture recommendation:

> Treat Supabase as the database/backend platform, not as the desktop processing engine.

---

# 46. Multi-Tenant Database Design

Use an explicit:

```text
organization_id
```

on business tables.

Example:

```text
organizations
users
organization_members
printers
filament_spools
models
products
orders
print_jobs
transactions
```

Every tenant-owned record must have an organization ID.

Use PostgreSQL RLS so users cannot access another organization's data.

---

# 47. Roles

Recommended roles:

### Owner

Everything.

### Admin

Business + users + inventory + finance.

### Production Manager

Print jobs + inventory + printers.

### Operator

Print execution + job updates.

### Finance

Finance + reports, no production configuration.

### Sales

Customers + orders + pricing.

### Viewer

Read-only.

---

# 48. Audit Log

Every important action should be logged.

Example:

```text
2026-09-05 20:32

User: operator01

Action:
Adjusted spool inventory

Before:
734 g

After:
701 g

Reason:
Manual weight measurement

IP/device:
...
```

Log:

- price changes
- inventory adjustments
- deleted records
- job status changes
- finance transactions
- user permission changes
- spool consumption
- refunds

Never allow critical financial/inventory history to disappear silently.

---

# 49. Database Entities

Core tables:

```text
organizations
organization_members
roles
users

printers
printer_profiles
printer_maintenance

materials
filament_brands
filament_products
filament_spools
filament_transactions

models
model_versions
model_files
model_analysis
model_licenses

products
product_variants
product_pricing

customers
orders
order_items
payments

print_jobs
print_job_items
print_job_materials
print_job_events
print_job_results

slicer_profiles
slicer_runs
slicer_results

cost_profiles
price_rules

expenses
income
transactions

inventory_adjustments
stock_reservations

notifications
audit_logs

reports
```

---

# 50. Inventory Ledger

Avoid storing only:

```text
remaining_grams = 723
```

Use a transaction ledger.

Example:

```text
Spool #42

+1000 g Purchase
-83 g Job #182
-17 g Job #183
+5 g Adjustment
-4 g Waste

Calculated balance:
901 g
```

The ledger is the source of truth.

A cached `remaining_grams` field can exist for speed, but it should be derived/reconciled from transactions.

---

# 51. Inventory Transaction Types

```text
PURCHASE
CONSUMPTION
RESERVATION
RESERVATION_RELEASE
WASTE
RETURN
ADJUSTMENT
TRANSFER
SAMPLE
DRYING_LOSS
```

This gives a complete material history.

---

# 52. Filament Waste

Track waste separately.

Examples:

- purge tower
- purge line
- support
- failed print
- trimming
- nozzle purge
- calibration
- test print

Then the dashboard can show:

```text
Filament purchased: 20.0 kg
Useful product usage: 15.8 kg
Waste: 2.1 kg
Unaccounted: 2.1 kg
```

That is extremely valuable for improving profitability.

---

# 53. Smart Waste Analytics

Example:

```text
Monthly filament:
5.8 kg

Product:
4.9 kg
Support:
0.4 kg
Purging:
0.3 kg
Failures:
0.2 kg
```

Then show:

> 12.1% of filament is currently being consumed outside finished products.

For multi-color Kobra X jobs, purge waste should be explicitly modeled where slicer data makes it available.

Anycubic currently markets Kobra X/ACE GEN2 as reducing color-change waste, making this a particularly useful KPI for this printer.

Reference:

https://store.anycubic.com/products/kobra-x

---

# 54. Maintenance Management

Each printer gets a maintenance schedule.

Examples:

```text
Nozzle inspection:
Every 300 hours

Bed inspection:
Every 100 hours

Lubrication:
Every 100 hours

Full calibration:
Every 500 hours
```

Track:

- maintenance date
- machine hours
- technician
- cost
- parts used
- notes

Generate alerts:

> Kobra X #1 has reached 292/300 hours since nozzle inspection.

---

# 55. Consumables Inventory

Beyond filament:

- nozzles
- build plates
- PTFE tubes
- lubricant
- glue
- cleaning tools
- sandpaper
- paint
- magnets
- packaging

Each should support:

```text
stock
minimum stock
unit cost
supplier
usage rate
```

---

# 56. Smart Business Dashboard

The home screen should answer:

### Today

```text
Sales
Profit
Orders
Print hours
Filament consumed
Failed jobs
```

### Current

```text
Printers:
1 Printing
0 Paused
1 Idle

Filament:
3 Low
1 Critical

Orders:
4 Pending
2 In Production
3 Ready
```

### Forecast

```text
Expected revenue this week
Expected filament consumption
Potential stockouts
Upcoming deadlines
```

---

# 57. Product Profitability

For every product:

```text
Dragon Statue

Sales:
42

Revenue:
৳31,500

Material:
৳6,800

Machine:
৳4,200

Electricity:
৳850

Labor:
৳2,100

Packaging:
৳900

Failure reserve:
৳1,200

Gross profit:
৳15,450

Margin:
49.0%
```

This tells you which products are actually worth producing.

---

# 58. Customer Profitability

A customer can have:

```text
Revenue
COGS
Discounts
Delivery cost
Payment fees
Profit
```

This allows:

> Customer A generates high revenue but low profit.

---

# 59. Pricing Experiments

Store price history.

Example:

```text
Dragon Statue

2026-08:
৳650

2026-09:
৳750
```

Track:

```text
sales volume
profit
conversion
```

Later the system can suggest:

> Price increase from ৳650 → ৳750 increased gross profit per unit by 22% with only 4% volume decline.

---

# 60. Sales Channels

Support:

```text
Facebook
Instagram
Website
WhatsApp
Marketplace
Physical Store
Custom Order
Other
```

Each order stores the channel.

Then report:

```text
Facebook:
Revenue ৳42k
Margin 51%

Website:
Revenue ৳27k
Margin 62%

Custom:
Revenue ৳18k
Margin 71%
```

---

# 61. Quotation System

Customer asks:

> Can you make 10 pieces?

Sales user enters:

```text
Model
Material
Color
Quantity
Finish
Deadline
```

System produces:

```text
Production cost:
৳2,850

Recommended:
৳4,900

Wholesale:
৳4,250

Expected profit:
৳2,050
```

Quotation can become an order without re-entering data.

---

# 62. Custom Product Requests

For customer-supplied models:

```text
Customer model
        ↓
Upload
        ↓
Analyzer
        ↓
Printability report
        ↓
Cost estimate
        ↓
Quotation
```

This can become a major business workflow.

---

# 63. Design Fee

Separate:

```text
Printing price
Design/modelling price
```

For example:

```text
Print:
৳700

Custom modification:
৳500

Painting:
৳300

Total:
৳1,500
```

This is important because design work may be far more valuable than filament.

---

# 64. AI-Assisted Pricing

Later, allow:

> "Price this model."

The AI receives structured facts:

```text
Material cost
Print time
Machine cost
Labor
Complexity
Historical sales
Similar products
Customer type
Target margin
```

It should never invent costs.

AI only recommends.

The deterministic pricing engine remains the source of truth.

---

# 65. AI Assistant

Add an optional business assistant.

Examples:

> "Which filament will run out first?"

> "What were my top 5 products last month?"

> "Which printer is most profitable?"

> "Why did profit fall this month?"

> "How much Black PLA should I order?"

> "Which jobs should I print tomorrow?"

The assistant should query structured database data rather than hallucinating.

---

# 66. Inventory Forecasting

Use historical consumption.

Simple model first:

```text
7-day average
30-day average
90-day average
```

Later:

- exponential smoothing
- seasonal trends
- order pipeline
- demand forecast

Output:

```text
Black PLA

Current:
1.2 kg

Reserved:
0.4 kg

Forecast consumption:
2.3 kg next 14 days

Recommended purchase:
3 kg
```

---

# 67. Model Recommendation Engine

When a customer selects a material:

```text
PLA
```

show:

```text
Recommended models:
✓ Dragon
✓ Skull
✓ Vase

Avoid:
⚠ Large thin sculpture
```

Based on:

- historical success
- material compatibility
- size
- print time
- failure rate

---

# 68. Automated Reports

Generate:

### Daily

- sales
- production
- filament usage
- failures

### Weekly

- profit
- inventory
- printer utilization
- top products
- waste

### Monthly

- P&L
- COGS
- inventory valuation
- product profitability
- customer profitability
- machine ROI
- material waste

Export:

- PDF
- CSV
- XLSX

---

# 69. Important KPIs

Track:

```text
Revenue
Gross profit
Net profit
Gross margin
Print hours
Printer utilization
Failure rate
Filament consumption
Filament waste
Average order value
Average production cost
Average selling price
Profit per machine hour
Profit per gram
Revenue per machine hour
```

Two particularly useful metrics:

## Profit per machine hour

```text
profit / print_hours
```

## Profit per gram

```text
profit / filament_grams
```

These help identify the most efficient products.

---

# 70. Printer Utilization

Example:

```text
Available:
24h/day

Printing:
18h

Maintenance:
1h

Idle:
5h

Utilization:
75%
```

For multiple printers, compare utilization.

---

# 71. Break-Even Analysis

For each printer:

```text
Printer investment:
৳50,000

Average contribution per print:
৳400

Break-even:
125 prints
```

Better:

```text
Initial investment
+ accessories
+ setup
+ expected maintenance
```

Then compare against cumulative machine profit.

---

# 72. Machine ROI

Track:

```text
purchase cost
running cost
revenue attributable
profit attributable
hours
```

Example:

```text
Kobra X #1

Investment:
৳50,000

Profit generated:
৳37,500

ROI:
75%

Remaining:
৳12,500
```

---

# 73. Local-First / Offline Mode

The desktop application should continue working when the internet is unavailable for:

- model analysis
- slicing
- local inventory cache
- print queue
- local job recording

When connection returns:

```text
Local changes
     ↓
Sync Queue
     ↓
Central Server
```

Use an event/outbox pattern.

---

# 74. Sync Strategy

Each local mutation creates:

```text
sync_event
```

Example:

```json
{
  "event_id": "...",
  "entity": "print_job",
  "entity_id": "...",
  "operation": "UPDATE",
  "version": 7,
  "timestamp": "...",
  "device_id": "PC-01"
}
```

Server acknowledges events.

This prevents data loss during temporary internet failures.

---

# 75. Conflict Resolution

For critical data, never blindly use "last write wins."

Examples:

### Inventory

Use ledger events.

### Finance

Use immutable transactions.

### Print Job

Use state transition rules.

### Model Metadata

Use versioning.

This minimizes synchronization conflicts.

---

# 76. Security

Desktop application must not contain:

- database service keys
- R2 master credentials
- Supabase service-role credentials

Use:

```text
authenticated user
      ↓
short-lived access token
      ↓
API/database
```

RLS should enforce tenant isolation.

---

# 77. R2 File Security

Files should not be permanently public.

Use:

- private buckets
- signed URLs
- authenticated downloads
- file ownership checks
- organization-level access control

Example:

```text
organization/
  models/
  gcode/
  reports/
  thumbnails/
```

But the actual authorization should be database-driven.

---

# 78. File Deduplication

Object storage should use content hashes.

Example:

```text
sha256:
b5e2...
```

If two users upload the same file inside the same organization:

```text
Do not upload twice.
```

Keep separate database references if necessary.

---

# 79. Thumbnail Generation

After upload:

```text
STL/3MF
   ↓
Local renderer
   ↓
PNG/WebP thumbnail
   ↓
R2
```

Model cards should show the image automatically.

Later generate:

- isometric
- front
- side
- top
- wireframe

---

# 80. 3D Preview

Electron should provide a WebGL preview.

Possible stack:

- Three.js
- React Three Fiber

Features:

- rotate
- zoom
- dimensions
- wireframe
- bounding box
- bed preview
- color/material preview
- multi-object visibility

This makes the app feel like a 3D production tool rather than generic ERP software.

---

# 81. Analysis Result UI

Example:

```text
┌───────────────────────────────────────────┐
│ Dragon Statue v3                          │
├───────────────────────────────────────────┤
│ Dimensions       82 × 63 × 110 mm         │
│ Volume           41.8 cm³                 │
│                                            │
│ Sliced Time      3h 27m                   │
│ Filament         83.2 g                   │
│ Support          11.3 g                   │
│ Waste            4.8 g                    │
│                                            │
│ Material Cost    ৳118                     │
│ Electricity      ৳10                      │
│ Machine          ৳72                      │
│ Labor            ৳25                      │
│ Risk Reserve     ৳12                      │
│                                            │
│ Total Cost       ৳237                     │
│ Recommended     ৳449–৳549                │
│                                            │
│ Confidence       HIGH                     │
└───────────────────────────────────────────┘
```

---

# 82. Confidence Score

Every analysis should have:

```text
HIGH
MEDIUM
LOW
```

Based on:

### HIGH

- actual slicer result
- known printer
- known filament
- exact profile
- valid G-code

### MEDIUM

- slicer metadata partially available
- geometry validated
- profile incomplete

### LOW

- geometry-only estimate
- unknown material
- unknown printer
- invalid/incomplete metadata

This is a critical UX feature because it prevents false precision.

---

# 83. Estimate vs Actual Dashboard

For every job:

```text
                 Estimated    Actual

Time             3h 42m       3h 51m
Filament         96g          101g
Electricity      ৳11          ৳12
Cost             ৳255         ৳273
```

Then:

```text
Time error: +4.1%
Material error: +5.2%
Cost error: +7.1%
```

This is the foundation for improving the system.

---

# 84. Calibration Engine

Store historical correction factors.

Example:

```text
Kobra X #1
PLA
0.4mm
0.20mm Standard

Historical filament error:
+3.8%

Historical time error:
+2.4%
```

Future estimate:

```text
adjusted_filament =
    slicer_filament × 1.038

adjusted_time =
    slicer_time × 1.024
```

Make these corrections configurable and reversible.

---

# 85. Don't Over-Automate Too Early

The first version should not attempt:

- full autonomous pricing AI
- predictive failure ML
- automatic CAD repair
- automatic customer pricing based on market scraping
- printer firmware automation
- complex accounting compliance

First establish accurate:

**Inventory → Slicing → Cost → Job → Finance**

Then build intelligence on top of clean data.

---

# 86. MVP Scope

## Phase 1 — Foundation

### Authentication

- login
- organization
- roles

### Inventory

- materials
- filament products
- spools
- transactions

### Models

- upload
- model library
- file storage
- thumbnails
- metadata

### Printers

- printer registry
- Kobra X profile
- nozzle/profile configuration

---

# 87. MVP Phase 2 — Smart Analyzer

Implement:

- STL analysis
- 3MF inspection
- mesh validation
- dimensions
- volume
- preview
- Anycubic/Orca slicing
- G-code parsing
- filament usage
- print time
- slicer profile tracking

This is the technical heart of the application.

---

# 88. MVP Phase 3 — Costing

Implement:

- dynamic filament cost
- electricity cost
- machine cost
- labor
- packaging
- waste
- failure reserve
- target margin
- recommended price
- quantity calculation

---

# 89. MVP Phase 4 — Production

Implement:

- print jobs
- queue
- reservation
- consumption
- waste
- completion
- failure
- actual vs estimated

---

# 90. MVP Phase 5 — Finance

Implement:

- customers
- orders
- payments
- income
- expenses
- P&L
- product profitability

---

# 91. Phase 6 — Intelligence

Add:

- reorder prediction
- failure prediction
- price suggestions
- quantity optimization
- batch optimization
- printer scheduling
- AI business assistant

---

# 92. Recommended Tech Stack

## Desktop

```text
Electron
React
TypeScript
Vite
Tailwind CSS
React Three Fiber / Three.js
```

## Local processing

```text
Python
FastAPI
trimesh
numpy
scipy
meshio
lxml
zipfile
custom G-code parser
```

## Slicing

```text
Anycubic Slicer Next
OrcaSlicer fallback
```

## Backend

```text
Supabase
PostgreSQL
Supabase Auth
Supabase Realtime
RLS
```

## Object Storage

```text
Cloudflare R2
S3-compatible API
```

## Optional

```text
Redis
Celery/RQ
Sentry
Prometheus
Grafana
```

Avoid adding Redis/Celery initially unless background workload requires it.

---

# 93. Suggested Repository Structure

```text
3d-business-system/

├── apps/
│   ├── desktop/
│   │   ├── electron/
│   │   ├── renderer/
│   │   └── shared/
│   │
│   └── web-admin/
│
├── services/
│   └── local-engine/
│       ├── api/
│       ├── geometry/
│       ├── slicer/
│       ├── gcode/
│       ├── three_mf/
│       ├── costing/
│       └── workers/
│
├── packages/
│   ├── types/
│   ├── ui/
│   └── pricing/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── seed/
│
├── infrastructure/
│   ├── docker/
│   └── backups/
│
└── docs/
```

---

# 94. Suggested Python Service Structure

```text
local-engine/

app/
├── main.py
├── config.py

api/
├── analysis.py
├── slicing.py
├── files.py
└── system.py

geometry/
├── mesh_validator.py
├── dimensions.py
├── volume.py
├── overhang.py
└── orientation.py

three_mf/
├── reader.py
├── metadata.py
└── extractor.py

slicer/
├── base.py
├── anycubic.py
├── orca.py
└── profiles.py

gcode/
├── parser.py
├── extrusion.py
├── time.py
└── metadata.py

costing/
├── filament.py
├── electricity.py
├── machine.py
├── labor.py
├── pricing.py
└── confidence.py
```

---

# 95. Core Costing Formula

Recommended structure:

```text
material_cost
+
electricity_cost
+
machine_cost
+
labor_cost
+
consumables_cost
+
packaging_cost
+
delivery_cost
+
payment/platform_fee
+
failure_reserve
=
true_cost
```

Then:

```text
target_price =
    true_cost / (1 - target_margin)
```

Then optionally:

```text
final_price =
    target_price
    + complexity_premium
    + customization_fee
    + finishing_fee
```

Finally apply commercial rounding:

```text
৳473 → ৳499
```

---

# 96. Price Rule Engine

Allow users to define rules.

Example:

```text
IF print_time > 8h
THEN add 10%

IF model_height > 180mm
THEN add ৳100

IF multi_color = true
THEN add color_change_fee

IF customer_type = wholesale
THEN margin = 25%

IF quantity >= 10
THEN discount = 8%
```

Rules should be visible and editable.

Never hide pricing logic inside AI.

---

# 97. Cost Profiles

Create configurable profiles:

```text
Standard Retail
Wholesale
Custom Order
Premium
Internal
```

Each has:

- target margin
- labor rate
- failure reserve
- machine rate
- packaging
- minimum price
- rounding rules

This allows different pricing without changing the underlying cost.

---

# 98. Smart Notifications

Examples:

```text
🔴 Black PLA critically low.

🟡 Kobra X #1 maintenance due in 8 hours.

🟡 Order #182 deadline tomorrow.

🔴 Print job #182 failed.

🟢 Spool #43 newly received.

🟡 Product Dragon margin fell below 30%.

🔴 Customer order has no available material.

🟢 5-unit batch can save approximately 3.2 hours.
```

---

# 99. Mobile/Remote Dashboard

Even if the main product is Electron, the backend should support a web dashboard.

This allows the owner to check:

- printer status
- active jobs
- orders
- inventory
- sales
- alerts

from a phone.

The web dashboard does not need to perform local slicing.

---

# 100. Printer Integration — Later

Kobra X currently supports intelligent remote printing through the Anycubic ecosystem.

Do not make direct printer control part of MVP.

First build:

```text
Prepare → Analyze → Cost → Queue
```

Later:

```text
Queue → Upload → Print → Monitor → Complete
```

Direct integration should be added only after stable APIs/protocols are confirmed for the exact printer firmware.

---

# 101. Business Intelligence

Eventually create a "Business Health" score:

```text
Profitability       82/100
Inventory health    74/100
Printer utilization 91/100
Waste efficiency    68/100
Order fulfillment   94/100
```

Then give actionable recommendations:

```text
Your biggest opportunity:

Reduce purge waste by approximately 8–12%.

Second:
Black PLA stockout risk in 4 days.

Third:
Dragon product generates 2.1× the profit/hour
of the Skull product.
```

---

# 102. Smart Daily Brief

Every morning:

```text
GOOD MORNING

Today:

4 orders need production.
2 printers available.
Black PLA is low.
One maintenance task is due.

Best production plan:
1. Order #182 — deadline 2 PM
2. Order #184 — batch with #182
3. Order #181 — overnight print

Expected production time:
11h 20m

Expected material:
1.42 kg

Expected revenue:
৳8,900

Expected profit:
৳4,120
```

This could eventually become the main reason to open the application every day.

---

# 103. Important Accounting Principle

Do not confuse:

```text
Price
Revenue
Cost
Profit
Cash
```

Example:

A customer pays ৳5,000.

That is:

```text
Revenue = ৳5,000
```

If actual production cost is ৳2,800:

```text
Gross profit = ৳2,200
```

If the customer has not paid yet:

```text
Accounts receivable = ৳5,000
```

Keep these concepts separate even if full accounting is not implemented initially.

---

# 104. Data Integrity Rules

Critical operations should be transactional.

Example:

Creating a print job must atomically:

1. create job
2. create material requirements
3. reserve available stock
4. create inventory ledger events
5. create costing snapshot

If step 4 fails, the whole transaction should roll back.

---

# 105. Immutable Cost Snapshot

When an order is accepted, store the calculated cost snapshot.

Do not dynamically recalculate historical orders whenever filament prices change.

Example:

```text
Order created:
Black PLA = ৳1.40/g

Order cost snapshot:
83g × ৳1.40 = ৳116.20
```

If the spool price later changes to ৳1.60/g, the old order still reports the original cost basis unless explicitly recalculated.

---

# 106. Same Principle for Pricing

Historical orders must preserve:

- sale price
- discount
- tax
- cost snapshot
- margin at time of sale

Current pricing rules should only affect new estimates/orders.

---

# 107. Backup Strategy

Back up:

### Database

Daily:

```text
PostgreSQL dump
```

### Object storage

R2 versioning/backup strategy.

### Configuration

- slicer profiles
- pricing rules
- printer settings

Keep at least:

```text
Daily × 7
Weekly × 4
Monthly × 12
```

For production deployment, test restoration rather than merely creating backups.

---

# 108. Observability

Track:

- local engine errors
- slicing failures
- upload failures
- sync failures
- database errors
- R2 errors
- analysis duration
- slicer duration

Example:

```text
Average analysis:
8.2 sec

Average slicing:
31.4 sec

Failed slicing:
2.1%

Sync errors:
0.2%
```

---

# 109. Performance Targets

Target:

### Upload

Immediate progress feedback.

### Geometry analysis

< 5 seconds for normal models.

### Slicing

Dependent on model/profile; show live progress.

### Dashboard

< 2 seconds for normal queries.

### Inventory

Real-time or near-real-time.

### Sync

Usually < 10 seconds after connectivity returns.

These are engineering targets, not guaranteed hardware limits.

---

# 110. Error Handling

Never show:

```text
Something went wrong.
```

Instead:

```text
Slicing failed.

Reason:
Printer profile is incompatible with the selected model.

Try:
Kobra X / 0.4mm / 0.20 Standard
```

Store the raw error for debugging.

---

# 111. Model Repair

Later integrate automatic mesh repair.

Possible workflow:

```text
Invalid STL
   ↓
Repair attempt
   ↓
Recalculate normals
   ↓
Fill holes
   ↓
Remove degenerate faces
   ↓
Validate
```

Always preserve the original.

Create:

```text
original.stl
repaired.stl
```

Never silently modify user files.

---

# 112. AI Model Quality Check

For AI-generated artifacts:

```text
AI model detected
```

Run:

- thin-wall check
- disconnected component check
- floating geometry
- non-manifold check
- overhang analysis
- base/contact analysis

Output:

```text
Printability score: 82/100
```

---

# 113. Licensing & Commercial Rights

Add license metadata.

Possible values:

```text
Original
Commercial license
Personal use only
CC0
CC-BY
CC-BY-NC
Unknown
Customer owned
```

If a model cannot legally be sold:

```text
⚠ Commercial-use restriction detected.
```

This should be a warning system, not a legal guarantee.

---

# 114. Recommended UI Navigation

```text
Dashboard

Production
 ├── Queue
 ├── Active Jobs
 ├── Completed
 └── Failed

Models
 ├── Library
 ├── Upload
 ├── Analysis
 └── Versions

Inventory
 ├── Filaments
 ├── Spools
 ├── Consumables
 ├── Low Stock
 └── Transactions

Printers
 ├── Machines
 ├── Status
 ├── Maintenance
 └── Profiles

Sales
 ├── Customers
 ├── Orders
 ├── Quotations
 └── Products

Finance
 ├── Transactions
 ├── Expenses
 ├── Revenue
 ├── P&L
 └── Reports

Analytics
 ├── Products
 ├── Printers
 ├── Materials
 ├── Waste
 └── Profitability

Settings
 ├── Organization
 ├── Users
 ├── Pricing
 ├── Cost Profiles
 ├── Slicer
 ├── Notifications
 └── Storage
```

---

# 115. First Screen: Smart Dashboard

The dashboard should not look like generic accounting software.

Top:

```text
৳12,450 Revenue
৳5,840 Profit
18.4h Printing
1.82kg Filament
94% Success
```

Middle:

```text
ACTIVE PRINTERS
Kobra X #1   Printing   72%
Kobra X #2   Idle

LOW STOCK
Black PLA    182g
White PLA    241g

TODAY'S JOBS
#182 Printing
#183 Queued
#184 Completed
```

Bottom:

```text
Profit by Product
Printer Utilization
Filament Consumption
Recent Orders
```

---

# 116. Recommended Development Order

## Sprint 1

- repository
- Electron shell
- React UI
- Supabase
- authentication
- organization/roles

## Sprint 2

- filament database
- spool inventory
- inventory ledger
- printer registry

## Sprint 3

- R2 integration
- model library
- upload
- thumbnails
- 3D viewer

## Sprint 4

- Python local engine
- trimesh
- mesh validation
- dimensions
- volume

## Sprint 5

- Anycubic/Orca slicer integration
- G-code parsing
- 3MF parsing
- slicing result storage

## Sprint 6

- costing engine
- dynamic filament pricing
- electricity
- machine cost
- labor
- pricing

## Sprint 7

- print jobs
- reservations
- consumption
- waste
- actual vs estimated

## Sprint 8

- customers
- quotations
- orders
- payments

## Sprint 9

- finance
- P&L
- reports
- analytics

## Sprint 10

- forecasting
- smart alerts
- batch optimization
- AI assistant

---

# 117. Acceptance Criteria for the Core Analyzer

The analyzer is considered production-ready when:

### Input

It accepts:

- STL
- 3MF

and gracefully rejects unsupported/corrupt files.

### Geometry

It correctly reports:

- dimensions
- volume
- mesh validity

### Slicing

It can produce a slice using:

```text
Kobra X
0.4mm nozzle
selected filament
selected process
```

### Output

It returns:

- print time
- filament grams
- material breakdown
- layer count
- slicer version
- profile IDs

### Cost

It calculates:

- material cost
- electricity
- machine
- labor
- waste
- total cost
- target price
- margin

### Inventory

A confirmed production job:

- reserves material
- consumes material when appropriate
- records waste on failure

### Audit

Every critical change is traceable.

---

# 118. Most Important Design Decision

The system should have two different concepts:

## Estimate

"What do we expect?"

## Actual

"What really happened?"

Never overwrite estimate with actual.

Store both.

This allows the system to become smarter over time.

---

# 119. The Long-Term Competitive Advantage

A generic inventory application can track:

```text
1000g PLA
```

A generic accounting application can track:

```text
৳5,000 sale
```

This system should know:

```text
Model: Dragon v3
Printer: Kobra X #1
Profile: 0.20 Standard
Filament: Black PLA, Spool #42

Estimated:
83.2g
3h 27m
Cost ৳237

Actual:
86.1g
3h 35m
Cost ৳246

Historical accuracy:
+3.5% material
+3.9% time

Recommended price:
৳449–৳549

Expected margin:
47–57%
```

That is the real product.

---

# 120. Final Recommended Architecture

```text
                         INTERNET
                            │
                  ┌─────────▼─────────┐
                  │ Cloudflare / HTTPS│
                  └─────────┬─────────┘
                            │
             ┌──────────────▼──────────────┐
             │       Self-hosted Supabase  │
             │                              │
             │ PostgreSQL                   │
             │ Auth                         │
             │ RLS                          │
             │ Realtime                     │
             │ API                          │
             └──────────────┬──────────────┘
                            │
                     ┌──────▼──────┐
                     │ Cloudflare  │
                     │ R2          │
                     │ Files       │
                     └─────────────┘

             ┌───────────────────────────────┐
             │             PC                 │
             │                                │
             │       Electron Application     │
             │       React + TypeScript       │
             │                                │
             │              │                 │
             │              ▼                 │
             │        Local Python API        │
             │              │                 │
             │      ┌───────┼────────┐        │
             │      ▼       ▼        ▼        │
             │   trimesh  3MF      G-code     │
             │             │        parser     │
             │             ▼                 │
             │      Anycubic/Orca Slicer      │
             │                                │
             └────────────────────────────────┘
```

---

# 121. Final Recommendation

Build this as a **3D Manufacturing Management System**, not a simple inventory app.

The architecture should be centered around:

```text
MODEL
  ↓
ANALYZE
  ↓
SLICE
  ↓
ESTIMATE
  ↓
PRICE
  ↓
RESERVE MATERIAL
  ↓
PRODUCE
  ↓
RECORD ACTUAL
  ↓
ACCOUNT
  ↓
LEARN
```

The first version should focus heavily on the **local slicing + costing + inventory engine**. That is the part that differentiates this system from ordinary inventory/POS software.

The most valuable future feature is the feedback loop:

```text
Estimated
    ↓
Actual
    ↓
Difference
    ↓
Calibration
    ↓
Better future estimates
```

If implemented correctly, after hundreds of print jobs the software should know much more about the business's real production economics than a generic ERP ever could.

---

# 122. Research References

1. Anycubic Kobra X — official product/specifications  
   https://store.anycubic.com/products/kobra-x

2. Anycubic Slicer Next — official GitHub repository  
   https://github.com/ANYCUBIC-3D/AnycubicSlicerNext

3. Anycubic software/firmware page  
   https://store.anycubic.com/pages/firmware-software

4. OrcaSlicer — official GitHub repository  
   https://github.com/OrcaSlicer/OrcaSlicer

5. OrcaSlicer built-in placeholders / print statistics  
   https://github.com/OrcaSlicer/OrcaSlicer/wiki/Built-in-placeholders-variables

6. OrcaSlicer material properties  
   https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_basic_information

7. OrcaSlicer import/export documentation  
   https://github.com/OrcaSlicer/OrcaSlicer/wiki/import_export

8. OrcaSlicer CLI discussion/documentation examples  
   https://github.com/OrcaSlicer/OrcaSlicer/discussions/1603

9. 3MF Consortium specification  
   https://3mf.io/spec/

10. 3MF Consortium main site  
    https://3mf.io/

11. OctoPrint job data model  
    https://docs.octoprint.org/en/main/api/datamodel.html

12. Supabase self-hosting  
    https://supabase.com/docs/guides/self-hosting

13. Supabase self-hosted Docker architecture  
    https://supabase.com/docs/guides/self-hosting/docker

14. Supabase self-hosted PostgreSQL access  
    https://supabase.com/docs/guides/self-hosting/accessing-postgres

15. Supabase self-hosted Storage  
    https://supabase.com/docs/reference/self-hosting-storage

16. Cloudflare R2 pricing  
    https://developers.cloudflare.com/r2/pricing/

---

# 123. Key Research Conclusions

- Kobra X is a multi-color/multi-material-capable printer, so the data model must support multiple filament requirements per print.
- Anycubic Slicer Next is based on OrcaSlicer, making the Orca/Anycubic slicing ecosystem a natural integration target.
- Slicer-derived filament weight and print time should be preferred over geometry-only guesses.
- G-code analysis should be used as a secondary verification layer.
- 3MF should be treated as a rich project format rather than simply another mesh file.
- Local processing is appropriate for slicing and geometry analysis.
- Supabase/PostgreSQL is appropriate for centralized multi-user business data.
- Cloudflare R2 is appropriate for large model/G-code/object storage.
- Inventory should be ledger-based rather than relying only on a mutable remaining-weight field.
- Historical estimate-vs-actual data should become the foundation for future calibration and predictive features.
- Slicer versions and profiles should be pinned and recorded for reproducible costing.
- Deterministic costing should remain the source of truth; AI should provide recommendations rather than inventing financial numbers.
