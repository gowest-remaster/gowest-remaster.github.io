// Typed game state. Every persistent field maps 1:1 to the original text fields
// `Propet`, `CurSituation`, `Begin`, `CurSeason`, `Random` (docs/spec/02-farm-sim.md §1,
// docs/spec/01-framework.md §2.3/§3). Comments give the original `line.item` index.
import type { FidelityOptions } from './fidelity.ts';
import type { CatalogName } from './data/tables.ts';
import type { DevCutState } from './devcut.ts'; // [devcut]

export type Crop = 1 | 2 | 3 | 4; // 1 winter wheat, 2 spring wheat, 3 oats, 4 corn
export type Four<T> = [T, T, T, T];

/** Field `Propet` (template `IPropet`). */
export interface Propet {
  /** 1.1 number of tractors */
  tractors: number;
  /** 2.1 horses */
  horses: number;
  /** 2.2 pigs */
  pigs: number;
  /** 2.3 cows */
  cows: number;
  /** 2.7 "animals already died this winter" flag (absent = 0) */
  animalsDied: number;
  /** 3.1 plows (achievements only) */
  plows: number;
  /** 4.1 LifePrice: monthly cost of living ($, may be fractional) */
  lifePrice: number;
  /** 5.1 number of fields / homestead claims (1 or 2) */
  numFields: number;
  /** 6.1 "has any seed" flag (recomputed on FIELD entry) */
  hasSeed: number;
  /** 6.2..6.5 seed stock in acres: winter wheat, spring wheat, oats, corn */
  seeds: Four<number>;
  /** 7.2 barn: 0 none, 1 built, 3 destroyed by tornado */
  barn: number;
  /** 7.3 field fence: 0 none, 1 wooden/wire (store increments), 3 barbed (built) */
  fence: number;
  /** 7.4 main well+windmill: 0 none, 1 working, 2 destroyed */
  windmill: number;
  /** 7.5 extra windmills owned */
  extraWindmills: number;
  /** 7.6 house built 0/1 */
  house: number;
  /** 8.2 land quality 0/1/2 (-15% / 0 / +15%), re-rolled monthly */
  landQuality: number;
  /** 8.3 land value $ */
  landValue: number;
  /** 9.2 loan amount due (principal + interest) */
  loanAmount: number;
  /** 9.3 loan due year */
  loanDueYear: number;
  /** 10.2 total = cash + savings */
  total: number;
  /** 10.3 cash */
  cash: number;
  /** 10.4 savings (box under the bed) */
  savings: number;
  /** 11.2 car */
  car: number;
  /** 11.3 Kodak camera ("video") */
  camera: number;
  /** 11.4 cooking stove ("oven") */
  stove: number;
  /** 13.2 score */
  score: number;
  /** 14.2 family members able to work */
  familyWorkers: number;
  /** 14.3, 14.4, 14.5 baby names (1880 son, 1884 daughter, 1889 son) */
  babyNames: [string, string, string];
  /** 14.6 1888 daughter allowed to work (0 = label "Family") */
  daughterWorks: number;
  /** 14.7 1892 son allowed to work */
  sonWorks: number;
  /** 15.2..15.11 achievement / ALM letter flags (index 0 = item 2) */
  ach: number[];
  /** 16.2 (unused) */
  check2: number;
  /** 16.3 bought the stove for health */
  boughtStove: number;
  /** 16.4 refused to let the daughter work in 1888 */
  keptDaughterInSchool: number;
  /** 16.5 paid the town-square wedding in 1902 */
  paidBigWedding: number;
  /** 17.2 to-build barn */
  toBuildBarn: number;
  /** 17.3 to-build fence (1 wood, 2 barbed; never set, Q9) */
  toBuildFence: number;
  /** 17.4 to-build windmill/well count */
  toBuildWindmill: number;
  /** 17.5 to-build sod house */
  toBuildHouse: number;
  /** 18.2..18.5 monthly income of town businesses 1..4 */
  business: Four<number>;
}

