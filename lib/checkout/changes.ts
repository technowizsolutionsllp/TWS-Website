// What a save changes, and what it must check first. Used by the admin page's review step and by the change history.

import {
  PROVIDERS,
  PROVIDER_NAMES,
  TIERS,
  TIER_NAMES,
  activeSet,
  effective,
  hasEnded,
  isDated,
  linkKey,
  otherProvider,
  runningSet,
  setLabel,
  setName,
  spanText,
  type CheckoutConfig,
  type Provider,
  type Tier,
} from './config';

export type Change = { change: string; before: string; after: string; key: string | null };

const datesOf = (config: CheckoutConfig, i: number) => {
  const set = config.sets[i];
  return set ? `${set.starts_at ?? ''}|${set.ends_at ?? ''}` : '';
};

/** One row per change, in the order the review page and the change history show them. */
export function diffConfigs(saved: CheckoutConfig, draft: CheckoutConfig): Change[] {
  const rows: Change[] = [];
  if (saved.primary !== draft.primary) rows.push({ change: 'Primary provider', before: PROVIDER_NAMES[saved.primary], after: PROVIDER_NAMES[draft.primary], key: null });
  if (saved.force !== draft.force) rows.push({ change: draft.force ? 'Force turned on' : 'Force turned off', before: saved.force ? 'Forced' : 'Not forced', after: draft.force ? 'Forced' : 'Not forced', key: null });
  if (saved.default_set !== draft.default_set) rows.push({ change: 'Default set', before: setLabel(saved, saved.default_set), after: setLabel(draft, draft.default_set), key: null });
  const count = Math.max(saved.sets.length, draft.sets.length);
  for (let i = 0; i < count; i += 1) {
    const a = saved.sets[i];
    const b = draft.sets[i];
    if (a && !b) {
      rows.push({ change: `Set ${i + 1} removed`, before: a.name, after: '', key: null });
      continue;
    }
    if (!a) rows.push({ change: `Set ${i + 1} added`, before: '', after: b.name, key: null });
    else if (a.name !== b.name) rows.push({ change: `Set ${i + 1} renamed`, before: a.name, after: b.name, key: null });
    if (i > 0 && datesOf(saved, i) !== datesOf(draft, i) && (a || isDated(b))) {
      rows.push({ change: `Set ${i + 1} dates`, before: a ? (isDated(a) ? spanText(a) : 'No dates') : '', after: isDated(b) ? spanText(b) : 'No dates', key: null });
    }
    for (const provider of PROVIDERS) {
      b.links[provider].forEach((y, r) => {
        const x = a ? a.links[provider][r] : { type: y.type, url: '' };
        const key = linkKey(i, provider, r);
        const where = `Set ${i + 1}, ${PROVIDER_NAMES[provider]}, link ${r + 1}`;
        if (x.type !== y.type) rows.push({ change: `${where}: license type`, before: TIER_NAMES[x.type], after: TIER_NAMES[y.type], key: x.url === y.url && y.url ? key : null });
        if (x.url !== y.url) rows.push({ change: `${where} (${TIER_NAMES[y.type]})${y.url ? '' : ': cleared'}`, before: x.url, after: y.url, key: y.url ? key : null });
      });
    }
  }
  return rows;
}

function scheduleChanged(saved: CheckoutConfig, draft: CheckoutConfig, nowSec: number): boolean {
  return draft.sets.some((set, i) => i > 0 && isDated(set) && !hasEnded(set, nowSec) && datesOf(draft, i) !== datesOf(saved, i));
}

/** true when what buyers get changes, now or on a scheduled date. In Live such a save needs the confirmation tick. */
export function buyersChange(saved: CheckoutConfig, draft: CheckoutConfig, nowSec: number): boolean {
  return (
    saved.primary !== draft.primary ||
    saved.force !== draft.force ||
    saved.default_set !== draft.default_set ||
    activeSet(saved, nowSec) !== activeSet(draft, nowSec) ||
    scheduleChanged(saved, draft, nowSec)
  );
}

/** Sets whose buyer-facing links a save must cover: the default if it changed, a promotion whose dates changed, all of them when the primary changes or Force is turned on. */
export function coveredSets(saved: CheckoutConfig, draft: CheckoutConfig, nowSec: number): number[] {
  const out: number[] = [];
  const add = (n: number) => {
    if (!out.includes(n)) out.push(n);
  };
  const all = saved.primary !== draft.primary || (draft.force && !saved.force);
  if (all || saved.default_set !== draft.default_set) add(draft.default_set);
  if (all || activeSet(saved, nowSec) !== activeSet(draft, nowSec)) add(activeSet(draft, nowSec));
  draft.sets.forEach((set, i) => {
    if (i > 0 && isDated(set) && !hasEnded(set, nowSec) && (all || datesOf(draft, i) !== datesOf(saved, i))) add(i);
  });
  return out.sort((a, b) => a - b);
}

