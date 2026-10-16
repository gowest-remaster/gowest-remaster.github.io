// Farmers' Bank (BANK09): cashier receipts, loans, repayment. docs/spec/03-town.md §2.
import { changeCash, dialog, emit, fillLogBook, quirk, reject, type Ctx } from './ctx.ts';
import { LOAN_YEARS } from './data/tables.ts';
import { reproduces } from './fidelity.ts';
import type { GameState } from './state.ts';

/** startMovie + telegram (ScoreScript 69/51): resets the visit's journal. */
export function enterBank(ctx: Ctx) {
  const s = ctx.s;
  s.extra.bankTxCount = 0;
  if (s.cursit.telegram.pending === 1) {
    emit(ctx, { type: 'telegram', net: s.cursit.telegram.net });
    s.cursit.telegram.pending = 0;
  }
}

/** `Document()` journal line; T11: the first line of each visit never reaches the logbook. */
function bankLog(ctx: Ctx, act: number, cost: number, income: number) {
  ctx.s.extra.bankTxCount += 1;
  if (quirk(ctx, 'T11') && ctx.s.extra.bankTxCount === 1) return;
  fillLogBook(ctx, 1, act, cost, income);
}

/** Cashier (ScoreScripts 6/14): pay out MyRecieve. */
export function collectMoney(ctx: Ctx) {
  const s = ctx.s;
  if (s.myRecieve <= 0) return dialog(ctx, 'NoMoneyCashier');
  const amt = s.myRecieve;
  changeCash(ctx, amt, 'bankReceive');
  bankLog(ctx, 1, 0, amt);
  s.myRecieve = 0;
  dialog(ctx, 'TakeMoney');
}

/** Repayment = amount x (1 + rate)^years, annual compounding (03 §2.7). */
export function loanRepayment(amount: number, interestPct: number, years: number) {
  return amount * Math.pow(1 + interestPct / 100, years);
}

/** Largest loan the bank accepts (4-digit field; T12 remastered: the land value). */
export function loanCap(s: GameState): number {
  return reproduces(s.fidelity, 'T12') ? 9999 : Math.min(9999, s.propet.landValue);
}

export function takeLoan(ctx: Ctx, amount: number, years: number) {
  const s = ctx.s;
  const p = s.propet;
  if (p.loanAmount > 0) return dialog(ctx, 'LoanAlready');
  if (s.cursit.firstHarv !== 1) return dialog(ctx, 'needharvest');
  if (!Number.isInteger(amount) || amount <= 0 || amount > 9999 || !(LOAN_YEARS as readonly number[]).includes(years)) return reject(ctx, 'invalidLoan');
  if (amount > loanCap(s)) return dialog(ctx, 'SEG008');
  p.loanDueYear = s.date.year + years;
  p.loanAmount = loanRepayment(amount, s.interest, years);
  s.loanYears = years;
  s.extra.loanRate = s.interest;
  changeCash(ctx, amount, 'loan');
  bankLog(ctx, 2, 0, amount);
  dialog(ctx, 'LoanOK');
}

/** Loan info screen values. LOANRATE: classic shows today's rate, remastered the signed one. */
export function loanInfo(s: GameState): { amountDue: number; dueYear: number; years: number; rate: number } | null {
  if (s.propet.loanAmount <= 0) return null;
  const rate = reproduces(s.fidelity, 'LOANRATE') ? s.interest : (s.extra.loanRate ?? s.interest);
  return { amountDue: s.propet.loanAmount, dueYear: s.propet.loanDueYear, years: s.loanYears, rate };
}

/** REPAY visible only in Nov/Dec of the due year (T13 in classic). */
export function canRepay(s: GameState): boolean {
  if (s.propet.loanAmount <= 0) return false;
  return reproduces(s.fidelity, 'T13') ? s.date.year === s.propet.loanDueYear && s.date.mon > 10 : true;
}

export function repayLoan(ctx: Ctx) {
  const s = ctx.s;
  const p = s.propet;
  if (p.loanAmount <= 0) return dialog(ctx, 'NothingToReturn');
  if (!canRepay(s)) return reject(ctx, 'repayNotOffered');
  const amt = p.loanAmount;
  if (amt > p.cash) return dialog(ctx, 'BigReturn');
  changeCash(ctx, -amt, 'loanRepay');
  p.loanAmount = 0;
  p.loanDueYear = 0;
  s.loanYears = 0;
  bankLog(ctx, 3, amt, 0);
  dialog(ctx, 'OK');
}
