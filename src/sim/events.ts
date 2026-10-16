// Scheduled events: the Events dispatcher (CALEND ScoreScript 43) and every dialog
// resolution (ScoreScripts 26/27/29/49/50/54/55/57/62). docs/spec/02-farm-sim.md §6.1–§6.7.
import { addScore, changeCash, changeLifePrice, emit, payCashThenSavings, quirk, rand, reject, type Ctx } from './ctx.ts';
import { newTTalk, seasonRow, townTalk } from './calendar.ts';
import { ALL_SEAS, ALM_LETTERS, DOCTOR_LIST, DOCTOR_LIST_SCORE, GOAL_TEXTS, QUESTIONNAIRE_RIGHT } from './data/tables.ts';
import { addEvent, msg, noteGoalResult } from './rules.ts';
import { ldiv, type Prompt } from './state.ts';

/** Loose payload for answering an event dialog. Which fields matter depends on the type. */
export interface EventChoice {
  /** Yes/No dialogs (types 3, 6, 15). OK-only dialogs ignore it. */
  yes?: boolean;
  /** Cancel/X (types 2, 10, doctor list). */
  cancel?: boolean;
  /** Baby name (type 1). */
  name?: string;
  /** Donation amount (type 2). */
  amount?: number;
  /** Wedding option 1..3 (type 10) or goal answer index into `answers` (type 8). */
  option?: number;
  /** Doctor list checkboxes in displayed order. */
  items?: boolean[];
  /** Questionnaire answers (type 9), 6 positions. */
  answers?: boolean[];
  /** Mayor budget projects (type 11). */
  projects?: boolean[];
}

const item = (line: readonly string[], n: number) => line[n - 1] ?? '';
const iv = (line: readonly string[], n: number) => {
  const v = Number(item(line, n));
  return Number.isFinite(v) ? v : 0;
};

export function eventLine(ctx: Ctx, idx: number) {
  return ctx.s.events[idx];
}

/** Doctor-list entries currently offered (`ListBase`, or `0DocList` without the stove). */
export function doctorListItems(stoveOwned: boolean) {
  return DOCTOR_LIST.filter((d) => !(stoveOwned && d.id === 'stove'));
}

/** Text id the UI should show for an event prompt (handles the dynamic cases). */
export function eventTextId(s: { events: string[][]; propet: { cash: number; lifePrice: number; boughtStove: number; keptDaughterInSchool: number; paidBigWedding: number } }, prompt: Extract<Prompt, { kind: 'event' }>): string {
  const line = s.events[prompt.line];
  const type = iv(line, 4);
  if (type === 4) return s.propet.cash <= 2 * s.propet.lifePrice ? item(line, 5) : item(line, 6);
  if (type === 5 && iv(line, 1) === 1902 && iv(line, 2) === 8) {
    const sum = s.propet.boughtStove + s.propet.keptDaughterInSchool + s.propet.paidBigWedding;
    return sum > 1 ? 'Son22' : `Son2${sum}`;
  }
  return item(line, 5);
}

/** Events frame: politician letter first, then the current g_MainEvent. */
export function openEvents(ctx: Ctx) {
  const s = ctx.s;
  const g = s.globals;
  if (g.whatScore > 0 && s.propet.ach[g.whatScore - 1] === 0) {
    s.propet.ach[g.whatScore - 1] = 1;
    setPending(ctx, { kind: 'politicianLetter', level: g.whatScore });
    const l = ALM_LETTERS[g.whatScore];
    emit(ctx, { type: 'letter', id: l.id, had: l.had, sig: l.sig });
    return;
  }
  if (g.mainEvent === 8 && s.extra.goalPrompt) {
    setPending(ctx, { kind: 'goalChoice', text: s.extra.goalPrompt.text, answers: s.extra.goalPrompt.answers });
    s.extra.goalPrompt = null;
    return;
  }
  if (g.mainEvent <= 0 || g.mainLine <= 0) return;
  const idx = g.mainLine - 1;
  const line = s.events[idx];
  const type = iv(line, 4);
  if (type === 2 && iv(line, 1) === 1884 && iv(line, 2) === 6) s.cursit.churchLetter = 1;
  if (type === 2 || type === 6 || type === 7) emit(ctx, { type: 'letter', id: item(line, 5), had: item(line, 6), sig: item(line, 7) });
  setPending(ctx, { kind: 'event', line: idx, stage: 'main' });
}

