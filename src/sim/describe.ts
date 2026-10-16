// Human-friendly one-liners for toasts, logs and undo labels: every SimEvent, every reject
// reason, every dialog id, every Today-card suggestion and every command.
//
// Original words first: pass `text` (a lookup from dialog id to the verbatim original, e.g.
// `member` from src/game/text.ts) and short originals are used as-is. Long originals (letters,
// multi-paragraph advice) get a short remaster line instead; the UI shows the original in full in
// its dialog. New copy is warm and plain, for players from about ten years old to adults.
import type { SimEvent } from './events-out.ts';
import type { Command } from './commands.ts';
import type { Suggestion } from './query.ts';
import { BUSINESSES, GOAL_TEXTS, MONTHS } from './data/tables.ts';

export type TextLookup = (id: string) => string | undefined;
export type Tone = 'good' | 'bad' | 'info';

export interface Toast {
  text: string;
  tone: Tone;
  /** `original`: verbatim 1996 text; `remaster`: new copy */
  source: 'original' | 'remaster';
  /** bookkeeping events most UIs will not toast (log rows, scene ids, run markers) */
  quiet?: boolean;
}

export interface DescribeOptions {
  /** verbatim original text by dialog id (optional) */
  text?: TextLookup;
  /** longest original used as a toast; longer ones fall back to the short line (default 160) */
  maxOriginal?: number;
  /** classic money format "$-5.00" (CURRENCY quirk); default "-$5.00" */
  classicCurrency?: boolean;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "$1,234.50". Negative: "-$5.00" (or the original's "$-5.00" with `classic`). */
export function money(n: number, classic = false): string {
  const neg = n < 0;
  const abs = Math.round(Math.abs(n) * 100) / 100;
  const [d, c] = abs.toFixed(2).split('.');
  const body = `${d.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${c}`;
  if (!neg) return `$${body}`;
  return classic ? `$-${body}` : `-$${body}`;
}
const signed = (n: number, classic = false) => (n > 0 ? `+${money(n, classic)}` : money(n, classic));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const monthName = (m: number) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] ?? `month ${m}`;
const tidy = (t: string) => t.replace(/\s+/g, ' ').replace(/’/g, "'").trim();
const CROPS = ['', 'winter wheat', 'spring wheat', 'oats', 'corn'];
export const businessName = (k: number) => BUSINESSES[k - 1]?.id ?? `business ${k}`;
const ITEMS: Record<string, string> = {
  house: 'the sod house',
  barn: 'the barn',
  windmill: 'the windmill and well',
  woodFence: 'the wooden fence',
  barbedFence: 'the barbed-wire fence',
  woodenFence: 'the wooden fence',
  windMill: 'a windmill',
  wireFence: 'barbed-wire fence',
  kodakCamera: 'a Kodak camera',
  tractor: 'a tractor',
  car: 'a car',
};
export const itemName = (id: string) => ITEMS[id] ?? (id.startsWith('business') ? businessName(Number(id.slice(8))) : id);

// ---------------------------------------------------------------------------
// Dialog ids (the neighbours, clerks and family). Short lines; originals preferred when short.
// ---------------------------------------------------------------------------

const DIALOG: Record<string, [string, Tone]> = {
  // calendar / farm
  T623: ['Your neighbors raised your sod house in two days. Welcome home!', 'good'],
  NoBuild: ['Before winter you need a barn for the animals and a well for water.', 'info'],
  OnlyBuild: ["You've bought a windmill. Build it so the family can stop hauling water.", 'info'],
  NoWM: ['The creek is drying up. Buy a windmill and the neighbors will help you dig a well.', 'info'],
  WMEOG: ['You still have no well. Buy a windmill and a neighbor will help you build it.', 'info'],
  NoBarn: ['Your animals need a barn for shade and shelter.', 'info'],
  AnimD: ['The cold killed your animals. Without a cow, milk costs $10 a month.', 'bad'],
  AfterTorn: ['The tornado wrecked your farm. Rebuild before winter.', 'bad'],
  BuildFence: ['You need to build a fence.', 'info'],
  NoFence1: ['Cattle trampled some of your crops. A fence would keep them out.', 'bad'],
  NoFence2: ['Cattle trampled some of your crops. Barbed wire from the store would keep them out.', 'bad'],
  Fire: ['A prairie fire burned the crops. Replant if there is still time.', 'bad'],
  Rep: ['The tornado damaged your farm. Fix things soon; winter is coming.', 'bad'],
  GrH: ['Grasshoppers ate the crops. Replant if there is still time.', 'bad'],
  TakeMail: ["There's a letter in your mailbox.", 'info'],
  GameIsOver: ['Your game is over.', 'info'],
  NothToB: ['There is nothing left to build.', 'info'],
  CantBuild: ['Too cold to build. Wait for early spring (March).', 'info'],
  // money crisis
  NoM: ["You don't have enough money for that.", 'bad'],
  NOM1: ['Your neighbors collected $100 to help you through.', 'good'],
  NoM1: ['Your neighbors collected $100 to help you through.', 'good'],
  NoM2: ['Money is short. Take some out of the savings box under your bed.', 'info'],
  NoM3: ['Money is short. Sell your grain at the elevator.', 'info'],
  NoM4: ['Money is short. The bank can lend you money against your land.', 'info'],
  NOM5: ['You ran out of money. The neighbors gave $50 for the trip back east.', 'bad'],
  NoM5: ['You ran out of money. The neighbors gave $50 for the trip back east.', 'bad'],
  NoM6: ["You ran out of money and are heading back east.", 'bad'],
  LoanRet: ['Your loan is due. Repay it at the bank by the end of December.', 'info'],
  LoanEnd: ["You couldn't repay the loan, so the bank took the farm.", 'bad'],
  // field
  NoPlow1: ['These fields are already plowed.', 'info'],
  NoPlow3: ['The ground is frozen. Plowing starts again in April.', 'info'],
  NoPlow4: ['Summer rains have made the fields too muddy. Plow again in the fall.', 'info'],
  NoPlow5: ['Harvest the crop that is in the field first.', 'info'],
  NoPlant1: ['You have no seed. The store sells it.', 'info'],
  NoPlant2: ['Plow first, then plant.', 'info'],
  NoPlant3: ['Plow first, or the wind will scatter your seed.', 'info'],
  NoPlant4: ['Harvest the crop that is in the field first.', 'info'],
  NoPlant5: ["That seed isn't planted this season. Spring crops go in Apr-Jun, winter wheat Sep-Nov.", 'info'],
  NoPlant6: ['The ground is still frozen. Wait until April.', 'info'],
  NoPlant7: ["All the land you plowed is already planted.", 'info'],
  NoHarv1: ['Your crop is still growing. Give it time.', 'info'],
  NoHarv2: ['You have to plant before you can harvest.', 'info'],
  NoHarv3: ['Nothing to harvest yet: plow, plant, then wait.', 'info'],
  StopPlow1: ['Summer rains stopped the plowing. The fields are too muddy.', 'bad'],
  StopPlow2: ['The ground froze before you finished plowing.', 'bad'],
  StopPlow3: ['Your plow broke!', 'bad'],
  StopPlow4: ['A horse is sick, so plowing takes twice as long.', 'bad'],
  StopHarv1: ['Early summer rains ruined the rest of the crop.', 'bad'],
  StopHarv2: ['An early frost killed the rest of the crop.', 'bad'],
  NoMoney: ["Not enough cash for a new plow, so you'll repair the old one.", 'bad'],
  OneWor: ["The hired hand won't work unless you can pay the wages.", 'bad'],
  ManyWor: ["The hired hands won't work unless you can pay their wages.", 'bad'],
  FDBK7: ['Plowing done. Now you can plant.', 'good'],
  EndHarv: ['Harvest is in! Now sell it in town.', 'good'],
  EndHarv1: ['Harvest is in! Now sell it in town.', 'good'],
  // livestock / town
  NoBuy: ["You don't have enough money to buy these animals.", 'bad'],
  No1894: ["The railroad strike has filled the elevator. It can't buy grain until the strike ends.", 'bad'],
  NoSale: ['You have nothing to sell.', 'info'],
  // store
  SEG69: ['Harriet works out the total for you: {total}.', 'info'],
  SEG70: ['Thank you! Your seed is in the wagon.', 'good'],
  SEG71: ["You don't have enough cash for this order.", 'bad'],
  SEG72: ["That's not enough money. Check your total again.", 'info'],
  SEG73: ["That's too much money. Check your total again.", 'info'],
  // bank
  LoanAlready: ['You already have a loan. Repay it before taking another.', 'info'],
  needharvest: ['The bank lends only to farmers who have worked their fields. Come back after your first job in the field.', 'info'],
  LoanOK: ['Loan approved. Remember to save so you can repay it on time.', 'good'],
  SEG008: ["The bank won't lend more than your land is worth.", 'info'],
  NoMoneyCashier: ['There is no money waiting for you at the bank.', 'info'],
  TakeMoney: ["Here's your money.", 'good'],
  NothingToReturn: ["You don't have a loan to repay.", 'info'],
  BigReturn: ["You don't have enough cash to repay the loan yet.", 'bad'],
  OK: ['Loan repaid. Thank you!', 'good'],
  // house
  NotEnoughMoneyBox: ['Not enough money for that.', 'bad'],
  NH1: ['You can afford new furniture for the house ($200).', 'info'],
  NH2: ['You can afford a ready-made wooden house ($1,000).', 'info'],
  // events
  Son3: ['Your son has left for California to seek his fortune.', 'info'],
  Sys836: ["Those projects cost more than this year's town budget.", 'bad'],
  Extra1: ['The council heard your answers.', 'info'],
  Extra2: ['The council liked your answers!', 'good'],
  MyGoal: ['Your new goal: {goal}', 'good'],
  Goal1: ["You're a successful homestead farmer! What next?", 'good'],
  Goal2: ["You're a successful homestead farmer! What next?", 'good'],
  Goal3: ["You're a farmer who is successful in business! What next?", 'good'],
  Goal4: ["You're a farmer who is successful in business! What next?", 'good'],
};

/** Dialog ids the describe layer knows (for coverage tests). */
export const KNOWN_DIALOG_IDS = Object.keys(DIALOG);

function fill(t: string, params?: Record<string, string | number>): string {
  if (!params) return t;
  return t.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return k === 'total' && typeof v === 'number' ? money(v) : String(v);
  });
}

