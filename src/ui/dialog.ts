// Modal dialogs on the HTML overlay: parchment card, serif type, brass buttons, an optional
// portrait cameo cut from the original dialog-box art. Enter = primary, Escape = cancel.
import gsap from 'gsap';
import { pushKeys } from '../engine/input.ts';
import { h, prose } from './dom.ts';

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  cancel?: boolean;
  disabled?: boolean | (() => boolean);
  kind?: 'ghost';
}

export interface DialogOptions<T> {
  title?: string;
  /** verbatim text (paragraph-split) or a node */
  body?: string | Node;
  /** extra content below the body */
  content?: Node;
  portrait?: string | null;
  speaker?: string | null;
  buttons: DialogButton<T>[];
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** letter style (paper, preserved line breaks) */
  paper?: boolean;
  /** dims the scene behind (default true) */
  dim?: boolean;
  onMount?(el: HTMLElement, api: DialogApi<T>): void;
}

export interface DialogApi<T> {
  close(v: T): void;
  refresh(): void;
}

let host: HTMLElement;

export function initDialogs(ui: HTMLElement) {
  host = h('div', { class: 'modal-host' });
  ui.appendChild(host);
}

export function openDialog<T>(o: DialogOptions<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    const backdrop = h('div', { class: `modal-backdrop${o.dim === false ? ' nodim' : ''}` });
    const card = h('div', { class: `dialog ${o.paper ? 'paper' : 'parchment'} size-${o.size ?? 'md'} ${o.className ?? ''}`, role: 'dialog', 'aria-modal': 'true' });
    const main = h('div', { class: 'dialog-main' });
    if (o.portrait) {
      card.classList.add('with-portrait');
      const cameo = h('div', { class: 'cameo' }, h('div', { class: 'cameo-img', style: { backgroundImage: `url("${o.portrait}")` } }));
      card.append(h('div', { class: 'cameo-col' }, cameo, o.speaker ? h('div', { class: 'speaker' }, o.speaker) : null));
    }
    if (o.title) main.append(h('h2', { class: 'dialog-title' }, o.title));
    if (o.body !== undefined) main.append(typeof o.body === 'string' ? (o.paper ? h('div', { class: 'letter-text' }, o.body) : prose(o.body)) : o.body);
    if (o.content) main.append(o.content);
    const bar = h('div', { class: 'dialog-buttons' });
    const btnEls: { b: DialogButton<T>; el: HTMLButtonElement }[] = [];
    let done = false;
    const close = (v: T) => {
      if (done) return;
      done = true;
      backdrop.classList.add('closing');
      pop();
      gsap.to(card, { y: 8, opacity: 0, duration: 0.14, ease: 'power1.in' });
      gsap.to(backdrop, { opacity: 0, duration: 0.18, onComplete: () => backdrop.remove() });
      resolve(v);
    };
    const isDisabled = (b: DialogButton<T>) => (typeof b.disabled === 'function' ? b.disabled() : !!b.disabled);
    const refresh = () => btnEls.forEach(({ b, el }) => (el.disabled = isDisabled(b)));
    for (const b of o.buttons) {
      const el = h('button', { class: `btn${b.primary ? ' primary' : ''}${b.kind === 'ghost' || b.cancel ? ' ghost' : ''}`, type: 'button' }, b.label);
      el.addEventListener('click', () => !isDisabled(b) && close(b.value));
      btnEls.push({ b, el });
      bar.append(el);
    }
    refresh();
    if (o.buttons.length) main.append(bar);
    card.append(main);
    backdrop.append(card);
    host.append(backdrop);
    const api: DialogApi<T> = { close, refresh };
    o.onMount?.(card, api);
    const pop = pushKeys({
      modal: true,
      enter: () => {
        const p = btnEls.find((x) => x.b.primary) ?? (btnEls.length === 1 ? btnEls[0] : undefined);
        if (p && !isDisabled(p.b)) close(p.b.value);
        return true;
      },
      escape: () => {
        const c = btnEls.find((x) => x.b.cancel) ?? (btnEls.length === 1 ? btnEls[0] : undefined);
        if (c) close(c.b.value);
        return true;
      },
    });
    gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(card, { y: 14, scale: 0.97, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.28, ease: 'back.out(1.6)' });
    const focusable = card.querySelector<HTMLElement>('input, textarea, select') ?? btnEls.find((x) => x.b.primary)?.el ?? btnEls[0]?.el;
    setTimeout(() => focusable?.focus({ preventScroll: true }), 30);
  });
}

/** Simple message with one OK button. */
export function message(body: string, o: Partial<DialogOptions<true>> = {}): Promise<true> {
  return openDialog<true>({ body, buttons: [{ label: 'OK', value: true, primary: true }], size: 'md', ...o });
}