export function setPending(ctx: Ctx, p: Prompt | null) {
  ctx.s.pending = p;
  if (p) emit(ctx, { type: 'prompt', prompt: p });
}

/** "You don't have enough money" then back to the same dialog. */
function noMoney(ctx: Ctx, back: Prompt) {
  setPending(ctx, msg('NoM', 'DBox0', { next: back }));
}

/** Resolve the pending event prompt. Returns false if the choice was invalid. */
export function resolveEvent(ctx: Ctx, choice: EventChoice): boolean {
  const s = ctx.s;
  const p = s.pending;
  if (!p || (p.kind !== 'event' && p.kind !== 'politicianLetter' && p.kind !== 'goalChoice')) {
    reject(ctx, 'noEventPending');
    return false;
  }
  if (p.kind === 'politicianLetter') {
    setPending(ctx, null);
    return true;
  }
  if (p.kind === 'goalChoice') return resolveGoal(ctx, p, choice);
  const line = s.events[p.line];
  const type = iv(line, 4);
  const { year } = s.date;
  const pr = s.propet;
  const rid = item(line, 5);
  switch (type) {
    case 1: {
      // Baby (ScoreScript 55): LifePrice +5, name normalised.
      changeLifePrice(ctx, 5, rid);
      let name = (choice.name ?? '').slice(0, 10);
      if (name.length > 0) name = name[0].toUpperCase() + name.slice(1).toLowerCase();
      const slot = year === 1880 ? 0 : year === 1884 ? 1 : 2;
      pr.babyNames[slot] = name;
      setPending(ctx, null);
      return true;
    }
    case 2: {
      // Donation letter (ScoreScript 50, g_Input = 1).
      if (choice.cancel) {
        setPending(ctx, null);
        return true;
      }
      const amount = Math.max(0, Math.floor(choice.amount ?? 0));
      if (amount === 0 && !quirk(ctx, 'Q26')) {
        setPending(ctx, null);
        return true;
      }
      if (pr.cash + pr.savings < amount) {
        noMoney(ctx, p);
        return true;
      }
      payCashThenSavings(ctx, amount, 'donation');
      const lp = pr.lifePrice;
      const t6 = quirk(ctx, 'Q26') ? ldiv(lp * 6, 100) : (lp * 6) / 100;
      const t10 = quirk(ctx, 'Q26') ? ldiv(lp * 10, 100) : (lp * 10) / 100;
      addScore(ctx, amount <= t6 ? 2 : amount <= t10 ? 4 : 6, rid);
      setPending(ctx, null);
      return true;
    }
    case 3:
      return familyDecision(ctx, p, line, choice.yes === true);
    case 4: {
      if (p.stage === 'main') {
        const charge = quirk(ctx, 'DOCEQ') ? pr.cash >= 2 * pr.lifePrice : pr.cash > 2 * pr.lifePrice;
        if (charge) changeCash(ctx, -25, 'doctor');
        setPending(ctx, { kind: 'event', line: p.line, stage: 'doctorList' });
        return true;
      }
      if (choice.cancel) {
        setPending(ctx, null);
        return true;
      }
      const list = doctorListItems(pr.stove > 0);
      const picked = list.filter((_, i) => choice.items?.[i]);
      const total = picked.reduce((a, d) => a + d.price, 0);
      if (pr.cash + pr.savings < total) {
        noMoney(ctx, p);
        return true;
      }
      payCashThenSavings(ctx, total, 'doctorList');
      // the original tests checkbox #2 (the stove in ListBase)
      if (choice.items?.[1]) {
        pr.stove = 1;
        pr.boughtStove = 1;
      }
      if (picked.length > 0 || quirk(ctx, 'DOC0')) addScore(ctx, DOCTOR_LIST_SCORE[picked.length], 'doctorList');
      setPending(ctx, null);
      return true;
    }
    case 5:
      return messageOk(ctx, line);
    case 6:
      if (choice.yes === false) return letterNo(ctx, line);
      return letterOk(ctx, p, line);
    case 7:
      return letterOk(ctx, p, line);
    case 9: {
      const answers = choice.answers ?? [];
      const matches = QUESTIONNAIRE_RIGHT.filter((r, i) => (answers[i] ?? false) === r).length;
      setPending(ctx, msg(matches < 3 ? 'Extra1' : 'Extra2', 'DBox0'));
      return true;
    }
    case 10:
      return wedding(ctx, p, line, choice);
    case 11:
      return budget(ctx, p, line, choice.projects ?? []);
    case 15: {
      if (choice.yes) {
        s.globals.son2Plot = 1;
        setPending(ctx, null);
        return true;
      }
      s.globals.son2Plot = 2;
      addEvent(ctx, '1907,11,0,6,DL20,0,Sig20,4,-100,6,-5,1');
      changeLifePrice(ctx, -5, rid, true);
      setPending(ctx, msg('Son3', 'DBox23'));
      return true;
    }
    default:
      setPending(ctx, null);
      return true;
  }
}

