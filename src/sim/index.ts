// Public surface of the pure simulation core.
export * from './state.ts';
export * from './fidelity.ts';
export * from './events-out.ts';
export { newGame, type NewGameOptions } from './newgame.ts';
export * from './commands.ts';
export { eventTextId, doctorListItems, type EventChoice } from './events.ts';
export { mySpeed, NO_HELPERS, type Helpers, type Planting, type PlowOptions } from './field.ts';
export { buildableItems, constructionEstimate, livestockMarketOpen, type BuildItem, type Animals } from './farm.ts';
export { grainQuote, businessForSale, claimAvailable, type GrainQuote } from './town.ts';
export { loanRepayment, loanCap, canRepay, loanInfo } from './bank.ts';
export { seedPricePerAcre, seedOrderTotal, catalogAvailable } from './store.ts';
export { houseUpgradeOffer } from './house.ts';
export { albumMaxPictures, albumCaptions, newspaperIssues, newspaperAvailable, farmValue, goalProgress } from './album.ts';
export { seasonOf, addFieldDays } from './calendar.ts';
export { type RunOptions } from './turn.ts';
export { farmerGoalMet, businessGoalMet, politicianGoalMet, GOAL_CHECK_DATES, GOAL_RETRY_DATES } from './rules.ts';
export { snapshotOf, effectsBetween, promptTextId } from './bookkeeping.ts';
export { BUSINESSES, CATALOG, CLAIM, LOAN_YEARS, GOAL_TEXTS, MONTHS, MONTHS_GB, LOG_LOCATIONS, LOG_ACTIONS, DOCTOR_LIST, CONSTRUCTION_DAYS, type CatalogName } from './data/tables.ts';
// Remastered UI layer (docs/design/sim-api.md): read-only queries, undo/rewind, UI copy.
export * from './query.ts';
export * from './history.ts';
export * from './describe.ts';
export * from './devcut.ts'; // [devcut] Developer's Cut layer
