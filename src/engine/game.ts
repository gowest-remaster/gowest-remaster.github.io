// The game session: owns the sim state, the profile and edition, runs commands through the
// pure sim, lets the active view animate the resulting events, then presents dialogs and
// prompts (verbatim content) until nothing is pending. Autosaves every month.
import { dispatch, newGame, type Command, type CommandResult, type GameState, type SimEvent, type FidelityOptions } from '../sim/index.ts';
import { saves, type EditionInfo, type Profile } from './save.ts';
import type { SceneId } from './scene.ts';
import { settings, updateSettings } from './settings.ts';
import { askPrompt, showInfo, showTownTalk } from '../ui/prompts.ts';
import { message, openDialog } from '../ui/dialog.ts';
import { toast } from '../ui/toast.ts';
import { prose } from '../ui/dom.ts';
import { text } from '../game/text.ts';
import { audio } from './audio.ts';

/**
 * Optional replacement for the HTML dialogs, set by a skin that draws its own (the Classic
 * edition shows the original Director dialog boxes). Unset members fall back to ui/prompts.
 */
export interface Presenter {
  info?(s: GameState, e: Extract<SimEvent, { type: 'dialog' }>): Promise<void>;
  prompt?(s: GameState, p: NonNullable<GameState['pending']>): Promise<Command>;
  townTalk?(id: number): Promise<void>;
  harvest?(s: GameState, e: Extract<SimEvent, { type: 'harvest' }>, textId: string): Promise<void>;
  rejected?(s: GameState, e: Extract<SimEvent, { type: 'rejected' }>): Promise<void> | void;
  /** End of the game (instead of the message); the save is cleared and the title shown after. */
  gameOver?(s: GameState): Promise<void>;
}

/** Hooks the current scene view registers to animate sim events before dialogs appear. */
export interface ViewHooks {
  animate?(events: SimEvent[], prev: GameState, next: GameState): Promise<void>;
  /** After events and dialogs: refresh the view to the final state. */
  sync?(s: GameState): void;
}

export interface NewGameChoice {
  first: string;
  last: string;
  goal: number;
  edition: EditionInfo;
}

class Game {
  state: GameState | null = null;
  profile: Profile | null = null;
  edition: EditionInfo = { edition: 'remastered', rules: { mode: 'remastered' }, look: 'remastered' };
  scene: SceneId = 'board';
  view: ViewHooks | null = null;
  presenter: Presenter | null = null;
  private depth = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** navigation callback set by main (scene manager) */
  goTo: (id: SceneId) => void = () => {};

  get busy() {
    return this.depth > 0;
  }

  // ---------------------------------------------------------------- profiles / saves
  async selectProfile(p: Profile | null) {
    this.profile = p;
    updateSettings({ lastProfile: p?.id ?? null });
  }

  async ensureProfile(name: string): Promise<Profile> {
    if (this.profile) return this.profile;
    const p = await saves.createProfile(name || 'Homesteader', settings().pendingDevcut);
    if (settings().pendingDevcut) updateSettings({ pendingDevcut: false });
    await this.selectProfile(p);
    return p;
  }

  async start(choice: NewGameChoice) {
    const p = await this.ensureProfile(choice.first);
    p.lastPlayed = Date.now();
    await saves.putProfile(p);
    this.edition = choice.edition;
    const rules: FidelityOptions = { mode: choice.edition.rules.mode, overrides: { ...(choice.edition.rules.overrides ?? {}) } };
    this.state = newGame({ seed: Math.floor(Math.random() * 2 ** 31), goal: choice.goal, fidelity: rules, firstName: choice.first, lastName: choice.last });
    this.state.name = { first: choice.first, last: choice.last };
    this.scene = 'board';
    await this.save();
  }

  async resume(): Promise<boolean> {
    if (!this.profile) return false;
    const rec = await saves.load(this.profile.id);
    if (!rec) return false;
    this.state = rec.state;
    this.edition = rec.edition;
    this.scene = (rec.scene as SceneId) || 'board';
    this.profile.lastPlayed = Date.now();
    await saves.putProfile(this.profile);
    return true;
  }

  async save(scene: SceneId = this.scene) {
    if (!this.state || !this.profile) return;
    this.scene = scene;
    try {
      await saves.write({ profileId: this.profile.id, savedAt: Date.now(), edition: this.edition, scene, state: this.state });
    } catch (e) {
      console.error('save failed', e);
    }
  }

  setLook(look: EditionInfo['look']) {
    this.edition = { ...this.edition, look };
    void this.save();
  }

