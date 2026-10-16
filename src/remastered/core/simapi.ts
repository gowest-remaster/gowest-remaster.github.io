// Read-only queries the Remastered UI needs (docs/design/remastered-ux.md §9.3), as pure
// functions of GameState. They mirror the sim's own rules and never commit anything: where a
// rule is easiest to ask the sim itself, we dispatch on the state and throw the result away
// (dispatch never mutates its input). Where src/sim/query.ts has the rule (runway, goal
// checklist, field estimates), these shape its answer for the UI.
import { simDispatch } from './dispatch.ts';
import {
  BUSINESSES, CATALOG, CLAIM, CONSTRUCTION_DAYS, LAND_VALUE, LIVESTOCK_PRICES, YIELD_CORN, YIELD_OATS, YIELD_WHEAT, type CatalogName,
} from '../../sim/data/tables.ts';
import {
  buildableItems, businessForSale, canRepay, claimAvailable, describeReject, dispatch, grainQuote, livestockMarketOpen, loanCap, loanRepayment, mySpeed,
  reproduces, type Command, type Crop, type EventChoice, type GameState, type Helpers, type SimEvent,
  goalChecklist as simGoalChecklist, runway as simRunway, plowEstimate as simPlowEstimate, harvestEstimate as simHarvestEstimate,
} from '../../sim/index.ts';
import { GOAL_CHECK, money, monthName, monthsBetween } from './format.ts';

// ---------------------------------------------------------------------------
// Peek helpers
// ---------------------------------------------------------------------------

/**
 * Dry run of a command (nothing is applied). States are immutable (every dispatch returns a
 * new object), so results are cached per state object: the HUD, badges and panels ask the
 * same questions many times per update.
 */
const peekCache = new WeakMap<GameState, Map<string, ReturnType<typeof simDispatch>>>();
export function peek(s: GameState, cmd: Command) {
  let m = peekCache.get(s);
  if (!m) peekCache.set(s, (m = new Map()));
  const k = JSON.stringify(cmd);
  let r = m.get(k);
  if (!r) m.set(k, (r = simDispatch(s, cmd)));
  return r;
}

const dialogsOf = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'dialog' }> => e.type === 'dialog');
const rejectsOf = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'rejected' }> => e.type === 'rejected');

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export type Verb = 'plow' | 'plant' | 'harvest';
export interface VerbStatus {
  ok: boolean;
  /** original dialog id explaining a refusal (NoPlow3, NoPlant5, NoHarv1, NoM2…) */
  dialog?: string;
  /** short new-UI reason line */
  reason?: string;
}

const REASONS: Record<string, string> = {
  NoPlow1: 'Every square is already plowed.',
  NoPlow3: 'Ground is frozen: plowing resumes in April.',
  NoPlow4: 'Too hot and dry to plow until September.',
  NoPlow5: 'Harvest your ripe crop first.',
  NoPlant1: 'You have no seed. Buy some at the General Store.',
  NoPlant2: 'Plow some squares first.',
  NoPlant3: 'Plow some squares first, in spring or autumn.',
  NoPlant4: 'Harvest your ripe crop first.',
  NoPlant5: 'Your seed is out of season. Spring crops go in Apr–Jun, winter wheat Sep–Nov.',
  NoPlant6: 'Not a planting month. Plant in spring (Apr–Jun) or autumn (Sep–Nov).',
  NoPlant7: 'Every plowed square is already planted.',
  NoHarv1: 'Your crop is still growing.',
  NoHarv2: 'Nothing is planted yet.',
  NoHarv3: 'Nothing to harvest: plow and plant first.',
  StopHarv2: 'Too cold to harvest now.',
  NoM1: 'You are out of cash.',
  NoM2: 'You are out of cash. Fetch some from the savings box.',
  NoM3: 'You are out of cash. Sell your grain at the elevator.',
  NoM4: 'You are out of cash. The bank may lend you some.',
  NoM6: 'You are out of cash.',
};

export function fieldStatus(s: GameState): Record<Verb, VerbStatus> {
  const one = (cmd: Command, okReject: string): VerbStatus => {
    const r = peek(s, cmd);
    const d = dialogsOf(r.events)[0];
    if (d) return { ok: false, dialog: d.id, reason: d.id === 'NoHarv1' && s.cursit.numHarved + s.cursit.numPlanted > 0 ? `${cropState(s).line}.` : REASONS[d.id] ?? undefined };
    const rj = rejectsOf(r.events)[0];
    // never show a raw reject id ("calendarRunning"): every reject has player copy
    if (rj && rj.reason !== okReject) return { ok: false, reason: rj.reason === 'promptPending' ? 'Answer the letter first.' : describeReject(rj.reason).text };
    return { ok: true };
  };
  return {
    plow: one({ type: 'plow', squares: [] }, 'noSquaresSelected'),
    plant: one({ type: 'plant', plantings: [] }, 'nothingPlanted'),
    harvest: one({ type: 'harvest', helpers: { workers: 99, neighbors: 0, family: 0 } }, 'invalidHelpers'),
  };
}

