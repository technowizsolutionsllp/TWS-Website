// NoDupe's scan counts for Insights, read from its trials table (one counter per mode). Counts only: nothing
// here identifies a person, an email, a device or a trial.

import type { Range } from '../admin/range';
import { NODUPE_LIMITS, SCAN_MODES, type ScanCounts } from '../trial/product';

export type ScanGroup = {
  trials: number;
  /** Scans used, summed over the trials. */
  used: ScanCounts;
  /** Trials that have used their whole allowance in a mode. */
  atLimit: ScanCounts;
  /** Trials at their limit in every mode. */
  allModesAtLimit: number;
};

export type ScanStats = {
  /** Trials registered inside the range, with how many sit at each count per mode (index = scans used). */
  cohort: ScanGroup & { histogram: Record<(typeof SCAN_MODES)[number], number[]> };
  /** Every NoDupe trial. */
  all: ScanGroup;
};

type Row = Record<string, number | null>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);

const GROUP_SQL = `SELECT COUNT(*) AS n,
    COALESCE(SUM(used_basic), 0) AS ub, COALESCE(SUM(used_similar), 0) AS us, COALESCE(SUM(used_deep), 0) AS ud,
    COALESCE(SUM(used_basic >= limit_basic), 0) AS lb, COALESCE(SUM(used_similar >= limit_similar), 0) AS ls, COALESCE(SUM(used_deep >= limit_deep), 0) AS ld,
    COALESCE(SUM(used_basic >= limit_basic AND used_similar >= limit_similar AND used_deep >= limit_deep), 0) AS la
  FROM trials WHERE status != 'reset'`;

function group(row: Row | undefined): ScanGroup {
  return {
    trials: num(row?.n),
    used: { basic: num(row?.ub), similar: num(row?.us), deep: num(row?.ud) },
    atLimit: { basic: num(row?.lb), similar: num(row?.ls), deep: num(row?.ld) },
    allModesAtLimit: num(row?.la),
  };
}

export async function loadScanStats(db: D1Database, range: Range): Promise<ScanStats> {
  const cohort = 'created_at >= ?1 AND created_at < ?2';
  const histogram = (column: string) => db.prepare(`SELECT ${column} AS v, COUNT(*) AS c FROM trials WHERE status != 'reset' AND ${cohort} GROUP BY v`).bind(range.fromSec, range.toSecExclusive);
  const results = await db.batch([
    db.prepare(`${GROUP_SQL} AND ${cohort}`).bind(range.fromSec, range.toSecExclusive),
    db.prepare(GROUP_SQL),
    histogram('used_basic'),
    histogram('used_similar'),
    histogram('used_deep'),
  ]);
  const rows = (index: number) => (results[index].results ?? []) as Row[];
  const histograms = {} as ScanStats['cohort']['histogram'];
  SCAN_MODES.forEach((mode, i) => {
    const values = new Array<number>(NODUPE_LIMITS[mode] + 1).fill(0);
    for (const row of rows(2 + i)) {
      const at = num(row.v);
      if (at >= 0 && at < values.length) values[at] += num(row.c);
    }
    histograms[mode] = values;
  });
  return { cohort: { ...group(rows(0)[0]), histogram: histograms }, all: group(rows(1)[0]) };
}
