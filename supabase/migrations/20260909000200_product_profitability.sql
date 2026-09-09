-- Product profitability (§90, §103).
--
-- Phase 5 reports which products actually earn. Revenue and cost both come
-- from the order lines, where `unit_cost` was snapshotted at the time of sale
-- (§105) — so a later change to filament prices cannot rewrite the history of
-- what a product used to make.

create or replace view public.product_profitability as
select
  p.id as product_id,
  p.organization_id,
  p.name,
  p.sku,
  p.list_price,
  p.active,
  coalesce(sum(oi.quantity) filter (where sold), 0) as units_sold,
  count(distinct oi.order_id) filter (where sold) as order_count,
  coalesce(sum(oi.line_total) filter (where sold), 0) as revenue,
  coalesce(sum(oi.unit_cost * oi.quantity) filter (where sold), 0) as cost,
  coalesce(sum(oi.line_total) filter (where sold), 0)
    - coalesce(sum(oi.unit_cost * oi.quantity) filter (where sold), 0) as gross_profit,
  max(o.created_at) filter (where sold) as last_sold_at
from public.products p
left join public.order_items oi on oi.product_id = p.id
left join public.orders o on o.id = oi.order_id
-- A cancelled order was never billed, so its lines are not sales. The flag is
-- computed once here and every aggregate above filters on it, rather than the
-- join dropping the row and leaving a phantom NULL line in the sums.
cross join lateral (select o.id is not null and o.status <> 'CANCELLED' as sold) s
group by p.id;

alter view public.product_profitability set (security_invoker = on);

notify pgrst, 'reload schema';
