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

// Protocol revision 5: the 2026-11-28 texts describe continuing a trial; the texts users already accepted are unchanged.
describe('2026-11-28 texts: continuing a trial on a recognised computer', () => {
  const body = (doc: { sections: { id: string; body: string[] }[] }, id: string) => doc.sections.find((s) => s.id === id)!.body.join('\n');
  const products = [
    { name: 'PinchPDF', versions: legalVersions, accepted: '2026-11-20', units: 'uses' },
    { name: 'NoDupe', versions: nodupeLegalVersions, accepted: '2026-11-24', units: 'scans' },
  ];

  for (const p of products) {
    it(`${p.name}: the terms say a reinstall continues the trial, how, and when another email is refused`, () => {
      const terms = body(p.versions.terms['2026-11-28'], 'one-trial-per-computer');
      expect(terms).toContain(`${p.name} is reinstalled`);
      expect(terms).toContain('continues where it was');
      expect(terms).toContain(`how many ${p.units} are left`);
      expect(terms).toContain('j•••@example.com');
      expect(terms).toContain('J••• D•••');
      expect(terms).toContain('replaces the one we held');
      expect(terms).toContain('If you do not continue that trial and register with a different email address instead, the registration is refused');
      expect(terms).toContain('A trial that we ended shows only the support reference');
      expect(terms).toContain('buy a license instead');
    });

    it(`${p.name}: the privacy notice covers the check, the automated decision, what the app shows and replacing details`, () => {
      const privacy = p.versions.privacy['2026-11-28'];
      expect(body(privacy, 'what-we-collect')).toContain('checks whether your computer already has a trial');
      expect(body(privacy, 'why')).toContain('continues that trial or is refused, are made automatically');
      expect(body(privacy, 'who-can-see-it')).toContain('never shows the full name or email address');
      expect(body(privacy, 'your-choices')).toContain('it replaces the one we held');
    });

    it(`${p.name}: the accepted ${p.accepted} texts are unchanged (no word of continuing)`, () => {
      for (const kind of kinds) {
        const old = JSON.stringify(p.versions[kind][p.accepted]);
        expect(old, kind).not.toMatch(/continue|•/i);
      }
      expect(body(p.versions.terms[p.accepted], 'one-trial-per-computer')).toContain(`If a trial was already used on your computer, ${p.name} shows a support reference.`);
    });
  }
});
