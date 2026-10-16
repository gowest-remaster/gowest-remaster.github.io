// The Remastered app shell: full-screen 3D world with an HTML overlay. Owns navigation between
// places (camera moves) and sheets (book overlays), the breadcrumb/Back rule, world picks,
// world-anchored labels, the keyboard map, and fans session changes out to every panel.
import gsap from 'gsap';
import type { GameState, SimEvent } from '../../sim/index.ts';
import type { PickTarget, Place, World3D } from '../../world/api.ts';
import { h, put } from './dom.ts';
import { Emitter } from './bus.ts';
import { getPanel, PLACE_PANEL, titleOf, type PanelDef, type PanelInstance } from './registry.ts';
import { session } from './session.ts';
import { reducedMotion, rm } from './settings.ts';
import { worldViewOf } from './worldview.ts';
import { modalOpen, toast } from '../ui/kit.ts';

export interface Label {
  target: PickTarget;
  text: string;
  badge?: string | null;
  tone?: 'info' | 'urgent' | 'good' | 'ghost';
  sub?: string | null;
  onClick?: () => void;
}

interface Mounted {
  def: PanelDef;
  inst: PanelInstance;
  host: HTMLElement;
}

type AppEvents = {
  nav: [string];
  busy: [boolean];
  sheet: [string | null];
};

export class App extends Emitter<AppEvents> {
  readonly root: HTMLElement;
  readonly worldHost: HTMLElement;
  readonly labelsHost: HTMLElement;
  readonly placeHost: HTMLElement;
  readonly hudHost: HTMLElement;
  readonly sheetHost: HTMLElement;
  readonly promptHost: HTMLElement;
  readonly screenHost: HTMLElement;
  readonly captionHost: HTMLElement;
  readonly modalHost: HTMLElement;
  readonly crumbHost: HTMLElement;
  world!: World3D;

  place: Mounted | null = null;
  sheets: Mounted[] = [];
  screen: Mounted | null = null;
  private labels: Label[] = [];
  private labelEls = new Map<string, HTMLElement>();
  private raf = 0;
  private _busy = false;
  helpMode = false;
  /** set by the letter layer: dock the open letter so the player can look around */
  holdLetter: ((mode: 'esc' | 'peek') => boolean) | null = null;
  /** set by the HUD module: Advance / Pause handlers for the keyboard map */
  keys: Partial<Record<'advance' | 'month' | 'speedDown' | 'speedUp' | 'help' | 'whatNow' | 'undo' | 'quicksave' | 'quickload' | 'menu', () => void>> = {};

  constructor(root: HTMLElement) {
    super();
    this.root = root;
    root.classList.add('rm-app');
    const L = (cls: string, tag: 'div' | 'nav' | 'main' = 'div') => h(tag, { class: cls });
    this.worldHost = L('rm-world');
    this.labelsHost = L('rm-labels');
    this.placeHost = L('rm-place', 'main');
    this.crumbHost = L('rm-crumb', 'nav');
    this.hudHost = L('rm-hud');
    this.sheetHost = L('rm-sheets');
    this.promptHost = L('rm-prompt');
    this.screenHost = L('rm-screen');
    this.captionHost = L('rm-captions');
    this.modalHost = L('rm-modals');
    const live = h('div', { class: 'sr-only', 'aria-live': 'polite', id: 'rm-live' });
    root.append(this.worldHost, this.labelsHost, this.placeHost, this.crumbHost, this.hudHost, this.sheetHost, this.promptHost, this.screenHost, this.captionHost, this.modalHost, live);
    this.crumbHost.setAttribute('aria-label', 'Breadcrumb');
    // the app never scrolls: focusing or scrolling to an element past an edge (a label, a wide card)
    // used to shift every layer, clipping the crumb, the Next pill and the job strip off the left edge
    const unscroll = (el: HTMLElement) => el.addEventListener('scroll', () => (el.scrollTop || el.scrollLeft) && el.scrollTo(0, 0), { passive: true });
    for (const el of [root, this.placeHost, this.labelsHost, this.hudHost, this.sheetHost, this.promptHost]) unscroll(el);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // labels show near the cursor (Settings ▸ Place labels: On hover)
    window.addEventListener('pointermove', (e) => ((this.pointer.x = e.clientX), (this.pointer.y = e.clientY)), { passive: true });
    // tab switches inside a sheet or place change its crumb ("Ledger › Diary")
    const recrumb = (e: Event) => (e.target as HTMLElement | null)?.closest?.('.tabs, .seg') && queueMicrotask(() => this.renderCrumb());
    this.sheetHost.addEventListener('click', recrumb, true);
    this.placeHost.addEventListener('click', recrumb, true);
    session.on('change', (s, ev) => this.update(s, ev));
    session.on('loaded', (s) => this.update(s, []));
  }

