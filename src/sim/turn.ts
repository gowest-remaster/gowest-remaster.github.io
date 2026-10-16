// The calendar turn loop: calendar button (CALEND ScoreScript 8), Date check (ScoreScript 6),
// month advance + EndDate, Begin-frame visit (trivia), mail, neighbour help, town talk.
// docs/spec/02-farm-sim.md §2, §3, §6.8–§6.10.
import { changeCash, emit, fillLogBook, neighborBox, quirk, rand, reject, type Ctx } from './ctx.ts';
import { advanceDays, catchUpMonths, livingCostOfDays, monthAdvance, queueDisasterMessage, ret, townTalk } from './calendar.ts';
import { TRIVIA_BONUS, TRIVIA_RIGHT } from './data/tables.ts';
import { endGame, openEvents, setPending } from './events.ts';
import { edRandom } from './newgame.ts';
import { checkMainEvent, checkMoneyLoan, monthCheck, msg, son2Plot } from './rules.ts';
import { monthIndex } from './state.ts';

export interface RunOptions {
  /**
   * Emulates the player pressing the green stop button after this many month advances
   * (g_OutDate = 1). The calendar then stops at the next Date check that has no event.
   */
  months?: number;
  /**
   * Return after every month advance with a `calendarRunning` event (and
   * `extra.calendar.running = true`) so the UI can animate the month and offer Pause. Resume
   * with `continueCalendar`; Pause with `stopCalendar`.
   */
  yieldEachMonth?: boolean;
}

const afterFeb1906 = (y: number, m: number) => y > 1906 || (y === 1906 && m > 2);

function stopAtBegin(ctx: Ctx, reason: string) {
  ret(ctx);
  emit(ctx, { type: 'calendarStopped', reason });
  visitBegin(ctx);
}

/** Begin frame (ScoreScript 12): trivia offer on the first visit of the month. */
export function visitBegin(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  if (g.trivia === 0 && g.trivRand >= 1 && g.trivRand <= 4 && g.eog === 0 && !s.extra.ended) {
    g.trivia = 1;
    g.quesNum += 1;
    if (g.quesNum === 17 || g.quesNum < 2) {
      s.random.triviaOrder = edRandom(s); // world stream: the Begin frame is not navigation
      g.quesNum = 1;
    }
    s.extra.triviaOpen = true;
    s.extra.triviaQuestion = s.random.triviaOrder[g.quesNum - 1];
    emit(ctx, { type: 'trivia', question: s.extra.triviaQuestion });
  } else if (quirk(ctx, 'TRIVKEEP')) {
    s.extra.triviaOpen = false;
  }
}

/** Classic emulation of the Start frame when the month changed outside the calendar (Q4). */
function startFrame(ctx: Ctx) {
  const s = ctx.s;
  if (s.date.lastStopMonth !== s.date.mon) {
    s.globals.mainEvent = 0;
    s.globals.wasEvent = 0;
    s.globals.mail = 0;
    townTalk(ctx);
    s.globals.wasTTalk = 1;
    s.date.lastStopMonth = s.date.mon;
  }
}

/** TakeMail: "There's a letter in your mailbox.", then the Events frame. */
export function takeMail(ctx: Ctx) {
  const s = ctx.s;
  s.globals.mail = -1;
  setPending(ctx, msg('TakeMail', neighborBox(s.date.year, 1888), { onAck: 'openEvents' }));
}

/** Calendar button. Runs months until something stops the calendar. */
export function startCalendar(ctx: Ctx, opts: RunOptions = {}) {
  const s = ctx.s;
  const g = s.globals;
  const { year, mon } = s.date;
  if (year === 1880 && mon === 4 && g.houseStat === 0 && g.firstTT !== 1) {
    reject(ctx, 'visitTownTalkFirst');
    return;
  }
  if (quirk(ctx, 'Q4')) startFrame(ctx);
  if (g.mail > 0) {
    takeMail(ctx);
    return;
  }
  if (year > 1919 || (year === 1919 && mon === 12)) {
    g.tTalk = 1;
    g.wasTTalk = 1;
    g.blinkTTalk = 0;
    emit(ctx, { type: 'townTalk', id: 120, path: 'TTalk6' });
    endGame(ctx, 'completed');
    return;
  }
  if (g.houseStat === 0) {
    // The neighbours build the sod house (first click of the game).
    s.propet.toBuildHouse = 0;
    s.propet.house = 1;
    g.houseStat = 1;
    const from = advanceDays(ctx, 2, 'calend', 'houseBuilt');
    changeCash(ctx, -livingCostOfDays(s.propet.lifePrice, 2), 'livingCost');
    emit(ctx, { type: 'built', item: 'house' });
    setPending(ctx, msg('T623', neighborBox(s.date.year, 1888)));
    catchUpMonths(ctx, from);
    return;
  }
  if (g.eog === 1) {
    setPending(ctx, msg('GameIsOver', neighborBox(s.date.year, 1888)));
    return;
  }
  g.aprilSept = 0;
  g.outDate = 0;
  emit(ctx, { type: 'calendarStarted' });
  s.extra.calendar = { running: true, yieldEachMonth: opts.yieldEachMonth === true, monthsLeft: opts.months ?? null };
  if (opts.months !== undefined && opts.months <= 0) g.outDate = 1;
  runCalendar(ctx);
}

