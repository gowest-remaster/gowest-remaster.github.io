// Typed data tables for the simulation. Everything here is transcribed from the spec
// appendices (docs/spec/02-farm-sim.md Appendix A/B, 03-town.md, 04-home-album.md).
// This folder is the single swap point: when src/content/*.json exists, only these
// exports need to be re-pointed.
import {
  RAW_BUAC2,
  RAW_BUAC3,
  RAW_BUAC4,
  RAW_IALLEVENTS,
  RAW_LANDVALUE,
  RAW_LST,
} from './raw.ts';

// ---------------------------------------------------------------------------
// Appendix A: LandValue (year -> $), Lst (livestock), BuAc2/3/4 (yields/prices)
// ---------------------------------------------------------------------------

/** `LandValue` (SHARED): year -> land value in $ (Propet 8.3). */
export const LAND_VALUE: ReadonlyMap<number, number> = new Map(
  RAW_LANDVALUE.split('\n').map((l) => {
    const [y, v] = l.split(',');
    return [Number(y), Number(v)] as [number, number];
  }),
);

export interface LivestockPriceRow {
  year: number;
  cow: number;
  pig: number;
  horse: number;
}
/** `Lst` (SHARED): year, cow $, pig $, horse $. */
export const LIVESTOCK_PRICES: ReadonlyMap<number, LivestockPriceRow> = new Map(
  RAW_LST.split('\n').map((l) => {
    const [y, c, p, h] = l.split(',').map(Number);
    return [y, { year: y, cow: c, pig: p, horse: h }] as [number, LivestockPriceRow];
  }),
);

export interface YieldRow {
  year: number;
  /** column 2, P/A (unused by the original) */
  pa: number;
  /** column 3, bushels per acre */
  ba: number;
  /** column 4 as the original parses it (`item 4`), e.g. the 1888 corn typo "1,67" gives 1 */
  pb: number;
  /** column 4 as intended (typo repaired: "1,67" -> 1.67) */
  pbIntended: number;
}

function parseYield(raw: string): ReadonlyMap<number, YieldRow> {
  const rows = new Map<number, YieldRow>();
  for (const line of raw.split('\n').slice(2)) {
    const items = line.split(',').map((s) => s.trim());
    const year = Number(items[0]);
    const pb = Number(items[3]);
    const pbIntended = items.length > 4 ? Number(`${items[3]}.${items[4]}`) : pb;
    rows.set(year, { year, pa: Number(items[1]), ba: Number(items[2]), pb, pbIntended });
  }
  return rows;
}
/** `BuAc2` wheat (crops 1 and 2). */
export const YIELD_WHEAT = parseYield(RAW_BUAC2);
/** `BuAc3` oats (crop 3). */
export const YIELD_OATS = parseYield(RAW_BUAC3);
/** `BuAc4` corn (crop 4). Contains the 1888 "1,67" typo (Q24). */
export const YIELD_CORN = parseYield(RAW_BUAC4);

/** `g_Destroied` (FIRSTTIME): N mature squares -> max squares trampled by cattle. */
export const DESTROIED: readonly number[] = [1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8];

/**
 * `g_AllSeas` (FIRSTTIME): scene id per month. Row 0 default ("1111"), rows 1..3 = 1886..1888.
 * Index 0 of each row is the row key, then January..December.
 */
export const ALL_SEAS: readonly (readonly number[])[] = [
  [1111, 2, 1, 1, 3, 5, 6, 6, 6, 8, 8, 1, 1],
  [1886, 2, 1, 1, 3, 5, 6, 6, 6, 8, 8, 2, 2],
  [1887, 2, 2, 2, 3, 5, 7, 7, 7, 7, 8, 2, 2],
  [1888, 2, 2, 2, 3, 5, 7, 7, 7, 7, 8, 1, 1],
];

/** `YearGB` month names (calendar / logbook). */
export const MONTHS_GB = ['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY', 'JUNE', 'JULY', 'AUG.', 'SEPT.', 'OCT.', 'NOV.', 'DEC.'];
/** `Year` month names (FIELD / newspaper). */
export const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

/** `Goals` (SHARED), indexed by goal 1..3. */
export const GOAL_TEXTS = ['', 'To be a successful farmer.', 'To be a successful businessperson.', 'To be a successful politician.'];

/** Logbook `Locations` (1-based). Index 0 unused. */
export const LOG_LOCATIONS = ['', 'Bank', 'Farm house', 'Fields', 'Store', 'Game board', 'Dealer', 'Livestock market'];
/** Logbook `Actions` (1-based). Index 0 unused. */
export const LOG_ACTIONS = ['', 'Receive', 'Take', 'Return', 'Pay  Interest', 'Info.', 'Sell', 'Plow', 'Plant', 'Harvest', 'Build', 'Workers', 'Trivia', 'Surprise', 'Buy', 'Sell', 'Put Away', 'Take Out', 'Buy'];

