// Main Street (§5.3): the town hub. Building plates and a directory, the Town Talk boardwalk,
// For-Sale business cards, the 1909 Land Office claim, and the O'Grady wagon.
import { BUSINESSES, CLAIM } from '../../sim/data/tables.ts';
import { businessForSale, claimAvailable, reproduces, type GameState } from '../../sim/index.ts';
import type { App, Label } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { money, monthName } from '../core/format.ts';
import { ICONS, type IconName } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { badge } from '../ui/badges.ts';
import { btn, chip, drawer, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { blockedReason, enterLater, payWithFetch, shortfall } from './town-common.ts';

/** What each town talk is about, in a few words (from its lines), for "New talk in town: …". */
export const TALK_TOPIC: Record<number, string> = {
  101: 'meet your neighbors',
  102: 'harvest time and where to sell your grain',
  103: 'wheat prices and the new schoolhouse',
  104: 'harvest pies and a new Kansas law',
  105: 'does plowing bring rain?',
  106: 'winter wheat and the railroads',
  107: 'a dry spell, and wheat prices rise',
  108: 'the drought is here',
  109: 'the drought, and women elected in Kansas',
  110: 'the farmers’ alliance and a hauler on Main Street',
  111: 'the Oklahoma land rush and hard times',
  112: 'the railroad strike',
  113: 'the laundry is for sale',
  114: 'your daughter and college',
  115: 'the Enlarged Homestead Act: more land',
  116: 'war in Europe',
  117: 'America enters the war',
  118: 'the war is over',
  119: 'good wheat prices and the 18th Amendment',
  120: 'Home on the Range',
  121: 'a new way to sell your crops: O’Grady',
  201: 'your daughter’s wedding',
  202: 'your daughter’s wedding',
  203: 'your daughter’s wedding',
  204: 'your son’s wedding',
  205: 'your son’s wedding',
  206: 'your son’s wedding',
  220: 'cattle in your fields, and fences',
  301: 'how the mayor is doing',
  302: 'how the mayor is doing',
  303: 'the race for mayor',
};

export function talkAvailable(s: GameState) {
  const g = s.globals;
  if (g.tTalk <= 0) return null;
  const t = s.ttalk[g.tTalk - 1];
  const fresh = g.blinkTTalk === 1 || (s.date.year === 1880 && s.date.mon === 4 && g.firstTT !== 1);
  const id = t?.id ?? g.tTalkName;
  return { id, fresh, first: s.date.year === 1880 && s.date.mon === 4 && g.firstTT !== 1, topic: TALK_TOPIC[id] ?? null };
}

/** Join the town talk: the sim visit, then the boardwalk sheet. */
export function joinTalk(app: App) {
  const s = session.s;
  const t = talkAvailable(s);
  if (!t) return void toast('Nobody is gathered on the boardwalk today.', { icon: 'talk' });
  if (session.blocked) return void toast('Answer the letter first.', { icon: 'letter' });
  const r = session.run({ type: 'visitTownTalk' }, 'Town talk');
  const ev = r.events.find((e) => e.type === 'townTalk');
  const id = ev && ev.type === 'townTalk' ? ev.id : t.id;
  void app.go('talk', { id });
}

function mount(app: App) {
  const d = drawer({ title: 'Main Street', eyebrow: 'Longview, Buffalo County, Kansas', cls: 'town-drawer' });
  const el = h('div', { class: 'street' }, d.el);
  let stamp = '';

  function place(id: string, ico: IconName, name: string, sub: string, b: { text: string; tone?: string } | null) {
    const row = h('button', { type: 'button', class: 'dir-row' }, icon(ICONS[ico], 'ico dir-ico'), h('span', { class: 'dir-t' }, h('b', null, name), h('small', null, sub)), b ? h('span', { class: `dir-badge tone-${b.tone ?? 'info'}` }, b.text) : null, icon(ICONS.next, 'ico dir-go'));
    row.addEventListener('click', () => void app.go(id));
    return row;
  }

  function talkCard(s: GameState) {
    const t = talkAvailable(s);
    if (!t) return null;
    const join = btn(t.fresh ? 'Join them on the boardwalk' : 'Hear them again', { kind: t.fresh ? 'go' : 'ghost', icon: 'talk', wide: true, onClick: () => joinTalk(app) });
    return h(
      'div',
      { class: `card-inset talk-cta${t.fresh ? ' fresh' : ''}${t.first ? ' first' : ''}` },
      h('div', { class: 'icon-row' }, icon(ICONS.people), h('b', null, t.first ? 'Your new neighbors are waiting to meet you' : t.fresh ? `New talk in town: ${t.topic ?? `${monthName(s.date.mon)} news`}` : `Heard already: ${t.topic ?? 'this month’s talk'}`)),
      t.first
        ? h('p', { class: 'small' }, 'Say hello to Longview. They will tell you who they are and how things work here. After that, your neighbors raise your sod house.')
        : t.fresh
          ? h('p', { class: 'small muted' }, `A new conversation for ${monthName(s.date.mon)} ${s.date.year}: news, prices and advice. It's optional; everything they say is kept in your Almanac.`)
          : h('p', { class: 'small muted' }, 'You heard this one. The next talk comes with a later month.'),
      join,
    );
  }

  function bizCard(s: GameState) {
    const k = businessForSale(s);
    if (!k) return null;
    const b = BUSINESSES[k - 1];
    const income = reproduces(s.fidelity, 'T7') ? b.income : b.adIncome;
    const sf = shortfall(s, b.price);
    const why = blockedReason();
    const buy = () => session.run({ type: 'buyBusiness', business: k }, `Bought ${b.id}`);
    const action = sf.cannot
      ? btn(`Need ${money(b.price - s.propet.cash - s.propet.savings)} more`, { kind: 'ghost', disabled: 'Not enough cash and savings.' })
      : sf.canFetch
        ? btn(`Fetch ${money(sf.short, { cents: true })} from the box and buy`, { kind: 'go', icon: 'box', disabled: why ?? undefined, onClick: () => payWithFetch(session.s, b.price, buy, b.id) })
        : btn(`Buy for ${money(b.price)}`, { kind: 'go', disabled: why ?? undefined, onClick: buy });
    return h(
      'div',
      { class: 'ad-card' },
      h('div', { class: 'ad-head' }, h('span', { class: 'ad-for' }, 'FOR SALE'), h('span', { class: 'ad-agent' }, 'Brown & Fryer Real Estate')),
      h('div', { class: 'ad-name' }, b.id),
      h('div', { class: 'ad-figs' },
        h('div', null, h('small', null, 'Price'), h('b', null, money(b.price))),
        h('div', null, h('small', null, 'Income'), h('b', null, `${money(income)}/mo`)),
        h('div', null, h('small', null, 'Pays back in'), h('b', null, `${Math.ceil(b.price / income)} mo`))),
      h('div', { class: 'chips' }, chip(`+${b.score} standing`, { icon: 'star', tone: 'good' }), chip('Paid every month, forever', { icon: 'coin', tone: 'info' })),
      h('div', { class: 'small muted' }, `Offer ends in March ${b.startYear + 1}. Cash only. You have ${money(s.propet.cash, { cents: true })} cash + ${money(s.propet.savings, { cents: true })} in the box.`),
      income !== b.adIncome ? h('div', { class: 'tiny muted' }, `The sign says ${money(b.adIncome)}; in the 1996 rules it pays ${money(income)}.`) : null,
      action,
    );
  }

  function claimCard(s: GameState) {
    if (!claimAvailable(s)) return null;
    const why = blockedReason();
    return h(
      'div',
      { class: 'ad-card claim', id: 'claim-card' },
      h('div', { class: 'ad-head' }, h('span', { class: 'ad-for' }, 'LAND FOR FREE'), h('span', { class: 'ad-agent' }, 'U.S. Land Office')),
      h('div', { class: 'ad-name' }, '160 more acres'),
      h('p', { class: 'small' }, 'The Enlarged Homestead Act: file a second claim and your farm doubles to 16 squares. Businesspeople need it for their goal.'),
      h('div', { class: 'small muted' }, `Filing fee ${money(CLAIM.price)}. Open until March 1910.`),
      ((): HTMLElement => {
        const sf = shortfall(s, CLAIM.price);
        const sign = () => {
          const r = session.run({ type: 'buyClaim' }, 'Signed the second claim');
          if (r.state.propet.numFields === 2) toast('Your farm now has 16 squares. The new quarter section is beside your field.', { icon: 'field', tone: 'good' });
        };
        return btn(sf.canFetch ? `Fetch ${money(sf.short, { cents: true })} from the box and sign (${money(CLAIM.price)})` : `Sign the claim (${money(CLAIM.price)})`, { kind: 'go', icon: 'sign', disabled: why ?? (sf.cannot ? 'Not enough money, even with your savings.' : undefined), onClick: () => (sf.canFetch ? payWithFetch(session.s, CLAIM.price, sign, 'the claim') : sign()) });
      })(),
    );
  }

  function render(s: GameState) {
    const key = JSON.stringify([s.date, s.globals.tTalk, s.globals.blinkTTalk, s.propet.cash, s.propet.savings, s.propet.business, s.propet.numFields, s.sessions.town, !!s.pending, s.myRecieve, s.cursit.bushels]);
    if (key === stamp) return;
    stamp = key;
    const og = s.date.year >= 1886 ? (s.sessions.town?.dealers === 2 ? "O'Grady's grain wagon is parked by the station today." : "O'Grady's hauler is not in town today.") : null;
    const tk = talkAvailable(s);
    const freshTalk = !!tk?.fresh;
    put(
      d.body,
      freshTalk ? talkCard(s) : null,
      claimCard(s),
      bizCard(s),
      h('div', { class: 'eyebrow dir-h' }, 'On Main Street'),
      h('div', { class: 'dir' },
        place('store', 'store', 'General Store', 'Seeds, tools & the catalogue', badge.store(s)),
        place('bank', 'bank', "Farmers' Bank", `Loans · today's rate ${s.interest}%`, badge.bank(s)),
        place('elevator', 'elevator', 'Grain Elevator', 'Sell your harvest to Ed', badge.elevator(s))),
      og ? h('div', { class: 'small muted og-note' }, icon(ICONS.wagon), og) : null,
      freshTalk ? null : talkCard(s),
      h('div', { class: 'lore small' }, icon(ICONS.home), h('span', null, `${monthName(s.date.mon)} ${s.date.year}. Travel is free: going to town never costs a day.`)),
    );
    const labels: Label[] = [
      { target: { kind: 'place', place: 'store' }, text: 'General Store', badge: badge.store(s)?.text },
      { target: { kind: 'place', place: 'bank' }, text: "Farmers' Bank", badge: badge.bank(s)?.text },
      { target: { kind: 'place', place: 'elevator' }, text: 'Grain Elevator', badge: badge.elevator(s)?.text },
    ];
    const t = talkAvailable(s);
    if (t) labels.push({ target: { kind: 'prop', id: 'boardwalk' }, text: 'Town Talk', badge: t.fresh ? 'Now' : null, tone: t.fresh ? 'urgent' : 'info', onClick: () => joinTalk(app) });
    if (claimAvailable(s)) labels.push({ target: { kind: 'prop', id: 'claim' }, text: 'Land Office', badge: 'Free land', tone: 'good', onClick: () => d.body.querySelector('#claim-card')?.scrollIntoView({ behavior: 'smooth' }) });
    if (businessForSale(s)) labels.push({ target: { kind: 'prop', id: 'forsale' }, text: 'For Sale', tone: 'good' });
    app.setLabels(labels);
  }

  enterLater('enterTown', () => !session.s.sessions.town);
  return {
    el,
    update(s: GameState) {
      render(s);
      if (!s.sessions.town && !s.pending && !app.busy) enterLater('enterTown', () => !session.s.sessions.town && app.placeId === 'street');
    },
    onPick(t: { kind: string; id?: string }) {
      if (t.kind === 'prop' && t.id === 'boardwalk') {
        joinTalk(app);
        return true;
      }
      if (t.kind === 'prop' && t.id === 'claim') {
        d.body.querySelector('#claim-card')?.scrollIntoView({ behavior: 'smooth' });
        return true;
      }
      return false;
    },
  };
}

export function register(_env: PanelEnv) {
  registerPanel({
    id: 'street',
    title: 'Main Street',
    kind: 'place',
    place: 'mainStreet',
    parent: 'homestead',
    hotbar: { key: '4', label: 'Main Street', icon: ICONS.street, order: 40, group: 'place', badge: (s) => badge.street(s) },
    mount: ({ app }) => mount(app),
  });
}