export type SquareStage = 'prairie' | 'plowed' | 'planted' | 'sprout' | 'growing' | 'ripe' | 'stubble' | 'burnt' | 'trampled' | 'eaten' | 'frost';
export interface SquareInfo {
  /** 1-based */
  n: number;
  stage: SquareStage;
  crop: Crop | 0;
  growth: number;
  plowed: boolean;
  planted: boolean;
  ripe: boolean;
  /** owned (field 2 squares exist only after the 1909 claim) */
  owned: boolean;
}

export function squares(s: GameState): SquareInfo[] {
  const c = s.cursit;
  const { mon } = s.date;
  const winter = mon === 12 || mon <= 3;
  const out: SquareInfo[] = [];
  for (let i = 0; i < 16; i++) {
    const plow = c.plow[i];
    const plant = c.plant[i] as Crop | 0;
    const harv = c.harv[i];
    let stage: SquareStage = 'prairie';
    let growth = 0;
    if (harv === 13) stage = 'burnt';
    else if (harv === 14) stage = 'eaten';
    else if (harv === 12) stage = 'trampled';
    else if (harv === 15 || plow === 15) stage = 'frost';
    else if (harv >= 1 && harv <= 4) {
      stage = 'ripe';
      growth = 1;
    } else if (plant > 0) {
      const spring = c.deadlineMonth === 10;
      const start = spring ? 4 : 9;
      const end = spring ? 6 : 11;
      const m = !spring && mon < 6 ? mon + 12 : mon;
      growth = Math.max(0, Math.min(1, (m + s.date.day / 30 - start) / (end - start)));
      stage = winter ? 'planted' : growth < 0.15 ? 'planted' : growth < 0.5 ? 'sprout' : 'growing';
    } else if (plow === 1) stage = 'plowed';
    out.push({ n: i + 1, stage, crop: (harv >= 1 && harv <= 4 ? harv : plant) as Crop | 0, growth, plowed: plow === 1, planted: plant > 0, ripe: harv >= 1 && harv <= 4, owned: i < 8 * s.propet.numFields });
  }
  return out;
}

/** Can this crop be sown this month? (02 §5.4) */
export function sowable(s: GameState, crop: Crop): boolean {
  const m = s.date.mon;
  if ([12, 1, 2, 3, 7, 8].includes(m)) return false;
  return crop === 1 ? !(m >= 4 && m <= 7) : !(m < 4 || m > 7);
}
export const SOW_WINDOW: Record<Crop, string> = { 1: 'Sep–Nov', 2: 'Apr–Jun', 3: 'Apr–Jun', 4: 'Apr–Jun' };

/** FIELD NewDate arithmetic (30-day months, day 0 → 30) from a date, without mutating. */
export function addFieldDays(d: { year: number; mon: number; day: number }, days: number) {
  let mon = d.mon + Math.trunc((days + d.day - 1) / 30);
  let day = d.day + days <= 30 ? d.day + days : d.day + days - Math.trunc((days + d.day) / 30) * 30;
  if (day === 0) day = 30;
  let year = d.year;
  while (mon > 12) {
    mon -= 12;
    year++;
  }
  return { year, mon, day };
}
/** CALEND NewDate (construction, neighbor help). */
function addCalendDays(d: { year: number; mon: number; day: number }, days: number) {
  const months = Math.trunc(days / 30);
  let mon = d.mon + months;
  const rest = days - months * 30;
  let day: number;
  if (rest + d.day < 31) day = rest + d.day;
  else {
    mon += 1;
    day = rest + d.day - 30;
  }
  let year = d.year;
  while (mon > 12) {
    mon -= 12;
    year++;
  }
  return { year, mon, day };
}

export interface JobEstimate {
  squares: number;
  daysPerSquare: number;
  days: number;
  finish: { year: number; mon: number; day: number };
  wage: number;
  wages: number;
  monthsCrossed: number;
  /** crew size beyond which adding someone gives no speed (integer division) */
  noFasterAt: number | null;
  /** for each extra helper count 0..8: days per square */
  perCrew: number[];
  /** work may be stopped by heat (May) or frost (Oct) */
  weatherRisk: 'summer' | 'frost' | null;
  /** neighbors' help owed after the job (the debt meter) */
  debtAfter: number;
  affordable: boolean;
  tractor: boolean;
}

