// Chart primitives and input validators for the GitHub evidence package. No chart library: every chart is a hand-built SVG string,
// so the files stay small and diff cleanly. The pipeline that decides WHAT to draw is scripts/evidence-visualizations.mjs.
//
// Rendering rules (they exist because GitHub shows an SVG linked with ![](...) as an <img>):
//  * `currentColor` renders BLACK in an <img>, invisible on GitHub's dark theme, so no colour is ever inherited. Every chart paints its own
//    opaque white background with a subtle border and gives every text, line and bar an explicit colour: it reads the same in both themes.
//  * viewBox width 800, text 13 units or larger, bar axes start at zero, no 3D, no truncated axes.
//  * Colour-blind-safe palette (Okabe-Ito subset), at most five hues, and colour is never the only signal: values are printed on the marks,
//    legends name every series and the second series of a pair is hatched.
//  * Text boxes are measured (conservatively) while drawing; a label that would run outside the chart is an error, not a clipped label.
import { readFileSync } from 'node:fs';

export const W = 800;
export const M = 24; // outer margin
export const COLORS = {
  bg: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#57606a', grid: '#d0d7de', panel: '#f6f8fa',
  blue: '#0072B2', orange: '#D55E00', green: '#009E73', amber: '#E69F00', grey: '#6e7781',
};
// Fixed meaning across every chart: blue = the main measured series, orange = the thing to look at (over a cap, late, the weak spot),
// green = a good / within-limit state, amber = a warning state, grey = neutral / omitted.
export const SERIES_COLORS = [COLORS.blue, COLORS.amber, COLORS.green];
const FONT = 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const num = (n) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
export const fmt = (n) => Math.round(n) === n ? n.toLocaleString('en-US') : String(Math.round(n * 1000) / 1000);
export const pct = (frac, digits = 1) => `${(frac * 100).toFixed(digits)}%`;

/** Conservative width of a string in the chart font (average sans-serif glyph is about 0.52 em; 0.58 leaves headroom). */
export const textW = (s, size = 14, weight = 400) => String(s).length * size * 0.58 * (weight >= 600 ? 1.07 : 1);

export function truncate(label, maxChars) {
  const s = String(label);
  return s.length <= maxChars ? s : s.slice(0, maxChars - 1) + '…';
}

/** Greedy word wrap to a pixel width. */
export function wrap(text, maxPx, size = 14, weight = 400) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textW(next, size, weight) <= maxPx || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

