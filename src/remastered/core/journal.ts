// Presentation-side bookkeeping kept with each Remastered save: monthly snapshots (Ledger
// charts, Year in Review), the standing ledger, talks heard, papers read, month summaries,
// keepsakes for the scrapbook, ledger notes, bookmarks. Derived only from sim events and
// state; it never feeds back into the rules.
import type { GameState, SimEvent } from '../../sim/index.ts';
import { BUSINESSES } from '../../sim/data/tables.ts';
import { CROP_NAMES, money, monthName } from './format.ts';
import { netWorth } from './simapi.ts';

export interface Snapshot {
  year: number;
  mon: number;
  cash: number;
  savings: number;
  score: number;
  upkeep: number;
  netWorth: number;
  loan: number;
}
export interface StandingEntry {
  year: number;
  mon: number;
  delta: number;
  score: number;
  reason: string;
}
export interface UpkeepEntry {
  year: number;
  mon: number;
  delta: number;
  upkeep: number;
  reason: string;
}
export interface MonthSummary {
  year: number;
  mon: number;
  lines: string[];
}
export interface Keepsake {
  kind: 'letter' | 'baby' | 'harvest' | 'disaster' | 'built' | 'business' | 'paper' | 'talk' | 'claim' | 'loan' | 'wedding' | 'milestone';
  year: number;
  mon: number;
  title: string;
  ref?: string;
  detail?: string;
}
export interface YearReview {
  year: number;
  bushels: number;
  harvestValue: number;
  sales: number;
  startWorth: number;
  endWorth: number;
  events: string[];
}
/** What stood on the farm at the end of a year (the Ledger's Then & Now). */
export interface FarmSnap {
  year: number;
  mon: number;
  house: number;
  barn: number;
  windmill: number;
  extraWindmills: number;
  fence: number;
  tractors: number;
  car: number;
  horses: number;
  pigs: number;
  cows: number;
  planted: number;
  plowed: number;
  ripe: number;
  fields: number;
  businesses: number;
  children: number;
  stove: number;
  camera: number;
}
export interface Journal {
  v: 1;
  farm: FarmSnap[];
  snapshots: Snapshot[];
  standing: StandingEntry[];
  upkeep: UpkeepEntry[];
  talks: number[];
  papers: number[];
  summaries: MonthSummary[];
  keepsakes: Keepsake[];
  notes: Record<number, string>;
  years: YearReview[];
  lore: string[];
  seenFirst: string[];
  bookmarks: { year: number; mon: number; label: string }[];
  /** hotbar notification badges already seen: panel id -> badge text when last opened */
  badgeSeen?: Record<string, string>;
  /** the field remembers the last crew per job and the last squares/seed (calm-ui: "Same as last time") */
  fieldPrefs?: {
    crew?: Partial<Record<'plow' | 'harvest', { workers: number; neighbors: number; family: number }>>;
    plow?: number[];
    plant?: [number, number][];
  };
}

export function emptyJournal(): Journal {
  return { v: 1, farm: [], snapshots: [], standing: [], upkeep: [], talks: [], papers: [], summaries: [], keepsakes: [], notes: {}, years: [], lore: [], seenFirst: [], bookmarks: [] };
}

const REASON_LABEL: Record<string, string> = {
  livingCost: 'Upkeep',
  workers: 'Hired hands',
  grainSale: 'Grain sold',
  bankReceive: 'Collected at the bank',
  loan: 'Loan',
  loanRepay: 'Loan repaid',
  seeds: 'Seed',
  catalog: 'Catalogue order',
  savingsBox: 'Savings box',
  trivia: 'Trivia prize',
  neighborsGift: "Neighbors' gift",
  donation: 'Donation',
  doctor: "Doctor's visit",
  doctorList: 'Health supplies',
  family: 'Family',
  wedding: 'Wedding',
  letter: 'Letter',
  lawSchool: 'Law school',
  business: 'Business bought',
  claim: 'Land claim',
  livestock: 'Livestock',
  construction: 'Construction wages',
  plowSteel: 'New plow steel',
  plowRepair: 'Plow repair',
  house: 'House',
  neighborHelp: 'Helping the neighbors',
  neighborsFarewell: "Neighbors' farewell",
};
export const reasonLabel = (r: string) => REASON_LABEL[r] ?? r;

