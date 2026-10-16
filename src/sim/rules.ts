// Per-month rules evaluated at the Date check: MonthCheck/CheckFence/Destroy (CALEND
// MovieScript 41), CheckMoneyLoan + SON2PLOT + TOWNTALK (MovieScript 5), CheckMainEvent and
// BusnessCheck/CheckTwo (MovieScripts 37/41). docs/spec/02-farm-sim.md §6.
import { changeLifePrice, emit, neighborBox, payCashThenSavings, quirk, rand, type Ctx } from './ctx.ts';
import { newTTalk, townTalk } from './calendar.ts';
import { DESTROIED, MAYOR_FAIL_EVENT, MAYOR_SUCCESS_EVENTS } from './data/tables.ts';
import type { Prompt } from './state.ts';
import { devcutMonthCheck } from './devcut.ts'; // [devcut]

const msg = (text: string, dbox: string, extra: Partial<Extract<Prompt, { kind: 'message' }>> = {}): Prompt => ({ kind: 'message', text, dbox, next: null, ...extra });

/** Append an event line (AllEvents + All, always aligned). */
export function addEvent(ctx: Ctx, line: string) {
  ctx.s.events.push(line.split(','));
}

// ---------------------------------------------------------------------------
// MonthCheck
// ---------------------------------------------------------------------------

function animalsDie(ctx: Ctx): Prompt {
  const p = ctx.s.propet;
  p.horses = 1;
  p.pigs = 0;
  p.cows = 0;
  p.animalsDied = 1;
  changeLifePrice(ctx, 10, 'AnimD');
  emit(ctx, { type: 'disaster', kind: 'animalsDied' });
  return msg('AnimD', 'DBox0');
}

/** Returns the stop message (g_Stop > 0) or null. */
export function monthCheck(ctx: Ctx): Prompt | null {
  const s = ctx.s;
  const p = s.propet;
  const { year, mon } = s.date;
  const barn = p.barn > 0 && p.barn !== 3 ? 1 : 0;
  const wm = (p.windmill > 0 && p.windmill !== 2) || p.extraWindmills > 0 ? 1 : 0;
  let stop: Prompt | null = null;
  if (year === 1880) {
    if (wm === 0 && barn === 0) stop = msg('NoBuild', 'DBox1');
    else if (wm === 0) {
      if (p.toBuildWindmill > 0) stop = msg('OnlyBuild', 'DBox2');
      else if (mon === 6 || mon === 7) stop = msg('NoWM', 'DBox2');
      else stop = msg('WMEOG', 'DBox1');
    } else if (barn === 0) {
      if (mon === 11 && p.animalsDied !== 1 && (p.cows > 0 || p.pigs > 0)) stop = animalsDie(ctx);
      else if (mon === 6) stop = msg('NoBarn', 'DBox1');
    }
  } else if (barn === 0 || wm === 0) {
    if (mon === 11 && p.animalsDied !== 1 && barn === 0) stop = animalsDie(ctx);
    else if (wm === 0) stop = msg('AfterTorn', neighborBox(year));
    else if (p.fence === 0 && p.toBuildFence !== 0) stop = msg('BuildFence', neighborBox(year));
  }
  if (!stop && year > 1880 && s.globals.fenceEvent === 0 && p.fence === 0 && p.toBuildFence === 0) {
    stop = checkFence(ctx);
    s.globals.fenceEvent = 1;
  }
  if (!stop && s.devcut?.enabled) stop = devcutMonthCheck(ctx); // [devcut] wooden fence (05 §3.12)
  return stop;
}

/** `CheckFence`: cattle trample unfenced mature crops every September. */
function checkFence(ctx: Ctx): Prompt | null {
  const s = ctx.s;
  const g = s.globals;
  const { year, mon } = s.date;
  if (!(mon === 9 && s.cursit.numHarved > 0 && g.mainView < 9)) return null;
  const text = year < 1883 ? 'NoFence1' : 'NoFence2';
  if (g.wasCows !== 1) {
    g.wasCows = 1;
    newTTalk(ctx, 220, 'TTalk6', year, mon, 0);
    townTalk(ctx);
    g.tTalk = s.ttalk.length;
  }
  g.type = 12;
  const lost = destroy(ctx);
  emit(ctx, { type: 'disaster', kind: 'cattle', squares: lost });
  return msg(text, neighborBox(year));
}

/** `Destroy()`: the first N mature squares become g_Type (12). */
export function destroy(ctx: Ctx): number {
  const c = ctx.s.cursit;
  if (c.numHarved === 1) return 0;
  const n = rand(ctx, DESTROIED[c.numHarved - 1]);
  let done = 0;
  for (let i = 0; i < 16 && done < n; i++) {
    if (c.harv[i] > 0) {
      c.harv[i] = ctx.s.globals.type;
      done++;
    }
  }
  c.numHarved -= n;
  return n;
}

