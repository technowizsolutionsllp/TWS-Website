// The public trial legal pages always show the LATEST text. There is one stable address for each:
//
//   /pinchpdf/legal/privacy       /pinchpdf/legal/trial-terms
//
// The app and every notice link to those. The old versioned addresses (/…/privacy/<version>)
// redirect to them, so a link can never point at superseded text.
//
// The version keys in versions.ts stay as the EFFECTIVE DATE of a text. The server records the key
// the user accepted (TRIAL_TERMS_VERSION / TRIAL_PRIVACY_VERSION in wrangler.json), which is the
// consent evidence. Because the site no longer keeps the old text, git history is the only copy of
// what an earlier key said. Keys are ISO dates, so the latest is the greatest.

import { legalVersions, type LegalKind, type LegalVersion } from './versions';

export const latestPaths: Record<LegalKind, string> = {
  terms: '/pinchpdf/legal/trial-terms',
  privacy: '/pinchpdf/legal/privacy',
};

export function latestLegalKey(kind: LegalKind): string {
  const keys = Object.keys(legalVersions[kind]).sort();
  const latest = keys[keys.length - 1];
  if (!latest) throw new Error(`No ${kind} text is defined`);
  return latest;
}

export function latestLegal(kind: LegalKind): { key: string; document: LegalVersion } {
  const key = latestLegalKey(kind);
  return { key, document: legalVersions[kind][key] };
}
