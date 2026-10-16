// "Then & Now" (remastered-ux §7.4, W8): the farm as it stood in a past year beside today's,
// drawn with the original 1996 game-board art (CALEND BuildPic: backdrop, field, fence, barn,
// windmills, house, tractor, car; scripts/prepare_board_sprites.py), with the family's numbers
// from that year (extra.history) and what changed. A slider picks the year.
import type { GameState, MonthSnapshot } from '../../sim/index.ts';
import { h, icon, put } from '../core/dom.ts';
import { money, monthName, num } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { farmOf, type FarmSnap, type Journal } from '../core/journal.ts';

interface Sprite {
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
let meta: Record<string, Sprite> | null = null;
let loading: Promise<void> | null = null;
const BASE = `${import.meta.env.BASE_URL}assets/rm/board/`;
function loadMeta() {
  loading ??= fetch(`${BASE}board.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => void (meta = m))
    .catch(() => void (meta = null));
  return loading;
}

/** The original board picture for one farm record (summer light, so years compare fairly). */
export function boardPicture(f: FarmSnap | null, label: string): HTMLElement {
  const box = h('div', { class: 'board-pic', role: 'img', 'aria-label': f ? describe(f) : 'No picture kept for this year' });
  const fill = () => {
    if (!meta || !f) {
      put(box, h('div', { class: 'board-empty' }, f ? 'Loading…' : 'No picture was kept for this year.'));
      return;
    }
    const names: string[] = ['S'];
    names.push(f.ripe > 0 ? 'F3' : f.planted > 0 ? 'F2' : f.plowed > 0 ? 'F1' : 'FDef');
    if (f.fence > 0) names.push(f.fields > 1 ? 'Fen4' : 'Fen3');
    if (f.barn > 0) names.push(f.barn === 3 ? 'Barn3' : 'Barn1');
    if (f.windmill > 0) names.push(f.windmill === 2 ? 'Wmill2' : 'Wmill1');
    if (f.extraWindmills > 0) names.push(f.extraWindmills > 1 ? 'Wmill4' : 'Wmill3');
    if (f.house > 0) names.push(f.house >= 3 ? 'H3' : 'H1');
    if (f.tractors > 0) names.push(`Trac${Math.min(3, f.tractors)}`);
    if (f.car > 0) names.push('Car');
    put(
      box,
      ...names.map((n) => {
        const m = meta![n];
        if (!m) return null;
        return h('img', { src: BASE + m.file, alt: '', draggable: false, style: { left: `${(m.x / 640) * 100}%`, top: `${(m.y / 381) * 100}%`, width: `${(m.w / 640) * 100}%`, height: `${(m.h / 381) * 100}%` } });
      }),
      h('div', { class: 'board-year' }, label),
    );
  };
  if (meta) fill();
  else {
    fill();
    void loadMeta().then(fill);
  }
  return box;
}

function describe(f: FarmSnap) {
  const bits = [f.house ? (f.house >= 3 ? 'a wooden house' : 'a sod house') : 'no house yet'];
  if (f.barn) bits.push(f.barn === 3 ? 'a wrecked barn' : 'a barn');
  if (f.windmill) bits.push(f.windmill === 2 ? 'a broken windmill' : 'a windmill');
  if (f.fence) bits.push('a fence');
  if (f.tractors) bits.push(`${f.tractors} ${f.tractors === 1 ? 'tractor' : 'tractors'}`);
  if (f.car) bits.push('a car');
  return `The farm in ${f.year}: ${bits.join(', ')}.`;
}

/** What one year looked like in numbers (the year's last history row up to the record's month). */
function numbersFor(s: GameState, year: number, mon: number): MonthSnapshot | null {
  const hist = s.extra.history ?? [];
  let best: MonthSnapshot | null = null;
  for (const r of hist) if (r.year === year && r.mon <= mon) best = r;
  if (!best) for (const r of hist) if (r.year === year) best = r;
  return best;
}

const things = (f: FarmSnap) => [
  { key: 'house', label: f.house >= 3 ? 'Wooden house' : f.house ? 'Sod house' : 'Tent', have: true },
  { key: 'barn', label: f.barn === 3 ? 'Barn (wrecked)' : 'Barn', have: f.barn > 0 },
  { key: 'windmill', label: 'Well & windmill', have: f.windmill === 1 || f.extraWindmills > 0 },
  { key: 'fence', label: 'Fence', have: f.fence > 0 },
  { key: 'tractors', label: f.tractors > 1 ? `${f.tractors} tractors` : 'Tractor', have: f.tractors > 0 },
  { key: 'car', label: 'Car', have: f.car > 0 },
  { key: 'fields', label: f.fields > 1 ? '320 acres' : '160 acres', have: true },
  { key: 'animals', label: `${f.horses} horses · ${f.cows} cows · ${f.pigs} pigs`, have: f.horses + f.cows + f.pigs > 0 },
  { key: 'businesses', label: f.businesses === 1 ? '1 business in town' : `${f.businesses} businesses in town`, have: f.businesses > 0 },
  { key: 'children', label: f.children === 1 ? '1 child named' : `${f.children} children named`, have: f.children > 0 },
];

export function thenAndNow(s: GameState, j: Journal): HTMLElement {
  const now = farmOf(s);
  const years = [...new Set([...(j.farm ?? []).map((f) => f.year), ...(s.extra.history ?? []).map((r) => r.year)])].filter((y) => y < s.date.year).sort((a, b) => a - b);
  const root = h('div', { class: 'thennow' });
  if (!years.length) {
    root.append(h('div', { class: 'empty' }, `Come back next year: the farm as it stands in ${s.date.year} will be kept here to compare.`), boardPicture(now, `Now · ${monthName(s.date.mon, 'short')} ${s.date.year}`));
    return root;
  }
  let year = years[0];
  const range = h('input', { type: 'range', min: '0', max: String(years.length - 1), step: '1', value: '0', 'aria-label': 'Year to compare' }) as HTMLInputElement;
  const yearOut = h('output', { class: 'tn-year' }, String(year));
  const left = h('div', { class: 'tn-side' });
  const right = h('div', { class: 'tn-side now' });
  const diff = h('div', { class: 'tn-diff' });
  const nowNums = numbersFor(s, s.date.year, s.date.mon);

  function side(f: FarmSnap | null, nums: MonthSnapshot | null, label: string, other: FarmSnap | null) {
    const list = f ? things(f) : [];
    const otherHave = new Set(other ? things(other).filter((t) => t.have).map((t) => t.label) : []);
    return [
      boardPicture(f, label),
      nums
        ? h('dl', { class: 'kv tn-kv' },
            h('dt', null, 'Net worth'), h('dd', { class: 'num' }, money(nums.cash + nums.savings + nums.farmValue - nums.loanAmount)),
            h('dt', null, 'Cash + savings'), h('dd', { class: 'num' }, money(nums.cash + nums.savings)),
            h('dt', null, 'Land value'), h('dd', { class: 'num' }, money(nums.landValue)),
            h('dt', null, 'Standing ★'), h('dd', { class: 'num' }, String(nums.score)),
            h('dt', null, 'Upkeep'), h('dd', { class: 'num' }, `${money(nums.lifePrice)}/mo`),
            nums.businessIncome ? h('dt', null, 'Businesses') : null, nums.businessIncome ? h('dd', { class: 'num' }, `+${money(nums.businessIncome)}/mo`) : null)
        : null,
      f ? h('ul', { class: 'tn-things' }, ...list.filter((t) => t.have).map((t) => h('li', { class: other && !otherHave.has(t.label) && label.startsWith('Now') ? 'new' : '' }, icon(ICONS.check), t.label))) : null,
    ];
  }

  function render() {
    year = years[Number(range.value)];
    yearOut.textContent = String(year);
    const then = (j.farm ?? []).find((f) => f.year === year) ?? null;
    const thenNums = numbersFor(s, year, then?.mon ?? 12);
    put(left, ...side(then, thenNums, `${year}`, null));
    put(right, ...side(now, nowNums, `Now · ${s.date.year}`, then));
    const lines: string[] = [];
    if (thenNums && nowNums) {
      const w0 = thenNums.cash + thenNums.savings + thenNums.farmValue - thenNums.loanAmount;
      const w1 = nowNums.cash + nowNums.savings + nowNums.farmValue - nowNums.loanAmount;
      lines.push(`Net worth ${w1 >= w0 ? 'up' : 'down'} ${money(Math.abs(w1 - w0))} in ${s.date.year - year} ${s.date.year - year === 1 ? 'year' : 'years'}.`);
      if (nowNums.score !== thenNums.score) lines.push(`Standing ${nowNums.score > thenNums.score ? '+' : '−'}${Math.abs(nowNums.score - thenNums.score)}.`);
    }
    if (then) {
      const gained = things(now).filter((t) => t.have && !things(then).some((o) => o.have && o.label === t.label)).map((t) => t.label.toLowerCase());
      if (gained.length) lines.push(`New since then: ${gained.join(', ')}.`);
      const kids = now.children - then.children;
      if (kids > 0) lines.push(`${num(kids)} more ${kids === 1 ? 'child' : 'children'} at the table.`);
    }
    put(diff, ...lines.map((l) => h('span', null, l)));
  }
  range.addEventListener('input', render);
  root.append(
    h('div', { class: 'tn-head' }, h('label', { class: 'tn-slider' }, h('span', { class: 'eyebrow' }, 'Then'), range, yearOut), h('span', { class: 'small muted' }, 'Drag to pick a year. The pictures are the 1996 game board, in summer.')),
    h('div', { class: 'tn-grid' }, left, h('div', { class: 'tn-arrow', 'aria-hidden': 'true' }, icon(ICONS.next)), right),
    diff,
  );
  render();
  return root;
}