function resolveGoal(ctx: Ctx, p: Extract<Prompt, { kind: 'goalChoice' }>, choice: EventChoice): boolean {
  const s = ctx.s;
  const idx = (choice.option ?? 1) - 1;
  const ans = p.answers[idx];
  if (ans === undefined) {
    reject(ctx, 'invalidGoalAnswer');
    return false;
  }
  if (ans < 4) {
    s.begin.goal = ans;
    emit(ctx, { type: 'dialog', id: 'MyGoal', params: { goal: GOAL_TEXTS[ans] } });
    setPending(ctx, null);
  } else {
    s.globals.eog = 1;
    s.extra.ended = 'retired';
    setPending(ctx, null);
    emit(ctx, { type: 'gameOver', reason: 'retired' });
  }
  return true;
}

/** Type 3 Yes/No (ScoreScripts 55 / 29). */
function familyDecision(ctx: Ctx, p: Extract<Prompt, { kind: 'event' }>, line: string[], yes: boolean): boolean {
  const s = ctx.s;
  const pr = s.propet;
  const { year, mon } = s.date;
  const lp = pr.lifePrice;
  const rid = item(line, 5);
  if (yes) {
    const works = iv(line, 6) === 7 || iv(line, 6) === 8;
    if (works && quirk(ctx, 'FAMW')) pr.familyWorkers += 1;
    const reserve = year === 1905 && mon === 7 ? lp * 2 : 0;
    const cost = iv(line, 8);
    if (pr.cash + pr.savings < cost + reserve) {
      noMoney(ctx, p);
      return true;
    }
    if (works && !quirk(ctx, 'FAMW')) pr.familyWorkers += 1;
    payCashThenSavings(ctx, cost, 'family');
    if (year === 1905 && mon === 7) {
      addEvent(ctx, '1909,7,0,7,AL35,0,Sig35,0,0,0,0,1');
      addEvent(ctx, '1917,11,0,7,AL36,0,Sig35,0,0,0,0,1');
    }
    if (year === 1888 && mon === 3) pr.daughterWorks = 1;
    else if (year === 1892 && mon === 3) pr.sonWorks = 1;
    changeLifePrice(ctx, iv(line, 10), rid);
    addScore(ctx, iv(line, 9), rid);
    setPending(ctx, null);
    return true;
  }
  if (year === 1898 && mon === 3) addScore(ctx, iv(line, 10), rid);
  else if (year === 1888 && mon === 3) pr.keptDaughterInSchool = 1;
  else if (year === 1900 && mon === 7) addEvent(ctx, '1900,8,0,3,DaW9,9,DBox12,-2,6,-10');
  else if (year === 1905 && mon === 7) {
    if (pr.cash + pr.savings >= iv(line, 8) + 2 * lp) addScore(ctx, iv(line, 10), rid);
    addEvent(ctx, '1905,8,0,5,Da4,DBox12,0');
    addEvent(ctx, '1909,7,0,7,AL51,0,Sig35,0,0,0,0,1');
    addEvent(ctx, '1917,11,0,7,AL52,0,Sig35,0,0,0,0,1');
    changeLifePrice(ctx, -5, rid, true);
  }
  setPending(ctx, null);
  return true;
}