// ---------------------------------------------------------------------------
// CheckMoneyLoan
// ---------------------------------------------------------------------------

export function hasUnsoldCrops(ctx: Ctx): boolean {
  const c = ctx.s.cursit;
  if (quirk(ctx, 'Q10')) return c.unsoldFlag > 0;
  return c.unsoldFlag > 0 || c.bushels.some((b) => b > 0);
}

/** Returns the money-crisis / loan-due message, or null. Also sets Count1 for NOM1. */
export function checkMoneyLoan(ctx: Ctx): Prompt | null {
  const s = ctx.s;
  const p = s.propet;
  const g = s.globals;
  const biz = p.business.reduce((a, b) => a + b, 0);
  if (p.cash + biz < p.lifePrice) {
    const dbox = quirk(ctx, 'Q8') ? 'DBox19' : neighborBox(s.date.year);
    if (p.savings > 0) return msg('NoM2', 'DBox0');
    // Remastered (Q10 + T1): no "sell your crops" advice while the 1894 strike blocks sales.
    const strike = s.date.year === 1894 && (s.date.mon === 6 || s.date.mon === 7) && !quirk(ctx, 'T1');
    if (hasUnsoldCrops(ctx) && !strike) return msg('NoM3', dbox);
    if (g.count1 === 0) {
      g.count1 = 1;
      return msg('NOM1', dbox, { onAck: 'nom1' });
    }
    if (p.loanAmount === 0 && s.cursit.firstHarv === 1) return msg('NoM4', dbox);
    return msg('NOM5', dbox, { onAck: 'nom5' });
  }
  if (p.loanDueYear === s.date.year && s.date.mon === 12) {
    if (p.cash + p.savings >= p.loanAmount) return msg('LoanRet', 'DBox8');
    return msg('LoanEnd', 'DBox8', { onAck: 'loanEnd' });
  }
  return null;
}

// ---------------------------------------------------------------------------
// SON2PLOT (law school payments)
// ---------------------------------------------------------------------------

export function son2Plot(ctx: Ctx) {
  const s = ctx.s;
  const p = s.propet;
  const { year, mon } = s.date;
  const inWindow = mon === 8 && year > 1906 && year < 1913;
  if (inWindow && p.cash + p.savings >= 600) {
    if (!quirk(ctx, 'Q2') && s.extra.son2PaidYear === year) return;
    s.extra.son2PaidYear = year;
    payCashThenSavings(ctx, 600, 'lawSchool');
  } else if (year === 1913 && mon === 2) {
    s.globals.son2Plot = 0;
    addEvent(ctx, '1913,3,0,7,AL25,0,Sig20,0,0,0,0,1');
  } else if (inWindow && p.cash + p.savings < 600) {
    addEvent(ctx, `${year},8,0,7,AL54,0,Sig20,0,0,-10,0,1`);
    changeLifePrice(ctx, 5, 'AL54');
    s.globals.son2Plot = 0;
  }
}

// ---------------------------------------------------------------------------
// CheckMainEvent + BusnessCheck
// ---------------------------------------------------------------------------

function findEvent(ctx: Ctx): number {
  const { year, mon } = ctx.s.date;
  return ctx.s.events.findIndex((l) => Number(l[0]) === year && Number(l[1]) === mon);
}

/** Sets g_MainEvent / g_MainLine for this month. */
export function checkMainEvent(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  const { year, mon } = s.date;
  const lookup = () => {
    const i = findEvent(ctx);
    if (i >= 0) {
      g.mainLine = i + 1;
      g.mainEvent = Number(s.events[i][3]);
    }
  };
  const retry = s.extra.goalRetry;
  if (retry && retry.year === year && retry.mon === mon) {
    s.extra.goalRetry = null;
    if (retry.goal === s.begin.goal) goalRetryCheck(ctx, retry.goal);
    if (g.mainEvent !== 8) lookup();
    return;
  }
  if (year === 1909 && mon === 6) businessCheck(ctx);
  else if (year === 1915 && mon === 6 && s.begin.goal === 3) {
    businessCheck(ctx);
    lookup();
  } else lookup();
}

const moneyTargetMet = (ctx: Ctx) => {
  const s = ctx.s;
  const goal = s.begin.goal;
  const target = goal >= 1 && goal <= 3 ? s.begin.targets[goal - 1] : Infinity;
  return s.propet.cash + s.propet.savings >= target;
};

function mayorSuccess(ctx: Ctx) {
  MAYOR_SUCCESS_EVENTS.forEach((l) => addEvent(ctx, l));
  ctx.s.ttalk.push({ year: 1915, month: 7, day: 1, id: 303, path: 'TTalk9' });
}