/** Saved globals (Propet line 12 items 2..19 and line 19 items 1..4) + live-only globals. */
export interface Globals {
  /** 12.2 g_Count1: neighbours' $100 gift used */
  count1: number;
  /** 12.3 g_WasEvent */
  wasEvent: number;
  /** 12.4 g_MainEvent (event type) */
  mainEvent: number;
  /** 12.5 g_EOG end of game */
  eog: number;
  /** 12.6 g_Son2Plot (0 none, 1 paying law school, 2 refused) */
  son2Plot: number;
  /** 12.7 g_GrassH disaster message pending */
  grassH: number;
  /** 12.8 g_TTalk: 1-based index into the town-talk list (0 none) */
  tTalk: number;
  /** 12.9 g_WasTTalk */
  wasTTalk: number;
  /** 12.10 g_TTalkName talk id */
  tTalkName: number;
  /** 12.11 g_TTalkPath (string) */
  tTalkPath: string;
  /** 12.12 g_WhatHouse 1 sod, 2 furnished sod, 3 wooden */
  whatHouse: number;
  /** 12.13 g_WasHouse upgrade declines */
  wasHouse: number;
  /** 12.14 g_Trivia: trivia card already offered this month */
  trivia: number;
  /** 12.15 g_FirstTT */
  firstTT: number;
  /** 12.16 g_BlinkTTalk */
  blinkTTalk: number;
  /** 12.17 g_WasCows */
  wasCows: number;
  /** 12.18 gStoreTalkCount */
  storeTalkCount: number;
  /** 12.19 g_quesNum trivia pointer */
  quesNum: number;
  /** 19.1 g_MainView scene id */
  mainView: number;
  /** 19.2 g_FieldStat */
  fieldStat: number;
  /** 19.3 g_BarnStat */
  barnStat: number;
  /** 19.4 g_HouseStat (0 = sod house not yet built) */
  houseStat: number;
  // ---- live-only globals (not in the original save) ----
  /** g_Mail: 0 none, 1 letter in mailbox, -1 being read */
  mail: number;
  /** g_WorkNow1: max neighbours used for harvesting this season (save slot = CurSit 7.3, Q13) */
  workNow1: number;
  /** g_AprilSept: automatic April/September stop armed */
  aprilSept: number;
  /** g_OutDate: user asked to stop */
  outDate: number;
  /** g_TrivRand: random(10) per month */
  trivRand: number;
  /** g_WhatScore politician level */
  whatScore: number;
  /** g_FenceEvent: cattle check done this month */
  fenceEvent: number;
  /** g_Type (12 = cattle damage) */
  type: number;
  /** g_MainLine: 1-based line of the current event in AllEvents */
  mainLine: number;
  /** g_MayerTTalk */
  mayerTTalk: number;
}

/** Field `CurSituation` (template `ICurSituation`). Square arrays are 0-based (square 1 = index 0). */
export interface CurSituation {
  /** line 1: g_Plow per square: 0 untouched, 1 plowed, 2 marked, 15 frost-killed */
  plow: number[];
  /** line 2: g_Plant per square: 0 or crop 1..4 */
  plant: number[];
  /** line 3: g_Harv per square: crop 1..4 mature, 12 trampled, 13 burnt, 14 eaten, 15 frost */
  harv: number[];
  /** 4.1 g_NumPlowed */
  numPlowed: number;
  /** 4.2 g_NumPlanted */
  numPlanted: number;
  /** 4.3 g_NumHarved (mature squares awaiting harvest) */
  numHarved: number;
  /** 4.4 unsold crops flag (never written, Q10) */
  unsoldFlag: number;
  /** 4.5 g_WintSum: 0 workable, 1 winter, 2 summer */
  wintSum: number;
  /** 4.6 total value of the last harvest */
  harvestValue: number;
  /** 4.7 total bushels of the last harvest */
  harvestBushels: number;
  /** 4.9 church letter opened */
  churchLetter: number;
  /** 5.1 harvest deadline year */
  deadlineYear: number;
  /** 5.2 harvest deadline month */
  deadlineMonth: number;
  /** 7.1 g_WorkNow: max neighbours used for plowing this season */
  workNow: number;
  /** 7.2 neighbour goodwill: 0 ok, 1 refused, 2 cooling down */
  goodwill: number;
  /** 7.3 neighbour help owed (NCount) */
  neighborDebt: number;
  /** 8.1..8.4 harvested-but-unsold bushels per crop */
  bushels: Four<number>;
  /** 9.1..9.4 price per bushel per crop from the last harvest */
  prices: Four<number>;
  /** 10.1..10.4 pending O'Grady telegram: year, month, net, flag */
  telegram: { year: number; month: number; net: number; pending: number };
  /** 11.1 business-goal check ran with goal 2 */
  businessChecked: number;
  /** 12.1 has finished a field job (FirstHarv; enables loans) */
  firstHarv: number;
}

