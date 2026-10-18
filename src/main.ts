// Boot. Two apps share the sim and the save format:
//  - Remastered (default): the real-time 3D world with the HTML overlay (src/remastered/).
//  - Classic look: the Pixi stage + SceneManager running the Classic replica (src/scenes/classic/).
// The look is chosen at New Game and can be switched mid-game; switching stores the look in
// localStorage ('gowest.look') and reloads into the other app with the same save.
// `?classic` forces the Classic app (its title is the original login); `?look=remastered` the new one.

import { muteUnderAutomation } from './automation-mute.ts';

muteUnderAutomation();

const LOOK_KEY = 'gowest.look';

function chosenLook(): 'classic' | 'remastered' {
  const q = new URLSearchParams(location.search);
  if (q.has('classic')) return 'classic';
  const l = q.get('look');
  if (l === 'classic' || l === 'remastered') {
    // an explicit ?look= also becomes the remembered choice, so a plain reload keeps it
    try {
      localStorage.setItem(LOOK_KEY, l);
    } catch {
      /* ignore */
    }
    return l;
  }
  try {
    return localStorage.getItem(LOOK_KEY) === 'classic' ? 'classic' : 'remastered';
  } catch {
    return 'remastered';
  }
}

/** Switch look and reload into the other app (the current save must already be written). */
export function switchLook(look: 'classic' | 'remastered') {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    /* ignore */
  }
  const u = new URL(location.href);
  u.searchParams.delete('classic');
  u.searchParams.delete('look');
  location.href = u.toString();
}
(window as unknown as { __gowestSwitchLook: typeof switchLook }).__gowestSwitchLook = switchLook;

async function bootClassic() {
  await import('./style.css');
  const [{ createStage }, { loadManifest }, { SceneManager }, { ClassicScene }, { game }, { loadText }, { initDialogs }, { initToasts }, { h }, { saves }, { settings }] = await Promise.all([
    import('./engine/stage.ts'),
    import('./engine/assets.ts'),
    import('./engine/scene.ts'),
    import('./scenes/classic/scene.ts'),
    import('./engine/game.ts'),
    import('./game/text.ts'),
    import('./ui/dialog.ts'),
    import('./ui/toast.ts'),
    import('./ui/dom.ts'),
    import('./engine/save.ts'),
    import('./engine/settings.ts'),
  ]);
  const stage = await createStage(document.querySelector<HTMLDivElement>('#app')!);
  const bar = h('i');
  const loading = h('div', { class: 'loading' }, h('div', null, h('div', { class: 'lt' }, 'Loading the prairie…'), h('div', { class: 'bar' }, bar)));
  stage.ui.append(loading);
  const step = (p: number) => (bar.style.width = `${Math.round(p * 100)}%`);
  step(0.05);
  await Promise.all([loadText(), loadManifest()]);
  step(1);
  initDialogs(stage.ui);
  initToasts(stage.ui);
  const scenes = new SceneManager(stage, (id) => new ClassicScene(id));
  game.goTo = (id) => {
    if (game.state && id !== 'title') void game.save(id);
    void scenes.go(id);
  };
  loading.remove();
  // Arriving from the Remastered app with a game in progress: resume it in the classic look.
  let resumed = false;
  const pid = settings().lastProfile;
  if (pid && !new URLSearchParams(location.search).has('classic')) {
    const p = await saves.getProfile(pid);
    if (p) {
      await game.selectProfile(p);
      resumed = await game.resume();
      if (resumed) game.setLook('classic');
    }
  }
  await scenes.go(resumed ? game.scene : 'title', { instant: true });
  (window as unknown as { __gowest: unknown }).__gowest = { game, scenes };
}

type BootUi = { __gwLoad?: (f: number, t?: string) => void; __gwLoadDone?: () => void };
export const bootProgress = (f: number, t?: string) => (window as unknown as BootUi).__gwLoad?.(f, t);
export const bootDone = () => (window as unknown as BootUi).__gwLoadDone?.();

async function boot() {
  bootProgress(0.3, 'Unpacking the trunk…');
  if (chosenLook() === 'classic') return bootClassic().then(bootDone);
  const { bootRemastered } = await import('./remastered/boot.ts');
  await bootRemastered(document.querySelector<HTMLDivElement>('#app')!);
  bootDone();
}

boot().catch((e) => {
  console.error(e);
  bootDone();
  document.body.append(Object.assign(document.createElement('pre'), { textContent: String(e?.stack ?? e), style: 'color:#f88;padding:1em' }));
});
