// Small UI kit for the Remastered overlay: buttons, sliders, steppers, segmented chips, tabs,
// meters, consequence chips, toasts, a promise-based modal and tooltips. Styling in styles/*.
import gsap from 'gsap';
import { h, icon, put, type Children } from '../core/dom.ts';
import { ICONS, type IconName } from '../core/icons.ts';
import { reducedMotion } from '../core/settings.ts';
import { notify } from './notify.ts';

export type BtnKind = 'brass' | 'go' | 'ghost' | 'danger' | 'link' | 'plain';

export function btn(label: Children[number] | Children, opts: { kind?: BtnKind; icon?: IconName; onClick?: (e: MouseEvent) => void; disabled?: boolean | string; title?: string; kbd?: string; cls?: string; small?: boolean; wide?: boolean; type?: string } = {}) {
  const b = h(
    'button',
    {
      type: 'button',
      class: ['btn', `btn-${opts.kind ?? 'brass'}`, opts.small ? 'btn-sm' : '', opts.wide ? 'btn-wide' : '', opts.cls ?? ''].filter(Boolean).join(' '),
      title: typeof opts.disabled === 'string' ? opts.disabled : null,
      'data-tip': typeof opts.disabled !== 'string' && opts.title ? opts.title : null,
      'aria-label': opts.title && (label === '' || label === null) ? opts.title : null,
    },
    opts.icon ? icon(ICONS[opts.icon]) : null,
    h('span', { class: 'btn-label' }, ...(Array.isArray(label) ? label : [label])),
    opts.kbd ? h('kbd', null, opts.kbd) : null,
  );
  if (opts.disabled) {
    b.disabled = true;
    if (typeof opts.disabled === 'string') b.dataset.reason = opts.disabled;
  }
  if (opts.onClick) b.addEventListener('click', (e) => !b.disabled && opts.onClick!(e));
  return b;
}

/** Disable with a reason (shown on hover/focus and as the title). */
export function setDisabled(b: HTMLButtonElement, reason: string | false | null) {
  b.disabled = !!reason;
  if (reason) {
    b.title = reason;
    b.dataset.reason = reason;
  } else {
    b.removeAttribute('title');
    delete b.dataset.reason;
  }
}

export function card(opts: { title?: Children[number]; cls?: string; eyebrow?: string; actions?: Children }, ...body: Children) {
  return h(
    'section',
    { class: `card ${opts.cls ?? ''}` },
    opts.eyebrow ? h('div', { class: 'eyebrow' }, opts.eyebrow) : null,
    opts.title ? h('h3', { class: 'card-title' }, opts.title) : null,
    ...body,
    opts.actions ? h('div', { class: 'card-actions' }, ...opts.actions) : null,
  );
}

export interface SliderOpts {
  label: Children[number];
  min: number;
  max: number;
  value: number;
  step?: number;
  format?: (v: number) => string;
  note?: Children[number];
  /** values whose tick is greyed (e.g. "no faster") */
  dim?: (v: number) => boolean;
  onInput: (v: number) => void;
  disabled?: string | null;
}

/** Labelled range slider with tick marks for small integer ranges. */
export function slider(o: SliderOpts) {
  const out = h('output', { class: 'num' }, (o.format ?? String)(o.value));
  const input = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step ?? 1), value: String(o.value) }) as HTMLInputElement;
  const ticks = h('div', { class: 'ticks' });
  const note = h('div', { class: 'slider-note' }, o.note ?? '');
  const el = h('label', { class: 'slider' }, h('span', { class: 'slider-label' }, o.label), out, input, ticks, note);
  const renderTicks = () => {
    const n = o.max - o.min;
    if (n > 12 || n <= 0) return put(ticks);
    put(ticks, ...Array.from({ length: n + 1 }, (_, i) => h('i', { class: o.dim?.(o.min + i) ? 'dim' : Number(input.value) === o.min + i ? 'on' : '' })));
  };
  input.addEventListener('input', () => {
    out.textContent = (o.format ?? String)(Number(input.value));
    renderTicks();
    o.onInput(Number(input.value));
  });
  if (o.disabled) {
    input.disabled = true;
    el.title = o.disabled;
  }
  renderTicks();
  return {
    el,
    input,
    set(v: number, max?: number) {
      if (max !== undefined) {
        o.max = max;
        input.max = String(max);
      }
      input.value = String(v);
      out.textContent = (o.format ?? String)(v);
      renderTicks();
    },
    setNote(n: Children[number]) {
      put(note, n ?? '');
    },
    refresh: renderTicks,
  };
}

