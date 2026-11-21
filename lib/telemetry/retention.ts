// How long telemetry events are kept, and the Health check reading that notices when the purge is overdue.
// The deletion itself is scripts/telemetry-purge.mjs (a test keeps the two numbers equal), and the
// privacy policy (app/privacy/page.tsx) must state the same period.

export const TELEMETRY_RETENTION_DAYS = 730;

// The purge is a manual, periodic job, so allow a month of slack before the Health check warns.
export const RETENTION_GRACE_DAYS = 30;

export type RetentionReading = { oldest: number | null; events: number };

export function retentionStatus(reading: RetentionReading, nowSeconds: number): { status: 'ok' | 'warn'; detail: string } {
  if (reading.oldest === null || reading.events === 0) return { status: 'ok', detail: 'No telemetry events are stored.' };
  const ageDays = Math.floor((nowSeconds - reading.oldest) / 86400);
  if (ageDays > TELEMETRY_RETENTION_DAYS + RETENTION_GRACE_DAYS) {
    return {
      status: 'warn',
      detail: `The oldest telemetry event is ${ageDays} days old; the policy keeps events for ${TELEMETRY_RETENTION_DAYS} days. Run: node scripts/telemetry-purge.mjs --run --remote`,
    };
  }
  return { status: 'ok', detail: `Oldest telemetry event is ${ageDays} days old (policy: ${TELEMETRY_RETENTION_DAYS} days). ${reading.events} events stored.` };
}
