// The Advance control's engine. Runs the sim calendar month by month with the re-entrant API
// (startCalendar {yieldEachMonth} → calendarRunning → continueCalendar / stopCalendar), animates
// each month in the world, plays disaster cinematics, honours Pause, and adds the UI-only
// auto-pause stops (§3.3). Falls back to a single non-yielding run if the sim lacks re-entrancy.
import { dispatch as dispatchPure, grainQuote, type Command, type CommandResult, type GameState, type SimEvent } from '../../sim/index.ts';
import type { DisasterKind as WorldDisaster } from '../../world/api.ts';
import type { App } from './app.ts';
import { Emitter } from './bus.ts';
import { monthName, monthsBetween } from './format.ts';
import { session } from './session.ts';
import { reducedMotion, rm, SPEED_SECONDS } from './settings.ts';
import { almanacPins, peek, runway, squares, yieldOutlook } from './simapi.ts';
import { worldViewOf } from './worldview.ts';
import { audio } from './audio.ts';
import { quietPrompt, settleQuiet } from './quiet.ts';
import { notify } from '../ui/notify.ts';

export interface AdvanceStatus {
  ok: boolean;
  /** label for the button ("Advance to September") */
  label: string;
  sub?: string;
  /** disabled reason (new UI copy) */
  reason?: string;
  /** a 1880-style gate: original message id and the to-do list that lifts it */
  gate?: { textId: string; todo: { text: string; go?: string; action?: string; done: boolean }[] };
  firstPress?: boolean;
}

const GATE_TEXTS = new Set(['NoBuild', 'OnlyBuild', 'WMEOG', 'NoWM', 'NoBarn', 'AfterTorn', 'BuildFence']);

/** What pressing Advance would do right now (pure). */
export function advanceStatus(s: GameState): AdvanceStatus {
  if (s.extra.ended) return { ok: false, label: 'The story is complete', reason: 'This game has ended.' };
  if (s.pending) return { ok: false, label: 'A letter is waiting', reason: 'Answer the letter first.' };
  const r = peek(s, { type: 'startCalendar', months: 1 });
  if (r.events.some((e) => e.type === 'rejected' && e.reason === 'visitTownTalkFirst'))
    return { ok: false, label: 'Meet your neighbors', reason: 'Say hello on Main Street first (key 4).', gate: { textId: '', todo: [{ text: 'Say hello to Longview (Main Street, town talk)', go: 'street', done: false }] } };
  if (s.globals.houseStat === 0) return { ok: true, label: 'Let the neighbors raise your sod house', firstPress: true };
  const p = r.state.pending;
  const advanced = r.events.some((e) => e.type === 'monthAdvanced');
  if (!advanced && p && p.kind === 'message' && GATE_TEXTS.has(p.text)) {
    // Does it come back on the next press? Then it is a hard gate, not a one-off notice.
    const acked = dispatchPure(r.state, { type: 'ack' });
    const again = dispatchPure(acked.state, { type: 'startCalendar', months: 1 });
    const p2 = again.state.pending;
    if (!again.events.some((e) => e.type === 'monthAdvanced') && p2?.kind === 'message' && p2.text === p.text) {
      const pr = s.propet;
      const barn = pr.barn > 0 && pr.barn !== 3;
      const wm = (pr.windmill > 0 && pr.windmill !== 2) || pr.extraWindmills > 0;
      const todo = [
        { text: 'Build a barn (click its blueprint on the homestead)', action: 'build:barn', done: barn },
        { text: pr.toBuildWindmill > 0 ? 'Build the well & windmill' : 'Buy a windmill at the General Store', go: pr.toBuildWindmill > 0 ? undefined : 'store', action: pr.toBuildWindmill > 0 ? 'build:windmill' : undefined, done: wm },
      ];
      if (p.text === 'BuildFence') todo.push({ text: 'Build the fence', action: 'build:fence', done: false });
      const label = p.text === 'BuildFence' ? 'Build the fence first' : !barn && !wm ? 'Build a barn & well first' : !barn ? 'Build a barn first' : !wm ? 'Get a well & windmill first' : 'Finish building first';
      const reason = !barn && !wm ? 'Your family needs a barn and a well before time can pass.' : !barn ? 'Your animals need a barn before time can pass.' : !wm ? 'Your family needs a well and windmill before time can pass.' : 'Something still needs building.';
      return { ok: false, label, reason, gate: { textId: p.text, todo } };
    }
  }
  const next = nextStop(s);
  return { ok: true, label: `Advance to ${monthName(next.mon)}`, sub: next.why };
}

