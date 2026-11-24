export const CONTACT_RETENTION_DAYS: number;
export const RECORD_RETENTION_DAYS: number;
export function trialRetentionStatements(nowSeconds: number, contactDays?: number, recordDays?: number): string[];
