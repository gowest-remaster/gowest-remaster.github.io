// BANK09: the Farmers' Bank (decompiled/lingo/BANK09, spec 03-town.md §2). The lobby, the
// O'Grady telegram, the loan-rates poster, the cashier (receipt form with the pen signature),
// and the loans desk (loan agreement, repayment form, loan file). The spoken lines are the
// original cast sounds; money moves through the sim (enterBank, collectMoney, takeLoan,
// repayLoan, loanRepayment, canRepay).
import type { MovieFactory, ClassicContext } from '../context.ts';
import type { Presenter } from '../../../engine/game.ts';
import { canRepay, loanRepayment, reproduces } from '../../../sim/index.ts';
import { text } from '../../../game/text.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { lines, numberToCurrency, value } from '../dir/lingo.ts';
import { edPlayBgMusic, edStopBgMusic, sharedScripts, syncMoney } from '../shared/common.ts';
import { Anim, goTo, hasHouse, say, SignaturePad, townFields, up, down, type Destination } from '../town/common.ts';

// sim dialogs that the bank's own scripts already speak (the presenter stays quiet for them)
const SPOKEN = new Set(['TakeMoney', 'NoMoneyCashier', 'LoanAlready', 'needharvest', 'LoanOK', 'NothingToReturn', 'BigReturn', 'OK']);

