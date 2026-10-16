// Read-only queries for the Remastered UI (docs/design/remastered-ux.md §9.3). Every function
// here is a pure function of GameState: no RNG is drawn and nothing is mutated. Status queries
// mirror the command ladders exactly, and are tested with the invariant
// "status says OK <=> the command does not reject".
import { reproduces, type QuirkId } from './fidelity.ts';
import { addFieldDays, seasonOf } from './calendar.ts';
import { mySpeed, NO_HELPERS, type Helpers } from './field.ts';
import { grainQuote } from './town.ts';
import { businessForSale, claimAvailable } from './town.ts';
import { canRepay, loanInfo, loanRepayment } from './bank.ts';
import { livestockMarketOpen, buildableItems } from './farm.ts';
import { houseUpgradeOffer } from './house.ts';
import { goalProgress } from './album.ts';
import { dispatch } from './commands.ts';
import { effectsBetween, promptTextId } from './bookkeeping.ts';
import { doctorListItems, type EventChoice } from './events.ts';
import { businessGoalMet, farmerGoalMet, GOAL_CHECK_DATES, GOAL_RETRY_DATES, politicianGoalMet } from './rules.ts';
import { BUSINESSES, CATALOG, CLAIM, DEALERS, GRAIN_PRICE_MAX, GRAIN_PRICE_MIN, YIELD_CORN, YIELD_OATS, YIELD_WHEAT, type CatalogName } from './data/tables.ts';
import { lingoInt, monthIndex, type Crop, type Effects, type GameState, type Prompt } from './state.ts';

const q = (s: GameState, id: QuirkId) => reproduces(s.fidelity, id);
const SEASON_MONTHS = [4, 5, 9, 10];
export interface MonthRef {
  year: number;
  mon: number;
}
const after = (a: MonthRef, b: MonthRef) => monthIndex(a.year, a.mon) > monthIndex(b.year, b.mon);
const addMonths = (r: MonthRef, n: number): MonthRef => {
  const k = monthIndex(r.year, r.mon) + n;
  return { year: Math.floor(k / 12), mon: (k % 12) + 1 };
};
const monthsBetween = (a: MonthRef, b: MonthRef) => monthIndex(b.year, b.mon) - monthIndex(a.year, a.mon);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** CurSit 4.5 the field commands will see: recomputed by enterField when no visit is open. */
export function fieldWintSum(s: GameState): number {
  if (s.sessions.field) return s.cursit.wintSum;
  const { mon, day } = s.date;
  const r = s.random;
  return q(s, 'Q14') ? seasonOf(mon, day, r.winterDay, r.winterDay) : seasonOf(mon, day, r.summerDay, r.winterDay);
}

/** Money-crisis advice code FIELD `CheckMoney` would show (no $100 side effect). */
function fieldMoneyCode(s: GameState): number {
  if (s.propet.savings > 0) return 2;
  if (hasUnsold(s)) return 3;
  if (s.globals.count1 === 0) return 1;
  if (s.propet.loanAmount === 0) return 4;
  return 6;
}
function hasUnsold(s: GameState): boolean {
  const c = s.cursit;
  if (q(s, 'Q10')) return c.unsoldFlag > 0;
  return c.unsoldFlag > 0 || c.bushels.some((b) => b > 0);
}

/** The wage and neighbours of the current (or, with VISITROLL, this month's) field visit; null if not rolled yet. */
export function fieldVisit(s: GameState): { wage: number; neighbors: number } | null {
  if (s.sessions.field) return { wage: s.sessions.field.wage, neighbors: s.sessions.field.neighbors };
  const vr = s.extra?.visitRolls;
  if (!q(s, 'VISITROLL') && vr && vr.key === s.date.year * 100 + s.date.mon && vr.field)
    return { wage: vr.field.wage, neighbors: s.cursit.goodwill > 0 ? 0 : vr.field.neighbors };
  return null;
}

// ---------------------------------------------------------------------------
// 3. fieldActionStatus
// ---------------------------------------------------------------------------

/** `ok`, or the dialog the command would show instead (`NoPlow5`, `NoM2`, ...) / a reject reason. */
export type ActionStatus = { ok: true } | { ok: false; dialog?: string; reason?: string };
const OK: ActionStatus = { ok: true };
const no = (dialog: string): ActionStatus => ({ ok: false, dialog });
const noReason = (reason: string): ActionStatus => ({ ok: false, reason });

export interface FieldActionStatus {
  plow: ActionStatus;
  plant: ActionStatus;
  harvest: ActionStatus;
  /** squares (1-based) that can be plowed now */
  plowable: number[];
  /** squares (1-based) that can be planted now, and the crops that can go in them */
  plantable: number[];
  plantableCrops: Crop[];
  /** mature squares waiting for harvest */
  ripe: number;
}