/** The next guaranteed stop (April / September) or a UI auto-pause, whichever is first. */
export function nextStop(s: GameState): { year: number; mon: number; why: string; uiMonths: number | null } {
  const { year, mon } = s.date;
  let y = year;
  let m = mon;
  let why = '';
  for (let i = 1; i <= 12; i++) {
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
    if (m === 4) {
      why = 'planting season';
      break;
    }
    if (m === 9) {
      why = 'harvest season';
      break;
    }
  }
  const ui = uiStop(s);
  if (ui && monthsBetween(year, mon, ui.year, ui.mon) < monthsBetween(year, mon, y, m)) return { year: ui.year, mon: ui.mon, why: ui.why, uiMonths: monthsBetween(year, mon, ui.year, ui.mon) };
  return { year: y, mon: m, why, uiMonths: null };
}

/** UI-only auto-pause rules (Settings ▸ Assists ▸ Auto-pause). */
function uiStop(s: GameState): { year: number; mon: number; why: string } | null {
  const mode = rm().assists.autoPause;
  const { year, mon } = s.date;
  const cands: { year: number; mon: number; why: string }[] = [];
  // the player's own Almanac bookmarks always stop the calendar
  for (const b of session.journal.bookmarks) if (monthsBetween(year, mon, b.year, b.mon) >= 1) cands.push({ year: b.year, mon: b.mon, why: `your bookmark${b.label && b.label !== monthName(b.mon) ? `: ${b.label}` : ''}` });
  if (mode === 'off') {
    cands.sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon));
    return cands[0] ?? null;
  }
  const c = s.cursit;
  if (c.deadlineYear && (c.numPlanted > 0 || c.numHarved > 0)) {
    if (monthsBetween(year, mon, c.deadlineYear, c.deadlineMonth) >= 1) cands.push({ year: c.deadlineYear, mon: c.deadlineMonth, why: 'last month to harvest' });
  }
  const p = s.propet;
  if (p.loanAmount > 0) {
    const toSep = monthsBetween(year, mon, p.loanDueYear, 9);
    if (toSep >= 1) cands.push({ year: p.loanDueYear, mon: 9, why: 'loan due in December' });
  }
  const rw = runway(s);
  if (!rw.infinite && rw.months >= 3) {
    const k = rw.months - 2;
    const t = year * 12 + mon - 1 + k;
    cands.push({ year: Math.floor(t / 12), mon: (t % 12) + 1, why: 'money running low' });
  }
  if (mode === 'all') {
    for (const pin of almanacPins(s)) if (pin.kind === 'business' && monthsBetween(year, mon, pin.year + 1, 2) >= 1) cands.push({ year: pin.year + 1, mon: 2, why: 'business sale ends soon' });
  }
  cands.sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon));
  return cands[0] ?? null;
}

const WORLD_DISASTER: Partial<Record<string, WorldDisaster>> = { fire: 'fire', tornado: 'tornado', grasshoppers: 'grasshoppers', animalsDied: 'blizzard' };

/**
 * Why the calendar last stopped, kept until the player presses Advance again, so the pill and the
 * Advance button can say it plainly ("Time stopped: new talk in town, optional").
 */
export let lastStop: { reason: string; year: number; mon: number } | null = null;
/** A short, plain reason for the last stop (null when there's nothing to say). */
export function stopNote(s: GameState): string | null {
  if (!lastStop || lastStop.year !== s.date.year || lastStop.mon !== s.date.mon) return null;
  switch (lastStop.reason) {
    case 'townTalk':
      return s.globals.blinkTTalk === 1 ? 'new town talk' : null;
    case 'plantingSeason':
      return s.date.mon === 4 ? 'planting season is here' : 'harvest season is here';
    case 'mail':
      return 'a letter came';
    case 'stopRequested':
      return null;
    case 'disaster':
      return 'something happened on the farm';
    case 'money':
      return 'money is short';
    case 'neighborHelp':
      return 'a neighbor asked for help';
    default:
      return null;
  }
}

/** What the last disaster took, measured on the state just before it (for the "What happened" card). */
export interface Loss {
  kind: string;
  /** the squares hit (1-based) and their crops */
  squares: { n: number; crop: number }[];
  bushels: { min: number; max: number };
  /** about what that grain would have fetched at this year's price */
  value: number;
}
export let lastLoss: Loss | null = null;
function lossOf(prev: GameState, kind: string, count?: number): Loss | null {
  if (kind !== 'fire' && kind !== 'grasshoppers' && kind !== 'cattle') return null;
  const ripe = squares(prev).filter((q) => q.owned && (q.ripe || q.planted) && q.crop);
  const hit = kind === 'cattle' && count ? ripe.slice(0, count) : ripe;
  const out = yieldOutlook(prev).map((y) => ({ ...y, k: hit.filter((q) => q.crop === y.crop).length }));
  let min = 0;
  let max = 0;
  let value = 0;
  const price = grainQuote(prev).prices;
  for (const y of out) {
    if (!y.squares || !y.k) continue;
    const share = y.k / y.squares;
    min += Math.round(y.min * share);
    max += Math.round(y.max * share);
    value += ((y.min + y.max) / 2) * share * (price[y.crop - 1] ?? 0);
  }
  return { kind, squares: hit.map((q) => ({ n: q.n, crop: q.crop as number })), bushels: { min, max }, value };
}

