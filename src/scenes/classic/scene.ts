// The Classic edition's scene: one Director stage (DirPlayer) that plays the original movies
// and switches between them in place, like `go to frame "x" of movie "Y"` in the original.
// The SceneManager only brings us in (title, board, field, town, house); after that, movies
// change on this stage, and the location is saved so Continue returns to the same place.
import { BaseScene, type SceneId } from '../../engine/scene.ts';
import { game } from '../../engine/game.ts';
import type { Command } from '../../sim/index.ts';
import { DirPlayer } from './dir/player.ts';
import { csound } from './dir/sound.ts';
import { freshGlobals, SCENE_OF, type ClassicContext, type ClassicGlobals, type MovieModule, type MovieName } from './context.ts';
import { loadMovieFactory } from './movies/index.ts';
import { fallbackPresenter, stageAlert } from './presenter.ts';
import { installTestHooks, testAdvance, testNewGame } from './testing.ts';
import { setCurrencyQuirk } from './dir/lingo.ts';
import { quirk } from './shared/common.ts';
import './classic.css';

/** The ?movie= / ?newgame test parameters apply to the first title entry only. */
let testParamsUsed = false;

/** Globals survive scene changes (the original keeps them for the whole session). */
let globals: ClassicGlobals = freshGlobals();
export function resetClassicGlobals() {
  globals = freshGlobals();
}

export class ClassicScene extends BaseScene implements ClassicContext {
  readonly id: SceneId;
  d!: DirPlayer;
  private mod: MovieModule | null = null;
  movie: MovieName | null = null;
  private switching: Promise<void> = Promise.resolve();
  private gen = 0;

  constructor(id: SceneId) {
    super();
    this.id = id;
    this.layer.classList.add('classic-layer');
  }

  get g() {
    return globals;
  }

  get state() {
    return game.state;
  }

  /** First movie for the engine scene we were brought in for. */
  private entryMovie(): [MovieName, number | string | undefined] {
    const s = game.state;
    switch (this.id) {
      case 'title': {
        // dev/test aid: ?classic&movie=CALEND&frame=Begin opens a movie directly
        const q = new URLSearchParams(testParamsUsed ? '' : location.search);
        testParamsUsed = true;
        const mv = q.get('movie')?.toUpperCase() as MovieName | undefined;
        if (mv && mv in SCENE_OF) return [mv, q.get('frame') ?? undefined];
        return ['LOGIN', undefined];
      }
      case 'field':
        return ['FIELD', undefined];
      case 'town':
        return ['TSTREET1', s && s.date.year >= 1890 ? 'S2' : 'S1'];
      case 'house': {
        const wh = s?.globals.whatHouse ?? 1;
        return [wh >= 3 ? 'HOUSE3' : wh === 2 ? 'HOUSE2' : 'HOUSE1', undefined];
      }
      default:
        return ['CALEND', 'Start'];
    }
  }

  /** F10: save and switch to the Remastered look (main.ts reloads into the 3D app). */
  private onLookKey = (e: KeyboardEvent) => {
    if (e.key !== 'F10' || !game.state) return;
    e.preventDefault();
    const sw = (window as unknown as { __gowestSwitchLook?: (l: 'classic' | 'remastered') => void }).__gowestSwitchLook;
    if (!sw) return;
    game.setLook('remastered');
    void game.save(this.movie ? SCENE_OF[this.movie] : game.scene).then(() => sw('remastered'));
  };

  async enter() {
    window.addEventListener('keydown', this.onLookKey);
    this.d = new DirPlayer(this.layer);
    (window as unknown as { __classic: ClassicScene }).__classic = this; // test hook
    installTestHooks({ goMovie: (n: MovieName, f?: number | string) => this.goMovie(n, f) });
    if (this.id === 'title' && !testParamsUsed) {
      // dev/test aid: ?classic&newgame[=goal]&advance=N starts a game before opening ?movie=
      // (only on the first title entry of the page)
      const q = new URLSearchParams(location.search);
      if (q.has('newgame')) {
        await testNewGame(Number(q.get('newgame')) || 1);
        if (q.get('advance')) testAdvance(Number(q.get('advance')));
      }
    }
    const [m, f] = this.entryMovie();
    await this.goMovie(m, f);
  }

  /** `go(frame, "MOVIE")` */
  goMovie(name: MovieName, frame?: number | string): Promise<void> {
    const gen = ++this.gen;
    this.switching = this.switching.then(() => (gen === this.gen ? this.load(name, frame) : undefined));
    return this.switching;
  }

  private async load(name: MovieName, frame?: number | string) {
    const d = this.d;
    d.stop();
    d.cursor(4);
    try {
      this.mod?.stopMovie?.();
    } catch (e) {
      console.error(e);
    }
    this.mod = null;
    game.presenter = null;
    game.view = null;
    const factory = await loadMovieFactory(name);
    const mod = factory(this);
    this.mod = mod;
    this.movie = name;
    d.hooks = { movie: mod.movie, afterDraw: mod.afterDraw ? (c) => mod.afterDraw!(c) : undefined };
    game.presenter = { ...fallbackPresenter(this), ...(mod.presenter ?? {}) };
    game.view = mod.view ?? null;
    await d.loadMovie(name, frame ?? mod.startFrame ?? 1, mod.scripts, mod.startMovie ? () => mod.startMovie!() : undefined);
    d.cursor(0);
    d.start();
    if (game.state && game.profile && name !== 'LOGIN' && name !== 'OPEN' && name !== 'INTRO') void game.save(SCENE_OF[name]);
  }

  run(cmd: Command) {
    return game.run(cmd);
  }

  async quit(save: boolean) {
    if (save) await game.save(this.movie ? SCENE_OF[this.movie] : game.scene);
    game.state = null;
    resetClassicGlobals();
    // Quitting Classic returns to the game's main menu (the Remastered title), not the original login.
    const sw = (window as unknown as { __gowestSwitchLook?: (l: 'classic' | 'remastered') => void }).__gowestSwitchLook;
    if (sw) return sw('remastered');
    game.goTo('title');
  }

  async startGame(first: string, last: string, goal: number) {
    await game.start({ first, last, goal, edition: { edition: 'classic', rules: { mode: 'classic' }, look: 'classic' } });
    globals.introReturn = 'Start';
    await this.goMovie('CALEND', 'Start');
  }

  alert(text: string, buttons?: string[]) {
    return stageAlert(this.layer, text, buttons);
  }

  update(dt: number) {
    if (!this.d) return;
    setCurrencyQuirk(quirk(this, 'CURRENCY'));
    this.d.update(dt);
    this.mod?.update?.(dt);
  }

  exit() {
    window.removeEventListener('keydown', this.onLookKey);
    try {
      this.mod?.stopMovie?.();
    } catch (e) {
      console.error(e);
    }
    if (game.presenter) game.presenter = null;
    game.view = null;
    this.d?.destroy();
    csound.stopAll();
    csound.stopMusic();
    super.exit();
  }
}
