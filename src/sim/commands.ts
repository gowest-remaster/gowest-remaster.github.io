// Command API: pure `(state, command) -> { state, events }`. The input state is never
// mutated (commands run on a structured clone). Convenience wrappers are exported below.
import type { Ctx } from './ctx.ts';
import { quirk, reject } from './ctx.ts';
import type { SimEvent } from './events-out.ts';
import type { CatalogName } from './data/tables.ts';
import { ackMessage, resolveEvent, type EventChoice } from './events.ts';
import { enterField, harvest, plant, plow, type Helpers, type HarvestOptions, type Planting, type PlowOptions } from './field.ts';
import { build, buyLivestock, enterLivestockMarket, sellLivestock, type Animals, type BuildItem } from './farm.ts';
import { buyBusiness, buyClaim, enterTown, sellGrain } from './town.ts';
import { collectMoney, enterBank, repayLoan, takeLoan } from './bank.ts';
import { buyCatalogItem, buySeeds } from './store.ts';
import { answerHouseOffer, depositSavings, enterHouse, withdrawSavings } from './house.ts';
import { answerNeighborHelp, answerTrivia, continueCalendar, startCalendar, stopCalendar, takeMail, visitBegin, visitTownTalk, type RunOptions } from './turn.ts';
import { migrateState, type Crop, type GameState } from './state.ts';
import { albumMaxPictures } from './album.ts';
import { recordDecision } from './bookkeeping.ts';
import { devcutAfter, devcutBefore, type DevCutAction } from './devcut.ts'; // [devcut]

export type Command =
  | { type: 'startCalendar'; months?: number; yieldEachMonth?: boolean }
  | { type: 'continueCalendar' }
  | { type: 'stopCalendar' }
  | { type: 'ack' }
  | { type: 'resolveEvent'; choice: EventChoice }
  | { type: 'answerNeighborHelp'; yes: boolean }
  | { type: 'answerTrivia'; answer: number }
  | { type: 'openMail' }
  | { type: 'visitTownTalk' }
  | { type: 'enterField' }
  | ({ type: 'plow' } & PlowOptions)
  | { type: 'plant'; plantings: Planting[] }
  | ({ type: 'harvest' } & HarvestOptions)
  | { type: 'build'; item: BuildItem; helpers?: Helpers }
  | { type: 'enterLivestockMarket' }
  | ({ type: 'buyLivestock' } & Animals)
  | ({ type: 'sellLivestock' } & Animals)
  | { type: 'enterTown' }
  | { type: 'sellGrain'; dealer: 'local' | 'ogrady' }
  | { type: 'buyBusiness'; business: number }
  | { type: 'buyClaim' }
  | { type: 'enterBank' }
  | { type: 'collectMoney' }
  | { type: 'takeLoan'; amount: number; years: number }
  | { type: 'repayLoan' }
  | { type: 'buySeeds'; crop: Crop; acres: number; typedTotal?: number }
  | { type: 'buyCatalogItem'; name: CatalogName; qty: number }
  | { type: 'enterHouse' }
  | { type: 'answerHouseOffer'; yes: boolean }
  | { type: 'depositSavings'; amount: number }
  | { type: 'withdrawSavings'; amount: number }
  | { type: 'setAlbumPage'; page: number; text?: string; picture?: number }
  /** [devcut] Developer's Cut actions (sim/devcut.ts); rejected in normal games. */
  | { type: 'devcut'; action: DevCutAction };

export interface CommandResult {
  state: GameState;
  events: SimEvent[];
}

const PROMPT_COMMANDS = new Set<Command['type']>(['ack', 'resolveEvent', 'answerNeighborHelp', 'answerHouseOffer']);
const CALENDAR_RUN_COMMANDS = new Set<Command['type']>(['continueCalendar', 'stopCalendar']);
/** Prompt answers that are logged in `extra.decisions`. */
const DECISION_COMMANDS = new Set<Command['type']>(['resolveEvent', 'answerNeighborHelp', 'answerHouseOffer']);
const SESSION_OF: Partial<Record<Command['type'], keyof GameState['sessions']>> = {
  enterField: 'field', plow: 'field', plant: 'field', harvest: 'field',
  enterLivestockMarket: 'livestock', buyLivestock: 'livestock', sellLivestock: 'livestock',
  enterTown: 'town', sellGrain: 'town', buyBusiness: 'town', buyClaim: 'town',
  buySeeds: 'store', buyCatalogItem: 'store',
};

