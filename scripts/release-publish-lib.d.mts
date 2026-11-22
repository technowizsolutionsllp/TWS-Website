import type { ReleaseEntry } from './release-lib.mjs';

export type ReleaseIndex = { product?: string; releases: ReleaseEntry[] };
export type GhResult = { status: number; stdout: string; stderr: string };
export type ReleaseIo = {
  log: (line: string) => void;
  gh: (args: string[]) => Promise<GhResult>;
  readFile: (path: string) => Promise<Uint8Array>;
  writeFile: (path: string, text: string) => Promise<void>;
  sha256: (bytes: Uint8Array) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  fetchBytes: (url: string) => Promise<{ status: number; bytes: Uint8Array }>;
  fetchJson: (url: string) => Promise<{ status: number; json: { version?: string } | null }>;
  confirm: (version: string) => Promise<boolean>;
};
export type PublishOptions = {
  product: string;
  version: string;
  installer: string;
  channel?: string;
  notes: string[];
  notesUrl?: string | null;
  minSupported?: string | null;
  mandatory?: boolean;
  rollout?: number;
  pubDate?: string;
  repo?: string;
  branch?: string;
  seed?: string;
  dryRun?: boolean;
  yes?: boolean;
  allowOlder?: boolean;
  site?: string | null;
  outDir?: string;
  updateCommand?: string;
  pageCommand?: string;
};
export type UpdateChanges = {
  rollout?: number;
  enabled?: boolean;
  mandatory?: boolean;
  minSupported?: string | null;
  notes?: string[];
  notesUrl?: string | null;
};
export const DEFAULT_REPO: string;
export const DEFAULT_SITE: string;
export const REPO_PATTERN: RegExp;
export const BRANCH_PATTERN: RegExp;
export function compareVersions(a: string, b: string): -1 | 0 | 1;
export function parseFlags(argv: string[], spec: { values?: string[]; booleans?: string[] }): { flags: Record<string, string | true>; positional: string[] };
export function checkNewer(index: ReleaseIndex | null, entry: ReleaseEntry, allowOlder?: boolean): void;
export function updateEntry(index: ReleaseIndex | null, version: string, changes: UpdateChanges): { index: ReleaseIndex; before: ReleaseEntry; after: ReleaseEntry; changed: string[] };
export function publishRelease(opts: PublishOptions, io: ReleaseIo): Promise<{ tag: string; entry: ReleaseEntry; published: boolean }>;
export function updateRelease(
  opts: { product: string; version: string; changes: UpdateChanges; repo?: string; branch?: string; dryRun?: boolean; yes?: boolean },
  io: ReleaseIo,
): Promise<{ changed: string[]; published: boolean }>;
export const DEFAULT_ROLLOUT: number;
export function isRepoName(repo: string): boolean;
export const PUBLISH_FLAGS: { values: string[]; booleans: string[] };
export const UPDATE_FLAGS: { values: string[]; booleans: string[] };
export type ArgsDeps = {
  makeIo: (repo: string) => ReleaseIo;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
  readText: (path: string) => Promise<string>;
};
export type PublishArgsOptions = {
  defaults?: { version: string; installer: (version: string) => string };
  updateCommand?: string;
  buildHint?: string;
  pageCommand?: string;
};
export function publishFromArgs(argv: string[], product: string, options: PublishArgsOptions | undefined, deps: ArgsDeps): Promise<{ tag: string; entry: ReleaseEntry; published: boolean }>;
export function updateFromArgs(argv: string[], product: string, deps: ArgsDeps, options?: { pageCommand?: string }): Promise<{ changed: string[]; published: boolean }>;
export function renderDownloadsPage(product: string, index: ReleaseIndex | null, repo: string): string;
export function renderDownloadsHtml(product: string, index: ReleaseIndex | null, repo: string): string;
export function pagesUrl(repo: string, product: string): string;
export function refreshPage(opts: { product: string; repo?: string; branch?: string; dryRun?: boolean }, io: ReleaseIo): Promise<{ ok: boolean; changed: boolean }>;
export function pageFromArgs(argv: string[], product: string, deps: ArgsDeps): Promise<{ ok: boolean; changed: boolean }>;
export const PAGE_FLAGS: { values: string[]; booleans: string[] };
