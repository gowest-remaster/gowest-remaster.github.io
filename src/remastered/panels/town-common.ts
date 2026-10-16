// Shared helpers for the Main Street panels: voice lines with captions, the "fetch from the
// box" pattern for cash-only purchases, small SVG charts, and "blocked" guards.
import './../styles/town.css';
import type { GameState } from '../../sim/index.ts';
import { getContent } from '../../game/text.ts';
import { audio } from '../core/audio.ts';
import { h, svg } from '../core/dom.ts';
import { money } from '../core/format.ts';
import { session } from '../core/session.ts';
import { toast } from '../ui/kit.ts';

let voiceMap: Map<string, { speaker: string | null; text: string | null }> | null = null;
function voices() {
  if (!voiceMap) {
    voiceMap = new Map();
    for (const l of getContent().voice.lines) voiceMap.set(l.id, { speaker: l.speaker, text: l.text });
  }
  return voiceMap;
}

/** Play an original voice line (voice.json id) with its caption. Never blocks input. */
export function say(id: string, speaker?: string) {
  const v = voices().get(id);
  if (!v) return;
  void audio.playVoice(id, { speaker: speaker ?? v.speaker, text: v.text });
}

export const BLOCKED = 'Answer the letter first.';
export const blockedReason = () => (session.blocked ? BLOCKED : null);

/**
 * Cash-only purchase with "fetch from the box": if cash is short but cash + savings covers it,
 * first withdraw the shortfall (a real withdrawSavings, as walking home would), then buy.
 * Returns false when it can't be afforded at all.
 */
export function payWithFetch(s: GameState, amount: number, buy: () => void, what: string): boolean {
  const p = s.propet;
  if (p.cash >= amount) {
    buy();
    return true;
  }
  if (p.cash + p.savings < amount) {
    toast(`You need ${money(amount - p.cash - p.savings, { cents: true })} more for ${what}.`, { icon: 'warn' });
    return false;
  }
  const short = Math.ceil((amount - p.cash) * 100) / 100;
  const r = session.run({ type: 'withdrawSavings', amount: short }, `Fetched ${money(short, { cents: true })} from the savings box`);
  if (r.events.some((e) => e.type === 'rejected' || e.type === 'dialog')) return false;
  buy();
  return true;
}

export function shortfall(s: GameState, amount: number) {
  const p = s.propet;
  return { short: Math.max(0, amount - p.cash), canFetch: p.cash < amount && p.cash + p.savings >= amount, cannot: p.cash + p.savings < amount };
}

/** Simple multi-series line chart (years on x). */
export function lineChart(o: { width?: number; height?: number; years: number[]; series: { label: string; color: string; values: number[] }[]; markYear?: number; fmt?: (v: number) => string; note?: (y: number) => string | null }) {
  const W = o.width ?? 520;
  const H = o.height ?? 150;
  const L = 40;
  const R = 12;
  const T = 12;
  const B = 22;
  const all = o.series.flatMap((s) => s.values);
  const max = Math.max(0.5, ...all) * 1.1;
  const n = o.years.length;
  const x = (i: number) => L + (W - L - R) * (n <= 1 ? 0.5 : i / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const el = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${o.series.map((s) => s.label).join(', ')} by year` });
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);
  for (const t of ticks) {
    el.append(svg('line', { class: 'grid', x1: String(L), x2: String(W - R), y1: String(y(t)), y2: String(y(t)) }));
    el.append(svg('text', { x: String(L - 5), y: String(y(t) + 4), 'text-anchor': 'end' }, (o.fmt ?? ((v: number) => `$${v.toFixed(2)}`))(t)));
  }
  el.append(svg('line', { class: 'axis', x1: String(L), x2: String(W - R), y1: String(y(0)), y2: String(y(0)) }));
  const step = Math.max(1, Math.ceil(n / 8));
  o.years.forEach((yr, i) => {
    if (i % step === 0 || i === n - 1) el.append(svg('text', { x: String(x(i)), y: String(H - 6), 'text-anchor': 'middle' }, String(yr)));
  });
  for (const s of o.series) {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    el.append(svg('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': '2.2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = s.values.length - 1;
    if (last >= 0) el.append(svg('circle', { cx: String(x(last)), cy: String(y(s.values[last])), r: '3.5', fill: s.color }));
  }
  if (o.markYear !== undefined) {
    const i = o.years.indexOf(o.markYear);
    if (i >= 0) {
      el.append(svg('line', { x1: String(x(i)), x2: String(x(i)), y1: String(T), y2: String(y(0)), stroke: 'var(--red)', 'stroke-dasharray': '3 3' }));
      el.append(svg('text', { x: String(x(i) - 4), y: String(T + 9), 'text-anchor': 'end', style: 'fill: var(--red)' }, 'this year'));
    }
  }
  return el;
}

export function legend(items: { label: string; color: string }[]) {
  return h('div', { class: 'legend' }, ...items.map((i) => h('span', null, h('i', { style: { background: i.color } }), i.label)));
}

/**
 * Run an enter* command once the current dispatch has settled (never inside an emit). A refused
 * enter (game over, a letter waiting, the calendar running) is not retried for the same state:
 * the refusal itself emits a change, and retrying from that change would loop forever.
 */
const refused = new WeakSet<object>();
export function enterLater(cmd: 'enterTown' | 'enterBank' | 'enterLivestockMarket', when: () => boolean) {
  queueMicrotask(() => {
    const s = session.state;
    if (!s || s.extra.ended || session.blocked || refused.has(s) || !when()) return;
    const r = session.run({ type: cmd }, cmd);
    if (r.events.some((e) => e.type === 'rejected')) refused.add(r.state);
  });
}