/** − value + stepper. */
export function stepper(o: { value: number; min?: number; max?: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void; label?: string }) {
  let v = o.value;
  const min = o.min ?? 0;
  const out = h('b', { class: 'num stepper-v', 'aria-live': 'polite' });
  const dec = h('button', { type: 'button', class: 'step-btn', 'aria-label': `Fewer${o.label ? ` ${o.label}` : ''}` });
  dec.innerHTML = ICONS.minus;
  const inc = h('button', { type: 'button', class: 'step-btn', 'aria-label': `More${o.label ? ` ${o.label}` : ''}` });
  inc.innerHTML = ICONS.plus;
  const render = () => {
    out.textContent = (o.format ?? String)(v);
    dec.disabled = v <= min;
    inc.disabled = o.max !== undefined && v >= o.max;
  };
  const set = (n: number) => {
    const nv = Math.max(min, o.max !== undefined ? Math.min(o.max, n) : n);
    if (nv === v) return;
    v = nv;
    render();
    o.onChange(v);
  };
  dec.addEventListener('click', () => set(v - (o.step ?? 1)));
  inc.addEventListener('click', () => set(v + (o.step ?? 1)));
  render();
  return {
    el: h('span', { class: 'stepper' }, dec, out, inc),
    get value() {
      return v;
    },
    set(n: number, max?: number) {
      if (max !== undefined) o.max = max;
      v = Math.max(min, o.max !== undefined ? Math.min(o.max, n) : n);
      render();
    },
  };
}

/** Segmented choice (radio group of chips). */
export function segmented<T extends string | number>(opts: { options: { value: T; label: Children[number]; disabled?: string | null; hint?: string }[]; value: T; onChange: (v: T) => void; label?: string; cls?: string }) {
  const el = h('div', { class: `seg ${opts.cls ?? ''}`, role: 'radiogroup', 'aria-label': opts.label ?? '' });
  let cur = opts.value;
  const render = () => {
    put(
      el,
      ...opts.options.map((o) => {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === cur), class: o.value === cur ? 'on' : '', title: o.disabled ?? o.hint ?? '' }, o.label);
        if (o.disabled) b.disabled = true;
        b.addEventListener('click', () => {
          cur = o.value;
          render();
          opts.onChange(o.value);
        });
        return b;
      }),
    );
  };
  render();
  return {
    el,
    set(v: T) {
      cur = v;
      render();
    },
  };
}

/** Tabs bar; returns the element and a setter. */
export function tabs<T extends string>(opts: { tabs: { id: T; label: Children[number]; badge?: string | null }[]; value: T; onChange: (v: T) => void }) {
  const el = h('div', { class: 'tabs', role: 'tablist' });
  let cur = opts.value;
  const render = () =>
    put(
      el,
      ...opts.tabs.map((t) => {
        const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === cur), class: t.id === cur ? 'on' : '' }, t.label, t.badge ? h('span', { class: 'tab-badge' }, t.badge) : null);
        b.addEventListener('click', () => {
          cur = t.id;
          render();
          opts.onChange(t.id);
        });
        return b;
      }),
    );
  render();
  return {
    el,
    set(v: T) {
      cur = v;
      render();
    },
  };
}

