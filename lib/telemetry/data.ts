// The telemetry numbers as plain data. The admin Insights tabs and the JSON API both render from
// these, so they can never disagree. Everything is a count: nothing here identifies a person,
// a license or a machine. Days are UTC; buckets follow the date range (a day, or a week for long ranges).

import type { Range } from '../admin/range';
import { DAY, bucketIndex, bucketsFor, buyAttempts, countByBucket, deactivations, licenseSeries } from './compute';
import type { EventRow } from './db';

export const INSIGHTS_API_BASE = '/api/pinchpdf/insights/v1/';
export const TELEMETRY_TABS = ['buying', 'licenses', 'devices'] as const;
export type TelemetryTab = (typeof TELEMETRY_TABS)[number];
export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 90;
export const DEFAULT_WINDOW_DAYS = 7;

/** share of `part` in `whole`, or null when there is nothing to divide */
const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 1000);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function parseWindow(value: string | null | undefined, fallback = DEFAULT_WINDOW_DAYS): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, parsed)) : fallback;
}

const rangeInfo = (range: Range) => ({ from: range.from, to: range.to, days: range.days });

export function buyingData(events: EventRow[], range: Range, windowDays: number, now: number) {
  const b = bucketsFor(range);
  const attempts = buyAttempts(events, windowDays, now).filter((a) => a.start >= range.fromSec && a.start < range.toSecExclusive);
  const weekly = (outcome: string) => countByBucket(attempts.filter((a) => a.outcome === outcome).map((a) => a.start), b);
  const converted = attempts.filter((a) => a.outcome === 'converted').length;
  const abandoned = attempts.filter((a) => a.outcome === 'abandoned').length;
  return {
    range: rangeInfo(range),
    window_days: windowDays,
    bucket_days: b.step / DAY,
    bucket_starts: b.starts,
    attempts: attempts.length,
    converted,
    abandoned,
    pending: attempts.filter((a) => a.outcome === 'pending').length,
    late: attempts.filter((a) => a.late).length,
    conversion_rate: ratio(converted, converted + abandoned),
    series: { converted: weekly('converted'), abandoned: weekly('abandoned'), pending: weekly('pending') },
  };
}

export function licensesData(events: EventRow[], range: Range, now: number) {
  const b = bucketsFor(range);
  const { points, current } = licenseSeries(events, b, now);
  return {
    range: rangeInfo(range),
    bucket_days: b.step / DAY,
    bucket_starts: b.starts,
    current: {
      active: current.active,
      individual: current.byPlan.individual,
      business: current.byPlan.business,
      active_devices: current.activeSeats,
      on_multiple_devices: current.multiDevice,
    },
    series: {
      active: points.map((s) => s.active),
      individual: points.map((s) => s.byPlan.individual),
      business: points.map((s) => s.byPlan.business),
    },
  };
}

export function devicesData(events: EventRow[], range: Range) {
  const b = bucketsFor(range);
  const inRange = deactivations(events).filter((d) => bucketIndex(d.at, b) >= 0);
  const series = (outcome: string) => countByBucket(inRange.filter((d) => d.outcome === outcome).map((d) => d.at), b);
  const keyChanges = countByBucket(events.filter((e) => e.type === 'license_key_changed').map((e) => e.occurred_at), b);
  return {
    range: rangeInfo(range),
    bucket_days: b.step / DAY,
    bucket_starts: b.starts,
    deactivations: inRange.length,
    moved: inRange.filter((d) => d.outcome === 'moved').length,
    same_device: inRange.filter((d) => d.outcome === 'same_device').length,
    unused: inRange.filter((d) => d.outcome === 'unused').length,
    key_changes: sum(keyChanges),
    series: { moved: series('moved'), same_device: series('same_device'), unused: series('unused'), key_changes: keyChanges },
  };
}

export function tabData(tab: TelemetryTab, events: EventRow[], range: Range, windowDays: number, now: number) {
  if (tab === 'buying') return buyingData(events, range, windowDays, now);
  if (tab === 'licenses') return licensesData(events, range, now);
  return devicesData(events, range);
}