export function dispatch(state: GameState, cmd: Command): CommandResult {
  const ctx: Ctx = { s: migrateState(structuredClone(state)), out: [] };
  const s = ctx.s;
  if (s.extra.ended) {
    reject(ctx, 'gameOver');
    return { state: s, events: ctx.out };
  }
  const isPromptCmd = PROMPT_COMMANDS.has(cmd.type);
  if (s.pending && !isPromptCmd) {
    reject(ctx, 'promptPending');
    return { state: s, events: ctx.out };
  }
  // A yielded calendar run is modal: only continue/stop until it stops.
  if (s.extra.calendar.running !== CALENDAR_RUN_COMMANDS.has(cmd.type)) {
    reject(ctx, s.extra.calendar.running ? 'calendarRunning' : 'calendarNotRunning');
    return { state: s, events: ctx.out };
  }
  // TRIVKEEP: the original closes the trivia card on any other command.
  if (cmd.type !== 'answerTrivia' && quirk(ctx, 'TRIVKEEP')) s.extra.triviaOpen = false;
  // Location rolls (wage, dealers, livestock prices) last for one visit.
  for (const key of Object.keys(s.sessions) as (keyof GameState['sessions'])[]) if (SESSION_OF[cmd.type] !== key) s.sessions[key] = null;
  const prevPrompt = s.pending;
  const before = DECISION_COMMANDS.has(cmd.type) ? structuredClone(s) : null;
  const dc = devcutBefore(ctx, cmd); // [devcut] null (no-op) unless s.devcut?.enabled
  if (!dc?.handled) run(ctx, cmd);
  devcutAfter(ctx, dc); // [devcut]
  if (before && !ctx.out.some((e) => e.type === 'rejected')) recordDecision(before, s, decisionChoice(cmd));
  // A calendar prompt chain that ends returns to the map (Begin frame).
  if (isPromptCmd && prevPrompt && prevPrompt.kind !== 'houseOffer' && !s.pending && !s.extra.ended) visitBegin(ctx);
  return { state: s, events: ctx.out };
}

function decisionChoice(cmd: Command): Record<string, unknown> {
  if (cmd.type === 'resolveEvent') return { ...cmd.choice };
  if (cmd.type === 'answerNeighborHelp' || cmd.type === 'answerHouseOffer') return { yes: cmd.yes };
  return {};
}

