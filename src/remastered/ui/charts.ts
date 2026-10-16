// Small SVG charts for the Ledger, Almanac and Elevator: line charts (one axis, 2px lines,
// crosshair + tooltip on hover, direct end labels) and bar charts (rounded data ends anchored
// to the baseline, per-bar tooltip). Colors come from the game's --c1..--c5 tokens; text
// always wears ink tokens. A legend appears for two or more series.
import { h, svg } from '../core/dom.ts';

export interface Series {
  label: string;
  /** CSS color, e.g. 'var(--c1)' */
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

interface Common {
  /** x labels, one per value index */
  x: string[];
  height?: number;
  yFormat?: (v: number) => string;
  /** tooltip title per index (defaults to x label) */
  xTitle?: (i: number) => string;
  /** mark one index (e.g. "this year") */
  highlight?: number;
  /** horizontal reference lines */
  refs?: { y: number; label: string }[];
  ariaLabel: string;
  yMin?: number;
}

const W = 640;
const PAD = { l: 58, r: 74, t: 16, b: 30 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function frame(height: number, ariaLabel: string) {
  const wrap = h('div', { class: 'chart-wrap' });
  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': ariaLabel, preserveAspectRatio: 'xMidYMid meet' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  wrap.append(root, tip);
  return { wrap, root, tip };
}

function yAxis(root: SVGSVGElement, lo: number, hi: number, height: number, fmt: (v: number) => string) {
  const ih = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih * (1 - (v - lo) / (hi - lo || 1));
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    root.append(svg('line', { class: i === 0 ? 'axis' : 'grid', x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), 'stroke-width': 1 }));
    root.append(svg('text', { x: PAD.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt(v)));
  }
  return y;
}

function xAxis(root: SVGSVGElement, labels: string[], height: number, x: (i: number) => number) {
  const n = labels.length;
  const every = Math.max(1, Math.ceil(n / 9));
  const lastShown = Math.floor((n - 1) / every) * every;
  labels.forEach((l, i) => {
    if (i % every !== 0 && !(i === n - 1 && n - 1 - lastShown >= Math.ceil(every * 0.75))) return;
    root.append(svg('text', { x: x(i), y: height - 8, 'text-anchor': 'middle' }, l));
  });
}

function legend(series: Series[]) {
  if (series.length < 2) return null;
  return h('div', { class: 'legend' }, ...series.map((s) => h('span', null, h('i', { style: { background: s.color } }), s.label)));
}

function positionTip(wrap: HTMLElement, tip: HTMLElement, fx: number, fy: number) {
  const r = wrap.getBoundingClientRect();
  tip.hidden = false;
  const tw = tip.offsetWidth;
  let left = fx * r.width - tw / 2;
  left = Math.max(0, Math.min(r.width - tw, left));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(0, fy * r.height - tip.offsetHeight - 10)}px`;
}

export function lineChart(o: Common & { series: Series[] }): HTMLElement {
  const height = o.height ?? 200;
  const fmt = o.yFormat ?? ((v: number) => String(Math.round(v)));
  const all = o.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const n = o.x.length;
  const box = h('div', { class: 'chart-box' });
  if (!all.length || n === 0) {
    box.append(h('div', { class: 'empty' }, 'Nothing to chart yet. Come back after a few months.'));
    return box;
  }
  const minV = Math.min(0, ...all, o.yMin ?? 0);
  const hi = niceMax(Math.max(...all, ...(o.refs ?? []).map((r) => r.y)));
  const lo = minV < 0 ? -niceMax(-minV) : 0;
  const { wrap, root, tip } = frame(height, o.ariaLabel);
  const iw = W - PAD.l - PAD.r;
  const x = (i: number) => PAD.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = yAxis(root, lo, hi, height, fmt);
  xAxis(root, o.x, height, x);
  for (const r of o.refs ?? []) {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y(r.y), y2: y(r.y), stroke: 'var(--ink-faint)', 'stroke-dasharray': '3 4', 'stroke-width': 1 }));
    root.append(svg('text', { x: W - PAD.r + 4, y: y(r.y) + 4, class: 'ref-label' }, r.label));
  }
  if (o.highlight !== undefined && o.highlight >= 0) root.append(svg('line', { x1: x(o.highlight), x2: x(o.highlight), y1: PAD.t, y2: height - PAD.b, stroke: 'var(--brass)', 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
  // end labels, nudged apart
  const ends: { y: number; s: Series; v: number }[] = [];
  for (const s of o.series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    root.append(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '5 4' : null }));
    const li = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
    if (li !== undefined) {
      const v = s.values[li]!;
      root.append(svg('circle', { cx: x(li), cy: y(v), r: 4, fill: s.color, stroke: 'var(--parch-hi)', 'stroke-width': 2 }));
      ends.push({ y: y(v), s, v });
    }
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  for (const e of ends) root.append(svg('text', { x: W - PAD.r + 8, y: e.y + 4, class: 'end-label' }, fmt(e.v)));
  // hover
  const cross = svg('line', { y1: PAD.t, y2: height - PAD.b, stroke: 'var(--ink-soft)', 'stroke-width': 1, visibility: 'hidden' });
  const dots = o.series.map((s) => svg('circle', { r: 4, fill: s.color, stroke: 'var(--parch-hi)', 'stroke-width': 2, visibility: 'hidden' }));
  root.append(cross, ...dots);
  const hit = svg('rect', { x: PAD.l - 10, y: 0, width: iw + 20, height, fill: 'transparent' });
  root.append(hit);
  const move = (ev: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / iw) * (n - 1))));
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    let topY = height;
    o.series.forEach((s, k) => {
      const v = s.values[i];
      if (v === null || v === undefined) return dots[k].setAttribute('visibility', 'hidden');
      dots[k].setAttribute('cx', String(x(i)));
      dots[k].setAttribute('cy', String(y(v)));
      dots[k].setAttribute('visibility', 'visible');
      topY = Math.min(topY, y(v));
    });
    tip.replaceChildren(h('b', null, o.xTitle ? o.xTitle(i) : o.x[i]), ...o.series.filter((s) => s.values[i] !== null && s.values[i] !== undefined).map((s) => (h('div', null, h('i', { style: { background: s.color } }), `${s.label}: `, h('span', { class: 'num' }, fmt(s.values[i]!))))));
    positionTip(wrap, tip, x(i) / W, topY / height);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
  });
  const lg = legend(o.series);
  box.append(wrap);
  if (lg) box.append(lg);
  return box;
}

export function barChart(o: Common & { series: Series }): HTMLElement {
  const height = o.height ?? 180;
  const fmt = o.yFormat ?? ((v: number) => String(Math.round(v)));
  const vals = o.series.values.map((v) => v ?? 0);
  const n = o.x.length;
  const box = h('div', { class: 'chart-box' });
  if (!n || vals.every((v) => v === 0)) {
    box.append(h('div', { class: 'empty' }, 'Nothing to chart yet.'));
    return box;
  }
  const hi = niceMax(Math.max(...vals));
  const { wrap, root, tip } = frame(height, o.ariaLabel);
  const iw = W - PAD.l - PAD.r;
  const slot = iw / n;
  const bw = Math.max(4, Math.min(34, slot - 2));
  const x = (i: number) => PAD.l + slot * i + slot / 2;
  const y = yAxis(root, 0, hi, height, fmt);
  xAxis(root, o.x, height, x);
  vals.forEach((v, i) => {
    if (v <= 0) return;
    const top = y(v);
    const base = y(0);
    const r = Math.min(4, bw / 2, base - top);
    const x0 = x(i) - bw / 2;
    const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${base}Z`;
    const hl = o.highlight === i;
    const bar = svg('path', { d, fill: o.series.color, opacity: hl || o.highlight === undefined ? 1 : 0.75 });
    root.append(bar);
    const hit = svg('rect', { x: PAD.l + slot * i, y: PAD.t, width: slot, height: height - PAD.t - PAD.b, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => {
      bar.setAttribute('opacity', '1');
      tip.replaceChildren(h('b', null, o.xTitle ? o.xTitle(i) : o.x[i]), h('div', null, `${o.series.label}: `, h('span', { class: 'num' }, fmt(v))));
      positionTip(wrap, tip, x(i) / W, top / height);
    });
    hit.addEventListener('pointerleave', () => {
      tip.hidden = true;
      bar.setAttribute('opacity', hl || o.highlight === undefined ? '1' : '0.75');
    });
    root.append(hit);
  });
  // direct label on the tallest and the highlighted bar
  const maxI = vals.indexOf(Math.max(...vals));
  for (const i of new Set([maxI, o.highlight ?? -1])) if (i >= 0 && vals[i] > 0) root.append(svg('text', { x: x(i), y: y(vals[i]) - 5, 'text-anchor': 'middle', class: 'end-label' }, fmt(vals[i])));
  box.append(wrap);
  return box;
}

/** Tiny inline sparkline (no axes). */
export function sparkline(values: number[], color = 'var(--c1)', w = 120, hgt = 28): SVGSVGElement {
  const s = svg('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: 'spark', 'aria-hidden': 'true' });
  if (values.length < 2) return s;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (w - 4) * (i / (values.length - 1)) + 2;
  const y = (v: number) => hgt - 3 - (hgt - 6) * ((v - lo) / (hi - lo || 1));
  s.append(svg('path', { d: values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(''), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }));
  s.append(svg('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3, fill: color }));
  return s;
}