/** Type 5 message OK (ScoreScript 27, g_MainEvent = 5). */
function messageOk(ctx: Ctx, line: string[]): boolean {
  const s = ctx.s;
  const pr = s.propet;
  const { year, mon } = s.date;
  if (year === 1902 && mon === 8 && s.begin.goal === 1) {
    const sumGoal = pr.boughtStove + pr.keptDaughterInSchool + pr.paidBigWedding;
    const money = pr.cash + pr.savings >= s.begin.targets[0];
    if (!quirk(ctx, 'Q21')) changeLifePrice(ctx, iv(line, 7), item(line, 5));
    const met = pr.tractors > 0 && sumGoal > 1 && money;
    noteGoalResult(ctx, 1, met);
    if (met) {
      const gp = pr.score >= 60 ? { text: 'Goal1', answers: [1, 2, 3, 4] } : { text: 'Goal2', answers: [1, 2, 4] };
      emit(ctx, { type: 'goalReached', text: gp.text, answers: gp.answers });
      setPending(ctx, { kind: 'goalChoice', ...gp });
      return true;
    }
    setPending(ctx, null);
    return true;
  }
  changeLifePrice(ctx, iv(line, 7), item(line, 5));
  setPending(ctx, null);
  return true;
}

/** Types 6 (Yes) and 7 (OK): ScoreScript 50 with g_Input = 3. */
function letterOk(ctx: Ctx, p: Extract<Prompt, { kind: 'event' }>, line: string[]): boolean {
  const s = ctx.s;
  const pr = s.propet;
  const type = iv(line, 4);
  const { year, mon } = s.date;
  if (type === 7) {
    if (year === 1883 && mon === 7) s.myRecieve += 150;
    else if (year === 1918 && mon === 6) s.myRecieve += 300;
    else if (year === 1909 && mon === 7 && (quirk(ctx, 'Q22') || item(line, 5) === 'AL35')) s.myRecieve += 480;
    if (type === 7 && year === 1885 && !quirk(ctx, 'Q7')) s.extra.deedReceived = 1;
  }
  const money = iv(line, 9);
  if (money === 0) {
    setPending(ctx, null);
    return true;
  }
  if (pr.cash + pr.savings + money < 0) {
    if (type === 6 && year === 1915) addEvent(ctx, rand(ctx, 4) < 3 ? '1916,7,0,7,AL31,0,Sig11,0,0,0,0' : '1916,7,0,7,AL32,0,Sig11,0,0,0,0');
    noMoney(ctx, p);
    return true;
  }
  if (pr.cash + money >= 0) changeCash(ctx, money, 'letter');
  else payCashThenSavings(ctx, -money, 'letter');
  addScore(ctx, iv(line, 10), item(line, 5));
  if (type === 6 && year === 1907) addEvent(ctx, '1908,6,0,7,AL21,0,Sig20,0,100,6,0,1');
  else if (type === 6 && year === 1915) addEvent(ctx, rand(ctx, 4) < 3 ? '1916,7,0,7,AL29,0,Sig11,0,2000,0,0' : '1916,7,0,7,AL30,0,Sig11,0,2000,0,0');
  else if (type === 6 && year === 1897) addEvent(ctx, rand(ctx, 4) < 3 ? '1898,12,0,7,AL13,0,Sig11,0,200,0,0' : '1898,12,0,7,AL12,0,Sig11,0,200,0,0');
  else if (type === 7 && year === 1885) pr.ach[0] = 1; // unreachable: AL43 has item 9 = 0 (Q7)
  setPending(ctx, null);
  return true;
}

/** Type 6 No (ScoreScript 29). */
function letterNo(ctx: Ctx, line: string[]): boolean {
  const { year } = ctx.s.date;
  if (year === 1907 || year === 1908) {
    addScore(ctx, iv(line, 11), item(line, 5));
    if (year === 1907) addEvent(ctx, '1908,6,0,6,DL22,0,Sig20,6,-200,3,-12,1');
  } else if (year === 1915) {
    addEvent(ctx, rand(ctx, 4) < 3 ? '1916,7,0,7,AL31,0,Sig11,0,0,0,0' : '1916,7,0,7,AL32,0,Sig11,0,0,0,0');
  } else if (year === 1897) {
    addEvent(ctx, rand(ctx, 4) < 3 ? '1898,12,0,7,AL14,0,Sig11,0,0,0,0' : '1898,12,0,7,AL15,0,Sig11,0,0,0,0');
  }
  setPending(ctx, null);
  return true;
}