/** Field `Begin` (template `IBegin`). */
export interface Begin {
  /** 1.1 "Prev Game" */
  prevGame: number;
  /** 2.1 */
  begin: number;
  /** 3.1 "Inside" */
  inside: number;
  /** 4.1 goal: 0 none, 1 farmer, 2 businessperson, 3 politician */
  goal: number;
  /** 4.2..4.4 cash+savings targets for goals 1..3 */
  targets: [number, number, number];
}

/** Field `CurSeason` "<MON. d>,<year>,<mon>,<day>,<mon at last calendar stop>". */
export interface CurSeason {
  /** item 2 */
  year: number;
  /** item 3 */
  mon: number;
  /** item 4 */
  day: number;
  /** item 5 */
  lastStopMonth: number;
}

/** Field `Random` (template `IRandom`). */
export interface RandomField {
  /** 1.2 day in May from which it is summer */
  summerDay: number;
  /** 2.2 day in October from which it is winter */
  winterDay: number;
  /** 3.1 O'Grady elevator bonus, cents/bushel */
  elevatorBonus: number;
  /** 3.2 O'Grady transport cost $ */
  transport: number;
  /** line 4: trivia question order (permutation of 1..16) */
  triviaOrder: number[];
}

export interface TTalkEntry {
  year: number;
  month: number;
  day: number;
  id: number;
  path: string;
}

export interface LogEntry {
  /** "<YearGB month> <day>" */
  date: string;
  year: number;
  loc: number;
  act: number;
  cost: number;
  income: number;
  total: number;
}

export type AckEffect = 'nom1' | 'nom5' | 'loanEnd' | 'openEvents';

/** A modal prompt that must be answered before any other command. */
export type Prompt =
  | { kind: 'message'; text: string; dbox: string; onAck?: AckEffect; next: Prompt | null; params?: Record<string, string | number> }
  | { kind: 'event'; line: number; stage: 'main' | 'doctorList' }
  | { kind: 'politicianLetter'; level: number }
  | { kind: 'goalChoice'; text: string; answers: number[] }
  | { kind: 'neighborHelp'; days: number }
  | { kind: 'houseOffer'; fromHouse: number; cost: number; text: string };

export interface FieldSession {
  /** g_Neib neighbours available */
  neighbors: number;
  /** g_PriceWok1 wage per worker per day */
  wage: number;
  /** g_Land captured at entry */
  land: number;
}
export interface LivestockSession {
  /** max buyable per animal [horse, pig, cow] */
  max: [number, number, number];
  /** offered price per animal [horse, pig, cow] */
  price: [number, number, number];
}
export interface TownSession {
  /** g_Dealers 1 or 2 */
  dealers: number;
}
export interface StoreSession {
  /** wrong-total counter for the current seed type */
  errors: number;
  seed: number;
}

export type EndReason = 'bankrupt' | 'foreclosed' | 'retired' | 'completed';

/** Optional helps chosen at New Game. They never change rules unless named so (GOALRETRY). */
export interface Assists {
  /**
   * GOALRETRY (remastered-ux §9.4, decision §12): if the goal check fails, check once more a
   * year later (Farmer Aug 1903, Businessperson Jun 1910, Politician Jun 1916). Off by default.
   */
  goalRetry: boolean;
}
export const DEFAULT_ASSISTS: Assists = { goalRetry: false };