  // ---------------------------------------------------------------- commands
  /** Run a command, serialised: animation, then dialogs/prompts, then autosave. */
  run(cmd: Command): Promise<CommandResult | null> {
    const p = this.queue.then(() => this.runNow(cmd));
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Dry-run a command on the current state (pure; nothing is applied). */
  peek(cmd: Command): CommandResult | null {
    return this.state ? dispatch(this.state, cmd) : null;
  }

  /** Apply a result computed by `peek` (e.g. a check that also changed state). */
  async apply(r: CommandResult) {
    await this.queue;
    const prev = this.state!;
    this.state = r.state;
    await this.afterDispatch(r, prev);
  }

  private async runNow(cmd: Command): Promise<CommandResult | null> {
    if (!this.state) return null;
    this.depth++;
    try {
      const prev = this.state;
      const r = dispatch(prev, cmd);
      this.state = r.state;
      await this.afterDispatch(r, prev);
      return r;
    } finally {
      this.depth--;
    }
  }

  private async afterDispatch(r: CommandResult, prev: GameState) {
    await this.view?.animate?.(r.events, prev, r.state);
    await this.present(r.events);
    this.view?.sync?.(this.state!);
    if (r.events.some((e) => e.type === 'monthAdvanced')) await this.save();
    if (this.state?.extra.ended && r.events.some((e) => e.type === 'gameOver')) await this.gameOver();
  }

  /** Ask a prompt left pending (e.g. restored from a save) through the normal flow. */
  async presentPending() {
    await this.queue;
    if (!this.state?.pending || this.depth > 0) return;
    const cmd = await (this.presenter?.prompt ?? askPrompt)(this.state, this.state.pending);
    await this.run(cmd);
  }

  /** Dialog events first (in order), then the pending prompt chain. */
  private async present(events: SimEvent[]) {
    let harvest: Extract<SimEvent, { type: 'harvest' }> | null = null;
    for (const e of events) {
      if (e.type === 'dialog') {
        if (harvest && (e.id === 'EndHarv' || e.id === 'EndHarv1')) {
          if (this.presenter?.harvest) await this.presenter.harvest(this.state!, harvest, e.id);
          else await harvestSummary(harvest, e.id);
          harvest = null;
          continue;
        }
        await (this.presenter?.info ?? showInfo)(this.state!, e);
      } else if (e.type === 'harvest') harvest = e;
      else if (e.type === 'townTalk') await (this.presenter?.townTalk ?? showTownTalk)(e.id);
      else if (e.type === 'triviaAnswered' && e.correct) audio.sfxPlay('money', 0.35);
      else if (e.type === 'rejected' && this.presenter?.rejected) await this.presenter.rejected(this.state!, e);
      else if (e.type === 'rejected' && e.reason === 'visitTownTalkFirst') toast('Your neighbors are waiting in town — click the town talk first.', 'gold', 3.5);
      else if (e.type === 'rejected') console.info('rejected', e.reason);
    }
    if (this.state?.pending) {
      const cmd = await (this.presenter?.prompt ?? askPrompt)(this.state, this.state.pending);
      await this.runNow(cmd);
    }
  }

  private async gameOver() {
    const s = this.state!;
    const reasons: Record<string, string> = {
      completed: 'December 1919 — your homesteading years are complete.',
      retired: 'You have retired from the homestead.',
      bankrupt: 'Your game is over.',
      foreclosed: 'Your game is over.',
    };
    if (this.presenter?.gameOver) await this.presenter.gameOver(s);
    else await message(reasons[s.extra.ended ?? 'completed'] ?? 'Your game is over.', { title: 'The end of the trail' });
    if (this.profile) await saves.clear(this.profile.id);
    this.state = null;
    this.goTo('title');
  }
}

async function harvestSummary(e: Extract<SimEvent, { type: 'harvest' }>, textId: string) {
  const names = ['Winter wheat', 'Spring wheat', 'Oats', 'Corn'];
  const rows = e.bushels.map((b, i) => ({ b, i })).filter((r) => r.b > 0);
  const table = document.createElement('table');
  table.className = 'ledger';
  table.innerHTML = `<thead><tr><th>Crop</th><th>Bushels</th><th>Price / bu.</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${names[r.i]}</td><td class="num">${r.b.toLocaleString('en-US')}</td><td class="num">$${e.prices[r.i].toFixed(2)}</td></tr>`)
    .join('')}</tbody><tfoot><tr><td>Estimated value</td><td></td><td class="num">$${e.value.toLocaleString('en-US')}</td></tr></tfoot>`;
  const wrap = document.createElement('div');
  wrap.append(prose(text(textId)), table);
  audio.sfxPlay('harmon', 0.4);
  await openDialog({ title: 'Harvest complete', content: wrap, size: 'md', buttons: [{ label: 'OK', value: true, primary: true }] });
}

export const game = new Game();