const ym = (s: GameState) => ({ year: s.date.year, mon: s.date.mon });

/** Record what happened in one dispatch. `context` names the action for the standing ledger. */
export function ingest(j: Journal, prev: GameState, next: GameState, events: SimEvent[], context: string) {
  const months: MonthSummary[] = [];
  let cur: MonthSummary | null = null;
  for (const e of events) {
    switch (e.type) {
      case 'monthAdvanced': {
        if (cur) months.push(cur);
        cur = { year: e.year, mon: e.mon, lines: [] };
        break;
      }
      case 'cash':
        if (e.reason === 'livingCost') {
          if (cur) cur.lines.push(e.requested < 0 ? `Upkeep ${money(e.requested)}${e.delta !== e.requested ? ` (${money(e.requested - e.delta)} forgiven)` : ''}` : `Businesses ${money(e.requested, { sign: true })}`);
        }
        break;
      case 'score': {
        const reason = (e as { reason?: string }).reason ?? context;
        j.standing.push({ ...ym(next), delta: e.delta, score: e.score, reason });
        break;
      }
      case 'lifePrice': {
        const reason = (e as { reason?: string }).reason ?? context;
        j.upkeep.push({ ...ym(next), delta: e.delta, upkeep: e.lifePrice, reason });
        if (cur) cur.lines.push(`Upkeep now ${money(e.lifePrice)}/mo`);
        break;
      }
      case 'harvest': {
        const parts = e.bushels.map((b, i) => (b > 0 ? `${b.toLocaleString('en-US')} bu ${CROP_NAMES[i + 1].toLowerCase()}` : '')).filter(Boolean);
        j.keepsakes.push({ kind: 'harvest', ...ym(next), title: `Harvest: ${parts.join(', ')}`, detail: `worth about ${money(e.value)}` });
        yearOf(j, next.date.year, prev).bushels += e.bushels.reduce((a, b) => a + b, 0);
        yearOf(j, next.date.year, prev).harvestValue += e.value;
        break;
      }
      case 'disaster': {
        const t = { fire: 'Prairie fire', tornado: 'Tornado', grasshoppers: 'Grasshoppers', cattle: 'Stray cattle in the crops', animalsDied: 'Animals lost to the winter' }[e.kind];
        j.keepsakes.push({ kind: 'disaster', ...ym(next), title: t });
        yearOf(j, next.date.year, prev).events.push(`${monthName(next.date.mon)}: ${t}`);
        if (cur) cur.lines.push(t);
        break;
      }
      case 'built': {
        if (e.item.startsWith('business')) {
          const b = BUSINESSES[Number(e.item.slice(8)) - 1];
          j.keepsakes.push({ kind: 'business', ...ym(next), title: `Bought ${b?.id ?? 'a business'}` });
          yearOf(j, next.date.year, prev).events.push(`Bought ${b?.id}`);
        } else {
          const name = { house: 'Sod house raised', barn: 'Barn built', windmill: 'Well & windmill built', woodFence: 'Fence built', barbedFence: 'Fence built' }[e.item] ?? `Built ${e.item}`;
          j.keepsakes.push({ kind: 'built', ...ym(next), title: name });
          yearOf(j, next.date.year, prev).events.push(name);
        }
        break;
      }
      case 'letter':
        j.keepsakes.push({ kind: 'letter', ...ym(next), title: 'Letter', ref: e.id, detail: [e.had ?? '', e.sig ?? ''].join('|') });
        break;
      case 'townTalk':
        if (!j.talks.includes(e.id)) j.talks.push(e.id);
        break;
      case 'telegram':
        if (cur) cur.lines.push(`Telegram: O'Grady paid ${money(e.net, { cents: true })}`);
        break;
    }
  }
  if (cur) months.push(cur);
  for (const m of months) {
    if (!m.lines.length) m.lines.push('A quiet month.');
    j.summaries.push(m);
  }
  if (j.summaries.length > 60) j.summaries.splice(0, j.summaries.length - 60);
  // grain sales income for the Year in Review
  for (const e of events) if (e.type === 'cash' && (e.reason === 'grainSale' || e.reason === 'bankReceive') && e.delta > 0) yearOf(j, next.date.year, prev).sales += e.delta;
  if (events.some((e) => e.type === 'monthAdvanced' || e.type === 'dateChanged')) snapshot(j, next);
  // baby names
  for (let i = 0; i < 3; i++) {
    const a = prev.propet.babyNames[i];
    const b = next.propet.babyNames[i];
    if (a !== b && b && b !== 'a') j.keepsakes.push({ kind: 'baby', ...ym(next), title: `${b} was born`, detail: b });
  }
  if (prev.propet.numFields === 1 && next.propet.numFields === 2) j.keepsakes.push({ kind: 'claim', ...ym(next), title: 'Second claim of 160 acres signed' });
  if (prev.propet.loanAmount === 0 && next.propet.loanAmount > 0) j.keepsakes.push({ kind: 'loan', ...ym(next), title: `Loan signed: ${money(next.propet.loanAmount, { cents: true })} due Dec ${next.propet.loanDueYear}` });
  if (prev.propet.paidBigWedding === 0 && next.propet.paidBigWedding === 1) j.keepsakes.push({ kind: 'wedding', ...ym(next), title: 'A grand wedding in the town square' });
}

