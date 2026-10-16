// Farmers' Bank (§5.5): the cashier (money waiting, O'Grady telegrams), the loan visualizer
// (amount slider, 1/3/5-year chips, year-by-year growth chart, the all-at-once due date in
// bold), and an always-visible Repay card with the loan file while a loan exists.
import { loanRepayment, reproduces, type GameState, type SimEvent } from '../../sim/index.ts';
import { member } from '../../game/text.ts';
import type { App } from '../core/app.ts';
import { h, icon, put, svg } from '../core/dom.ts';
import { money, money2, monthName } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { loanInfo, loanSchedule } from '../core/simapi.ts';
import { badge } from '../ui/badges.ts';
import { btn, drawer, segmented, slider, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { blockedReason, payWithFetch, say } from './town-common.ts';
import { devcutContent } from '../core/text.ts';
import { assetUrl } from '../devcut/content.ts';
import { rm } from '../core/settings.ts';

/** A short original clip in a framed "teller's window" over `host`; click or Esc skips. */
function playClip(host: HTMLElement, url: string, caption: string): Promise<void> {
  return new Promise((resolve) => {
    const v = h('video', { class: 'clip-v', src: url, autoplay: true, playsInline: true }) as HTMLVideoElement;
    const s = rm();
    v.volume = Math.max(0, Math.min(1, s.master * s.sfx));
    const box = h('div', { class: 'clip-window', role: 'dialog', 'aria-label': caption, title: 'Click to skip' }, h('div', { class: 'clip-frame' }, v), h('div', { class: 'clip-cap small' }, caption, h('span', { class: 'pill blue' }, 'Developer’s Cut')));
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', key, true);
      box.remove();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        end();
      }
    };
    window.addEventListener('keydown', key, true);
    box.addEventListener('click', end);
    v.addEventListener('ended', () => setTimeout(end, 350));
    v.addEventListener('error', end);
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(end);
    });
    setTimeout(end, 8000);
    host.append(box);
  });
}

function telegramCard(s: GameState, net: number) {
  const raw = (member('Telegram') ?? '').replace(/\r/g, '');
  const lines = raw.split('\n').map((l) => (/^TO:/.test(l) ? `TO: ${`${s.name.first} ${s.name.last}`.trim()}` : l));
  return h('div', { class: 'telegram' }, h('div', { class: 'tg-strip' }, '· · · TELEGRAM · · ·'), h('div', { class: 'tg-body' }, ...lines.filter((l, i) => i > 0 || !/TELEGRAM/.test(l)).map((l) => (l.trim() ? h('div', null, l.toUpperCase()) : h('div', { class: 'gap' })))), h('div', { class: 'tg-net' }, `${money2(net)} waits for you at the cashier.`));
}