/** Type 10 wedding (ScoreScript 54). */
function wedding(ctx: Ctx, p: Extract<Prompt, { kind: 'event' }>, line: string[], choice: EventChoice): boolean {
  const s = ctx.s;
  const pr = s.propet;
  const { year, mon } = s.date;
  if (choice.cancel || !choice.option) {
    if (!quirk(ctx, 'Q20')) changeLifePrice(ctx, -5, item(line, 5), true);
    setPending(ctx, null);
    return true;
  }
  const opt = Math.min(3, Math.max(1, Math.floor(choice.option)));
  const sum = iv(line, opt + 7);
  if (pr.cash + pr.savings < sum) {
    noMoney(ctx, p);
    return true;
  }
  payCashThenSavings(ctx, sum, 'wedding');
  if (year === 1902 && opt === 3) pr.paidBigWedding = 1;
  addScore(ctx, iv(line, opt + 10), item(line, 5));
  changeLifePrice(ctx, -5, item(line, 5), true);
  const base = year === 1893 ? 200 : 203;
  const path = year === 1893 ? 'TTalk7' : 'TTalk8';
  if (year === 1893) s.globals.wasTTalk = 1;
  newTTalk(ctx, base + opt, path, year, 7, 0);
  townTalk(ctx);
  if (mon === 7) s.globals.wasTTalk = 1;
  setPending(ctx, null);
  return true;
}

/** Type 11 mayor budget (ScoreScripts 59/62). */
function budget(ctx: Ctx, p: Extract<Prompt, { kind: 'event' }>, line: string[], projects: boolean[]): boolean {
  const s = ctx.s;
  const n = iv(line, 6);
  const costs = Array.from({ length: n }, (_, i) => iv(line, 8 + i));
  const total = costs.reduce((a, c, i) => a + (projects[i] ? c : 0), 0);
  if (total > iv(line, 7)) {
    setPending(ctx, msg('Sys836', 'DBox0', { next: p }));
    return true;
  }
  const right = s.date.year === 1917 ? 3 : 1;
  const count = projects.slice(0, n).filter(Boolean).length;
  const talk = projects[right - 1] && count > 1 ? 301 : 302;
  if (!quirk(ctx, 'MAYOR') || s.globals.mayerTTalk !== talk) {
    s.globals.mayerTTalk = talk;
    newTTalk(ctx, talk, 'TTalk9', s.date.year, 3, 0);
    townTalk(ctx);
  }
  setPending(ctx, null);
  return true;
}

/**
 * Acknowledge a message prompt (Mes OK, ScoreScript 27): money-crisis effects, scene
 * restore, then continue to `next`.
 */
export function ackMessage(ctx: Ctx): boolean {
  const s = ctx.s;
  const p = s.pending;
  if (!p || p.kind !== 'message') {
    reject(ctx, 'noMessagePending');
    return false;
  }
  if (p.onAck === 'openEvents') {
    setPending(ctx, null);
    openEvents(ctx);
    return true;
  }
  if (p.onAck === 'nom1') changeCash(ctx, 100, 'neighborsGift');
  else if (p.onAck === 'nom5') {
    changeCash(ctx, 50, 'neighborsFarewell');
    endGame(ctx, 'bankrupt');
  } else if (p.onAck === 'loanEnd') endGame(ctx, 'foreclosed');
  if (s.globals.mainView > 8) {
    s.globals.mainView = ALL_SEAS[seasonRow(s.date.year)][s.date.mon];
    emit(ctx, { type: 'scene', mainView: s.globals.mainView });
  }
  setPending(ctx, s.extra.ended ? null : p.next);
  return true;
}

export function endGame(ctx: Ctx, reason: 'bankrupt' | 'foreclosed' | 'retired' | 'completed') {
  ctx.s.globals.eog = 1;
  ctx.s.extra.ended = reason;
  emit(ctx, { type: 'gameOver', reason });
}
