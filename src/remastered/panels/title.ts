// Title screen: the pre-rendered homestead loop (ui/backdrop.ts) behind an engraved logotype and a
// walnut menu on the left third.
// Continue · New Game · Load · Settings · About this remaster · Cut Content (the Developer's Cut
// archive: material made in 1996 that never shipped).
import gsap from 'gsap';
import '../styles/flows.css';
import type { App } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { GOAL_NAMES, monthName } from '../core/format.ts';
import { ICONS, type IconName } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { rmSaves, type RmSave } from '../core/saves.ts';
import { session } from '../core/session.ts';
import { reducedMotion } from '../core/settings.ts';
import { updateSettings } from '../../engine/settings.ts';
import type { Profile } from '../../engine/save.ts';
import { settingsSheet } from './settings.ts';
import { aboutSheet } from './about.ts';
import { loadView } from './load.ts';
import { showBackdrop } from '../ui/backdrop.ts';
import { notify } from '../ui/notify.ts';
import { installHint } from '../ui/compact.ts';

export const ORNAMENT = `<svg viewBox="0 0 400 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M10 12h140M250 12h140"/><path d="M150 12c10-10 24-10 30 0s-14 12-14 4 14-14 34-4c20-10 34-4 34 4s-20 6-14-4 20-10 30 0"/><circle cx="200" cy="12" r="3" fill="currentColor"/><path d="M40 12c4-4 8-4 10 0M350 12c-4-4-8-4-10 0"/></svg>`;