/** One row of `extra.history`: the state right after a month advance (incl. its upkeep). */
export interface MonthSnapshot {
  year: number;
  mon: number;
  cash: number;
  savings: number;
  score: number;
  lifePrice: number;
  landValue: number;
  farmValue: number;
  /** monthly income of all businesses owned */
  businessIncome: number;
  loanAmount: number;
  /** bushels sold since the previous snapshot */
  soldBushels: number;
  /** grain income since the previous snapshot (local cash + O'Grady money sent to the bank) */
  grainIncome: number;
}

/** Money/standing changes caused by one decision. */
export interface Effects {
  cash: number;
  savings: number;
  score: number;
  lifePrice: number;
  familyWorkers: number;
  /** money sent to the bank (MyRecieve) */
  bank: number;
}

/** One row of `extra.decisions`: a resolved prompt (keepsakes / epilogue source). */
export interface DecisionRecord {
  year: number;
  mon: number;
  kind: Prompt['kind'];
  /** text id of the prompt (event text id, ALM letter, goal text, `NHelp`, NH1/NH2) */
  id: string;
  /** event line index (kind `event`) */
  line?: number;
  stage?: 'main' | 'doctorList';
  /** the answer as sent (EventChoice or `{ yes }`) */
  choice: Record<string, unknown>;
  effects: Effects;
}

/** Calendar re-entrancy (remastered-ux §9.3 item 13). */
export interface CalendarRun {
  running: boolean;
  yieldEachMonth: boolean;
  /** month advances left before the stop request is raised (null = run to a natural stop) */
  monthsLeft: number | null;
}

export interface GoalResult {
  goal: number;
  year: number;
  mon: number;
  met: boolean;
  retry: boolean;
}

export interface GameState {
  version: 1;
  fidelity: FidelityOptions;
  /** RNG state (uint32), saved so games replay exactly. The "world" stream. */
  rng: number;
  /** Visit-stream RNG (RNGSTREAM): per-visit rolls and the trivia order. */
  rngVisit: number;
  /** New-game assists (see `Assists`). */
  assists: Assists;
  date: CurSeason;
  propet: Propet;
  cursit: CurSituation;
  begin: Begin;
  random: RandomField;
  globals: Globals;
  /** field `Interest` n% (3..7) */
  interest: number;
  /** `AllEvents` lines as comma items; `All` keys are derived (Q6: always aligned). */
  events: string[][];
  /** `TTalk` / g_AllTTalk */
  ttalk: TTalkEntry[];
  /** `defCatalogItems` stock/price */
  catalog: Record<CatalogName, { stock: number; price: number }>;
  /** `MyRecieve` money waiting at the bank */
  myRecieve: number;
  /** `MyDate` loan length in years */
  loanYears: number;
  /** `MyName` / `FirstName` / `LastName` */
  name: { first: string; last: string };
  /** `LogBook` */
  logbook: LogEntry[];
  /** `NumbPage` + `MyText` */
  album: { curPage: number; lastPage: number; pictures: number[]; texts: string[] };
  pending: Prompt | null;
  /** [devcut] Developer's Cut layer (sim/devcut.ts). Absent in normal games; set only by newGame({ devcut: true }). */
  devcut?: DevCutState;
  sessions: {
    field: FieldSession | null;
    livestock: LivestockSession | null;
    town: TownSession | null;
    store: StoreSession | null;
  };
  /** Remake-only bookkeeping (not in the original layout). */
  extra: {
    ended: EndReason | null;
    triviaOpen: boolean;
    triviaQuestion: number;
    deedReceived: number;
    son2PaidYear: number;
    /** field "Cost" left over from the last Construction screen (Q23) */
    lastConstructionCost: number;
    /** bank transactions since entering the bank (T11) */
    bankTxCount: number;
    /** goal-choice dialog prepared by BusnessCheck (g_GoalFDBK / g_Answers) */
    goalPrompt: { text: string; answers: number[] } | null;
    // ---- remastered bookkeeping (remastered-ux §9.3 item 12): no rule effects ----
    /** one snapshot per month advance (plus the starting month) */
    history: MonthSnapshot[];
    /** one record per resolved prompt */
    decisions: DecisionRecord[];
    /** grain sold since the last snapshot */
    monthTally: { soldBushels: number; grainIncome: number };
    /** calendar run in progress (startCalendar with yieldEachMonth) */
    calendar: CalendarRun;
    /** VISITROLL: per-visit rolls cached for one month (key = year*100+mon) */
    visitRolls: { key: number; field?: { neighbors: number; wage: number }; town?: { dealers: number }; livestock?: LivestockSession };
    /** GOALRETRY: a pending one-year-later goal re-check */
    goalRetry: { goal: number; year: number; mon: number } | null;
    /** outcome of every goal check that ran */
    goalResults: GoalResult[];
    /** interest rate the current loan was signed at (LOANRATE) */
    loanRate: number;
    /** month index (year*12+mon-1) of the last Date check (SKIPEVT) */
    lastDateCheck: number;
  };
}

