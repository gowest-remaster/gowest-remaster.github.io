// TTALK: the town talk (spec 03 §4; decompiled/lingo/TTALK/casts/Internal/*.ls).
// Townspeople on the boardwalk; clicking one plays their recorded line lip-synced with the
// `T<cast>`..`T<cast>E` animation (after an optional `BT` "before talk" anim), followed by the
// scripted replies of the STTalks chain. Idle townsfolk fidget (`RT` anims). Some talks carry a
// newspaper (Papers/BigArticle). Talk 120 (P6) is the finale: the town sings TT20.MOV.
//
// The rules side (which talk, g_TTalkName/Path, g_EOG) lives in the sim; this is presentation.
// CALEND's presenter calls `playTownTalk`, which resolves when the player leaves the talk.
import type { ClassicContext, MovieFactory } from '../context.ts';
import type { Handlers, ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { extUrl } from '../dir/cast.ts';
import { random, YEAR_MON } from '../dir/lingo.ts';
import { reproduces } from '../../../sim/index.ts';
import { Actors, AnimObj } from '../ttalk/anim.ts';
import { articlePath, loadPic, showPic } from '../news/pic.ts';
import { G_ADATE, G_AYEARS, G_WHATN } from '../news/lists.ts';

/** CALEND ScoreScript 78: the TTALK label for a talk number. */
export function ttalkLabel(id: number): string {
  if (id === 110 || id === 111) return 'P2';
  if (id === 112 || id === 113) return 'P3';
  if ((id > 113 && id < 120) || [204, 205, 206, 301, 302, 303].includes(id)) return 'P4';
  if ([201, 202, 203].includes(id)) return 'P5';
  if (id === 120) return 'P6';
  return 'P1';
}

interface TalkX {
  ttalkId?: number;
  ttalkPath?: string;
  ttalkDone?: () => void;
}

/**
 * Play town talk `id` (sound folder `path`, e.g. "TTalk1") on the stage. Resolves when the
 * player leaves (the H1 button / the finale's exit); the caller decides where to go next.
 */
export async function playTownTalk(c: ClassicContext, id: number, path: string): Promise<void> {
  const x = c.g.x as TalkX;
  x.ttalkId = id;
  x.ttalkPath = path;
  const done = new Promise<void>((resolve) => (x.ttalkDone = resolve));
  await c.goMovie('TTALK', ttalkLabel(id));
  await done;
}

/** STTalks field: `[#102 :[#7 : [8],#DEF : [8]], ...]` -> {102: {7: [8], DEF: [8]}}. */
type PropList = Record<string, number[]>;
export function parseSTTalks(src: string): Record<number, PropList> {
  const out: Record<number, PropList> = {};
  const s = src.replace(/\s+/g, '');
  const re = /#(\d+):\[((?:#\w+:\[[\d,]*\],?)*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const talk: PropList = {};
    const re2 = /#(\w+):\[([\d,]*)\]/g;
    let k: RegExpExecArray | null;
    while ((k = re2.exec(m[2]))) talk[k[1]] = k[2] ? k[2].split(',').map(Number) : [];
    out[Number(m[1])] = talk;
  }
  return out;
}

const REG_TTALK = [101, 112, 114, 115, 117, 118, 201, 202, 203, 204, 205, 206, 220, 302];
/** g_Layers: sprite -> voice layer (1-based sprite index) */
const LAYERS = [1, 1, 3, 2, 4, 5, 6, 8, 9, 7];
const LOOP_LIST: Record<number, number> = { 4: 3, 6: 1, 7: 7, 8: 1, 10: 5 };
const RATES = [155, 428, 840, 1100, 1300, 1705, 2130, 2430];
const SING_DURATION = 3380; // ticks of TT20.MOV (56.3 s)
const SING_CH = 4; // the QuickTime sprite's own audio, kept apart from the voice channels