/** Goal conditions exactly as the original checks them (02 §6.7.4–6.7.6). */
export function farmerGoalMet(s: Ctx['s']): boolean {
  const p = s.propet;
  const sumGoal = p.boughtStove + p.keptDaughterInSchool + p.paidBigWedding;
  return p.tractors > 0 && sumGoal > 1 && p.cash + p.savings >= s.begin.targets[0];
}
export function businessGoalMet(s: Ctx['s']): boolean {
  const p = s.propet;
  const busn = p.business.filter((b) => b > 0).length;
  return p.numFields === 2 && p.tractors > 1 && p.car > 0 && p.cash + p.savings >= s.begin.targets[1] && busn > 2;
}
export function politicianGoalMet(s: Ctx['s']): boolean {
  const p = s.propet;
  const scr = p.cash + p.savings >= s.begin.targets[2];
  const busn = p.business.filter((b) => b > 0).length;
  return s.cursit.businessChecked === 1 ? p.score >= 90 && scr : p.car > 0 && p.score >= 90 && scr && busn > 0 && p.tractors > 0;
}

/** GOALRETRY assist: a failed goal check is re-checked once, a year later. */
export const GOAL_RETRY_DATES: Record<number, { year: number; mon: number }> = { 1: { year: 1903, mon: 8 }, 2: { year: 1910, mon: 6 }, 3: { year: 1916, mon: 6 } };
export const GOAL_CHECK_DATES: Record<number, { year: number; mon: number }> = { 1: { year: 1902, mon: 8 }, 2: { year: 1909, mon: 6 }, 3: { year: 1915, mon: 6 } };

/** Record a goal check's outcome and arm the retry when the assist is on. */
export function noteGoalResult(ctx: Ctx, goal: number, met: boolean, retry = false) {
  const s = ctx.s;
  s.extra.goalResults.push({ goal, year: s.date.year, mon: s.date.mon, met, retry });
  if (!met && !retry && s.assists.goalRetry) s.extra.goalRetry = { goal, ...GOAL_RETRY_DATES[goal] };
}

/** The retry check (same conditions; the success path is the original's, a year later). */
function goalRetryCheck(ctx: Ctx, goal: number) {
  const s = ctx.s;
  const p = s.propet;
  if (goal === 1 || goal === 2) {
    const met = goal === 1 ? farmerGoalMet(s) : businessGoalMet(s);
    noteGoalResult(ctx, goal, met, true);
    if (!met) return;
    const gp =
      goal === 1
        ? p.score >= 60 ? { text: 'Goal1', answers: [1, 2, 3, 4] } : { text: 'Goal2', answers: [1, 2, 4] }
        : p.score > 60 ? { text: 'Goal3', answers: [2, 3, 4] } : { text: 'Goal4', answers: [2, 4] };
    s.extra.goalPrompt = gp;
    s.globals.mainEvent = 8;
    s.globals.mainLine = 0;
    emit(ctx, { type: 'goalReached', text: gp.text, answers: gp.answers });
    return;
  }
  const met = politicianGoalMet(s);
  noteGoalResult(ctx, 3, met, true);
  if (!met) return;
  // The mayor path, one year later: letter, questionnaire, then the remaining three budgets.
  addEvent(ctx, '1916,6,0,7,ALM7,Had4,Sig6,0,0,0,0');
  addEvent(ctx, '1916,8,0,9');
  MAYOR_SUCCESS_EVENTS.slice(3).forEach((l) => addEvent(ctx, l));
  s.ttalk.push({ year: 1916, month: 7, day: 1, id: 303, path: 'TTalk9' });
}

/** `BusnessCheck` (June 1909 goal 2; June 1915 goal 3) and `CheckTwo`. */
export function businessCheck(ctx: Ctx) {
  const s = ctx.s;
  const p = s.propet;
  const { year, mon } = s.date;
  const scr = moneyTargetMet(ctx);
  const busn = p.business.filter((b) => b > 0).length;
  if (year === 1909 && mon === 6 && s.begin.goal === 2) {
    const met = p.numFields === 2 && p.tractors > 1 && p.car > 0 && scr && busn > 2;
    if (met) {
      s.extra.goalPrompt = p.score > 60 ? { text: 'Goal3', answers: [2, 3, 4] } : { text: 'Goal4', answers: [2, 4] };
      s.globals.mainEvent = 8;
      s.globals.mainLine = 0;
    }
    s.cursit.businessChecked = 1;
    noteGoalResult(ctx, 2, met);
  } else if (year === 1915 && mon === 6 && s.begin.goal === 3) {
    const ok =
      s.cursit.businessChecked === 1
        ? p.score >= 90 && scr
        : p.car > 0 && p.score >= 90 && scr && busn > 0 && p.tractors > 0;
    if (ok) mayorSuccess(ctx);
    else addEvent(ctx, MAYOR_FAIL_EVENT);
    noteGoalResult(ctx, 3, ok);
  }
}

export { msg };