export function meter(frac: number, opts: { tone?: 'good' | 'warn' | 'bad' | 'brass'; label?: string } = {}) {
  const f = Math.max(0, Math.min(1, frac));
  return h('div', { class: `meter tone-${opts.tone ?? 'good'}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(f * 100)), 'aria-label': opts.label ?? '' }, h('i', { style: { width: `${f * 100}%` } }));
}

/** Consequence chip: icon + text, tone by direction. */
export function chip(text: Children[number], opts: { icon?: IconName; tone?: 'good' | 'bad' | 'neutral' | 'info' | 'warn'; title?: string } = {}) {
  return h('span', { class: `chip tone-${opts.tone ?? 'neutral'}`, title: opts.title ?? '' }, opts.icon ? icon(ICONS[opts.icon]) : null, h('span', null, text));
}

export function kbd(k: string) {
  return h('kbd', null, k);
}

// ---------------------------------------------------------------------------
// Toasts (a thin wrapper over notify(): one transient line, see ui/notify.ts)
// ---------------------------------------------------------------------------
export interface ToastOpts {
  tone?: 'info' | 'good' | 'bad' | 'gold';
  icon?: IconName;
  seconds?: number;
  action?: { label: string; onClick: () => void };
  portrait?: string | null;
  speaker?: string | null;
  /** only into the Recent log */
  quiet?: boolean;
}

/**
 * A short message. Calm by design (docs/design/calm-ui.md): one transient line at a time that
 * fades by itself, plus an entry in the Recent log. Portraits and speakers are kept for the log.
 */
export function toast(text: Children[number], o: ToastOpts = {}) {
  const s = typeof text === 'string' ? text : (text as Node | null)?.textContent ?? String(text ?? '');
  return notify(s, { icon: o.icon, tone: o.tone, speaker: o.speaker, portrait: o.portrait, action: o.action, seconds: o.seconds ? Math.min(o.seconds, 6) : undefined, quiet: o.quiet });
}

// ---------------------------------------------------------------------------
// Modal (promise-based), used for confirmations and small choices
// ---------------------------------------------------------------------------
let modalHost: HTMLElement | null = null;
export function initModals(host: HTMLElement) {
  modalHost = host;
}
export const modalOpen = () => !!modalHost?.querySelector('.modal:not(.closing)');

export interface ModalAction<T> {
  label: string;
  value: T;
  kind?: BtnKind;
  disabled?: () => string | null;
  icon?: IconName;
}

export function modal<T>(o: { title?: string; body?: Children; cls?: string; actions: ModalAction<T>[]; dismiss?: T; onMount?: (el: HTMLElement, refresh: () => void) => void }): Promise<T> {
  return new Promise((resolve) => {
    if (!modalHost) return resolve(o.dismiss as T);
    const prevFocus = document.activeElement as HTMLElement | null;
    const btns: [HTMLButtonElement, ModalAction<T>][] = [];
    const refresh = () => btns.forEach(([b, a]) => setDisabled(b, a.disabled?.() ?? null));
    const done = (v: T) => {
      window.removeEventListener('keydown', onKey, true);
      box.classList.add('closing');
      const fin = () => {
        wrap.remove();
        prevFocus?.focus?.();
        resolve(v);
      };
      if (reducedMotion()) fin();
      else gsap.to(box, { opacity: 0, scale: 0.97, duration: 0.15, onComplete: fin });
      gsap.to(wrap, { backgroundColor: 'rgba(0,0,0,0)', duration: 0.15 });
    };
    const actions = o.actions.map((a) => {
      const b = btn(a.label, { kind: a.kind ?? 'brass', icon: a.icon, onClick: () => done(a.value) });
      btns.push([b, a]);
      return b;
    });
    const box = h('div', { class: `modal card ${o.cls ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title ?? '' }, o.title ? h('h3', { class: 'card-title' }, o.title) : null, h('div', { class: 'modal-body' }, ...(o.body ?? [])), h('div', { class: 'card-actions' }, ...actions));
    const wrap = h('div', { class: 'modal-wrap' }, box);
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap && o.dismiss !== undefined) done(o.dismiss);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && o.dismiss !== undefined) {
        e.stopPropagation();
        e.preventDefault();
        done(o.dismiss);
      }
    };
    window.addEventListener('keydown', onKey, true);
    modalHost.append(wrap);
    refresh();
    o.onMount?.(box, refresh);
    if (!reducedMotion()) gsap.from(box, { opacity: 0, y: 16, scale: 0.98, duration: 0.25, ease: 'power2.out' });
    (box.querySelector('input, .btn-go, .btn-brass') as HTMLElement | null)?.focus();
  });
}

