// The projector start (GOWEST.EXE frames "logo"/"login": EDULOGO.MOV, then the ENDFRM still)
// and LOGIN.DIR, the Edunetics login MIAW (320x200 window at 160,140) with its six dialogs.
// Ports LOGIN MovieScripts 1-3, 6, 7, CastScript 22 (keyboard table), CastScript 42 (user ID
// filter) and ScoreScripts 9-24. Users are engine profiles named by their upper-case user ID.
// Spec: docs/spec/01-framework.md §1.1 (logo), §4.3 (login).
import type { MovieFactory } from '../context.ts';
import type { DirPlayer } from '../dir/player.ts';
import { properCase } from '../dir/lingo.ts';
import { game } from '../../../engine/game.ts';
import { playMovie } from './open.ts';
import { createUser, findUser, goNow, openVideo, pressBtn, startVideo, type UserProfile } from '../front/util.ts';

const VALID_ID = 'abcdefghijklmnopqrstuvwxyz0123456789_^$~!#%&-{}@\'`()';

/** sToUpper: ASCII a-z only. */
const toUpper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

/** LOGIN's own sProperCase (MovieScript 6): ASCII only, words split on spaces. */
const sProperCase = (s: string) => properCase(s);

const factory: MovieFactory = (c) => {
  const d: DirPlayer = c.d;
  let phase: 'logo' | 'login' | 'halted' = c.g.x.skipLogo ? 'login' : 'logo';
  c.g.x.skipLogo = false;
  let logo: HTMLVideoElement | null = null;
  let keys: Record<string, () => unknown> = {};
  let newUserMode = false;
  let backTo: () => Promise<void> = () => initLogin();
  let user: UserProfile | null = null;
  let first = '';
  let last = '';

  // ---------------------------------------------------------------- dialogs (MovieScript 3)
  const btnCursors = () => {
    for (let ch = 14; ch <= 17; ch++) d.setCursor(ch, d.sprite(ch).member?.name.startsWith('btn') ? 'hand' : null);
  };
  const unpuppet = () => {
    for (let ch = 1; ch <= 48; ch++) d.puppetSprite(ch, false);
    d.focus = 0;
  };
  const key = (k: string, fn: () => unknown, ...more: string[]) => {
    keys[k] = fn;
    for (const m of more) keys[m] = fn;
  };

  async function initLogin() {
    backTo = initLogin;
    unpuppet();
    await goNow(d, 'login');
    btnCursors();
    d.puppetSprite(5, true);
    d.setEditable(5, true);
    d.focus = 5;
    keys = {};
    key('Enter', loginOk);
    key('opt+e', exitBtn);
    key('Escape', exitBtn);
  }

  async function initConfirm() {
    backTo = initConfirm;
    unpuppet();
    if (!newUserMode) {
      first = user?.first ?? '';
      last = user?.last ?? '';
    }
    d.setField('txtUserName', `${first} ${last}`);
    await goNow(d, 'confirm');
    btnCursors();
    keys = {};
    key('Enter', confirmYes, 'Y', 'y');
    key('Escape', confirmNo, 'N', 'n');
  }

  async function initWrongUser() {
    backTo = initWrongUser;
    unpuppet();
    await goNow(d, 'wrongUserId');
    btnCursors();
    keys = {};
    key('Enter', tryAgain, 'T', 't');
    key('Escape', exitBtn, 'E', 'e');
    key('N', newUserBtn, 'n');
  }

  async function initAddNewUser() {
    backTo = initAddNewUser;
    unpuppet();
    if (!newUserMode) {
      d.setField('txtUserFirstName', '');
      d.setField('txtUserLastName', '');
      d.setField('txtUserIDCopy', d.field('txtUserID'));
    }
    newUserMode = false;
    keys = {};
    key('Enter', newUserOk);
    key('Escape', tryAgain);
    key('Tab', newUserTab);
    key('opt+c', tryAgain);
    key('opt+e', exitBtn);
    await goNow(d, 'AddNewUser');
    btnCursors();
    for (const ch of [11, 8]) {
      d.puppetSprite(ch, true);
      d.setEditable(ch, true);
    }
    d.focus = 8;
  }

  async function initNewUserSummary() {
    backTo = initNewUserSummary;
    unpuppet();
    d.setField('txtUserIDCopy', d.field('txtUserID'));
    newUserMode = false;
    keys = {};
    key('Enter', confirmYes, 'C', 'c');
    key('Escape', exitBtn, 'E', 'e');
    await goNow(d, 'NewUserSummary');
    btnCursors();
  }

  async function initExitLogin() {
    unpuppet();
    keys = {};
    key('Enter', exitYes, 'Y', 'y');
    key('Escape', exitNo, 'N', 'n');
    await goNow(d, 'exitConfirm');
    btnCursors();
  }

  // ---------------------------------------------------------------- buttons (MovieScript 2)
  async function loginOk() {
    const id = d.field('txtUserID');
    if (!id) return;
    d.cursorOff();
    d.setField('txtUserID', toUpper(id));
    user = await findUser(toUpper(id));
    if (user) await initConfirm();
    else await initWrongUser();
  }

  async function exitBtn() {
    d.cursorOff();
    await initExitLogin();
  }

  async function confirmYes() {
    d.cursorOff();
    if (newUserMode) {
      // vCreateNewUser: the user's folder and act_rt.def become a profile with the names
      user = await createUser(d.field('txtUserID'), first, last);
      await initNewUserSummary();
    } else {
      await endLogin();
    }
  }

  async function confirmNo() {
    d.cursorOff();
    if (newUserMode) await initAddNewUser();
    else await initLogin();
  }

  async function tryAgain() {
    d.cursorOff();
    if (newUserMode) await initAddNewUser();
    else await initLogin();
  }

  async function newUserOk() {
    d.setField('txtUserFirstName', sProperCase(d.field('txtUserFirstName')));
    d.setField('txtUserLastName', sProperCase(d.field('txtUserLastName')));
    first = d.field('txtUserFirstName');
    last = d.field('txtUserLastName');
    if (first && last) {
      newUserMode = true;
      d.cursorOff();
      await initConfirm();
    }
  }

  async function newUserBtn() {
    d.cursorOff();
    await initAddNewUser();
  }

  function newUserTab() {
    d.setField('txtUserFirstName', sProperCase(d.field('txtUserFirstName')));
    d.setField('txtUserLastName', sProperCase(d.field('txtUserLastName')));
    return 'pass';
  }

  async function exitYes() {
    // halt(): the original quit the program. In the browser, Exit leaves Classic for the game's
    // main menu (the Remastered title); without that hook the login closes to a black screen.
    const sw = (window as unknown as { __gowestSwitchLook?: (l: 'classic' | 'remastered') => void }).__gowestSwitchLook;
    if (sw) return sw('remastered');
    d.cursorOff();
    phase = 'halted';
    unpuppet();
    for (let ch = 1; ch <= 48; ch++) d.setVisible(ch, false);
    keys = {};
  }

  async function exitNo() {
    d.cursorOff();
    await backTo();
  }

  /** vEndLogin + vExitLogin: the user is logged in; the projector continues with OPEN. */
  async function endLogin() {
    if (!user) return;
    user.lastPlayed = Date.now();
    await game.selectProfile(user);
    d.cursor(4);
    await c.goMovie('OPEN');
  }

  // ---------------------------------------------------------------- keyboard
  /** goKeyboard bCheck: run the action registered for this key; false = not handled (pass). */
  function bCheck(k: string, e: KeyboardEvent): boolean | 'pass' {
    const name = e.altKey ? `opt+${e.code.replace(/^Key/, '').toLowerCase()}` : k;
    const fn = keys[name];
    if (!fn) return false;
    const r = fn();
    if (r === 'pass') return 'pass';
    return true;
  }

  const btn = (fn: () => unknown) => ({
    async mouseDown() {
      if (phase !== 'login') return;
      if (await pressBtn(d)) await fn();
    },
  });

  return {
    startFrame: 'login',
    async startMovie() {
      d.cursor(4);
      if (c.g.x.afterEog === 'exit') {
        // CALEND's end-of-game EXIT = halt(): leave Classic for the main menu, as Exit -> Yes does
        c.g.x.afterEog = undefined;
        const sw = (window as unknown as { __gowestSwitchLook?: (l: 'classic' | 'remastered') => void }).__gowestSwitchLook;
        if (sw) return sw('remastered');
      }
      if (c.g.x.afterEog === 'intro' && game.profile) {
        // CALEND's end-of-game "start a new game": straight to INTRO for the same user
        phase = 'halted';
        setTimeout(() => void playMovie(c), 0);
        return;
      }
      // frame 1's palette channel (pltLogin); the movie starts on "login", past frame 1
      d.setPalette({ id: 81, name: 'pltLogin' });
      for (const f of ['txtUserID', 'txtUserIDCopy', 'txtUserFirstName', 'txtUserLastName', 'txtUserName']) {
        d.setField(f, '');
        // the extracted run colour (#fffbf0) is the STXT default; the fields draw in the sprite's black
        const m = d.member(f);
        for (const st of m?.styles ?? []) st.color = '#000000';
      }
      d.cursor(-1);
      if (phase === 'logo') {
        // GOWEST.EXE "logo": EDULOGO.MOV in the login window's rect; a click sets it to its end
        logo = await openVideo('EDULOGO.MOV'.replace('.MOV', '.mp4'));
        if (logo && (await startVideo(logo))) {
          logo.addEventListener('ended', () => void endLogo());
          logo.addEventListener('error', () => void endLogo());
          return;
        }
        phase = 'login';
      }
      // vInitLoginDialog once the first frame is on stage
      setTimeout(() => void initLogin(), 0);
    },
    stopMovie() {
      logo?.pause();
    },
    afterDraw(ctx) {
      // the logo plays exactly where the login window opens (160,140, 320x200); its last frame
      // is the ENDFRM still that the window then covers
      if (phase === 'logo' && logo) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 320, 200);
        if (logo.readyState >= 2) ctx.drawImage(logo, 0, 0, 320, 200);
        d.updateStage();
      } else if (phase === 'halted') {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 320, 200);
      }
    },
    movie: {
      mouseUp() {
        if (phase === 'logo' && logo) {
          logo.currentTime = Math.max(0, (logo.duration || 0) - 0.05);
          void endLogo();
        } else if (phase === 'halted') {
          phase = 'login';
          for (let ch = 1; ch <= 48; ch++) d.setVisible(ch, true);
          void initLogin();
        }
      },
      keyDown(k: string, e: KeyboardEvent) {
        if (phase !== 'login') return false;
        return bCheck(k, e) === 'pass';
      },
    },
    scripts: {
      // 9: dialog frames loop; keys go through the dialog's key table
      9: {
        exitFrame: () => d.go(d.frame),
        keyDown(k: string, e: KeyboardEvent) {
          if (phase !== 'login') return false;
          const r = bCheck(k, e);
          return r === false || r === 'pass';
        },
      },
      // 21: the user ID field (sprite script) + CastScript 42 (txtUserID) filter
      21: {
        keyDown(k: string, e: KeyboardEvent) {
          if (phase !== 'login') return false;
          if (k === 'Enter') {
            if (d.field('txtUserID')) void loginOk();
            return false;
          }
          if (k === 'Escape') {
            void exitBtn();
            return false;
          }
          if (!e.altKey && k.length === 1) {
            if (!VALID_ID.includes(k.toLowerCase())) return false;
            if (d.field('txtUserID').length >= 8) return false;
          }
          if (e.altKey) {
            const r = bCheck(k, e);
            return r === false || r === 'pass';
          }
          return true;
        },
      },
      // 24: the name fields: key table, and a click proper-cases both names
      24: {
        keyDown(k: string, e: KeyboardEvent) {
          if (phase !== 'login') return false;
          const r = bCheck(k, e);
          return r === false || r === 'pass';
        },
        mouseUp() {
          newUserTab();
        },
      },
      10: btn(loginOk),
      11: btn(exitBtn),
      12: btn(confirmYes),
      13: btn(confirmNo),
      14: btn(tryAgain),
      15: btn(newUserBtn),
      16: btn(newUserOk),
      17: btn(exitBtn),
      18: btn(exitYes),
      19: btn(exitNo),
    },
  };

  async function endLogo() {
    if (phase !== 'logo') return;
    phase = 'login';
    d.updateStage();
    await initLogin();
  }
};

export default factory;