/**
 * The calendar loop (frames Date -> 17 -> Date ...). Re-entrant: with `yieldEachMonth` it
 * returns after each month advance and leaves `extra.calendar.running` set, so that
 * `continueCalendar` resumes WITHOUT re-running the run-start resets (aprilSept, outDate) or the
 * current month's Date check (Q2).
 */
function runCalendar(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  const cal = s.extra.calendar;
  for (let guard = 0; guard < 2000; guard++) {
    if (dateCheck(ctx)) {
      cal.running = false;
      return;
    }
    monthAdvance(ctx);
    if (g.grassH > 0) {
      ret(ctx);
      g.grassH = 0;
      if (g.tTalk > 0) g.wasTTalk = 1;
      queueDisasterMessage(ctx);
      cal.running = false;
      emit(ctx, { type: 'calendarStopped', reason: 'disaster' });
      return;
    }
    if (cal.monthsLeft !== null) {
      cal.monthsLeft -= 1;
      if (cal.monthsLeft <= 0) g.outDate = 1;
    }
    if (cal.yieldEachMonth) {
      emit(ctx, { type: 'calendarRunning', year: s.date.year, mon: s.date.mon, day: s.date.day });
      return;
    }
  }
  cal.running = false;
}

/** Resume a yielded calendar run. */
export function continueCalendar(ctx: Ctx) {
  if (!ctx.s.extra.calendar.running) return reject(ctx, 'calendarNotRunning');
  runCalendar(ctx);
}

/**
 * Pause: raise the stop request (g_OutDate = 1) and keep running, so the stop takes effect at
 * the next Date check, as the original green button did. Normally that is immediate; an event
 * in the same month still shows first.
 */
export function stopCalendar(ctx: Ctx) {
  if (!ctx.s.extra.calendar.running) return reject(ctx, 'calendarNotRunning');
  ctx.s.globals.outDate = 1;
  ctx.s.extra.calendar.monthsLeft = null;
  runCalendar(ctx);
}

/** MonthCheck reminders that only go away by building something. */
const BUILD_NAGS = new Set(['NoBuild', 'OnlyBuild', 'NoWM', 'WMEOG', 'AfterTorn', 'NoBarn', 'BuildFence']);

/** Event types whose resolution does not depend on the exact month (SKIPEVT re-dating). */
const MOVABLE_TYPES = new Set([1, 2, 5, 6, 7]);
/** Lines whose resolution tests the exact month (events.ts letterOk / messageOk). */
const MONTH_SPECIFIC = new Set([188307, 190208, 190907, 191806]);

/**
 * SKIPEVT fix: months the calendar never date-checked (crossed by a long field job) lose their
 * scheduled event in the original. Move such events to the first later month of the same year
 * that has no event of its own.
 */
function rescueSkippedEvents(ctx: Ctx, fromIdx: number, toIdx: number) {
  const s = ctx.s;
  const has = (y: number, m: number) => s.events.some((l) => Number(l[0]) === y && Number(l[1]) === m);
  for (let k = fromIdx; k < toIdx; k++) {
    const y = Math.floor(k / 12);
    const m = (k % 12) + 1;
    for (const line of s.events) {
      if (Number(line[0]) !== y || Number(line[1]) !== m) continue;
      if (!MOVABLE_TYPES.has(Number(line[3])) || MONTH_SPECIFIC.has(y * 100 + m)) continue;
      let target = -1;
      for (let t = toIdx; Math.floor(t / 12) === y; t++) {
        if (!has(y, (t % 12) + 1)) {
          target = t;
          break;
        }
      }
      if (target < 0) continue;
      line[1] = String((target % 12) + 1);
    }
  }
}

