// Calm notifications (docs/design/calm-ui.md §3). Nothing stacks:
//  - one transient line at a time, low on the screen beside the HUD, fading after ~2.5 s
//    (a newer message replaces the older one; it never covers a panel or a card);
//  - every message, with its full text and any action, goes into the Recent log, opened from the
//    bell on the HUD (unread count on the bell). Original lines are never lost, only not pushed.
// `toast()` in ui/kit.ts is a thin wrapper over `notify()`, so every caller is calm by default.
import gsap from 'gsap';
import type { App } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { dateShort } from '../core/format.ts';
import { ICONS, type IconName } from '../core/icons.ts';
import { session } from '../core/session.ts';
import { reducedMotion } from '../core/settings.ts';

export interface NotifyOpts {
  icon?: IconName;
  tone?: 'info' | 'good' | 'bad' | 'gold';
  /** who said it (an original line) */
  speaker?: string | null;
  portrait?: string | null;
  action?: { label: string; onClick: () => void };
  /** only into the Recent log, no transient line */
  quiet?: boolean;
  /** seconds on screen (default 2.5, a little longer for long lines) */
  seconds?: number;
}

export interface RecentEntry {
  at: number;
  date: string;
  text: string;
  speaker?: string | null;
  icon?: IconName;
  tone?: NotifyOpts['tone'];
}

let host: HTMLElement | null = null;
let line: HTMLElement | null = null;
let timer = 0;
let unread = 0;
const listeners = new Set<() => void>();
const actions = new Map<number, { label: string; onClick: () => void }>();
let held = false;

export function recent(): RecentEntry[] {
  const j = session.journal as { recent?: RecentEntry[] };
  if (!j.recent) j.recent = [];
  return j.recent;
}
export const unreadCount = () => unread;
export function markRead() {
  unread = 0;
  listeners.forEach((l) => l());
}
export function onRecent(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function recentAction(at: number) {
  return actions.get(at) ?? null;
}

export function initNotify(app: App) {
  line = h('div', { class: 'tr-line', role: 'status', 'aria-live': 'polite', hidden: true });
  host = h('div', { class: 'rm-transient' }, line);
  app.root.append(host);
  line.addEventListener('pointerenter', () => (held = true));
  line.addEventListener('pointerleave', () => {
    held = false;
    schedule(1.2);
  });
  session.on('loaded', () => {
    unread = 0;
    listeners.forEach((l) => l());
  });
}

/**
 * Put the line in the widest stretch of open scene just above the HUD, so it never sits on a panel
 * (the store's catalog on the left, an order slip or a drawer on the right).
 */
function place() {
  if (!host) return;
  const app = host.parentElement;
  if (!app) return;
  const W = app.clientWidth;
  const hud = app.querySelector('.hud-plank')?.getBoundingClientRect();
  const bandBottom = hud ? hud.top : window.innerHeight;
  const bandTop = bandBottom - 64;
  const blocks: [number, number][] = [];
  for (const el of app.querySelectorAll<HTMLElement>('.rm-place .card, .rm-place .drawer, .rm-sheet, .digest-host .digest')) {
    if (el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.bottom > bandTop && r.top < bandBottom) blocks.push([r.left, r.right]);
  }
  blocks.sort((a, b) => a[0] - b[0]);
  let best: [number, number] = [0, 0];
  let x = 16;
  for (const [l, r] of [...blocks, [W - 16, W] as [number, number]]) {
    if (l - x > best[1] - best[0]) best = [x, l];
    x = Math.max(x, r);
  }
  const width = best[1] - best[0];
  if (width >= 220) {
    host.style.left = `${(best[0] + best[1]) / 2}px`;
    host.style.maxWidth = `${Math.min(width - 16, 576)}px`;
  } else {
    host.style.left = '';
    host.style.maxWidth = '';
  }
}

function schedule(seconds: number) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (held || !line) return;
    if (reducedMotion()) line.hidden = true;
    else gsap.to(line, { opacity: 0, duration: 0.35, onComplete: () => line && ((line.hidden = true), (line.style.opacity = '')) });
  }, seconds * 1000);
}

/** Say something once, quietly. Returns a function that clears it. */
export function notify(text: string, o: NotifyOpts = {}): () => void {
  const at = Date.now() + Math.random();
  const s = session.state;
  const log = s ? recent() : null;
  if (log) {
    log.push({ at, date: dateShort(s!.date), text, speaker: o.speaker ?? null, icon: o.icon, tone: o.tone });
    if (log.length > 300) log.splice(0, log.length - 300);
    if (o.action) actions.set(at, o.action);
    unread++;
    listeners.forEach((l) => l());
  }
  if (o.quiet || !line) return () => undefined;
  put(
    line,
    o.icon ? icon(ICONS[o.icon], 'ico tr-ico') : null,
    o.speaker ? h('b', { class: 'tr-who' }, `${o.speaker}: `) : null,
    h('span', { class: 'tr-text' }, text),
    o.action
      ? (() => {
          const b = h('button', { type: 'button', class: 'tr-act' }, o.action!.label);
          b.addEventListener('click', () => {
            o.action!.onClick();
            line!.hidden = true;
          });
          return b;
        })()
      : null,
  );
  line.className = `tr-line tone-${o.tone ?? 'info'}`;
  line.hidden = false;
  place();
  line.style.opacity = '';
  if (!reducedMotion()) gsap.fromTo(line, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.2 });
  const words = text.split(/\s+/).length;
  schedule(o.seconds ?? Math.min(6, 2.5 + Math.max(0, words - 10) * 0.12));
  return () => {
    if (line) line.hidden = true;
  };
}
