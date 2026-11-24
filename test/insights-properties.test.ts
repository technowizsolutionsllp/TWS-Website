// Property tests for the Insights calculations. Hundreds of random event histories (seeded, so a
// failure reproduces) are checked against an independent reference model and against rules that must
// hold for ANY history: counts add up, nothing goes negative, the order events arrive in does not
// matter, and every page renders. These are the tests that catch a wrong chart, not a crash.

import { describe, expect, it } from 'vitest';
import { buildRange } from '../lib/admin/range';
import { renderTelemetryTab } from '../lib/admin/telemetry-pages';
import { DAY, bucketsFor, buyAttempts, deactivations, licenseSeries } from '../lib/telemetry/compute';
import { buyingData, devicesData, licensesData } from '../lib/telemetry/data';
import type { EventRow, EventType, Plan } from '../lib/telemetry/db';

const NOW_MS = Date.UTC(2026, 10, 21, 12, 0, 0);
const NOW = NOW_MS / 1000;
const range = buildRange('2026-10-23', '2026-11-21');
const bucket = bucketsFor(range);

// --------------------------------------------------------------------------- generators

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES: EventType[] = ['buy_clicked', 'buy_clicked', 'license_activated', 'license_activated', 'license_deactivated', 'license_key_changed'];

/** A messy history: any order of events, repeated clicks, activations on unknown devices, and so on. */
function history(seed: number): EventRow[] {
  const r = rng(seed);
  const pick = <T>(items: T[]) => items[Math.floor(r() * items.length)];
  const events: EventRow[] = [];
  const count = 1 + Math.floor(r() * 40);
  for (let i = 0; i < count; i += 1) {
    const type = pick(TYPES);
    const plan: Plan | null = type === 'buy_clicked' ? null : r() < 0.85 ? pick<Plan>(['individual', 'business']) : null;
    const license = `L${Math.floor(r() * 6)}`;
    events.push({
      seq: i + 1,
      customer_uuid: `c${Math.floor(r() * 6)}`,
      type,
      plan,
      license_fp: type === 'buy_clicked' ? null : license,
      prev_license_fp: type === 'license_key_changed' ? `L${(Number(license.slice(1)) + 1 + Math.floor(r() * 5)) % 6}` : null,
      device_id: r() < 0.1 ? null : `d${Math.floor(r() * 5)}`,
      occurred_at: Math.floor(NOW - r() * 120 * DAY),
    });
  }
  return events;
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const seatOf = (e: EventRow) => e.device_id ?? `c:${e.customer_uuid}`;
const order = (events: EventRow[]) => [...events].sort((a, b) => a.occurred_at - b.occurred_at || a.seq - b.seq);

/** The reference model: the plain rules, written the simple way. */
function reference(events: EventRow[], before: number) {
  const seats = new Map<string, boolean>(); // "license|seat" -> active
  const planOf = new Map<string, Plan>();
  for (const e of order(events)) {
    if (e.occurred_at >= before) break;
    const key = (license: string) => `${license}|${seatOf(e)}`;
    if (e.type === 'license_activated') seats.set(key(e.license_fp!), true);
    if (e.type === 'license_deactivated') seats.set(key(e.license_fp!), false);
    if (e.type === 'license_key_changed') {
      seats.set(key(e.prev_license_fp!), false);
      seats.set(key(e.license_fp!), true);
    }
    if (e.license_fp && e.plan && e.type !== 'buy_clicked') planOf.set(e.license_fp, e.plan);
  }
  const live = new Map<string, number>();
  for (const [k, on] of seats) if (on) live.set(k.split('|')[0], (live.get(k.split('|')[0]) ?? 0) + 1);
  const out = { active: live.size, activeSeats: 0, multiDevice: 0, individual: 0, business: 0 };
  for (const [license, n] of live) {
    out.activeSeats += n;
    if (n > 1) out.multiDevice += 1;
    out[planOf.get(license) ?? 'individual'] += 1;
  }
  return out;
}

const shuffled = (events: EventRow[], seed: number) => {
  const r = rng(seed);
  const copy = [...events];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// --------------------------------------------------------------------------- properties

describe('active licenses agree with an independent reference model', () => {
  it('at the end of every bucket and right now, for 300 random histories', () => {
    for (const seed of SEEDS) {
      const events = history(seed);
      const { points, current } = licenseSeries(events, bucket, NOW);
      const check = (got: (typeof points)[number], want: ReturnType<typeof reference>, label: string) => {
        expect({ active: got.active, seats: got.activeSeats, multi: got.multiDevice, i: got.byPlan.individual, b: got.byPlan.business }, `${label} seed ${seed}`).toEqual({
          active: want.active,
          seats: want.activeSeats,
          multi: want.multiDevice,
          i: want.individual,
          b: want.business,
        });
      };
      bucket.starts.forEach((start, i) => check(points[i], reference(events, Math.min(start + bucket.step, bucket.end, NOW + 1)), `bucket ${i}`));
      check(current, reference(events, NOW + 1), 'now');
    }
  });

  it('never goes negative, and the plan split always adds up to the active count', () => {
    for (const seed of SEEDS) {
      const { points, current } = licenseSeries(history(seed), bucket, NOW);
      for (const s of [...points, current]) {
        expect(s.active, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(s.byPlan.individual + s.byPlan.business, `seed ${seed}`).toBe(s.active);
        expect(s.activeSeats, `seed ${seed}`).toBeGreaterThanOrEqual(s.active);
        expect(s.multiDevice, `seed ${seed}`).toBeLessThanOrEqual(s.active);
      }
    }
  });
});

describe('buy attempts follow the definition for any history', () => {
  it('partition into converted, abandoned and pending, and match the rules', () => {
    for (const seed of SEEDS) {
      const events = history(seed);
      for (const windowDays of [1, 7, 30]) {
        const window = windowDays * DAY;
        const attempts = buyAttempts(events, windowDays, NOW);
        const clicks = events.filter((e) => e.type === 'buy_clicked');
        const entries = (customer: string) => events.filter((e) => e.customer_uuid === customer && (e.type === 'license_activated' || e.type === 'license_key_changed')).map((e) => e.occurred_at);

        for (const a of attempts) {
          const done = entries(a.customer);
          const inside = done.some((d) => d >= a.start && d <= a.start + window);
          expect(clicks.some((c) => c.customer_uuid === a.customer && c.occurred_at === a.start), `start is a click, seed ${seed}`).toBe(true);
          if (a.outcome === 'converted') expect(inside, `seed ${seed}`).toBe(true);
          if (a.outcome === 'abandoned') expect(inside || NOW < a.start + window, `seed ${seed}`).toBe(false);
          if (a.outcome === 'pending') expect(inside || NOW >= a.start + window, `seed ${seed}`).toBe(false);
          expect(a.late && a.outcome !== 'abandoned', `late only when abandoned, seed ${seed}`).toBe(false);
        }
        // Attempts of one customer start at least a window apart, and every click is covered by one.
        for (const customer of new Set(clicks.map((c) => c.customer_uuid))) {
          const starts = attempts.filter((a) => a.customer === customer).map((a) => a.start);
          for (let i = 1; i < starts.length; i += 1) expect(starts[i] - starts[i - 1], `seed ${seed}`).toBeGreaterThanOrEqual(window);
          for (const c of clicks.filter((x) => x.customer_uuid === customer)) {
            expect(starts.some((s) => c.occurred_at >= s && c.occurred_at < s + window), `click covered, seed ${seed}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('deactivations follow the definition for any history', () => {
  it('count every deactivation once and class it by what happened next', () => {
    for (const seed of SEEDS) {
      const events = history(seed);
      const result = deactivations(events);
      expect(result.length, `seed ${seed}`).toBe(events.filter((e) => e.type === 'license_deactivated').length);
      const sorted = order(events);
      for (const d of result) {
        const index = sorted.findIndex((e) => e.type === 'license_deactivated' && e.occurred_at === d.at && e.license_fp === d.license);
        expect(index, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        const source = sorted.filter((e) => e.type === 'license_deactivated' && e.occurred_at === d.at && e.license_fp === d.license);
        // any deactivation sharing this time and license gives the same answer set; check against the first that matches
        const outcomes = new Set(
          source.map((s) => {
            const from = sorted.indexOf(s);
            const later = sorted.slice(from + 1).filter((e) => (e.type === 'license_activated' || e.type === 'license_key_changed') && e.license_fp === d.license);
            return later.some((e) => seatOf(e) !== seatOf(s)) ? 'moved' : later.length > 0 ? 'same_device' : 'unused';
          }),
        );
        expect(outcomes.has(d.outcome), `seed ${seed}`).toBe(true);
      }
    }
  });
});

describe('the data layer adds up', () => {
  it('every series sums to its total, for any history and window', () => {
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    for (const seed of SEEDS) {
      const events = history(seed);
      for (const windowDays of [1, 7, 30]) {
        const b = buyingData(events, range, windowDays, NOW);
        expect(sum(b.series.converted), `seed ${seed}`).toBe(b.converted);
        expect(sum(b.series.abandoned), `seed ${seed}`).toBe(b.abandoned);
        expect(sum(b.series.pending), `seed ${seed}`).toBe(b.pending);
        expect(b.converted + b.abandoned + b.pending, `seed ${seed}`).toBe(b.attempts);
        expect(b.late, `seed ${seed}`).toBeLessThanOrEqual(b.abandoned);
        if (b.conversion_rate !== null) {
          expect(b.conversion_rate).toBeGreaterThanOrEqual(0);
          expect(b.conversion_rate).toBeLessThanOrEqual(1);
        }
      }
      const d = devicesData(events, range);
      expect(d.moved + d.same_device + d.unused, `seed ${seed}`).toBe(d.deactivations);
      expect(sum(d.series.moved) + sum(d.series.same_device) + sum(d.series.unused), `seed ${seed}`).toBe(d.deactivations);
      expect(sum(d.series.key_changes), `seed ${seed}`).toBe(d.key_changes);
      const l = licensesData(events, range, NOW);
      expect(l.series.active.at(-1), `seed ${seed}`).toBe(l.current.active);
      expect(l.current.individual + l.current.business, `seed ${seed}`).toBe(l.current.active);
      for (const series of [l.series.active, l.series.individual, l.series.business]) expect(series).toHaveLength(bucket.starts.length);
    }
  });

  it('is the same for every ordering of the same events (retries and offline apps deliver out of order)', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const events = history(seed);
      const mixed = shuffled(events, seed * 7 + 1);
      expect(buyingData(mixed, range, 7, NOW), `seed ${seed}`).toEqual(buyingData(events, range, 7, NOW));
      expect(licensesData(mixed, range, NOW), `seed ${seed}`).toEqual(licensesData(events, range, NOW));
      expect(devicesData(mixed, range), `seed ${seed}`).toEqual(devicesData(events, range));
    }
  });

  it('is plain JSON: no NaN, Infinity or undefined anywhere', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const events = history(seed);
      for (const data of [buyingData(events, range, 7, NOW), licensesData(events, range, NOW), devicesData(events, range)]) {
        const text = JSON.stringify(data);
        expect(text).not.toMatch(/null.*NaN|NaN|Infinity|undefined/);
        expect(JSON.parse(text)).toEqual(data);
      }
    }
  });
});

describe('the pages render for any history', () => {
  it('never throw and never print NaN, undefined or Infinity, short ranges and long', () => {
    const long = buildRange('2026-01-01', '2026-11-21');
    for (const seed of SEEDS.slice(0, 60)) {
      const events = history(seed);
      for (const r of [range, long]) {
        for (const tab of ['buying', 'licenses', 'devices'] as const) {
          const html = renderTelemetryTab({ tab, product: 'pinchpdf', range: r, windowDays: 7, error: null, available: true, missing: [] }, { events, installs: [], scans: null }, NOW_MS);
          expect(html, `${tab} seed ${seed}`).not.toMatch(/NaN|undefined|Infinity/);
          expect((html.match(/<svg/g) ?? []).length, `${tab} seed ${seed}`).toBe((html.match(/<\/svg>/g) ?? []).length);
          expect(html).toContain('<!doctype html>');
        }
      }
    }
  });
});