export const SQUARES = 16;

/** Month index used for month arithmetic: year*12 + mon - 1. */
export const monthIndex = (year: number, mon: number) => year * 12 + mon - 1;

/** Fresh remastered bookkeeping (also used to migrate saves made before it existed). */
export function freshExtras(s: Pick<GameState, 'date' | 'interest'>): Omit<GameState['extra'], 'ended' | 'triviaOpen' | 'triviaQuestion' | 'deedReceived' | 'son2PaidYear' | 'lastConstructionCost' | 'bankTxCount' | 'goalPrompt'> {
  return {
    history: [],
    decisions: [],
    monthTally: { soldBushels: 0, grainIncome: 0 },
    calendar: { running: false, yieldEachMonth: false, monthsLeft: null },
    visitRolls: { key: 0 },
    goalRetry: null,
    goalResults: [],
    loanRate: s.interest,
    lastDateCheck: monthIndex(s.date.year, s.date.mon) - 1,
  };
}

/**
 * Fill in fields added after a save was written (in place; returns the same object).
 * `dispatch` calls this on its working copy, so old saves keep working; loaders may call it too.
 */
export function migrateState(s: GameState): GameState {
  const fresh = freshExtras(s);
  const x = s.extra as Partial<GameState['extra']>;
  for (const k of Object.keys(fresh) as (keyof typeof fresh)[]) if (x[k] === undefined) (x as Record<string, unknown>)[k] = fresh[k];
  if (s.rngVisit === undefined) s.rngVisit = (s.rng ^ 0x9e3779b9) >>> 0;
  if (!s.assists) s.assists = { ...DEFAULT_ASSISTS };
  return s;
}
export const zeros = (n: number) => new Array<number>(n).fill(0);

/** Lingo `integer()`: round to nearest, halves away from zero. */
export function lingoInt(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}
/** Lingo `/`: integer division when both operands are integers, else float. */
export function ldiv(a: number, b: number): number {
  return Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
}

// ---------------------------------------------------------------------------
// Original text layout (serialize / parse). Used by tests and optional imports.
// ---------------------------------------------------------------------------

const MONTHS_GB = ['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY', 'JUNE', 'JULY', 'AUG.', 'SEPT.', 'OCT.', 'NOV.', 'DEC.'];

export interface OriginalFields {
  Propet: string;
  CurSituation: string;
  Begin: string;
  CurSeason: string;
  Random: string;
}

