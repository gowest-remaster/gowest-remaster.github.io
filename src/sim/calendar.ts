// Calendar mechanics: BuildDate, WhatSeason, the month advance (CALEND ScoreScript 10),
// PREPARE + MainV (CALEND MovieScript 3), Init, town-talk lookup, 30-day NewDate helpers.
// docs/spec/02-farm-sim.md §3.4–§4.
import { changeCash, changeLifePrice, changeSavings, emit, neighborBox, quirk, rand, type Ctx } from './ctx.ts';
import { ALL_SEAS, LAND_VALUE, WHAT_SCORE_THRESHOLDS } from './data/tables.ts';
import { SQUARES, ldiv, zeros } from './state.ts';
import { recordMonth, snapshotOf } from './bookkeeping.ts';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

/** WhatSeason with explicit May/October threshold days. 2 summer, 1 winter, 0 workable. */
export function seasonOf(mon: number, day: number, mayThreshold: number, octThreshold: number): number {
  if ((mon === 5 && day >= mayThreshold) || (mon > 5 && mon < 9)) return 2;
  if ((mon === 10 && day >= octThreshold) || (mon > 0 && mon < 4) || mon > 10) return 1;
  return 0;
}

/** `WhatSeason()` (SHARED 3202): Random 1.2 for May, 2.2 for October; writes CurSit 4.5. */
export function whatSeason(ctx: Ctx) {
  const { date, random } = ctx.s;
  ctx.s.cursit.wintSum = seasonOf(date.mon, date.day, random.summerDay, random.winterDay);
}

