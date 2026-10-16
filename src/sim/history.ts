// Undo and rewind (docs/design/remastered-ux.md §6.5). The sim is pure: `dispatch` returns a new
// state and never mutates the old one, so history is just a list of earlier states with labels.
// Everything here is immutable too: each function returns a new Timeline.
//
// - Undo (Ctrl+Z) reverts the last *action* (a purchase, a savings move, a letter answer, a
//   planting). By default the undo stack is cleared when time advances (`barrierOnTimeAdvance`),
//   as the UX doc asks; with RNGSTREAM on, undoing across time is also honest and can be allowed.
// - Rewind keeps one state per month reached (the last `monthLimit` months), like the monthly
//   autosaves: "Rewind to April 1886".
import { dispatch, type Command, type CommandResult } from './commands.ts';
import type { SimEvent } from './events-out.ts';
import type { GameState } from './state.ts';

export interface Snapshot {
  label: string;
  state: GameState;
  year: number;
  mon: number;
  day: number;
}

export interface TimelineOptions {
  /** most undo steps kept (default 50) */
  undoLimit: number;
  /** most monthly rewind points kept (default 24) */
  monthLimit: number;
  /** clear the undo stack when the date changes (default true) */
  barrierOnTimeAdvance: boolean;
}

export interface Timeline {
  opts: TimelineOptions;
  /** states before each undoable action, oldest first */
  undo: Snapshot[];
  /** states undone, for redo (cleared by any new action) */
  redo: Snapshot[];
  /** one state per month reached, oldest first */
  months: Snapshot[];
}

const DEFAULTS: TimelineOptions = { undoLimit: 50, monthLimit: 24, barrierOnTimeAdvance: true };

const snap = (label: string, state: GameState): Snapshot => ({ label, state, year: state.date.year, mon: state.date.mon, day: state.date.day });
const cap = <T>(xs: T[], n: number) => (xs.length > n ? xs.slice(xs.length - n) : xs);

export function createTimeline(start: GameState, opts: Partial<TimelineOptions> = {}): Timeline {
  const o = { ...DEFAULTS, ...opts };
  return { opts: o, undo: [], redo: [], months: [snap(monthLabel(start), start)] };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (s: GameState) => `${MONTH_NAMES[s.date.mon - 1]} ${s.date.year}`;

/** Events that mean the command did something worth undoing. */
const CHANGES = new Set<SimEvent['type']>(['cash', 'savings', 'score', 'lifePrice', 'dateChanged', 'monthAdvanced', 'harvest', 'built', 'log', 'prompt', 'trivia', 'triviaAnswered', 'townTalk', 'letter', 'telegram', 'gameOver']);

/** Did this result change the game in a way the player would want to undo? */
export function isUndoable(before: GameState, result: CommandResult): boolean {
  if (result.events.some((e) => e.type === 'rejected')) return false;
  if (result.events.some((e) => CHANGES.has(e.type))) return true;
  // silent but real changes: plants, seeds, album text, pending prompt resolved...
  return (
    before.pending !== result.state.pending ||
    JSON.stringify(before.cursit.plant) !== JSON.stringify(result.state.cursit.plant) ||
    JSON.stringify(before.propet.seeds) !== JSON.stringify(result.state.propet.seeds) ||
    JSON.stringify(before.album) !== JSON.stringify(result.state.album)
  );
}

/**
 * Record a transition `before -> after` made by an action labelled `label`.
 * Call it with every dispatch result you commit; non-undoable results are ignored.
 */
export function record(t: Timeline, label: string, before: GameState, result: CommandResult): Timeline {
  if (!isUndoable(before, result)) return t;
  const after = result.state;
  const timeMoved = after.date.year !== before.date.year || after.date.mon !== before.date.mon || after.date.day !== before.date.day;
  let undo = t.opts.barrierOnTimeAdvance && timeMoved ? [] : cap([...t.undo, snap(label, before)], t.opts.undoLimit);
  let months = t.months;
  const last = months[months.length - 1];
  if (!last || last.year !== after.date.year || last.mon !== after.date.mon) months = cap([...months, snap(monthLabel(after), after)], t.opts.monthLimit);
  // a yielded calendar run is not a resting point to undo into
  if (after.extra.calendar?.running) undo = t.opts.barrierOnTimeAdvance ? [] : undo;
  return { ...t, undo, redo: [], months };
}

/** Dispatch + record in one call. */
export function dispatchRecorded(t: Timeline, state: GameState, cmd: Command, label: string = cmd.type): { timeline: Timeline } & CommandResult {
  const r = dispatch(state, cmd);
  return { timeline: record(t, label, state, r), ...r };
}

export const canUndo = (t: Timeline) => t.undo.length > 0;
export const canRedo = (t: Timeline) => t.redo.length > 0;
/** Label of the action Undo would revert ("Undo: bought seeds"). */
export const undoLabel = (t: Timeline) => t.undo[t.undo.length - 1]?.label ?? null;

/** Revert the last action. `current` is the live state (kept for redo). */
export function undo(t: Timeline, current: GameState): { timeline: Timeline; state: GameState } | null {
  const top = t.undo[t.undo.length - 1];
  if (!top) return null;
  return { timeline: { ...t, undo: t.undo.slice(0, -1), redo: [...t.redo, snap(top.label, current)] }, state: top.state };
}

export function redo(t: Timeline, current: GameState): { timeline: Timeline; state: GameState } | null {
  const top = t.redo[t.redo.length - 1];
  if (!top) return null;
  return { timeline: { ...t, redo: t.redo.slice(0, -1), undo: [...t.undo, snap(top.label, current)] }, state: top.state };
}

/** Monthly rewind points, newest first ("Rewind to April 1886"). */
export function rewindPoints(t: Timeline): { index: number; label: string; year: number; mon: number }[] {
  return t.months.map((m, index) => ({ index, label: m.label, year: m.year, mon: m.mon })).reverse();
}

/** Go back to a monthly point; later points and the undo/redo stacks are dropped. */
export function rewindTo(t: Timeline, index: number): { timeline: Timeline; state: GameState } | null {
  const m = t.months[index];
  if (!m) return null;
  return { timeline: { ...t, undo: [], redo: [], months: t.months.slice(0, index + 1) }, state: m.state };
}
