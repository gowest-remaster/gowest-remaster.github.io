// Livestock fair (§5.20): for horses, pigs and cows, what you own, today's price against the
// usual price, buy and sell steppers, and the consequence lines (milk and upkeep, the barn).
import { type GameState } from '../../sim/index.ts';
import type { App } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { money } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { livestockRow } from '../core/simapi.ts';
import { badge, unavailable } from '../ui/badges.ts';
import { btn, chip, drawer, stepper, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { blockedReason, enterLater, payWithFetch, shortfall } from './town-common.ts';

const KINDS = [
  { k: 'horses', one: 'horse', idx: 0, row: 'horse' },
  { k: 'pigs', one: 'pig', idx: 1, row: 'pig' },
  { k: 'cows', one: 'cow', idx: 2, row: 'cow' },
] as const;

const lingoInt = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));

function mount(app: App) {
  const d = drawer({ title: 'Livestock Fair', eyebrow: 'The pen by the barn · April & May', wide: true, cls: 'pen-drawer' });
  const el = h('div', { class: 'pen' }, d.el);
  const buy = { horses: 0, pigs: 0, cows: 0 };
  const sell = { horses: 0, pigs: 0, cows: 0 };
  let stamp = '';

  function render(s: GameState) {
    const key = JSON.stringify([s.sessions.livestock, s.propet.horses, s.propet.pigs, s.propet.cows, s.propet.cash, buy, sell, !!s.pending, s.date]);
    if (key === stamp) return;
    stamp = key;
    const closed = unavailable.pen(s);
    if (closed) {
      put(d.body, h('div', { class: 'empty' }, closed), h('div', { class: 'lore small' }, icon(ICONS.book), h('span', null, 'Animals need a barn to survive the winter.')));
      return;
    }
    const sess = s.sessions.livestock;
    if (!sess) {
      put(d.body, h('div', { class: 'empty' }, 'The traders are setting up their pens…'));
      return;
    }
    const p = s.propet;
    const row = livestockRow(s.date.year);
    const why = blockedReason();
    const buyTotal = KINDS.reduce((a, k) => a + buy[k.k] * sess.price[k.idx], 0);
    const sellTotal = KINDS.reduce((a, k) => a + sell[k.k] * lingoInt(row[k.row]), 0);
    const cards = KINDS.map((k) => {
      const usual = row[k.row];
      const today = sess.price[k.idx];
      const pct = Math.round(((today - usual) / usual) * 100);
      const owned = p[k.k];
      const maxSell = k.k === 'horses' ? Math.max(0, owned - 1) : owned;
      const sb = stepper({ value: buy[k.k], max: sess.max[k.idx], label: `${k.k} to buy`, onChange: (v) => { buy[k.k] = v; render(session.s); } });
      const ss = stepper({ value: sell[k.k], max: maxSell, label: `${k.k} to sell`, onChange: (v) => { sell[k.k] = v; render(session.s); } });
      return h(
        'div',
        { class: 'animal' },
        h('div', { class: 'animal-head' }, icon(ICONS.pen, 'ico'), h('b', null, k.k[0].toUpperCase() + k.k.slice(1)), h('span', { class: 'own' }, `you own ${owned}`)),
        h('div', { class: 'animal-price' }, h('span', { class: 'big num' }, money(today)), h('span', { class: `small ${pct < 0 ? 'good' : pct > 0 ? 'bad' : 'muted'}` }, pct === 0 ? 'the usual price' : `${Math.abs(pct)}% ${pct < 0 ? 'below' : 'above'} usual (${money(usual)})`)),
        h('div', { class: 'animal-row' }, h('span', { class: 'small' }, `Buy (up to ${sess.max[k.idx]})`), sb.el),
        h('div', { class: 'animal-row' }, h('span', { class: 'small' }, `Sell at ${money(lingoInt(usual))}${k.k === 'horses' ? ' (keep one)' : ''}`), ss.el),
      );
    });
    const notes: HTMLElement[] = [];
    if (p.cows === 0 && buy.cows > 0) notes.push(chip('First cow: milk for the family, upkeep −$10/mo', { icon: 'kettle', tone: 'good' }));
    if (p.cows > 0 && sell.cows >= p.cows) notes.push(chip('Selling your last cow: upkeep +$10/mo for milk', { icon: 'kettle', tone: 'bad' }));
    const sf = shortfall(s, buyTotal);
    // classic rules re-roll the traders on every visit, so the fetch-and-come-back trick would change the prices
    const fetchFirst = buyTotal > 0 && sf.canFetch && s.fidelity.mode !== 'classic';
    const buyLabel = !buyTotal ? 'Buy' : fetchFirst ? `Fetch ${money(sf.short, { cents: true })} from the box and buy` : `Buy for ${money(buyTotal)}`;
    const buyBtn = btn(buyLabel, { kind: 'go', icon: fetchFirst ? 'box' : undefined, disabled: why ?? (!buyTotal ? 'Choose animals to buy.' : sf.canFetch && !fetchFirst ? 'The traders take cash only. Fetch money from the savings box at home first.' : sf.cannot ? `You need ${money(buyTotal - p.cash - p.savings)} more, even with your savings.` : undefined), onClick: () => {
      // fetching from the box is another errand: come back to the same traders (VISITROLL keeps the month's prices)
      if (fetchFirst && !payWithFetch(session.s, buyTotal, () => void session.run({ type: 'enterLivestockMarket' }, 'enterLivestockMarket'), 'the animals')) return;
      const r = session.run({ type: 'buyLivestock', ...buy }, `Bought livestock for ${money(buyTotal)}`);
      if (r.events.some((e) => e.type === 'cash')) {
        toast(`Bought for ${money(buyTotal)}. Welcome to the farm!`, { icon: 'pen', tone: 'good' });
        buy.horses = buy.pigs = buy.cows = 0;
        stamp = '';
        render(session.s);
      }
    } });
    const sellBtn = btn(sellTotal ? `Sell for ${money(sellTotal)}` : 'Sell', { kind: 'brass', disabled: why ?? (!sellTotal ? 'Choose animals to sell.' : undefined), onClick: () => {
      const r = session.run({ type: 'sellLivestock', ...sell }, `Sold livestock for ${money(sellTotal)}`);
      if (r.events.some((e) => e.type === 'cash')) {
        toast(`Sold for ${money(sellTotal)}.`, { icon: 'coin', tone: 'good' });
        sell.horses = sell.pigs = sell.cows = 0;
        stamp = '';
        render(session.s);
      }
    } });
    put(
      d.body,
      h('div', { class: 'animals' }, ...cards),
      notes.length ? h('div', { class: 'chips' }, ...notes) : null,
      h('div', { class: 'card-actions' }, buyBtn, sellBtn, h('span', { class: 'small muted' }, `Cash ${money(p.cash, { cents: true })}`)),
      h('div', { class: 'lore small' }, icon(ICONS.book), h('span', null, 'Animals need a barn to survive the winter. Traders bring a different number of animals each visit.')),
    );
  }

  const ensure = () => enterLater('enterLivestockMarket', () => !session.s.sessions.livestock && !unavailable.pen(session.s));
  ensure();
  return {
    el,
    update(s: GameState) {
      render(s);
      if (!s.sessions.livestock && !s.pending && !app.busy && !unavailable.pen(s)) ensure();
    },
  };
}

export function register(_env: PanelEnv) {
  registerPanel({
    id: 'pen',
    title: 'Livestock Fair',
    kind: 'place',
    place: 'pen',
    parent: 'homestead',
    hotbar: { key: '8', label: 'Pen', icon: ICONS.pen, order: 80, group: 'place', badge: (s) => badge.pen(s), disabled: (s) => unavailable.pen(s) },
    mount: ({ app }) => mount(app),
  });
}