/** 02 §5.3–5.5 ladders, without the CheckMoney $100 gift. */
export function fieldActionStatus(s: GameState): FieldActionStatus {
  const c = s.cursit;
  const p = s.propet;
  const { mon } = s.date;
  const wint = fieldWintSum(s);
  const nSquares = 8 * p.numFields;
  const plowable = Array.from({ length: nSquares }, (_, i) => i + 1).filter((sq) => c.plow[sq - 1] === 0);

  let plow: ActionStatus = OK;
  if (SEASON_MONTHS.includes(mon) && wint === 0) {
    if (c.numHarved > 0) plow = no('NoPlow5');
    else if (c.plow.slice(0, nSquares).filter((v) => v === 1).length >= nSquares) plow = no('NoPlow1');
  } else if (p.cash <= 0) plow = no(`NoM${fieldMoneyCode(s)}`);
  else if (wint > 0) plow = no(`NoPlow${2 + wint}`);
  if (plow.ok && plowable.length === 0) plow = noReason('noSquaresSelected');

  // plant
  const hasSeed = p.seeds.some((x) => x > 0);
  let code = 0;
  if (c.numHarved > 0) code = 4;
  else if (c.numPlowed === 0) code = mon >= 4 && mon <= 6 ? 2 : 3;
  else if ([12, 1, 2, 3, 7, 8].includes(mon)) code = 6;
  else if (c.numPlanted === c.numPlowed) code = 7;
  else if (!hasSeed) code = 1;
  else if ((mon >= 4 && mon <= 6 && p.seeds[1] + p.seeds[2] + p.seeds[3] === 0) || (mon >= 8 && mon <= 10 && p.seeds[0] === 0)) code = 5;
  const plantable = Array.from({ length: nSquares }, (_, i) => i).filter((i) => c.plow[i] > 0 && c.plow[i] < 10 && c.plant[i] === 0).map((i) => i + 1);
  const plantableCrops = ([1, 2, 3, 4] as Crop[]).filter((crop) => (crop === 1 ? !(mon >= 4 && mon <= 7) : !(mon < 4 || mon > 7)) && p.seeds[crop - 1] >= 20);
  let plant: ActionStatus = code ? no(`NoPlant${code}`) : OK;
  if (plant.ok && (plantable.length === 0 || plantableCrops.length === 0)) plant = noReason('nothingPlanted');

  // harvest
  let harvest: ActionStatus = OK;
  if (!SEASON_MONTHS.includes(mon)) harvest = no(c.numPlanted > 0 ? 'NoHarv1' : 'NoHarv2');
  else if (wint === 1) harvest = no('StopHarv2');
  else if (c.numHarved === 0) harvest = no(c.numPlanted > 0 ? 'NoHarv1' : c.numPlowed > 0 ? 'NoHarv2' : 'NoHarv3');
  else if (p.cash <= 0) harvest = no(`NoM${fieldMoneyCode(s)}`);
  const ripe = c.harv.filter((v) => v > 0 && v < 10).length;
  return { plow, plant, harvest, plowable, plantable, plantableCrops, ripe };
}

// ---------------------------------------------------------------------------
// 4. plowEstimate / harvestEstimate
// ---------------------------------------------------------------------------

export interface JobEstimate {
  squares: number;
  /** days per square (integer division, 02 §5.2) */
  daysPerSquare: number;
  /** total days without interruptions */
  days: number;
  start: { year: number; mon: number; day: number };
  finish: { year: number; mon: number; day: number };
  /** month boundaries crossed */
  monthsCrossed: number;
  /** hired-worker wages, or null when the visit's wage is not rolled yet (enter the field first) */
  wages: number | null;
  wagePerDay: number | null;
  /** cash check the command makes before starting (false = OneWor/ManyWor) */
  affordable: boolean | null;
  /** the job's date range reaches the summer (May 17-25) or frost (Oct 14-25) window */
  mayHitThreshold: boolean;
  /**
   * Days per square with k extra helpers, k = 0..8 beyond the current team, so the UI can grey
   * out sliders that make no difference ("no faster than 3 helpers").
   */
  marginal: { extraHelpers: number; daysPerSquare: number; faster: boolean }[];
}

