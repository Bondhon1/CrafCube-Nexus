# Phase 6 — Intelligence

Design doc §11-§12, §20, §32-§34, §53-§55, §66, §69-§72, §83-§84, §91, §98.

## The constraint that shaped this phase

§85 is blunt about what the first version must not attempt: autonomous pricing
AI, predictive-failure ML, market scraping, printer firmware automation. So
nothing in this phase learns anything. Every number is arithmetic over the
clean data phases 1-5 established, every formula is written down in the code
next to the section it comes from, and every result is advisory.

The second rule follows from the first: **where the data cannot support a
claim, say nothing.** Across this phase that means `null`, not `0`:

| Situation | What is shown | Why not a number |
|---|---|---|
| Printer has never finished a job | no success rate | 100% of nothing is not 100% |
| No filament used in 30 days | no depletion forecast | dividing by invented usage is how a forecast starts lying |
| No purchase cost recorded | no ROI | "∞% ROI" is worse than a dash |
| No print hours this month | no profit-per-hour | dividing by almost nothing produces a huge, meaningless figure |
| Fewer than 3 completed jobs | no calibration factor | one unusual print would be baked into every future estimate |
| Fewer than 5 finished jobs | risk band `unknown` | a failure rate from two prints is noise wearing a percentage sign |
| No threshold ever set | stock level `unknown` | nobody has said what "enough" means, so "healthy" is unsupported |

That last row changed an existing function: `stockLevel` used to return `ok`
for a product with no thresholds, which quietly asserted something nobody had
decided. It now returns `unknown`, and the dashboard's attention list counts
only real breaches.

## Reorder advice is an instruction, not an alarm (§12)

§11's thresholds say *that* something is low. §12 says a threshold alone is
not a recommendation, because how much to buy depends on how fast the material
moves and how long the supplier takes:

```
needed  = daily_usage × lead_time_days + safety_stock
order   = ceil((needed + 30 days of usage − available) / spool) × spool
```

Buying only back to the cover line would put the next order due immediately,
so a month of usage is added. The result is rounded up to whole spools because
that is how filament is sold. Usage comes from the trailing 30 days of the
ledger — real consumption, not a plan.

## Failure risk (§34) without the ML §85 forbids

`estimateRisk` blends three things the shop already measures:

1. the model's own failure rate, if it has enough history;
2. the printer's failure rate, weighted at 30% when the model's is known;
3. print duration — 8h+ multiplies the estimate by 1.25, 4h+ by 1.1.

Every contribution appears in `reasons`, so the operator can disagree with the
specific input rather than with an opaque score. The result is capped at 95%:
nothing here justifies claiming certainty. Below five finished jobs the band is
`unknown` and no percentage is offered at all.

## Batch strategies (§20)

`batchStrategies` compares one-at-a-time against fuller plates. Material barely
moves with batching; time does, because each plate pays the heat-up and
first-layer overhead once instead of per object. Risk moves the other way — a
plate of ten that fails loses ten — so the function returns the trade-off and
declines to pick a winner. It also reports overproduction when the plate size
does not divide the order evenly.

## Printer analytics deliberately omits revenue

§32 lists "revenue generated" and "profit generated" per printer. Those are not
shown, and the screen says so. A print job is not attached to an order line in
every workflow, so per-machine revenue would be an allocation nobody could
reconcile against the P&L — which is exactly the conflation §103 warns about.
What a machine demonstrably produces is hours, output, failures and maintenance
cost, and that is what `printer_analytics` reports.

Utilisation (§70) measures from the purchase date rather than the first job: a
printer idle for its first month was still capital sitting on a bench.

## Calibration is offered, never applied (§84)

`calibration_samples` reports mean signed error per printer and material with
its sample count. The screen turns that into a suggested multiplier only when
there are at least three samples, and nothing multiplies an estimate
automatically — §84 requires corrections to be configurable and reversible.

## Consumables get a ledger, not a number (§55)

`consumables.on_hand` is reconciled by trigger from `consumable_transactions`,
and the column-level grant is revoked so no client can write it directly. The
first attempt at that revoke did nothing useful — `revoke update (on_hand)`
only removes *column-level* grants, and the table-level UPDATE grant still
covered every column. The fix (`20260910000200`) drops the table grant and
hands back only the editable columns.

## Notifications are pulled, not pushed (§98)

The notifications screen computes every alert from live data when you open it:
critical stock, overdue maintenance, overdue orders, ready-but-unpaid orders,
recent failures. Delivery by email or push is not built, and the screen says
why — an alert that silently fails to send is worse than one you came to read.
The same reasoning applies to §68's scheduled reports, which export on demand
instead.

## New objects

| Object | Purpose |
|---|---|
| `maintenance_records` | §54 service history, cost and downtime |
| `consumables`, `consumable_transactions` | §55 non-filament stock with its own ledger |
| `printer_analytics` | §32, §70, §72 |
| `failure_analytics`, `model_reliability` | §33 |
| `waste_analytics` | §52, §53 |
| `filament_stock_forecast` | §11, §12, §66 |
| `calibration_samples` | §84 |
| `business_kpis` | §69 |
| `product_profitability` | §57, §90 (added late in phase 5) |

## Screens

| Route | Shows |
|---|---|
| `/analytics/products` | profit and margin per product, hiding those never sold |
| `/analytics/printers` | hours, success rate, utilisation, maintenance cost |
| `/analytics/materials` | stock against measured consumption and days remaining |
| `/analytics/waste` | filament outside finished products, failure causes, model reliability |
| `/analytics/profitability` | profit per machine hour and per gram, by month and customer |
| `/inventory/low-stock` | reorder advice with editable lead time and safety stock |
| `/inventory/consumables` | consumable stock and its ledger |
| `/printers/status` | live board with per-machine utilisation |
| `/printers/maintenance` | service log, downtime and next due |
| `/printers/calibration` | estimate error per printer and material |
| `/finance/reports` | three CSV exports through a real save dialog |
| `/settings/slicer` | engine state and discovered slicers |
| `/settings/storage` | backend, usage and a signed-URL access check |
| `/settings/notifications` | everything the data is currently saying |

## Verified against the live database

`business_kpis` with one order (2000 paid), one 500 expense and one completed
job (7200s, 120 g actual against 3600s, 100 g estimated) returned revenue 2000,
net profit 1500, profit per machine hour 750, profit per gram 12.50, average
order 2000. `printer_analytics` returned 1 job, 100% success, 7200s, 120 g.
`calibration_samples` returned +20% material error and +100% time error — the
actuals against the estimates, exactly. A printer with no finished jobs
reported a null success rate, filaments with no 30-day usage reported no
forecast, and the `on_hand` and ledger grants were confirmed revoked.

Test rows were removed afterwards. 75 TypeScript tests and 48 Python engine
tests pass.
