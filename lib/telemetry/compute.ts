// Pure calculations for the Insights telemetry tabs. No I/O: events in, numbers out, so every rule is testable.
//
// A "seat" is one license on one machine: (license, device). When the machine had no usable signal the
// customer stands in for it. A license is ACTIVE while at least one of its seats is active.
//   license_activated   seat on (license, device) becomes active
//   license_deactivated seat on (license, device) becomes inactive (the user is freeing the license)
//   license_key_changed seat on (previous license, device) ends and (new license, device) becomes active
// A deactivation is NOT churn: people move a license to another computer. It is classed by what happened next.
//
// Time is bucketed exactly like the trial charts on the same page: one bucket per UTC day, or per 7 days
// when the range is long (see lib/admin/range.ts).

import { WEEKLY_OVER_DAYS, type Range } from '../admin/range';
import type { EventRow, Plan } from './db';

export const DAY = 86_400;

export type Buckets = {
  /** Start of each bucket, Unix seconds, oldest first. */
  starts: number[];
  /** Bucket length in seconds (a day or a week). */
  step: number;
  /** End of the range (exclusive), Unix seconds. */
  end: number;
};

export function bucketsFor(range: Range): Buckets {
  const weekly = range.days > WEEKLY_OVER_DAYS;
  const step = (weekly ? 7 : 1) * DAY;
  const count = weekly ? Math.ceil(range.days / 7) : range.days;
  return { starts: Array.from({ length: count }, (_, i) => range.fromSec + i * step), step, end: range.toSecExclusive };
}

/** Index of the bucket holding `ts`, or -1 when it is outside the range. */
export function bucketIndex(ts: number, b: Buckets): number {
  if (ts < b.starts[0] || ts >= b.end) return -1;
  return Math.floor((ts - b.starts[0]) / b.step);
}

export function countByBucket(times: number[], b: Buckets): number[] {
  const out = b.starts.map(() => 0);
  for (const t of times) {
    const i = bucketIndex(t, b);
    if (i >= 0) out[i] += 1;
  }
  return out;
}

const seatOf = (e: EventRow) => e.device_id ?? `c:${e.customer_uuid}`;

// ------------------------------------------------------------------ buying

export type AttemptOutcome = 'converted' | 'pending' | 'abandoned';
export type Attempt = {
  customer: string;
  start: number;
  outcome: AttemptOutcome;
  /** An abandoned attempt where the person did activate, but after the window. */
  late: boolean;
};

/**
 * A buy attempt starts at a buy click. Further clicks by the same customer inside the window belong to
 * the same attempt (so clicking twice is not two buyers). It converts when that customer activates a
 * license, or changes to a new key, within `windowDays` of the attempt start. It is pending while the
 * window is still open, and abandoned once the window has passed with nothing.
 */