export function jobEstimate(s: GameState, kind: Verb, nSquares: number, h: Helpers, squaresList?: number[]): JobEstimate {
  const mine = jobEstimateLocal(s, kind, nSquares, h);
  try {
    const e = kind === 'harvest' ? simHarvestEstimate(s, h) : squaresList ? simPlowEstimate(s, squaresList, h) : null;
    if (!e) return mine;
    return { ...mine, days: e.days, daysPerSquare: e.daysPerSquare, finish: e.finish, monthsCrossed: e.monthsCrossed, wage: e.wagePerDay ?? mine.wage, wages: e.wages ?? mine.wages, affordable: e.affordable ?? mine.affordable, weatherRisk: e.mayHitThreshold ? (e.finish.mon >= 9 || s.date.mon >= 9 ? 'frost' : 'summer') : null };
  } catch {
    return mine;
  }
}

function jobEstimateLocal(s: GameState, kind: Verb, nSquares: number, h: Helpers): JobEstimate {
  const tractors = s.propet.tractors;
  const speed = mySpeed(tractors, h);
  const days = Math.max(1, nSquares * speed);
  const finish = addFieldDays(s.date, days);
  const wage = s.sessions.field?.wage ?? 5;
  const crew = h.workers + h.neighbors + h.family;
  const base = tractors > 0 ? 2 : 6;
  const perCrew = Array.from({ length: 9 }, (_, k) => Math.trunc(base / (k + 1)));
  let noFasterAt: number | null = null;
  for (let k = 1; k < perCrew.length; k++) if (perCrew[k] === perCrew[k - 1] && perCrew[k] > 0) { noFasterAt = k - 1; break; }
  if (perCrew[crew] === 0) noFasterAt = Math.min(noFasterAt ?? crew, perCrew.findIndex((v) => v === 0) - 1);
  let weatherRisk: JobEstimate['weatherRisk'] = null;
  if ((finish.mon === 5 && finish.day >= 16) || (s.date.mon <= 5 && finish.mon >= 6 && finish.mon <= 8)) weatherRisk = 'summer';
  if ((finish.mon === 10 && finish.day >= 13) || (s.date.mon <= 10 && finish.mon >= 11)) weatherRisk = 'frost';
  const wages = h.workers * wage * days;
  const owedNow = s.cursit.neighborDebt;
  const used = kind === 'harvest' ? Math.max(s.globals.workNow1, h.neighbors) + s.cursit.workNow : Math.max(s.cursit.workNow, h.neighbors) + s.globals.workNow1;
  return {
    squares: nSquares,
    daysPerSquare: speed,
    days,
    finish,
    wage,
    wages,
    monthsCrossed: monthsBetween(s.date.year, s.date.mon, finish.year, finish.mon),
    noFasterAt,
    perCrew,
    weatherRisk,
    debtAfter: owedNow + used,
    affordable: h.workers === 0 || s.propet.cash >= wages,
    tractor: tractors > 0,
  };
}

export interface BuildEstimate {
  days: number;
  cost: number;
  finish: { year: number; mon: number; day: number };
  base: number;
  canBuildNow: boolean;
  reason?: string;
}
export function buildEstimate(s: GameState, item: keyof typeof CONSTRUCTION_DAYS, h: Helpers): BuildEstimate {
  const base = CONSTRUCTION_DAYS[item];
  const days = Math.max(1, Math.trunc(base / (h.workers + h.neighbors + h.family + 1)));
  const cost = h.workers * 5;
  const m = s.date.mon;
  const season = m >= 3 && m <= 10;
  return {
    days,
    cost,
    base,
    finish: addCalendDays(s.date, days),
    canBuildNow: season && cost <= s.propet.cash && buildableItems(s).includes(item),
    reason: !season ? 'Too cold to build until March.' : cost > s.propet.cash ? 'Not enough cash for those workers.' : undefined,
  };
}

// ---------------------------------------------------------------------------
// Yields and prices
// ---------------------------------------------------------------------------

const tableFor = (crop: Crop) => (crop <= 2 ? YIELD_WHEAT : crop === 3 ? YIELD_OATS : YIELD_CORN);

/** Expected bushel range for planted (or ripe) squares: B/A × 20 × {0.85,1.15} × {0.8,1.2}. */
export function yieldOutlook(s: GameState, extra?: { crop: Crop; squares: number }) {
  const counts = [0, 0, 0, 0];
  for (const q of squares(s)) if ((q.planted || q.ripe) && q.crop) counts[q.crop - 1]++;
  if (extra) counts[extra.crop - 1] += extra.squares;
  const year = s.date.year;
  return counts
    .map((n, i) => {
      const crop = (i + 1) as Crop;
      const ba = tableFor(crop).get(year)?.ba ?? 0;
      return { crop, squares: n, min: Math.round(ba * 20 * n * 0.85 * 0.8), max: Math.round(ba * 20 * n * 1.15 * 1.2), perAcre: ba };
    })
    .filter((r) => r.squares > 0);
}