export function niceMax(max, ticks = 5) {
  if (!(max > 0)) return { max: 1, step: 0.2 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { max: Math.ceil(max / step - 1e-9) * step, step };
}

export function loadJson(path, hint) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${path} (${err.message}). Produce it with: ${hint}`);
  }
}

// ---------------------------------------------------------------- input validators

export const BENCH_HINT = 'npm run load:test -- --out <path> (run in api/)';
export const METRICS_HINT = 'python3 -m training.evaluate (run in formcheck/)';

// loadJson proves the producer file exists; this proves it has the shape the charts read, so a truncated or renamed-field file fails
// naming the field and the producer, not with a bare TypeError.
export function validateBench(bench) {
  const bad = (field, want) => {
    throw new Error(`Bench JSON is missing ${field} (${want}). Produce it with: ${BENCH_HINT}`);
  };
  if (!bench || typeof bench !== 'object') bad('the whole object', 'expected a JSON object');
  if (typeof bench.commit !== 'string' || !bench.commit) bad('commit', 'a string');
  if (typeof bench.date !== 'string' || !bench.date) bad('date', 'an ISO date string');
  if (!Array.isArray(bench.reads) || bench.reads.length === 0) bad('reads', 'a non-empty array');
  bench.reads.forEach((r, i) => {
    if (!r || typeof r.screen !== 'string') bad(`reads[${i}].screen`, 'a string');
    if (!isNum(r.p95ms)) bad(`reads[${i}].p95ms`, 'a number');
  });
  if (!bench.data || typeof bench.data !== 'object') bad('data', 'an object');
  for (const k of ['applications', 'deadlineItems', 'openDeadlineItems', 'assignments']) {
    if (!isNum(bench.data[k])) bad(`data.${k}`, 'a number');
  }
  if (!bench.engine || typeof bench.engine !== 'object') bad('engine', 'an object');
  for (const k of ['firstCycle', 'secondCycle']) {
    if (!bench.engine[k] || !isNum(bench.engine[k].newAlerts)) bad(`engine.${k}.newAlerts`, 'a number');
    if (!isNum(bench.engine[k].ms)) bad(`engine.${k}.ms`, 'a number');
    // Optional (runs before 2026-11-04 did not measure it), but never a wrong type when present.
    if (bench.engine[k].alertsSuppressed !== undefined && !isNum(bench.engine[k].alertsSuppressed)) bad(`engine.${k}.alertsSuppressed`, 'a number');
  }
}

export function validateMetrics(metrics) {
  const bad = (field, want) => {
    throw new Error(`Metrics JSON is missing ${field} (${want}). Produce it with: ${METRICS_HINT}`);
  };
  if (!metrics || typeof metrics.generatedAt !== 'string' || !metrics.generatedAt) bad('generatedAt', 'an ISO timestamp; re-run the evaluation to stamp it');
  if (!metrics || typeof metrics.modes !== 'object' || metrics.modes === null || Object.keys(metrics.modes).length === 0) bad('modes', 'a non-empty object');
  for (const [name, m] of Object.entries(metrics.modes)) {
    for (const k of ['precision', 'recall', 'false_alarm_rate']) if (!isNum(m?.[k])) bad(`modes["${name}"].${k}`, 'a number');
  }
}

// ---------------------------------------------------------------- the chart builder

/**
 * A chart under construction. Drawing methods append SVG and advance `y`; each records what it plotted in `model.marks` so a test can compare
 * the plotted numbers with the source JSON without parsing SVG. `render` closes the chart with a provenance footer.
 *   const c = chart({ id, title, subtitle, desc });  c.hbars(...);  const { svg, model } = c.render({ provenance, source, stamp });
 */
export function chart({ id, title, subtitle = '', desc = '' }) {
  const parts = [];
  const defs = [];
  const boxes = [];
  const model = { id, title, provenance: null, source: null, stamp: null, notAvailable: null, marks: [] };
  const c = { y: 0, model };

  const t = (x, y, s, { size = 14, weight = 400, anchor = 'start', fill = COLORS.text, italic = false } = {}) => {
    const w = textW(s, size, weight);
    const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    boxes.push({ s, left, right: left + w, y });
    parts.push(`<text x="${num(x)}" y="${num(y)}" font-size="${size}"${weight !== 400 ? ` font-weight="${weight}"` : ''}${italic ? ' font-style="italic"' : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} fill="${fill}">${esc(s)}</text>`);
  };
  const rect = (x, y, w, h, { fill = 'none', stroke = 'none', sw = 1, rx = 0, dash = '' } = {}) =>
    parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(w, 0))}" height="${num(Math.max(h, 0))}"${rx ? ` rx="${rx}"` : ''} fill="${fill}" stroke="${stroke}"${stroke !== 'none' ? ` stroke-width="${sw}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  const line = (x1, y1, x2, y2, { stroke = COLORS.grid, sw = 1, dash = '' } = {}) =>
    parts.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  Object.assign(c, { t, rect, line });

  // Series fill: solid, or hatched (the second series of a pair) so the series differ without relying on hue.
  const fillFor = (s, idx) => {
    if (!s.hatch) return s.color;
    const pid = `h-${id}-${idx}`;
    if (!defs.some((d) => d.includes(`id="${pid}"`))) {
      defs.push(`<pattern id="${pid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${s.color}"/><line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-width="2.5"/></pattern>`);
    }
    return `url(#${pid})`;
  };

  // Header
  t(M, 34, title, { size: 20, weight: 600 });
  c.y = 34;
  if (subtitle) {
    for (const l of wrap(subtitle, W - 2 * M, 14)) {
      c.y += 20;
      t(M, c.y, l, { size: 14, fill: COLORS.muted });
    }
  }
  c.y += 18;

  c.gap = (px) => { c.y += px; };

  // Axis title: centred under the plot when it fits there, otherwise wrapped and centred on the chart. Returns the extra height used.
  const axisTitle = (s, cx, y) => {
    const room = 2 * Math.min(cx - M, W - M - cx);
    if (textW(s, 13) <= room) { t(cx, y, s, { size: 13, anchor: 'middle', fill: COLORS.muted }); return 0; }
    const ls = wrap(s, W - 2 * M - 20, 13);
    ls.forEach((l, i) => t(W / 2, y + i * 17, l, { size: 13, anchor: 'middle', fill: COLORS.muted }));
    return (ls.length - 1) * 17;
  };

  /** Legend row: swatch + name, wrapped onto further rows when needed. */
  c.legend = (entries) => {
    let x = M;
    c.y += 4;
    entries.forEach((e, i) => {
      const w = 16 + 6 + textW(e.name, 13) + 22;
      if (x + w > W - M) { x = M; c.y += 22; }
      rect(x, c.y - 11, 14, 14, { fill: fillFor(e, `lg${i}`), stroke: e.color, sw: 1 });
      t(x + 20, c.y, e.name, { size: 13 });
      x += w;
    });
    c.y += 22;
  };

  c.text = (s, { size = 14, fill = COLORS.text, weight = 400, indent = 0, maxW = W - 2 * M - indent } = {}) => {
    for (const l of wrap(s, maxW, size, weight)) {
      c.y += size + 6;
      t(M + indent, c.y, l, { size, fill, weight });
    }
  };

  c.na = (reason) => {
    model.notAvailable = reason;
    const lines = wrap(`Not available: ${reason}`, W - 2 * M - 40, 15);
    const h = 28 + lines.length * 22;
    rect(M, c.y + 10, W - 2 * M, h, { fill: COLORS.panel, stroke: COLORS.grey, rx: 6, dash: '6 4' });
    lines.forEach((l, i) => t(M + 20, c.y + 10 + 30 + i * 22, l, { size: 15, fill: COLORS.text }));
    c.y += 10 + h + 6;
  };

  /**
   * Horizontal bars. items: [{label, value, text?, color?, ref?, refText?, note?}]. `ref` draws an outlined bar behind (a denominator).
   * lines: [{value, label}] vertical dashed reference lines (a cap). Zero-based; the axis maximum is rounded up to a tick.
   */
  c.hbars = ({ items, unit = '', axisTitle: axisTitle_, labelW = 200, max, lines = [], barH = 20, gap = 10, seriesId = 'value', colorDefault = COLORS.blue, valueW }) => {
    if (!Array.isArray(items) || items.length === 0) throw new Error(`Chart "${id}": hbars has no items to draw`);
    items.forEach((it, i) => { if (!isNum(it.value)) throw new Error(`Chart "${id}": items[${i}] (${it.label}) has no numeric value`); });
    const textOf = (it) => it.text ?? `${fmt(it.value)}${unit ? ' ' + unit : ''}`;
    const vw = valueW ?? Math.max(...items.map((it) => textW(textOf(it), 14))) + 14;
    const x0 = M + labelW + 10;
    const plotW = W - M - vw - x0;
    if (plotW < 160) throw new Error(`Chart "${id}": plot area only ${Math.round(plotW)} units wide; shorten labels or values`);
    const top = c.y + (lines.length ? 22 : 8);
    const peak = Math.max(...items.map((it) => Math.max(it.value, it.ref ?? 0)), ...lines.map((l) => l.value), max ?? 0);
    const { max: axMax, step } = niceMax(peak);
    const sx = (v) => (v / axMax) * plotW;
    // rows
    let y = top;
    const rows = items.map((it) => {
      const ls = wrap(it.label, labelW, 14);
      const h = Math.max(barH + gap, ls.length * 17 + 6);
      const row = { it, ls, y, h };
      y += h;
      return row;
    });
    const bottom = y;
    for (let v = 0; v <= axMax + 1e-9; v += step) {
      line(x0 + sx(v), top - 4, x0 + sx(v), bottom, { stroke: v === 0 ? COLORS.muted : COLORS.grid });
      t(x0 + sx(v), bottom + 18, fmt(Math.round(v * 1000) / 1000), { size: 13, anchor: 'middle', fill: COLORS.muted });
    }
    for (const { it, ls, y: ry, h } of rows) {
      const cy = ry + h / 2;
      ls.forEach((l, i) => t(M + labelW, cy - ((ls.length - 1) * 17) / 2 + i * 17 + 5, l, { size: 14, anchor: 'end' }));
      if (isNum(it.ref)) rect(x0, cy - barH / 2 - 3, sx(it.ref), barH + 6, { stroke: COLORS.grey, sw: 1.2, dash: '4 3' });
      rect(x0, cy - barH / 2, sx(it.value), barH, { fill: it.color ?? colorDefault });
      t(x0 + sx(Math.max(it.value, it.ref ?? 0)) + 8, cy + 5, textOf(it), { size: 14 });
      model.marks.push({ series: seriesId, label: it.label, value: it.value, text: textOf(it), ...(isNum(it.ref) ? { ref: it.ref } : {}) });
    }
    for (const l of lines) {
      line(x0 + sx(l.value), top - 4, x0 + sx(l.value), bottom, { stroke: COLORS.orange, sw: 2, dash: '6 4' });
      t(x0 + sx(l.value), top - 9, l.label, { size: 13, anchor: 'middle', fill: COLORS.orange, weight: 600 });
      model.marks.push({ series: 'line', label: l.label, value: l.value, text: l.label });
    }
    const extra = axisTitle_ ? axisTitle(axisTitle_, x0 + plotW / 2, bottom + 40) : 0;
    c.y = bottom + (axisTitle_ ? 50 + extra : 28);
  };

  /** Horizontal grouped bars: categories each with one bar per series. Value text is prefixed with the series name (a non-colour signal). */
  c.groupedHbars = ({ categories, series, unit = '', axisTitle: axisTitle_, labelW = 190, max, barH = 16, catGap = 14, prefix = true }) => {
    if (!categories.length) throw new Error(`Chart "${id}": groupedHbars has no categories`);
    const textOf = (s, b) => `${prefix ? s.name + ' ' : ''}${b.text ?? `${fmt(b.value)}${unit ? ' ' + unit : ''}`}`;
    const vw = Math.max(...categories.flatMap((cat) => cat.bars.map((b) => textW(textOf(series[b.s], b), 13)))) + 14;
    const x0 = M + labelW + 10;
    const plotW = W - M - vw - x0;
    if (plotW < 160) throw new Error(`Chart "${id}": plot area only ${Math.round(plotW)} units wide`);
    const peak = Math.max(...categories.flatMap((cat) => cat.bars.map((b) => b.value)), max ?? 0);
    const { max: axMax, step } = niceMax(peak);
    const sx = (v) => (v / axMax) * plotW;
    c.legend(series);
    const top = c.y;
    let y = top;
    const blocks = categories.map((cat) => {
      const ls = wrap(cat.label, labelW, 14);
      const h = Math.max(cat.bars.length * (barH + 3) + catGap, ls.length * 17 + catGap);
      const b = { cat, ls, y, h };
      y += h;
      return b;
    });
    const bottom = y;
    for (let v = 0; v <= axMax + 1e-9; v += step) {
      line(x0 + sx(v), top - 4, x0 + sx(v), bottom - catGap / 2, { stroke: v === 0 ? COLORS.muted : COLORS.grid });
      t(x0 + sx(v), bottom + 14, fmt(Math.round(v * 1000) / 1000), { size: 13, anchor: 'middle', fill: COLORS.muted });
    }
    blocks.forEach(({ cat, ls, y: by, h }) => {
      const barsH = cat.bars.length * (barH + 3);
      const start = by + (h - catGap - barsH) / 2 + 2;
      if (cat.highlight) rect(M - 6, by - 2, W - 2 * M + 12, h - catGap + 4, { fill: '#fdf0e6', stroke: COLORS.orange, sw: 1.5, rx: 4 });
      ls.forEach((l, i) => t(M + labelW, by + (h - catGap) / 2 - ((ls.length - 1) * 17) / 2 + i * 17 + 5, l, { size: 14, anchor: 'end', weight: cat.highlight ? 600 : 400, fill: cat.highlight ? COLORS.orange : COLORS.text }));
      cat.bars.forEach((b, i) => {
        const s = series[b.s];
        const by2 = start + i * (barH + 3);
        rect(x0, by2, sx(b.value), barH, { fill: fillFor(s, b.s), stroke: s.color });
        t(x0 + sx(b.value) + 6, by2 + barH - 3, textOf(s, b), { size: 13 });
        model.marks.push({ series: s.name, label: cat.label, value: b.value, text: textOf(s, b) });
      });
    });
    const extra = axisTitle_ ? axisTitle(axisTitle_, x0 + plotW / 2, bottom + 34) : 0;
    c.y = bottom + (axisTitle_ ? 44 + extra : 22);
  };

  /** Vertical grouped bars. cats: [{label, values:[...]}]. Labels sit on the bars when they fit and are staggered when they would touch. */
  c.vbars = ({ cats, series, unit = '', yTitle, xTitle, h = 220, max, labelEvery = 1, showZero = false }) => {
    if (!cats.length) throw new Error(`Chart "${id}": vbars has no categories`);
    const x0 = M + 46;
    const plotW = W - M - 8 - x0;
    const peak = Math.max(...cats.flatMap((cat) => cat.values), max ?? 0);
    const { max: axMax, step } = niceMax(peak);
    if (series.length > 1) c.legend(series);
    if (yTitle) { c.y += 6; t(M, c.y + 8, yTitle, { size: 13, fill: COLORS.muted }); c.y += 18; }
    const top = c.y + 18;
    const bottom = top + h;
    const sy = (v) => bottom - (v / axMax) * h;
    for (let v = 0; v <= axMax + 1e-9; v += step) {
      line(x0, sy(v), x0 + plotW, sy(v), { stroke: v === 0 ? COLORS.muted : COLORS.grid });
      t(x0 - 6, sy(v) + 5, fmt(Math.round(v * 1000) / 1000), { size: 13, anchor: 'end', fill: COLORS.muted });
    }
    const slot = plotW / cats.length;
    const n = series.length;
    const bw = Math.min(26, (slot - 4) / n);
    const widest = Math.max(...cats.flatMap((cat) => cat.values.map((v) => textW(fmt(v), 13))));
    const stagger = n > 1 && slot < n * widest + 4;
    cats.forEach((cat, ci) => {
      const cx = x0 + slot * ci + slot / 2;
      const left = cx - (n * bw) / 2;
      cat.values.forEach((v, si) => {
        if (!isNum(v)) throw new Error(`Chart "${id}": ${cat.label} / ${series[si].name} has no numeric value`);
        const bh = (v / axMax) * h;
        if (v > 0) rect(left + si * bw, bottom - bh, bw - 1, bh, { fill: fillFor(series[si], si), stroke: series[si].color });
        if (v > 0 || showZero) {
          const lift = stagger && si % 2 === 1 ? 17 : 0;
          t(left + si * bw + (bw - 1) / 2, bottom - bh - 6 - lift, fmt(v), { size: 13, anchor: 'middle' });
        }
        model.marks.push({ series: series[si].name, label: cat.label, value: v, text: fmt(v) });
      });
      if (ci % labelEvery === 0) t(cx, bottom + 18, cat.label, { size: 13, anchor: 'middle', fill: COLORS.muted });
    });
    const extra = xTitle ? axisTitle(xTitle, x0 + plotW / 2, bottom + 40) : 0;
    c.y = bottom + (xTitle ? 52 + extra : 30);
  };

  /** Segmented horizontal bar (parts of one total) with a legend table that carries the counts, so colour is never the only signal. */
  c.segBar = ({ segments, total, unit = '' }) => {
    const x0 = M;
    const bw = W - 2 * M;
    const y0 = c.y + 10;
    const sum = segments.reduce((a, s) => a + s.value, 0);
    if (sum !== total) throw new Error(`Chart "${id}": segments sum to ${sum}, not ${total}`);
    let x = x0;
    segments.forEach((s) => {
      const w = (s.value / total) * bw;
      if (s.value > 0) rect(x, y0, w, 34, { fill: s.color, stroke: COLORS.bg, sw: 1.5 });
      x += w;
    });
    rect(x0, y0, bw, 34, { stroke: COLORS.muted });
    let y = y0 + 34 + 22;
    segments.forEach((s) => {
      rect(M, y - 12, 14, 14, { fill: s.color, stroke: s.color });
      t(M + 24, y, s.label, { size: 14 });
      t(W - M - 130, y, `${fmt(s.value)}${unit ? ' ' + unit : ''}`, { size: 14, anchor: 'end', weight: 600 });
      t(W - M, y, pct(s.value / total), { size: 14, anchor: 'end', fill: COLORS.muted });
      model.marks.push({ series: 'segment', label: s.label, value: s.value, text: fmt(s.value) });
      y += 24;
    });
    line(M, y - 14, W - M, y - 14, { stroke: COLORS.grid });
    t(M + 24, y + 6, 'Total (the bar above)', { size: 14, weight: 600 });
    t(W - M - 130, y + 6, `${fmt(total)}${unit ? ' ' + unit : ''}`, { size: 14, anchor: 'end', weight: 600 });
    model.marks.push({ series: 'total', label: 'total', value: total, text: fmt(total) });
    c.y = y + 20;
  };

  /** A table: cols [{h, w, align}], rows [[cell,...]]. Cells are strings; numbers are printed by the caller. */
  c.table = ({ cols, rows, rowH = 26, boldFirst = false }) => {
    const total = cols.reduce((a, k) => a + k.w, 0);
    const scale = (W - 2 * M) / total;
    let x = M;
    const xs = cols.map((k) => { const cx = x; x += k.w * scale; return cx; });
    const widths = cols.map((k) => k.w * scale);
    const y0 = c.y + 8;
    rect(M, y0, W - 2 * M, rowH, { fill: COLORS.panel, stroke: COLORS.border });
    cols.forEach((k, i) => t(k.align === 'right' ? xs[i] + widths[i] - 8 : xs[i] + 8, y0 + rowH - 8, k.h, { size: 13, weight: 600, anchor: k.align === 'right' ? 'end' : 'start' }));
    rows.forEach((r, ri) => {
      const ry = y0 + rowH * (ri + 1);
      line(M, ry + rowH, W - M, ry + rowH, { stroke: COLORS.border });
      r.forEach((cell, i) => {
        const s = String(cell);
        if (textW(s, 13) > widths[i] - 12) throw new Error(`Chart "${id}": table cell "${s}" does not fit its ${Math.round(widths[i])}-unit column`);
        t(cols[i].align === 'right' ? xs[i] + widths[i] - 8 : xs[i] + 8, ry + rowH - 8, s, { size: 13, anchor: cols[i].align === 'right' ? 'end' : 'start', weight: boldFirst && i === 0 ? 600 : 400 });
      });
      model.marks.push({ series: 'row', label: String(r[0]), value: null, text: r.map(String).join(' | ') });
    });
    c.y = y0 + rowH * (rows.length + 1) + 12;
  };

  /** A boxed panel of wrapped lines: [{text, weight?, fill?, size?}] */
  c.panel = (lines, { pad = 16, width = W - 2 * M, x = M, border = COLORS.border } = {}) => {
    const items = lines.flatMap((l) => {
      const o = typeof l === 'string' ? { text: l } : l;
      const size = o.size ?? 14;
      return wrap(o.text, width - 2 * pad, size, o.weight ?? 400).map((s) => ({ s, size, weight: o.weight ?? 400, fill: o.fill ?? COLORS.text }));
    });
    const h = items.reduce((a, it) => a + it.size + 7, 0) + 2 * pad - 4;
    rect(x, c.y + 8, width, h, { fill: COLORS.panel, stroke: border, rx: 6 });
    let y = c.y + 8 + pad;
    for (const it of items) {
      y += it.size;
      t(x + pad, y, it.s, { size: it.size, weight: it.weight, fill: it.fill });
      y += 7;
    }
    c.y += 8 + h + 8;
  };

  /** A single stated figure with a caption (for numbers that should be read, not drawn). */
  c.stat = ({ value, label, caption, color = COLORS.blue }) => {
    const y0 = c.y + 8;
    const lines = wrap(caption, W - 2 * M - 40, 14);
    const h = 78 + lines.length * 19;
    rect(M, y0, W - 2 * M, h, { fill: COLORS.panel, stroke: COLORS.border, rx: 6 });
    t(M + 20, y0 + 52, value, { size: 40, weight: 600, fill: color });
    t(M + 20 + textW(value, 40, 600) + 14, y0 + 50, label, { size: 16, weight: 600 });
    lines.forEach((l, i) => t(M + 20, y0 + 82 + i * 19, l, { size: 14, fill: COLORS.muted }));
    model.marks.push({ series: 'stat', label, value: Number(String(value).replace(/[^0-9.-]/g, '')) || null, text: value });
    c.y = y0 + h + 8;
  };

  /** Small-multiple bar panels on a shared real-date axis; only days present are drawn (no zero fill). */
  c.timePanels = ({ days, panels, panelH = 96 }) => {
    const x0 = M + 46;
    const plotW = W - M - 10 - x0;
    const day = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
    const d0 = day(days[0].day);
    const span = Math.max(day(days[days.length - 1].day) - d0, 1);
    const bw = Math.max(2, Math.min(8, (plotW / (span + 1)) * 0.8));
    const xAt = (s) => x0 + ((day(s) - d0) / span) * (plotW - bw);
    panels.forEach((p) => {
      const vals = days.map((d) => d[p.key]);
      const peak = Math.max(...vals, 1);
      const { max: axMax, step } = niceMax(peak, 3);
      c.y += 22;
      t(M, c.y, `${p.label}`, { size: 14, weight: 600, fill: p.color });
      const top = c.y + 8;
      const bottom = top + panelH;
      const sy = (v) => bottom - (v / axMax) * panelH;
      for (let v = 0; v <= axMax + 1e-9; v += step) {
        line(x0, sy(v), x0 + plotW, sy(v), { stroke: v === 0 ? COLORS.muted : COLORS.grid });
        t(x0 - 6, sy(v) + 5, fmt(v), { size: 13, anchor: 'end', fill: COLORS.muted });
      }
      days.forEach((d) => {
        const v = d[p.key];
        if (!isNum(v)) throw new Error(`Chart "${id}": ${d.day} / ${p.key} has no numeric value`);
        if (v > 0) rect(xAt(d.day), sy(v), bw, (v / axMax) * panelH, { fill: p.color });
        model.marks.push({ series: p.key, label: d.day, value: v, text: String(v) });
      });
      const top1 = days.reduce((b, d) => (d[p.key] > b[p.key] ? d : b), days[0]);
      if (top1[p.key] > 0) {
        const px = Math.min(xAt(top1.day) + bw / 2, W - M - textW(`peak ${top1[p.key]} on ${top1.day}`, 13) / 2 - 4);
        t(Math.max(px, x0 + textW(`peak ${top1[p.key]} on ${top1.day}`, 13) / 2), sy(top1[p.key]) - 6, `peak ${top1[p.key]} on ${top1.day}`, { size: 13, anchor: 'middle' });
      }
      c.y = bottom;
    });
    // month ticks on the shared axis
    const first = days[0].day;
    let y = +first.slice(0, 4);
    let m = +first.slice(5, 7);
    const lastD = day(days[days.length - 1].day);
    c.y += 18;
    for (let guard = 0; guard < 60; guard++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-01`;
      if (day(ds) > lastD) break;
      if (day(ds) >= d0) {
        const x = x0 + ((day(ds) - d0) / span) * (plotW - bw);
        line(x, c.y - 14, x, c.y - 10, { stroke: COLORS.muted });
        t(x, c.y + 4, ds.slice(0, 7), { size: 13, anchor: 'middle', fill: COLORS.muted });
      }
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    c.y += 22;
  };

  /** Close the chart: footer (provenance, source, stamp), background, root element. */
  c.render = ({ provenance, source, stamp }) => {
    if (!provenance || !source || !stamp) throw new Error(`Chart "${id}": provenance, source and stamp are required in the footer`);
    model.provenance = provenance;
    model.source = source;
    model.stamp = stamp;
    c.y += 8;
    line(M, c.y, W - M, c.y, { stroke: COLORS.border });
    for (const [i, s] of [`Provenance: ${provenance}`, `Source: ${source}`, stamp].entries()) {
      for (const l of wrap(s, W - 2 * M, 13)) {
        c.y += 18;
        t(M, c.y, l, { size: 13, fill: COLORS.muted, weight: i === 0 ? 600 : 400 });
      }
    }
    const H = Math.ceil(c.y + 16);
    for (const b of boxes) {
      if (b.left < 6 || b.right > W - 6) throw new Error(`Chart "${id}": the text "${b.s}" would run outside the chart (${Math.round(b.left)}..${Math.round(b.right)} of ${W})`);
    }
    const label = `${title}. ${desc || subtitle}`.trim();
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t-${id} d-${id}" font-family="${FONT}">`,
      `<title id="t-${id}">${esc(title)}</title>`,
      `<desc id="d-${id}">${esc(label)}</desc>`,
      defs.length ? `<defs>${defs.join('')}</defs>` : '',
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${COLORS.bg}" stroke="${COLORS.border}"/>`,
      ...parts,
      '</svg>',
      '',
    ].filter((s) => s !== '').join('\n');
    return { svg, model };
  };
  return c;
}

/**
 * Backwards-compatible single-series bar chart (the original primitive). Now drawn in the same opaque, explicit-colour frame as the rest.
 * series: [{label, value, text?}]
 */
export function barChart({ title, caption, series, max, unit, provenance = 'MEASURED', source = 'see caption' }) {
  if (!Array.isArray(series) || series.length === 0) throw new Error(`Chart "${title}" has no data points to draw`);
  series.forEach((s, i) => {
    if (!isNum(s.value)) throw new Error(`Chart "${title}": series[${i}] (${s.label}) has no numeric value`);
  });
  const c = chart({ id: String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chart', title });
  c.hbars({ items: series, unit, labelW: 220, max, axisTitle: unit || undefined });
  return c.render({ provenance, source, stamp: caption }).svg;
}
