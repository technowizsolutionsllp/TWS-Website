// The Insights numbers as plain data. The dashboard page and the JSON API both render from these, so
// they can never disagree. All weeks start on Monday 00:00 UTC; `week_starts` are Unix seconds.

import { DAY, buyAttempts, countByWeek, deactivations, lastWeeks, licenseSeries, weekStart } from './compute';
import type { EventRow } from './db';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
/** share of `part` in `whole`, or null when there is nothing to divide */
const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 1000);

export const INSIGHTS_API_BASE = '/api/pinchpdf/insights/v1/';

export const BUYING_WEEKS = 12;
export const LICENSE_WEEKS = 26;
export const DEVICE_WEEKS = 12;

export function buyingData(events: EventRow[], windowDays: number, now: number) {
  const weeks = lastWeeks(now, BUYING_WEEKS);
  const attempts = buyAttempts(events, windowDays, now).filter((a) => a.start >= weeks[0]);
  const weekly = (outcome: string) => weeks.map((w) => attempts.filter((a) => a.outcome === outcome && weekStart(a.start) === w).length);
  const converted = attempts.filter((a) => a.outcome === 'converted').length;
  const abandoned = attempts.filter((a) => a.outcome === 'abandoned').length;
  return {
    window_days: windowDays,
    week_starts: weeks,
    attempts: attempts.length,
    converted,
    abandoned,
    pending: attempts.filter((a) => a.outcome === 'pending').length,
    late: attempts.filter((a) => a.late).length,
    conversion_rate: ratio(converted, converted + abandoned),
    weekly: { converted: weekly('converted'), abandoned: weekly('abandoned'), pending: weekly('pending') },
  };
}

export function licensesData(events: EventRow[], now: number) {
  const weeks = lastWeeks(now, LICENSE_WEEKS);
  const { weekly, current } = licenseSeries(events, weeks, now);
  return {
    week_starts: weeks,
    current: {
      active: current.active,
      individual: current.byPlan.individual,
      business: current.byPlan.business,
      active_devices: current.activeSeats,
      on_multiple_devices: current.multiDevice,
    },
    weekly: {
      active: weekly.map((s) => s.active),
      individual: weekly.map((s) => s.byPlan.individual),
      business: weekly.map((s) => s.byPlan.business),
    },
  };
}

export function devicesData(events: EventRow[], now: number) {
  const weeks = lastWeeks(now, DEVICE_WEEKS);
  const recent = deactivations(events).filter((d) => d.at >= weeks[0]);
  const weekly = (outcome: string) => countByWeek(recent.filter((d) => d.outcome === outcome).map((d) => d.at), weeks);
  const keyChanges = countByWeek(events.filter((e) => e.type === 'license_key_changed').map((e) => e.occurred_at), weeks);
  return {
    week_starts: weeks,
    deactivations: recent.length,
    moved: recent.filter((d) => d.outcome === 'moved').length,
    same_device: recent.filter((d) => d.outcome === 'same_device').length,
    unused: recent.filter((d) => d.outcome === 'unused').length,
    key_changes: sum(keyChanges),
    weekly: { moved: weekly('moved'), same_device: weekly('same_device'), unused: weekly('unused'), key_changes: keyChanges },
  };
}

export function overviewData(events: EventRow[], windowDays: number, now: number) {
  const since = now - 30 * DAY;
  const { current } = licenseSeries(events, lastWeeks(now, LICENSE_WEEKS), now);
  const attempts = buyAttempts(events, windowDays, now).filter((a) => a.start >= since);
  const converted = attempts.filter((a) => a.outcome === 'converted').length;
  const abandoned = attempts.filter((a) => a.outcome === 'abandoned').length;
  const drops = deactivations(events).filter((d) => d.at >= since);
  return {
    window_days: windowDays,
    events_recorded: events.length,
    first_event_at: events.length ? events[0].occurred_at : null,
    active_licenses: current.active,
    individual: current.byPlan.individual,
    business: current.byPlan.business,
    last_30_days: {
      buy_attempts: attempts.length,
      converted,
      abandoned,
      conversion_rate: ratio(converted, converted + abandoned),
      deactivations: drops.length,
      moved_device: drops.filter((d) => d.outcome === 'moved').length,
    },
  };
}

export type InsightsTab = 'overview' | 'buying' | 'licenses' | 'devices';
export const INSIGHTS_TABS: readonly InsightsTab[] = ['overview', 'buying', 'licenses', 'devices'];

export function tabData(tab: InsightsTab, events: EventRow[], windowDays: number, now: number) {
  switch (tab) {
    case 'buying':
      return buyingData(events, windowDays, now);
    case 'licenses':
      return licensesData(events, now);
    case 'devices':
      return devicesData(events, now);
    default:
      return overviewData(events, windowDays, now);
  }
}
