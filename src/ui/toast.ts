// Small transient notices (bottom-centre).
import gsap from 'gsap';
import { h } from './dom.ts';

let host: HTMLElement;

export function initToasts(ui: HTMLElement) {
  host = h('div', { class: 'toast-host' });
  ui.append(host);
}

export function toast(text: string, kind: 'info' | 'gold' = 'info', seconds = 2.6) {
  const el = h('div', { class: `toast ${kind}` }, text);
  host.append(el);
  gsap.fromTo(el, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' });
  gsap.to(el, { opacity: 0, y: -6, delay: seconds, duration: 0.4, onComplete: () => el.remove() });
}