export function serializeOriginal(s: GameState): OriginalFields {
  const p = s.propet;
  const g = s.globals;
  const c = s.cursit;
  const q13 = q13Of(s);
  const l12 = [g.count1, g.wasEvent, g.mainEvent, g.eog, g.son2Plot, g.grassH, g.tTalk, g.wasTTalk, g.tTalkName, g.tTalkPath || 0, g.whatHouse, g.wasHouse, g.trivia, g.firstTT, g.blinkTTalk, g.wasCows, g.storeTalkCount, g.quesNum, 0, 0];
  const family =
    p.daughterWorks || p.sonWorks ? [p.daughterWorks, p.sonWorks].filter((_, i) => i === 0 || p.sonWorks).join(',') : 'Family';
  const propet = [
    `${p.tractors},Tractors,0,0,0`,
    `${p.horses},${p.pigs},${p.cows},Horses,Pigs,Cows${p.animalsDied ? `,${p.animalsDied}` : ''}`,
    `${p.plows},Plows,0`,
    `${p.lifePrice},LifePrice`,
    `${p.numFields},Number of Fields`,
    `${p.hasSeed},${p.seeds.join(',')},seeds`,
    `7,${p.barn},${p.fence},${p.windmill},${p.extraWindmills},${p.house},Barn,Fence,WindWell,house`,
    `8,${p.landQuality},${p.landValue},Land`,
    `9,${p.loanAmount},${p.loanDueYear},loan,Yearreturn`,
    `10,${p.total},${p.cash},${p.savings},Total,Cash,Save`,
    `11,${p.car},${p.camera},${p.stove},car,video,oven`,
    `12,${l12.join(',')},Variables`,
    `13,${p.score},Score`,
    `14,${p.familyWorkers},${p.babyNames.join(',')},${family}`,
    `15,${p.ach.join(',')},Ach.file`,
    `16,${p.check2},${p.boughtStove},${p.keptDaughterInSchool},${p.paidBigWedding},Check plot`,
    `17,${p.toBuildBarn},${p.toBuildFence},${p.toBuildWindmill},${p.toBuildHouse},Barn,Fence,WindWell,House(Shopping)`,
    `18,${p.business.join(',')},0,Buisness`,
    `${g.mainView},${g.fieldStat},${g.barnStat},${g.houseStat}`,
  ].join('\n');
  const l4 = [c.numPlowed, c.numPlanted, c.numHarved, c.unsoldFlag, c.wintSum, c.harvestValue, c.harvestBushels, 0, c.churchLetter, 0, 0, 0, 0, 0, 0, 0];
  const cursit = [
    c.plow.join(','),
    c.plant.join(','),
    c.harv.join(','),
    `${l4.join(',')},6-7-Bush-Price-tot,9-Church`,
    `${c.deadlineYear},${c.deadlineMonth},Year,Month`,
    `0,0,Neighb,Family`,
    `${c.workNow},${c.goodwill},${q13 ? g.workNow1 : c.neighborDebt},NCount,NCicle,NWor`,
    `${c.bushels.join(',')},Bush`,
    `${c.prices.join(',')},Price`,
    `${c.telegram.year},${c.telegram.month},${c.telegram.net},${c.telegram.pending}`,
    `${c.businessChecked},0,Reserv`,
    `${c.firstHarv},FirstHarv`,
  ].join('\n');
  const b = s.begin;
  const begin = [`${b.prevGame},Prev Game`, `${b.begin},Begin`, `${b.inside},Inside`, `${b.goal},${b.targets.join(',')},Goals`].join('\n');
  const d = s.date;
  const curSeason = `${MONTHS_GB[d.mon - 1]} ${d.day},${d.year},${d.mon},${d.day},${d.lastStopMonth}`;
  const r = s.random;
  const random = [`10,${r.summerDay},Winter,month,day`, `5,${r.winterDay},Summer`, `${r.elevatorBonus},${r.transport},Cents/Bush,TransPrice`, r.triviaOrder.join(',')].join('\n');
  return { Propet: propet, CurSituation: cursit, Begin: begin, CurSeason: curSeason, Random: random };
}

const q13Of = (s: GameState) => s.fidelity.overrides?.Q13 ?? s.fidelity.mode === 'classic';
const num = (x: string | undefined) => (x === undefined || x.trim() === '' ? 0 : Number(x));