const factory: MovieFactory = (c: ClassicContext) => {
  const d = c.d;
  const g = c.g;
  const st = () => c.state!;
  let telegram = false;
  let myRecieve = 0;
  let mySound = '';
  let speak = 0;
  let animDone = 0; // g_Anim
  let where = 0; // g_Where
  let bi = 1;
  let yes = 0;
  let newLoan = 0; // g_MyNewLoan
  let loanAmt = 0; // g_MyLoan (principal typed)
  let anim: Anim | null = null;
  const pad = new SignaturePad(c);

  const puppetSound = (name: string | 0) => {
    if (name) {
      mySound = name;
      say(c, name, 1);
    } else d.puppetSound(0, 1);
  };
  const ANIM = (ch: number, start: string, end: string) => {
    anim?.stop();
    anim = Anim.named(c, ch, start, end, 1);
    anim.endScript = () => (animDone = 1);
    anim.play();
  };
  const nav = (where: Destination) => {
    d.cursor(4);
    for (let i = 20; i <= 27; i++) d.puppetSprite(i, false);
    edStopBgMusic(c);
    goTo(c, where);
  };
  const toLoans0 = (sound: string) => {
    speak = 0;
    puppetSound(sound);
    d.go('Loans0');
  };

  /** keyUp of the loan amount (ScoreScript 55) and a year pick (29): RepayDate / MyReturn. */
  const recompute = () => {
    let t = d.field('MyLoan');
    if (t.length > 4) {
      t = t.slice(0, 4);
      d.setField('MyLoan', t);
    }
    const years = value(lines(d.field('MyDate'))[0]);
    if (value(t) > 0 && t.length < 5 && years > 0) {
      // DUEDATE: the original's "Dec. ,1886" typo
      d.setField('RepayDate', reproduces(st().fidelity, 'DUEDATE') ? `Dec. ,${st().date.year + years}` : `Dec. ${st().date.year + years}`);
      loanAmt = value(t);
      newLoan = loanRepayment(loanAmt, st().interest, years);
      d.setField('MyReturn', numberToCurrency(newLoan));
    } else if (value(t) === 0) {
      loanAmt = 0;
      d.setField('MyReturn', '');
      d.setField('RepayDate', '');
    }
  };

  const presenter: Partial<Presenter> = {
    async info(_s, e) {
      if (SPOKEN.has(e.id)) return;
      if (e.id === 'SEG008') {
        puppetSound('SEG008.WAV');
        return;
      }
      await c.alert(text(e.id));
    },
  };

  const press = () => d.press();
  const penCursor = (ch: number) => d.setCursor(ch, 'pen');

  return {
    presenter,
    startFrame: 1,
    async startMovie() {
      d.puppetSound(0, 1);
      g.music = 'GANCOUA';
      edPlayBgMusic(c, 'GANCOUA');
      d.cursor(4);
      const s = c.state;
      if (!s) return;
      telegram = s.cursit.telegram.pending === 1;
      // keep the telegram text for the Tel frame before the sim marks it read
      await c.run({ type: 'enterBank' });
      townFields(c);
      myRecieve = st().myRecieve;
      d.setField('Rec', numberToCurrency(myRecieve));
      d.setField('Interest', `${st().interest}%`);
      d.setField('FileNum', '8062');
    },
    stopMovie() {
      anim?.stop();
      csound.stop(1);
    },
    update(dt) {
      anim?.update(dt);
      syncMoney(c);
    },
    afterDraw(ctx) {
      pad.render(ctx);
    },
    scripts: {
      ...sharedScripts(c),
      // Mmenu: telegram or lobby
      69: {
        exitFrame() {
          g.mode = 0;
          g.retFromE = 'MMenu';
          for (let i = 20; i <= 27; i++) {
            d.setVisible(i, true);
            d.puppetSprite(i, true);
          }
          d.setVisible(10, true);
          d.cursor(0);
          if (telegram) {
            telegram = false;
            const name = `${st().name.first} ${st().name.last}`;
            const ls = lines(d.field('Telegram'));
            ls[2] = `TO: ${name}`;
            d.setField('Tel', ls.join('\r'));
            d.go('Tel');
          } else d.go(d.frame + 1);
        },
      },
      // lobby loop: hand cursors and the location bar
      5: {
        exitFrame() {
          if (!d.sprite(2).cursor && g.mode === 0) for (const ch of [2, 3, 4, 5]) d.setCursor(ch, HAND);
          const bar = [20, 21, 22, 24, 25, 26, 27];
          if (d.mouseV > 421 && d.sprite(20).locV > 1000 && g.mode === 0) {
            for (const i of bar) {
              d.setLocV(i, d.sprite(i).locV - 1000);
              if (i !== 20) d.setCursor(i, HAND);
            }
            if (hasHouse(c)) {
              d.setLocV(23, d.sprite(23).locV - 1000);
              d.setCursor(23, HAND);
            }
          } else if ((d.mouseV < 422 || g.mode === 1) && d.sprite(20).locV < 1000) {
            for (const i of bar) {
              d.setLocV(i, d.sprite(i).locV + 1000);
              d.setCursor(i, 0);
            }
            if (hasHouse(c)) {
              d.setLocV(23, d.sprite(23).locV + 1000);
              d.setCursor(23, 0);
            }
          }
          d.go(d.frame);
        },
      },
      // location bar
      67: {
        mouseDown: press,
        mouseUp() {
          const m = d.clickOn - 20;
          if (m === 1) nav('Field');
          else if (m === 2) nav('Store');
          else if (m === 3) {
            g.enter = 0;
            nav('House');
          } else if (m === 4) nav('TStreet1');
          else if (m === 5) nav('Calend');
        },
      },
      // telegram
      49: {
        exitFrame() {
          if (!d.sprite(4).cursor) d.setCursor(4, HAND);
          d.go(d.frame);
        },
      },
      51: {
        mouseDown: press,
        mouseUp() {
          d.cursorOff();
          d.go('MMenu');
        },
      },
      // loan rates poster
      34: {
        mouseUp() {
          for (let i = 20; i <= 27; i++) d.puppetSprite(i, false);
          d.go('Rate');
        },
      },
      40: {
        enterFrame() {
          d.cursorOff();
        },
        exitFrame() {
          d.setCursor(2, 'fhand');
          d.puppetSprite(3, true);
          d.setCast(3, d.castNumber('BankI3') + st().interest - 3);
          d.setLoc(3, 313, 317);
        },
      },
      39: {
        mouseUp() {
          d.puppetSprite(3, false);
          for (let i = 20; i <= 27; i++) d.puppetSprite(i, false);
          d.cursorOff();
          d.go('MMenu');
        },
      },
      // the officer's lips while a line plays (frames 12 and 75; casts 169..171 are gone: no-op)
      16: {
        exitFrame() {
          if (csound.busy(1) && d.timer >= 20) {
            bi++;
            const m = d.member(168 + bi);
            if (m) d.setCast(2, m);
            d.startTimer();
            if (bi === 3) bi = 1;
          }
          d.go(d.frame);
        },
      },
      // LOANS window
      7: {
        mouseUp() {
          if (g.mode !== 0) return;
          for (let i = 20; i <= 36; i++) d.puppetSprite(i, false);
          for (let i = 4; i <= 7; i++) d.puppetSprite(i, false);
          d.cursorOff();
          toLoans0('Eco005');
        },
      },
      // Loans0: the officer talks (Loan..LoanEnd) while the line plays, then the desk
      11: {
        exitFrame() {
          if (speak === 0) {
            speak = 1;
            d.puppetSprite(2, true);
          }
          let n = d.sprite(2).castNum + 1;
          if (n >= d.castNumber('LoanEnd')) n = d.castNumber('Loan');
          d.setCast(2, n);
          if (csound.busy(1)) d.go(d.frame);
          else {
            speak = 0;
            d.puppetSprite(2, false);
            d.setCast(2, 'Loan');
            d.go('Loans');
          }
        },
        mouseUp() {
          d.puppetSound(0, 1);
        },
      },
      // Loans desk: REPAY only in Nov/Dec of the due year
      44: {
        exitFrame() {
          d.puppetSprite(6, true);
          if (canRepay(st()) && d.sprite(6).locV > 1000) {
            d.setLocV(6, d.sprite(6).locV - 1000);
            d.setCursor(6, HAND);
          }
          d.setCursor(5, HAND);
          d.setCursor(7, HAND);
          d.setCursor(3, 'fhand');
        },
      },
      // back to the lobby (bottom strip)
      22: {
        mouseUp() {
          d.cursorOff();
          for (let i = 20; i <= 27; i++) d.puppetSprite(i, false);
          d.puppetSprite(2, false);
          if (d.sprite(6).puppet) {
            d.puppetSprite(6, false);
            down(c, 6);
          }
          d.puppetSound(0, 1);
          d.go('Mmenu');
        },
      },
      // TAKE
      8: {
        mouseDown: press,
        mouseUp() {
          g.enter = 0;
          yes = 0;
          d.cursorOff();
          const s = st();
          if (s.propet.loanAmount > 0) {
            d.puppetSprite(6, false);
            toLoans0('LoanAlready');
          } else if (s.cursit.firstHarv !== 1) {
            d.puppetSprite(6, false);
            toLoans0('needharvest');
          } else {
            loanAmt = 0;
            newLoan = 0;
            d.setField('MyReturn', '');
            d.setField('RepayDate', '');
            d.go('4TakeL');
          }
        },
      },
      // REPAY
      9: {
        mouseDown: press,
        mouseUp() {
          d.cursorOff();
          if (st().propet.loanAmount === 0) toLoans0('NothingToReturn');
          else d.go('5ReturnL');
        },
      },
      // INFO.
      10: {
        mouseDown: press,
        mouseUp() {
          d.cursorOff();
          d.puppetSprite(6, false);
          if (st().propet.loanAmount > 0) {
            puppetSound('LookInfo');
            d.go('6InfoL');
          } else toLoans0('NoInfo');
        },
      },
      // 4TakeL: "To apply for a loan..." while the officer hands over the form
      65: {
        exitFrame() {
          animDone = 0;
          puppetSound('TakeLoan');
          ANIM(2, 'LA', 'LAE');
        },
      },
      35: {
        exitFrame() {
          if (animDone === 0) {
            d.go(d.frame);
            return;
          }
          d.cursorOff();
          for (const ch of [4, 5, 10, 11, 12, 24]) d.setCursor(ch, HAND);
          penCursor(21);
        },
      },
      // the loan agreement: init
      42: {
        exitFrame() {
          d.cursorOff();
          penCursor(21);
          d.setField('MyLoan', '');
          d.setField('MyDate', ' ');
          loanAmt = 0;
          newLoan = 0;
          where = 4;
          d.puppetSprite(6, false);
          d.puppetSprite(3, false);
          d.setField('BankName', `${st().name.first} ${st().name.last}`);
          pad.clear();
        },
      },
      74: {
        exitFrame() {
          if (g.enter === 0) {
            d.cursorOff();
            g.enter = 1;
            for (const ch of [9, 10, 11]) d.puppetSprite(ch, true);
            penCursor(21);
            for (const ch of [24, 8, 17, 19]) d.setCursor(ch, HAND);
            d.setEditable(6, true);
            d.focus = 6;
          }
          d.go(d.frame);
        },
      },
      // the amount field: digits and Backspace, 4 characters
      55: {
        keyDown(key) {
          if (/^[0-9]$/.test(key) || key === 'Backspace') {
            queueMicrotask(recompute);
            return true;
          }
          return false;
        },
      },
      // the years arrow: open/close the 1/3/5 list
      25: {
        mouseDown: press,
        mouseUp() {
          if (yes !== 1) {
            yes = 1;
            for (const ch of [9, 10, 11]) up(c, ch);
            d.setCursor(11, HAND);
          } else {
            yes = 0;
            for (const ch of [9, 10, 11]) down(c, ch);
          }
        },
      },
      // pick a line of the list (ListChoose)
      29: {
        mouseUp() {
          const sp = d.sprite(11);
          const ls = lines(d.field('PayDate')).filter((l) => l.trim());
          const r = sp.rect();
          const lh = (r.bottom - r.top) / ls.length;
          let n = Math.trunc((d.mouseV - r.top) / lh) + 1;
          n = Math.max(1, Math.min(ls.length, n));
          d.setField('MyDate', String(value(ls[n - 1])));
          recompute();
          yes = 0;
          for (const ch of [9, 10, 11]) down(c, ch);
          d.setCursor(11, 0);
        },
      },
      // OK on the agreement
      12: {
        mouseDown: press,
        async mouseUp() {
          const years = value(lines(d.field('MyDate'))[0]);
          if (!(value(d.field('MyLoan')) > 0 && years > 0)) return;
          d.cursorOff();
          d.setEditable(6, false);
          await c.run({ type: 'takeLoan', amount: Math.trunc(value(d.field('MyLoan'))), years });
          syncMoney(c);
          for (let i = 1; i <= 25; i++) d.puppetSprite(i, false);
          pad.clear();
          toLoans0('LoanOK');
        },
      },
      // Cancel (agreement / repayment)
      2: {
        mouseDown: press,
        mouseUp() {
          d.cursorOff();
          loanAmt = 0;
          newLoan = 0;
          d.setEditable(6, false);
          for (let i = 1; i <= 25; i++) d.puppetSprite(i, false);
          pad.clear();
          toLoans0('loanCans');
        },
      },
      // 5ReturnL
      46: {
        enterFrame() {
          d.cursorOff();
          d.puppetSound(0, 1);
          d.setCursor(2, 0);
          d.setVisible(25, false);
          d.setVisible(23, false);
          d.puppetSprite(6, false);
          pad.clear();
        },
      },
      17: {
        exitFrame() {
          for (const ch of [4, 5, 10, 11, 12, 24]) d.setCursor(ch, HAND);
          penCursor(21);
          d.setField('MyReturn', numberToCurrency(st().propet.loanAmount));
          where = 5;
        },
      },
      // receipt / repayment / info forms loop
      1: {
        exitFrame() {
          if (g.enter === 0) {
            d.cursorOff();
            g.enter = 1;
            penCursor(21);
            for (const ch of [24, 10, 12]) d.setCursor(ch, HAND);
          }
          d.go(d.frame);
        },
      },
      // OK on the repayment form
      50: {
        mouseDown: press,
        async mouseUp() {
          if (st().propet.loanAmount > st().propet.cash) {
            puppetSound('BigReturn');
            return;
          }
          d.cursorOff();
          d.puppetSound(0, 1);
          await c.run({ type: 'repayLoan' });
          syncMoney(c);
          for (let i = 1; i <= 12; i++) d.puppetSprite(i, false);
          pad.clear();
          toLoans0('OK');
        },
      },
      // the legacy partial-payment list (dead in the original)
      26: { mouseDown: press, mouseUp() {} },
      // 6InfoL: the loan file
      19: {
        exitFrame() {
          d.cursorOff();
          for (let i = 1; i <= 20; i++) d.puppetSprite(i, false);
          g.enter = 0;
          d.setField('LoanInfo', numberToCurrency(st().propet.loanAmount));
          d.setField('PayYear', String(st().propet.loanDueYear));
          d.setField('MyDate', String(st().loanYears));
          d.setField('Interest', `${st().interest}%`); // today's rate (quirk)
          where = 6;
        },
      },
      73: {
        exitFrame() {
          if (g.enter === 0) {
            g.enter = 1;
            d.setCursor(10, HAND);
          }
          d.go(d.frame);
        },
      },
      59: {
        mouseDown: press,
        mouseUp() {
          d.cursorOff();
          d.puppetSprite(2, false);
          toLoans0('OK');
        },
      },
      // CASHIER window
      6: {
        mouseUp() {
          if (g.mode !== 0) return;
          for (let i = 20; i <= 36; i++) d.puppetSprite(i, false);
          d.cursorOff();
          g.enter = 0;
          speak = 0;
          if (myRecieve > 0) {
            d.setCursor(3, 0);
            animDone = 0;
            puppetSound('TakeMoney');
            where = 3;
            d.go(d.labelFrame('3ReceiveT') + 1);
          } else {
            puppetSound('NoMoney');
            d.go('3ReceiveT');
          }
        },
      },
      // 3ReceiveT: the cashier talks (C..CEnd)
      61: {
        exitFrame() {
          if (speak === 0) {
            speak = 1;
            d.puppetSprite(6, true);
            d.setCursor(5, HAND);
            d.setCursor(4, 'fhand');
          }
          if (csound.busy(1)) {
            let n = d.sprite(6).castNum + 1;
            if (n >= d.castNumber('CEnd')) n = d.castNumber('C');
            d.setCast(6, n);
          }
          if (csound.busy(1) || myRecieve === 0) d.go(d.frame);
          else {
            speak = 0;
            d.puppetSprite(6, false);
            d.go(d.frame + 1);
          }
        },
      },
      62: {
        mouseUp() {
          speak = 0;
          puppetSound(mySound || 'NoMoney');
          d.go('3ReceiveT');
        },
      },
      // counting out the money (Cash..CashEnd once), then the receipt form
      56: {
        exitFrame() {
          if (speak === 0) {
            speak = 1;
            animDone = 0;
            ANIM(2, 'Cash', 'CashEnd');
          }
          if (animDone === 0) {
            d.go(d.frame);
            return;
          }
          d.puppetSprite(2, false);
          d.puppetSprite(9, false);
          d.puppetSprite(10, false);
          d.setVisible(9, true);
          d.setVisible(10, true);
          pad.clear();
          speak = 0;
          d.go(d.frame + 1);
        },
      },
      // OK on the receipt: Document(3) = the cashier pays out
      14: {
        mouseDown: press,
        async mouseUp() {
          d.cursorOff();
          d.puppetSound(0, 1);
          if (where === 3) {
            await c.run({ type: 'collectMoney' });
            myRecieve = st().myRecieve;
            d.setField('Rec', numberToCurrency(myRecieve));
            syncMoney(c);
          }
          for (let i = 9; i <= 27; i++) d.puppetSprite(i, false);
          pad.clear();
          d.go('MMenu');
        },
      },
      // leave the receipt without signing for the money
      57: {
        mouseDown: press,
        mouseUp() {
          d.cursorOff();
          d.puppetSound(0, 1);
          for (let i = 9; i <= 27; i++) d.puppetSprite(i, false);
          pad.clear();
          d.go('MMenu');
        },
      },
      // signature pad and eraser
      33: {
        async mouseDown() {
          await pad.draw(21);
        },
      },
      32: {
        mouseDown: press,
        mouseUp() {
          pad.clear();
        },
      },
      // print buttons (hidden in the original): nothing
      13: { mouseDown: press, mouseUp() {} },
    },
  };
};

export default factory;