/** Date frame check for the current month. Returns true when the calendar stops. */
export function dateCheck(ctx: Ctx): boolean {
  const s = ctx.s;
  const g = s.globals;
  const c = s.cursit;
  const { year, mon } = s.date;
  const idx = monthIndex(year, mon);
  if (!quirk(ctx, 'SKIPEVT') && idx - s.extra.lastDateCheck > 1) rescueSkippedEvents(ctx, s.extra.lastDateCheck + 1, idx);
  s.extra.lastDateCheck = Math.max(s.extra.lastDateCheck, idx);
  if (g.son2Plot === 1) son2Plot(ctx);
  if (g.wasTTalk === 0) townTalk(ctx);

  if ((mon === 4 || mon === 9) && c.neighborDebt >= 3 && c.workNow + g.workNow1 === 0 && g.mainView < 9 && g.mainView !== 7 && c.wintSum === 0) {
    ret(ctx);
    setPending(ctx, { kind: 'neighborHelp', days: rand(ctx, 4) + 7 });
    emit(ctx, { type: 'calendarStopped', reason: 'neighborHelp' });
    return true;
  }
  if (g.whatScore > 0 && s.propet.ach[g.whatScore - 1] === 0) {
    if (afterFeb1906(year, mon) && g.mail === 0) {
      g.mail = 1;
      emit(ctx, { type: 'mail' });
      stopAtBegin(ctx, 'mail');
    } else {
      ret(ctx);
      openEvents(ctx); // shows the ALM letter and sets its flag
      emit(ctx, { type: 'calendarStopped', reason: 'letter' });
    }
    return true;
  }
  let stop = monthCheck(ctx);
  // WINTERLOCK: a must-build nag in Nov-Feb (when nothing can be built) would block forever.
  if (stop && stop.kind === 'message' && BUILD_NAGS.has(stop.text) && !quirk(ctx, 'WINTERLOCK') && (mon < 3 || mon > 10)) {
    emit(ctx, { type: 'dialog', id: stop.text, dbox: stop.dbox });
    stop = null;
  }
  if (stop) {
    ret(ctx);
    setPending(ctx, stop);
    emit(ctx, { type: 'calendarStopped', reason: 'monthCheck' });
    return true;
  }
  let checkStop = g.wasEvent === 0;
  if (g.wasEvent === 0) {
    checkMainEvent(ctx);
    if (g.mainEvent > 0) {
      g.wasEvent = 1;
      const letter = g.mainEvent === 2 || (g.mainEvent > 5 && g.mainEvent < 10);
      if (letter && afterFeb1906(year, mon) && g.mail === 0) {
        g.mail = 1;
        emit(ctx, { type: 'mail' });
        stopAtBegin(ctx, 'mail');
      } else {
        ret(ctx);
        openEvents(ctx);
        emit(ctx, { type: 'calendarStopped', reason: 'event' });
      }
      return true;
    }
  } else if (!quirk(ctx, 'Q3')) checkStop = true;
  if (checkStop && (g.outDate === 1 || (g.tTalk > 0 && g.wasTTalk === 0)) && g.grassH === 0) {
    const talk = g.tTalk > 0 && g.wasTTalk === 0;
    if (talk) g.wasTTalk = 1;
    stopAtBegin(ctx, talk ? 'townTalk' : 'stopRequested');
    return true;
  }
  const money = checkMoneyLoan(ctx);
  if (money) {
    ret(ctx);
    setPending(ctx, money);
    emit(ctx, { type: 'calendarStopped', reason: 'money' });
    return true;
  }
  if ((mon === 4 || mon === 9) && g.aprilSept === 1) {
    stopAtBegin(ctx, 'plantingSeason');
    return true;
  }
  return false;
}

/** NHelp answer (ScoreScript 145). */
export function answerNeighborHelp(ctx: Ctx, yes: boolean) {
  const s = ctx.s;
  const p = s.pending;
  if (!p || p.kind !== 'neighborHelp') return reject(ctx, 'noNeighborHelpPending');
  s.cursit.neighborDebt = 0;
  if (yes) {
    s.cursit.goodwill = 0;
    const from = advanceDays(ctx, p.days, 'calend', 'neighborHelp');
    const cost = (quirk(ctx, 'Q23') ? s.extra.lastConstructionCost : 0) + livingCostOfDays(s.propet.lifePrice, p.days);
    changeCash(ctx, -cost, 'neighborHelp');
    setPending(ctx, null);
    catchUpMonths(ctx, from);
  } else {
    s.cursit.goodwill = 1;
    setPending(ctx, null);
  }
}

/** Trivia card answer (CALEND MovieScript 700 / ScoreScripts 701–706). */
export function answerTrivia(ctx: Ctx, answer: number) {
  const s = ctx.s;
  if (!s.extra.triviaOpen) return reject(ctx, 'noTrivia');
  const q = s.extra.triviaQuestion;
  const correct = TRIVIA_RIGHT[q - 1] === answer;
  const bonus = correct ? TRIVIA_BONUS[q - 1] : 0;
  if (correct) {
    changeCash(ctx, bonus, 'trivia');
    fillLogBook(ctx, quirk(ctx, 'LOGLOC') ? 9 : 5, 12, 0, bonus);
  }
  s.extra.triviaOpen = false;
  emit(ctx, { type: 'triviaAnswered', question: q, correct, bonus });
}

/** Click the blinking town-talk sprite (ScoreScript 78) -> TTALK. */
export function visitTownTalk(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  if (g.tTalk <= 0) return reject(ctx, 'noTownTalk');
  const t = s.ttalk[g.tTalk - 1];
  g.firstTT = 1;
  g.blinkTTalk = 0;
  emit(ctx, { type: 'townTalk', id: t?.id ?? g.tTalkName, path: t?.path ?? g.tTalkPath });
  if ((t?.id ?? g.tTalkName) === 120) endGame(ctx, 'completed');
}
