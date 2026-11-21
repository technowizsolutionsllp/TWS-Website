export const DEFAULT_RETENTION_DAYS: number;
export function purgeStatements(nowSeconds: number, days?: number): string[];
export function eraseStatements(customerUuid: string): string[];