function estimate(s: GameState, n: number, h: Helpers, minOneDayForWages: boolean, wagesCheckMin1: boolean): JobEstimate {
  const speed = mySpeed(s.propet.tractors, h);
  let finish = { year: s.date.year, mon: s.date.mon, day: s.date.day };
  for (let i = 0; i < n; i++) finish = addFieldDays(finish, speed);
  if (speed < 1 && n > 0) finish = addFieldDays(finish, 1);
  const days = n * speed;
  const visit = fieldVisit(s);
  const wagePerDay = visit?.wage ?? null;
  const wageDays = minOneDayForWages ? Math.max(1, days) : days;
  const wages = wagePerDay === null ? null : h.workers * wagePerDay * wageDays;
  const checkDays = wagesCheckMin1 ? Math.max(1, days) : 0;
  const affordable = wagePerDay === null ? null : !(h.workers > 0 && h.workers * wagePerDay * checkDays > s.propet.cash);
  const team = h.workers + h.neighbors + h.family + 1;
  const base = s.propet.tractors > 0 ? 2 : 6;
  const marginal = Array.from({ length: 9 }, (_, k) => {
    const d = Math.trunc(base / (team + k));
    const prev = Math.trunc(base / (team + k - 1));
    return { extraHelpers: k, daysPerSquare: d, faster: k === 0 ? false : d < prev };
  });
  const start = { ...s.date };
  // Overlap of [start, finish] with the summer window (May 17 - Jun 30) or frost window (Oct 14 - Nov 30).
  const dk = (y: number, m: number, d: number) => monthIndex(y, m) * 31 + d;
  const a = dk(start.year, start.mon, start.day);
  const b = dk(finish.year, finish.mon, finish.day);
  const zones = [
    [dk(start.year, 5, 17), dk(start.year, 6, 30)],
    [dk(start.year, 10, 14), dk(start.year, 11, 30)],
  ];
  const mayHitThreshold = n > 0 && zones.some(([z0, z1]) => a <= z1 && b >= z0);
  return {
    squares: n,
    daysPerSquare: speed,
    days,
    start: { year: start.year, mon: start.mon, day: start.day },
    finish,
    monthsCrossed: monthsBetween(start, finish),
    wages,
    wagePerDay,
    affordable,
    mayHitThreshold,
    marginal,
  };
}

/** Plow job card numbers for `squares` (1-based; already-plowed squares are ignored, as by `plow`). */
export function plowEstimate(s: GameState, squares: number[], helpers: Helpers = NO_HELPERS): JobEstimate {
  const nSquares = 8 * s.propet.numFields;
  const n = new Set(squares.filter((sq) => sq >= 1 && sq <= nSquares && s.cursit.plow[sq - 1] === 0)).size;
  // plow: wages use max(1, time); the pre-check uses max(1, estTime) and always applies.
  const e = estimate(s, n, helpers, true, true);
  return e;
}

/** Harvest job card numbers (all ripe squares are harvested). */
export function harvestEstimate(s: GameState, helpers: Helpers = NO_HELPERS): JobEstimate {
  const n = s.cursit.harv.filter((v) => v > 0 && v < 10).length;
  // harvest: wages use the raw time (0 days -> $0); the Q18 pre-check (remastered only) uses max(1, ..).
  const e = estimate(s, n, helpers, false, true);
  if (q(s, 'Q18') && e.affordable !== null) e.affordable = true;
  return e;
}

// ---------------------------------------------------------------------------
// 5. yieldOutlook
// ---------------------------------------------------------------------------

export interface YieldOutlook {
  /** year whose yield table applies (the harvest year) */
  year: number;
  crops: { crop: Crop; squares: number; min: number; max: number }[];
  min: number;
  max: number;
}

function bushelsFor(ba: number, count: number, land: number, index: number) {
  let bu = ba;
  if (land === 0) bu -= (bu * 15) / 100;
  else if (land === 2) bu += (bu * 15) / 100;
  const b = lingoInt(bu * count * 20);
  return b + Math.trunc((b * index) / 100);
}

/** Expected bushel range for what is planted or ripe: B/A x land {0.85..1.15} x luck {0.8..1.2}. Never the roll. */
export function yieldOutlook(s: GameState): YieldOutlook {
  const c = s.cursit;
  const counts = [0, 0, 0, 0];
  const ripe = c.harv.some((v) => v >= 1 && v <= 4);
  const src = ripe ? c.harv : c.plant;
  for (const v of src) if (v >= 1 && v <= 4) counts[v - 1]++;
  const year = c.deadlineYear > 0 ? c.deadlineYear : s.date.year;
  const table = (crop: number) => (crop <= 2 ? YIELD_WHEAT : crop === 3 ? YIELD_OATS : YIELD_CORN).get(year) ?? (crop <= 2 ? YIELD_WHEAT : crop === 3 ? YIELD_OATS : YIELD_CORN).get(1920)!;
  const crops = ([1, 2, 3, 4] as Crop[])
    .filter((crop) => counts[crop - 1] > 0)
    .map((crop) => {
      const ba = table(crop).ba;
      return { crop, squares: counts[crop - 1], min: bushelsFor(ba, counts[crop - 1], 0, -20), max: bushelsFor(ba, counts[crop - 1], 2, 20) };
    });
  return { year, crops, min: sum(crops.map((x) => x.min)), max: sum(crops.map((x) => x.max)) };
}

// ---------------------------------------------------------------------------
// 6. priceHistory
// ---------------------------------------------------------------------------

export interface PriceRow {
  year: number;
  /** harvest price per bushel [winter wheat (centre of its +/-10% range), spring wheat, oats, corn] */
  harvest: [number, number, number, number];
  /** what the local elevator paid for that harvest price (dealer adjustment and $0.20..$2.50 clamp) */
  elevator: [number, number, number, number];
}

/**
 * Past harvest prices per crop (1880 .. last year). The current year's price stays hidden until
 * you harvest (remastered-ux §5.2); pass `includeCurrent` to add it anyway. Classic applies the
 * same Q15 whole-dollar rounding the harvest does.
 */
