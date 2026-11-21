// Server-rendered SVG charts for the admin pages. No scripts, no external libraries.
// Colors come from CSS classes (s0..s3, ax, grid) so the page can follow light and dark mode.

export type ChartSeries = { name: string; cls: string; values: number[] };

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export const fmtNum = (value: number) => Math.round(value).toLocaleString('en-US');

function compact(value: number): string {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** A round upper bound for the y axis: 1, 2, 4, 5 or 10 times a power of ten. */
export function niceMax(max: number): number {
  if (max <= 0) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 4, 5, 10]) if (max <= step * power) return step * power;
  return 10 * power;
}

const W = 640;
const ML = 38;
const MR = 4;
const MT = 8;
const MB = 22;

/** Stacked column chart (a single series is just one segment per column). */
export function columnChart(options: { labels: string[]; series: ChartSeries[]; ariaLabel: string; height?: number; unit?: string }): string {
  const { labels, series, ariaLabel } = options;
  const height = options.height ?? 170;
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const top = niceMax(Math.max(0, ...totals));
  const plotW = W - ML - MR;
  const plotH = height - MT - MB;
  const base = MT + plotH;
  const band = plotW / Math.max(n, 1);
  const barW = Math.max(1, Math.min(18, band * 0.72));
  const y = (value: number) => base - (value / top) * plotH;

  const parts: string[] = [];
  parts.push(`<svg viewBox="0 0 ${W} ${height}" width="100%" role="img" aria-label="${esc(ariaLabel)}" xmlns="http://www.w3.org/2000/svg"><title>${esc(ariaLabel)}</title>`);
  for (let i = 0; i <= 4; i += 1) {
    const value = (top / 4) * i;
    parts.push(`<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`);
    parts.push(`<text class="ax" x="${ML - 6}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${compact(value)}</text>`);
  }
  const every = Math.max(1, Math.ceil(n / 10));
  labels.forEach((label, i) => {
    if (i % every === 0) parts.push(`<text class="ax" x="${(ML + band * i + band / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(label)}</text>`);
  });

  labels.forEach((label, i) => {
    const x = ML + band * i + (band - barW) / 2;
    let cumulative = 0;
    const lastNonZero = series.reduce((found, s, index) => ((s.values[i] ?? 0) > 0 ? index : found), -1);
    const detail = series.map((s) => `${s.name} ${fmtNum(s.values[i] ?? 0)}`).join(', ');
    parts.push(`<g><title>${esc(label)}: ${esc(detail)}${options.unit ? ` ${esc(options.unit)}` : ''}</title>`);
    parts.push(`<rect class="hit" x="${(ML + band * i).toFixed(1)}" y="${MT}" width="${band.toFixed(1)}" height="${plotH}"/>`);
    series.forEach((s, index) => {
      const value = s.values[i] ?? 0;
      if (value <= 0) return;
      const yTop = y(cumulative + value);
      const yBottom = y(cumulative);
      const gap = cumulative > 0 ? 1 : 0;
      const h = Math.max(0.5, yBottom - yTop - gap);
      const r = Math.min(3, barW / 2, h);
      if (index === lastNonZero) {
        parts.push(
          `<path class="${s.cls}" d="M${x.toFixed(1)},${(yTop + h).toFixed(1)}V${(yTop + r).toFixed(1)}Q${x.toFixed(1)},${yTop.toFixed(1)} ${(x + r).toFixed(1)},${yTop.toFixed(1)}H${(x + barW - r).toFixed(1)}Q${(x + barW).toFixed(1)},${yTop.toFixed(1)} ${(x + barW).toFixed(1)},${(yTop + r).toFixed(1)}V${(yTop + h).toFixed(1)}Z"/>`,
        );
      } else {
        parts.push(`<rect class="${s.cls}" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"/>`);
      }
      cumulative += value;
    });
    parts.push('</g>');
  });
  if (totals.every((t) => t === 0)) parts.push(`<text class="ax" x="${W / 2}" y="${MT + plotH / 2}" text-anchor="middle">No data in this range</text>`);
  parts.push('</svg>');
  return parts.join('');
}

/** Horizontal share bars as HTML: label, bar, count and percentage. */
export function shareBars(items: { label: string; count: number }[], total: number, cls = 's0'): string {
  if (items.length === 0) return '<p class="muted">No data in this range.</p>';
  return items
    .map((item) => {
      const pct = total > 0 ? (item.count / total) * 100 : 0;
      return `<div class="row"><span class="rl" title="${esc(item.label)}">${esc(item.label.length > 28 ? `${item.label.slice(0, 27)}…` : item.label)}</span><div class="track"><div class="fill ${cls}" style="width:${Math.min(100, pct).toFixed(1)}%"></div></div><span class="rv">${fmtNum(item.count)} · ${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%</span></div>`;
    })
    .join('');
}
