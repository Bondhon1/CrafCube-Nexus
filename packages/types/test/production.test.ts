import { describe, expect, it } from 'vitest';
import {
  NEXT_STATUSES, TERMINAL_STATUSES, calibrationFactor, formatDuration, isTerminal,
  type PrintJobStatus,
} from '../src/production.js';

describe('formatDuration', () => {
  it('formats as the doc writes it', () => {
    expect(formatDuration(7 * 3600 + 42 * 60)).toBe('7h 42m'); // §18
  });

  it('drops empty parts', () => {
    expect(formatDuration(2 * 3600)).toBe('2h');
    expect(formatDuration(45 * 60)).toBe('45m');
  });

  it('renders unknown durations as a dash rather than 0m', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('—');
  });
});

describe('status transitions', () => {
  it('treats finished states as terminal', () => {
    for (const s of TERMINAL_STATUSES) {
      expect(isTerminal(s)).toBe(true);
      expect(NEXT_STATUSES[s]).toHaveLength(0);
    }
  });

  it('routes to printing through preparing, where material is reserved', () => {
    // Skipping PREPARING would start a print with nothing reserved.
    expect(NEXT_STATUSES.QUEUED).not.toContain('PRINTING');
    expect(NEXT_STATUSES.PREPARING).toContain('PRINTING');
  });

  it('only lets a printing job finish, not be cancelled', () => {
    // A job on the machine has consumed material; it completes or it fails.
    expect(NEXT_STATUSES.PRINTING).toContain('COMPLETED');
    expect(NEXT_STATUSES.PRINTING).toContain('FAILED');
    expect(NEXT_STATUSES.PRINTING).not.toContain('CANCELLED');
  });

  it('never offers a transition back into a terminal state', () => {
    for (const [, next] of Object.entries(NEXT_STATUSES)) {
      for (const target of next as PrintJobStatus[]) {
        if (target === 'COMPLETED' || target === 'FAILED' || target === 'CANCELLED') continue;
        expect(isTerminal(target)).toBe(false);
      }
    }
  });
});

describe('calibrationFactor', () => {
  it('converts a mean error into a multiplier', () => {
    // +3.8% average error means future estimates scale by 1.038 (§84).
    expect(calibrationFactor([4, 3.6, 3.8])).toBeCloseTo(1.038, 3);
  });

  it('withholds a factor until there is enough history', () => {
    // One or two jobs is noise presented as insight.
    expect(calibrationFactor([5])).toBeNull();
    expect(calibrationFactor([5, 5])).toBeNull();
    expect(calibrationFactor([5, 5, 5])).toBeCloseTo(1.05, 4);
  });

  it('handles estimates that were too high', () => {
    expect(calibrationFactor([-5, -5, -5])).toBeCloseTo(0.95, 4);
  });

  it('ignores jobs with no measurement', () => {
    expect(calibrationFactor([10, null, 10, null, 10])).toBeCloseTo(1.1, 4);
  });

  it('returns null when nothing was measured', () => {
    expect(calibrationFactor([null, null, null])).toBeNull();
  });
});
