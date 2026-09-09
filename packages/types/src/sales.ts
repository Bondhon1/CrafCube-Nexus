/** Customers, products, orders, payments and finance (§28-§31, §103). */

import type { Timestamp, UUID } from './entities.js';

export type CustomerType = 'retail' | 'wholesale' | 'business' | 'internal';

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  retail: 'Retail',
  wholesale: 'Wholesale',
  business: 'Business',
  internal: 'Internal',
};

export interface Customer {
  id: UUID;
  organization_id: UUID;
  name: string;
  type: CustomerType;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archived: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** One row of `customer_summary` (§28, §58). */
export interface CustomerSummary {
  customer_id: UUID;
  organization_id: UUID;
  name: string;
  type: CustomerType;
  order_count: number;
  lifetime_value: number;
  outstanding: number;
  last_order_at: Timestamp | null;
}

export interface Product {
  id: UUID;
  organization_id: UUID;
  model_id: UUID | null;
  cost_profile_id: UUID | null;
  name: string;
  sku: string | null;
  description: string | null;
  list_price: number | null;
  active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** One row of `product_profitability` (§90). Cancelled orders are excluded. */
export interface ProductProfitability {
  product_id: UUID;
  organization_id: UUID;
  name: string;
  sku: string | null;
  list_price: number | null;
  active: boolean;
  units_sold: number;
  order_count: number;
  revenue: number;
  cost: number;
  gross_profit: number;
  last_sold_at: Timestamp | null;
}

export const ORDER_STATUSES = [
  'DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  IN_PRODUCTION: 'In production',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const NEXT_ORDER_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PRODUCTION', 'READY', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

export interface Order {
  id: UUID;
  organization_id: UUID;
  customer_id: UUID | null;
  code: string;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  delivery_charge: number;
  total: number;
  due_date: string | null;
  delivered_at: Timestamp | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrderItem {
  id: UUID;
  organization_id: UUID;
  order_id: UUID;
  product_id: UUID | null;
  quote_id: UUID | null;
  description: string;
  quantity: number;
  unit_price: number;
  /** Snapshotted, so profitability survives later cost changes (§105). */
  unit_cost: number;
  line_total: number;
}

/** One row of `order_balances`. */
export interface OrderBalance {
  order_id: UUID;
  organization_id: UUID;
  code: string;
  status: OrderStatus;
  customer_id: UUID | null;
  customer_name: string | null;
  total: number;
  paid: number;
  balance: number;
  cost: number;
  gross_profit: number;
  created_at: Timestamp;
  due_date: string | null;
}

export type PaymentMethod = 'cash' | 'bank' | 'mobile' | 'card' | 'other';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank: 'Bank transfer',
  mobile: 'Mobile money',
  card: 'Card',
  other: 'Other',
};

export interface Payment {
  id: UUID;
  order_id: UUID;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paid_at: Timestamp;
}

export type FinanceDirection = 'income' | 'expense';

export interface FinanceCategory {
  id: UUID;
  organization_id: UUID;
  name: string;
  direction: FinanceDirection;
  is_cogs: boolean;
}

export interface FinanceTransaction {
  id: UUID;
  organization_id: UUID;
  category_id: UUID | null;
  direction: FinanceDirection;
  amount: number;
  occurred_on: string;
  description: string | null;
  reference: string | null;
  order_id: UUID | null;
  payment_id: UUID | null;
  customer_id: UUID | null;
  created_at: Timestamp;
}

/** One row of `profit_and_loss` (§31). */
export interface ProfitAndLoss {
  organization_id: UUID;
  month: string;
  revenue: number | null;
  cogs: number | null;
  operating_expenses: number | null;
  gross_profit: number | null;
  net_profit: number | null;
}

/**
 * Margin as a share of revenue.
 *
 * Returns null rather than 0 when there is no revenue: a month with no sales
 * has no margin, and showing 0% would read as "we sold at cost".
 */
export function marginPercent(profit: number | null, revenue: number | null): number | null {
  if (!revenue || revenue <= 0) return null;
  return Number((((profit ?? 0) / revenue) * 100).toFixed(2));
}

/** Payment state of an order, from what it is worth against what was paid. */
export function paymentState(
  total: number,
  paid: number,
): 'unpaid' | 'partial' | 'paid' | 'overpaid' {
  // A cent of rounding should not make a settled order look unpaid.
  const epsilon = 0.01;
  if (paid <= epsilon) return 'unpaid';
  if (paid + epsilon < total) return 'partial';
  if (paid > total + epsilon) return 'overpaid';
  return 'paid';
}