export const confirm = (title: string, body: Children, yes = 'Yes', no = 'Cancel') =>
  modal<boolean>({ title, body, actions: [{ label: no, value: false, kind: 'ghost' }, { label: yes, value: true, kind: 'go' }], dismiss: false });

/** Count a number up/down in an element (money animations). */
export function countTo(el: HTMLElement, from: number, to: number, fmt: (n: number) => string, seconds = 0.6) {
  if (reducedMotion() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const o = { v: from };
  gsap.killTweensOf(el.dataset);
  gsap.to(o, { v: to, duration: seconds, ease: 'power2.out', onUpdate: () => (el.textContent = fmt(o.v)) });
}

// ---------------------------------------------------------------------------
// Sheet frame (books over the world) and place drawer
// ---------------------------------------------------------------------------

/** Standard sheet layout: title, optional subtitle and tabs, scrolling body, optional footer. */
export function sheetFrame(o: { title: Children[number]; sub?: Children[number]; eyebrow?: string; onClose: () => void; tabs?: HTMLElement; foot?: Children; cls?: string; icon?: IconName }, ...body: Children) {
  const close = h('button', { type: 'button', class: 'sheet-close', 'aria-label': 'Close (Esc)', title: 'Close (Esc)' });
  close.innerHTML = ICONS.close;
  close.addEventListener('click', o.onClose);
  const bodyEl = h('div', { class: 'sheet-body' }, ...body);
  const el = h(
    'section',
    { class: `card sheet-card ${o.cls ?? ''}` },
    h('header', { class: 'sheet-head' }, o.icon ? icon(ICONS[o.icon], 'ico sheet-ico') : null, h('div', { class: 'titles' }, o.eyebrow ? h('div', { class: 'eyebrow' }, o.eyebrow) : null, h('h2', { class: 'sheet-title' }, o.title), o.sub ? h('div', { class: 'sheet-sub' }, o.sub) : null), close),
    o.tabs ? h('div', { class: 'sheet-tabs' }, o.tabs) : null,
    bodyEl,
    o.foot ? h('footer', { class: 'sheet-foot' }, ...o.foot) : null,
  );
  return { el, body: bodyEl };
}

/** Place drawer (right side card with head/body/foot). */
export function drawer(o: { title: Children[number]; eyebrow?: string; side?: 'left' | 'right'; wide?: boolean; cls?: string }) {
  const head = h('div', { class: 'drawer-head' }, o.eyebrow ? h('div', { class: 'eyebrow' }, o.eyebrow) : null, h('h2', { class: 'drawer-title' }, o.title));
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot', hidden: true });
  const el = h('section', { class: `card drawer ${o.side === 'left' ? 'left' : ''} ${o.wide ? 'wide' : ''} ${o.cls ?? ''}` }, head, body, foot);
  // phones (styles/compact.css): fold the card down to its title and its main button to see the place behind it
  const fold = h('button', { type: 'button', class: 'drawer-fold', 'aria-expanded': 'true', 'aria-label': 'Fold this card' });
  fold.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  fold.addEventListener('click', () => {
    const folded = el.classList.toggle('folded');
    fold.setAttribute('aria-expanded', String(!folded));
    fold.setAttribute('aria-label', folded ? 'Unfold this card' : 'Fold this card');
  });
  el.append(fold);
  return { el, head, body, foot };
}