function yearOf(j: Journal, year: number, s: GameState): YearReview {
  let y = j.years.find((r) => r.year === year);
  if (!y) {
    y = { year, bushels: 0, harvestValue: 0, sales: 0, startWorth: netWorth(s), endWorth: netWorth(s), events: [] };
    j.years.push(y);
  }
  return y;
}

export function snapshot(j: Journal, s: GameState) {
  const last = j.snapshots[j.snapshots.length - 1];
  const snap: Snapshot = { ...ym(s), cash: s.propet.cash, savings: s.propet.savings, score: s.propet.score, upkeep: s.propet.lifePrice, netWorth: netWorth(s), loan: s.propet.loanAmount };
  if (last && last.year === snap.year && last.mon === snap.mon) j.snapshots[j.snapshots.length - 1] = snap;
  else j.snapshots.push(snap);
  yearOf(j, s.date.year, s).endWorth = snap.netWorth;
  farmSnap(j, s);
}

export function farmOf(s: GameState): FarmSnap {
  const p = s.propet;
  return {
    ...ym(s),
    house: p.house > 0 ? Math.max(1, s.globals.whatHouse || 1) : 0,
    barn: p.barn,
    windmill: p.windmill,
    extraWindmills: p.extraWindmills,
    fence: p.fence,
    tractors: p.tractors,
    car: p.car,
    horses: p.horses,
    pigs: p.pigs,
    cows: p.cows,
    planted: s.cursit.numPlanted,
    plowed: s.cursit.numPlowed,
    ripe: s.cursit.numHarved,
    fields: p.numFields,
    businesses: p.business.filter((b) => b > 0).length,
    children: p.babyNames.filter((n) => n && n !== 'a').length,
    stove: p.stove,
    camera: p.camera,
  };
}

/** One farm record per year: the latest month up to September (the farm at harvest time). */
function farmSnap(j: Journal, s: GameState) {
  if (!j.farm) j.farm = [];
  const f = farmOf(s);
  const i = j.farm.findIndex((x) => x.year === f.year);
  if (i < 0) j.farm.push(f);
  else if (f.mon <= 9 || j.farm[i].mon > 9) j.farm[i] = f;
}
