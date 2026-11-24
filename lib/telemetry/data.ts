// The telemetry numbers as plain data. The admin Insights tabs and the JSON API both render from
// these, so they can never disagree. Everything is a count: nothing here identifies a person,
// a license or a machine. Days are UTC; buckets follow the date range (a day, or a week for long ranges).

import type { Range } from '../admin/range';
import { DAY, bucketIndex, bucketsFor, buyAttempts, countByBucket, deactivations, installSeries, licenseSeries, type InstallRow } from './compute';
import type { EventRow } from './db';
import { NODUPE_LIMITS } from '../trial/product';
import type { ScanStats } from './scans';

export const INSIGHTS_API_BASE = '/api/pinchpdf/insights/v1/';
export const TELEMETRY_TABS = ['buying', 'licenses', 'devices', 'installs', 'scans'] as const;
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

/** Installer events: installs by kind and uninstalls, per bucket. Counts only. */
export function installsData(rows: InstallRow[], range: Range) {
  const b = bucketsFor(range);
  const inRange = rows.filter((r) => bucketIndex(r.occurred_at, b) >= 0);
  const series = installSeries(rows, b);
  const installs = inRange.filter((r) => r.type === 'install');
  const uninstalls = inRange.filter((r) => r.type === 'uninstall');
  const distinct = (list: InstallRow[]) => new Set(list.map((r) => r.customer_uuid)).size;
  return {
    range: rangeInfo(range),
    bucket_days: b.step / DAY,
    bucket_starts: b.starts,
    installs: installs.length,
    new: installs.filter((r) => r.install_kind === 'new').length,
    upgrades: installs.filter((r) => r.install_kind === 'upgrade').length,
    reinstalls: installs.filter((r) => r.install_kind === 'reinstall').length,
    uninstalls: uninstalls.length,
    distinct_installs: distinct(installs),
    distinct_uninstalls: distinct(uninstalls),
    net_new: installs.filter((r) => r.install_kind === 'new').length - uninstalls.length,
    uninstall_rate: ratio(uninstalls.length, installs.length),
    series: { new: series.byKind.new, upgrade: series.byKind.upgrade, reinstall: series.byKind.reinstall, uninstalls: series.uninstalls },
  };
}

/**
 * NoDupe scan counts, from the trials registered in the range (the cohort), one counter per mode. `total` is what
 * the cohort has used, `at_limit` how many trials have used their whole allowance in a mode, `histogram` how many
 * trials sit at each count. `all_time` is the same across every NoDupe trial. Counts only.
 */
export function scansData(stats: ScanStats, range: Range) {
  return {
    range: rangeInfo(range),
    free_allowance: { ...NODUPE_LIMITS },
    registered_in_range: stats.cohort.trials,
    total: { ...stats.cohort.used },
    at_limit: { ...stats.cohort.atLimit, all_modes: stats.cohort.allModesAtLimit },
    histogram: stats.cohort.histogram,
    all_time: { trials: stats.all.trials, total: { ...stats.all.used }, at_limit: { ...stats.all.atLimit, all_modes: stats.all.allModesAtLimit } },
  };
}

export function tabData(tab: 'buying' | 'licenses' | 'devices', events: EventRow[], range: Range, windowDays: number, now: number) {
  if (tab === 'buying') return buyingData(events, range, windowDays, now);
  if (tab === 'licenses') return licensesData(events, range, now);
  return devicesData(events, range);
}
