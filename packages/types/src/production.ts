/** Print jobs, queue and production (design doc §18-§20, §35, §83-§84). */

import type { Timestamp, UUID } from './entities.js';

export const PRINT_JOB_STATUSES = [
  'QUEUED', 'SCHEDULED', 'PREPARING', 'PRINTING', 'PAUSED',
  'COMPLETED', 'FAILED', 'CANCELLED',
] as const;

export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<PrintJobStatus, string> = {
  QUEUED: 'Queued',
  SCHEDULED: 'Scheduled',
  PREPARING: 'Preparing',
  PRINTING: 'Printing',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/** Statuses a job can no longer move out of. */
export const TERMINAL_STATUSES: PrintJobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isTerminal(status: PrintJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * What an operator may move a job to next.
 *
 * Deliberately narrow: PREPARING is where material is reserved and COMPLETED is
 * where it is consumed, so skipping steps would leave the ledger inconsistent
 * with what actually happened on the machine.
 */
export const NEXT_STATUSES: Record<PrintJobStatus, PrintJobStatus[]> = {
  QUEUED: ['SCHEDULED', 'PREPARING', 'CANCELLED'],
  SCHEDULED: ['PREPARING', 'QUEUED', 'CANCELLED'],
  PREPARING: ['PRINTING', 'QUEUED', 'CANCELLED'],
  PRINTING: ['PAUSED', 'COMPLETED', 'FAILED'],
  PAUSED: ['PRINTING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export interface PrintJob {
  id: UUID;
  organization_id: UUID;
  code: string;
  status: PrintJobStatus;
  model_version_id: UUID | null;
  printer_id: UUID | null;
  quote_id: UUID | null;
  spool_id: UUID | null;
  quantity: number;
  batched: boolean;
  estimated_grams: number;
  estimated_seconds: number;
  estimated_cost: number;
  /** Waste included in estimated_grams: purge, support, brim, prime line. */
  estimated_waste_grams: number;
  custom_build_id: UUID | null;
  slice_result_id: UUID | null;
  actual_grams: number | null;
  actual_seconds: number | null;
  failed_quantity: number;
  failure_reason: string | null;
  notes: string | null;
  queued_at: Timestamp;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PrintJobEvent {
  id: UUID;
  job_id: UUID;
  from_status: PrintJobStatus | null;
  to_status: PrintJobStatus;
  note: string | null;
  actor_id: UUID | null;
  created_at: Timestamp;
}

/** One row of the `job_accuracy` view (§83). */
export interface JobAccuracy {
  job_id: UUID;
  code: string;
  printer_name: string | null;
  finished_at: Timestamp | null;
  estimated_grams: number;
  actual_grams: number | null;
  estimated_seconds: number;
  actual_seconds: number | null;
  material_error_percent: number | null;
  time_error_percent: number | null;
}

/** "7h 42m", as §18 writes it. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Mean signed error across completed jobs, as a multiplier for future
 * estimates (§84). Returns null below `minimumSamples`, because a correction
 * factor from one or two jobs is noise presented as insight.
 */
export function calibrationFactor(
  errorsPercent: (number | null)[],
  minimumSamples = 3,
): number | null {
  const values = errorsPercent.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length < minimumSamples) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Number((1 + mean / 100).toFixed(4));
}