/** Embed a sheet-like card in a full-screen flow (sheets sit under screens). */
export function fsOverlay(host: HTMLElement, build: (close: () => void) => { el: HTMLElement; destroy?: () => void }) {
  const ov = h('div', { class: 'fs-overlay' });
  const close = () => {
    window.removeEventListener('keydown', onKey, true);
    built.destroy?.();
    ov.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  const built = build(close);
  ov.append(built.el);
  ov.addEventListener('pointerdown', (e) => e.target === ov && close());
  window.addEventListener('keydown', onKey, true);
  host.append(ov);
  if (!reducedMotion()) gsap.from(built.el, { y: 20, opacity: 0, duration: 0.3, ease: 'power3.out' });
  return close;
}

/** Load a save and enter the game (or hand over to the Classic app). */
export async function enterSave(app: App, rec: RmSave, profile: Profile) {
  if (rec.edition.look === 'classic') {
    updateSettings({ lastProfile: profile.id });
    (window as unknown as { __gowestSwitchLook?: (l: string) => void }).__gowestSwitchLook?.('classic');
    return;
  }
  // the Frontier rules layer was retired (2026-10-16): its games carry on under the Remastered rules
  const extra = rec.state.extra as { frontier?: unknown };
  const wasFrontier = !!extra.frontier;
  if (wasFrontier) rec = { ...rec, state: { ...rec.state, extra: (({ frontier: _f, ...rest }) => rest)(extra) as typeof rec.state.extra } };
  await session.load(rec, profile);
  app.closeScreen();
  if (wasFrontier) notify('This game used the Frontier rules, which have been retired. It continues with the Remastered rules; your farm, family and money are kept.', { icon: 'book', seconds: 8 });
  await app.go(rec.place || 'homestead', { force: true });
}

export function register(app: App) {
  registerPanel({
    id: 'title',
    title: 'Title',
    kind: 'screen',
    mount: () => {
      // the pre-rendered loop plays behind the menu; the world draws nothing but keeps the homestead
      // loading underneath so Continue and New Game fade straight into it
      showBackdrop(app);
      void app.world?.goTo('homestead');
      const continueSlot = h('div');
      let latest: { rec: RmSave; profile: Profile } | null = null;

      const item = (ic: IconName, label: string, sub: string | null, onClick: () => void, cls = '', key?: string) => {
        const b = h('button', { type: 'button', class: `tm-btn ${cls}` }, icon(ICONS[ic]), h('span', null, h('span', { class: 'tm-l' }, label), sub ? h('span', { class: 'tm-s' }, sub) : null), key ? h('kbd', null, key) : h('span'));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
        return b;
      };

      const menu = h(
        'nav',
        { class: 'title-menu', 'aria-label': 'Main menu' },
        h('div', { class: 'tm-head' }, '— Welcome, homesteader —'),
        continueSlot,
        item('plus', 'New Game', 'Stake a claim in Buffalo County, 1880', () => void app.go('newgame'), '', 'N'),
        item('save', 'Load', 'Your saves, slots and rewind pages', () => openLoad(), '', 'L'),
        item('gear', 'Settings', 'Text, sound, graphics, assists', () => fsOverlay(root, (c) => settingsSheet(app, c))),
        item('book', 'About this remaster', 'What’s new and what we fixed', () => fsOverlay(root, (c) => aboutSheet(c))),
        item('key', 'Cut Content', 'Letters, voices and art made in 1996 that never shipped', () => void app.go('studio', { fromTitle: true })),
        h('div', { class: 'tm-foot' }, 'Remastered edition · keyboard: arrows, Enter, Esc'),
      );

      const logo = h(
        'div',
        { class: 'title-logo' },
        h('div', { class: 'title-kicker' }, 'The Homesteader’s Challenge'),
        h('h1', { class: 'title-word' }, 'Go West!'),
        h('div', { class: 'title-sub' }, 'Forty years on the Kansas prairie · ', h('b', null, 'Remastered')),
        h('div', { class: 'title-orn', html: ORNAMENT }),
        h('div', { class: 'title-years' }, 'MDCCCLXXX — MCMXIX'),
        installHint(),
      );

      const root = h('div', { class: 'fs title-screen' }, h('div', { class: 'title-shade' }), h('div', { class: 'fs-grain' }), h('div', { class: 'title-col' }, logo, menu));

      function openLoad() {
        fsOverlay(root, (c) => loadView(app, c));
      }

      async function refreshContinue() {
        latest = null;
        try {
          const profiles = await rmSaves.profiles();
          for (const p of profiles) {
            const rec = await rmSaves.latest(p.id);
            if (rec && !rec.state.extra.ended) {
              latest = { rec, profile: p };
              break;
            }
          }
        } catch (e) {
          console.warn(e);
        }
        if (!latest) return put(continueSlot);
        const s = latest.rec.state;
        const who = `${s.name.first} ${s.name.last}`.trim() || latest.profile.name;
        const sub = `${who} · ${monthName(s.date.mon)} ${s.date.year} · ${GOAL_NAMES[s.begin.goal] ?? ''}${latest.rec.edition.look === 'classic' ? ' · Classic look' : ''}`;
        const b = item('play', 'Continue', sub, () => latest && void enterSave(app, latest.rec, latest.profile), 'primary', 'Enter');
        if (latest.rec.state.devcut?.enabled) b.querySelector('.tm-l')!.append(h('span', { class: 'title-plaque' }, 'DC'));
        put(continueSlot, b);
        b.focus({ preventScroll: true });
      }

      const onKey = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement)?.tagName === 'INPUT' || root.querySelector('.fs-overlay')) return;
        if (e.key === 'n' || e.key === 'N') void app.go('newgame');
        else if (e.key === 'l' || e.key === 'L') openLoad();
        else if (e.key === 'Enter' && latest && document.activeElement === document.body) void enterSave(app, latest.rec, latest.profile);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const btns = [...menu.querySelectorAll<HTMLButtonElement>('.tm-btn')];
          const i = btns.indexOf(document.activeElement as HTMLButtonElement);
          const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
          btns[n]?.focus();
          e.preventDefault();
        }
      };
      window.addEventListener('keydown', onKey);
      void refreshContinue();
      if (!reducedMotion()) {
        gsap.from(logo.children, { opacity: 0, y: 18, duration: 0.9, stagger: 0.12, ease: 'power3.out' });
        gsap.from(menu, { opacity: 0, x: 30, duration: 0.8, delay: 0.3, ease: 'power3.out' });
      }
      return { el: root, destroy: () => window.removeEventListener('keydown', onKey) };
    },
  });
}
