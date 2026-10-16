// Placeholder World3D used until src/world/index.ts (the real three.js world) lands, and as a
// fallback if WebGL is unavailable. A painted-gradient sky over a prairie, simple silhouettes
// and labelled hotspots, all DOM. It honours the full World3D contract so the UI can't tell.
import type { DisasterKind, PickTarget, Place, Quality, World3D, WorldView } from '../world/api.ts';

interface Spot {
  t: PickTarget;
  x: number; // % of host
  y: number;
  label: string;
  shape?: 'house' | 'barn' | 'windmill' | 'mailbox' | 'town' | 'pen' | 'field' | 'prop' | 'store' | 'bank' | 'elevator' | 'claim' | 'boardwalk';
}

const HOME: Spot[] = [
  { t: { kind: 'place', place: 'mainStreet' }, x: 17, y: 41, label: 'Longview', shape: 'town' },
  { t: { kind: 'place', place: 'house' }, x: 52, y: 55, label: 'House', shape: 'house' },
  { t: { kind: 'place', place: 'field' }, x: 30, y: 70, label: 'Field', shape: 'field' },
  { t: { kind: 'place', place: 'pen' }, x: 80, y: 66, label: 'Pen', shape: 'pen' },
  { t: { kind: 'mailbox' }, x: 63, y: 70, label: 'Mailbox', shape: 'mailbox' },
];
const GHOST_POS: Record<string, { x: number; y: number }> = {
  house: { x: 52, y: 55 },
  barn: { x: 74, y: 52 },
  windmill: { x: 64, y: 46 },
  woodFence: { x: 30, y: 82 },
  barbedFence: { x: 30, y: 82 },
};
const STREET: Spot[] = [
  { t: { kind: 'place', place: 'store' }, x: 24, y: 55, label: 'General Store', shape: 'store' },
  { t: { kind: 'place', place: 'bank' }, x: 47, y: 52, label: "Farmers' Bank", shape: 'bank' },
  { t: { kind: 'place', place: 'elevator' }, x: 75, y: 45, label: 'Grain Elevator', shape: 'elevator' },
  { t: { kind: 'prop', id: 'boardwalk' }, x: 36, y: 72, label: 'Boardwalk', shape: 'boardwalk' },
  { t: { kind: 'prop', id: 'claim' }, x: 60, y: 66, label: 'Land Office', shape: 'claim' },
  { t: { kind: 'place', place: 'homestead' }, x: 90, y: 78, label: 'Road home', shape: 'prop' },
];
const INTERIOR: Record<string, Spot[]> = {
  house: [
    { t: { kind: 'prop', id: 'ledger' }, x: 40, y: 62, label: 'Ledger', shape: 'prop' },
    { t: { kind: 'prop', id: 'album' }, x: 62, y: 66, label: 'Family Album', shape: 'prop' },
    { t: { kind: 'prop', id: 'savings' }, x: 74, y: 76, label: 'Savings box', shape: 'prop' },
    { t: { kind: 'prop', id: 'newspaper' }, x: 24, y: 70, label: 'Newspapers', shape: 'prop' },
  ],
  store: [{ t: { kind: 'prop', id: 'counter' }, x: 40, y: 62, label: 'Counter', shape: 'prop' }],
  bank: [
    { t: { kind: 'prop', id: 'teller' }, x: 34, y: 55, label: 'Cashier', shape: 'prop' },
    { t: { kind: 'prop', id: 'loans' }, x: 64, y: 55, label: 'Loans', shape: 'prop' },
  ],
  elevator: [{ t: { kind: 'prop', id: 'scale' }, x: 40, y: 64, label: 'Scale', shape: 'prop' }],
  pen: [{ t: { kind: 'prop', id: 'animals' }, x: 50, y: 64, label: 'Animals', shape: 'prop' }],
};

const sameTarget = (a: PickTarget, b: PickTarget) => JSON.stringify(a) === JSON.stringify(b);

