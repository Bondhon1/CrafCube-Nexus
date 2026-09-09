# Phase 5 — Sales & Finance

Design doc §28-§31, §58, §90, §103, §105.

## Price is not revenue is not cost is not cash (§103)

The doc's sharpest warning is that these four numbers get conflated, and the
resulting business looks profitable while running out of money. Phase 5 keeps
them apart everywhere they appear:

| Number | Where it lives | What it means |
|---|---|---|
| Price | `order_items.unit_price` | what the customer agreed to pay |
| Revenue | `finance_transactions` (income) | money actually received |
| Cost | `order_items.unit_cost` | what the goods cost to make, snapshotted |
| Cash | `payments` | what has landed, and when |

`order_balances` reports total, paid, balance, cost and gross profit as five
separate columns for exactly this reason — the Orders screen never shows a
single "amount" that could be read as any of them.

An order's total is **not** revenue. Revenue is recognised when a payment is
recorded, which is why `/finance/revenue` can be lower than the order book.

## One write, two records

`record_payment()` inserts the `payments` row and the matching income
`finance_transactions` row in the same statement. Recording them separately
would let cash and the ledger drift apart the first time one insert failed,
and no report could then say which was right.

The same reasoning makes `payments` and `finance_transactions` append-only:

```sql
revoke update, delete on public.payments from anon, authenticated;
revoke update, delete on public.finance_transactions from anon, authenticated;
```

A mistaken payment is corrected by a reversing entry, not by editing history.

## Costs are snapshotted, not looked up (§105)

`order_items.unit_cost` is copied onto the line when the order is placed. If
filament prices rise next month, last month's orders keep the margin they
actually earned. Joining live cost profiles instead would silently rewrite the
past every time a rate changed — and would make `product_profitability`
disagree with itself between two page loads.

## Totals are computed server-side

`recalculate_order()` recomputes `line_total`, `subtotal` and `total`
(subtotal − discount + delivery). The client never posts a total it worked out
itself, so a stale form or a rounding difference in the browser cannot commit
a wrong number.

## P&L structure (§31)

```
revenue                 income transactions
− COGS                  expense transactions flagged is_cogs
= gross profit
− operating expenses    every other expense
= net profit
```

Categories carry the `is_cogs` flag, so the split is a property of the chart of
accounts rather than a guess made at report time. `seed_finance_categories()`
installs 17 starter categories with the flag already set.

Margin is `null`, not `0`, in a month with no revenue — `marginPercent()`
returns null and the UI prints "no revenue yet". Showing 0% would read as
"we sold at cost", which is a different and much worse claim.

## Product profitability

`product_profitability` aggregates the order lines, excluding cancelled
orders: a line nobody was ever billed for is not a sale. Products that have
never sold report zeros rather than nulls, so the table sorts sensibly.

## Screens

| Route | Shows |
|---|---|
| `/sales/customers` | lifetime value against outstanding balance |
| `/sales/orders` | order book, status advance, payment capture |
| `/sales/products` | units, revenue, cost, margin per product |
| `/sales/quotations` | frozen quotes with their full cost breakdown |
| `/finance/transactions` | the whole ledger, newest first |
| `/finance/expenses` | spending, with COGS lines marked |
| `/finance/revenue` | cash received |
| `/finance/pnl` | monthly P&L with the four headline figures |

## Verified against the live database

Order `SO-2026-00001`: subtotal 9450, total 9600, discount applied → 9000,
cost snapshot 4510, payment of 5000 leaving a balance of 4000, income row
written by the same call, customer LTV 9000 with 4000 outstanding, P&L revenue
5000 / COGS 1200 / opex 800 / gross 3800 / net 3000, and a `delete` against
the ledger correctly refused. `product_profitability` returned 3 units,
1 order, 1500 revenue, 540 cost, 960 profit — with a 10-unit cancelled order
excluded, as intended.
