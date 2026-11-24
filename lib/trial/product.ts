// The products that share the trial and telemetry service. PinchPDF and NoDupe run the same code; only these
// settings differ: the endpoint paths, the D1 database, the domain-separation prefix that is mixed into every
// signature, hash and key derivation (so nothing made for one product is valid for the other), and how a free
// trial is counted (PinchPDF: one counter; NoDupe: one counter per scan mode).

import type { TrialEnv } from './config';

export const SCAN_MODES = ['basic', 'similar', 'deep'] as const;
export type ScanMode = (typeof SCAN_MODES)[number];
/** Scans used (or allowed) per mode. NoDupe only. */
export type ScanCounts = Record<ScanMode, number>;

export type ProductId = 'pinchpdf' | 'nodupe';

export type ProductSpec = {
  id: ProductId;
  name: string;
  /** Sealed and plain endpoints live under this path (protocol v1). It is also part of the sealed request AAD. */
  basePath: string;
  /** Insights JSON API for this product. */
  insightsBase: string;
  /** Prefix of every domain-separation string: `<prefix>-trial-v1 req`, `<prefix>-telemetry-v1`, and so on. */
  prefix: string;
  /** true: the trial counts scans per mode (NoDupe). false: one counter (PinchPDF). */
  perMode: boolean;
  /** Names of the Worker vars holding the accepted trial terms and privacy notice versions. */
  termsVersionVar: 'TRIAL_TERMS_VERSION' | 'NODUPE_TRIAL_TERMS_VERSION';
  privacyVersionVar: 'TRIAL_PRIVACY_VERSION' | 'NODUPE_TRIAL_PRIVACY_VERSION';
  /** The D1 binding that holds this product's tables, and the database name used by `wrangler d1 ... apply`. */
  dbBinding: 'TRIAL_DB' | 'NODUPE_DB';
  dbName: string;
};

export const PINCHPDF: ProductSpec = {
  id: 'pinchpdf',
  name: 'PinchPDF',
  basePath: '/api/pinchpdf/trial/v1/',
  insightsBase: '/api/pinchpdf/insights/v1/',
  prefix: 'pinchpdf',
  perMode: false,
  termsVersionVar: 'TRIAL_TERMS_VERSION',
  privacyVersionVar: 'TRIAL_PRIVACY_VERSION',
  dbBinding: 'TRIAL_DB',
  dbName: 'pinchpdf',
};

export const NODUPE: ProductSpec = {
  id: 'nodupe',
  name: 'NoDupe',
  basePath: '/api/nodupe/trial/v1/',
  insightsBase: '/api/nodupe/insights/v1/',
  prefix: 'nodupe',
  perMode: true,
  termsVersionVar: 'NODUPE_TRIAL_TERMS_VERSION',
  privacyVersionVar: 'NODUPE_TRIAL_PRIVACY_VERSION',
  dbBinding: 'NODUPE_DB',
  dbName: 'nodupe',
};

export const PRODUCT_SPECS: readonly ProductSpec[] = [PINCHPDF, NODUPE];

export function productById(id: string): ProductSpec | undefined {
  return PRODUCT_SPECS.find((p) => p.id === id);
}

/** NoDupe's free allowance: Basic (exact) 5, Similar 3, Deep 1. The app enforces it; the server stores the limits per trial. */
export const NODUPE_LIMITS: Readonly<ScanCounts> = { basic: 5, similar: 3, deep: 1 };

/** Extra values NoDupe's placeholder list treats as unusable, besides the shared list (lib/trial/signals.ts). */
export const NODUPE_EXTRA_PLACEHOLDERS: readonly string[] = ['duplicate-cleaner-fallback-machine-id'];

type DbEnv = Pick<TrialEnv, 'TRIAL_DB' | 'NODUPE_DB'>;

/** The product's database binding, or undefined when it is not bound in this deployment. */
export function productDb(env: DbEnv, product: ProductSpec): D1Database | undefined {
  return product.dbBinding === 'NODUPE_DB' ? env.NODUPE_DB : env.TRIAL_DB;
}

export function termsVersion(env: TrialEnv, product: ProductSpec): string | undefined {
  return env[product.termsVersionVar];
}

export function privacyVersion(env: TrialEnv, product: ProductSpec): string | undefined {
  return env[product.privacyVersionVar];
}

/** Rate-limit key: PinchPDF keeps its plain keys; other products are prefixed so the two never share a bucket. */
export function limitKey(product: ProductSpec, key: string): string {
  return product === PINCHPDF ? key : `${product.id}|${key}`;
}

export const sumCounts = (c: ScanCounts) => c.basic + c.similar + c.deep;