// ---------------------------------------------------------------------------
// Appendix B: event schedule and town talk
// ---------------------------------------------------------------------------

/** `IAllEvents` (CALEND), one comma-item list per line, verbatim strings. */
export const INITIAL_EVENTS: readonly (readonly string[])[] = RAW_IALLEVENTS.split('\n').map((l) => l.split(','));

/** `ITTalk` (CALEND): [year, month, day, talkId, soundFolder]. */
export const INITIAL_TTALK: readonly (readonly [number, number, number, number, string])[] = [
  [1880, 4, 0, 101, 'TTalk1'], [1880, 9, 0, 102, 'TTalk1'], [1881, 4, 0, 103, 'TTalk1'], [1881, 9, 0, 104, 'TTalk2'],
  [1882, 4, 0, 105, 'TTalk2'], [1882, 9, 0, 106, 'TTalk2'], [1887, 4, 0, 107, 'TTalk2'], [1887, 9, 0, 108, 'TTalk3'],
  [1888, 9, 0, 109, 'TTalk3'], [1890, 4, 0, 110, 'TTalk3'], [1893, 9, 17, 111, 'TTalk3'], [1894, 6, 0, 112, 'TTalk4'],
  [1895, 4, 0, 113, 'TTalk4'], [1905, 6, 0, 114, 'TTalk4'], [1909, 4, 8, 115, 'TTalk4'], [1914, 8, 5, 116, 'TTalk5'],
  [1917, 4, 6, 117, 'TTalk5'], [1918, 11, 11, 118, 'TTalk5'], [1919, 4, 0, 119, 'TTalk5'], [1919, 12, 0, 120, 'TTalk6'],
  [1886, 4, 0, 121, 'TTalk6'],
];

// ---------------------------------------------------------------------------
// Calendar rules
// ---------------------------------------------------------------------------

/** Politician letters ALM1..ALM6 letterhead/signature (02 §6.7.7). Index = WhatScore. */
export const ALM_LETTERS: readonly { id: string; had: string; sig: string }[] = [
  { id: '', had: '', sig: '' },
  { id: 'ALM1', had: 'Had5', sig: 'Sig50' },
  { id: 'ALM2', had: 'Had2', sig: 'Sig1' },
  { id: 'ALM3', had: 'Had2', sig: 'Sig1' },
  { id: 'ALM4', had: 'Had3', sig: 'Sig4' },
  { id: 'ALM5', had: 'Had3', sig: 'Sig4' },
  { id: 'ALM6', had: 'Had4', sig: 'Sig6' },
];

/** `g_WhatScore` thresholds (score >= t -> level), highest first. 02 §3.4(c)5. */
export const WHAT_SCORE_THRESHOLDS: readonly [number, number][] = [[85, 6], [80, 5], [70, 4], [60, 3], [50, 2], [30, 1]];

/** Doctor health list `ListBase` (02 §6.3). Item 2 is the cooking stove. */
export const DOCTOR_LIST = [
  { id: 'blankets', price: 6 },
  { id: 'stove', price: 50 },
  { id: 'glass', price: 10 },
  { id: 'cloth', price: 16 },
] as const;
/** Score for buying N doctor-list items (index = count). Count 0 falls into the "else" branch (+3). */
export const DOCTOR_LIST_SCORE = [3, 3, 5, 8, 10];

/** Trivia (CALEND MovieScript 700): right answer (1..4) and $ bonus per question 1..16. */
export const TRIVIA_RIGHT = [3, 4, 2, 3, 3, 3, 2, 1, 1, 2, 3, 3, 3, 4, 3, 2];
export const TRIVIA_BONUS = [20, 20, 30, 10, 10, 20, 30, 30, 30, 20, 10, 10, 20, 20, 30, 30];

/** Political questionnaire (type 9) correct positions (02 §6.1). */
export const QUESTIONNAIRE_RIGHT = [false, true, true, true, false, false];

/** Construction base days: house, barn, windmill, wood fence, barbed fence (02 §6.12). */
export const CONSTRUCTION_DAYS = { house: 7, barn: 5, windmill: 3, woodFence: 7, barbedFence: 4 } as const;
/** `g_PriceWor`: construction wage per worker (flat). */
export const CONSTRUCTION_WAGE = 5;

/** Mayor path schedule lines added by BusnessCheck/CheckTwo (CALEND MovieScript 37). */
export const MAYOR_SUCCESS_EVENTS: readonly string[] = [
  '1915,6,0,7,ALM7,Had4,Sig6,0,0,0,0',
  '1915,8,0,9',
  '1916,1,0,11,List551,4,2000,1500,500,150,850',
  '1917,1,0,11,List552,4,2300,250,1200,500,500',
  '1918,1,0,11,List553,4,2400,1000,500,850,1000',
  '1919,1,0,11,List554,4,2600,500,400,1300,1000',
];
export const MAYOR_FAIL_EVENT = '1915,6,0,7,ALM9,Had4,Sig6,0,0,0,0';

