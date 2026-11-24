// NoDupe's trial legal texts always show the LATEST version, like PinchPDF's (app/pinchpdf/legal/latest.ts). They are
// rendered inside the privacy policy (Annex B, /privacy#nodupe-trial) and the terms (Schedule B, Part 2,
// /terms#schedule-b-trial). The NoDupe app links to those addresses, so a link can never point at superseded text.
//
// The version keys in versions.ts stay as the EFFECTIVE DATE of a text. The server records the key the user
// accepted (NODUPE_TRIAL_TERMS_VERSION / NODUPE_TRIAL_PRIVACY_VERSION in wrangler.json), which is the consent
// evidence. Keys are ISO dates, so the latest is the greatest.

import type { LegalKind, LegalVersion } from '../../pinchpdf/legal/versions';
import { nodupeLegalVersions } from './versions';

// Where each text is shown to readers.
export const latestNodupePaths: Record<LegalKind, string> = {
  terms: '/terms#schedule-b-trial',
  privacy: '/privacy#nodupe-trial',
};

export function latestNodupeLegalKey(kind: LegalKind): string {
  const keys = Object.keys(nodupeLegalVersions[kind]).sort();
  const latest = keys[keys.length - 1];
  if (!latest) throw new Error(`No NoDupe ${kind} text is defined`);
  return latest;
}

export function latestNodupeLegal(kind: LegalKind): { key: string; document: LegalVersion } {
  const key = latestNodupeLegalKey(kind);
  return { key, document: nodupeLegalVersions[kind][key] };
}
