// `NewStart` (CALEND MovieScript 11) + `newGame` + `Always`: build a fresh GameState from
// the I* templates (docs/spec/02-farm-sim.md §2, Appendix B; 01-framework.md §5).
import type { FidelityOptions } from './fidelity.ts';
import { random, seedFrom, type RngHolder } from './rng.ts';
import { CATALOG, INITIAL_EVENTS, INITIAL_TTALK, type CatalogName } from './data/tables.ts';
import { DEFAULT_ASSISTS, SQUARES, freshExtras, zeros, type Assists, type GameState } from './state.ts';
import { recordMonth } from './bookkeeping.ts';
import { seedDevCut } from './devcut.ts'; // [devcut]

export interface NewGameOptions {
  seed?: number | string;
  /** 1 farmer, 2 businessperson, 3 politician (chosen in INTRO). */
  goal?: number;
  fidelity?: FidelityOptions;
  firstName?: string;
  lastName?: string;
  /** New-game assists (default: all off). */
  assists?: Partial<Assists>;
  /** [devcut] Developer's Cut (sim/devcut.ts): seeds the revived events. Off by default. */
  devcut?: boolean;
}

/** `edRandom()`: permutation of 1..16 by rejection sampling with random(16). */
export function edRandom(h: RngHolder): number[] {
  const out: number[] = [];
  while (out.length < 16) {
    const r = random(h, 16);
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

export function newGame(opts: NewGameOptions = {}): GameState {
  const holder: RngHolder = { rng: seedFrom(opts.seed ?? 1) };
  // Visit stream (RNGSTREAM): an independent sequence derived from the same seed.
  const visit: RngHolder = { rng: (seedFrom(opts.seed ?? 1) ^ 0x9e3779b9) >>> 0 };
  random(visit, 2);
  const interest = 2 + random(holder, 5);
  const triviaOrder = edRandom(holder);
  const catalog = Object.fromEntries(CATALOG.map((c) => [c.name, { stock: c.stock, price: c.price }])) as Record<CatalogName, { stock: number; price: number }>;
  const s: GameState = {
    version: 1,
    fidelity: opts.fidelity ?? { mode: 'remastered' },
    rng: holder.rng,
    rngVisit: visit.rng,
    assists: { ...DEFAULT_ASSISTS, ...(opts.assists ?? {}) },
    // ICurSeason "APR. 12,1880,4,12,4"
    date: { year: 1880, mon: 4, day: 12, lastStopMonth: 4 },
    // IPropet
    propet: {
      tractors: 0,
      horses: 2,
      pigs: 2,
      cows: 1,
      animalsDied: 0,
      plows: 1,
      lifePrice: 20,
      numFields: 1,
      hasSeed: 0,
      seeds: [0, 0, 0, 0],
      barn: 0,
      fence: 0,
      windmill: 0,
      extraWindmills: 0,
      house: 0,
      landQuality: 1,
      landValue: 1700,
      loanAmount: 0,
      loanDueYear: 0,
      total: 500,
      cash: 500,
      savings: 0,
      car: 0,
      camera: 0,
      stove: 0,
      score: 0,
      familyWorkers: 1,
      babyNames: ['a', 'a', 'a'],
      daughterWorks: 0,
      sonWorks: 0,
      ach: zeros(10),
      check2: 0,
      boughtStove: 0,
      keptDaughterInSchool: 0,
      paidBigWedding: 0,
      toBuildBarn: 1,
      toBuildFence: 0,
      toBuildWindmill: 0,
      toBuildHouse: 1,
      business: [0, 0, 0, 0],
    },
    // ICurSituation
    cursit: {
      plow: zeros(SQUARES),
      plant: zeros(SQUARES),
      harv: zeros(SQUARES),
      numPlowed: 0,
      numPlanted: 0,
      numHarved: 0,
      unsoldFlag: 0,
      wintSum: 0,
      harvestValue: 0,
      harvestBushels: 0,
      churchLetter: 0,
      deadlineYear: 0,
      deadlineMonth: 0,
      workNow: 0,
      goodwill: 0,
      neighborDebt: 0,
      bushels: [0, 0, 0, 0],
      prices: [0, 0, 0, 0],
      telegram: { year: 0, month: 0, net: 0, pending: 0 },
      businessChecked: 0,
      firstHarv: 0,
    },
    // IBegin (line 4 item 1 = goal from INTRO)
    begin: { prevGame: 1, begin: 0, inside: 0, goal: opts.goal ?? 1, targets: [1000, 2000, 3000] },
    // IRandom (line 4 overwritten by edRandom)
    random: { summerDay: 17, winterDay: 22, elevatorBonus: 19, transport: 74, triviaOrder },
    // IPropet line 12 / line 19
    globals: {
      count1: 0,
      wasEvent: 0,
      mainEvent: 0,
      eog: 0,
      son2Plot: 0,
      grassH: 0,
      tTalk: 1,
      wasTTalk: 0,
      tTalkName: 0,
      tTalkPath: '',
      whatHouse: 1,
      wasHouse: 0,
      trivia: 0,
      firstTT: 0,
      blinkTTalk: 0,
      wasCows: 0,
      storeTalkCount: 0,
      quesNum: 0,
      mainView: 0,
      fieldStat: 0,
      barnStat: 0,
      houseStat: 0,
      mail: 0,
      workNow1: 0,
      aprilSept: 0,
      outDate: 0,
      trivRand: 0,
      whatScore: 0,
      fenceEvent: 0,
      type: 0,
      mainLine: 0,
      mayerTTalk: 0,
    },
    interest,
    events: INITIAL_EVENTS.map((l) => [...l]),
    ttalk: INITIAL_TTALK.map(([year, month, day, id, path]) => ({ year, month, day, id, path })),
    catalog,
    myRecieve: 0,
    loanYears: 0,
    name: { first: opts.firstName ?? '', last: opts.lastName ?? '' },
    logbook: [],
    album: { curPage: 2, lastPage: 2, pictures: [8, 4, ...zeros(52)], texts: new Array<string>(50).fill('') },
    pending: null,
    sessions: { field: null, livestock: null, town: null, store: null },
    extra: {
      ended: null,
      triviaOpen: false,
      triviaQuestion: 0,
      deedReceived: 0,
      son2PaidYear: 0,
      lastConstructionCost: 0,
      bankTxCount: 0,
      goalPrompt: null,
      ...freshExtras({ date: { year: 1880, mon: 4, day: 12, lastStopMonth: 4 }, interest }),
    },
  };
  recordMonth(s); // history starts with the arrival month
  // g_TTalk = 1 in the template: the first town talk (101, index 1) is pending and the
  // Start frame forces a visit before the calendar can run (see turn.startCalendar).
  if (opts.devcut) seedDevCut(s); // [devcut] no RNG drawn; no-op when off
  return s;
}