// ---------------------------------------------------------------------------
// Town (03-town.md)
// ---------------------------------------------------------------------------

/** Field `Dealers`: year range -> percent price adjustment (03 §1.5). Rows 9/10 never match. */
export const DEALERS: readonly { y0: number; y1: number; idx: number }[] = [
  { y0: 1880, y1: 1880, idx: -2 },
  { y0: 1881, y1: 1885, idx: -3 },
  { y0: 1886, y1: 1886, idx: -3 },
  { y0: 1887, y1: 1890, idx: 1 },
  { y0: 1891, y1: 1893, idx: -30 },
  { y0: 1894, y1: 1894, idx: 4 },
  { y0: 1895, y1: 1914, idx: 10 },
  { y0: 1915, y1: 1920, idx: 3 },
];
export const GRAIN_PRICE_MIN = 0.2;
export const GRAIN_PRICE_MAX = 2.5;

/** Field `Buisness` lines 1..4 (+ claim line 5): price, monthly income, score points. */
export const BUSINESSES: readonly { id: string; price: number; income: number; score: number; adIncome: number; startYear: number }[] = [
  { id: "Jan's Laundry", price: 800, income: 40, score: 10, adIncome: 40, startYear: 1895 },
  { id: "Reilly's Shirt Shop", price: 1000, income: 30, score: 12, adIncome: 40, startYear: 1900 },
  { id: 'Baylick & Sons Hardware', price: 2000, income: 50, score: 14, adIncome: 50, startYear: 1904 },
  { id: 'The Longview Hotel', price: 3000, income: 75, score: 16, adIncome: 75, startYear: 1909 },
];
export const CLAIM = { price: 20, score: 0, year: 1909 } as const;

export type CatalogName = 'windMill' | 'wireFence' | 'kodakCamera' | 'tractor' | 'car';
/** `ICatalog` products after `edResetCatalog` (03 §3.4, 01 §5.6). */
export const CATALOG: readonly { name: CatalogName; year: number; month: number; price: number; stock: number }[] = [
  { name: 'windMill', year: 0, month: 0, price: 80, stock: 3 },
  { name: 'wireFence', year: 1883, month: 4, price: 100, stock: 1 },
  { name: 'kodakCamera', year: 1888, month: 4, price: 25, stock: 1 },
  { name: 'tractor', year: 1887, month: 4, price: 400, stock: 3 },
  { name: 'car', year: 1909, month: 4, price: 900, stock: 1 },
];

/** Loan length options in years (bank `PayDate`). */
export const LOAN_YEARS = [1, 3, 5] as const;

// ---------------------------------------------------------------------------
// House / album / news (04-home-album.md, 03 §5)
// ---------------------------------------------------------------------------

export const HOUSE_UPGRADES = [
  { from: 1, threshold: 1500, cost: 200, minYearExclusive: 0, text: 'NH1' },
  { from: 2, threshold: 5000, cost: 1000, minYearExclusive: 1894, text: 'NH2' },
] as const;

/** Album caption casts in cast order: 25 general (`ATexts`..`ATextsE`) then dated `T<year><month>`. */
export const ALBUM_GENERAL_CAPTIONS = 25;
export const ALBUM_DATED_CAPTIONS: readonly { id: string; year: number; month: number }[] = [
  ['T18834', 1883, 4], ['T18858', 1885, 8], ['T188612', 1886, 12], ['T189012', 1890, 12], ['T189412', 1894, 12],
  ['T189612', 1896, 12], ['T18988', 1898, 8], ['T18974', 1897, 4], ['T190312', 1903, 12], ['T190511', 1905, 11],
  ['T19065', 1906, 5], ['T19084', 1908, 4], ['T19098', 1909, 8], ['T19114', 1911, 4], ['T19125', 1912, 5],
  ['T191311', 1913, 11], ['T19164', 1916, 4], ['T191812', 1918, 12],
].map(([id, year, month]) => ({ id: id as string, year: year as number, month: month as number }));

/** Newspaper issues (03 §5.2): year and issue date. */
export const NEWS_ISSUES: readonly { year: number; month: number; day: number }[] = [
  { year: 1880, month: 8, day: 1 }, { year: 1881, month: 9, day: 20 }, { year: 1887, month: 2, day: 5 },
  { year: 1888, month: 8, day: 1 }, { year: 1890, month: 7, day: 15 }, { year: 1893, month: 9, day: 17 },
  { year: 1894, month: 5, day: 15 }, { year: 1909, month: 4, day: 8 }, { year: 1914, month: 8, day: 5 },
  { year: 1915, month: 6, day: 1 }, { year: 1917, month: 4, day: 6 }, { year: 1919, month: 1, day: 7 },
];