const SKY: Record<string, [string, string, string]> = {
  spring: ['#8fb7d9', '#cfe0e6', '#e9e1c8'],
  summer: ['#79a9d6', '#c9dfea', '#f1e2b8'],
  autumn: ['#9fb0c4', '#e2d2b4', '#efc98f'],
  winter: ['#a9b8c8', '#dfe4e8', '#eef0f0'],
};
const GROUND: Record<string, [string, string]> = {
  spring: ['#88a75a', '#5d7d3a'],
  summer: ['#b7a75c', '#86793c'],
  autumn: ['#b08a4f', '#7a5a33'],
  winter: ['#e8ecee', '#b9c2c7'],
};

export function createStubWorld(): World3D {
  let host: HTMLElement;
  let root: HTMLDivElement;
  let spotsEl: HTMLDivElement;
  let fieldEl: HTMLDivElement;
  let place: Place = 'title';
  let view: WorldView | null = null;
  let pickFn: (t: PickTarget) => void = () => {};
  let hoverFn: (t: PickTarget | null) => void = () => {};
  let interactive: PickTarget[] | 'all' | 'none' = 'all';
  let selected: number[] = [];
  let ghosts: PickTarget[] = [];
  let quality: Quality = 'med';
  let skipFn: (() => void) | null = null;

  const isInteractive = (t: PickTarget) => interactive === 'all' || (interactive !== 'none' && interactive.some((x) => sameTarget(x, t) || (x.kind === 'square' && t.kind === 'square' && x.index === -1)));

  function paint() {
    if (!root) return;
    const season = view?.season ?? 'spring';
    const [a, b, c] = SKY[season];
    const [g1, g2] = GROUND[season];
    const indoor = ['house', 'store', 'bank'].includes(place);
    root.dataset.place = place;
    root.style.setProperty('--sky-a', a);
    root.style.setProperty('--sky-b', b);
    root.style.setProperty('--sky-c', c);
    root.style.setProperty('--ground-a', g1);
    root.style.setProperty('--ground-b', g2);
    root.classList.toggle('indoor', indoor);
    renderSpots();
    renderField();
  }

  function spotList(): Spot[] {
    if (place === 'homestead') {
      const base = HOME.filter((s) => !(s.t.kind === 'mailbox' && view && view.year < 1906));
      const g = ghosts.map((t) => {
        const item = t.kind === 'build' ? t.item : 'barn';
        const pos = GHOST_POS[item];
        return { t, x: pos.x, y: pos.y, label: `Build: ${item === 'windmill' ? 'well & windmill' : item}`, shape: 'prop' as const };
      });
      const built: Spot[] = [];
      if (view?.barn) built.push({ t: { kind: 'prop', id: 'barn' }, x: 74, y: 52, label: 'Barn', shape: 'barn' });
      if (view?.windmill) built.push({ t: { kind: 'prop', id: 'windmill' }, x: 64, y: 46, label: 'Windmill', shape: 'windmill' });
      return [...base.filter((s) => !(s.shape === 'house' && view?.house === 'wagon' && ghosts.some((x) => x.kind === 'build' && x.item === 'house'))), ...built, ...g];
    }
    if (place === 'mainStreet') return STREET;
    return INTERIOR[place] ?? [];
  }

  function renderSpots() {
    spotsEl.replaceChildren();
    for (const s of spotList()) {
      const ghost = s.t.kind === 'build';
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `stub-spot shape-${s.shape ?? 'prop'}${ghost ? ' ghost' : ''}`;
      el.style.left = `${s.x}%`;
      el.style.top = `${s.y}%`;
      el.dataset.target = JSON.stringify(s.t);
      el.setAttribute('aria-label', s.label);
      el.tabIndex = -1;
      el.innerHTML = `<span class="stub-shape"></span>`;
      el.addEventListener('click', () => isInteractive(s.t) && pickFn(s.t));
      el.addEventListener('pointerenter', () => isInteractive(s.t) && hoverFn(s.t));
      el.addEventListener('pointerleave', () => hoverFn(null));
      spotsEl.append(el);
    }
  }

  function renderField() {
    fieldEl.replaceChildren();
    fieldEl.hidden = place !== 'field';
    if (place !== 'field' || !view) return;
    const n = view.field.length;
    fieldEl.style.setProperty('--cols', String(n > 16 ? 8 : 4));
    view.field.forEach((sq, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.tabIndex = -1;
      el.className = `stub-sq st-${sq.stage}${selected.includes(i) ? ' sel' : ''}`;
      el.dataset.crop = sq.crop ?? '';
      el.dataset.square = String(i);
      el.style.setProperty('--g', String(sq.growth));
      const t: PickTarget = { kind: 'square', index: i };
      el.addEventListener('pointerdown', (e) => {
        if (!isInteractive(t)) return;
        e.preventDefault();
        pickFn(t);
      });
      el.addEventListener('pointerenter', (e) => {
        if (!isInteractive(t)) return;
        hoverFn(t);
        if (e.buttons & 1) pickFn(t);
      });
      fieldEl.append(el);
    });
  }

  let skipped = false;
  const wait = (ms: number) =>
    new Promise<void>((res) => {
      const id = window.setTimeout(done, ms);
      function done() {
        clearTimeout(id);
        skipFn = null;
        res();
      }
      skipFn = () => {
        skipped = true;
        done();
      };
    });

  return {
    async mount(h) {
      host = h;
      root = document.createElement('div');
      root.className = 'stub-world';
      root.innerHTML = `<div class="stub-sky"></div><div class="stub-sun"></div><svg class="stub-hills" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 18 Q 12 10 25 15 T 50 13 T 75 16 T 100 12 V30 H0Z" fill="var(--ground-a)" opacity=".55"/><path d="M0 22 Q 20 16 40 20 T 80 19 T 100 21 V30 H0Z" fill="var(--ground-a)"/></svg><div class="stub-ground"></div><div class="stub-weather"></div>`;
      fieldEl = document.createElement('div');
      fieldEl.className = 'stub-field';
      spotsEl = document.createElement('div');
      spotsEl.className = 'stub-spots';
      root.append(fieldEl, spotsEl);
      host.append(root);
      paint();
    },
    setView(v) {
      view = v;
      paint();
    },
    async goTo(p) {
      place = p;
      paint();
    },
    onPick(fn) {
      pickFn = fn;
    },
    onHover(fn) {
      hoverFn = fn;
    },
    setInteractive(t) {
      interactive = t;
    },
    setSelectedSquares(idx) {
      selected = [...idx];
      renderField();
    },
    project(t) {
      if (!root) return null;
      const hr = host.getBoundingClientRect();
      let el: Element | null = null;
      if (t.kind === 'square') el = fieldEl.querySelector(`[data-square="${t.index}"]`);
      else el = [...spotsEl.children].find((c) => (c as HTMLElement).dataset.target === JSON.stringify(t)) ?? null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - hr.left + r.width / 2, y: r.top - hr.top };
    },
    setGhosts(items) {
      ghosts = items;
      renderSpots();
    },
    async playDisaster(kind: DisasterKind) {
      root.dataset.disaster = kind;
      await wait(2200);
      delete root.dataset.disaster;
    },
    async playFieldWork(_kind, sqs, seconds) {
      const per = (seconds * 1000) / Math.max(1, sqs.length);
      skipped = false;
      for (const n of sqs) {
        const el = fieldEl.querySelector<HTMLElement>(`[data-square="${n}"]`);
        el?.classList.add('working');
        await wait(per);
        el?.classList.remove('working');
        if (skipped) break;
      }
    },
    async playMonthPass(next, seconds) {
      view = next;
      root.classList.add('passing');
      paint();
      await wait(seconds * 1000);
      root.classList.remove('passing');
    },
    skip() {
      skipFn?.();
    },
    setQuality(q) {
      quality = q;
    },
    get quality() {
      return quality;
    },
    get fps() {
      return 60;
    },
    setPaused() {},
    dispose() {
      root?.remove();
    },
  };
}
