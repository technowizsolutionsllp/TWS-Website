// Device matching policy (protocol section 2). Pure functions, no I/O.
//
// Signal types never cross: guid only meets guid, smbios only smbios, board only board.
// A stored row BLOCKS a request iff |B| >= 1 and M >= min(2, |B|), where
//   B = signals usable in both, M = how many of B are equal.

export const SIGNAL_NAMES = ['guid', 'smbios', 'board'] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];
export type Signals = Record<SignalName, string | null>;

export type StoredDevice = {
  id: string;
  support_ref: string;
  status: string;
  signals: Signals;
};

export function usableSignalCount(signals: Signals): number {
  return SIGNAL_NAMES.filter((name) => signals[name] !== null).length;
}

export function rowBlocks(request: Signals, row: Signals): boolean {
  let both = 0;
  let equal = 0;
  for (const name of SIGNAL_NAMES) {
    const a = request[name];
    const b = row[name];
    if (a === null || b === null) continue;
    both += 1;
    if (a === b) equal += 1;
  }
  return both >= 1 && equal >= Math.min(2, both);
}

/** First blocking row among those not reset, in the order given; null when none blocks. */
export function findBlockingRow(request: Signals, rows: StoredDevice[]): StoredDevice | null {
  for (const row of rows) {
    if (row.status === 'reset') continue;
    if (rowBlocks(request, row.signals)) return row;
  }
  return null;
}
