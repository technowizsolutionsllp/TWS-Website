// The tab row at the top of /admin/insights: Trials (the original page) and the app-telemetry tabs.
// Plain links, so a view can be bookmarked and the pages work with JavaScript off.

import { esc } from './charts';
import type { ProductChoice, Range } from './range';

export const INSIGHT_TABS = [
  { id: 'trials', label: 'Trials' },
  { id: 'buying', label: 'Buying' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'devices', label: 'Devices' },
  { id: 'installs', label: 'Installs' },
  { id: 'scans', label: 'Scans' },
] as const;

export type InsightTab = (typeof INSIGHT_TABS)[number]['id'];

export function isInsightTab(value: string | null): value is InsightTab {
  return INSIGHT_TABS.some((tab) => tab.id === value);
}

export function tabNav(active: InsightTab, product: ProductChoice, range: Range, windowDays?: number): string {
  const links = INSIGHT_TABS.map((tab) => {
    const window = windowDays === undefined ? '' : `&window=${windowDays}`;
    const href = `/admin/insights?tab=${tab.id}&product=${product}&from=${range.from}&to=${range.to}${window}`;
    return `<a href="${href}"${tab.id === active ? ' aria-current="true"' : ''}>${esc(tab.label)}</a>`;
  }).join('');
  return `<nav class="bar" aria-label="Insights sections"><div class="seg">${links}</div></nav>`;
}