const factory: MovieFactory = (c) => {
  const d = c.d;
  const x = c.g.x as TalkX;
  const st = c.state;
  const year = st?.date.year ?? 1880;
  const id = x.ttalkId ?? st?.globals.tTalkName ?? 101;
  const tpath = x.ttalkPath ?? st?.globals.tTalkPath ?? 'TTalk1';
  let label = ttalkLabel(id); // g_Label
  const actors = new Actors();

  // ---------------------------------------------------------------- globals of the movie
  let started = false; // startMovie ran
  let defList: number[] = new Array(11).fill(0);
  let stTalk: PropList = {};
  let dtTalk: number[] = [];
  let rList: number[] = [];
  let gSprite = 0;
  let startAnim = 0;
  let before = 0;
  let times = 1;
  let howMany: number[] = [];
  let curSprite = 0;
  let gName = '0';
  let rPlay = 0;
  let enter = 0;
  let myObject: AnimObj | null = null;
  let myNewObject: AnimObj | null = null;
  let mySound = '';
  // finale
  let sing: [number, number][] = [];
  let gS = 0;
  let singStarted = false;
  let singEnded = false;
  // newspaper
  let myYear = 1;
  let article = 1;

  const allTalks = () => parseSTTalks(d.field('STTalks'));

  const finish = () => {
    closeAll();
    csound.stop(3);
    csound.stop(SING_CH);
    const cb = x.ttalkDone;
    x.ttalkDone = undefined;
    x.ttalkId = undefined;
    x.ttalkPath = undefined;
    if (cb) cb();
    else void c.goMovie('CALEND', 'Start');
  };

  // ---------------------------------------------------------------- MovieScript 4/6/10
  function startMovie() {
    // MovieScript 4 startMovie: the farmer and Sophie by era (run once the label frame is on stage)
    d.puppetSprite(6, true);
    d.puppetSprite(10, true);
    d.setCast(6, year < 1887 ? '1-5' : '2-5');
    d.setCast(10, year < 1887 ? '1-7' : '2-7');
    if (d.sprite(6).locV > 1000) d.setLocV(6, d.sprite(6).locV - 1000);
    if (d.sprite(10).locV > 1000) d.setLocV(10, d.sprite(10).locV - 1000);
  }

  function init() {
    sing = [[6, 0], [10, 0], [3, 0], [5, 0], [6, 0], [7, 0], [6, 0]];
    rPlay = 0;
    before = 0;
    startAnim = 0;
    howMany = [];
    actors.clear();
    myObject = null;
    gSprite = 0;
    rList = year < 1887 ? [4, 6, 7, 8, 10] : [6, 7, 10];
  }

  function returnCast(p: number) {
    if (d.sprite(p).castNum !== defList[p]) d.setCast(p, defList[p]);
  }

  function findAnim(sp: number) {
    let path = tpath;
    let s: string;
    if (REG_TTALK.includes(id)) s = `tt${id}_${LAYERS[sp - 1]}`;
    else if (dtTalk.includes(sp - 1) && sp === gSprite) {
      path = 'TTalk1';
      // quirk TTDSILENT: the original builds "ttd_" && layer = "ttd_ 5.WAV", which doesn't exist
      s = st && !reproduces(st.fidelity, 'TTDSILENT') ? `ttd_${LAYERS[sp - 1]}` : `ttd_ ${LAYERS[sp - 1]}`;
    } else s = `tt${id}_${LAYERS[sp - 1]}`;
    mySound = `DATA\\SOUND\\TTalk\\${path}\\${s}.WAV`;
  }

  function makeList(sp: number) {
    const follow = stTalk[String(sp - 1)] ?? [];
    howMany = [sp, ...follow];
    if (!REG_TTALK.includes(id)) stTalk = allTalks()[id] ?? {};
  }

  function sprite89(sp: number) {
    if (sp === 8 && d.sprite(9).locV < 1000 && label === 'P1') d.setLocV(9, d.sprite(9).locV + 1000);
    else if (sp === 9 && d.sprite(9).locV > 1000 && label === 'P1') d.setLocV(9, d.sprite(9).locV - 1000);
  }

  function anim(sp: number, start: string, end: string) {
    rPlay = 1;
    sprite89(sp);
    myObject?.close();
    const o = AnimObj.open(d, actors, sp, start, end);
    if (!o) {
      console.warn('ttalk: no animation', start, end);
      return;
    }
    myObject = o;
    if (before === 1) {
      o.setLoop(1);
      o.endScript = firstReturn;
    } else if (before === 2) {
      o.endScript = myReturn;
      o.sync = 2;
      const snd = mySound;
      void (async () => {
        const url = await extUrl(snd);
        if (url && myObject === o && o.mode === 'play') void csound.play(2, url);
        o.syncArmed = true;
      })();
      d.updateStage();
    }
    o.play();
  }

  function animL(sp: number, start: string, end: string) {
    if (myObject) {
      myObject.stop();
      myObject.close();
    }
    const o = AnimObj.open(d, actors, sp, start, end);
    if (!o) {
      console.warn('ttalk: no animation', start, end);
      return;
    }
    myObject = o;
    o.play();
  }

  function cast536() {
    d.setCast(5, '1-4');
    d.setCast(3, '1-3');
    d.setCast(6, '2-5');
  }

  function myReturn() {
    returnCast(curSprite);
    startAnim = 1;
    times++;
    gName = '0';
    rPlay = 0;
    d.updateStage();
    myObject?.close();
  }

  function firstReturn() {
    startAnim = 1;
    before = 2;
  }

  function randAnim(sp: number, start: string, end: string, loop: number) {
    const o = AnimObj.open(d, actors, sp, start, end);
    if (!o) {
      console.warn('ttalk: no animation', start, end);
      return;
    }
    myNewObject = o;
    o.setLoop(loop);
    o.endScript = rClose;
    o.play();
    if (sp === 8 && d.sprite(9).locV < 1000) d.setLocV(9, d.sprite(9).locV + 1000);
  }

  function rClose() {
    myNewObject?.close();
    rPlay = 0;
  }

  function ifRandom() {
    const rs = random(9) + 1;
    if (rList.includes(rs) && rs !== gSprite) {
      if (d.sprite(rs).castNum !== defList[rs]) d.setCast(rs, defList[rs]);
      const loop = LOOP_LIST[rs];
      const name = d.member(defList[rs])?.name ?? '';
      if (rs !== 4) randAnim(rs, `RT${name}`, `RT${name}E`, loop);
      else if (random(8) < 5) randAnim(rs, `R1T${name}`, `R1T${name}E`, 3);
      else randAnim(rs, `R2T${name}`, `R2T${name}E`, 1);
    } else rPlay = 0;
  }

  function closeAll() {
    if (myObject) {
      csound.stop(2);
      myObject.close();
    }
    if (myNewObject) {
      csound.stop(2);
      myNewObject.close();
    }
    actors.clear();
  }

  // ---------------------------------------------------------------- movie time of "Sing"
  function movieTime(): number {
    if (!singStarted) return 0;
    if (singEnded) return SING_DURATION;
    const t = csound.time(SING_CH);
    if (t < 0) {
      if (!csound.busy(SING_CH)) singEnded = true;
      return singEnded ? SING_DURATION : 0;
    }
    return Math.min(SING_DURATION, Math.floor(t * 60));
  }

  function startSing() {
    singStarted = true;
    singEnded = false;
    void extUrl('DATA\\QT\\TTALK\\TT20.wav').then((u) => {
      if (u) void csound.play(SING_CH, u);
    });
  }

  // ---------------------------------------------------------------- newspaper (Papers)
  function edRoll(from: number, to: number, spr: number) {
    let roll = false;
    for (let s = from; s <= to; s++) {
      if (d.rollOver(s)) {
        const r = d.sprite(s).rect();
        d.spriteBox(spr, r.left, r.top, r.right, r.bottom);
        d.sprite(spr).passThrough = true; // the highlight frame must not swallow the click
        d.setVisible(spr, true);
        roll = true;
        break;
      }
    }
    if (!roll) d.setVisible(spr, false);
  }

  /** wrap every exitFrame so the actorList steps once per score frame */
  const tick = (h: Handlers): Handlers =>
    h.exitFrame
      ? {
          ...h,
          exitFrame() {
            actors.step();
            return h.exitFrame!();
          },
        }
      : h;

  const scripts: ScriptTable = {
    // 1: Init at each P label
    1: {
      exitFrame() {
        if (!started) {
          started = true;
          startMovie();
        }
        init();
        stTalk = {};
        dtTalk = [];
        if (id !== 120 && !REG_TTALK.includes(id)) {
          stTalk = allTalks()[id] ?? {};
          dtTalk = stTalk.DEF ?? [];
        }
        defList = new Array(11).fill(0);
        for (let i = 1; i <= 10; i++) defList[i] = d.sprite(i).castNum;
        for (let i = 2; i <= 11; i++) d.puppetSprite(i, true);
        d.puppetSprite(13, true);
        d.cursor(0);
        enter = 0;
        if (id === 117 || id === 118) {
          startAnim = 1;
          before = 0;
          times = 1;
          gSprite = 2;
          makeList(gSprite);
          gName = '0';
        }
        d.puppetSound(0);
      },
    },
    // 2: the talk loop (PP1..PP5)
    2: {
      exitFrame() {
        if (enter === 0) {
          enter = 1;
          for (let i = 2; i <= 10; i++) if (!(i === 4 && d.sprite(i).castNum === d.castNumber('1-0'))) d.setCursor(i, HAND);
          d.setCursor(14, HAND);
          if (G_WHATN[id]) {
            if (d.sprite(13).locV > 1000) d.setLocV(13, d.sprite(13).locV - 1000);
            d.setCursor(13, HAND);
          }
        }
        if (startAnim === 1 && times <= howMany.length) {
          startAnim = 0;
          if (times === 1) curSprite = howMany[0];
          else {
            curSprite = howMany[times - 1] + 1;
            if (curSprite === 9 && d.sprite(9).locV > 1000) d.setLocV(9, d.sprite(9).locV - 1000);
          }
          if (gName === '0') {
            returnCast(curSprite);
            gName = d.member(defList[curSprite])?.name ?? '';
          }
          if (d.castNumber(`BT${gName}`) > 0 && before === 0) {
            before = 1;
            anim(curSprite, `BT${gName}`, `BT${gName}E`);
          } else {
            before = 2;
            findAnim(curSprite);
            anim(curSprite, `T${gName}`, `T${gName}E`);
          }
        } else if (rPlay === 0 && random(10) < 3 && !csound.busy(2)) {
          rPlay = 1;
          ifRandom();
        }
        d.go(d.frame);
      },
    },
    // 3: click a townsperson
    3: {
      mouseUp() {
        const click = d.clickOn;
        if (click === 4 && d.sprite(4).castNum === 105) return; // the empty rocking chair
        if (myObject) {
          csound.stop(2);
          myReturn();
          myObject.stop();
          myObject.close();
        }
        if (myNewObject) {
          myNewObject.stop();
          myNewObject.close();
        }
        rPlay = 1;
        gSprite = click;
        if (gSprite === 11) {
          if (d.sprite(9).locV > 1000) d.setLocV(9, d.sprite(9).locV - 1000);
          gSprite = 9;
        } else if (gSprite === 8 && d.sprite(9).castNum === d.castNumber('1-9')) {
          if (d.sprite(9).locV < 1000) d.setLocV(9, d.sprite(9).locV + 1000);
        }
        startAnim = 1;
        before = 0;
        times = 1;
        makeList(gSprite);
        gName = '0';
      },
    },
    // 5, 8, 17: idle loops
    5: { exitFrame: () => d.go(d.frame) },
    8: { exitFrame: () => d.go(d.frame) },
    17: { exitFrame: () => d.go(d.frame) },
    // 9: H1 "thank you, neighbors" -> back to the game board
    9: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        closeAll();
        d.puppetSound(0, 3);
        finish(); // (talk 120 would halt() here; its exit is sprite 15 / script 21)
      },
    },
    // 13: the newspaper on the bench
    13: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        closeAll();
        d.puppetSprite(1, true);
        d.go('Papers');
      },
    },
    // 15: Papers: the issue's front page
    15: {
      exitFrame() {
        for (const i of [22, 23, 24, 30, 31, 32, 33, 34, 35]) d.puppetSprite(i, true);
        d.setCursor(36, HAND);
        myYear = G_WHATN[id] ?? 1;
        const y = G_AYEARS[myYear - 1];
        d.setCast(23, String(y));
        const [mon, day] = G_ADATE[y];
        d.setField('Year1', `${YEAR_MON[mon - 1]} ${day}, ${y}`);
        for (const i of [22, 23, 24, 30, 31, 32, 33, 34]) d.setLocV(i, d.sprite(i).locV - 1000);
        for (const i of [30, 31, 32, 33, 34]) d.setCursor(i, HAND);
      },
    },
    // 14: Papers loop (highlight the article under the mouse)
    14: {
      exitFrame() {
        edRoll(30, 34, 35);
        d.go(d.frame);
      },
    },
    // 12: an article hotspot
    12: {
      mouseUp() {
        d.cursorOff();
        d.cursor(4);
        for (const i of [22, 23, 24, 30, 31, 32, 33, 34, 35]) d.puppetSprite(i, false);
        article = d.clickOn - 29;
        d.go('BigArticle');
      },
    },
    // 16: H1 on the front page -> back to the talk
    16: {
      mouseUp() {
        d.cursorOff();
        enter = 0;
        for (const i of [22, 23, 24, 30, 31, 32, 33, 34, 35]) d.puppetSprite(i, false);
        d.go(`P${label}`); // g_Label = "P1" -> "PP1", the talk loop
      },
    },
    // 11: BigArticle: load the article PICT into cast "Pic"
    11: {
      exitFrame() {
        d.puppetSprite(22, true);
        d.puppetSprite(23, true);
        d.setVisible(22, false);
        const y = G_AYEARS[myYear - 1];
        void loadPic(articlePath(y, article), 'matte').then((pic) => showPic(d, 22, pic));
        d.cursor(0);
        d.setCursor(23, HAND);
      },
    },
    // 18: H1 on the article -> back to the front page
    18: {
      mouseUp() {
        d.cursorOff();
        const s = d.sprite(22);
        s.video = null;
        d.puppetSprite(22, false);
        d.puppetSprite(23, false);
        d.go('Papers');
      },
    },
    // ------------------------------------------------------------ finale (P6)
    // 22: P0 (the song starts with the QuickTime sprite)
    22: {
      exitFrame() {
        if (!singStarted) startSing();
      },
    },
    // 19: P66: the town sings along with TT20.MOV
    19: {
      exitFrame() {
        const mt = movieTime();
        if (mt > 100 && mt < 250 && !d.sprite(13).cursor) {
          d.setCursor(13, HAND);
          d.setCursor(14, HAND);
        }
        const singAt = (i: number) => sing[i][1];
        const singer = (i: number) => sing[i][0];
        const setProp = (key: number) => {
          const e = sing.find((p) => p[0] === key);
          if (e) e[1] = 1;
        };
        const sang = (i: number, byProp: boolean) => {
          if (i > 0) returnCast(gS);
          gS = singer(i);
          if (byProp) setProp(gS);
          else sing[i][1] = 1;
          const nm = d.member(defList[gS])?.name ?? '';
          animL(gS, `T${nm}`, `T${nm}E`);
        };
        if (mt > 0 && mt < RATES[0] && singAt(0) === 0) sang(0, true);
        else if (mt >= RATES[0] && mt < RATES[1] && singAt(1) === 0) sang(1, true);
        else if (mt >= RATES[1] && mt < RATES[2] && singAt(2) === 0) sang(2, true);
        else if (mt >= RATES[2] && mt < RATES[3] && singAt(3) === 0) sang(3, true);
        else if (mt >= RATES[3] && mt < RATES[4] && singAt(4) === 0) sang(4, false);
        else if (mt >= RATES[4] && mt < RATES[5] && singAt(5) === 0) sang(5, true);
        else if (mt >= RATES[6] && mt < RATES[7] && singAt(6) === 0) {
          returnCast(gS);
          cast536();
          startAnim = 0;
          gS = singer(6);
          sing[6][1] = 1;
          const nm = d.member(defList[gS])?.name ?? '';
          animL(gS, `T${nm}`, `T${nm}E`);
        } else if ((mt >= RATES[5] && mt < RATES[6]) || (mt >= RATES[7] && mt < 3380)) {
          // everybody sways together
          if (startAnim === 0) {
            startAnim = 1;
            if (myObject) {
              myObject.stop();
              myObject.close();
            }
            d.setCast(5, 'T1-4');
            d.setCast(3, 'T1-3');
            d.setCast(6, 'T2-5');
          }
          const cycle = (ch: number, a: string, e: string) => {
            d.setCast(ch, d.sprite(ch).castNum + 1);
            if (d.sprite(ch).castNum === d.castNumber(e)) d.setCast(ch, a);
          };
          cycle(5, 'T1-4', 'T1-4E');
          cycle(3, 'T1-3', 'T1-3E');
          cycle(6, 'T2-5', 'T2-5E');
        } else if (mt === SING_DURATION && rPlay === 0) {
          rPlay = 1;
          d.startTimer();
          if (myObject) {
            myObject.stop();
            myObject.close();
            actors.clear();
          }
          cast536();
        }
        d.go(d.frame);
      },
    },
    // 20: click the scene (once the song is under way) to hear it again
    20: {
      mouseUp() {
        if (d.sprite(13).cursor === HAND) {
          csound.stop(SING_CH);
          singStarted = false;
          if (myObject) {
            myObject.stop();
            myObject.close();
          }
          init();
          d.go('P0');
        }
      },
    },
    // 21: the finale's exit: g_EOG = 1 (the sim already ended the game), back to the board
    21: {
      mouseDown: () => d.press(),
      mouseUp() {
        closeAll();
        finish();
      },
    },
  };
  for (const k of Object.keys(scripts)) scripts[Number(k)] = tick(scripts[Number(k)]);
  // test/debug hook: the talk state
  (window as unknown as Record<string, unknown>).__ttalk = () => ({ id, label, startAnim, times, howMany, gName, before, rPlay, gSprite, actors: actors.list.map((a) => [a.sprite, a.cur, a.mode, a.syncArmed]) });

  return {
    scripts,
    startFrame: label,
    stopMovie() {
      closeAll();
      csound.stop(2);
      csound.stop(SING_CH);
    },
    // keep g_Label in sync if the talk was entered at another label
    startMovie() {
      label = ttalkLabel(id);
    },
  };
};

export default factory;