function chart(s: GameState, amount: number, years: number) {
  const pts = loanSchedule(amount, s.interest, years);
  const W = 460;
  const H = 150;
  const L = 50;
  const R = 14;
  const T = 22;
  const B = 26;
  const max = Math.max(...pts) * 1.12;
  const n = pts.length;
  const pad = 34;
  const x = (k: number) => L + pad + (W - L - R - 2 * pad) * (n === 1 ? 0.5 : k / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const bw = Math.min(52, (W - L - R) / n - 14);
  const el = svg('svg', { class: 'chart loan-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Amount owed grows from ${money(amount)} to ${money2(pts[n - 1])}` });
  for (const v of [0, max / 2]) {
    el.append(svg('line', { class: 'grid', x1: String(L), x2: String(W - R), y1: String(y(v)), y2: String(y(v)) }));
    el.append(svg('text', { x: String(L - 6), y: String(y(v) + 4), 'text-anchor': 'end' }, money(Math.round(v / 10) * 10)));
  }
  pts.forEach((v, k) => {
    const last = k === n - 1;
    el.append(svg('rect', { x: String(x(k) - bw / 2), y: String(y(v)), width: String(bw), height: String(y(0) - y(v)), rx: '3', fill: last ? 'var(--red)' : k === 0 ? 'var(--green)' : 'var(--brass)' }));
    el.append(svg('text', { x: String(x(k)), y: String(y(v) - 5), 'text-anchor': 'middle', style: `fill:${last ? 'var(--red)' : 'var(--ink)'};font-weight:${last ? 700 : 400}` }, money(Math.round(v * 100) / 100, { cents: last })));
    const lbl = k === 0 ? `${monthName(s.date.mon, 'short')} ${s.date.year}` : last ? `Dec ${s.date.year + k}` : String(s.date.year + k);
    el.append(svg('text', { x: String(x(k)), y: String(H - 7), 'text-anchor': 'middle' }, lbl));
  });
  return el;
}

function mount(app: App) {
  const d = drawer({ title: "Farmers' Bank", eyebrow: 'Main Street, Longview', wide: true, cls: 'bank-drawer' });
  const el = h('div', { class: 'bank' }, d.el);
  let amount = 500;
  let years = 3;
  let stamp = '';
  let telegram: number | null = null;
  const chartHost = h('div', { class: 'chart-host' });
  const dueLine = h('div', { class: 'callout warn loan-due' });
  const takeBtn = btn('Take the loan', { kind: 'go', icon: 'sign', onClick: () => take() });

  function refreshLoan() {
    const s = session.s;
    const due = loanRepayment(amount, s.interest, years);
    put(chartHost, chart(s, amount, years));
    put(dueLine, h('b', null, `${money(amount)} now → you must repay ${money2(due)} all at once in ${dueText(s, s.date.year + years)}.`), ' If you can’t pay then, the bank takes the farm and the game ends. You can repay early, any time.');
    takeBtn.querySelector('.btn-label')!.textContent = `Take ${money(amount)}`;
  }

  function take() {
    const r = session.run({ type: 'takeLoan', amount, years }, `Took a loan of ${money(amount)}`);
    if (r.events.some((e) => e.type === 'dialog' && e.id === 'LoanOK')) {
      const signed = amount;
      const after = () => {
        say('BANK09.LoanOK');
        toast(`Loan signed. ${money(signed)} added to your cash.`, { icon: 'bank', tone: 'good', quiet: true });
      };
      // Dev Cut: the cut MACLOAN clip plays in the teller's window before Norman's LoanOK line
      const dc = r.state.devcut?.enabled ? devcutContent() : null;
      if (dc?.video?.macloan?.asset) void playClip(d.el, assetUrl(dc.video.macloan.asset), 'The loan officer stamps your agreement').then(after);
      else after();
    }
  }

  function cashierCard(s: GameState) {
    const why = blockedReason();
    const waiting = s.myRecieve > 0;
    return h(
      'div',
      { class: 'card-inset cashier' },
      h('div', { class: 'icon-row' }, icon(ICONS.coin), h('b', null, 'Cashier')),
      waiting
        ? h('div', null, h('div', { class: 'big num good' }, money2(s.myRecieve)), h('div', { class: 'small muted' }, 'is waiting for you (O’Grady’s sale and other payments).'), btn(`Collect ${money2(s.myRecieve)}`, { kind: 'go', disabled: why ?? undefined, onClick: () => {
            const amt = s.myRecieve;
            const r = session.run({ type: 'collectMoney' }, 'Collected money at the bank');
            if (r.state.myRecieve === 0) {
              say('BANK09.TakeMoney');
              toast(`${money2(amt)} added to your cash.`, { icon: 'coin', tone: 'good', quiet: true });
            }
          } }))
        : h('div', { class: 'small muted' }, 'No money is waiting for you. When you send grain with O’Grady, he pays it here.'),
    );
  }

  function loanFile(s: GameState) {
    const li = loanInfo(s);
    const why = blockedReason();
    const p = s.propet;
    const contract = s.extra.loanRate ?? s.interest;
    const short = Math.max(0, li.due - p.cash);
    const canAll = p.cash + p.savings >= li.due;
    let action: HTMLElement;
    if (!li.canRepay) action = h('div', { class: 'small muted' }, `Repayment opens in November ${li.dueYear} (1996 rules).`);
    else if (short <= 0) action = btn(`Repay ${money2(li.due)}`, { kind: 'go', disabled: why ?? undefined, onClick: () => repay() });
    else if (canAll) action = btn(`Fetch ${money2(short)} from the box and repay`, { kind: 'go', icon: 'box', disabled: why ?? undefined, onClick: () => payWithFetch(session.s, li.due, repay, 'the loan') });
    else action = h('div', { class: 'small bad' }, `You need ${money2(li.due - p.cash - p.savings)} more to repay. Sell grain or save up before December ${li.dueYear}.`);
    const months = li.monthsLeft;
    return h(
      'div',
      { class: 'loan-file' },
      h('div', { class: 'lf-head' }, h('span', { class: 'eyebrow' }, 'Your loan file'), h('span', { class: `pill ${months <= 3 ? 'red' : 'brass'}` }, months <= 0 ? 'due now' : `${months} months left`)),
      h('div', { class: 'lf-grid' },
        h('div', null, h('small', null, 'You owe'), h('b', { class: 'big num' }, money2(li.due))),
        h('div', null, h('small', null, 'Due'), h('b', null, dueText(p0(), li.dueYear))),
        h('div', null, h('small', null, 'Your rate'), h('b', null, `${contract}%`), h('small', { class: 'muted' }, ` (today ${s.interest}%)`))),
      h('div', { class: 'small muted' }, `Repaid all at once. Cash in hand ${money2(p.cash)} · savings box ${money2(p.savings)}.`),
      action,
    );
  }

  function repay() {
    const r = session.run({ type: 'repayLoan' }, 'Repaid the loan');
    if (r.state.propet.loanAmount === 0) {
      say(r.state.devcut?.enabled ? 'BANK09.SEG018' : 'BANK09.OK');
      toast('The loan is repaid. The farm is yours, free and clear.', { icon: 'check', tone: 'good' });
    } else {
      const d = r.events.find((e): e is Extract<SimEvent, { type: 'dialog' }> => e.type === 'dialog');
      if (d) say(`BANK09.${d.id}`);
    }
  }

  function visualizer(s: GameState) {
    const li = loanInfo(s);
    const why = blockedReason();
    const cap = Math.max(10, Math.floor(li.cap / 10) * 10);
    amount = Math.min(Math.max(10, amount), cap);
    const amt = slider({ label: 'How much?', min: 10, max: cap, step: 10, value: amount, format: (v) => money(v), onInput: (v) => { amount = v; refreshLoan(); } });
    const term = segmented({ label: 'Repay in', options: [1, 3, 5].map((y) => ({ value: y, label: `${y} ${y === 1 ? 'year' : 'years'}` })), value: years, onChange: (v) => { years = v; refreshLoan(); } });
    const reasons: HTMLElement[] = [
      h('li', { class: li.needsHarvest ? 'no' : 'yes' }, icon(li.needsHarvest ? ICONS.cross : ICONS.check), 'You’ve finished a field job'),
      h('li', { class: li.has ? 'no' : 'yes' }, icon(li.has ? ICONS.cross : ICONS.check), 'No other loan'),
    ];
    const eligible = li.eligible;
    setTimeout(refreshLoan);
    takeBtn.disabled = !!why || !eligible;
    if (!eligible) takeBtn.title = li.needsHarvest ? 'The bank lends only after your first field job (plowing counts).' : 'Only one loan at a time.';
    return h(
      'div',
      { class: `loan-viz${eligible ? '' : ' ineligible'}` },
      h('div', { class: 'spread' }, h('h3', { class: 'card-title' }, 'Loan agreement'), h('span', { class: 'small muted' }, `Today’s rate `, h('b', null, `${s.interest}%`), ' · changes each January')),
      h('ul', { class: 'elig' }, ...reasons, h('li', { class: 'info' }, icon(ICONS.pin), `Up to ${money(li.cap)}${s.fidelity.mode === 'classic' ? ' (the form’s four digits)' : ', the value of your land'}`)),
      amt.el,
      h('div', { class: 'row' }, h('span', { class: 'small' }, 'Repay in'), term.el),
      chartHost,
      dueLine,
      h('div', { class: 'card-actions' }, takeBtn, h('span', { class: 'small muted' }, eligible ? 'Interest is added once, when you sign.' : li.needsHarvest ? 'Come back after your first plowing or harvest.' : 'Repay your loan before taking another.')),
    );
  }

  function render(s: GameState) {
    const key = JSON.stringify([s.myRecieve, s.propet.loanAmount, s.propet.cash, s.propet.savings, s.interest, s.cursit.firstHarv, !!s.pending, s.date]);
    if (key === stamp) return;
    stamp = key;
    const li = loanInfo(s);
    put(d.body, telegram !== null ? h('div', { class: 'tg-inline' }, telegramCard(s, telegram)) : null, cashierCard(s), li.has ? loanFile(s) : visualizer(s));
    app.setLabels([
      { target: { kind: 'prop', id: 'teller' }, text: 'Cashier', badge: s.myRecieve > 0 ? money(s.myRecieve) : null, tone: s.myRecieve > 0 ? 'good' : 'info' },
      { target: { kind: 'prop', id: 'loans' }, text: 'Loans', badge: li.has ? `Due Dec ${li.dueYear}` : null },
    ]);
  }

  // arrival: the sim journal resets; a pending telegram is shown once
  queueMicrotask(() => {
    if (!session.state || session.blocked) return;
    const r = session.run({ type: 'enterBank' }, 'enterBank');
    const tg = r.events.find((e): e is Extract<SimEvent, { type: 'telegram' }> => e.type === 'telegram');
    if (tg) {
      // the telegram lies on the cashier's counter (not a modal)
      telegram = tg.net;
      stamp = '';
      render(session.s);
    } else say(session.s.devcut?.enabled ? 'BANK09.Cashier' : 'BANK09.ECO005');
  });
  return { el, update: (s: GameState) => render(s), crumb: () => (session.state && loanInfo(session.s).has ? 'Loan file' : 'Loans') };
}

export function register(_env: PanelEnv) {
  registerPanel({
    id: 'bank',
    title: "Farmers' Bank",
    kind: 'place',
    place: 'bank',
    parent: 'street',
    hotbar: { key: '6', label: 'Bank', icon: ICONS.bank, order: 60, group: 'place', badge: (s) => badge.bank(s) },
    mount: ({ app }) => mount(app),
  });
}

/** DUEDATE (ui quirk): the 1996 form printed the due date as "Dec. ,1886". */
function dueText(s: GameState, year: number) {
  return reproduces(s.fidelity, 'DUEDATE') ? `Dec. ,${year}` : `December ${year}`;
}
function p0() {
  return session.s;
}
