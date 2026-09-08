# Phase 3 — Costing and pricing

Design doc §21-§27, §95-§97, §105.

## The engine

`packages/types/src/costing.ts` — pure functions, no I/O, so the arithmetic is
directly testable and produces identical numbers wherever it runs. §96 requires
pricing logic to be visible and editable, so the full breakdown is returned
rather than a single figure, and every rule records what it did.

### Cost, in §95's order

```
material + electricity + machine + labour + consumables + packaging + delivery
= direct cost
+ failure reserve
= true cost
```

Three decisions that change the numbers:

- **Electricity uses average draw, not the printer's rating** (§21). A Kobra X
  peaks far above the ~220 W it averages; costing on the peak inflates every
  quote.
- **Labour is per job, not per print hour** (§23). Nobody watches a printer for
  four hours. Charging labour by print time roughly triples the cost of a long
  print.
- **The failure reserve multiplies rather than adds** (§25). An 8% failure rate
  means ~8% more material and machine time consumed overall, so it has to scale
  with the job.

### Margin is a share of price, not a markup

`price = cost / (1 - margin)`.

Treating a 60% margin as `cost × 1.6` yields a 37.5% margin — the most common
pricing error in this domain, and there is a test asserting the two are not
equal. A platform fee divides for the same reason: added on, the fee is left
unfunded.

### Rules (§96)

Rules are rows, not code: quantity discount, multi-colour fee, rush fee, margin
override, minimum price. They run in priority order, flat fees before percentage
discounts so a discount applies to the whole price, and each returns a
human-readable note of what it changed.

The engine **warns rather than silently correcting** when a discount breaks the
minimum margin or drops the price below cost. Quietly clamping the price would
hide exactly the situation the operator needs to see.

## Quotes are immutable (§105)

Every rate is copied into the `quotes` row rather than referenced. Editing a
cost profile or a spool price must never rewrite what a past job was costed at.
`UPDATE` and `DELETE` are revoked from clients: a correction is a new quote.

## A bug the tests caught

The final price is rounded to 2dp while costs carry 4dp, so an at-cost quote
landed a fraction of a cent under its own floor and reported "below cost" on
every zero-margin job. Warnings that fire when nothing is wrong train people to
ignore them, so comparisons now carry a one-minor-unit tolerance.

## Seeded profiles shipped with zero rates

The first seed set margins but left electricity, machine and labour at 0, so a
quote from an untouched profile counted **material only** — and looked healthy
while doing it. Fixed in `20260908000800_seed_rates.sql`, which also repairs
already-seeded rows that were never edited. The Pricing screen now refuses to
stay quiet about a profile whose rates are all zero.

## Verified against the doc's own worked examples

100 g at 1.35/g, 4 hours, 220 W, Standard Retail:

| Line | Value | Source |
|---|---|---|
| Material | 135.00 | §8 worked example |
| Electricity | 10.56 | §21 worked example (0.22 kW × 4 h × 12) |
| Machine time | 80.00 | 4 h × 20 |
| Labour | 20.00 | 10 min at 120/h |
| Direct cost | 265.56 | |
| Failure reserve 5% | 13.28 | §25 |
| **True cost** | **278.84** | |
| Recommended at 60% | **697.10** | 278.84 ÷ 0.4 |
| Minimum at 25% | 371.78 | |

24 unit tests covering cost, margin arithmetic, rule ordering and the guards.

## Screens

- **Settings → Cost profiles**: every rate, with the five §97 profiles seedable.
- **Settings → Pricing**: a live calculator showing the whole breakdown, plus
  the rule table. Nothing about the price is hidden.