  setWorld(w: World3D) {
    this.world = w;
    w.onPick((t) => this.onPick(t));
    w.onHover((t) => this.top()?.inst.onHover?.(t));
    this.startLabelLoop();
    this.watchLoading(w);
    // keep the camera centred in the part of the screen the UI leaves visible
    const ro = new ResizeObserver(() => this.queueSafeArea());
    ro.observe(this.placeHost);
    ro.observe(this.hudHost);
    new MutationObserver(() => this.queueSafeArea()).observe(this.placeHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    window.addEventListener('resize', () => {
      this.queueSafeArea();
      this.labelSize = new WeakMap();
    });
    void document.fonts?.ready.then(() => (this.labelSize = new WeakMap()));
    this.queueSafeArea();
  }

  /**
   * While the world prepares a place (assets streaming in, shaders compiling) it keeps showing the
   * previous place: show a small "Riding into town…" card with progress and hide the 3D labels,
   * which belong to the place being entered and would float over the wrong scene.
   */
  private watchLoading(w: World3D) {
    const bar = h('i');
    const text = h('span', { class: 'travel-t' });
    const el = h('div', { class: 'rm-travel', role: 'status', 'aria-live': 'polite', hidden: true }, h('span', { class: 'travel-wheel', 'aria-hidden': 'true' }), h('div', null, text, h('div', { class: 'travel-bar' }, bar)));
    this.root.append(el);
    const WORDS: Partial<Record<Place, string>> = { mainStreet: 'Riding into town…', store: 'Walking to the General Store…', bank: 'Walking to the bank…', elevator: 'Walking to the elevator…', homestead: 'Riding home…', field: 'Walking out to the field…', house: 'Going inside…', pen: 'Walking to the pen…', title: 'Setting the scene…' };
    let showTimer = 0;
    const set = (e: { place: Place; progress: number; done: boolean } | null) => {
      const loading = !!e && !e.done;
      this.root.classList.toggle('world-loading', loading);
      if (!loading) {
        window.clearTimeout(showTimer);
        showTimer = 0;
        el.hidden = true;
        return;
      }
      text.textContent = WORDS[e!.place] ?? 'On the way…';
      bar.style.width = `${Math.round(Math.max(0.05, Math.min(1, e!.progress)) * 100)}%`;
      // quick hops (already prefetched) never flash the card
      if (el.hidden && !showTimer) showTimer = window.setTimeout(() => ((showTimer = 0), this.root.classList.contains('world-loading') && (el.hidden = false)), 250);
    };
    if (w.onLoadProgress) w.onLoadProgress((e) => set(e));
    else if ('loading' in w) {
      // older worlds: poll the flag
      const poll = () => {
        const l = w.loading;
        set(l ? { ...l, done: false } : null);
        window.setTimeout(poll, 200);
      };
      poll();
    }
  }

  private safeRaf = 0;
  private lastSafe = '';
  private queueSafeArea() {
    if (this.safeRaf) return;
    this.safeRaf = requestAnimationFrame(() => {
      this.safeRaf = 0;
      this.updateSafeArea();
    });
  }
  /** Fractions of the viewport covered by docked UI (side cards, the HUD plank) for World3D.setSafeArea. */
  private updateSafeArea() {
    if (!this.world?.setSafeArea) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    let left = 0;
    let right = 0;
    let bottom = 0;
    const plank = this.hudHost.querySelector('.hud-plank') as HTMLElement | null;
    if (plank && !this.screen) {
      const r = plank.getBoundingClientRect();
      if (r.height) bottom = Math.max(0, (vh - r.top) / vh);
    }
    if (this.place && !this.screen) {
      for (const el of this.place.host.querySelectorAll<HTMLElement>('.card, .drawer, .jobcard')) {
        if (el.closest('[hidden]') || !el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.height < vh * 0.3 || r.width > vw * 0.6) continue;
        if (r.left > vw * 0.5) right = Math.max(right, (vw - r.left) / vw);
        else if (r.right < vw * 0.5) left = Math.max(left, r.right / vw);
      }
    }
    const area = { left: +left.toFixed(3), right: +right.toFixed(3), top: 0, bottom: +Math.min(0.4, bottom).toFixed(3) };
    const key = JSON.stringify(area);
    if (key === this.lastSafe) return;
    this.lastSafe = key;
    this.world.setSafeArea(area);
  }

  // ------------------------------------------------------------------ busy (calendar, time-lapse)
  get busy() {
    return this._busy;
  }
  setBusy(b: boolean) {
    if (b === this._busy) return;
    this._busy = b;
    this.root.classList.toggle('is-busy', b);
    this.emit('busy', b);
  }

  announce(text: string) {
    const live = document.getElementById('rm-live');
    if (live) live.textContent = text;
  }

  // ------------------------------------------------------------------ navigation
  top(): Mounted | null {
    return this.screen ?? this.sheets[this.sheets.length - 1] ?? this.place;
  }

  get placeId() {
    return this.place?.def.id ?? null;
  }

  /** Go to a panel by id: places travel, sheets open on top, screens take over. */
  async go(id: string, params: Record<string, unknown> = {}) {
    const def = getPanel(id);
    if (!def) {
      console.warn('no panel', id);
      return;
    }
    if (def.kind !== 'screen' && session.state && def.available) {
      const why = def.available(session.state);
      if (why) {
        toast(why, { icon: 'calendar' });
        return;
      }
    }
    if (def.kind === 'screen') return this.showScreen(def, params);
    if (this.busy) return;
    if (def.kind === 'sheet') return this.openSheet(def, params);
    // place
    this.closeScreen();
    this.closeSheets();
    if (this.place?.def.id === id && !params.force && Object.keys(params).length === 0) {
      this.place.inst.update?.(session.s, []);
      return;
    }
    this.unmount(this.place);
    this.place = null;
    this.setLabels([]);
    session.place = id;
    const host = h('div', { class: `rm-panel place-${id}` });
    this.placeHost.append(host);
    const inst = def.mount({ app: this, params });
    host.append(inst.el);
    this.place = { def, inst, host };
    this.renderCrumb();
    this.emit('nav', id);
    if (def.place && this.world) {
      this.world.setInteractive('all');
      void this.world.goTo(def.place, { instant: reducedMotion() });
    }
    if (!reducedMotion()) gsap.from(host, { opacity: 0, duration: 0.25 });
    if (session.state) inst.update?.(session.state, []);
  }

  private openSheet(def: PanelDef, params: Record<string, unknown>) {
    // re-opening the top sheet just refreshes it; an open sheet lower in the stack comes up
    const existing = this.sheets.findIndex((m) => m.def.id === def.id);
    if (existing >= 0) {
      while (this.sheets.length > existing) this.unmount(this.sheets.pop()!);
    }
    const host = h('div', { class: `rm-sheet sheet-${def.id} size-${def.size ?? 'lg'}`, role: 'dialog', 'aria-label': titleOf(def, session.state) });
    const backdrop = h('div', { class: 'rm-sheet-backdrop' });
    backdrop.addEventListener('pointerdown', () => this.back());
    const wrap = h('div', { class: 'rm-sheet-wrap' }, backdrop, host);
    this.sheetHost.append(wrap);
    const inst = def.mount({ app: this, params });
    host.append(inst.el);
    const m = { def, inst, host: wrap };
    this.sheets.push(m);
    this.root.classList.add('has-sheet');
    this.renderCrumb();
    this.emit('sheet', def.id);
    if (!reducedMotion()) {
      gsap.from(host, { opacity: 0, y: 24, duration: 0.3, ease: 'power3.out' });
      gsap.from(backdrop, { opacity: 0, duration: 0.25 });
    }
    if (session.state) inst.update?.(session.state, []);
    (host.querySelector('[autofocus], .tabs button.on, button, input') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  closeSheet(id?: string) {
    const i = id ? this.sheets.findIndex((m) => m.def.id === id) : this.sheets.length - 1;
    if (i < 0) return;
    const [m] = this.sheets.splice(i, 1);
    this.unmount(m, true);
    this.root.classList.toggle('has-sheet', this.sheets.length > 0);
    this.renderCrumb();
    this.emit('sheet', this.sheets[this.sheets.length - 1]?.def.id ?? null);
  }

  closeSheets() {
    while (this.sheets.length) this.closeSheet();
  }

  private showScreen(def: PanelDef, params: Record<string, unknown>) {
    this.closeScreen();
    const host = h('div', { class: `rm-screen-inner screen-${def.id}` });
    this.screenHost.append(host);
    this.root.classList.add('has-screen');
    const inst = def.mount({ app: this, params });
    host.append(inst.el);
    this.screen = { def, inst, host };
    this.queueSafeArea();
    this.emit('nav', def.id);
    if (!reducedMotion()) gsap.from(host, { opacity: 0, duration: 0.4 });
  }

  closeScreen() {
    if (!this.screen) return;
    this.unmount(this.screen);
    this.screen = null;
    this.root.classList.remove('has-screen');
    this.queueSafeArea();
  }

  private unmount(m: Mounted | null, animate = false) {
    if (!m) return;
    try {
      m.inst.destroy?.();
    } catch (e) {
      console.error(e);
    }
    if (animate && !reducedMotion()) gsap.to(m.host, { opacity: 0, duration: 0.15, onComplete: () => m.host.remove() });
    else m.host.remove();
  }

  /** Esc / right-click / Back button: one level up, every time. */
  back() {
    if (modalOpen()) return;
    // a letter card on screen: Esc folds it into the envelope at the top (read-only browsing)
    if (!this.screen && this.promptHost.classList.contains('open') && this.holdLetter) return void this.holdLetter('esc');
    const top = this.top();
    if (top?.inst.onBack?.()) return;
    if (this.sheets.length) return this.closeSheet();
    if (this.screen) return;
    if (this.busy) return;
    const parent = this.place?.def.parent;
    if (parent) return void this.go(parent);
    this.keys.menu?.();
  }

  /** Breadcrumb trail for the current place + sheets. */
  crumbs(): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    const s = session.state;
    let d: PanelDef | undefined = this.place?.def;
    const chain: PanelDef[] = [];
    while (d) {
      chain.unshift(d);
      d = d.parent ? getPanel(d.parent) : undefined;
    }
    for (const c of chain) out.push({ id: c.id, label: titleOf(c, s) });
    const extra = this.place?.inst.crumb?.();
    if (extra && !this.sheets.length) out.push({ id: '', label: extra });
    for (const m of this.sheets) {
      out.push({ id: m.def.id, label: titleOf(m.def, s) });
      const x = m.inst.crumb?.();
      if (x) out.push({ id: '', label: x });
    }
    return out;
  }

  renderCrumb() {
    const cr = this.crumbs();
    const backBtn = h('button', { type: 'button', class: 'crumb-back', 'aria-label': 'Back (Esc)', title: 'Back (Esc)' });
    backBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5 8 12l7 7"/></svg>';
    backBtn.addEventListener('click', () => this.back());
    const canBack = this.sheets.length > 0 || !!this.place?.def.parent;
    backBtn.hidden = !canBack;
    put(
      this.crumbHost,
      backBtn,
      h(
        'ol',
        null,
        ...cr.map((c, i) => {
          const last = i === cr.length - 1;
          if (last || !c.id) return h('li', { 'aria-current': last ? 'page' : null }, c.label);
          const b = h('button', { type: 'button' }, c.label);
          b.addEventListener('click', () => {
            const sheetIdx = this.sheets.findIndex((m) => m.def.id === c.id);
            if (sheetIdx >= 0) while (this.sheets.length > sheetIdx + 1) this.closeSheet();
            else void this.go(c.id);
          });
          return h('li', null, b);
        }),
      ),
    );
  }

  // ------------------------------------------------------------------ updates
  update(s: GameState, events: SimEvent[]) {
    for (const m of [this.place, ...this.sheets, this.screen]) {
      if (!m) continue;
      try {
        m.inst.update?.(s, events);
      } catch (e) {
        console.error(`panel ${m.def.id} update failed`, e);
      }
    }
    if (this.world && !this.busy) this.world.setView(worldViewOf(s));
    this.renderCrumb();
  }

  // ------------------------------------------------------------------ world picks + labels
  private onPick(t: PickTarget) {
    if (this.screen || this.sheets.length || this.busy) return;
    if (this.place?.inst.onPick?.(t)) return;
    if (t.kind === 'place') {
      const id = PLACE_PANEL[t.place as Place];
      if (id) void this.go(id);
    }
  }

  setLabels(labels: Label[]) {
    this.labels = labels;
    const keep = new Set<string>();
    for (const l of labels) {
      const key = JSON.stringify(l.target);
      keep.add(key);
      let el = this.labelEls.get(key);
      if (!el) {
        el = h('button', { type: 'button', class: 'wlabel' });
        el.addEventListener('click', () => {
          const cur = this.labels.find((x) => JSON.stringify(x.target) === key);
          if (cur?.onClick) cur.onClick();
          else if (cur) this.onPick(cur.target);
        });
        this.labelsHost.append(el);
        this.labelEls.set(key, el);
      }
      const sig = `${l.tone}|${l.text}|${l.sub ?? ''}|${l.badge ?? ''}`;
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.className = `wlabel tone-${l.tone ?? 'info'}`;
        put(el, h('span', { class: 'wl-text' }, l.text), l.sub ? h('span', { class: 'wl-sub' }, l.sub) : null, l.badge ? h('span', { class: 'wl-badge' }, l.badge) : null);
        this.labelSize.delete(el);
      }
    }
    for (const [k, el] of this.labelEls) {
      if (!keep.has(k)) {
        el.remove();
        this.labelEls.delete(k);
      }
    }
    this.positionLabels();
  }

  /** label plate sizes, measured once per content change (reading layout every frame thrashes) */
  private labelSize = new WeakMap<HTMLElement, { w: number; h: number }>();
  private labelsHidden = false;
  private pointer = { x: -9999, y: -9999 };
  private positionLabels() {
    if (!this.world) return;
    if (!this.labels.length) return;
    const hidden = this.root.classList.contains('has-sheet') || this.root.classList.contains('has-screen') || this.root.classList.contains('world-loading');
    // nothing to place and already hidden: skip the per-frame projections entirely
    if (hidden && this.labelsHidden) return;
    this.labelsHidden = hidden;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const vw = window.innerWidth;
    // read phase: measure any plate whose content changed, before writing any transform
    for (const el of this.labelEls.values()) if (!this.labelSize.has(el) && el.isConnected) this.labelSize.set(el, { w: el.offsetWidth || 120, h: el.offsetHeight || 30 });
    for (const l of this.labels) {
      const el = this.labelEls.get(JSON.stringify(l.target));
      if (!el) continue;
      const p = hidden ? null : this.world.project(l.target);
      if (!p) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      if (el.style.visibility) el.style.visibility = '';
      // nudge up past labels already placed so plates never sit on top of each other
      const sz = this.labelSize.get(el) ?? { w: 120, h: 30 };
      const w = sz.w;
      const hgt = sz.h + 4;
      let y = p.y;
      // keep the plate on screen (a building at the edge still shows its whole name)
      const x = Math.min(Math.max(p.x, w / 2 + 8), vw - w / 2 - 8);
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((r) => Math.abs(r.x - x) < (r.w + w) / 2 && Math.abs(r.y - y) < hgt);
        if (!hit) break;
        y = hit.y - hgt;
      }
      placed.push({ x, y, w, h: hgt });
      const tf = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      if (el.style.transform !== tf) el.style.transform = tf;
      const near = Math.hypot(x - this.pointer.x, y - sz.h / 2 - this.pointer.y) < 260;
      if (el.classList.contains('near') !== near) el.classList.toggle('near', near);
    }
  }

