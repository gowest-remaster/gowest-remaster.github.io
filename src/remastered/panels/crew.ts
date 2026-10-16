// Crew picker shared by the field job card and the build card: sliders for family, neighbors
// and hired hands, with "no faster" ticks where integer division stops paying (F4).
import type { Helpers } from '../../sim/index.ts';
import { h } from '../core/dom.ts';
import { money } from '../core/format.ts';
import { slider } from '../ui/kit.ts';

export interface CrewOpts {
  family: number;
  neighbors: number;
  /** why neighbors are 0 (goodwill) */
  neighborsNote?: string | null;
  /** note beside the neighbors slider (field: they'll want help back; building: free) */
  neighborsLabel?: string;
  workers?: number;
  wage: number;
  /** wage label: "$5/day" (field) or "$5 each" (construction) */
  wageLabel?: string;
  /** base days per unit, for no-faster ticks: days(k) = trunc(base/(k+1)) */
  base: number;
  initial?: Partial<Helpers>;
  onChange: (h: Helpers) => void;
}

export function crewPicker(o: CrewOpts) {
  const cur: Helpers = { family: Math.min(o.initial?.family ?? o.family, o.family), neighbors: Math.min(o.initial?.neighbors ?? 0, o.neighbors), workers: o.initial?.workers ?? 0 };
  const speedAt = (k: number) => Math.trunc(o.base / (k + 1));
  const crew = () => cur.family + cur.neighbors + cur.workers;
  /** a value v for one slider is "no faster" if total crew with v gives the same days as with v-1 */
  const dimFor = (key: keyof Helpers) => (v: number) => {
    if (v === 0) return false;
    const others = crew() - cur[key];
    return speedAt(others + v) === speedAt(others + v - 1);
  };
  const note = h('div', { class: 'crew-note small' });
  const mk = (key: keyof Helpers, label: string, max: number, extra?: string | null) =>
    slider({
      label: h('span', null, label, extra ? h('small', { class: 'muted' }, ` ${extra}`) : null),
      min: 0,
      max,
      value: cur[key],
      dim: dimFor(key),
      disabled: max === 0 ? (key === 'neighbors' ? o.neighborsNote ?? 'No neighbors are free today.' : key === 'family' ? 'Nobody in the family can help yet.' : null) : null,
      onInput: (v) => {
        cur[key] = v;
        refresh();
        o.onChange({ ...cur });
      },
    });
  const sFam = mk('family', 'Family', o.family, o.family ? null : '(none old enough)');
  const sNb = mk('neighbors', 'Neighbors', o.neighbors, o.neighbors ? o.neighborsLabel ?? 'free, but you owe them help' : o.neighborsNote ?? '(none free today)');
  const sHire = mk('workers', 'Hired hands', o.workers ?? 5, o.wageLabel ?? `${money(o.wage)}/day each`);
  function refresh() {
    sFam.refresh();
    sNb.refresh();
    sHire.refresh();
    const k = crew();
    const d = speedAt(k);
    const next = speedAt(k + 1);
    note.textContent = '';
    if (k > 0 && d === speedAt(k - 1)) note.textContent = `The last helper doesn't speed things up: ${o.base} days ÷ ${k + 1} people = ${(o.base / (k + 1)).toFixed(1)}, and part days don't count.`;
    else if (next === d && d > 0) note.textContent = `One more helper won't be any faster (${o.base} ÷ ${k + 2} still rounds down to ${d}).`;
  }
  refresh();
  o.onChange({ ...cur });
  const el = h('div', { class: 'crew' }, h('div', { class: 'crew-you small' }, '● You'), sFam.el, sNb.el, sHire.el, note);
  return { el, get value() { return { ...cur }; } };
}