/** Parse original-layout fields into an existing state (in place on a copy). */
export function parseOriginal(base: GameState, f: OriginalFields): GameState {
  const s = structuredClone(base);
  const L = (t: string) => t.split('\n').map((l) => l.split(','));
  const P = L(f.Propet);
  const p = s.propet;
  p.tractors = num(P[0][0]);
  p.horses = num(P[1][0]);
  p.pigs = num(P[1][1]);
  p.cows = num(P[1][2]);
  p.animalsDied = num(P[1][6]);
  p.plows = num(P[2][0]);
  p.lifePrice = num(P[3][0]);
  p.numFields = num(P[4][0]);
  p.hasSeed = num(P[5][0]);
  p.seeds = [1, 2, 3, 4].map((i) => num(P[5][i])) as Four<number>;
  [p.barn, p.fence, p.windmill, p.extraWindmills, p.house] = [1, 2, 3, 4, 5].map((i) => num(P[6][i]));
  p.landQuality = num(P[7][1]);
  p.landValue = num(P[7][2]);
  p.loanAmount = num(P[8][1]);
  p.loanDueYear = num(P[8][2]);
  [p.total, p.cash, p.savings] = [1, 2, 3].map((i) => num(P[9][i]));
  [p.car, p.camera, p.stove] = [1, 2, 3].map((i) => num(P[10][i]));
  const v = P[11];
  const g = s.globals;
  [g.count1, g.wasEvent, g.mainEvent, g.eog, g.son2Plot, g.grassH, g.tTalk, g.wasTTalk, g.tTalkName] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => num(v[i]));
  g.tTalkPath = v[10] === '0' ? '' : v[10];
  [g.whatHouse, g.wasHouse, g.trivia, g.firstTT, g.blinkTTalk, g.wasCows, g.storeTalkCount, g.quesNum] = [11, 12, 13, 14, 15, 16, 17, 18].map((i) => num(v[i]));
  p.score = num(P[12][1]);
  p.familyWorkers = num(P[13][1]);
  p.babyNames = [P[13][2], P[13][3], P[13][4]];
  p.daughterWorks = P[13][5] === 'Family' ? 0 : num(P[13][5]);
  p.sonWorks = num(P[13][6]);
  p.ach = P[14].slice(1, 11).map(num);
  [p.check2, p.boughtStove, p.keptDaughterInSchool, p.paidBigWedding] = [1, 2, 3, 4].map((i) => num(P[15][i]));
  [p.toBuildBarn, p.toBuildFence, p.toBuildWindmill, p.toBuildHouse] = [1, 2, 3, 4].map((i) => num(P[16][i]));
  p.business = [1, 2, 3, 4].map((i) => num(P[17][i])) as Four<number>;
  [g.mainView, g.fieldStat, g.barnStat, g.houseStat] = [0, 1, 2, 3].map((i) => num(P[18][i]));

  const C = L(f.CurSituation);
  const c = s.cursit;
  c.plow = C[0].slice(0, 16).map(num);
  c.plant = C[1].slice(0, 16).map(num);
  c.harv = C[2].slice(0, 16).map(num);
  [c.numPlowed, c.numPlanted, c.numHarved, c.unsoldFlag, c.wintSum, c.harvestValue, c.harvestBushels] = [0, 1, 2, 3, 4, 5, 6].map((i) => num(C[3][i]));
  c.churchLetter = num(C[3][8]);
  c.deadlineYear = num(C[4][0]);
  c.deadlineMonth = num(C[4][1]);
  c.workNow = num(C[6][0]);
  c.goodwill = num(C[6][1]);
  c.neighborDebt = num(C[6][2]);
  if (q13Of(s)) g.workNow1 = num(C[6][2]); // newGame reads 7.3 back into g_WorkNow1 (Q13)
  c.bushels = [0, 1, 2, 3].map((i) => num(C[7][i])) as Four<number>;
  c.prices = [0, 1, 2, 3].map((i) => num(C[8][i])) as Four<number>;
  c.telegram = { year: num(C[9][0]), month: num(C[9][1]), net: num(C[9][2]), pending: num(C[9][3]) };
  c.businessChecked = num(C[10][0]);
  c.firstHarv = num(C[11][0]);

  const B = L(f.Begin);
  s.begin = { prevGame: num(B[0][0]), begin: num(B[1][0]), inside: num(B[2][0]), goal: num(B[3][0]), targets: [num(B[3][1]), num(B[3][2]), num(B[3][3])] };
  const S = f.CurSeason.split(',');
  s.date = { year: num(S[1]), mon: num(S[2]), day: num(S[3]), lastStopMonth: num(S[4]) };
  const R = L(f.Random);
  s.random = { summerDay: num(R[0][1]), winterDay: num(R[1][1]), elevatorBonus: num(R[2][0]), transport: num(R[2][1]), triviaOrder: R[3].map(num) };
  return s;
}
