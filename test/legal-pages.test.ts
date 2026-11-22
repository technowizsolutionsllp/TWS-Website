// Guards for the legal pages: nothing with an unresolved owner decision can ship, the old app links
// still redirect, and /privacy and /terms stay the places the documents live.

import { describe, expect, it } from 'vitest';
import { latestPaths } from '../app/pinchpdf/legal/latest';
import { legalVersions } from '../app/pinchpdf/legal/versions';
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
    const all = Object.values(legalVersions).flatMap((byKey) => Object.values(byKey)).flatMap((doc) => doc.sections.flatMap((s) => s.body));
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
  });

  it('point every anchor the app and the pages use at an id that exists', () => {
    const text = appFiles.map(read).join('\n');
    for (const id of ['pinchpdf-trial', 'pinchpdf-license-events', 'schedule-a-trial', 'software-license', 'website-terms']) {
      expect(text, id).toMatch(new RegExp(`id=["']${id}["']|id: ['"]${id}['"]`));
    }
  });
});
