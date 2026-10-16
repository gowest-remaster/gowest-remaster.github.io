// The Remastered game session: owns the GameState, profile, edition and journal; runs commands
// through the pure sim; keeps an Undo stack back to the last time advance; autosaves monthly
// with a rewind ring; and broadcasts every change to the UI.
import { migrateState, newGame, type Command, type CommandResult, type GameState, type SimEvent } from '../../sim/index.ts';
import type { EditionInfo, Profile } from '../../engine/save.ts';
import { Emitter } from './bus.ts';
import { simDispatch as dispatch } from './dispatch.ts';
import { emptyJournal, ingest, snapshot, type Journal } from './journal.ts';
import { rmSaves, type RmSave, type SaveKind } from './saves.ts';
import { rm } from './settings.ts';
import { dateShort, setClassicCurrency } from './format.ts';
import { reproduces } from '../../sim/index.ts';

export interface NewGameSetup {
  first: string;
  last: string;
  goal: number;
  edition: EditionInfo;
  seed?: number;
  profileName?: string;
  devcut?: boolean;
  /** sim new-game assists (GOALRETRY) */
  assists?: { goalRetry?: boolean };
  /** play under this existing profile instead of the current/new one */
  profile?: Profile;
}

interface UndoEntry {
  label: string;
  state: GameState;
  journal: Journal;
}

type SessionEvents = {
  change: [GameState, SimEvent[], Command | null];
  loaded: [GameState];
  saved: [SaveKind];
  ended: [GameState];
  undo: [string];
};

const TIME_EVENTS = new Set(['monthAdvanced', 'dateChanged']);

class Session extends Emitter<SessionEvents> {
  state: GameState | null = null;
  profile: Profile | null = null;
  edition: EditionInfo = { edition: 'remastered', rules: { mode: 'remastered' }, look: 'remastered' };
  journal: Journal = emptyJournal();
  place = 'homestead';
  private undoStack: UndoEntry[] = [];
  private saveTimer = 0;

  get s(): GameState {
    if (!this.state) throw new Error('no game');
    return this.state;
  }

  /** A prompt (letter, decision, message) is waiting; action commands will be refused. */
  get blocked() {
    return !!this.state?.pending;
  }

  get canUndo() {
    return this.undoStack.length > 0 && rm().assists.undo && this.edition.rules.mode !== 'classic';
  }
  get undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label ?? '';
  }

  /** Dry run on the current state: nothing is applied. */
  peek(cmd: Command): CommandResult {
    return dispatch(this.s, cmd);
  }

  /**
   * Run a command. `label` names it for Undo and the standing ledger ("Donation to the
   * school", "Bought 3 sacks of seed"). Undoable unless it moved time.
   */
  run(cmd: Command, label: string = cmd.type): CommandResult {
    const prev = this.s;
    const prevJournal = structuredClone(this.journal);
    const r = dispatch(prev, cmd);
    this.state = r.state;
    ingest(this.journal, prev, r.state, r.events, label);
    const moved = r.events.some((e) => TIME_EVENTS.has(e.type));
    const changed = r.events.some((e) => e.type !== 'rejected');
    if (moved) this.undoStack = [];
    else if (changed && !cmd.type.startsWith('enter') && cmd.type !== 'visitTownTalk') {
      this.undoStack.push({ label, state: prev, journal: prevJournal });
      if (this.undoStack.length > 20) this.undoStack.shift();
    }
    this.emit('change', r.state, r.events, cmd as Command);
    if (r.events.some((e) => e.type === 'monthAdvanced')) this.scheduleAutosave(true);
    else if (changed) this.scheduleAutosave(false);
    if (r.state.extra.ended && r.events.some((e) => e.type === 'gameOver')) this.emit('ended', r.state);
    return r;
  }

  /** Apply a pre-computed result (e.g. from a calendar step) as if run. */
  applyResult(prev: GameState, r: CommandResult, label: string, cmd: Command | null = null) {
    this.state = r.state;
    ingest(this.journal, prev, r.state, r.events, label);
    if (r.events.some((e) => TIME_EVENTS.has(e.type))) this.undoStack = [];
    this.emit('change', r.state, r.events, cmd);
    if (r.events.some((e) => e.type === 'monthAdvanced')) this.scheduleAutosave(true);
    if (r.state.extra.ended && r.events.some((e) => e.type === 'gameOver')) this.emit('ended', r.state);
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const e = this.undoStack.pop()!;
    this.state = e.state;
    this.journal = e.journal;
    this.emit('undo', e.label);
    this.emit('change', e.state, [], null);
    this.scheduleAutosave(false);
    return true;
  }

  // ------------------------------------------------------------------ lifecycle

  async newGame(setup: NewGameSetup) {
    if (setup.profile) this.profile = setup.profile;
    let p = this.profile;
    if (!p) {
      p = await rmSaves.createProfile(setup.profileName || setup.first || 'Homesteader', !!setup.devcut);
      this.profile = p;
    }
    p.lastPlayed = Date.now();
    await rmSaves.putProfile(p);
    this.edition = setup.edition;
    const seed = setup.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.state = newGame({ seed, goal: setup.goal, fidelity: { mode: setup.edition.rules.mode, overrides: { ...(setup.edition.rules.overrides ?? {}) } }, firstName: setup.first, lastName: setup.last, assists: setup.assists, devcut: !!setup.devcut });
    this.state.name = { first: setup.first, last: setup.last };
    this.journal = emptyJournal();
    snapshot(this.journal, this.state);
    this.undoStack = [];
    this.place = 'homestead';
    await this.rmClearOld();
    await this.save('auto');
    this.emit('loaded', this.state);
  }

  private async rmClearOld() {
    if (this.profile) await rmSaves.clearGame(this.profile.id);
  }

  async load(rec: RmSave, profile?: Profile) {
    if (profile) this.profile = profile;
    this.state = migrateState(structuredClone(rec.state));
    this.edition = rec.edition;
    this.journal = { ...emptyJournal(), ...structuredClone(rec.journal ?? emptyJournal()) };
    this.place = rec.place || 'homestead';
    this.undoStack = [];
    if (this.profile) {
      this.profile.lastPlayed = Date.now();
      await rmSaves.putProfile(this.profile);
    }
    this.emit('loaded', this.state);
  }

  setLook(look: EditionInfo['look']) {
    this.edition = { ...this.edition, look };
  }

  private scheduleAutosave(month: boolean) {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.save('auto');
      if (month) void this.pushRewind();
    }, month ? 50 : 600);
  }

  async save(kind: SaveKind, slot = 0) {
    if (!this.state || !this.profile) return;
    try {
      await rmSaves.write({ profileId: this.profile.id, kind, slot, savedAt: Date.now(), edition: this.edition, place: this.place, state: this.state, journal: this.journal, label: dateShort(this.state.date) });
      this.emit('saved', kind);
    } catch (e) {
      console.error('save failed', e);
    }
  }

  private async pushRewind() {
    if (!this.state || !this.profile) return;
    try {
      await rmSaves.pushRing({ profileId: this.profile.id, savedAt: Date.now(), edition: this.edition, place: 'homestead', state: this.state, journal: this.journal, label: dateShort(this.state.date) });
    } catch (e) {
      console.error('rewind save failed', e);
    }
  }

  close() {
    this.state = null;
    this.undoStack = [];
  }
}

export const session = new Session();
// CURRENCY (ui quirk): classic rules print negative money as "$-5.00".
session.on('loaded', (st) => setClassicCurrency(reproduces(st.fidelity, 'CURRENCY')));
