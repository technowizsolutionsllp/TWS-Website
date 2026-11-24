// The trial legal pages always point at the latest text.

import { describe, expect, it } from 'vitest';
import { latestLegal, latestLegalKey, latestPaths } from '../app/pinchpdf/legal/latest';
import { legalVersions, type LegalKind } from '../app/pinchpdf/legal/versions';
import { latestNodupeLegal, latestNodupeLegalKey, latestNodupePaths } from '../app/nodupe/legal/latest';
import { nodupeLegalVersions } from '../app/nodupe/legal/versions';
import wrangler from '../wrangler.json';

const kinds: LegalKind[] = ['terms', 'privacy'];

describe('latest legal text', () => {
  it('shows each trial text inside /terms and /privacy', () => {
    expect(latestPaths).toEqual({ terms: '/terms#schedule-a-trial', privacy: '/privacy#pinchpdf-trial' });
  });

  it('is the greatest effective date, whatever order the keys are written in', () => {
    for (const kind of kinds) {
      const keys = Object.keys(legalVersions[kind]).sort();
      expect(latestLegalKey(kind)).toBe(keys[keys.length - 1]);
      expect(latestLegal(kind).document).toBe(legalVersions[kind][latestLegalKey(kind)]);
    }
  });

  it('is the text the server asks users to accept (so the consent evidence matches what the page shows)', () => {
    expect(latestLegalKey('terms')).toBe(wrangler.vars.TRIAL_TERMS_VERSION);
    expect(latestLegalKey('privacy')).toBe(wrangler.vars.TRIAL_PRIVACY_VERSION);
  });

  it('has a key that is the same as the text\'s own effective date', () => {
    for (const kind of kinds) for (const [key, text] of Object.entries(legalVersions[kind])) expect(text.effective, `${kind} ${key}`).toBe(key);
  });
});

describe('latest NoDupe legal text', () => {
  it('shows each trial text inside /terms and /privacy', () => {
    expect(latestNodupePaths).toEqual({ terms: '/terms#schedule-b-trial', privacy: '/privacy#nodupe-trial' });
  });

  it('is the greatest effective date, and is the text the server asks NoDupe users to accept', () => {
    for (const kind of kinds) {
      const keys = Object.keys(nodupeLegalVersions[kind]).sort();
      expect(latestNodupeLegalKey(kind)).toBe(keys[keys.length - 1]);
      expect(latestNodupeLegal(kind).document).toBe(nodupeLegalVersions[kind][latestNodupeLegalKey(kind)]);
    }
    expect(latestNodupeLegalKey('terms')).toBe(wrangler.vars.NODUPE_TRIAL_TERMS_VERSION);
    expect(latestNodupeLegalKey('privacy')).toBe(wrangler.vars.NODUPE_TRIAL_PRIVACY_VERSION);
  });

  it('has a key that is the same as the text\'s own effective date', () => {
    for (const kind of kinds) for (const [key, text] of Object.entries(nodupeLegalVersions[kind])) expect(text.effective, `${kind} ${key}`).toBe(key);
  });
});
