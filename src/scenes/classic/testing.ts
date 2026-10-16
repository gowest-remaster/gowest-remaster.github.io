// Test/dev support for the Classic edition (Playwright checks, screenshots):
//   ?classic&newgame[=goal]&advance=N&movie=FIELD&frame=X
// starts a classic-rules game for profile "TESTER", advances N months through the pure sim
// (answering prompts with defaults, no UI), then opens the movie. `window.__classicTest`
// exposes the same helpers to scripts.
import { dispatch, type CommandResult, type GameState } from '../../sim/index.ts';
import { game } from '../../engine/game.ts';
import { saves } from '../../engine/save.ts';

/** Answer the pending prompt with a simple default (as the sim test helpers do). */
export function defaultAnswer(s: GameState): CommandResult {
  const p = s.pending!;
  switch (p.kind) {
    case 'message':
      return dispatch(s, { type: 'ack' });
    case 'neighborHelp':
      return dispatch(s, { type: 'answerNeighborHelp', yes: true });
    case 'houseOffer':
      return dispatch(s, { type: 'answerHouseOffer', yes: false });
    case 'politicianLetter':
      return dispatch(s, { type: 'resolveEvent', choice: {} });
    case 'goalChoice':
      return dispatch(s, { type: 'resolveEvent', choice: { option: 1 } });
    case 'event': {
      const line = s.events[p.line];
      const type = Number(line[3]);
      if (p.stage === 'doctorList') return dispatch(s, { type: 'resolveEvent', choice: { cancel: true } });
      if (type === 1) return dispatch(s, { type: 'resolveEvent', choice: { name: 'Abe' } });
      if (type === 2) return dispatch(s, { type: 'resolveEvent', choice: { amount: 1 } });
      if (type === 10) return dispatch(s, { type: 'resolveEvent', choice: { option: 1 } });
      if (type === 11) return dispatch(s, { type: 'resolveEvent', choice: { projects: [true, true, false, false] } });
      const r = dispatch(s, { type: 'resolveEvent', choice: { yes: true } });
      if (r.state.pending?.kind === 'message' && r.state.pending.text === 'NoM') return dispatch(s, { type: 'resolveEvent', choice: { yes: false, cancel: true } });
      return r;
    }
  }
}

export async function testNewGame(goal = 1) {
  const list = await saves.listProfiles();
  let p = list.find((x) => x.name === 'TESTER');
  if (!p) p = await saves.createProfile('TESTER');
  await game.selectProfile(p);
  await game.start({ first: 'Test', last: 'Player', goal, edition: { edition: 'classic', rules: { mode: 'classic' }, look: 'classic' } });
}

/**
 * Advance whole months through the sim (no UI), answering prompts with defaults and playing a
 * simple farm strategy (build barn + windmill, plant in April/September, harvest and sell),
 * like the sim's scripted full-game test.
 */