function run(ctx: Ctx, cmd: Command) {
  const s = ctx.s;
  switch (cmd.type) {
    case 'startCalendar':
      return startCalendar(ctx, { months: cmd.months, yieldEachMonth: cmd.yieldEachMonth } satisfies RunOptions);
    case 'continueCalendar':
      return continueCalendar(ctx);
    case 'stopCalendar':
      return stopCalendar(ctx);
    case 'ack':
      return void ackMessage(ctx);
    case 'resolveEvent':
      return void resolveEvent(ctx, cmd.choice);
    case 'answerNeighborHelp':
      return answerNeighborHelp(ctx, cmd.yes);
    case 'answerTrivia':
      return answerTrivia(ctx, cmd.answer);
    case 'openMail':
      return s.globals.mail > 0 ? takeMail(ctx) : reject(ctx, 'noMail');
    case 'visitTownTalk':
      return visitTownTalk(ctx);
    case 'enterField':
      return void enterField(ctx);
    case 'plow':
      return plow(ctx, cmd);
    case 'plant':
      return plant(ctx, cmd.plantings);
    case 'harvest':
      return harvest(ctx, cmd);
    case 'build':
      return build(ctx, cmd.item, cmd.helpers ?? { workers: 0, neighbors: 0, family: 0 });
    case 'enterLivestockMarket':
      return void enterLivestockMarket(ctx);
    case 'buyLivestock':
      return buyLivestock(ctx, cmd);
    case 'sellLivestock':
      return sellLivestock(ctx, cmd);
    case 'enterTown':
      return void enterTown(ctx);
    case 'sellGrain':
      return sellGrain(ctx, cmd.dealer);
    case 'buyBusiness':
      return buyBusiness(ctx, cmd.business);
    case 'buyClaim':
      return buyClaim(ctx);
    case 'enterBank':
      return enterBank(ctx);
    case 'collectMoney':
      return collectMoney(ctx);
    case 'takeLoan':
      return takeLoan(ctx, cmd.amount, cmd.years);
    case 'repayLoan':
      return repayLoan(ctx);
    case 'buySeeds':
      return buySeeds(ctx, cmd.crop, cmd.acres, cmd.typedTotal);
    case 'buyCatalogItem':
      return buyCatalogItem(ctx, cmd.name, cmd.qty);
    case 'enterHouse':
      return enterHouse(ctx);
    case 'answerHouseOffer':
      return answerHouseOffer(ctx, cmd.yes);
    case 'depositSavings':
      return depositSavings(ctx, cmd.amount);
    case 'withdrawSavings':
      return withdrawSavings(ctx, cmd.amount);
    case 'setAlbumPage': {
      const page = Math.trunc(cmd.page);
      if (page < 3 || page > 50) return reject(ctx, 'albumPageLocked');
      if (cmd.text !== undefined) s.album.texts[page - 1] = cmd.text;
      if (cmd.picture !== undefined) {
        let pic = Math.max(0, Math.trunc(cmd.picture));
        if (!quirk(ctx, 'ALBUMPIC')) pic = Math.min(pic, albumMaxPictures(s));
        s.album.pictures[page - 1] = pic;
      }
      s.album.curPage = page;
      s.album.lastPage = Math.max(s.album.lastPage, page);
      return;
    }
  }
}

// ---- convenience wrappers ----
type ArgsOf<K extends Command['type']> = Omit<Extract<Command, { type: K }>, 'type'>;
const mk =
  <K extends Command['type']>(type: K) =>
  (s: GameState, args?: ArgsOf<K>): CommandResult =>
    dispatch(s, { type, ...(args ?? {}) } as Command);

export const startCal = mk('startCalendar');
export const continueCal = (s: GameState) => dispatch(s, { type: 'continueCalendar' });
export const stopCal = (s: GameState) => dispatch(s, { type: 'stopCalendar' });
/** Advance one month: run the calendar and request a stop after one month advance. */
export const advanceMonth = (s: GameState) => dispatch(s, { type: 'startCalendar', months: 1 });
export const ack = mk('ack');
export const chooseEvent = (s: GameState, choice: EventChoice) => dispatch(s, { type: 'resolveEvent', choice });
export const plowSquares = mk('plow');
export const plantSquares = (s: GameState, plantings: Planting[]) => dispatch(s, { type: 'plant', plantings });
export const harvestField = mk('harvest');
export const buildItem = (s: GameState, item: BuildItem, helpers?: Helpers) => dispatch(s, { type: 'build', item, helpers });
export const sellGrainTo = (s: GameState, dealer: 'local' | 'ogrady') => dispatch(s, { type: 'sellGrain', dealer });
export const deposit = (s: GameState, amount: number) => dispatch(s, { type: 'depositSavings', amount });
export const withdraw = (s: GameState, amount: number) => dispatch(s, { type: 'withdrawSavings', amount });
export const borrow = (s: GameState, amount: number, years: number) => dispatch(s, { type: 'takeLoan', amount, years });
export const repay = (s: GameState) => dispatch(s, { type: 'repayLoan' });
export const buyStoreItem = (s: GameState, name: CatalogName, qty = 1) => dispatch(s, { type: 'buyCatalogItem', name, qty });
export const buySeedAcres = (s: GameState, crop: Crop, acres: number, typedTotal?: number) => dispatch(s, { type: 'buySeeds', crop, acres, typedTotal });