export function priceHistory(s: GameState, opts: { includeCurrent?: boolean } = {}): PriceRow[] {
  const last = opts.includeCurrent ? s.date.year : s.date.year - 1;
  const round = q(s, 'Q15') ? (x: number) => Math.round(x) : (x: number) => Math.round(x * 100) / 100;
  const rows: PriceRow[] = [];
  for (let year = 1880; year <= last; year++) {
    const w = YIELD_WHEAT.get(year);
    const o = YIELD_OATS.get(year);
    const cr = YIELD_CORN.get(year);
    if (!w || !o || !cr) continue;
    const corn = q(s, 'Q24') ? cr.pb : cr.pbIntended;
    const harvest = [w.pb, w.pb, o.pb, corn].map(round) as PriceRow['harvest'];
    const idx = DEALERS.find((d) => year >= d.y0 && year <= d.y1)?.idx ?? 0;
    const elevator = harvest.map((p0) => {
      const p = p0 >= 0.4 ? p0 + (idx * p0) / 100 : p0;
      return Math.round(Math.min(GRAIN_PRICE_MAX, Math.max(GRAIN_PRICE_MIN, p)) * 100) / 100;
    }) as PriceRow['elevator'];
    rows.push({ year, harvest, elevator });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 7. loanSchedule
// ---------------------------------------------------------------------------

/** Year-by-year value of a loan with annual compounding (year 0 = the amount borrowed). */
export function loanSchedule(amount: number, ratePct: number, years: number): { year: number; owed: number; interest: number }[] {
  return Array.from({ length: Math.max(0, Math.trunc(years)) + 1 }, (_, k) => {
    const owed = loanRepayment(amount, ratePct, k);
    return { year: k, owed, interest: owed - amount };
  });
}

// ---------------------------------------------------------------------------
// 2. runway
// ---------------------------------------------------------------------------

export interface Runway {
  /** monthly cost of living (LifePrice) */
  upkeep: number;
  businessIncome: number;
  /** businessIncome - upkeep (negative = burning money) */
  net: number;
  /** month advances before cash alone fails the money check (Infinity when net >= 0) */
  cashMonths: number;
  /** extra months the savings box covers at the same burn (0 when net >= 0) */
  savingsMonths: number;
  totalMonths: number;
  /** the money check would stop the calendar this month (cash + businesses < upkeep) */
  crisis: boolean;
  /** fewer than 2 months covered (the HUD turns red) */
  low: boolean;
}

/** HUD runway gauge, with `checkMoneyLoan`'s arithmetic (crisis when cash + businesses < LifePrice). */
export function runway(s: GameState): Runway {
  const p = s.propet;
  const biz = sum(p.business);
  const upkeep = p.lifePrice;
  const net = biz - upkeep;
  const crisis = p.cash + biz < upkeep;
  const burn = -net;
  let cashMonths: number;
  if (crisis) cashMonths = 0;
  else if (burn <= 0) cashMonths = Infinity;
  else cashMonths = Math.floor((p.cash + biz - upkeep) / burn) + 1;
  const savingsMonths = burn > 0 ? Math.floor(Math.max(0, p.savings) / burn) : 0;
  const totalMonths = cashMonths + savingsMonths;
  return { upkeep, businessIncome: biz, net, cashMonths, savingsMonths, totalMonths, crisis, low: totalMonths < 2 };
}

// ---------------------------------------------------------------------------
// 8. goalChecklist
// ---------------------------------------------------------------------------

export interface Requirement {
  id: string;
  label: string;
  met: boolean;
  value: number;
  target: number;
}
export type MilestoneState = 'earned' | 'missed' | 'upcoming';
export interface Milestone {
  id: 'stove' | 'school' | 'wedding';
  state: MilestoneState;
  /** the milestone's moment has come, so its description can be shown */
  revealed: boolean;
  /** description (only meaningful when revealed) */
  label: string;
}
export interface GoalChecklist {
  goal: number;
  checkDate: MonthRef;
  /** GOALRETRY assist second chance, when armed or possible */
  retryDate: MonthRef | null;
  monthsLeft: number;
  /** 'upcoming' before the check; then 'met' / 'missed' from the recorded result */
  status: 'upcoming' | 'met' | 'missed' | 'retryPending';
  requirements: Requirement[];
  /** Farmer only: the three family milestones (need 2 of 3) */
  milestones: Milestone[];
  /** the rules' own verdict if the check ran today (equals every requirement met) */
  metNow: boolean;
  /** goal page bar (goalProgress) */
  progress: { money: number; score: number };
}

const MILESTONES: { id: Milestone['id']; first: MonthRef; last: MonthRef; label: string; flag: 'boughtStove' | 'keptDaughterInSchool' | 'paidBigWedding' }[] = [
  { id: 'stove', first: { year: 1882, mon: 3 }, last: { year: 1889, mon: 3 }, label: 'Buy the cooking stove when the doctor visits.', flag: 'boughtStove' },
  { id: 'school', first: { year: 1888, mon: 3 }, last: { year: 1888, mon: 3 }, label: 'Keep your daughter in school in 1888.', flag: 'keptDaughterInSchool' },
  { id: 'wedding', first: { year: 1902, mon: 6 }, last: { year: 1902, mon: 6 }, label: 'Give your child the town-square wedding.', flag: 'paidBigWedding' },
];

export function goalChecklist(s: GameState): GoalChecklist | null {
  const goal = s.begin.goal;
  if (goal < 1 || goal > 3) return null;
  const p = s.propet;
  const money = p.cash + p.savings;
  const target = s.begin.targets[goal - 1];
  const busn = p.business.filter((b) => b > 0).length;
  const now = { year: s.date.year, mon: s.date.mon };
  const req = (id: string, label: string, value: number, tgt: number, met = value >= tgt): Requirement => ({ id, label, met, value, target: tgt });
  let requirements: Requirement[];
  const milestones: Milestone[] = [];
  if (goal === 1) {
    for (const m of MILESTONES) {
      const earned = p[m.flag] > 0;
      const passed = after(now, m.last);
      milestones.push({ id: m.id, state: earned ? 'earned' : passed ? 'missed' : 'upcoming', revealed: earned || !after(m.first, now), label: m.label });
    }
    const earned = milestones.filter((m) => m.state === 'earned').length;
    requirements = [req('tractor', 'A tractor', p.tractors, 1), req('money', `Cash and savings of $${target}`, money, target), req('family', 'Family milestones (2 of 3)', earned, 2)];
  } else if (goal === 2) {
    requirements = [
      req('claim', 'The second homestead claim', p.numFields, 2),
      req('tractors', 'Two tractors', p.tractors, 2),
      req('car', 'A car', p.car, 1),
      req('money', `Cash and savings of $${target}`, money, target),
      req('businesses', 'Three businesses in town', busn, 3),
    ];
  } else {
    requirements =
      s.cursit.businessChecked === 1
        ? [req('standing', 'Standing of 90', p.score, 90), req('money', `Cash and savings of $${target}`, money, target)]
        : [
            req('car', 'A car', p.car, 1),
            req('standing', 'Standing of 90', p.score, 90),
            req('money', `Cash and savings of $${target}`, money, target),
            req('business', 'A business in town', busn, 1),
            req('tractor', 'A tractor', p.tractors, 1),
          ];
  }
  const checkDate = GOAL_CHECK_DATES[goal];
  const results = (s.extra?.goalResults ?? []).filter((r) => r.goal === goal);
  const lastResult = results[results.length - 1];
  const armed = s.extra?.goalRetry && s.extra.goalRetry.goal === goal ? s.extra.goalRetry : null;
  const retryDate = armed ? { year: armed.year, mon: armed.mon } : s.assists?.goalRetry && !lastResult ? GOAL_RETRY_DATES[goal] : null;
  const status: GoalChecklist['status'] = armed ? 'retryPending' : lastResult ? (lastResult.met ? 'met' : 'missed') : 'upcoming';
  const due = armed ?? checkDate;
  const metNow = goal === 1 ? farmerGoalMet(s) : goal === 2 ? businessGoalMet(s) : politicianGoalMet(s);
  return { goal, checkDate, retryDate, monthsLeft: Math.max(0, monthsBetween(now, due)), status, metNow, requirements, milestones, progress: goalProgress(s) };
}

// ---------------------------------------------------------------------------
// 9. choicePreview
// ---------------------------------------------------------------------------

export interface ChoiceOption {
  /** stable key for UI copy: yes, no, ok, cancel, option1..3, amount, item1..4, all, answerN */
  key: string;
  choice: EventChoice;
}
export interface ChoicePreview extends ChoiceOption {
  effects: Effects;
  /** the answer adds a later letter/event/talk (consequence comes later) */
  appendsFollowUp: boolean;
  /** "You don't have enough money" (or over budget): the answer cannot be taken now */
  notEnoughMoney: boolean;
  /** text id of the prompt that would come next, if any */
  next: string | null;
  endsGame: boolean;
}

/** Preview one answer to the pending prompt by running the real resolver on a copy. */
export function previewChoice(s: GameState, choice: EventChoice): ChoicePreview | null {
  const p = s.pending;
  if (!p || (p.kind !== 'event' && p.kind !== 'politicianLetter' && p.kind !== 'goalChoice')) return null;
  const r = dispatch(s, { type: 'resolveEvent', choice });
  if (r.events.some((e) => e.type === 'rejected')) return null;
  const b = r.state;
  const np = b.pending;
  const notEnoughMoney = !!np && np.kind === 'message' && (np.text === 'NoM' || np.text === 'Sys836') && np.next !== null;
  return {
    key: '',
    choice,
    effects: effectsBetween(s, b),
    appendsFollowUp: b.events.length > s.events.length || b.ttalk.length > s.ttalk.length,
    notEnoughMoney,
    next: np ? promptTextId(b, np) : null,
    endsGame: !!b.extra.ended,
  };
}

/** The options a prompt offers, with sensible representative values for free inputs. */
export function choiceOptions(s: GameState): ChoiceOption[] {
  const p = s.pending;
  if (!p) return [];
  if (p.kind === 'politicianLetter') return [{ key: 'ok', choice: {} }];
  if (p.kind === 'goalChoice') return p.answers.map((a, i) => ({ key: `answer${a}`, choice: { option: i + 1 } }));
  if (p.kind !== 'event') return [];
  const line = s.events[p.line];
  const type = Number(line[3]);
  const yn = (): ChoiceOption[] => [
    { key: 'yes', choice: { yes: true } },
    { key: 'no', choice: { yes: false } },
  ];
  switch (type) {
    case 1:
      return [{ key: 'name', choice: { name: '' } }];
    case 2: {
      const lp = s.propet.lifePrice;
      const t6 = Math.max(1, Math.floor((lp * 6) / 100));
      const t10 = Math.max(t6 + 1, Math.floor((lp * 10) / 100));
      return [
        { key: 'cancel', choice: { cancel: true } },
        { key: 'amountSmall', choice: { amount: t6 } },
        { key: 'amountMedium', choice: { amount: t10 } },
        { key: 'amountLarge', choice: { amount: t10 + 1 } },
      ];
    }
    case 3:
    case 6:
    case 15:
      return yn();
    case 4:
      if (p.stage === 'main') return [{ key: 'ok', choice: {} }];
      return [
        { key: 'cancel', choice: { cancel: true } },
        ...doctorListItems(s.propet.stove > 0).map((_, i, list) => ({ key: `item${i + 1}`, choice: { items: list.map((__, j) => j === i) } })),
        { key: 'all', choice: { items: doctorListItems(s.propet.stove > 0).map(() => true) } },
      ];
    case 10:
      return [
        { key: 'cancel', choice: { cancel: true } },
        { key: 'option1', choice: { option: 1 } },
        { key: 'option2', choice: { option: 2 } },
        { key: 'option3', choice: { option: 3 } },
      ];
    case 11: {
      const n = Number(line[5]) || 0;
      return [{ key: 'none', choice: { projects: [] } }, ...Array.from({ length: n }, (_, i) => ({ key: `project${i + 1}`, choice: { projects: Array.from({ length: n }, (__, j) => j === i) } }))];
    }
    case 9:
      return [{ key: 'ok', choice: { answers: [] } }];
    default:
      return [{ key: 'ok', choice: {} }];
  }
}

/** Effects of each option of the pending event / letter / goal prompt (consequence chips). */
export function choicePreview(s: GameState): ChoicePreview[] {
  return choiceOptions(s)
    .map((o) => {
      const r = previewChoice(s, o.choice);
      return r ? { ...r, key: o.key } : null;
    })
    .filter((x): x is ChoicePreview => x !== null);
}

// ---------------------------------------------------------------------------
// 11. catalogArrivals
// ---------------------------------------------------------------------------

/** Catalogue item -> first month on sale (`year` 0 = from the start). Static. */
export function catalogArrivals(): Record<CatalogName, MonthRef> {
  return Object.fromEntries(CATALOG.map((c) => [c.name, { year: c.year || 1880, mon: c.year ? c.month : 4 }])) as Record<CatalogName, MonthRef>;
}

// ---------------------------------------------------------------------------
// 1. almanac
// ---------------------------------------------------------------------------

export interface AlmanacPin {
  kind: 'harvestDeadline' | 'fieldReverts' | 'grainSpoils' | 'loanDue' | 'livestockFair' | 'buildSeason' | 'businessForSale' | 'claim' | 'goalCheck' | 'goalRetry' | 'catalogArrival';
  /** first and last month the pin covers (equal for one-off dates) */
  from: MonthRef;
  to: MonthRef;
  /** months from now until `to` (deadlines) or `from` (openings); 0 = this month */
  monthsAway: number;
  params?: Record<string, string | number>;
}

export interface Almanac {
  date: { year: number; mon: number; day: number };
  /** WhatSeason state now */
  season: 'workable' | 'summer' | 'winter';
  /** the random thresholds, as ranges only (the rolled day is hidden) */
  summerArrives: { mon: 5; dayMin: 17; dayMax: 25 };
  firstFrost: { mon: 10; dayMin: 14; dayMax: 25 };
  windows: {
    plow: number[];
    plantSpring: { months: number[]; crops: Crop[] };
    plantAutumn: { months: number[]; crops: Crop[] };
    harvestWinterWheat: number[];
    harvestSpringCrops: number[];
    /** crops planted in these months ripen in these months */
    ripens: { plantedIn: number[]; ripeIn: number[] }[];
    build: number[];
    livestockFair: number[];
  };
  field: {
    phase: 'empty' | 'plowed' | 'planted' | 'ripe';
    /** month the planted crop ripens */
    ripens: MonthRef | null;
    /** last month the crop can be harvested (CurSit 5.1/5.2) */
    harvestBy: MonthRef | null;
    /** unplanted plowed land goes back to grass at the November advance */
    reverts: MonthRef | null;
  };
  /** classic only (Q12): unsold grain is lost when the field is cleared at this advance */
  grainSpoils: MonthRef | null;
  loan: { amountDue: number; dueYear: number; dueMonth: 12; rate: number; canRepayNow: boolean } | null;
  /** known future obligations and openings, in date order (never surprises) */
  comingUp: AlmanacPin[];
}

function pin(now: MonthRef, kind: AlmanacPin['kind'], from: MonthRef, to: MonthRef, params?: AlmanacPin['params'], countTo = false): AlmanacPin {
  return { kind, from, to, monthsAway: Math.max(0, monthsBetween(now, countTo ? to : from)), ...(params ? { params } : {}) };
}

export function almanac(s: GameState): Almanac {
  const c = s.cursit;
  const p = s.propet;
  const now = { year: s.date.year, mon: s.date.mon };
  const ws = seasonOf(s.date.mon, s.date.day, s.random.summerDay, s.random.winterDay);
  const season = ws === 2 ? 'summer' : ws === 1 ? 'winter' : 'workable';
  const phase = c.numHarved > 0 ? 'ripe' : c.numPlanted > 0 ? 'planted' : c.numPlowed > 0 ? 'plowed' : 'empty';
  let ripens: MonthRef | null = null;
  if (phase === 'planted') {
    const m = s.date.mon;
    ripens = m <= 6 ? { year: now.year, mon: m < 6 ? 6 : 7 } : m <= 10 ? { year: now.year, mon: 11 } : { year: now.year, mon: 12 };
  }
  const harvestBy = c.deadlineYear > 0 ? { year: c.deadlineYear, mon: c.deadlineMonth } : null;
  const reverts = phase === 'plowed' && s.date.mon <= 10 ? { year: now.year, mon: 11 } : phase === 'plowed' ? addMonths(now, 1) : null;
  // Q12 classic: Init (deadline) wipes unsold grain one month after the harvest deadline.
  let grainSpoils: MonthRef | null = null;
  if (q(s, 'Q12') && c.bushels.some((b) => b > 0)) {
    if (harvestBy) grainSpoils = addMonths(harvestBy, 1);
    else if (phase === 'plowed') grainSpoils = reverts;
  }
  const li = loanInfo(s);
  const loan = li ? { amountDue: li.amountDue, dueYear: li.dueYear, dueMonth: 12 as const, rate: li.rate, canRepayNow: canRepay(s) } : null;

  const comingUp: AlmanacPin[] = [];
  if (harvestBy && (phase === 'planted' || phase === 'ripe')) comingUp.push(pin(now, 'harvestDeadline', harvestBy, harvestBy, undefined, true));
  if (reverts) comingUp.push(pin(now, 'fieldReverts', reverts, reverts, undefined, true));
  if (grainSpoils) comingUp.push(pin(now, 'grainSpoils', grainSpoils, grainSpoils, undefined, true));
  if (loan) comingUp.push(pin(now, 'loanDue', { year: loan.dueYear, mon: 12 }, { year: loan.dueYear, mon: 12 }, { amount: Math.round(loan.amountDue * 100) / 100 }, true));
  // livestock fair (Apr-May, from 1881, needs a barn)
  {
    let y = now.mon <= 5 ? now.year : now.year + 1;
    if (y === 1880) y = 1881;
    if (y <= 1919) comingUp.push(pin(now, 'livestockFair', { year: y, mon: 4 }, { year: y, mon: 5 }, { needsBarn: p.barn === 1 ? 0 : 1 }));
  }
  if (buildableItems(s).length > 0) {
    const y = now.mon <= 10 ? now.year : now.year + 1;
    comingUp.push(pin(now, 'buildSeason', { year: y, mon: 3 }, { year: y, mon: 10 }));
  }
  BUSINESSES.forEach((b, k) => {
    if (p.business[k] > 0) return;
    const from = { year: b.startYear, mon: 4 };
    const to = { year: b.startYear + 1, mon: 3 };
    if (after(now, to)) return;
    if (monthsBetween(now, from) > 12) return; // only announce what the town already talks about
    comingUp.push(pin(now, 'businessForSale', from, to, { business: k + 1, price: b.price, income: b.adIncome }));
  });
  if (p.numFields === 1) {
    const from = { year: CLAIM.year, mon: 4 };
    const to = { year: CLAIM.year + 1, mon: 3 };
    if (!after(now, to) && monthsBetween(now, from) <= 12) comingUp.push(pin(now, 'claim', from, to, { price: CLAIM.price }));
  }
  const gc = goalChecklist(s);
  if (gc && gc.status === 'upcoming') comingUp.push(pin(now, 'goalCheck', gc.checkDate, gc.checkDate, { goal: gc.goal }));
  if (gc && gc.status === 'retryPending' && gc.retryDate) comingUp.push(pin(now, 'goalRetry', gc.retryDate, gc.retryDate, { goal: gc.goal }));
  for (const [name, at] of Object.entries(catalogArrivals())) {
    if (after(at, now) && monthsBetween(now, at) <= 12) comingUp.push(pin(now, 'catalogArrival', at, at, { item: name }));
  }
  comingUp.sort((a, b) => a.monthsAway - b.monthsAway || monthIndex(a.from.year, a.from.mon) - monthIndex(b.from.year, b.from.mon));

  return {
    date: { year: s.date.year, mon: s.date.mon, day: s.date.day },
    season,
    summerArrives: { mon: 5, dayMin: 17, dayMax: 25 },
    firstFrost: { mon: 10, dayMin: 14, dayMax: 25 },
    windows: {
      plow: [4, 5, 9, 10],
      plantSpring: { months: [4, 5, 6], crops: [2, 3, 4] },
      plantAutumn: { months: [9, 10, 11], crops: [1] },
      harvestWinterWheat: [4, 5],
      harvestSpringCrops: [9, 10],
      ripens: [
        { plantedIn: [4, 5, 6], ripeIn: [6, 7] },
        { plantedIn: [9, 10, 11], ripeIn: [11, 12] },
      ],
      build: [3, 4, 5, 6, 7, 8, 9, 10],
      livestockFair: [4, 5],
    },
    field: { phase, ripens, harvestBy, reverts },
    grainSpoils,
    loan,
    comingUp,
  };
}

// ---------------------------------------------------------------------------
// 10. todaySuggestions
// ---------------------------------------------------------------------------

export interface Suggestion {
  /** UI copy key (see describe.ts `describeSuggestion`) */
  id: string;
  params?: Record<string, string | number>;
}

/** One to a handful of "you can" hints for the Today card, most urgent first. */
export function todaySuggestions(s: GameState): Suggestion[] {
  const out: Suggestion[] = [];
  const p = s.propet;
  const g = s.globals;
  const c = s.cursit;
  if (s.extra.ended) return [{ id: 'gameOver' }];
  if (s.pending) return [{ id: 'answerPrompt', params: { prompt: promptTextId(s, s.pending as Prompt) } }];
  if (s.extra.calendar?.running) return [{ id: 'calendarRunning' }];
  if (g.houseStat === 0 && s.date.year === 1880 && s.date.mon === 4 && g.firstTT !== 1) return [{ id: 'visitTownTalkFirst' }];
  if (g.houseStat === 0) return [{ id: 'advanceToBuildHouse' }];
  if (g.mail > 0) out.push({ id: 'openMail' });
  if (g.tTalk > 0 && g.blinkTTalk === 1) out.push({ id: 'visitTownTalk' });
  if (s.extra.triviaOpen) out.push({ id: 'answerTrivia' });
  const rw = runway(s);
  if (rw.crisis || rw.low) out.push({ id: 'lowRunway', params: { months: Number.isFinite(rw.totalMonths) ? rw.totalMonths : 99, upkeep: rw.upkeep } });
  if (s.myRecieve > 0) out.push({ id: 'collectMoney', params: { amount: Math.round(s.myRecieve * 100) / 100 } });
  const buildOk = s.date.mon >= 3 && s.date.mon <= 10;
  for (const item of buildableItems(s)) out.push({ id: buildOk ? 'build' : 'buildLater', params: { item } });
  const fa = fieldActionStatus(s);
  if (fa.harvest.ok) out.push({ id: 'harvest', params: { squares: fa.ripe } });
  if (c.bushels.some((b) => b > 0)) {
    const strike = s.date.year === 1894 && (s.date.mon === 6 || s.date.mon === 7);
    out.push({ id: strike ? 'sellAfterStrike' : 'sellGrain', params: { bushels: sum(c.bushels), value: Math.round(grainQuote(s).localTotal * 100) / 100 } });
  }
  if (fa.plant.ok) out.push({ id: 'plant', params: { squares: fa.plantable.length } });
  else if (!fa.plant.ok && (fa.plant.dialog === 'NoPlant1' || fa.plant.dialog === 'NoPlant5' || fa.plant.reason === 'nothingPlanted') && fa.plantable.length > 0)
    out.push({ id: 'buySeeds', params: { squares: fa.plantable.length } });
  if (fa.plow.ok) out.push({ id: 'plow', params: { squares: fa.plowable.length } });
  if (p.loanAmount > 0 && p.loanDueYear === s.date.year) out.push({ id: canRepay(s) && p.cash >= p.loanAmount ? 'repayLoan' : 'loanDueThisYear', params: { amount: Math.round(p.loanAmount * 100) / 100 } });
  if (livestockMarketOpen(s)) out.push({ id: 'livestockFair' });
  const biz = businessForSale(s);
  if (biz) out.push({ id: 'businessForSale', params: { business: biz, price: BUSINESSES[biz - 1].price, affordable: p.cash >= BUSINESSES[biz - 1].price ? 1 : 0 } });
  if (claimAvailable(s)) out.push({ id: 'claimAvailable', params: { price: CLAIM.price } });
  if (p.house > 0 && houseUpgradeOffer(s)) out.push({ id: 'houseUpgrade' });
  if (p.cash > 6 * p.lifePrice + 200 && p.house > 0 && p.savings < p.cash) out.push({ id: 'saveMoney' });
  if (out.length === 0) out.push({ id: 'advance' });
  return out;
}