export function buyAttempts(events: EventRow[], windowDays: number, now: number): Attempt[] {
  const window = windowDays * DAY;
  const clicks = new Map<string, number[]>();
  const entries = new Map<string, number[]>();
  for (const e of events) {
    const bucket = e.type === 'buy_clicked' ? clicks : e.type === 'license_activated' || e.type === 'license_key_changed' ? entries : null;
    if (!bucket) continue;
    const list = bucket.get(e.customer_uuid) ?? [];
    list.push(e.occurred_at);
    bucket.set(e.customer_uuid, list);
  }

  const attempts: Attempt[] = [];
  for (const [customer, times] of clicks) {
    const done = entries.get(customer) ?? [];
    let start: number | null = null;
    for (const t of [...times].sort((a, b) => a - b)) {
      if (start !== null && t < start + window) continue; // same attempt
      start = t;
      const inWindow = done.some((d) => d >= t && d <= t + window);
      const after = done.some((d) => d > t + window);
      const outcome: AttemptOutcome = inWindow ? 'converted' : now < t + window ? 'pending' : 'abandoned';
      attempts.push({ customer, start: t, outcome, late: outcome === 'abandoned' && after });
    }
  }
  return attempts.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- licenses

export type LicenseSnapshot = {
  active: number;
  byPlan: Record<Plan, number>;
  /** Active licenses running on more than one machine. */
  multiDevice: number;
  /** Active seats across all active licenses. */
  activeSeats: number;
};

class LicenseState {
  private seats = new Map<string, Map<string, boolean>>();
  private plans = new Map<string, Plan>();

  private setSeat(license: string, seat: string, active: boolean) {
    const map = this.seats.get(license) ?? new Map<string, boolean>();
    map.set(seat, active);
    this.seats.set(license, map);
  }

  apply(e: EventRow) {
    const seat = seatOf(e);
    if (e.type === 'license_activated' && e.license_fp) {
      this.setSeat(e.license_fp, seat, true);
      if (e.plan) this.plans.set(e.license_fp, e.plan);
    } else if (e.type === 'license_deactivated' && e.license_fp) {
      this.setSeat(e.license_fp, seat, false);
      if (e.plan) this.plans.set(e.license_fp, e.plan);
    } else if (e.type === 'license_key_changed' && e.license_fp) {
      if (e.prev_license_fp) this.setSeat(e.prev_license_fp, seat, false);
      this.setSeat(e.license_fp, seat, true);
      if (e.plan) this.plans.set(e.license_fp, e.plan);
    }
  }

  snapshot(): LicenseSnapshot {
    const out: LicenseSnapshot = { active: 0, byPlan: { individual: 0, business: 0 }, multiDevice: 0, activeSeats: 0 };
    for (const [license, seats] of this.seats) {
      const live = [...seats.values()].filter(Boolean).length;
      if (live === 0) continue;
      out.active += 1;
      out.activeSeats += live;
      if (live > 1) out.multiDevice += 1;
      out.byPlan[this.plans.get(license) ?? 'individual'] += 1;
    }
    return out;
  }
}

/**
 * The active-license picture at the end of each bucket (the last bucket ends at `now` when the range
 * reaches today), plus right now. History before the range counts: a license activated last year is
 * still active in this month's chart.
 */
export function licenseSeries(events: EventRow[], b: Buckets, now: number): { points: LicenseSnapshot[]; current: LicenseSnapshot } {
  const state = new LicenseState();
  const sorted = [...events].sort((a, c) => a.occurred_at - c.occurred_at || a.seq - c.seq);
  let i = 0;
  const points: LicenseSnapshot[] = [];
  for (const start of b.starts) {
    const end = Math.min(start + b.step, b.end, now + 1);
    while (i < sorted.length && sorted[i].occurred_at < end) state.apply(sorted[i++]);
    points.push(state.snapshot());
  }
  while (i < sorted.length && sorted[i].occurred_at <= now) state.apply(sorted[i++]);
  return { points, current: state.snapshot() };
}

// ----------------------------------------------------------------- devices

export type DeactivationOutcome = 'moved' | 'same_device' | 'unused';
export type Deactivation = { at: number; license: string; outcome: DeactivationOutcome };

/**
 * What happened to a license after it was deactivated on a machine:
 * moved       later activated on a different machine (the common case: a new computer)
 * same_device later activated again on the same machine
 * unused      not activated anywhere since
 */
export function deactivations(events: EventRow[]): Deactivation[] {
  const sorted = [...events].sort((a, b) => a.occurred_at - b.occurred_at || a.seq - b.seq);
  const later = new Map<string, { index: number; seat: string }[]>();
  sorted.forEach((e, index) => {
    if ((e.type === 'license_activated' || e.type === 'license_key_changed') && e.license_fp) {
      const list = later.get(e.license_fp) ?? [];
      list.push({ index, seat: seatOf(e) });
      later.set(e.license_fp, list);
    }
  });
  const out: Deactivation[] = [];
  sorted.forEach((e, index) => {
    if (e.type !== 'license_deactivated' || !e.license_fp) return;
    const seat = seatOf(e);
    const after = (later.get(e.license_fp) ?? []).filter((a) => a.index > index);
    const outcome: DeactivationOutcome = after.some((a) => a.seat !== seat) ? 'moved' : after.length > 0 ? 'same_device' : 'unused';
    out.push({ at: e.occurred_at, license: e.license_fp, outcome });
  });
  return out;
}

// ---------------------------------------------------------------- installs
// The installer reports install and uninstall events (anonymous: an install id, a time, and for an install whether
// it is new, an upgrade or a reinstall). They are counted per bucket; nothing here is a person or a machine.

export type InstallRow = { customer_uuid: string; type: 'install' | 'uninstall'; install_kind: string | null; occurred_at: number };

export const INSTALL_KIND_NAMES = ['new', 'upgrade', 'reinstall'] as const;

export function installSeries(rows: InstallRow[], b: Buckets) {
  const zeros = () => b.starts.map(() => 0);
  const byKind: Record<(typeof INSTALL_KIND_NAMES)[number], number[]> = { new: zeros(), upgrade: zeros(), reinstall: zeros() };
  const uninstalls = zeros();
  for (const row of rows) {
    const i = bucketIndex(row.occurred_at, b);
    if (i < 0) continue;
    if (row.type === 'uninstall') uninstalls[i] += 1;
    else if (row.install_kind && row.install_kind in byKind) byKind[row.install_kind as keyof typeof byKind][i] += 1;
  }
  return { byKind, uninstalls };
}
