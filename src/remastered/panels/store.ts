// General Store (§5.6): the Farmer's Choice catalogue with an order slip. Seeds come in sacks
// (1 sack = 20 acres = one field square), products show stock, "New!" and what they do; the
// slip totals everything, offers "fetch from the box" when cash is short, and an optional
// "Tally it yourself" slate where Harriet checks your arithmetic with her original lines.
import { catalogAvailable, reproduces, seedOrderTotal, type Crop, type GameState, type SimEvent } from '../../sim/index.ts';
import { woodenFenceOffer } from '../../sim/devcut.ts';
import type { CatalogName } from '../../sim/data/tables.ts';
import type { App } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { CROP_NAMES, money2 } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { rm } from '../core/settings.ts';
import { CATALOG_INFO, isNewArrival, seedPrice, SOW_WINDOW, sowable } from '../core/simapi.ts';
import { badge } from '../ui/badges.ts';
import { btn, drawer, stepper, tabs, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { blockedReason, say, shortfall } from './town-common.ts';

type Key = `seed:${Crop}` | `item:${CatalogName}` | 'dc:fence';
interface Line {
  key: Key;
  label: string;
  qty: number;
  unit: string;
  total: number;
  crop?: Crop;
  acres?: number;
}

const CROPS: Crop[] = [2, 3, 4, 1];
const CROP_NOTE: Record<Crop, string> = {
  1: 'Sown in autumn, harvested next spring — safe from September’s fires.',
  2: 'Sown in spring, ripe in June, harvested from September.',
  3: 'Sown in spring. A sturdy feed crop.',
  4: 'Sown in spring. Tall stalks, harvested in autumn.',
};

function mount(app: App) {
  const cart = new Map<Key, number>();
  const typed = new Map<Key, string>();
  let tab: 'seeds' | 'goods' = 'seeds';
  let slate = rm().assists.learning;
  let stamp = '';

  const cat = drawer({ title: 'Farmer’s Choice Catalog', eyebrow: 'General Store · Harriet at the counter', side: 'left', wide: true, cls: 'store-cat' });
  const tabBar = tabs({ tabs: [{ id: 'seeds', label: 'Seeds' }, { id: 'goods', label: 'Implements & Household' }], value: tab, onChange: (v) => { tab = v as typeof tab; stamp = ''; render(session.s); } });
  cat.head.append(tabBar.el);
  const slip = h('section', { class: 'card slip float br' });
  const el = h('div', { class: 'store' }, cat.el, slip);

  const set = (k: Key, v: number) => {
    if (v <= 0) cart.delete(k);
    else cart.set(k, v);
    stamp = '';
    render(session.s);
  };

  function lines(s: GameState): Line[] {
    const out: Line[] = [];
    for (const [k, q] of cart) {
      if (k.startsWith('seed:')) {
        const crop = Number(k.slice(5)) as Crop;
        const acres = q * 20;
        out.push({ key: k, label: `${CROP_NAMES[crop]} seed`, qty: q, unit: `${q} ${q === 1 ? 'sack' : 'sacks'} · ${acres} acres × ${money2(seedPrice(s.date.year, crop))}`, total: seedOrderTotal(s.date.year, crop, acres), crop, acres });
      } else if (k.startsWith('item:')) {
        const name = k.slice(5) as CatalogName;
        const it = catalogAvailable(s).find((c) => c.name === name);
        if (!it) continue;
        out.push({ key: k, label: CATALOG_INFO[name].label, qty: q, unit: `${q} × ${money2(it.price)}`, total: q * it.price });
      } else if (k === 'dc:fence') {
        const o = woodenFenceOffer(s);
        if (o) out.push({ key: k, label: 'Wooden fence', qty: q, unit: `${q} × ${money2(o.price)}`, total: q * o.price });
      }
    }
    return out;
  }

  function seedRow(s: GameState, crop: Crop) {
    const per = seedPrice(s.date.year, crop);
    const sack = seedOrderTotal(s.date.year, crop, 20);
    const have = s.propet.seeds[crop - 1];
    const now = sowable(s, crop);
    const k: Key = `seed:${crop}`;
    const st = stepper({ value: cart.get(k) ?? 0, min: 0, max: 32, label: `sacks of ${CROP_NAMES[crop]}`, onChange: (v) => set(k, v) });
    return h(
      'div',
      { class: 'cat-item' },
      h('div', { class: 'cat-art seed', 'data-crop': String(crop) }, icon(crop === 4 ? ICONS.sprout : ICONS.wheat)),
      h('div', { class: 'cat-main' },
        h('div', { class: 'cat-name' }, CROP_NAMES[crop], now ? h('span', { class: 'pill' }, 'plant now') : h('span', { class: 'pill brass' }, `plant ${SOW_WINDOW[crop]}`)),
        h('div', { class: 'small muted' }, CROP_NOTE[crop]),
        h('div', { class: 'small' }, `${money2(per)} an acre · `, h('b', null, `${money2(sack)} a sack`), ' (plants one square)'),
        have > 0 ? h('div', { class: 'tiny muted' }, `In your barn: ${have} acres = ${Math.floor(have / 20)} ${Math.floor(have / 20) === 1 ? 'square' : 'squares'}${have % 20 ? ` (+${have % 20} acres left over)` : ''}`) : null),
      h('div', { class: 'cat-buy' }, st.el, h('div', { class: 'tiny muted' }, (cart.get(k) ?? 0) ? `plants ${cart.get(k)} ${cart.get(k) === 1 ? 'square' : 'squares'}` : 'sacks')),
    );
  }

  function itemRow(s: GameState, name: CatalogName, price: number, stock: number) {
    const k: Key = `item:${name}`;
    const info = CATALOG_INFO[name];
    const st = stepper({ value: cart.get(k) ?? 0, min: 0, max: stock, label: info.label, onChange: (v) => set(k, v) });
    const owned = name === 'tractor' ? s.propet.tractors : name === 'car' ? s.propet.car : name === 'kodakCamera' ? s.propet.camera : name === 'windMill' ? s.propet.extraWindmills + (s.propet.windmill === 1 ? 1 : 0) : name === 'wireFence' ? (s.propet.fence > 0 ? 1 : 0) : 0;
    return h(
      'div',
      { class: `cat-item${stock <= 0 ? ' sold' : ''}` },
      h('div', { class: 'cat-art' }, icon(name === 'tractor' ? ICONS.plow : name === 'car' ? ICONS.wagon : name === 'kodakCamera' ? ICONS.album : name === 'wireFence' ? ICONS.pen : ICONS.gear)),
      h('div', { class: 'cat-main' },
        h('div', { class: 'cat-name' }, info.label, isNewArrival(s, name) && stock > 0 ? h('span', { class: 'pill red' }, 'New!') : null),
        h('div', { class: 'small' }, h('b', null, 'What it does: '), info.does),
        h('div', { class: 'small muted' }, `${money2(price)}${reproduces(s.fidelity, 'CATSTOCK') ? '' : ` · ${stock > 0 ? `${stock} in stock` : 'none left'}`}${owned ? ` · you own ${owned}` : ''}`)),
      h('div', { class: 'cat-buy' }, stock > 0 ? st.el : h('span', { class: 'stamp' }, 'SOLD OUT')),
    );
  }

  function fenceRow(s: GameState) {
    const o = woodenFenceOffer(s);
    if (!o) return null;
    const st = stepper({ value: cart.get('dc:fence') ?? 0, min: 0, max: o.stock, label: 'wooden fence', onChange: (v) => set('dc:fence', v) });
    return h('div', { class: `cat-item${o.soldOut ? ' sold' : ''}` }, h('div', { class: 'cat-art' }, icon(ICONS.pen)), h('div', { class: 'cat-main' }, h('div', { class: 'cat-name' }, 'Wooden fence', h('span', { class: 'pill blue' }, 'Developer’s Cut')), h('div', { class: 'small' }, h('b', null, 'What it does: '), 'Keeps stray cattle out — until they break through.'), h('div', { class: 'small muted' }, money2(o.price))), h('div', { class: 'cat-buy' }, o.soldOut ? h('span', { class: 'stamp' }, 'SOLD OUT') : st.el));
  }

  function renderSlip(s: GameState) {
    const ls = lines(s);
    const total = Math.round(ls.reduce((a, l) => a + l.total, 0) * 100) / 100;
    const sf = shortfall(s, total);
    const why = blockedReason();
    const seedLines = ls.filter((l) => l.crop);
    const rows = ls.map((l) => {
      const rm_ = btn('', { kind: 'plain', icon: 'close', small: true, title: 'Remove', onClick: () => set(l.key, 0) });
      const tally = slate && l.crop
        ? (() => {
            const inp = h('input', { type: 'text', inputMode: 'decimal', class: 'tally-in', placeholder: '?', value: typed.get(l.key) ?? '', 'aria-label': `Total for ${l.label}` }) as HTMLInputElement;
            inp.addEventListener('input', () => typed.set(l.key, inp.value.replace(/[^\d.]/g, '')));
            return h('div', { class: 'tally' }, h('span', { class: 'chalk' }, `${l.acres} × ${money2(seedPrice(s.date.year, l.crop))} = $`), inp);
          })()
        : null;
      return h('li', null, h('div', { class: 'slip-l' }, h('b', null, l.label), h('small', null, l.unit)), tally ? h('span', { class: 'num faint' }, '…') : h('span', { class: 'num' }, money2(l.total)), rm_, tally);
    });
    const pay = () => doPay();
    const payBtn = btn(total ? `Pay ${money2(total)}` : 'Pay', { kind: 'go', disabled: why ?? (!ls.length ? 'Your order is empty.' : sf.canFetch || sf.cannot ? 'Not enough cash in hand.' : undefined), onClick: pay });
    const fetchBtn = sf.canFetch && ls.length ? btn(`Fetch ${money2(sf.short)} from the box`, { kind: 'brass', icon: 'box', disabled: why ?? undefined, onClick: () => {
      session.run({ type: 'withdrawSavings', amount: Math.ceil(sf.short * 100) / 100 }, `Fetched ${money2(sf.short)} from the savings box`);
      toast(`Took ${money2(sf.short)} from the savings box.`, { icon: 'box', quiet: true });
    } }) : null;
    put(
      slip,
      h('div', { class: 'spread' }, h('h3', { class: 'card-title' }, 'Order slip'), h('label', { class: 'small slate-t', title: 'Work out the seed totals yourself; Harriet will check them.' }, (() => { const c = h('input', { type: 'checkbox', checked: slate }) as HTMLInputElement; c.addEventListener('change', () => { slate = c.checked; stamp = ''; render(session.s); }); return c; })(), ' Tally it yourself')),
      ls.length ? h('ol', { class: 'slip-lines' }, ...rows) : h('div', { class: 'empty' }, 'Nothing ordered yet. Use + to add sacks or goods.'),
      h('div', { class: 'slip-total' }, h('span', { class: 'eyebrow' }, 'Total'), h('b', { class: 'big num' }, slate && seedLines.length ? '?' : money2(total))),
      h('div', { class: 'small muted num' }, `Cash ${money2(s.propet.cash)} · Savings box ${money2(s.propet.savings)}`),
      ls.length && !sf.canFetch && !sf.cannot ? h('div', { class: 'small num' }, `After paying: ${money2(s.propet.cash - total)} cash`) : null,
      sf.canFetch && ls.length ? h('div', { class: 'small warn-t' }, `You're ${money2(sf.short)} short in cash. The store takes cash only.`) : null,
      sf.cannot && ls.length ? h('div', { class: 'small bad' }, `Even with your savings you're ${money2(total - s.propet.cash - s.propet.savings)} short. Take something off the slip, or:`) : null,
      sf.cannot && ls.length
        ? h('div', { class: 'row' },
            s.cursit.bushels.some((b) => b > 0) ? btn('Sell grain at the elevator', { kind: 'brass', small: true, icon: 'elevator', onClick: () => void app.go('elevator') }) : null,
            btn('Ask the bank for a loan', { kind: 'brass', small: true, icon: 'bank', onClick: () => void app.go('bank') }))
        : null,
      h('div', { class: 'card-actions' }, fetchBtn, payBtn),
    );
  }

  function doPay() {
    const s = session.s;
    let ok = 0;
    for (const l of lines(s)) {
      if (l.crop && l.acres) {
        let typedTotal: number | undefined;
        if (slate) {
          const v = typed.get(l.key);
          if (!v) return void toast(`Write the total for ${l.label} on the slate first.`, { icon: 'warn' });
          typedTotal = Number(v);
        }
        const r = session.run({ type: 'buySeeds', crop: l.crop, acres: l.acres, typedTotal }, `Bought ${l.qty} ${l.qty === 1 ? 'sack' : 'sacks'} of ${CROP_NAMES[l.crop]}`);
        const d = r.events.find((e): e is Extract<SimEvent, { type: 'dialog' }> => e.type === 'dialog');
        if (d?.id === 'SEG70') {
          cart.delete(l.key);
          typed.delete(l.key);
          ok++;
          if (slate) toast('Right! Harriet stamps a Sharp Pencil in your ledger.', { icon: 'star', tone: 'gold' });
          continue;
        }
        if (d?.id === 'SEG69' && d.params?.total !== undefined) typed.set(l.key, String(d.params.total));
        if (d) say(`STORE.${d.id}`);
        stamp = '';
        render(session.s);
        return;
      }
      if (l.key.startsWith('item:')) {
        const name = l.key.slice(5) as CatalogName;
        const r = session.run({ type: 'buyCatalogItem', name, qty: l.qty }, `Bought ${l.qty} × ${CATALOG_INFO[name].label}`);
        if (r.events.some((e) => e.type === 'dialog' || e.type === 'rejected')) break;
        cart.delete(l.key);
        ok++;
      } else if (l.key === 'dc:fence') {
        for (let i = 0; i < l.qty; i++) session.run({ type: 'devcut', action: { kind: 'buyWoodenFence' } } as never, 'Bought a wooden fence');
        cart.delete(l.key);
        ok++;
      }
    }
    stamp = '';
    render(session.s);
    if (ok) {
      say('STORE.SEG70', 'Harriet');
      toast('Paid. Harriet wraps up your order.', { icon: 'cart', tone: 'good', quiet: true });
    }
  }

  function render(s: GameState) {
    const key = JSON.stringify([s.date.year, s.date.mon, s.propet.cash, s.propet.savings, s.propet.seeds, s.catalog, tab, slate, !!s.pending, [...cart], s.devcut?.woodenFenceStock]);
    if (key === stamp) return;
    stamp = key;
    if (tab === 'seeds') {
      // first spring: suggest a sensible first order instead of leaving a new player to guess
      const firstOrder = s.date.year === 1880 && s.propet.seeds.every((x) => x < 20) && s.cursit.numPlanted === 0 && !cart.size && sowable(s, 2);
      const sack2 = seedOrderTotal(s.date.year, 2, 20);
      const p0 = s.propet;
      const wm = catalogAvailable(s).find((c) => c.name === 'windMill' && c.stock > 0);
      const needWm = !!wm && !(p0.windmill === 1 || p0.extraWindmills > 0) && p0.toBuildWindmill === 0;
      const spare = s.propet.cash - 6 * s.propet.lifePrice - (needWm ? wm!.price : 0);
      const n = Math.max(1, Math.min(4, Math.floor(spare / sack2)));
      const suggest = firstOrder
        ? h('div', { class: 'callout suggest' }, h('b', null, 'Harriet suggests: '), `${n} sacks of spring wheat (${money2(n * sack2)}). That plants ${n} squares${needWm ? `, and a windmill (${money2(wm!.price)}) for your well` : ''}, and leaves money for the winter.`, ' ', btn('Add to my order', { kind: 'go', small: true, onClick: () => { if (needWm) cart.set('item:windMill', 1); set('seed:2', n); } }))
        : null;
      put(cat.body, h('div', { class: 'cat-intro small muted' }, 'One sack plants one square of your field (20 acres).'), suggest, ...CROPS.map((c) => seedRow(s, c)));
    } else {
      // CATORDER (ui quirk): classic shows in-stock product pages in reverse order.
      const avail = catalogAvailable(s);
      const items = reproduces(s.fidelity, 'CATORDER') ? [...avail.filter((i) => i.stock > 0).reverse(), ...avail.filter((i) => i.stock <= 0)] : avail;
      put(cat.body, ...items.map((i) => itemRow(s, i.name, i.price, i.stock)), fenceRow(s), items.length < 5 ? h('div', { class: 'lore small' }, icon(ICONS.book), h('span', null, 'New goods arrive in the catalogue over the years, each April.')) : null);
    }
    renderSlip(s);
    app.setLabels([{ target: { kind: 'prop', id: 'counter' }, text: 'Harriet’s counter' }]);
  }

  // STOREGREET (ui quirk): classic greets on the first two visits per run; fixed: first visit each month.
  const st0 = session.s;
  const monthKey = st0.date.year * 12 + st0.date.mon;
  const greet = reproduces(st0.fidelity, 'STOREGREET') ? greetState.visits < 2 : greetState.month !== monthKey;
  greetState.visits++;
  greetState.month = monthKey;
  if (greet) say('STORE.SEG66', 'Harriet');
  return { el, update: (s: GameState) => render(s), crumb: () => (tab === 'seeds' ? 'Seeds' : 'Catalogue') };
}

const greetState = { visits: 0, month: -1 };

export function register(_env: PanelEnv) {
  registerPanel({
    id: 'store',
    title: 'General Store',
    kind: 'place',
    place: 'store',
    parent: 'street',
    hotbar: { key: '5', label: 'Store', icon: ICONS.store, order: 50, group: 'place', badge: (s) => badge.store(s) },
    mount: ({ app }) => mount(app),
  });
}