/**
 * The links a save must check with the providers: every new or changed link in any set (a changed license type counts),
 * plus the primary's links in the covered sets. A promotion is checked when it is scheduled, not when it starts, since
 * nobody is there to approve it then.
 */
export function linksToCheck(saved: CheckoutConfig, draft: CheckoutConfig, nowSec: number): string[] {
  const keys: string[] = [];
  draft.sets.forEach((set, i) => {
    for (const provider of PROVIDERS) {
      set.links[provider].forEach((b, r) => {
        const a = saved.sets[i]?.links[provider][r];
        if (b.url && (!a || a.url !== b.url || a.type !== b.type)) keys.push(linkKey(i, provider, r));
      });
    }
  });
  for (const n of coveredSets(saved, draft, nowSec)) {
    for (const tier of TIERS) {
      const e = effective(draft, n, tier, draft.primary);
      const key = linkKey(e.from, draft.primary, e.row);
      if (e.url && e.row >= 0 && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** Every link that is filled in (for "Check all links"). */
export function allLinkKeys(config: CheckoutConfig): string[] {
  return config.sets.flatMap((set, i) => PROVIDERS.flatMap((provider) => set.links[provider].flatMap((row, r) => (row.url ? [linkKey(i, provider, r)] : []))));
}

export function linkAt(config: CheckoutConfig, key: string): { set: number; provider: Provider; row: number; type: Tier; url: string } | null {
  const [s, p, r] = key.split('.');
  const set = config.sets[Number(s)];
  const provider = p as Provider;
  if (!set || !PROVIDERS.includes(provider) || (r !== '0' && r !== '1')) return null;
  const link = set.links[provider][Number(r)];
  return { set: Number(s), provider, row: Number(r), type: link.type, url: link.url };
}

export function keyLabel(config: CheckoutConfig, key: string): string {
  const link = linkAt(config, key);
  return link ? `Set ${link.set + 1}, ${PROVIDER_NAMES[link.provider]}, ${TIER_NAMES[link.type]}` : key;
}

/** The pages to open before confirming a Live change: one line per distinct page, with the sets that use it. */
export function pagesToConfirm(saved: CheckoutConfig, draft: CheckoutConfig, nowSec: number): { tier: Tier; provider: Provider; url: string; sets: number[] }[] {
  const pages: { tier: Tier; provider: Provider; url: string; sets: number[] }[] = [];
  for (const n of coveredSets(saved, draft, nowSec)) {
    for (const tier of TIERS) {
      const e = effective(draft, n, tier, draft.primary);
      if (!e.url) continue;
      const hit = pages.find((page) => page.url === e.url);
      if (hit) hit.sets.push(n + 1);
      else pages.push({ tier, provider: draft.primary, url: e.url, sets: [n + 1] });
    }
  }
  return pages;
}

export type Role = { text: string; tone: 'run' | 'plan' | 'idle' | 'warn' | 'bad' };

/** The role of a set, as its card header shows it. */
export function roleOf(config: CheckoutConfig, i: number, nowSec: number): Role {
  const set = config.sets[i];
  const running = runningSet(config, nowSec);
  if (i > 0 && isDated(set)) {
    if (hasEnded(set, nowSec)) return { text: `Ended ${spanText(set).split(' → ')[1]}`, tone: 'idle' };
    if (running === i) return { text: `Running${set.ends_at !== null ? ` until ${spanText(set).split(' → ')[1]}` : ', no end'}`, tone: 'run' };
    return { text: `Scheduled ${spanText(set)}`, tone: 'plan' };
  }
  if (config.default_set === i) return running >= 0 ? { text: `Default, paused while set ${running + 1} runs`, tone: 'idle' } : { text: 'Default: buyers get this now', tone: 'run' };
  return { text: 'Not in use', tone: 'warn' };
}

/** "Dodo Payments · Standard link" and its note, for one license. */
export function buyerLine(config: CheckoutConfig, tier: Tier, nowSec: number): { text: string; note: string; tone: 'ok' | 'warn' | 'bad' } {
  const set = activeSet(config, nowSec);
  const p = config.primary;
  const b = otherProvider(p);
  const pe = effective(config, set, tier, p);
  const be = effective(config, set, tier, b);
  const src = (from: number) => ` · ${setName(config, from)} link`;
  if (config.force) return pe.url ? { text: PROVIDER_NAMES[p] + src(pe.from), note: 'forced, no backup', tone: 'bad' } : { text: 'Nothing', note: 'forced, but the primary has no link', tone: 'bad' };
  if (pe.url && be.url) return { text: PROVIDER_NAMES[p] + src(pe.from), note: `backup ${PROVIDER_NAMES[b]}`, tone: 'ok' };
  if (pe.url) return { text: PROVIDER_NAMES[p] + src(pe.from), note: 'no backup link', tone: 'warn' };
  if (be.url) return { text: PROVIDER_NAMES[b] + src(be.from), note: 'backup: the primary has no link', tone: 'warn' };
  return { text: 'The link built into the app', note: 'nothing set here', tone: 'warn' };
}