  private labelLoop = true;
  private startLabelLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.labelLoop) return void this.positionLabels();
    const tick = () => {
      this.positionLabels();
      this.raf = this.labelLoop ? requestAnimationFrame(tick) : 0;
    };
    this.raf = requestAnimationFrame(tick);
  }
  /**
   * Labels follow the camera every frame only while the 3D view is live ('play', core/activity.ts).
   * When the world idles nothing moves, so one last placement is enough and no frame loop runs.
   */
  setLabelLoop(on: boolean) {
    if (on === this.labelLoop && (!on || this.raf)) return;
    this.labelLoop = on;
    if (this.world) this.startLabelLoop();
  }

  // ------------------------------------------------------------------ keyboard
  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === 'Escape') {
      if (typing) (t as HTMLElement).blur();
      if (modalOpen()) return;
      e.preventDefault();
      this.back();
      return;
    }
    if (typing || modalOpen()) return;
    const top = this.top();
    if (top?.inst.onKey?.(e)) return;
    if (this.screen) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      this.keys.undo?.();
      return;
    }
    if (k === 'F5') {
      e.preventDefault();
      this.keys.quicksave?.();
      return;
    }
    if (k === 'F9') {
      e.preventDefault();
      this.keys.quickload?.();
      return;
    }
    if (mod || e.altKey) return;
    if (k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (e.shiftKey) this.keys.month?.();
      else this.keys.advance?.();
      return;
    }
    if (k === '[') return this.keys.speedDown?.();
    if (k === ']') return this.keys.speedUp?.();
    if (k === '?') return this.keys.help?.();
    if (k === 'h' || k === 'H') return this.keys.whatNow?.();
    if (!session.state) return;
    for (const def of [...(getPanelList())]) {
      const hk = def.hotbar?.key;
      if (hk && hk.toLowerCase() === k.toLowerCase() && !def.hotbar?.hidden?.(session.state)) {
        e.preventDefault();
        const why = def.hotbar?.disabled?.(session.state);
        if (why) toast(why, { icon: 'calendar' });
        else if (def.kind === 'sheet' && this.sheets[this.sheets.length - 1]?.def.id === def.id) this.closeSheet();
        else void this.go(def.id);
        return;
      }
    }
  }

  /** One-time contextual tip (respects Settings ▸ tips). */
  tip(id: string, text: string) {
    const st = rm();
    if (!st.assists.tips || st.seenTips.includes(id)) return;
    st.seenTips.push(id);
    toast(text, { icon: 'help', tone: 'gold', seconds: 9 });
  }
}

import { hotbarPanels } from './registry.ts';
function getPanelList() {
  return hotbarPanels();
}
