// Grain Elevator (§5.4): your grain at today's prices, the offers side by side (Ed pays cash
// now; O'Grady pays more, later, at the bank, with storm risk), the Dev Cut freight office as
// a third card, and a price-history chart of past years.
import { grainQuote, reproduces, type GameState } from '../../sim/index.ts';
import type { App } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { CROP_NAMES, money, money2, num } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { rm } from '../core/settings.ts';
import { priceHistory } from '../core/simapi.ts';
import { devcutContent } from '../core/text.ts';
import { freightOfferCard } from '../devcut/index.ts';
import { badge } from '../ui/badges.ts';
import { btn, drawer, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { blockedReason, enterLater, legend, lineChart, say } from './town-common.ts';

let lastSale: { year: number; mon: number; text: string } | null = null;
const drought = (y: number) => y >= 1887 && y <= 1890;

function edGreeting(y: number, two: boolean) {
  if (two) return drought(y) ? 'TSTREET.707' : y >= 1915 ? 'TSTREET.711' : 'TSTREET.713';
  return drought(y) ? 'TSTREET.707' : y >= 1915 ? 'TSTREET.709' : 'TSTREET.700';
}
function edThanks(y: number, two: boolean) {
  if (y === 1880) return 'TSTREET.702';
  if (two) return drought(y) || y >= 1915 ? 'TSTREET.712' : 'TSTREET.714';
  return drought(y) ? 'TSTREET.708' : 'TSTREET.706';
}
const ogGreeting = (y: number) => (y === 1886 ? 'TSTREET.703' : y >= 1915 ? 'TSTREET.719' : 'TSTREET.718');

function mount(app: App) {
  const d = drawer({ title: 'Grain Elevator', eyebrow: 'Ed at the scale · by the railroad depot', wide: true, cls: 'elev-drawer' });
  const el = h('div', { class: 'elevator' }, d.el);
  let stamp = '';
  let greeted = false;
  let ogTimer = 0;

  function render(s: GameState) {
    const dealers = s.sessions.town?.dealers ?? 1;
    const key = JSON.stringify([s.cursit.bushels, s.cursit.prices, s.propet.cash, s.myRecieve, dealers, !!s.pending, s.date, s.devcut?.enabled]);
    if (key === stamp) return;
    stamp = key;
    const q = grainQuote(s);
    const has = q.bushels.some((b) => b > 0);
    const strike = s.date.year === 1894 && (s.date.mon === 6 || s.date.mon === 7);
    const why = blockedReason();
    const hist = priceHistory(s);
    const chart = h(
      'div',
      { class: 'hist' },
      h('div', { class: 'spread' }, h('span', { class: 'eyebrow' }, 'Price per bushel, past years'), legend([{ label: 'Wheat', color: 'var(--c2)' }, { label: 'Oats', color: 'var(--c1)' }, { label: 'Corn', color: 'var(--c3)' }])),
      lineChart({ years: hist.map((r) => r.year), series: [{ label: 'Wheat', color: 'var(--c2)', values: hist.map((r) => r.wheat) }, { label: 'Oats', color: 'var(--c1)', values: hist.map((r) => r.oats) }, { label: 'Corn', color: 'var(--c3)', values: hist.map((r) => r.corn) }], markYear: s.date.year, height: 140 }),
      hist.some((r) => drought(r.year)) ? h('div', { class: 'tiny muted' }, '1887–1890: drought in western Kansas made grain scarce and prices high.') : null,
    );
    if (!has) {
      const sold = lastSale && lastSale.year === s.date.year && lastSale.mon === s.date.mon ? lastSale : null;
      put(
        d.body,
        sold
          ? h('div', { class: 'empty-elev sold' }, icon(ICONS.coin, 'ico big-ico'), h('h3', { class: 'card-title' }, 'All sold'), h('p', null, sold.text), btn('Back to the homestead', { kind: 'brass', icon: 'home', onClick: () => void app.go('homestead') }))
          : h('div', { class: 'empty-elev' }, icon(ICONS.wheat, 'ico big-ico'), h('h3', { class: 'card-title' }, 'Nothing to sell yet'), h('p', { class: 'small muted' }, 'Harvest your field first. Your grain waits safely at the farm until you bring it here.'), btn('Go to the field', { kind: 'brass', icon: 'field', onClick: () => void app.go('field') })),
        chart,
      );
      app.setLabels([{ target: { kind: 'prop', id: 'scale' }, text: 'Ed’s scale' }]);
      return;
    }
    const rows = [0, 1, 2, 3].filter((i) => q.bushels[i] > 0);
    const table = h(
      'table',
      { class: 'ledger-t num' },
      h('thead', null, h('tr', null, h('th', null, 'Crop'), h('th', null, 'Bushels'), h('th', null, '$ / bu'), h('th', null, 'Total'))),
      h('tbody', null, ...rows.map((i) => h('tr', null, h('td', null, CROP_NAMES[i + 1]), h('td', null, num(q.bushels[i])), h('td', null, priceText(s, i, q.prices[i])), h('td', null, money2(q.bushels[i] * q.prices[i]))))),
    );
    let offers: HTMLElement;
    if (strike) {
      offers = h('div', { class: 'callout warn' }, h('b', null, 'The railroad strike. '), 'Ed’s elevator is full and no trains are running. ', reproduces(s.fidelity, 'T1') ? 'In the 1996 rules, trying to sell now loses your grain!' : 'Your grain is safe at home; come back in August.');
    } else {
      const two = dealers === 2;
      const og = Math.max(reproduces(s.fidelity, 'OGNEG') ? q.ogradyTotal : 0, q.ogradyTotal);
      const diff = og - q.localTotal;
      const ed = h(
        'div',
        { class: `offer${!two || diff <= 0 ? ' best' : ''}` },
        h('div', { class: 'eyebrow' }, 'Ed · Longview elevator'),
        h('div', { class: 'big num' }, money2(q.localTotal)),
        h('div', { class: 'small muted' }, 'Cash in your hand today.'),
        btn('Sell to Ed', { kind: 'go', disabled: why ?? undefined, onClick: () => {
          const before = session.s.propet.cash;
          lastSale = { year: s.date.year, mon: s.date.mon, text: `Ed paid you ${money2(q.localTotal)} for ${num(q.bushels.reduce((a, b) => a + b, 0))} bushels. It’s in your cash now.` };
          session.run({ type: 'sellGrain', dealer: 'local' }, 'Sold grain to Ed');
          if (session.s.propet.cash <= before) lastSale = null;
          else {
            say(edThanks(s.date.year, two), 'Ed');
            toast(`Sold to Ed. ${money2(q.localTotal)} cash.`, { icon: 'coin', tone: 'good', quiet: true });
          }
        } }),
      );
      const ogCard = two
        ? h(
            'div',
            { class: `offer${diff > 0 ? ' best' : ''}` },
            h('div', { class: 'eyebrow' }, 'O’Grady hauler · in town today'),
            h('div', { class: 'big num' }, money2(og), h('small', { class: diff >= 0 ? 'good' : 'bad' }, ` ${diff >= 0 ? '+' : '−'}${money(Math.abs(diff), { cents: true })}`)),
            h('div', { class: 'small muted' }, `+${q.bonusCents}¢ a bushel, minus a ${money(q.haul)} haul fee. Paid later at the bank cashier.`),
            h('div', { class: 'small warn-t' }, icon(ICONS.warn), rm().assists.ogradyOdds ? ' About 1 trip in 2, a storm ruins 20–50% of the load.' : ' Storms sometimes ruin part of a wagonload.'),
            btn("Send with O'Grady", { kind: 'brass', icon: 'wagon', disabled: why ?? undefined, onClick: () => {
              lastSale = { year: s.date.year, mon: s.date.mon, text: 'O’Grady hauled your grain away. Collect your money at the bank cashier.' };
              session.run({ type: 'sellGrain', dealer: 'ogrady' }, "Sent grain with O'Grady");
              say('TSTREET.717');
              toast("Sent with O'Grady. Collect your money at the bank cashier.", { icon: 'bank', tone: 'good', action: { label: 'Go to the bank', onClick: () => void app.go('bank') } });
            } }),
          )
        : h('div', { class: 'offer absent' }, h('div', { class: 'eyebrow' }, 'O’Grady hauler'), h('div', { class: 'small muted' }, s.date.year < 1886 ? 'The hauler starts coming to Longview in 1886.' : 'The hauler isn’t in town today. He comes some days.'));
      const dc = devcutContent();
      const fr = dc && s.devcut?.enabled ? freightOfferCard(s, dc, { compareTo: q.localTotal, onShip: (i) => session.run({ type: 'devcut', action: { kind: 'shipGrain', offer: i } } as never, 'Shipped grain by rail') }) : null;
      offers = h('div', { class: `offers${fr ? ' three' : ''}` }, ed, ogCard, fr);
    }
    put(d.body, h('h3', { class: 'card-title' }, 'Your grain'), table, offers, chart);
    app.setLabels([{ target: { kind: 'prop', id: 'scale' }, text: 'Ed’s scale', badge: `${num(q.bushels.reduce((a, b) => a + b, 0))} bu`, tone: 'good' }]);
    if (!greeted && s.sessions.town) {
      greeted = true;
      // STRIKESND (ui quirk): classic plays stale/no dealer lines during the 1894 strike.
      // STRIKE721: the "strike is over" line (Dev Cut games, Aug 1894) only when fixed.
      const after = s.date.year === 1894 && s.date.mon === 8 && !!s.devcut?.enabled && !reproduces(s.fidelity, 'STRIKE721');
      if (strike && reproduces(s.fidelity, 'STRIKESND')) void 0;
      else say(strike ? 'TSTREET.720' : after ? 'TSTREET.721' : edGreeting(s.date.year, dealers === 2), 'Ed');
      if (dealers === 2) ogTimer = window.setTimeout(() => app.placeId === 'elevator' && say(ogGreeting(s.date.year), "O'Grady hauler"), 9000);
    }
  }

  enterLater('enterTown', () => !session.s.sessions.town);
  return {
    el,
    update(s: GameState) {
      render(s);
      if (!s.sessions.town && !s.pending && !app.busy) enterLater('enterTown', () => !session.s.sessions.town && app.placeId === 'elevator');
    },
    destroy: () => window.clearTimeout(ogTimer),
  };
}

export function register(_env: PanelEnv) {
  registerPanel({
    id: 'elevator',
    title: 'Grain Elevator',
    kind: 'place',
    place: 'elevator',
    parent: 'street',
    hotbar: { key: '7', label: 'Elevator', icon: ICONS.elevator, order: 70, group: 'place', badge: (s) => badge.elevator(s) },
    mount: ({ app }) => mount(app),
  });
}

/** PT4 (ui quirk): the 1996 elevator truncated the corn price display to 4 characters ("$1" for $0.60). */
function priceText(s: GameState, crop: number, p: number) {
  if (crop === 3 && reproduces(s.fidelity, 'PT4')) return `$${Math.round(p)}`.slice(0, 4);
  return p.toFixed(2);
}