/** Row of g_AllSeas for a year (g_Line). */
export function seasonRow(year: number): number {
  return year < 1886 || year > 1888 ? 0 : year - 1885;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function dateKey(year: number, mon: number) {
  return year * 100 + mon;
}

/** Roll month > 12 into the next year (Q5: the originals never do; unreachable in practice). */
function normalizeMonth(ctx: Ctx) {
  const d = ctx.s.date;
  while (d.mon > 12) {
    d.mon -= 12;
    d.year += 1;
  }
}

/** CALEND `NewDate(days)` (construction, NHelp, house build): 30-day months. */
export function calendNewDate(ctx: Ctx, days: number) {
  const d = ctx.s.date;
  const months = Math.trunc(days / 30);
  d.mon = d.mon + months;
  const rest = days - months * 30;
  if (rest + d.day < 31) d.day = rest + d.day;
  else {
    d.mon += 1;
    d.day = rest + d.day - 30;
  }
  normalizeMonth(ctx);
}

/** Pure FIELD `NewDate(days)` arithmetic: 30-day months, day 0 becomes 30, year rolled (Q5). */
export function addFieldDays(date: { year: number; mon: number; day: number }, days: number) {
  let mon = date.mon + Math.trunc((days + date.day - 1) / 30);
  let day = date.day + days <= 30 ? date.day + days : date.day + days - Math.trunc((days + date.day) / 30) * 30;
  if (day === 0) day = 30;
  let year = date.year;
  while (mon > 12) {
    mon -= 12;
    year += 1;
  }
  return { year, mon, day };
}

/** FIELD `NewDate(days)`: 30-day months, day 0 becomes 30. */
export function fieldNewDate(ctx: Ctx, days: number) {
  const d = ctx.s.date;
  const n = addFieldDays(d, days);
  d.year = n.year;
  d.mon = n.mon;
  d.day = n.day;
}

/**
 * Advance the date by `days` for a non-calendar action (field work, construction, NHelp,
 * house build). Q4: in classic no month bookkeeping runs; remastered runs it for every
 * month boundary crossed.
 */
export function advanceDays(ctx: Ctx, days: number, kind: 'calend' | 'field', reason: string) {
  const d = ctx.s.date;
  const from = dateKey(d.year, d.mon);
  if (kind === 'calend') calendNewDate(ctx, days);
  else fieldNewDate(ctx, days);
  // TRIVKEEP: an open trivia card lasts until the month changes.
  if (dateKey(d.year, d.mon) !== from) ctx.s.extra.triviaOpen = false;
  emit(ctx, { type: 'dateChanged', year: d.year, mon: d.mon, day: d.day, reason });
  return from;
}

/**
 * Classic Q4: months crossed by a days-action get no bookkeeping, but the remake's history still
 * gets one row per month (current values), so ledger charts have no holes. No rule effect.
 */
export function recordSkippedMonths(ctx: Ctx, fromKey: number) {
  const s = ctx.s;
  let y = Math.trunc(fromKey / 100);
  let m = fromKey % 100;
  while (dateKey(y, m) < dateKey(s.date.year, s.date.mon)) {
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
    s.extra.history.push({ ...snapshotOf(s), year: y, mon: m });
    s.extra.monthTally = { soldBushels: 0, grainIncome: 0 };
  }
}

/** Remastered Q4 fix: run month bookkeeping for every month crossed since `fromKey`. */
export function catchUpMonths(ctx: Ctx, fromKey: number) {
  if (quirk(ctx, 'Q4')) return recordSkippedMonths(ctx, fromKey);
  const d = ctx.s.date;
  const target = { year: d.year, mon: d.mon, day: d.day };
  let y = Math.trunc(fromKey / 100);
  let m = fromKey % 100;
  while (dateKey(y, m) < dateKey(target.year, target.mon)) {
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
    const isLast = y === target.year && m === target.mon;
    d.year = y;
    d.mon = m;
    d.day = isLast ? target.day : 1;
    monthBookkeeping(ctx, m === 1);
  }
  d.lastStopMonth = d.mon;
}

// ---------------------------------------------------------------------------
// BuildDate + month advance
// ---------------------------------------------------------------------------

function rerollInterest(ctx: Ctx) {
  ctx.s.interest = 2 + rand(ctx, 5);
}

function updateLand(ctx: Ctx) {
  const v = LAND_VALUE.get(ctx.s.date.year);
  if (v !== undefined) {
    ctx.s.propet.landValue = v;
    ctx.s.propet.landQuality = rand(ctx, 3) - 1;
  }
}

/** `BuildDate()`: next month, random day, January interest re-roll, season, land value. */
export function buildDate(ctx: Ctx) {
  const d = ctx.s.date;
  d.mon += 1;
  d.day = d.mon === 2 ? rand(ctx, 28) : rand(ctx, 30);
  if (d.mon === 13) {
    d.mon = 1;
    d.year += 1;
    rerollInterest(ctx);
  }
  whatSeason(ctx);
  updateLand(ctx);
}

/** Steps 2..6 of the month advance (everything after BuildDate). */
function afterBuildDate(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  const c = s.cursit;
  const mon = s.date.mon;
  if (mon === 3 || mon === 8) {
    c.workNow = 0;
    g.workNow1 = 0;
  } else if (mon === 6 || mon === 11) {
    c.neighborDebt += c.workNow + g.workNow1;
    if (c.goodwill === 1) c.goodwill = 2;
    else if (c.goodwill === 2) c.goodwill = 0;
  }
  g.aprilSept = 1;
  g.trivia = 0;
  s.extra.triviaOpen = false;
  g.trivRand = rand(ctx, 10);
  g.mainEvent = 0;
  g.wasEvent = 0;
  g.mail = 0;
  g.wasTTalk = 0;
  g.fenceEvent = 0;
  prepare(ctx);
  g.whatScore = 0;
  if (s.begin.goal === 3) {
    for (const [t, lvl] of WHAT_SCORE_THRESHOLDS)
      if (s.propet.score >= t) {
        g.whatScore = lvl;
        break;
      }
  }
  if (mon === 1 && (s.date.year === 1881 || !quirk(ctx, 'Q11'))) s.propet.animalsDied = 0;
  recordMonth(s);
}

/** Frame 17 enterFrame (ScoreScript 10): the month advance. */
export function monthAdvance(ctx: Ctx) {
  const s = ctx.s;
  s.date.day = 0;
  buildDate(ctx);
  emit(ctx, { type: 'monthAdvanced', year: s.date.year, mon: s.date.mon, day: s.date.day });
  afterBuildDate(ctx);
}

/** Remastered Q4: bookkeeping for a month reached by a days-action (no day re-roll). */
function monthBookkeeping(ctx: Ctx, january: boolean) {
  if (january) rerollInterest(ctx);
  whatSeason(ctx);
  updateLand(ctx);
  emit(ctx, { type: 'monthAdvanced', year: ctx.s.date.year, mon: ctx.s.date.mon, day: ctx.s.date.day });
  afterBuildDate(ctx);
  if (ctx.s.globals.grassH > 0) {
    // the disaster message is normally shown by EndDate; show it now
    ctx.s.globals.grassH = 0;
    queueDisasterMessage(ctx);
  }
}

/** Disaster message (EndDate frame -> Mes). Text was chosen by MainV. */
export function queueDisasterMessage(ctx: Ctx) {
  const s = ctx.s;
  const text = s.globals.mainView === 9 ? 'Fire' : s.globals.mainView === 10 ? 'Rep' : 'GrH';
  const dbox = neighborBox(s.date.year);
  s.pending = { kind: 'message', text, dbox, next: s.pending };
  emit(ctx, { type: 'prompt', prompt: s.pending });
}

// ---------------------------------------------------------------------------
// Init, field visuals
// ---------------------------------------------------------------------------

/** `Init()` (CALEND MovieScript 2): wipe the field, deadline, and (Q12) unsold grain. */
export function init(ctx: Ctx) {
  const c = ctx.s.cursit;
  c.plow = zeros(SQUARES);
  c.plant = zeros(SQUARES);
  c.harv = zeros(SQUARES);
  c.numPlowed = 0;
  c.numPlanted = 0;
  c.numHarved = 0;
  c.unsoldFlag = 0;
  c.deadlineYear = 0;
  c.deadlineMonth = 0;
  if (quirk(ctx, 'Q12')) {
    c.harvestValue = 0;
    c.harvestBushels = 0;
    c.churchLetter = 0;
    c.bushels = [0, 0, 0, 0];
  }
}

/** `FieldStat()` (SHARED 3202). */
export function fieldStat(ctx: Ctx) {
  const { globals: g, cursit: c, date } = ctx.s;
  const season4 = [4, 5, 9, 10].includes(date.mon);
  let v = 0;
  if (g.type === 12 && c.numHarved > 0) v = 4;
  else if (g.mainView === 9) v = -1;
  else if (c.numHarved > 0 && season4) v = 3;
  else if (c.numPlanted > 0) v = season4 ? 1 : 2;
  else if (c.numPlowed > 0 && g.mainView > 3) v = 1;
  else if (g.mainView === 1 || g.mainView === 2) v = -1;
  g.fieldStat = v;
}

/** `BarnHouse()` (SHARED 3202). */
export function barnHouse(ctx: Ctx) {
  const { globals: g, propet: p } = ctx.s;
  if (g.mainView === 2) {
    g.barnStat = p.barn === 3 ? 4 : 2;
    if (p.house > 0) g.houseStat = g.whatHouse === 3 ? 4 : g.whatHouse > 0 ? 2 : g.houseStat;
  } else {
    if (p.barn === 3 || g.mainView === 10) g.barnStat = 3;
    else if (p.barn > 0) g.barnStat = 1;
    if (p.house > 0) g.houseStat = g.whatHouse === 3 ? 3 : g.whatHouse > 0 ? 1 : g.houseStat;
  }
}

/** `FenWMill`: a bought windmill is placed automatically when there is no working main one. */
export function fenWMill(ctx: Ctx) {
  const p = ctx.s.propet;
  if (p.windmill === 0 && p.extraWindmills > 0) {
    p.windmill = 1;
    p.extraWindmills -= 1;
  }
}

// ---------------------------------------------------------------------------
// MainV + PREPARE
// ---------------------------------------------------------------------------

/** `MainV()`: LifePrice decreases, scene choice and September disasters (02 §4.2). */
export function mainV(ctx: Ctx) {
  const s = ctx.s;
  const { year, mon } = s.date;
  const g = s.globals;
  const c = s.cursit;
  const p = s.propet;
  const line = seasonRow(year);
  if (mon === 7 && (year === 1890 || year === 1898)) changeLifePrice(ctx, -0.5, 'pricesFell', true);
  else if (mon === 7 && (year === 1900 || year === 1907)) changeLifePrice(ctx, -1, 'pricesFell', true);
  const seas = ALL_SEAS[line][mon];
  const dev5 = Math.trunc(year / 5) * 5;
  const dev8 = Math.trunc(year / 8) * 8;
  // Lingo `and` short-circuits: random(2) is drawn only in September.
  if (mon === 10 && c.wintSum === 1) {
    g.mainView = 1;
  } else if (mon === 9 && year === dev5 + rand(ctx, 2) - 1 && year > 1880 && c.numHarved > 0 && g.grassH === 0) {
    g.grassH = 1;
    g.wasEvent = 1;
    init(ctx);
    c.harv = new Array(SQUARES).fill(13);
    c.numHarved = 0;
    g.mainView = 9;
    emit(ctx, { type: 'disaster', kind: 'fire' });
  } else if (mon === 9 && year === dev8 + rand(ctx, 2) - 1 && year > 1880 && p.barn === 1 && p.windmill === 1 && seas !== 7) {
    g.grassH = 1;
    g.mainView = 10;
    p.toBuildBarn = 1;
    p.toBuildWindmill = 1;
    p.windmill = 2;
    p.barn = 3;
    emit(ctx, { type: 'disaster', kind: 'tornado' });
  } else if (mon === 9 && g.mainView !== 7 && year > 1884 && year < 1890 && g.grassH === 0 && c.numHarved > 0 && seas !== 7) {
    g.grassH = 1;
    g.wasEvent = 1;
    init(ctx);
    c.numHarved = 0;
    c.harv = new Array(SQUARES).fill(14);
    g.mainView = 11;
    emit(ctx, { type: 'disaster', kind: 'grasshoppers' });
  } else {
    g.mainView = seas;
    if (line === 0 && (mon === 1 || mon === 12)) g.mainView = rand(ctx, 2);
    else if (line === 0 && mon === 8) g.mainView = rand(ctx, 2) + 4;
  }
  emit(ctx, { type: 'scene', mainView: g.mainView });
}

/** `PREPARE()` (CALEND MovieScript 3), once per month advance. */
export function prepare(ctx: Ctx) {
  const s = ctx.s;
  const { year, mon } = s.date;
  const c = s.cursit;
  const p = s.propet;
  mainV(ctx);
  fieldStat(ctx);
  barnHouse(ctx);
  fenWMill(ctx);
  // crop maturity
  if (mon > 5 && mon < 8 && c.numHarved === 0 && c.numPlanted > 0) {
    c.numHarved = c.numPlanted;
    c.harv = [...c.plant];
  }
  if (mon > 10 && c.numHarved === 0 && c.numPlanted > 0) {
    c.numHarved = c.numPlanted;
    c.harv = [...c.plant];
  } else if (mon > 10 && c.numPlanted === 0 && c.numPlowed > 0) {
    init(ctx);
  }
  // harvest deadline
  if (year === c.deadlineYear && mon > c.deadlineMonth) init(ctx);
  // January re-rolls
  if (mon === 1) {
    const r = s.random;
    r.summerDay = 16 + rand(ctx, 9);
    r.winterDay = 13 + rand(ctx, 12);
    r.elevatorBonus = 15 + rand(ctx, 10);
    r.transport = 50 + rand(ctx, 50);
    if (p.loanAmount > 0) rand(ctx, 5); // yearly loan interest computed and discarded (T17)
  }
  fieldStat(ctx);
  // monthly cash
  const biz = p.business.reduce((a, b) => a + b, 0);
  const delta = biz - p.lifePrice;
  if (delta < 0 && p.cash + delta < 0 && !quirk(ctx, 'Q1')) {
    // Remastered Q1: take the shortfall from savings first.
    const shortfall = -(p.cash + delta);
    const fromSavings = Math.min(shortfall, Math.max(0, p.savings));
    if (fromSavings > 0) changeSavings(ctx, -fromSavings, 'livingCost');
    changeCash(ctx, delta + fromSavings, 'livingCost');
  } else {
    changeCash(ctx, delta, 'livingCost');
  }
}

// ---------------------------------------------------------------------------
// Town talk lookup (TOWNTALK, CALEND MovieScript 5) and the Start-frame reset
// ---------------------------------------------------------------------------

export function townTalk(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  g.tTalk = 0;
  let day = 0;
  for (let i = 0; i < s.ttalk.length; i++) {
    const t = s.ttalk[i];
    if (t.year === s.date.year && t.month === s.date.mon) {
      g.tTalk = i + 1;
      g.blinkTTalk = 1;
      g.wasTTalk = 0;
      day = t.day;
      g.tTalkPath = t.path;
      g.tTalkName = t.id;
      emit(ctx, { type: 'townTalkAvailable', index: i + 1, id: t.id, path: t.path });
      break;
    }
  }
  if (g.tTalk > 0 && day > 0) s.date.day = day;
  else if (s.date.year === 1893 && s.date.mon === 9) s.date.day = 15 + rand(ctx, 15);
}

/** `NewTTalk(id, path, year, mon, day)`: append a dynamic town talk. */
export function newTTalk(ctx: Ctx, id: number, path: string, year: number, month: number, day: number) {
  ctx.s.ttalk.push({ year, month, day, id, path });
  ctx.s.globals.tTalkPath = path;
  ctx.s.globals.tTalkName = id;
}

/** `Ret()`: remember the month at the last calendar stop (CurSeason item 5). */
export function ret(ctx: Ctx) {
  ctx.s.date.lastStopMonth = ctx.s.date.mon;
}

/** `integer(n*LifePrice/30)` living cost of n days (Lingo integer division semantics). */
export function livingCostOfDays(lifePrice: number, days: number) {
  const v = ldiv(days * lifePrice, 30);
  return Number.isInteger(v) ? v : Math.round(v);
}

