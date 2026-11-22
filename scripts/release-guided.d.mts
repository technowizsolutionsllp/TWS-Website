import type { ArgsDeps, PublishArgsOptions } from './release-publish-lib.mjs';

export const NOTES_FILE: string;
export function parseReleaseNotes(text: string, version: string): string[] | null;
export function notesProblem(notes: string[]): string | null;
export function installerLocation(installerFor: (version: string) => string): { folder: string; pattern: RegExp };
export type InstallerRow = { version: string; channel: string; file: string; size: number; built: number; status: 'new' | 'published' | 'older'; note: string };
export function classifyInstallers(
  files: { name: string; size: number; mtimeMs: number }[],
  location: { folder: string; pattern: RegExp },
  index: { releases: { version: string; channel: string }[] } | null,
  allowOlder?: boolean,
): InstallerRow[];
export function isGuidedPublish(argv: string[], deps: ArgsDeps): boolean;
export function isGuidedUpdate(argv: string[], deps: ArgsDeps): boolean;
export function guidedPublish(argv: string[], product: string, options: PublishArgsOptions | undefined, deps: ArgsDeps): Promise<{ published: string[] }>;
export function guidedUpdate(
  argv: string[],
  product: string,
  deps: ArgsDeps,
  options?: { pageCommand?: string; publishCommand?: string },
): Promise<{ changed: string[]; published: boolean }>;
