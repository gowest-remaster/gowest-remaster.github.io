// NEWS: The Longview Gazette, read at home (spec 03 §5, 01 §6.9; decompiled/lingo/NEWS and
// SHARED MovieScript 3269/3270). Entered from a house at label News<g_WhatHouse>: the house
// picture in its palette, then the stack of issues (up to 4 fanned), the front page of the
// current issue with its date captions, BACKWARD/FORWARD arrows, five article hotspots that open
// the full article PICT (BigArticle), and the house icon back home.
import type { MovieFactory, MovieName } from '../context.ts';
import type { ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { YEAR_MON } from '../dir/lingo.ts';
import { newspaperIssues } from '../../../sim/index.ts';
import { articlePath, loadPic, showPic } from '../news/pic.ts';
import { G_ADATE, G_AYEARS, G_XNEWS, G_YNEWS } from '../news/lists.ts';

/** house palettes in the shared cast (puppetPalette("House"&n)) */
const HOUSE_PALETTE: Record<number, number> = { 1: 3513, 2: 3511, 3: 3509 };

const factory: MovieFactory = (c) => {
  const d = c.d;
  const whatHouse = () => Math.max(1, Math.min(3, c.state?.globals.whatHouse ?? 1));
  let cYear = 1;
  let myYear = 1;
  let paperNum = 1;
  let article = 1;
  let rolled = 0;

  const showIcon = (ch: number) => {
    d.setVisible(ch, true);
    d.setCursor(ch, HAND);
  };
  const hideIcon = (ch: number) => {
    d.setVisible(ch, false);
    d.setCursor(ch, 0);
  };
  const paperLocation = (ch: number) => d.setLoc(ch, G_XNEWS[ch - 3] + paperNum * 7, G_YNEWS[ch - 3] + paperNum * 8);

  /** edCYear: newest readable issue (the sim applies quirk T21: the rule as coded in classic) */
  const edCYear = () => {
    cYear = c.state ? newspaperIssues(c.state) : 1;
    myYear = Math.max(1, cYear);
    cYear = Math.max(1, cYear);
  };

  const showArrows = () => {
    if (cYear === 1) {
      hideIcon(8);
      hideIcon(9);
    } else if (myYear === cYear) {
      showIcon(8);
      paperLocation(8);
      hideIcon(9);
    } else if (myYear === 1) {
      hideIcon(8);
      showIcon(9);
      paperLocation(9);
    } else {
      showIcon(8);
      paperLocation(8);
      showIcon(9);
      paperLocation(9);
    }
  };

  const edShowNews = (s1: number, s2: number) => {
    paperNum = Math.min(myYear, 4);
    d.setCast(s1, d.castNumber('Gazet1') - 1 + paperNum);
    if (d.sprite(s1).locV > 1000) d.setLocV(s1, d.sprite(s1).locV - 1000);
    d.setCast(s2, String(G_AYEARS[myYear - 1]));
    paperLocation(s2);
    showArrows();
    for (let k = 1; k <= 5; k++) paperLocation(k + 9);
    for (let k = 1; k <= 4; k++) {
      if (paperNum < k) {
        d.setVisible(k + 3, false);
        continue;
      }
      const y = G_AYEARS[myYear - k];
      d.setVisible(k + 3, true);
      paperLocation(k + 3);
      const [mon, day] = G_ADATE[y];
      d.setField(d.castNumber('Year1') - 1 + k, `${YEAR_MON[mon - 1]} ${day}, ${y}`);
    }
    d.cursor(0);
  };

  const edRoll = (from: number, to: number, spr: number) => {
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
  };

  const goHouse = () => {
    const n = whatHouse();
    void c.goMovie(`HOUSE${n}` as MovieName);
  };

  const edLeaveBig = () => {
    d.cursorOff();
    d.sprite(2).video = null;
    for (let i = 2; i <= 4; i++) d.puppetSprite(i, false);
    d.go('Article');
  };

  const edNewsLeave = () => {
    d.cursorOff();
    for (let i = 2; i <= 17; i++) d.puppetSprite(i, false);
  };

  const toArticle = () => {
    d.cursorOff();
    edCYear();
    d.puppetSprite(1, true);
    d.cursor(4);
    d.go('Article');
  };

  const isEsc = (k: string) => k === 'Escape';

  const scripts: ScriptTable = {
    // 9: News<n> entry: the house picture in its palette
    9: {
      exitFrame() {
        d.puppetPalette(HOUSE_PALETTE[whatHouse()]);
        d.setCursor(2, HAND);
        d.setCursor(3, HAND);
      },
    },
    // 2: straight on to the papers
    2: { exitFrame: toArticle },
    // 5: the paper on the house picture
    5: { mouseUp: toArticle },
    // 17: startArticle
    17: {
      exitFrame() {
        for (let ch = 2; ch <= 17; ch++) {
          d.puppetSprite(ch, true);
          if (ch > 9 && ch < 15) showIcon(ch);
        }
        showIcon(16);
        d.setVisible(15, false);
        d.setVisible(17, false);
        edShowNews(2, 3);
        for (let i = 8; i <= 14; i++) if (d.sprite(i).visible) d.setCursor(i, HAND);
        d.setCast(16, `h${whatHouse()}`);
        if (d.sprite(16).locV > 1000) d.setLocV(16, d.sprite(16).locV - 1000);
        d.setCursor(16, HAND);
      },
    },
    // 20: Article loop (article highlight); Esc
    20: {
      exitFrame() {
        edRoll(10, 14, 15);
        d.go(d.frame);
      },
      keyDown(k) {
        // The original only un-puppets here (edNewsLeave) and strands the player on an empty
        // stage; we leave for the house as ScoreScript 22 does.
        if (isEsc(k)) {
          edNewsLeave();
          goHouse();
        }
        return false;
      },
    },
    // 16: BACKWARD / FORWARD
    16: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursor(4);
        const ch = d.clickOn;
        if (ch === 8) myYear -= myYear > 1 ? 1 : 0;
        else if (ch === 9) myYear += myYear < cYear ? 1 : 0;
        edShowNews(2, 3);
        for (let i = 8; i <= 9; i++) if (d.sprite(i).visible) d.setCursor(i, HAND);
      },
    },
    // 21: an article hotspot -> BigArticle
    21: {
      mouseUp() {
        d.cursor(4);
        d.puppetSprite(16, false);
        d.puppetSprite(3, false);
        article = d.clickOn - 9;
        for (let ch = 2; ch <= 15; ch++) {
          d.puppetSprite(ch, false);
          if (ch > 9 && ch < 15) hideIcon(ch);
        }
        d.setVisible(4, false);
        d.go('BigArticle');
      },
    },
    // 11: the house icon -> back home
    11: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        goHouse();
      },
    },
    // 22: (unused leave script)
    22: {
      mouseUp() {
        edNewsLeave();
        goHouse();
      },
    },
    // 19: startBigArticle
    19: {
      exitFrame() {
        d.puppetSprite(2, true);
        d.puppetSprite(3, true);
        d.puppetSprite(4, true);
        showIcon(3);
        d.setVisible(2, false);
        const y = G_AYEARS[myYear - 1];
        void loadPic(articlePath(y, article), 'bgTransparent').then((pic) => showPic(d, 2, pic));
        const n = whatHouse();
        d.setCast(3, `H${n}`);
        if (d.sprite(3).locV > 1000) d.setLocV(3, d.sprite(3).locV - 1000);
        d.setCursor(3, HAND);
        d.cursor(0);
      },
    },
    // 4: BigArticle loop: GO BACK bubble on the button; Esc
    4: {
      exitFrame() {
        let roll = false;
        if (d.rollOver(3) && d.sprite(3).visible) {
          if (rolled !== 3) {
            d.setVisible(4, true);
            rolled = 3;
          }
          roll = true;
        }
        if (!roll) {
          d.setVisible(4, false);
          rolled = 0;
        }
        d.go(d.frame);
      },
      keyDown(k) {
        if (isEsc(k)) edLeaveBig();
        return false;
      },
    },
    // 18: back from the big article
    18: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursor(4);
        edLeaveBig();
      },
    },
  };
  // NEWS defines edBubble/edRollOver for arrow bubbles (86/87) but never calls them.

  return {
    scripts,
    startFrame: `News${whatHouse()}`,
  };
};

export default factory;
