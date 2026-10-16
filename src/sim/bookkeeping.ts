// Remastered bookkeeping (docs/design/remastered-ux.md §9.3 item 12): monthly history snapshots,
// the decisions log and the goal results. Nothing here has a rule effect; the original layout
// (serializeOriginal) ignores all of it.
import { farmValue } from './album.ts';
import type { DecisionRecord, Effects, GameState, MonthSnapshot, Prompt } from './state.ts';
import { eventTextId } from './events.ts';
import { ALM_LETTERS } from './data/tables.ts';

export function snapshotOf(s: GameState): MonthSnapshot {
  const p = s.propet;
  return {
    year: s.date.year,
    mon: s.date.mon,
    cash: p.cash,
    savings: p.savings,
    score: p.score,
    lifePrice: p.lifePrice,
    landValue: p.landValue,
    farmValue: farmValue(s),
    businessIncome: p.business.reduce((a, b) => a + b, 0),
    loanAmount: p.loanAmount,
    soldBushels: s.extra.monthTally.soldBushels,
    grainIncome: s.extra.monthTally.grainIncome,
  };
}

/** Append the month snapshot and reset the monthly tally. */
export function recordMonth(s: GameState) {
  s.extra.history.push(snapshotOf(s));
  s.extra.monthTally = { soldBushels: 0, grainIncome: 0 };
}

export function effectsBetween(a: GameState, b: GameState): Effects {
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    cash: r(b.propet.cash - a.propet.cash),
    savings: r(b.propet.savings - a.propet.savings),
    score: b.propet.score - a.propet.score,
    lifePrice: r(b.propet.lifePrice - a.propet.lifePrice),
    familyWorkers: b.propet.familyWorkers - a.propet.familyWorkers,
    bank: r(b.myRecieve - a.myRecieve),
  };
}

/** Text id of a prompt, for logs and UI keys. */
export function promptTextId(s: GameState, p: Prompt): string {
  switch (p.kind) {
    case 'message':
      return p.text;
    case 'event':
      return eventTextId(s, p);
    case 'politicianLetter':
      return ALM_LETTERS[p.level]?.id ?? `ALM${p.level}`;
    case 'goalChoice':
      return p.text;
    case 'neighborHelp':
      return 'NHelp';
    case 'houseOffer':
      return p.text;
  }
}

/** A prompt answer that only bounced to "not enough money" / "over budget" is not a decision. */
function bounced(before: Prompt, after: Prompt | null): boolean {
  return !!after && after.kind === 'message' && (after.text === 'NoM' || after.text === 'Sys836') && JSON.stringify(after.next) === JSON.stringify(before);
}

export function recordDecision(before: GameState, after: GameState, choice: Record<string, unknown>) {
  const p = before.pending;
  if (!p || p.kind === 'message') return;
  if (bounced(p, after.pending)) return;
  const rec: DecisionRecord = {
    year: before.date.year,
    mon: before.date.mon,
    kind: p.kind,
    id: promptTextId(before, p),
    choice,
    effects: effectsBetween(before, after),
  };
  if (p.kind === 'event') {
    rec.line = p.line;
    rec.stage = p.stage;
  }
  after.extra.decisions.push(rec);
}