type CalEvents = { running: [boolean]; month: [GameState]; stopped: [string, SimEvent[]] };

export class CalendarRunner extends Emitter<CalEvents> {
  running = false;
  private pauseAsked = false;
  private app: App;
  constructor(app: App) {
    super();
    this.app = app;
  }

  /** Space / the Advance button. While running, it pauses. */
  /** events of a run that was continued past quiet stops (for the end-of-run digest) */
  private carried: SimEvent[] = [];
  async advance(opts: { months?: number; chain?: number } = {}): Promise<AdvanceStatus | undefined> {
    if (this.running) {
      this.pause();
      return;
    }
    if (!session.state || this.app.busy) return;
    const st = advanceStatus(session.s);
    if (!st.ok) return st;
    this.running = true;
    this.pauseAsked = false;
    lastStop = null;
    this.app.setBusy(true);
    this.emit('running', true);
    const all: SimEvent[] = [];
    let stopReason = '';
    try {
      let months = opts.months;
      if (months === undefined) {
        const ns = nextStop(session.s);
        if (ns.uiMonths !== null) months = ns.uiMonths;
      }
      let cmd = { type: 'startCalendar', months, yieldEachMonth: true } as unknown as Command;
      for (let guard = 0; guard < 600; guard++) {
        const prev = session.s;
        const r: CommandResult = session.run(cmd, 'Calendar');
        all.push(...r.events);
        await this.present(prev, r);
        const yielded = r.events.some((e) => e.type === ('calendarRunning' as SimEvent['type']));
        const stop = r.events.find((e): e is Extract<SimEvent, { type: 'calendarStopped' }> => e.type === 'calendarStopped');
        if (stop) stopReason = stop.reason;
        if (!yielded || session.s.extra.ended) break;
        cmd = { type: this.pauseAsked ? 'stopCalendar' : 'continueCalendar' } as unknown as Command;
      }
    } finally {
      this.running = false;
      if (session.state && stopReason) lastStop = { reason: stopReason, year: session.s.date.year, mon: session.s.date.mon };
      this.app.setBusy(false);
      this.emit('running', false);
    }
    // a stop for something that asks no question (a letter to read, family news): answer it
    // quietly into the Mailbox and keep going, so time only stops for real decisions
    if (session.state && !this.pauseAsked && opts.months === undefined && ['event', 'letter', 'monthCheck'].includes(stopReason) && quietPrompt(session.s) && (opts.chain ?? 0) < 8) {
      const r = settleQuiet();
      if (r?.note) notify(r.note, { icon: r.mail?.kind === 'letter' ? 'mail' : 'talk', quiet: true });
      if (!session.s.pending && advanceStatus(session.s).ok) {
        this.carried.push(...all);
        return this.advance({ chain: (opts.chain ?? 0) + 1 });
      }
    }
    if (session.state) this.app.update(session.s, []);
    const evs = [...this.carried, ...all];
    this.carried = [];
    this.emit('stopped', stopReason, evs);
    return undefined;
  }

  pause() {
    if (!this.running) return;
    this.pauseAsked = true;
    this.app.world?.skip();
  }

  /** Animate what one calendar step produced: months passing, disasters. */
  private async present(prev: GameState, r: CommandResult) {
    const months = r.events.filter((e) => e.type === 'monthAdvanced');
    const secs = reducedMotion() ? Math.min(0.15, SPEED_SECONDS[rm().speed]) : SPEED_SECONDS[rm().speed];
    const w = this.app.world;
    for (const e of r.events) {
      if (e.type === 'disaster') {
        lastLoss = lossOf(prev, e.kind, e.squares);
        const kind = WORLD_DISASTER[e.kind];
        if (kind && w) {
          audio.sting(`disaster-${e.kind}`);
          this.app.root.classList.add('cinematic');
          try {
            w.setView(worldViewOf(r.state));
            await w.playDisaster(kind);
          } finally {
            this.app.root.classList.remove('cinematic');
          }
        }
      }
    }
    if (months.length && w) {
      // A non-yielding sim runs many months in one go: replay them quickly.
      const per = months.length > 1 ? Math.min(secs, 0.25) : secs;
      for (let i = 0; i < months.length; i++) {
        this.emit('month', r.state);
        if (per > 0) await w.playMonthPass(worldViewOf(r.state), per);
        else w.setView(worldViewOf(r.state), { instant: true });
        if (this.pauseAsked && months.length > 1) break;
      }
    } else if (w) w.setView(worldViewOf(r.state));
  }
}
