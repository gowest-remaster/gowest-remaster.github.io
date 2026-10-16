// The freight office as the elevator screen's third offer card (05 §4.1), next to Ed and
// O'Grady. Numbers come from the sim (freightQuote); labels and clerk lines are reconstructed.
import { freightQuote, type FreightOffer } from '../../sim/devcut.ts';
import type { GameState } from '../../sim/state.ts';
import { reconstructedBadge } from './badge.ts';
import type { DevcutContent } from './content.ts';
import { ensureStyles, h } from './dom.ts';
import { money2 as money } from '../core/format.ts';

export interface FreightCardOptions {
  /** Ship with offer `index` -> dispatch({ type: 'devcut', action: { kind: 'shipGrain', offer: index } }). */
  onShip: (index: number) => void;
  /** Ed's cash total, to show the difference (+$x / -$x). */
  compareTo?: number;
}

/** Build the card. Returns null outside the Dev Cut. Re-create it when the state changes. */
export function freightOfferCard(state: GameState, dc: DevcutContent, opts: FreightCardOptions): HTMLElement | null {
  if (!state.devcut?.enabled) return null;
  ensureStyles();
  const q = freightQuote(state);
  const text = (id: string) => dc.texts[id]?.text ?? '';
  const card = h('div', { class: 'dc-offer', role: 'group', 'aria-label': 'Freight office' }, h('div', { class: 'dc-lbl' }, 'Freight office · Longview Station'));
  if (q.closed || q.offers.length === 0) {
    const id = q.closed === 'strike' ? 'DC_FreightStrike' : q.closed === 'noCrops' ? 'DC_FreightNoCrops' : 'DC_FreightClerk';
    card.append(h('div', { class: 'muted' }, q.closed === 'noRow' || (!q.closed && !q.offers.length) ? 'No buyers are shipping by rail this season.' : text(id), reconstructedBadge()));
    return card;
  }
  const best = q.offers.reduce((b, o, i) => (o.net > q.offers[b].net ? i : b), 0);
  let sel = best;
  const big = h('div', { class: 'big' });
  const note = h('div', { class: 'muted' });
  const warn = h('div', { class: 'warn' });
  const label = (o: FreightOffer) => dc.freight.destinations[o.destination]?.label ?? o.destination;
  const paint = () => {
    const o = q.offers[sel];
    const diff = opts.compareTo === undefined ? null : o.net - opts.compareTo;
    big.replaceChildren(money(o.net), diff === null ? '' : h('small', { style: `font-size:13px;margin-left:6px;color:var(--dc-${diff >= 0 ? 'green' : 'red'})` }, `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}`));
    const pct = o.pct === 0 ? 'the going price' : `${o.pct > 0 ? '+' : ''}${o.pct}% on the price`;
    note.textContent = `${pct}, minus ${o.cents}¢ a bushel for freight. Collect it later at the bank.`;
    warn.textContent = o.rainRisk ? `⚠ ${text('DC_FreightWagon')}` : '';
  };
  const radios = q.offers.map((o, i) =>
    h(
      'label',
      null,
      h('input', { type: 'radio', name: 'dc-freight', checked: i === sel, onchange: () => ((sel = i), paint()) }),
      h('span', null, label(o)),
      h('span', { class: 'muted' }, money(o.net)),
    ),
  );
  paint();
  card.append(
    big,
    ...radios,
    note,
    warn,
    h('div', { class: 'muted', style: 'font-style:italic' }, `“${text('DC_FreightClerk')}”`, reconstructedBadge()),
    h('button', { class: 'dc-btn', type: 'button', onclick: () => opts.onShip(sel) }, 'Ship it'),
  );
  return card;
}
