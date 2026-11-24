// Guards for the legal pages: nothing with an unresolved owner decision can ship, the old app links
// still redirect, and /privacy and /terms stay the places the documents live.

import { describe, expect, it } from 'vitest';
import { latestPaths } from '../app/pinchpdf/legal/latest';
import { legalVersions } from '../app/pinchpdf/legal/versions';
import { latestNodupePaths } from '../app/nodupe/legal/latest';
import { nodupeLegalVersions } from '../app/nodupe/legal/versions';
import nextConfig from '../next.config';

// Every source file under app/, as text (paths like "../app/terms/page.tsx").
const sources = import.meta.glob(['../app/**/*.ts', '../app/**/*.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const appFiles = Object.keys(sources);
const read = (file: string) => sources[file];

describe('legal pages', () => {
  it('have no unresolved "OWNER TO CONFIRM" decisions (resolve them before this ships)', () => {
    const open = appFiles.flatMap((file) => read(file).split('\n').map((line, i) => ({ file, line: i + 1, text: line })).filter((l) => /OWNER TO CONFIRM/.test(l.text) && !/^\s*(\/\/|\*|\/\*)/.test(l.text)));
    expect(open.map((o) => `${o.file}:${o.line}`), 'unresolved owner decisions in the legal text').toEqual([]);
  });

  it('also have none inside the texts in versions.ts', () => {
    const all = [...Object.values(legalVersions), ...Object.values(nodupeLegalVersions)].flatMap((byKey) => Object.values(byKey)).flatMap((doc) => doc.sections.flatMap((s) => s.body));
    expect(all.filter((p) => /OWNER TO CONFIRM/.test(p))).toEqual([]);
  });

  it('keep /privacy and /terms as the pages that host the documents', () => {
    const files = appFiles.map((f) => f.replace('../', ''));
    expect(files).toContain('app/privacy/page.tsx');
    expect(files).toContain('app/terms/page.tsx');
    expect(files.filter((f) => /^app\/(license|policy)\//.test(f))).toEqual([]);
  });

  it('no longer redirects the old /pinchpdf/legal/... addresses (removed), and keeps /license pointing at the license agreement', async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects.filter((r) => r.source.startsWith('/pinchpdf/legal'))).toEqual([]);
    expect(redirects.find((r) => r.source === '/license')?.destination).toBe('/terms#software-license');
    expect(latestPaths).toEqual({ terms: '/terms#schedule-a-trial', privacy: '/privacy#pinchpdf-trial' });
    expect(latestNodupePaths).toEqual({ terms: '/terms#schedule-b-trial', privacy: '/privacy#nodupe-trial' });
  });

  it('point every anchor the app and the pages use at an id that exists', () => {
    const text = appFiles.map(read).join('\n');
    for (const id of ['pinchpdf-trial', 'pinchpdf-license-events', 'schedule-a-trial', 'software-license', 'website-terms', 'nodupe-trial', 'nodupe-license-events', 'install-events', 'schedule-b-trial', 'exercise-rights']) {
      expect(text, id).toMatch(new RegExp(`id=["']${id}["']|id: ['"]${id}['"]`));
    }
  });
});

describe('NoDupe mirrors PinchPDF', () => {
  const headings = (doc: { sections: { id: string }[] }) => doc.sections.map((section) => section.id);

  it('has the same trial terms and privacy notice sections as PinchPDF, in the same order', () => {
    for (const kind of ['terms', 'privacy'] as const) {
      const pinch = Object.values(legalVersions[kind]).at(-1)!;
      const nodupe = Object.values(nodupeLegalVersions[kind]).at(-1)!;
      expect(headings(nodupe), kind).toEqual(headings(pinch));
    }
  });

  it('names the three scan modes in NoDupe\'s trial text and never talks about PinchPDF compressions', () => {
    const text = Object.values(nodupeLegalVersions).flatMap((byKey) => Object.values(byKey)).flatMap((doc) => doc.sections.flatMap((s) => s.body)).join('\n');
    for (const word of ['Basic', 'Similar', 'Deep']) expect(text).toContain(word);
    expect(text).not.toMatch(/compress/i);
    expect(text).toContain('5 Basic scans, 3 Similar scans and 1 Deep scan');
  });

  it('describes registration and the device check the same way, with no leftover "no registration" claim anywhere in the legal pages', () => {
    const pages = ['../app/privacy/page.tsx', '../app/terms/SoftwareLicense.tsx'].map(read).join('\n');
    expect(pages).not.toMatch(/does not ask you to register|needs no registration|needs no account/i);
    expect(pages).not.toContain('scan-count report');
  });
});