/** Toast for a dialog id; prefers the verbatim original when it is short. */
export function describeDialog(id: string, params?: Record<string, string | number>, opts: DescribeOptions = {}): Toast {
  const short = DIALOG[id];
  const orig = opts.text?.(id);
  const max = opts.maxOriginal ?? 160;
  if (orig && !/\{|FIRSTNAME|son2/.test(orig) && tidy(orig).length <= max && !params) return { text: tidy(orig), tone: short?.[1] ?? 'info', source: 'original' };
  if (short) return { text: fill(short[0], params), tone: short[1], source: 'remaster' };
  if (orig) return { text: tidy(orig).slice(0, max - 1).replace(/\s+\S*$/, '') + '…', tone: 'info', source: 'original' };
  return { text: 'A neighbor has something to tell you.', tone: 'info', source: 'remaster' };
}

// ---------------------------------------------------------------------------
// Reject reasons
// ---------------------------------------------------------------------------

const REJECT: Record<string, string> = {
  gameOver: 'The game is over.',
  promptPending: 'Answer the letter or message first.',
  calendarRunning: 'The calendar is running. Pause it first.',
  calendarNotRunning: "The calendar isn't running.",
  visitTownTalkFirst: 'Go hear what the town is talking about first.',
  noMail: 'There is no mail today.',
  noTownTalk: 'Nobody in town has news right now.',
  noTrivia: 'There is no trivia card to answer.',
  noNeighborHelpPending: 'No neighbor is asking for help.',
  noEventPending: 'There is no letter to answer.',
  noMessagePending: 'There is no message to close.',
  invalidGoalAnswer: 'Pick one of the answers.',
  invalidHelpers: "You can't bring that many helpers.",
  noSquaresSelected: 'Choose the squares you want to plow.',
  nothingPlanted: 'Nothing was planted: pick plowed squares and seed for this season (20 acres a square).',
  notBuildable: "That isn't on your list of things to build.",
  marketClosed: 'The livestock fair is open in April and May, once you have a barn.',
  invalidQuantity: "That's not a quantity you can choose.",
  nothingSelected: 'Choose something first.',
  notEnoughAnimals: 'You need to keep at least one animal (and one horse).',
  noOgradyToday: "O'Grady's wagon isn't in town today.",
  notForSale: "That business isn't for sale right now.",
  claimNotAvailable: 'The land office has no claim for you right now.',
  invalidLoan: 'Choose an amount up to $9,999 and a term of 1, 3 or 5 years.',
  repayNotOffered: 'The bank takes repayment in November and December of the year it is due.',
  invalidOrder: 'Choose a seed and how many acres you want.',
  notInCatalog: "That isn't in the catalog yet.",
  noHouse: "You don't have a house yet.",
  noHouseOffer: 'There is no offer to answer.',
  invalidAmount: 'Enter an amount above zero.',
  albumPageLocked: "The album's first two pages are already written.",
  devcutDisabled: "That's only in the Developer's Cut.",
  noSuchFreightOffer: 'That freight offer is gone.',
};
export const KNOWN_REJECT_REASONS = Object.keys(REJECT);

export function describeReject(reason: string, dialogId?: string, opts: DescribeOptions = {}): Toast {
  if (dialogId) return describeDialog(dialogId, undefined, opts);
  return { text: REJECT[reason] ?? "You can't do that right now.", tone: 'info', source: 'remaster' };
}

// ---------------------------------------------------------------------------
// Reasons on cash / savings / score / lifePrice events
// ---------------------------------------------------------------------------

const CASH: Record<string, string> = {
  livingCost: 'Upkeep for the month',
  neighborsGift: "Your neighbors' gift",
  neighborsFarewell: "Your neighbors' farewell gift",
  trivia: 'Trivia prize',
  plowSteel: 'New plow steel',
  plowRepair: 'Plow repair',
  workers: 'Wages for hired hands',
  construction: 'Wages for the builders',
  livestock: 'Livestock',
  grainSale: 'Grain sold at the elevator',
  business: 'Bought a business',
  claim: 'Land office fee',
  bankReceive: 'Money collected at the bank',
  loan: 'Bank loan',
  loanRepay: 'Loan repaid',
  seeds: 'Seed',
  catalog: 'Catalog order',
  house: 'House upgrade',
  savingsBox: 'Savings box',
  donation: 'Donation',
  doctor: "Doctor's visit",
  doctorList: "Doctor's list",
  family: 'For the family',
  letter: 'Letter',
  wedding: 'Wedding',
  lawSchool: 'Law school fees',
  neighborHelp: 'Helping a neighbor',
};
export const KNOWN_CASH_REASONS = Object.keys(CASH);
export const cashReason = (r: string) => CASH[r] ?? r.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** What a score/LifePrice `reason` (event text id or key) refers to, in a few words. */
export function reasonLabel(r: string): string {
  if (/^business[1-4]$/.test(r)) return `buying ${businessName(Number(r.slice(8)))}`;
  const fixed: Record<string, string> = {
    claim: 'the second claim',
    doctorList: "the doctor's list",
    ownCow: 'owning a milk cow',
    noCow: 'no milk cow',
    AnimD: 'losing the animals',
    pricesFell: 'lower prices in town',
    AL54: 'your son leaving law school',
    AL25: 'your son coming home',
  };
  if (fixed[r]) return fixed[r];
  if (/^Baby/.test(r)) return 'a new baby';
  if (/^DL(10|20|22)$/.test(r)) return 'helping your child';
  if (/^DL/.test(r)) return 'your donation';
  if (/^Wed/.test(r)) return 'the wedding';
  if (/^Sop/.test(r)) return 'school supplies';
  if (/^(Da|DaW|Dat)/.test(r)) return 'a family decision';
  if (/^Son/.test(r)) return "your son's news";
  if (/^ALM/.test(r)) return 'politics';
  if (/^AL/.test(r)) return 'a letter';
  if (/^Doc/.test(r)) return "the doctor's visit";
  if (/^List/.test(r)) return 'the town budget';
  return r;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const DISASTER: Record<string, string> = {
  fire: 'Prairie fire! The crops are burned.',
  tornado: 'A tornado wrecked the barn and windmill!',
  grasshoppers: 'Grasshoppers swarmed in and ate the crops!',
  cattle: 'Stray cattle trampled part of the crop.',
  animalsDied: 'Winter cold killed the animals with no barn to shelter them.',
};
const STOP: Record<string, string> = {
  townTalk: 'The calendar stopped: folks in town have news.',
  stopRequested: 'The calendar stopped where you asked.',
  plantingSeason: 'The calendar stopped: field season is here.',
  mail: 'The calendar stopped: you have mail.',
  letter: 'The calendar stopped: a letter arrived.',
  event: 'The calendar stopped: something happened at home.',
  monthCheck: 'The calendar stopped: a neighbor stopped by.',
  money: 'The calendar stopped: money is running short.',
  neighborHelp: 'The calendar stopped: a neighbor needs your help.',
  disaster: 'The calendar stopped: disaster on the prairie.',
};
const DATE_REASON: Record<string, string> = {
  plow: 'plowing',
  plowRepair: 'repairing the plow',
  harvest: 'harvesting',
  build: 'building',
  houseBuilt: 'raising the sod house',
  neighborHelp: 'helping a neighbor',
};
const GAME_OVER: Record<string, string> = {
  bankrupt: 'You ran out of money and the family heads back east.',
  foreclosed: 'The bank took the farm for the unpaid loan.',
  retired: 'You handed the homestead to your son and retired. Well done!',
  completed: 'Forty years on the prairie! Your homestead story is complete.',
};
const LOG_LOC = ['', 'Bank', 'Farm house', 'Fields', 'Store', 'Game board', 'Grain dealer', 'Livestock market', "O'Grady"];
const LOG_ACT = ['', 'Received', 'Borrowed', 'Repaid', 'Interest', 'Info', 'Sold', 'Plowed', 'Planted', 'Harvested', 'Built', 'Hired hands', 'Trivia', 'Surprise', 'Bought', 'Sold', 'Put away', 'Took out', 'Bought'];

/** One-line toast for a sim event. */
export function describeEvent(e: SimEvent, opts: DescribeOptions = {}): Toast {
  const r = (text: string, tone: Tone = 'info', quiet = false): Toast => ({ text, tone, source: 'remaster', ...(quiet ? { quiet } : {}) });
  const cc = opts.classicCurrency;
  switch (e.type) {
    case 'dialog':
      return describeDialog(e.id, e.params, opts);
    case 'prompt': {
      const p = e.prompt;
      if (p.kind === 'message') return { ...describeDialog(p.text, p.params, opts), quiet: true };
      if (p.kind === 'neighborHelp') return r(`A neighbor asks for ${plural(p.days, 'day')} of help.`, 'info', true);
      if (p.kind === 'houseOffer') return { ...describeDialog(p.text, undefined, opts), quiet: true };
      if (p.kind === 'goalChoice') return { ...describeDialog(p.text, undefined, opts), quiet: true };
      if (p.kind === 'politicianLetter') return r('A letter about town politics.', 'info', true);
      return r('A decision is waiting for you.', 'info', true);
    }
    case 'cash':
      if (e.delta === 0 && e.requested === 0) return r(`${cashReason(e.reason)}.`, 'info', true);
      if (e.delta !== e.requested && e.requested < 0)
        return r(`${cashReason(e.reason)}: ${money(e.requested, cc)}, but you only had ${money(-e.delta, cc)}.`, 'bad');
      if (e.reason === 'livingCost' && e.delta > 0) return r(`Business income after upkeep: ${signed(e.delta, cc)}.`, 'good');
      return r(`${cashReason(e.reason)}: ${signed(e.delta, cc)}.`, e.delta > 0 ? 'good' : e.delta < 0 ? 'bad' : 'info', e.reason === 'savingsBox');
    case 'savings':
      return r(e.reason === 'savingsBox' ? (e.delta > 0 ? `Put ${money(e.delta, cc)} in the savings box.` : `Took ${money(-e.delta, cc)} out of the savings box.`) : `Savings: ${signed(e.delta, cc)} (${cashReason(e.reason).toLowerCase()}).`, e.delta >= 0 ? 'good' : 'bad');
    case 'score':
      return r(`Standing ${e.delta > 0 ? '+' : ''}${e.delta} for ${reasonLabel(e.reason)}.`, e.delta > 0 ? 'good' : 'bad');
    case 'lifePrice':
      return r(`Upkeep ${e.delta > 0 ? 'up' : 'down'} ${money(Math.abs(e.delta), cc)} a month (${reasonLabel(e.reason)}).`, e.delta > 0 ? 'bad' : 'good');
    case 'dateChanged':
      return r(`${DATE_REASON[e.reason] ? `After ${DATE_REASON[e.reason]}, it` : 'It'} is now ${monthName(e.mon)} ${e.day}, ${e.year}.`, 'info', true);
    case 'monthAdvanced':
      return r(`${monthName(e.mon)} ${e.year}.`, 'info');
    case 'scene':
      return r('The season changes on the prairie.', 'info', true);
    case 'disaster':
      return r(e.kind === 'cattle' && e.squares ? `Stray cattle trampled ${plural(e.squares, 'square')} of crops.` : DISASTER[e.kind], 'bad');
    case 'calendarStarted':
      return r('The calendar is running.', 'info', true);
    case 'calendarRunning':
      return r(`${monthName(e.mon)} ${e.year}…`, 'info', true);
    case 'calendarStopped':
      return r(STOP[e.reason] ?? 'The calendar stopped.', 'info');
    case 'mail':
      return r("There's a letter in your mailbox.", 'info');
    case 'letter':
      return r('A letter has arrived.', 'info');
    case 'townTalkAvailable':
      return r('Folks in town are talking. Go and listen!', 'info');
    case 'townTalk':
      return r('You listen to the talk in town.', 'info', true);
    case 'trivia':
      return r('A trivia card! Answer it for a cash prize.', 'info');
    case 'triviaAnswered':
      return e.correct ? r(`Right answer! You win ${money(e.bonus, cc)}.`, 'good') : r('Not quite. Better luck next time!', 'info');
    case 'harvest':
      return r(`You harvested ${e.bushels.reduce((a, b) => a + b, 0).toLocaleString('en-US')} bushels, worth about ${money(e.value, cc)}.`, 'good');
    case 'built':
      return r(e.item.startsWith('business') ? `You now own ${businessName(Number(e.item.slice(8)))}!` : `${itemName(e.item).replace(/^./, (c) => c.toUpperCase())} is built.`, 'good');
    case 'goalReached':
      return r('You reached your goal!', 'good');
    case 'gameOver':
      return r(GAME_OVER[e.reason] ?? 'The game is over.', e.reason === 'bankrupt' || e.reason === 'foreclosed' ? 'bad' : 'good');
    case 'log': {
      const l = e.entry;
      const amt = l.income ? ` ${signed(l.income, cc)}` : l.cost ? ` ${money(-l.cost, cc)}` : '';
      return r(`Ledger: ${LOG_ACT[l.act] ?? 'Entry'} (${LOG_LOC[l.loc] ?? 'farm'})${amt}.`, 'info', true);
    }
    case 'telegram':
      return r(`Telegram from O'Grady: part of your grain was lost. The bank holds ${money(e.net, cc)} for you.`, 'bad');
    case 'rejected':
      return describeReject(e.reason, e.dialog, opts);
    default: {
      const t = (e as { type: string }).type;
      return r(t, 'info', true);
    }
  }
}

// ---------------------------------------------------------------------------
// Today card (query.todaySuggestions)
// ---------------------------------------------------------------------------

/** "You can..." line for a Today-card suggestion. */
export function describeSuggestion(sg: Suggestion): string {
  const p = sg.params ?? {};
  const n = (k: string) => Number(p[k] ?? 0);
  switch (sg.id) {
    case 'gameOver':
      return 'Your story is complete.';
    case 'answerPrompt':
      return 'Read the letter waiting for you.';
    case 'calendarRunning':
      return 'The months are passing. Pause any time.';
    case 'visitTownTalkFirst':
      return 'Folks in town are waiting to meet you. Go listen to them.';
    case 'advanceToBuildHouse':
      return 'Press Advance and your neighbors will raise your sod house.';
    case 'openMail':
      return 'You can open your mailbox: a letter is waiting.';
    case 'visitTownTalk':
      return 'You can hear the latest news in town.';
    case 'answerTrivia':
      return 'You can answer the trivia card for a prize.';
    case 'lowRunway':
      return n('months') <= 0 ? 'Money has run out for upkeep. Sell grain, use savings or borrow.' : `Your money covers about ${plural(n('months'), 'month')} of upkeep.`;
    case 'collectMoney':
      return `You can collect ${money(n('amount'))} at the bank.`;
    case 'build':
      return `You can build ${itemName(String(p.item))}.`;
    case 'buildLater':
      return `You can build ${itemName(String(p.item))} when spring comes (March).`;
    case 'harvest':
      return `You can harvest ${plural(n('squares'), 'ripe square')}.`;
    case 'sellGrain':
      return `You can sell ${n('bushels').toLocaleString('en-US')} bushels at the elevator for about ${money(n('value'))}.`;
    case 'sellAfterStrike':
      return 'The railroad strike blocks grain sales. Your grain will keep until it ends.';
    case 'plant':
      return `You can plant ${plural(n('squares'), 'plowed square')}.`;
    case 'buySeeds':
      return `You can buy seed at the store for ${plural(n('squares'), 'plowed square')}.`;
    case 'plow':
      return 'You can plow your fields.';
    case 'repayLoan':
      return `You can repay your loan of ${money(n('amount'))} at the bank.`;
    case 'loanDueThisYear':
      return `Your loan of ${money(n('amount'))} is due this December.`;
    case 'livestockFair':
      return 'You can buy or sell animals at the livestock fair.';
    case 'businessForSale':
      return `${businessName(n('business'))} is for sale for ${money(n('price'))}.`;
    case 'claimAvailable':
      return `You can claim 160 more acres at the land office for ${money(n('price'))}.`;
    case 'houseUpgrade':
      return 'You can afford to improve your house.';
    case 'saveMoney':
      return 'You can put spare cash in the savings box under the bed.';
    case 'advance':
      return 'You can advance the calendar.';
    default:
      return '';
  }
}

export const KNOWN_SUGGESTIONS = ['gameOver', 'answerPrompt', 'calendarRunning', 'visitTownTalkFirst', 'advanceToBuildHouse', 'openMail', 'visitTownTalk', 'answerTrivia', 'lowRunway', 'collectMoney', 'build', 'buildLater', 'harvest', 'sellGrain', 'sellAfterStrike', 'plant', 'buySeeds', 'plow', 'repayLoan', 'loanDueThisYear', 'livestockFair', 'businessForSale', 'claimAvailable', 'houseUpgrade', 'saveMoney', 'advance'];

// ---------------------------------------------------------------------------
// Commands (undo labels, logs)
// ---------------------------------------------------------------------------

/** Short label for a command ("Bought seed", "Plowed 4 squares"), for Undo and history. */
export function describeCommand(cmd: Command): string {
  switch (cmd.type) {
    case 'startCalendar':
      return cmd.months === 1 ? 'Advanced a month' : 'Advanced the calendar';
    case 'continueCalendar':
      return 'Calendar running';
    case 'stopCalendar':
      return 'Paused the calendar';
    case 'ack':
      return 'Read a message';
    case 'resolveEvent':
      return 'Answered a letter';
    case 'answerNeighborHelp':
      return cmd.yes ? 'Helped a neighbor' : 'Turned down a neighbor';
    case 'answerTrivia':
      return 'Answered the trivia card';
    case 'openMail':
      return 'Opened the mail';
    case 'visitTownTalk':
      return 'Listened to the town talk';
    case 'enterField':
      return 'Went to the field';
    case 'plow':
      return `Plowed ${plural(cmd.squares.length, 'square')}`;
    case 'plant':
      return `Planted ${plural(cmd.plantings.length, 'square')}`;
    case 'harvest':
      return 'Harvested';
    case 'build':
      return `Built ${itemName(cmd.item)}`;
    case 'enterLivestockMarket':
      return 'Went to the livestock fair';
    case 'buyLivestock':
      return 'Bought animals';
    case 'sellLivestock':
      return 'Sold animals';
    case 'enterTown':
      return 'Went to town';
    case 'sellGrain':
      return cmd.dealer === 'ogrady' ? "Sold grain to O'Grady" : 'Sold grain at the elevator';
    case 'buyBusiness':
      return `Bought ${businessName(cmd.business)}`;
    case 'buyClaim':
      return 'Filed the second claim';
    case 'enterBank':
      return 'Went to the bank';
    case 'collectMoney':
      return 'Collected money';
    case 'takeLoan':
      return `Borrowed ${money(cmd.amount)}`;
    case 'repayLoan':
      return 'Repaid the loan';
    case 'buySeeds':
      return `Bought ${cmd.acres} acres of ${CROPS[cmd.crop]} seed`;
    case 'buyCatalogItem':
      return `Bought ${itemName(cmd.name)}`;
    case 'enterHouse':
      return 'Went home';
    case 'answerHouseOffer':
      return cmd.yes ? 'Improved the house' : 'Kept the old house';
    case 'depositSavings':
      return `Saved ${money(cmd.amount)}`;
    case 'withdrawSavings':
      return `Took out ${money(cmd.amount)}`;
    case 'setAlbumPage':
      return 'Wrote in the album';
    default:
      return (cmd as { type: string }).type;
  }
}

/** "June 1909" */
export const dateLabel = (year: number, mon: number) => `${monthName(mon)} ${year}`;
/** Short month as the original prints it ("Sept."). */
export const shortMonth = (mon: number) => MONTHS[mon - 1];
/** Goal text as the original prints it. */
export const goalText = (goal: number) => GOAL_TEXTS[goal] ?? '';
