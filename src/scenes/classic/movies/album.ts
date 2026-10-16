// ALBUM: the family album (decompiled/lingo/ALBUM, spec 04-home-album.md §6). Pages 1–2 are the
// fixed T1/T2 entries; pages 3–50 hold the player's diary text and a picture, stored in the sim
// (`album` via the setAlbumPage command). Captions and the picture count come from the sim
// (albumCaptions / albumMaxPictures: date-gated captions, the Kodak camera).
//
// Faithful quirks: the album reopens at the furthest page reached in the previous visit
// (18.ls writes g_LastPage over item 1), Return does not save the current page's text, the
// picture arrows wrap at g_MaxPic, a blank page hides the next-page arrow and Print.
import type { MovieFactory } from '../context.ts';
import type { ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { albumCaptions, albumMaxPictures } from '../../../sim/index.ts';
import { edRollOver, edStopBgMusic, castDate, syncMoney } from '../shared/common.ts';
import { houseMovie } from '../shared/house.ts';
import { YEAR_GB } from '../dir/lingo.ts';

const factory: MovieFactory = (c) => {
  const d = c.d;
  const g = c.g;
  const st = () => c.state!;
  // album globals
  let currPage = 2;
  let lastPage = 2;
  let curPic = 0;
  let text = 0; // g_Text: caption chooser open
  let maxPic = 5;
  let captions: number[] = []; // caption member numbers g_BegText..g_MaxText
  let tCounter = 0;
  let myPrint = 1;
  // page data mirrors (MyText fields / NumbPage line 2)
  const texts: string[] = [];
  const pics: number[] = [];

  const pageText = (p: number) => texts[p - 1] ?? '';
  const pagePic = (p: number) => pics[p - 1] ?? 0;

  /** put field "Text0" into field (MyText + page - 1) */
  const saveText = (p: number) => {
    const t = d.field('Text0');
    if (p < 3) return; // pages 1–2 are rewritten from T1/T2 on every visit
    texts[p - 1] = t;
    void c.run({ type: 'setAlbumPage', page: p, text: t, picture: pagePic(p) });
  };
  const savePic = (p: number, n: number) => {
    pics[p - 1] = n;
    if (p >= 3) void c.run({ type: 'setAlbumPage', page: p, picture: n });
  };

  const bg = (p: number) => d.setCast(1, p === 1 ? 'NuALB1' : p === 50 ? 'NuALB3' : 'NuALB2');

  /** NEWPAGE (MovieScript 2) */
  const newPage = (p: number) => {
    bg(p);
    curPic = pagePic(p);
    if (curPic > 0) {
      d.setCast(2, d.castNumber('PicS') + curPic - 1);
      if (d.sprite(2).locH > 1000) d.setLocH(2, d.sprite(2).locH - 1000);
      d.setCursor(3, HAND);
    } else if (d.sprite(2).locH < 1000) d.setLocH(2, d.sprite(2).locH + 1000);
    d.setField('Text0', pageText(p));
    d.setField('CurrentPage', p);
  };

  const turn = (delta: number) => {
    if (text !== 0) return;
    d.puppetSound('Econom22');
    g.enter = 0;
    saveText(currPage);
    currPage = Math.max(1, Math.min(50, currPage + delta));
    if (delta > 0 && lastPage < currPage) lastPage = currPage;
    newPage(currPage);
    d.setCursor(3, curPic > 0 ? HAND : 0);
  };

  const pickPic = (delta: number) => {
    if (text !== 0) return;
    let n = pagePic(currPage);
    if (delta < 0) n = n === 0 ? maxPic : n - 1;
    else {
      n += 1;
      if (n === maxPic + 1) n = 0;
    }
    curPic = n;
    if (n > 0) {
      d.setCast(2, d.castNumber('PicS') + n - 1);
      if (d.sprite(2).locH > 1000) d.setLocH(2, d.sprite(2).locH - 1000);
      d.setCursor(3, HAND);
    } else {
      if (d.sprite(2).locH < 1000) d.setLocH(2, d.sprite(2).locH + 1000);
      d.setCursor(3, 0);
    }
    savePic(currPage, n);
  };

  const closeChooser = () => {
    for (let i = 20; i <= 25; i++) if (d.sprite(i).locV < 1000) d.setLocV(i, d.sprite(i).locV + 1000);
    if (d.sprite(16).locV > 1000) d.setLocV(16, d.sprite(16).locV - 1000);
    g.enter = 0;
    d.setCursor(16, HAND);
    for (let i = 22; i <= 25; i++) d.setCursor(i, 0);
    text = 0;
    d.setField('AT', '');
    d.setEditable(10, true);
  };

  /** Pprint (MovieScript 28): PrintOMatic in the original; here the browser's print dialog. */
  const pprint = (from: number, to: number) => {
    const s = st();
    const pages: string[] = [];
    for (let p = from; p <= to; p++) {
      const t = p === 1 ? d.field('T1') : p === 2 ? d.field('T2') : pageText(p);
      if (!t) continue;
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r|\n/g, '<br>');
      pages.push(
        `<section><div class="l"><b>Name : ${esc(`${s.name.first} ${s.name.last}`)}</b><br><b>Date : ${YEAR_GB[s.date.mon - 1]} ${s.date.day}, ${s.date.year}</b>` +
          `${pagePic(p) > 0 ? '<p><i>All rights reserved to the Library of Congress.</i></p>' : ''}</div><div class="r"><b>- ${p} -</b><p>${esc(t)}</p></div></section>`,
      );
    }
    if (!pages.length || (navigator as Navigator & { webdriver?: boolean }).webdriver) return;
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10px';
    document.body.append(f);
    const doc = f.contentDocument!;
    doc.write(
      `<html><head><style>@page{size:landscape;margin:0.6in}section{display:flex;border:1px solid #000;border-radius:10px;height:6.5in;page-break-after:always;font:bold 14pt 'Times New Roman'}` +
        `.l,.r{flex:1;padding:20px}.l{border-right:1px solid #000}i{font:italic 12pt 'Courier New'}</style></head><body>${pages.join('')}</body></html>`,
    );
    doc.close();
    setTimeout(() => {
      f.contentWindow?.print();
      setTimeout(() => f.remove(), 1000);
    }, 50);
  };

  const scripts: ScriptTable = {
    // 5.ls (frame "Album"): caption range, picture count, fixed pages 1–2
    5: {
      exitFrame() {
        const s = st();
        captions = albumCaptions(s).map((id) => {
          if (id === 'ATextsE') return d.castNumber('ATextsE');
          const m = /^ATexts(\d+)$/.exec(id);
          if (m) return d.castNumber('ATexts') + Number(m[1]) - 1;
          return d.castNumber(id);
        });
        maxPic = albumMaxPictures(s);
        texts.length = 0;
        pics.length = 0;
        s.album.texts.forEach((t, i) => (texts[i] = t));
        s.album.pictures.forEach((n, i) => (pics[i] = n));
        texts[0] = d.field('T1');
        texts[1] = d.field('T2');
      },
    },
    // 6.ls: open at NumbPage item 1; g_LastPage = item 2 (which the original never updates)
    6: {
      exitFrame() {
        d.cursor(4);
        currPage = Math.max(1, Math.min(50, st().album.curPage || 2));
        lastPage = 2;
        d.go('Alb1');
      },
    },
    // 10.ls: cover click (unreachable in the original: frame 3 jumps straight to Alb1)
    10: {
      mouseUp() {
        d.cursorOff();
        d.go('Alb1');
      },
    },
    // 12.ls (Alb1): page setup
    12: {
      exitFrame() {
        text = 0;
        g.enter = 0;
        for (const i of [1, 2, 6, 7, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23, 24, 25]) d.puppetSprite(i, true);
        bg(currPage);
        curPic = pagePic(currPage);
        if (curPic > 0) {
          d.setCast(2, d.castNumber('PicS') + curPic - 1);
          if (d.sprite(2).locH > 1000) d.setLocH(2, d.sprite(2).locH - 1000);
        }
        d.setField('Text0', pageText(currPage));
        d.setField('CurrentPage', currPage);
        d.setField('AT', '');
        d.setCursor(3, curPic > 0 ? HAND : 0);
      },
    },
    // 4.ls (Alb2): visibility rules + bubble, loop
    4: {
      enterFrame() {
        if (text !== 0) return;
        const vis = (ch: number, on: boolean) => {
          const v = d.sprite(ch).locV;
          if (on && v > 1000) d.setLocV(ch, v - 1000);
          else if (!on && v < 1000) d.setLocV(ch, v + 1000);
        };
        if (g.enter === 0) {
          d.cursor(0);
          g.enter = 1;
          if (currPage === 1) {
            vis(12, true);
            vis(11, false);
            d.setCursor(12, HAND);
            d.setCursor(11, 0);
          } else if (currPage === 50) {
            vis(11, true);
            vis(12, false);
            const has = d.field('Text0') !== '';
            vis(14, has);
            d.setCursor(14, has ? HAND : 0);
            d.setCursor(11, HAND);
            d.setCursor(12, 0);
          } else {
            vis(11, true);
            d.setCursor(11, HAND);
          }
          for (const i of [6, 7, 16]) {
            vis(i, currPage >= 3);
            d.setCursor(i, currPage >= 3 ? HAND : 0);
          }
          d.setEditable(10, currPage > 2);
          if (currPage > 2) d.focus = 10;
          vis(13, true);
        }
        if (currPage !== 50) {
          const has = d.field('Text0') !== '';
          vis(12, has);
          vis(14, has);
          d.setCursor(14, has ? HAND : 0);
          d.setCursor(12, has ? HAND : 0);
        }
        d.setCursor(13, HAND);
      },
      exitFrame() {
        edRollOver(c, [16], [90], 15);
        d.go(d.frame);
      },
    },
    // 7.ls: Print button
    7: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        myPrint = 1;
        for (const i of [6, 7, 10, 11, 12, 13, 15, 14, 16, 20, 21, 22, 23, 24, 25]) {
          d.puppetSprite(i, false);
          if (!d.sprite(i).visible) d.setVisible(i, true);
        }
        saveText(currPage);
        g.enter = 0;
        d.setEditable(10, false);
        d.setField('PPage1', currPage);
        d.setField('PPage2', currPage);
        d.setField('PPage', currPage);
        d.setField('PPMin', 1);
        d.setField('PPMax', 50);
        d.go('Print');
      },
    },
    // 8.ls / 9.ls: page arrows
    8: { mouseDown: () => text === 0 && d.press(), mouseUp: () => turn(-1) },
    9: { mouseDown: () => text === 0 && d.press(), mouseUp: () => turn(+1) },
    // 13.ls: enlarge the picture
    13: {
      mouseUp() {
        if (text !== 0 || curPic <= 0) return;
        saveText(currPage);
        for (const i of [1, 2, 5, 6, 7, 10, 11, 12, 13, 14, 16]) d.puppetSprite(i, false);
        d.setEditable(10, false);
        d.go('AlbBig');
      },
    },
    // 14.ls (AlbBig)
    14: {
      exitFrame() {
        d.cursorOff();
        d.puppetSprite(3, true);
        d.setCast(3, d.castNumber('PicB') + curPic - 1);
        if (d.sprite(3).locV > 1000) d.setLocV(3, d.sprite(3).locV - 1000);
        d.setCursor(4, HAND);
      },
    },
    // 15.ls: back from the big picture
    15: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.puppetSprite(3, false);
        d.cursorOff();
        d.go('Alb1');
      },
    },
    16: { exitFrame: () => d.go(d.frame) },
    // 18.ls: Return to the house (the page text is not saved; item 1 := g_LastPage)
    18: {
      async mouseUp() {
        d.cursorOff();
        if (lastPage >= 3) await c.run({ type: 'setAlbumPage', page: lastPage });
        edStopBgMusic(c);
        void c.goMovie(houseMovie(st().globals.whatHouse), 1);
      },
    },
    // 19.ls / 20.ls: picture ◀ / ▶
    19: { mouseDown: () => text === 0 && d.press(), mouseUp: () => pickPic(-1) },
    20: { mouseDown: () => text === 0 && d.press(), mouseUp: () => pickPic(+1) },
    // 21.ls: open the caption chooser
    21: {
      mouseDown: () => d.press(),
      mouseUp() {
        for (let i = 1; i <= 20; i++) d.setCursor(i, 0);
        for (let i = 20; i <= 25; i++) if (d.sprite(i).locV > 1000) d.setLocV(i, d.sprite(i).locV - 1000);
        for (let i = 22; i <= 25; i++) d.setCursor(i, HAND);
        for (const i of [13, 14, 16]) if (d.sprite(i).locV < 1000) d.setLocV(i, d.sprite(i).locV + 1000);
        text = 1;
        tCounter = 0;
        d.setField('AT', d.field(captions[0] ?? 'ATexts'));
        d.setEditable(10, false);
      },
    },
    // 22.ls: OK replaces the page text with the caption
    22: {
      mouseDown: () => d.press(),
      mouseUp() {
        const cap = d.field('AT');
        closeChooser();
        d.setField('Text0', cap);
        texts[currPage - 1] = cap;
        saveText(currPage);
        d.focus = 10;
      },
    },
    // 23.ls: X closes without change
    23: { mouseDown: () => d.press(), mouseUp: () => closeChooser() },
    // 24.ls / 25.ls: previous / next caption (wrapping)
    24: {
      mouseDown: () => d.press(),
      mouseUp() {
        tCounter = (tCounter - 1 + captions.length) % Math.max(1, captions.length);
        d.setField('AT', d.field(captions[tCounter]));
      },
    },
    25: {
      mouseDown: () => d.press(),
      mouseUp() {
        tCounter = (tCounter + 1) % Math.max(1, captions.length);
        d.setField('AT', d.field(captions[tCounter]));
      },
    },
    // 26.ls (unused in the score)
    26: {
      exitFrame() {
        text = 0;
        bg(currPage);
      },
    },
    // 3.ls: Print dialog loop
    3: {
      exitFrame() {
        if (g.enter === 0) {
          g.enter = 1;
          for (const i of [13, 14, 15]) d.puppetSprite(i, true);
          for (const i of [13, 14, 15]) d.setCast(i, 'NN');
          d.setCast(12 + myPrint, 'YY');
          for (const i of [13, 14, 15, 16, 17]) d.setCursor(i, HAND);
          d.setEditable(23, true);
          d.setEditable(24, true);
        }
        d.go(d.frame);
      },
    },
    // 30.ls: the three radio buttons
    30: {
      mouseUp() {
        const n = d.clickOn - 12;
        if (n !== myPrint) {
          d.setCast(12 + myPrint, 'NN');
          myPrint = n;
          d.setCast(12 + myPrint, 'YY');
        }
      },
    },
    // 29.ls: OK (16) / X (17)
    29: {
      mouseDown: () => d.press(),
      mouseUp() {
        g.enter = 0;
        if (d.clickOn === 17) {
          for (const i of [13, 14, 15]) d.puppetSprite(i, false);
          d.setEditable(23, false);
          d.setEditable(24, false);
          d.focus = 0;
          d.go('Alb1');
          return;
        }
        if (myPrint === 1) pprint(currPage, currPage);
        else if (myPrint === 2) pprint(1, 50);
        else {
          const from = Number(d.field('PPage1')) || 0;
          const to = Number(d.field('PPage2')) || 0;
          if (to > lastPage || from > to) {
            d.setField('TT', from > to ? d.field('NoPrint1') : `${d.field('NoPrint2')} ${lastPage}.`);
            d.focus = 0;
            d.go(d.frame + 1);
          } else pprint(from, to);
        }
      },
    },
    // 32.ls: page-number fields take digits and Backspace only
    32: {
      keyDown(key) {
        return /^[0-9]$/.test(key) || key === 'Backspace';
      },
    },
    // 33.ls: OK on the error -> back to Print
    33: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        d.go('Print');
      },
    },
    34: { exitFrame: () => d.go(d.frame) },
  };

  return {
    scripts,
    startFrame: 1,
    startMovie() {
      castDate(c);
      syncMoney(c, false);
    },
  };
};

export default factory;
