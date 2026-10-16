// Render on demand: tell the world how much it needs to draw, so the GPU mostly idles in a
// turn-based game (World3D.setActivity, when the world provides it).
//  - 'covered' the title backdrop hides the canvas (ui/backdrop.ts): the world draws nothing;
//  - 'ui'   a sheet, a full screen, a letter card or a modal covers most of the canvas;
//  - 'play' the 3D view is the focus: camera moves, field work, month passes, disasters, the player
//           moving the pointer over the scene or pressing keys (for ~10 s after the last of these);
//  - 'idle' nothing has happened for ~10 s.
// The UI follows the same rule: the label loop only runs in 'play', and looping CSS animations pause
// in 'idle' and 'ui' (class act-<mode> on the app root). No timers run while idle: the single
// idle timer is armed by activity and fires once.
import type { App } from './app.ts';
import { session } from './session.ts';

export type Activity = 'covered' | 'ui' | 'play' | 'idle';
const IDLE_MS = 10_000;

export function initActivity(app: App) {
  let mode: Activity | null = null;
  let last = performance.now();
  let timer = 0;
  let pointerAt = 0;

  const covered = () => {
    const r = app.root;
    return r.classList.contains('has-sheet') || r.classList.contains('has-screen') || !!r.querySelector('.modal-wrap .modal, .rm-prompt.open, .clip-window');
  };

  function compute(): Activity {
    // the title backdrop (a pre-rendered loop) hides the canvas: draw nothing, keep loading
    if (app.root.classList.contains('has-backdrop')) return 'covered';
    if (app.busy) return 'play';
    if (covered()) return 'ui';
    return performance.now() - last < IDLE_MS ? 'play' : 'idle';
  }

  function apply() {
    const m = compute();
    if (m !== mode) {
      if (mode) app.root.classList.remove(`act-${mode}`);
      app.root.classList.add(`act-${m}`);
      mode = m;
      (app.world as unknown as { setActivity?: (a: Activity) => void } | undefined)?.setActivity?.(m);
      app.setLabelLoop(m === 'play');
    }
    window.clearTimeout(timer);
    timer = 0;
    // one timer, only while 'play' is counting down to 'idle'
    if (m === 'play' && !app.busy) timer = window.setTimeout(apply, Math.max(50, IDLE_MS - (performance.now() - last)));
  }

  function poke() {
    last = performance.now();
    if (mode !== 'play' || !timer) apply();
  }

  // the player doing something (pointer moves are sampled, not handled per event)
  window.addEventListener('pointermove', () => {
    const t = performance.now();
    if (t - pointerAt < 250) return;
    pointerAt = t;
    poke();
  }, { passive: true });
  for (const ev of ['pointerdown', 'wheel', 'keydown'] as const) window.addEventListener(ev, poke, { passive: true, capture: true });
  // the game doing something
  app.on('busy', () => (poke(), apply()));
  app.on('nav', poke);
  app.on('sheet', () => (poke(), apply()));
  session.on('change', poke);
  session.on('loaded', poke);
  // cards, modals and screens come and go as DOM changes on the root's direct layers
  new MutationObserver(() => queueMicrotask(apply)).observe(app.root, { attributes: true, attributeFilter: ['class'] });
  for (const host of [app.promptHost, app.modalHost, app.screenHost]) new MutationObserver(() => queueMicrotask(apply)).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  document.addEventListener('visibilitychange', () => (document.hidden ? null : poke()));
  apply();
  return { poke, get mode() { return mode; } };
}