/** Price per bushel for past years (≤ current), per crop. Classic Q15 rounds to whole dollars. */
export function priceHistory(s: GameState) {
  const round = reproduces(s.fidelity, 'Q15');
  const q24 = reproduces(s.fidelity, 'Q24');
  const rows: { year: number; wheat: number; oats: number; corn: number }[] = [];
  for (let y = 1880; y <= s.date.year; y++) {
    const w = YIELD_WHEAT.get(y);
    const o = YIELD_OATS.get(y);
    const c = YIELD_CORN.get(y);
    if (!w || !o || !c) continue;
    const r = (v: number) => (round ? Math.round(v) : v);
    rows.push({ year: y, wheat: r(w.pb), oats: r(o.pb), corn: r(q24 ? c.pb : c.pbIntended) });
  }
  return rows;
}

export function seedPrice(year: number, crop: Crop) {
  return Math.round((tableFor(crop).get(year)?.ba ?? 0) * 0.1 * 100) / 100;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface Runway {
  upkeep: number;
  business: number;
  net: number;
  cashMonths: number;
  savingsMonths: number;
  months: number;
  infinite: boolean;
  level: 'ok' | 'low' | 'danger';
}
export function runway(s: GameState): Runway {
  try {
    const r = simRunway(s);
    const inf = !Number.isFinite(r.cashMonths);
    return { upkeep: r.upkeep, business: r.businessIncome, net: -r.net, cashMonths: inf ? Infinity : r.cashMonths, savingsMonths: r.savingsMonths, months: inf ? Infinity : r.totalMonths, infinite: inf, level: r.crisis ? 'danger' : r.low ? 'danger' : r.totalMonths < 4 ? 'low' : 'ok' };
  } catch {
    return runwayLocal(s);
  }
}
function runwayLocal(s: GameState): Runway {
  const p = s.propet;
  const business = p.business.reduce((a, b) => a + b, 0);
  const net = p.lifePrice - business;
  if (net <= 0) return { upkeep: p.lifePrice, business, net, cashMonths: Infinity, savingsMonths: Infinity, months: Infinity, infinite: true, level: 'ok' };
  const cashMonths = Math.floor(p.cash / net);
  const savingsMonths = Math.floor(p.savings / net);
  const months = Math.floor((p.cash + p.savings) / net);
  return { upkeep: p.lifePrice, business, net, cashMonths, savingsMonths, months, infinite: false, level: cashMonths < 1 && months < 2 ? 'danger' : months < 3 ? 'low' : 'ok' };
}

export function loanSchedule(amount: number, rate: number, years: number) {
  return Array.from({ length: years + 1 }, (_, k) => loanRepayment(amount, rate, k));
}

export function loanInfo(s: GameState) {
  const p = s.propet;
  return {
    has: p.loanAmount > 0,
    due: p.loanAmount,
    dueYear: p.loanDueYear,
    years: s.loanYears,
    canRepay: canRepay(s),
    cap: loanCap(s),
    rate: s.interest,
    eligible: p.loanAmount <= 0 && s.cursit.firstHarv === 1,
    needsHarvest: s.cursit.firstHarv !== 1,
    monthsLeft: p.loanAmount > 0 ? monthsBetween(s.date.year, s.date.mon, p.loanDueYear, 12) : 0,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const CATALOG_INFO: Record<CatalogName, { label: string; does: string }> = {
  windMill: { label: 'Windmill', does: 'Water for the farm. Installs itself if you have no working well; extras are spares for after a storm.' },
  wireFence: { label: 'Barbed wire fence', does: 'Keeps stray cattle out of your crops every September.' },
  kodakCamera: { label: 'Kodak camera', does: 'Adds 12 more photographs to choose from in the family album (17 in all).' },
  tractor: { label: 'Steam tractor', does: 'Plow and harvest at 2 days a square instead of 6.' },
  car: { label: 'Automobile', does: 'A Model T for the family. Businesspeople and politicians need one.' },
};

export function isNewArrival(s: GameState, name: CatalogName) {
  const c = CATALOG.find((x) => x.name === name);
  if (!c || c.year === 0) return false;
  const since = monthsBetween(c.year, c.month, s.date.year, s.date.mon);
  return since >= 0 && since < 2;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalReq {
  label: string;
  met: boolean;
  value?: number;
  target?: number;
  hint?: string;
}
export interface Milestone {
  key: 'stove' | 'school' | 'wedding';
  state: 'earned' | 'missed' | 'upcoming';
  revealed: boolean;
  label: string;
}
export interface GoalChecklist {
  goal: number;
  check: { year: number; mon: number };
  monthsLeft: number;
  reqs: GoalReq[];
  milestones: Milestone[] | null;
  progress: number;
}

const passed = (s: GameState, y: number, m: number) => s.date.year > y || (s.date.year === y && s.date.mon > m);
const reached = (s: GameState, y: number, m: number) => s.date.year > y || (s.date.year === y && s.date.mon >= m);

export function goalChecklist(s: GameState): GoalChecklist {
  const mine = goalChecklistLocal(s);
  try {
    const g = simGoalChecklist(s);
    if (!g) return mine;
    const hints: Record<string, string> = { tractor: 'Steam tractors arrive in the catalogue in April 1887.', tractors: 'Steam tractors arrive in the catalogue in April 1887.', claim: 'The land office offers 160 free acres from April 1909.', car: 'Cars arrive in the catalogue in April 1909.', businesses: 'Businesses go up for sale on Main Street from 1895.', business: 'Businesses go up for sale on Main Street from 1895.' };
    const reqs = g.requirements.map((r) => ({ label: r.id === 'money' ? `Cash + savings at least ${money(r.target)}` : r.label, met: r.met, value: r.value, target: r.target, hint: hints[r.id] }));
    const parts = reqs.map((r) => (r.met ? 1 : r.target ? Math.max(0, Math.min(1, (r.value ?? 0) / r.target)) : 0));
    return {
      goal: g.goal,
      check: { year: g.checkDate.year, mon: g.checkDate.mon },
      monthsLeft: g.monthsLeft,
      reqs,
      milestones: g.goal === 1 ? g.milestones.map((m) => ({ key: m.id, state: m.state, revealed: m.revealed, label: m.label.replace(/\.$/, '') })) : null,
      progress: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0,
    };
  } catch {
    return mine;
  }
}

function goalChecklistLocal(s: GameState): GoalChecklist {
  const p = s.propet;
  const goal = s.begin.goal || 1;
  const check = GOAL_CHECK[goal] ?? GOAL_CHECK[1];
  const total = p.cash + p.savings;
  const target = s.begin.targets[goal - 1] ?? 1000;
  const busn = p.business.filter((b) => b > 0).length;
  const reqs: GoalReq[] = [];
  let milestones: Milestone[] | null = null;
  const moneyReq: GoalReq = { label: `Cash + savings at least ${money(target)}`, met: total >= target, value: total, target };
  if (goal === 1) {
    const firstDoc = s.events.find((l) => Number(l[3]) === 4);
    const docY = firstDoc ? Number(firstDoc[0]) : 1882;
    const docM = firstDoc ? Number(firstDoc[1]) : 3;
    const lastDoc = [...s.events].reverse().find((l) => Number(l[3]) === 4);
    const lastDocY = lastDoc ? Number(lastDoc[0]) : 1889;
    milestones = [
      { key: 'stove', state: p.boughtStove ? 'earned' : passed(s, lastDocY, 3) ? 'missed' : 'upcoming', revealed: reached(s, docY, docM), label: 'Buy the cooking stove when the doctor visits' },
      { key: 'school', state: p.keptDaughterInSchool ? 'earned' : passed(s, 1888, 3) ? 'missed' : 'upcoming', revealed: reached(s, 1888, 3), label: 'Keep your daughter in school (1888)' },
      { key: 'wedding', state: p.paidBigWedding ? 'earned' : passed(s, 1902, 6) ? 'missed' : 'upcoming', revealed: reached(s, 1902, 6), label: 'Give your son a grand town-square wedding (1902)' },
    ];
    const earned = milestones.filter((m) => m.state === 'earned').length;
    reqs.push({ label: 'Own a tractor', met: p.tractors > 0, value: p.tractors, target: 1, hint: 'Steam tractors arrive in the catalogue in 1887.' });
    reqs.push(moneyReq);
    reqs.push({ label: 'Family milestones: 2 of 3', met: earned >= 2, value: earned, target: 2 });
  } else if (goal === 2) {
    reqs.push({ label: 'A second claim (Land Office, 1909)', met: p.numFields === 2, hint: 'The land office offers 160 free acres from April 1909.' });
    reqs.push({ label: 'Two or more tractors', met: p.tractors > 1, value: p.tractors, target: 2 });
    reqs.push({ label: 'An automobile', met: p.car > 0, hint: 'Cars arrive in the catalogue in April 1909.' });
    reqs.push(moneyReq);
    reqs.push({ label: 'Three or more businesses', met: busn > 2, value: busn, target: 3, hint: 'Businesses go up for sale on Main Street from 1895.' });
  } else {
    if (s.cursit.businessChecked === 1) {
      reqs.push({ label: 'Standing ★ 90 or more', met: p.score >= 90, value: p.score, target: 90 });
      reqs.push(moneyReq);
    } else {
      reqs.push({ label: 'An automobile', met: p.car > 0 });
      reqs.push({ label: 'Standing ★ 90 or more', met: p.score >= 90, value: p.score, target: 90 });
      reqs.push(moneyReq);
      reqs.push({ label: 'At least one business', met: busn > 0, value: busn, target: 1 });
      reqs.push({ label: 'At least one tractor', met: p.tractors > 0, value: p.tractors, target: 1 });
    }
  }
  const parts = reqs.map((r) => (r.met ? 1 : r.value !== undefined && r.target ? Math.max(0, Math.min(1, r.value / r.target)) : 0));
  const progress = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { goal, check, monthsLeft: monthsBetween(s.date.year, s.date.mon, check.year, check.mon), reqs, milestones, progress };
}

// ---------------------------------------------------------------------------
// Choice previews (consequence chips)
// ---------------------------------------------------------------------------

export interface Effects {
  money: number;
  cash: number;
  savings: number;
  score: number;
  upkeep: number;
  helpers: number;
  bank: number;
  followUp: boolean;
  /** the sim answered "not enough money" */
  refused: boolean;
}

export function preview(s: GameState, cmd: Command): Effects {
  const r = dispatch(s, cmd);
  const a = s.propet;
  const b = r.state.propet;
  return {
    money: b.cash + b.savings - (a.cash + a.savings),
    cash: b.cash - a.cash,
    savings: b.savings - a.savings,
    score: b.score - a.score,
    upkeep: b.lifePrice - a.lifePrice,
    helpers: b.familyWorkers - a.familyWorkers,
    bank: r.state.myRecieve - s.myRecieve,
    followUp: r.state.events.length > s.events.length,
    refused: r.state.pending?.kind === 'message' && r.state.pending.text === 'NoM',
  };
}
export const choicePreview = (s: GameState, choice: EventChoice) => preview(s, { type: 'resolveEvent', choice });

// ---------------------------------------------------------------------------
// Almanac
// ---------------------------------------------------------------------------

export interface AlmanacPin {
  year: number;
  mon: number;
  text: string;
  kind: 'deadline' | 'loan' | 'window' | 'goal' | 'build' | 'fair' | 'business';
  urgent?: boolean;
  go?: string;
}

export function almanacPins(s: GameState): AlmanacPin[] {
  const pins: AlmanacPin[] = [];
  const c = s.cursit;
  const p = s.propet;
  const { year, mon } = s.date;
  if (c.deadlineYear) pins.push({ year: c.deadlineYear, mon: c.deadlineMonth, text: `Harvest by the end of ${monthName(c.deadlineMonth)} ${c.deadlineYear}`, kind: 'deadline', urgent: monthsBetween(year, mon, c.deadlineYear, c.deadlineMonth) <= 1, go: 'field' });
  if (c.numPlowed > 0 && c.numPlanted === 0 && mon <= 11) pins.push({ year, mon: 11, text: 'Unplanted plowed land goes back to grass in November', kind: 'deadline', go: 'field' });
  if (reproduces(s.fidelity, 'Q12') && c.bushels.some((b) => b > 0) && c.deadlineYear) pins.push({ year: c.deadlineYear, mon: c.deadlineMonth, text: 'Unsold grain spoils at the harvest deadline', kind: 'deadline', urgent: true, go: 'elevator' });
  if (p.loanAmount > 0) pins.push({ year: p.loanDueYear, mon: 12, text: `Loan of ${money(p.loanAmount, { cents: true })} due December ${p.loanDueYear}`, kind: 'loan', urgent: monthsBetween(year, mon, p.loanDueYear, 12) <= 3, go: 'bank' });
  if (p.barn === 1 && year >= 1880) {
    const fy = mon <= 5 ? year : year + 1;
    if (fy > 1880) pins.push({ year: fy, mon: 4, text: 'Livestock fair, April & May', kind: 'fair', go: 'pen' });
  }
  if (buildableItems(s).length) pins.push({ year: mon <= 10 ? year : year + 1, mon: mon >= 3 && mon <= 10 ? mon : 3, text: 'Building season, March–October', kind: 'build', go: 'homestead' });
  BUSINESSES.forEach((b, i) => {
    if (p.business[i] > 0) return;
    const y0 = b.startYear;
    if (year < y0 - 1 || year > y0 + 1) return;
    if (year === y0 + 1 && mon >= 4) return;
    pins.push({ year: y0, mon: 4, text: `${b.id} for sale, April ${y0} – March ${y0 + 1} (${money(b.price)})`, kind: 'business', go: 'street' });
  });
  if (p.numFields === 1 && (year === CLAIM.year || year === CLAIM.year - 1 || (year === CLAIM.year + 1 && mon < 4))) pins.push({ year: CLAIM.year, mon: 4, text: 'Land office: 160 free acres, April 1909 – March 1910', kind: 'window', go: 'street' });
  const g = GOAL_CHECK[s.begin.goal];
  if (g && monthsBetween(year, mon, g.year, g.mon) >= 0) pins.push({ year: g.year, mon: g.mon, text: `Your goal is checked in ${monthName(g.mon)} ${g.year}`, kind: 'goal', go: 'goals' });
  return pins.sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon));
}

/** Season state per month (for the ribbon): 0 workable, 1 winter, 2 summer, 3 = edge month. */
export function monthStates() {
  return [1, 1, 1, 0, 3, 2, 2, 2, 0, 3, 1, 1];
}

// ---------------------------------------------------------------------------
// Today suggestions (new UI copy; "you can", never "you should")
// ---------------------------------------------------------------------------

export interface Suggestion {
  id: string;
  text: string;
  go?: string;
  action?: string;
  priority: number;
}

export function todaySuggestions(s: GameState): Suggestion[] {
  const out: Suggestion[] = [];
  const g = s.globals;
  const c = s.cursit;
  const p = s.propet;
  const { year, mon } = s.date;
  if (s.pending) out.push({ id: 'letter', text: 'A letter is waiting for your answer.', action: 'letter', priority: 100 });
  if (year === 1880 && mon === 4 && g.firstTT !== 1 && g.houseStat === 0) out.push({ id: 'hello', text: 'Your new neighbors are gathered on Main Street. Say hello to Longview.', go: 'street', priority: 95 });
  else if (g.houseStat === 0) out.push({ id: 'sod', text: 'Press Advance: the neighbors will raise your sod house.', action: 'advance', priority: 94 });
  if (g.mail > 0) out.push({ id: 'mail', text: 'The mailbox flag is up.', action: 'mail', priority: 90 });
  if (s.extra.triviaOpen) out.push({ id: 'trivia', text: 'Answer the trivia card on your porch to win money (optional).', action: 'trivia', priority: 55 });
  if (g.tTalk > 0 && g.blinkTTalk === 1 && !(year === 1880 && mon === 4 && g.firstTT !== 1)) out.push({ id: 'talk', text: 'Townsfolk are talking on Main Street.', go: 'street', priority: 60 });
  const builds = buildableItems(s);
  if (builds.length && g.houseStat !== 0) {
    const names = builds.map((b) => (b === 'windmill' ? 'well & windmill' : b === 'house' ? 'sod house' : b)).join(', ');
    out.push({ id: 'build', text: mon >= 3 && mon <= 10 ? `You can build: ${names}.` : `Build ${names} when spring comes (from March).`, action: 'build', priority: year === 1880 ? 85 : 65 });
  }
  if (g.houseStat !== 0) {
    const st = fieldStatus(s);
    const sq = squares(s);
    const nOwned = 8 * p.numFields;
    const plowedFree = sq.filter((q) => q.plowed && !q.planted && q.owned).length;
    const seedSquares = Math.floor(p.seeds.reduce((a, b) => a + b, 0) / 20);
    const crop = cropState(s);
    if (crop.phase === 'harvest' && st.harvest.ok) out.push({ id: 'harvest', text: `Your crop is ripe: ${c.numHarved} ${c.numHarved === 1 ? 'square' : 'squares'} ready to harvest.`, go: 'field', priority: 88 });
    else if (c.numHarved > 0) out.push({ id: 'ripe', text: `${crop.line}.`, go: 'field', priority: 40 });
    if (plowedFree > 0 && st.plant.ok && seedSquares > 0) out.push({ id: 'plant', text: `${plowedFree} plowed ${plowedFree === 1 ? 'square is' : 'squares are'} ready to plant.`, go: 'field', priority: 80 });
    else if (plowedFree > 0 && seedSquares === 0 && [4, 5, 6, 9, 10, 11].includes(mon)) out.push({ id: 'seed', text: `${plowedFree} plowed ${plowedFree === 1 ? 'square needs' : 'squares need'} seed. The General Store sells it in sacks.`, go: 'store', priority: 82 });
    if (st.plow.ok && c.plow.slice(0, nOwned).filter((v) => v === 1).length < nOwned && c.numHarved === 0) {
      const end = mon <= 5 ? 'late May' : 'late October';
      out.push({ id: 'plow', text: `Plowing season until ${end}.`, go: 'field', priority: 75 });
    }
  }
  const sell = c.bushels.reduce((a, b) => a + b, 0);
  if (sell > 0) {
    const q = grainQuote(s);
    out.push({ id: 'sell', text: `${sell.toLocaleString('en-US')} bushels waiting to sell (about ${money(q.localTotal)}).`, go: 'elevator', priority: 78 });
  }
  if (s.myRecieve > 0) out.push({ id: 'bank', text: `${money(s.myRecieve, { cents: true })} is waiting for you at the bank.`, go: 'bank', priority: 77 });
  if (livestockMarketOpen(s)) out.push({ id: 'fair', text: 'The livestock fair is open this month.', go: 'pen', priority: 30 });
  const biz = businessForSale(s);
  if (biz) out.push({ id: 'biz', text: `${BUSINESSES[biz - 1].id} is for sale on Main Street.`, go: 'street', priority: 45 });
  if (claimAvailable(s)) out.push({ id: 'claim', text: 'The land office offers a second claim of 160 acres.', go: 'street', priority: 50 });
  const rw = runway(s);
  if (!rw.infinite && rw.level !== 'ok' && g.houseStat !== 0) out.push({ id: 'money', text: rw.cashMonths < 1 ? 'Cash is almost gone. Move money from the savings box, sell grain, or visit the bank.' : `Money is tight: about ${rw.months} months of upkeep left.`, go: p.savings > 0 ? 'house' : 'bank', priority: 92 });
  const li = loanInfo(s);
  if (li.has && li.monthsLeft <= 12) out.push({ id: 'loan', text: `Your loan of ${money(li.due, { cents: true })} is due in December ${li.dueYear}.`, go: 'bank', priority: li.monthsLeft <= 3 ? 91 : 55 });
  const owe = Math.min(3, c.neighborDebt + c.workNow + g.workNow1);
  if (owe >= 3 && !s.pending) out.push({ id: 'owe', text: `You owe your neighbors help. Next ${mon >= 4 && mon < 9 ? 'September' : 'April'}, one will ask you for 7–10 days: say yes to stay friends.`, priority: 35 });
  return out.sort((a, b) => b.priority - a.priority);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function landValue(year: number) {
  return LAND_VALUE.get(year) ?? 0;
}
export function livestockRow(year: number) {
  return LIVESTOCK_PRICES.get(year) ?? LIVESTOCK_PRICES.get(1880)!;
}
export function netWorth(s: GameState) {
  const p = s.propet;
  const row = livestockRow(s.date.year);
  return p.cash + p.savings + landValue(s.date.year) * p.numFields + p.horses * row.horse + p.pigs * row.pig + p.cows * row.cow + p.tractors * 400 - p.loanAmount + s.myRecieve;
}

// ---------------------------------------------------------------------------
// The savings box, in one honest sentence (docs/spec/04-home-album.md §3; sim house.ts, ctx.ts)
// ---------------------------------------------------------------------------

/** What the box does under these rules: set aside, counted in goals, never spent at the counter. */
export function savingsRule(s: GameState): string {
  const upkeep = reproduces(s.fidelity, 'Q1') ? '' : ' upkeep,';
  return `Money in the savings box is set aside at home: it counts toward your goals like cash and earns no interest, but the store, the bank, the land office and hired hands take cash only, so it can't be spent by mistake. If your cash runs short,${upkeep} letters that cost money and house upgrades are paid from the box.`;
}

/** A "why use it" nudge when there's a lot of loose cash (null when not useful). */
export function savingsHint(s: GameState): string | null {
  const p = s.propet;
  const year = Math.max(p.lifePrice * 12, 1);
  if (p.cash < year + 300 || p.savings > p.cash) return null;
  return `You have more cash than a year of upkeep (${money(year)}). Put what you won't need before next harvest in the box, so it's still there when you want it.`;
}

// ---------------------------------------------------------------------------
// The crop, in one voice: hotbar badge, pill, field verbs and square tips all read this
// ---------------------------------------------------------------------------

export interface CropState {
  /** none: nothing planted · growing: not ready · waiting: ripe but harvest opens later · harvest: harvest now */
  phase: 'none' | 'growing' | 'waiting' | 'harvest';
  /** one short line ("Ripe: harvest now", "Growing: harvest from April") */
  line: string;
  /** label for a square of this crop in this phase */
  square: string;
}

const HARVEST_MONTHS = [4, 5, 9, 10];

export function cropState(s: GameState): CropState {
  const c = s.cursit;
  const mon = s.date.mon;
  const winter = mon >= 11 || mon <= 3;
  if (c.numHarved > 0 && HARVEST_MONTHS.includes(mon) && c.wintSum !== 1) return { phase: 'harvest', line: 'Ripe: harvest now', square: 'ripe, harvest now' };
  if (c.numHarved > 0 && winter) return { phase: 'growing', line: 'Winter wheat is resting under the snow: harvest from April', square: 'growing, harvest from April' };
  if (c.numHarved > 0 && c.wintSum === 1) return { phase: 'waiting', line: 'Too cold to harvest now', square: 'ripe, too cold to harvest' };
  if (c.numHarved > 0) return { phase: 'waiting', line: 'Ripe, but harvest opens September 1', square: 'ripe, harvest from September 1' };
  if (c.numPlanted > 0) {
    const spring = c.deadlineMonth === 10;
    return { phase: 'growing', line: spring ? 'Growing: ripens in June, harvest from September' : 'Growing: ripens before winter, harvest next April', square: spring ? 'growing, ripens in June' : 'growing, harvest next April' };
  }
  return { phase: 'none', line: 'Nothing planted', square: '' };
}
