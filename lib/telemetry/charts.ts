// Server-rendered SVG charts for the Insights dashboard. No scripts and no inline styles, so the page
// can run under a strict Content-Security-Policy; colors come from CSS classes defined in page.ts.
// Every chart has a legend (identity is never color alone), native hover tooltips and a table view.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function esc(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "3 Nov" for a UTC timestamp in seconds. */
export function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export type Series = { name: string; slot: 1 | 2 | 3 };

const W = 720;
const H = 250;
const M = { left: 40, right: 12, top: 14, bottom: 30 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

/** A tidy axis maximum and tick step (1, 2, 5 times a power of ten), at least 4 steps of headroom-free ticks. */
export function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  return { top: Math.ceil(max / step) * step, step };
}

function axes(labels: string[], top: number, step: number): string {
  const parts: string[] = [];
  for (let v = 0; v <= top; v += step) {
    const y = M.top + PLOT_H - (v / top) * PLOT_H;
    parts.push(`<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<text class="tick" x="${M.left - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${v}</text>`);
  }
  const every = Math.ceil(labels.length / 8);
  labels.forEach((label, i) => {
    // Counted back from the newest bucket, so the latest label is always shown and none collide with it.
    if ((labels.length - 1 - i) % every !== 0) return;
    const x = M.left + ((i + 0.5) / labels.length) * PLOT_W;
    parts.push(`<text class="tick" x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(label)}</text>`);
  });
  return parts.join('');
}

function legend(series: Series[]): string {
  if (series.length < 2) return '';
  return `<ul class="legend">${series.map((s) => `<li><span class="sw f${s.slot}"></span>${esc(s.name)}</li>`).join('')}</ul>`;
}

function table(labels: string[], series: Series[], data: number[][], firstColumn: string): string {
  const head = `<tr><th scope="col">${esc(firstColumn)}</th>${series.map((s) => `<th scope="col">${esc(s.name)}</th>`).join('')}</tr>`;
  const rows = labels.map((label, i) => `<tr><th scope="row">${esc(label)}</th>${series.map((_, s) => `<td>${data[s][i]}</td>`).join('')}</tr>`);
  return `<details class="tableview"><summary>Show as table</summary><table>${head}${rows.join('')}</table></details>`;
}

function frame(title: string, subtitle: string, body: string, series: Series[], tableHtml: string): string {
  return `<figure class="chart"><figcaption><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></figcaption>${legend(series)}${body}${tableHtml}</figure>`;
}

/** Stacked weekly bars. data[s][i] is series s in bucket i. */
export function stackedBars(opts: { title: string; subtitle: string; labels: string[]; series: Series[]; data: number[][]; firstColumn: string }): string {
  const { labels, series, data } = opts;
  const totals = labels.map((_, i) => series.reduce((sum, _s, s) => sum + data[s][i], 0));
  const { top, step } = niceScale(Math.max(0, ...totals));
  const slot = PLOT_W / labels.length;
  const barW = Math.min(44, slot * 0.62);
  const rects: string[] = [];
  labels.forEach((label, i) => {
    const x = M.left + i * slot + (slot - barW) / 2;
    let y = M.top + PLOT_H;
    series.forEach((s, k) => {
      const value = data[k][i];
      if (value <= 0) return;
      const h = (value / top) * PLOT_H;
      y -= h;
      rects.push(
        `<rect class="seg f${s.slot}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(label)}: ${esc(s.name)} ${value}</title></rect>`,
      );
    });
  });
  const empty = totals.every((t) => t === 0) ? `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No data in this period yet</text>` : '';
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title)}">${axes(labels, top, step)}<line class="base" x1="${M.left}" x2="${W - M.right}" y1="${M.top + PLOT_H}" y2="${M.top + PLOT_H}"/>${rects.join('')}${empty}</svg>`;
  return frame(opts.title, opts.subtitle, svg, series, table(labels, series, data, opts.firstColumn));
}

/** One line over time, with the latest value labelled. */
export function lineChart(opts: { title: string; subtitle: string; labels: string[]; name: string; values: number[]; firstColumn: string }): string {
  const { labels, values } = opts;
  const { top, step } = niceScale(Math.max(0, ...values));
  const point = (i: number) => ({
    x: M.left + ((i + 0.5) / labels.length) * PLOT_W,
    y: M.top + PLOT_H - (values[i] / top) * PLOT_H,
  });
  const path = values.map((_, i) => `${i === 0 ? 'M' : 'L'}${point(i).x.toFixed(1)} ${point(i).y.toFixed(1)}`).join(' ');
  const hits = values
    .map((v, i) => `<circle class="hit" cx="${point(i).x.toFixed(1)}" cy="${point(i).y.toFixed(1)}" r="9"><title>${esc(labels[i])}: ${v}</title></circle>`)
    .join('');
  const last = point(values.length - 1);
  const lastLabel = `<circle class="dot f1" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4"/><text class="endlabel" x="${(last.x - 8).toFixed(1)}" y="${(last.y - 10).toFixed(1)}" text-anchor="end">${values[values.length - 1]}</text>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title)}">${axes(labels, top, step)}<line class="base" x1="${M.left}" x2="${W - M.right}" y1="${M.top + PLOT_H}" y2="${M.top + PLOT_H}"/><path class="line l1" d="${path}"/>${lastLabel}${hits}</svg>`;
  return frame(opts.title, opts.subtitle, svg, [{ name: opts.name, slot: 1 }], table(labels, [{ name: opts.name, slot: 1 }], [values], opts.firstColumn));
}

/** A headline number with its label. */
export function stat(label: string, value: string | number, note = ''): string {
  return `<div class="stat"><div class="statvalue">${esc(value)}</div><div class="statlabel">${esc(label)}</div>${note ? `<div class="statnote">${esc(note)}</div>` : ''}</div>`;
}
