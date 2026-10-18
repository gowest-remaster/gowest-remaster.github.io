// Boots the Remastered app: content, art, optional sim queries / world mapping / audio,
// the 3D world (or its placeholder), the HUD, the letter layer, all panels, then the title.
import './styles/base.css';
import './styles/hud.css';
import './styles/panels.css';
import './styles/letters.css';
import './styles/world-stub.css';
import { loadText } from '../game/text.ts';
import { App } from './core/app.ts';
import { loadArt } from './core/art.ts';
import { loadAudio, audio, syncScene } from './core/audio.ts';
import { CalendarRunner } from './core/calendar.ts';
import { h } from './core/dom.ts';
import { session } from './core/session.ts';
import { applyQuality, applyToDocument, rm } from './core/settings.ts';
import { ensureDevcut } from './core/text.ts';
import { createWorld, worldKind } from './core/world.ts';
import { loadWorldViewMapper, worldViewOf } from './core/worldview.ts';
import { mountHud } from './ui/hud.ts';
import { initModals } from './ui/kit.ts';
import { mountLetters } from './ui/letters.ts';
import { mountObjective } from './ui/objective.ts';
import { initNotify } from './ui/notify.ts';
import { initActivity } from './core/activity.ts';
import { backdropShown, hideBackdrop } from './ui/backdrop.ts';
import { initCaptions, initPresenter, initTooltips } from './ui/overlays.ts';
import { registerAllPanels } from './panels/index.ts';
import { applyVolumes } from './core/audio.ts';
import { onRm } from './core/settings.ts';
import { initCompact, initCompactTopRow } from './ui/compact.ts';
// last, so the phone layout wins ties with every panel's own stylesheet
import './styles/compact.css';

export let app: App;
export let calendar: CalendarRunner;

export async function bootRemastered(root: HTMLElement) {
  document.documentElement.classList.add('rm-root');
  const fonts = h('link', { rel: 'stylesheet', href: `${import.meta.env.BASE_URL}fonts/fonts.css` });
  document.head.append(fonts);
  applyToDocument();
  initCompact();
  const progress = (f: number, t?: string) => (window as unknown as { __gwLoad?: (f: number, t?: string) => void }).__gwLoad?.(f, t);
  progress(0.4, 'Reading the letters from home…');
  await Promise.all([loadText(), loadArt(), loadWorldViewMapper(), loadAudio()]);
  progress(0.6, 'Riding out to the claim…');
  app = new App(root);
  initModals(app.modalHost);
  initTooltips(app.root);
  initCaptions(app);
  initPresenter();
  // the world setup is the longest step: keep the splash bar moving toward 88% while it runs
  let creep = 0.6;
  const creepTimer = window.setInterval(() => progress((creep += (0.88 - creep) * 0.08)), 200);
  const world = await createWorld(app.worldHost).finally(() => window.clearInterval(creepTimer));
  app.setWorld(world);
  progress(0.9, 'Lighting the lamp…');
  if (rm().quality !== 'auto') applyQuality(world);
  calendar = new CalendarRunner(app);
  registerAllPanels(app, calendar);
  mountHud(app, calendar);
  mountLetters(app);
  initNotify(app);
  mountObjective(app);
  initCompactTopRow(app.root);
  initActivity(app);
  // entering a place from the title or the New Game pages fades the title loop into the live world
  app.on('nav', () => {
    if (backdropShown() && !app.root.classList.contains('has-screen')) hideBackdrop(app);
  });
  applyVolumes();
  onRm(() => applyVolumes());
  session.on('loaded', (s) => {
    void ensureDevcut(s).then(() => app.update(s, []));
    world.setView(worldViewOf(s), { instant: true });
  });
  app.on('nav', (id) => {
    syncScene(id, session.state);
    if (id === 'store') audio.sfx('store-bell');
  });
  session.on('change', (st, ev) => {
    if (ev.some((e) => e.type === 'monthAdvanced')) syncScene(app.placeId, st);
    if (ev.some((e) => e.type === 'harvest')) syncScene(app.placeId, st, 'harvest');
    if (ev.some((e) => e.type === 'goalReached')) audio.sting('goal');
    if (ev.some((e) => e.type === 'monthAdvanced' && e.mon === 1)) audio.sting('year_end');
  });
  session.on('ended', () => window.setTimeout(() => void app.go('epilogue'), 600));
  const unlock = () => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  await app.go('title');
  (window as unknown as { __gowest: unknown }).__gowest = { session, app, calendar, world, worldKind };
}
