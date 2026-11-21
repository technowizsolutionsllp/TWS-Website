// Guards for the legal pages: nothing with an unresolved owner decision can ship, the old app links
// still redirect, and /privacy and /terms stay the places the documents live.

import { describe, expect, it } from 'vitest';
import { appLinkPaths, latestPaths } from '../app/pinchpdf/legal/latest';
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

  it('redirect every old trial address (with and without a version) to the text inside them', async () => {
    const redirects = await nextConfig.redirects!();
    const target = (source: string) => redirects.find((r) => r.source === source)?.destination;
    expect(target(appLinkPaths.privacy)).toBe(latestPaths.privacy);
    expect(target(`${appLinkPaths.privacy}/:version`)).toBe(latestPaths.privacy);
    expect(target(appLinkPaths.terms)).toBe(latestPaths.terms);
    expect(target(`${appLinkPaths.terms}/:version`)).toBe(latestPaths.terms);
    expect(target('/license')).toBe('/terms#software-license');
  });

  it('point every anchor the app and the pages use at an id that exists', () => {
    const text = appFiles.map(read).join('\n');
    for (const id of ['pinchpdf-trial', 'pinchpdf-license-events', 'schedule-a-trial', 'software-license', 'website-terms']) {
      expect(text, id).toMatch(new RegExp(`id=["']${id}["']|id: ['"]${id}['"]`));
    }
  });
});