export function testAdvance(months: number) {
  let s = game.state!;
  const apply = (r: CommandResult) => {
    s = r.state;
    return r;
  };
  const answerAll = () => {
    let k = 0;
    while (s.pending && k++ < 200) apply(defaultAnswer(s));
  };
  if (s.globals.firstTT !== 1) apply(dispatch(s, { type: 'visitTownTalk' }));
  let guard = 0;
  const idx = () => s.date.year * 12 + s.date.mon;
  const target = idx() + months;
  let lastFarm = -1;
  // stop at the target month; never start the calendar in Dec 1919 (that ends the game)
  while (idx() < target && idx() < 1919 * 12 + 12 && !s.extra.ended && guard++ < 20000) {
    if (s.pending) {
      apply(defaultAnswer(s));
      continue;
    }
    const key = s.date.year * 100 + s.date.mon;
    if (key !== lastFarm && s.globals.houseStat > 0) {
      lastFarm = key;
      farmTurn();
      answerAll();
    }
    if (s.globals.tTalk > 0 && s.globals.blinkTTalk === 1) apply(dispatch(s, { type: 'visitTownTalk' }));
    answerAll();
    money();
    answerAll();
    apply(dispatch(s, { type: 'startCalendar', months: 1 }));
  }
  answerAll();
  game.state = s;
  return { year: s.date.year, mon: s.date.mon };

  function money() {
    const p = s.propet;
    const need = p.lifePrice * 3;
    if (p.cash < need && p.savings > 0 && p.house > 0) apply(dispatch(s, { type: 'withdrawSavings', amount: Math.min(p.savings, need * 2) }));
    if (p.cash < p.lifePrice && p.loanAmount === 0 && s.cursit.firstHarv === 1) {
      apply(dispatch(s, { type: 'enterBank' }));
      apply(dispatch(s, { type: 'takeLoan', amount: Math.min(1000, p.landValue), years: 5 }));
    }
    if (s.myRecieve > 0) {
      apply(dispatch(s, { type: 'enterBank' }));
      apply(dispatch(s, { type: 'collectMoney' }));
    }
    if (p.loanAmount > 0 && p.loanDueYear === s.date.year && s.date.mon >= 11) {
      if (p.cash < p.loanAmount && p.savings > 0) apply(dispatch(s, { type: 'withdrawSavings', amount: p.savings }));
      apply(dispatch(s, { type: 'enterBank' }));
      apply(dispatch(s, { type: 'repayLoan' }));
    }
    if (p.house > 0 && p.cash > 1500) apply(dispatch(s, { type: 'depositSavings', amount: 500 }));
  }

  function farmTurn() {
    const p = s.propet;
    const mon = s.date.mon;
    if (mon >= 3 && mon <= 10) {
      if (p.extraWindmills === 0 && p.windmill !== 1 && p.cash >= 80 && s.catalog.windMill.stock > 0 && p.toBuildWindmill === 0) apply(dispatch(s, { type: 'buyCatalogItem', name: 'windMill', qty: 1 }));
      answerAll();
      for (const item of ['barn', 'windmill'] as const) {
        const due = item === 'barn' ? s.propet.toBuildBarn : s.propet.toBuildWindmill;
        if (due > 0 && !s.pending) apply(dispatch(s, { type: 'build', item, helpers: { workers: 0, neighbors: 2, family: 0 } }));
        answerAll();
      }
    }
    if ([4, 5, 9, 10].includes(mon) && s.cursit.numHarved > 0) {
      apply(dispatch(s, { type: 'harvest', helpers: { workers: s.propet.cash > 800 ? 2 : 0, neighbors: 0, family: s.propet.familyWorkers } }));
      answerAll();
      apply(dispatch(s, { type: 'sellGrain', dealer: 'local' }));
      answerAll();
    }
    if ([4, 5, 9, 10].includes(mon) && s.cursit.numPlanted === 0 && s.cursit.numHarved === 0 && s.cursit.wintSum === 0) {
      const crop = mon <= 5 ? (2 as const) : (1 as const);
      const squares = s.propet.cash > 400 ? 8 * s.propet.numFields : 4;
      const acres = squares * 20;
      if (s.propet.seeds[crop - 1] < acres) apply(dispatch(s, { type: 'buySeeds', crop, acres: acres - s.propet.seeds[crop - 1] }));
      answerAll();
      const free = s.cursit.plow.map((v, i) => (v === 0 && i < 8 * s.propet.numFields ? i + 1 : 0)).filter(Boolean).slice(0, squares);
      if (free.length) apply(dispatch(s, { type: 'plow', squares: free, helpers: { workers: s.propet.cash > 800 ? 2 : 0, neighbors: 0, family: s.propet.familyWorkers } }));
      answerAll();
      const plowed = s.cursit.plow.map((v, i) => (v === 1 && s.cursit.plant[i] === 0 ? i + 1 : 0)).filter(Boolean);
      if (plowed.length && s.propet.seeds[crop - 1] >= 20) apply(dispatch(s, { type: 'plant', plantings: plowed.map((square) => ({ square, crop })) }));
      answerAll();
    }
  }
}

export function installTestHooks(api: Record<string, unknown>) {
  (window as unknown as { __classicTest: unknown }).__classicTest = {
    newGame: testNewGame,
    advance: testAdvance,
    state: () => game.state,
    set: (fn: (s: GameState) => void) => {
      if (game.state) fn(game.state);
    },
    ...api,
  };
}
