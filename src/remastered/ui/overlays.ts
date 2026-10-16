// Global overlays: hover/focus tooltips for [data-tip] / [data-reason], the caption strip for
// voice lines and sound cues, and the presenter that turns informational sim events (dialogs,
// rejections, trivia results, telegrams) into gentle, non-blocking speech toasts.
import gsap from 'gsap';
import type { GameState, SimEvent } from '../../sim/index.ts';
import { txt } from '../core/text.ts';
import type { App } from '../core/app.ts';
import { defaultBox, portrait, speakerFor } from '../core/art.ts';
import { audio, onCaption, onCaptionEnd, type Caption } from '../core/audio.ts';
import { h } from '../core/dom.ts';
import { money } from '../core/format.ts';
import { session } from '../core/session.ts';
import { reducedMotion } from '../core/settings.ts';
import { toast } from './kit.ts';

export function initTooltips(root: HTMLElement) {
  const tip = h('div', { class: 'rm-tip', role: 'tooltip', hidden: true });
  root.append(tip);
  let cur: HTMLElement | null = null;
  const show = (el: HTMLElement) => {
    const t = el.dataset.reason || el.dataset.tip;
    if (!t) return hide();
    cur = el;
    tip.textContent = t;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - tr.width / 2;
    x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
    let y = r.top - tr.height - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => {
    cur = null;
    tip.hidden = true;
  };
  const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-tip],[data-reason]') as HTMLElement | null) : null);
  root.addEventListener('pointerover', (e) => {
    const el = find(e.target);
    if (el && el !== cur) show(el);
    else if (!el) hide();
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (e) => {
    const el = find(e.target);
    if (el) show(el);
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide);
}

export function initCaptions(app: App) {
  app.on('nav', () => audio.stopVoice());
  let current: HTMLElement | null = null;
  let timer = 0;
  const clear = () => {
    if (!current) return;
    const el = current;
    current = null;
    if (reducedMotion()) el.remove();
    else gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => el.remove() });
  };
  let lastSound: HTMLElement | null = null;
  onCaption((c: Caption) => {
    if (c.kind === 'voice') clear();
    if (c.kind === 'sound') {
      if (app.busy) return;
      lastSound?.remove();
    }
    const el = h('div', { class: `caption ${c.kind}` }, c.speaker ? h('b', null, `${c.speaker}:`) : null, c.text);
    app.captionHost.append(el);
    if (c.kind === 'voice') current = el;
    else lastSound = el;
    if (!reducedMotion()) gsap.from(el, { opacity: 0, y: 6, duration: 0.2 });
    window.clearTimeout(timer);
    if (c.kind === 'sound') window.setTimeout(() => el.remove(), c.seconds * 1000);
    else timer = window.setTimeout(clear, (c.seconds + 1.5) * 1000);
  });
  onCaptionEnd(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(clear, 900);
  });
}

/** Panels that voice a dialog themselves can silence its toast once: quietDialogs('SEG72'). */
const quietOnce = new Set<string>();
export function quietDialogs(...ids: string[]) {
  ids.forEach((i) => quietOnce.add(i));
}

/** Dialog ids that panels present themselves (receipts, inline status) — not toasted. */
const SILENT = new Set(['FDBK7', 'EndHarv', 'EndHarv1', 'SEG70', 'MyGoal', 'TakeMoney', 'LoanOK', 'OK']);

export function presentEvents(s: GameState, events: SimEvent[], opts: { quiet?: Set<string> } = {}) {
  for (const e of events) {
    if (e.type === 'dialog') {
      if (quietOnce.delete(e.id) || SILENT.has(e.id) || opts.quiet?.has(e.id)) continue;
      let body = txt(s, e.id);
      if (e.id === 'SEG69' && e.params?.total !== undefined) body = `${body} ${money(Number(e.params.total), { cents: true })}`;
      const box = e.dbox ?? defaultBox(e.id, s.date.year);
      toast(body, { portrait: portrait(box), speaker: speakerFor(box, s.propet.babyNames), tone: 'info', seconds: Math.min(14, 4 + body.split(/\s+/).length * 0.25) });
    } else if (e.type === 'triviaAnswered') {
      // the trivia card shows its own result
    } else if (e.type === 'rejected') {
      if (e.reason === 'promptPending') toast('Answer the letter first.', { icon: 'letter' });
      else console.info('rejected', e.reason);
    }
  }
}

export function initPresenter() {
  session.on('change', (s, ev, cmd) => {
    // calendar runs are presented by the prompt layer and the runner
    if (cmd && (cmd.type as string).endsWith('Calendar')) return presentEvents(s, ev.filter((e) => e.type === 'dialog' || e.type === 'rejected'));
    presentEvents(s, ev);
  });
}
