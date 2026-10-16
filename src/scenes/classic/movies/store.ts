// STORE: the General Store (decompiled/lingo/STORE, spec 03-town.md §3). The store room, the
// seed counter with Harriet and the order form (the player types the total; the sim's
// buySeeds checks it as edCheckTotal did), and the catalogue book with its page turns.
// Prices, stock and purchases come from the sim (seedPricePerAcre, catalogAvailable,
// buySeeds, buyCatalogItem).
import type { MovieFactory, ClassicContext } from '../context.ts';
import type { Presenter } from '../../../engine/game.ts';
import type { CatalogName } from '../../../sim/data/tables.ts';
import { catalogAvailable, reproduces, seedPricePerAcre, type Crop, type QuirkId } from '../../../sim/index.ts';
import { text } from '../../../game/text.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { currencyToNumber, numberToCurrency, value } from '../dir/lingo.ts';
import { edBubble, edPlayBgMusic, edStopBgMusic, sharedScripts, syncMoney } from '../shared/common.ts';
import { Anim, goTo, hasHouse, hideIcon, say, showIcon, soundMember, townFields, type Destination } from '../town/common.ts';

type Page = { type: 'seedsMenu' | 'seeds' | 'products'; name: string; cast: string; loc: [number, number]; num?: number; price?: number };

const SEED_NAMES = ['Winter wheat', 'Spring Wheat', 'Oats', 'Corn'];
const PRODUCT_CAST: Record<CatalogName, string> = { windMill: 'windmill', wireFence: 'wire fence', kodakCamera: 'kodak camera', tractor: 'tractor', car: 'car' };

// psSpritesHandlerByColor: sprite numbers of the catalogue's named sprites (by score colour)
const S = {
  framePic: 3,
  dataPic: 4,
  price1: 10,
  price4: 13,
  productPrice: 14,
  soldOut: 16,
  catalogMask: 17,
  orderDialog: 18,
  dialogText: 19,
  numOfProducts: 22,
  productPrice2: 23,
  productTotalPrice: 24,
  upArrow: 5,
  downArrow: 6,
  seedsLabel: 7,
  productsLabel: 8,
  backToBtn: 9,
  buyBtn: 15,
  cancelBtn: 20,
  okBtn: 21,
  countUpBtn: 25,
  countDownBtn: 26,
};
/** spare channel for the in-stock count (CATSTOCK fixed) */
const STOCK_CH = 30;
const PUPPETS = [3, 4, 10, 11, 12, 13, 14, 16, 17, 18, 19, 22, 23, 24];
const BTNS = [5, 6, 7, 8, 9, 15, 20, 21, 25, 26];

// gStoreTalkCount is never reset (Harriet greets on the first two seed visits per program run)
let storeTalkCount = 0;
// STOREGREET fixed: the first seed visit of each month
let lastGreet = -1;

const factory: MovieFactory = (c: ClassicContext) => {
  const d = c.d;
  const g = c.g;
  const st = () => c.state!;
  const q = (id: QuirkId) => reproduces(st().fidelity, id);
  let talk = 0;
  let mySound = '';
  let seed: Crop = 1;
  let acres = 10;
  let seedRolled = 0;
  const editSprites = { acres: 4, total: 8 };
  let anim: Anim | null = null;
  // catalogue
  let pages: Page[] = [];
  let curPage = 0;
  const seedsFirst = 1;
  let productsFirst = 0;
  let maxProducts = 0;
  let pageTransition = 3;
  let catalogReady = false;
  let catalogSoundOnly = false;

  const price = (crop: Crop) => Math.round(seedPricePerAcre(st().date.year, crop) * 100) / 100;

  /** edSellerTalk(sound, 14, 1, endScript): Harriet's lips move while she speaks. */
  const sellerTalk = (name: string, end?: () => void) => {
    if (!anim) {
      const start = d.castNumber('AN woman,start');
      anim = new Anim(c, 14, start, d.castNumber('AN woman,end'), 'forever');
    }
    anim.stop();
    anim.synch = 1;
    mySound = name;
    say(c, name, 1);
    anim.endScript = end ?? null;
    anim.play();
  };

  const pointer = (ch: number) => d.setCursor(ch, HAND);
  const hideCursor = (ch: number) => d.setCursor(ch, 0);

  // ---------------------------------------------------------------- store room
  const edGoBoard = () => {
    for (let i = 20; i <= 27; i++) {
      hideCursor(i);
      d.puppetSprite(i, false);
    }
    hideCursor(2);
    hideCursor(3);
  };

  const nav = (where: Destination) => {
    edStopBgMusic(c);
    for (let i = 20; i <= 27; i++) {
      d.puppetSprite(i, false);
      hideCursor(i);
    }
    edGoBoard();
    goTo(c, where);
  };

  // ---------------------------------------------------------------- seeds order form
  const edAcres = () => d.setField('AcresToPlant', String(acres));
  const setEdit = (which: 'acres' | 'total') => {
    d.setEditable(which === 'acres' ? editSprites.total : editSprites.acres, false);
    d.setEditable(editSprites[which], true);
    d.focus = editSprites[which];
  };
  const roundAcres = (cur: number, up: boolean) => {
    if (up && cur % 10 > 0) cur += 10;
    return Math.trunc(cur / 10) * 10;
  };
  const leaveSeeds = () => {
    if (anim?.playing) {
      anim.stop();
      csound.stop(1);
    }
    for (const ch of [2, 3, 4, 5, 6, 13, 14]) {
      hideCursor(ch);
      d.puppetSprite(ch, false);
    }
  };
  const leaveBuy = () => {
    for (const ch of Object.values(editSprites)) {
      d.puppetSprite(ch, false);
      d.setEditable(ch, false);
    }
    for (let ch = 10; ch <= 13; ch++) {
      d.puppetSprite(ch, false);
      hideCursor(ch);
    }
    for (const ch of [2, 14]) hideCursor(ch);
    talk = 0;
    mySound = 'seg66';
  };
  const cancel = () => {
    leaveBuy();
    d.go('leave buy');
  };
  let lastResult: string | null = null;
  /** edCheckTotal through the sim's buySeeds (typed total). */
  const pressOk = async () => {
    if (anim) anim.endScript = null;
    lastResult = null;
    const acresNow = Math.trunc(value(d.field('AcresToPlant')));
    const typed = currencyToNumber(d.field('Total').trim());
    if (acresNow <= 0) return;
    await c.run({ type: 'buySeeds', crop: seed, acres: acresNow, typedTotal: typed });
    syncMoney(c);
    for (const ch of [2, 14]) pointer(ch);
    if (lastResult === 'SEG70') {
      leaveBuy();
      d.go('leave buy');
    }
  };
  const totalKey = (key: string, field: 'acres' | 'total') => {
    csound.stop(1);
    const id = field === 'total' ? 133 : 131;
    d.setFieldStyle(id, 'Arial', 12, 'Bold', d.color(123));
    const allowed = field === 'total' ? /^[0-9.]$/ : /^[0-9]$/;
    if (allowed.test(key) || key === 'Backspace' || key === 'Delete' || key.startsWith('Arrow') || key === 'Tab') return true;
    if (key === 'Enter') void pressOk();
    else if (key === 'Escape') cancel();
    return false;
  };

  // ---------------------------------------------------------------- catalogue
  const initCatalog = () => {
    curPage = 0;
    if (catalogReady) return;
    pages = [
      { type: 'seedsMenu', name: 'seedsMenu', cast: 'seeds menu', loc: [329, 203] },
      { type: 'seeds', name: 'winterWheat', cast: 'winter wheat', loc: [329, 203] },
      { type: 'seeds', name: 'springWheat', cast: 'spring wheat', loc: [329, 203] },
      { type: 'seeds', name: 'oats', cast: 'oats', loc: [329, 203] },
      { type: 'seeds', name: 'corn', cast: 'corn', loc: [329, 203] },
    ];
    productsFirst = 0;
    for (const p of catalogAvailable(st())) {
      const page: Page = { type: 'products', name: p.name, cast: PRODUCT_CAST[p.name], loc: [328, 143], num: p.stock, price: p.price };
      if (productsFirst === 0) productsFirst = pages.length + 1;
      // CATORDER: in-stock products go to the first product position (reverse order, classic);
      // fixed: in-stock ones in catalogue order, then the sold-out ones
      if (p.stock === 0) pages.push(page);
      else if (q('CATORDER')) pages.splice(productsFirst - 1, 0, page);
      else pages.splice(productsFirst - 1 + pages.slice(productsFirst - 1).filter((x) => (x.num ?? 0) > 0).length, 0, page);
    }
    // "Price of Enough Seeds for 20 Acres"
    const first = d.castNumber('seed price 1');
    for (let i = 0; i < 4; i++) d.setField(first + i, numberToCurrency(price((i + 1) as Crop) * 20));
    catalogReady = true;
  };
  const numPages = () => pages.length;
  const setSeedsPriceVisible = (on: boolean) => {
    for (let ch = S.price1; ch <= S.price4; ch++) (on ? showIcon : hideIcon)(c, ch);
  };
  const setSoldOutVisible = (on: boolean) => (on ? showIcon : hideIcon)(c, S.soldOut);
  const hideProductsSprites = () => {
    for (const ch of [S.productPrice, S.soldOut, S.countUpBtn, S.countDownBtn, S.cancelBtn, S.buyBtn]) hideIcon(c, ch);
  };
  const hideOrderForm = () => {
    for (const ch of [S.catalogMask, S.orderDialog, S.dialogText, S.numOfProducts, S.productPrice2, S.productTotalPrice, S.cancelBtn, S.okBtn, S.countUpBtn, S.countDownBtn]) hideIcon(c, ch);
  };
  const setProductPrice = () => {
    const p = pages[curPage - 1];
    d.setField('productPrice', numberToCurrency(p.price ?? 0));
    d.setField('productPrice2', numberToCurrency(p.price ?? 0));
    d.setCast(S.productPrice, 'productPrice');
    d.setCast(S.productPrice2, 'productPrice2');
  };
  const setTotal = () => {
    const p = pages[curPage - 1];
    d.setField('productsTotalPrice', numberToCurrency(value(d.field('numOfProducts')) * (p.price ?? 0)));
    d.setCast(S.productTotalPrice, 'productsTotalPrice');
  };
  const initProductPage = () => {
    const p = pages[curPage - 1];
    maxProducts = p.num ?? 0;
    // CATSTOCK: #numOfProductsInStock has no sprite, so the count never shows (classic);
    // fixed: shown under the price on a spare channel
    if (!q('CATSTOCK')) {
      d.setField('NumOfProductsInStock', `In stock: ${maxProducts}`);
      d.puppetSprite(STOCK_CH, true);
      d.setCast(STOCK_CH, 'NumOfProductsInStock');
      const sp = d.sprite(STOCK_CH);
      sp.width = 150;
      sp.height = 16;
      d.setLoc(STOCK_CH, 155, 303);
    }
    setSoldOutVisible(maxProducts < 1);
    setProductPrice();
    (maxProducts > 0 ? showIcon : hideIcon)(c, S.buyBtn);
  };
  const hideStock = () => {
    if (d.sprite(STOCK_CH).puppet) {
      d.setCast(STOCK_CH, null);
      d.puppetSprite(STOCK_CH, false);
    }
  };
  const showPagePicture = (n: number) => {
    hideStock();
    if (n === 0) {
      setSeedsPriceVisible(false);
      hideProductsSprites();
      hideOrderForm();
      d.setCast(S.dataPic, 'catalog main cover title');
      d.setCast(S.framePic, 'catalog main cover title');
      return;
    }
    const p = pages[n - 1];
    const frame = p.type === 'seedsMenu' ? 'seeds menu' : p.type === 'seeds' ? 'seeds frame' : 'products frame';
    d.setCast(S.framePic, frame);
    d.setCast(S.dataPic, p.cast);
    d.sprite(S.dataPic).stretch = false;
    d.setLoc(S.dataPic, p.loc[0], p.loc[1]);
    if (curPage === 1) {
      hideProductsSprites();
      setSeedsPriceVisible(true);
    } else if (curPage === productsFirst - 1) {
      setSeedsPriceVisible(false);
      hideProductsSprites();
    } else if (curPage > 1 && curPage < productsFirst) setSeedsPriceVisible(false);
    else if (curPage >= productsFirst) {
      setSeedsPriceVisible(false);
      if (curPage === productsFirst) showIcon(c, S.productPrice);
      showIcon(c, S.productPrice);
      initProductPage();
    }
  };
  const setButtons = (n: number) => {
    if (n === 0) {
      hideIcon(c, S.upArrow);
      hideIcon(c, S.downArrow);
    } else if (n === 1) {
      hideIcon(c, S.upArrow);
      showIcon(c, S.downArrow);
    } else if (curPage === numPages()) {
      showIcon(c, S.upArrow);
      hideIcon(c, S.downArrow);
    } else {
      showIcon(c, S.upArrow);
      showIcon(c, S.downArrow);
    }
  };
  const setLabels = (n: number) => {
    if (n === seedsFirst || n === productsFirst - 1) {
      d.setCast(S.seedsLabel, 'seedsLabelUp');
      d.setCast(S.productsLabel, 'productsLabelDown');
    } else if (n === productsFirst) {
      d.setCast(S.seedsLabel, 'seedsLabelDown');
      d.setCast(S.productsLabel, 'productsLabelUp');
    }
  };
  const showCatalogue = (n: number) => {
    if (n > 0) say(c, 'ECONOO12', 1);
    d.puppetTransition(pageTransition, 2);
    showPagePicture(n);
    setButtons(n);
    setLabels(n);
  };
  const leaveCata = () => {
    hideStock();
    for (const ch of PUPPETS) d.puppetSprite(ch, false);
    for (const ch of BTNS) {
      hideCursor(ch);
      d.puppetSprite(ch, false);
    }
    d.go('store');
  };
  const turn = (to: number, trans: number) => {
    d.cursor(4);
    curPage = to;
    pageTransition = trans;
    showCatalogue(curPage);
    d.cursor(0);
  };
  const productsOk = async () => {
    const p = pages[curPage - 1];
    const n = value(d.field('numOfProducts'));
    const total = n * (p.price ?? 0);
    if (st().propet.cash >= total) {
      await c.run({ type: 'buyCatalogItem', name: p.name as CatalogName, qty: n });
      syncMoney(c);
      p.num = (p.num ?? 0) - n;
      hideOrderForm();
      initProductPage();
    } else {
      catalogSoundOnly = true;
      say(c, 'SEG71', 1);
    }
  };
  const countArrows = (upDir: boolean) => {
    let n = value(d.field('numOfProducts'));
    if (upDir) {
      if (n < maxProducts) n++;
    } else if (n > 1) n--;
    d.setField('numOfProducts', String(n));
    setTotal();
  };

  const presenter: Partial<Presenter> = {
    async info(_s, e) {
      if (/^SEG(69|70|71|72|73)$/.test(e.id)) {
        lastResult = e.id;
        if (catalogSoundOnly) return;
        if (e.id === 'SEG69') {
          const sum = Number(e.params?.total ?? 0);
          // edUpdateTotalField: the clerk fills in the total (without the "$")
          sellerTalk('seg69', () => d.setField(133, numberToCurrency(sum).replace('$', '')));
        } else sellerTalk(e.id.toLowerCase());
        return;
      }
      await c.alert(text(e.id));
    },
  };

  const press = () => {
    if (csound.busy(1)) csound.stop(1);
    d.press();
  };

  return {
    presenter,
    startFrame: 1,
    startMovie() {
      g.retFromE = 'store';
      edPlayBgMusic(c, 'GANCOUA');
      d.puppetSound('sndDoor');
      townFields(c);
      syncMoney(c);
      mySound = '';
      catalogReady = false;
      void soundMember;
    },
    stopMovie() {
      anim?.stop();
      if (csound.busy(1)) csound.stop(1);
    },
    update(dt) {
      anim?.update(dt);
      syncMoney(c);
    },
    scripts: {
      ...sharedScripts(c),
      // store: init
      7: {
        exitFrame() {
          g.mode = 0;
          for (let ch = 2; ch <= 4; ch++) {
            showIcon(c, ch);
            pointer(ch);
          }
          d.puppetSprite(5, true);
          d.setVisible(5, false);
          for (let i = 20; i <= 27; i++) {
            d.puppetSprite(i, true);
            pointer(i);
          }
          hideCursor(20);
        },
      },
      // store loop: bubbles + the location bar
      20: {
        keyDown(key) {
          if (key === 'Escape') edGoBoard();
          return false;
        },
        exitFrame() {
          // edRollOver (local)
          if (d.rollOver(2)) {
            if (g.rolled !== 2) {
              edBubble(c, 5, 78, 510, 310);
              g.rolled = 2;
            }
          } else if (d.rollOver(3)) {
            if (g.rolled !== 3) {
              edBubble(c, 5, 77, 384, 200);
              g.rolled = 3;
            }
          }
          if (!d.rollOver(3) && !d.rollOver(2)) {
            d.setVisible(5, false);
            g.rolled = 0;
          }
          const bar = [20, 21, 22, 24, 25, 26, 27];
          if (d.mouseV > 421 && d.sprite(20).locV > 1000 && g.mode === 0) {
            for (const i of bar) {
              d.setLocV(i, d.sprite(i).locV - 1000);
              if (i !== 20) pointer(i);
            }
            if (hasHouse(c)) {
              d.setLocV(23, d.sprite(23).locV - 1000);
              pointer(23);
            }
          } else if ((d.mouseV < 422 || g.mode === 1) && d.sprite(20).locV < 1000) {
            for (const i of bar) {
              d.setLocV(i, d.sprite(i).locV + 1000);
              hideCursor(i);
            }
            if (hasHouse(c)) {
              d.setLocV(23, d.sprite(23).locV + 1000);
              hideCursor(23);
            }
          }
          d.go(d.frame);
        },
      },
      // catalogue book (2) / seed bins (3)
      3: {
        mouseUp() {
          d.cursor(4);
          if (g.mode !== 0) return;
          for (let i = 2; i <= 4; i++) {
            hideCursor(i);
            d.puppetSprite(i, false);
          }
          for (let i = 20; i <= 27; i++) {
            hideCursor(i);
            d.puppetSprite(i, false);
          }
          for (let i = 30; i <= 34; i++) d.puppetSprite(i, false);
          // edCataOrSeeds
          d.puppetSprite(5, false);
          d.setVisible(5, true);
          const click = d.clickOn;
          if (click === 2) d.go('catalogue');
          else if (click === 3) {
            if (q('STOREGREET')) {
              storeTalkCount++;
              talk = storeTalkCount <= 2 ? 1 : 0;
            } else {
              const key = st().date.year * 12 + st().date.mon;
              talk = key !== lastGreet ? 1 : 0;
              lastGreet = key;
            }
            d.go('seeds');
          }
          d.cursor(0);
        },
      },
      // location bar
      26: {
        mouseDown: press,
        mouseUp() {
          const m = d.clickOn - 20;
          g.marker = m;
          if (m === 1) nav('Field');
          else if (m === 2) nav('Bank09');
          else if (m === 3) {
            g.enter = 0;
            nav('House');
          } else if (m === 4) nav('TStreet1');
          else if (m === 5) nav('Calend');
        },
      },
      // seeds: init
      10: {
        exitFrame() {
          for (let ch = 2; ch <= 6; ch++) {
            d.puppetSprite(ch, true);
            pointer(ch);
          }
          seedRolled = 0;
          if (talk === 1) sellerTalk('seg66');
          if (mySound) for (const ch of [13, 14]) pointer(ch);
          d.cursor(0);
        },
      },
      // seeds loop: labels light up under the mouse
      21: {
        keyDown(key) {
          if (key === 'Escape') {
            leaveSeeds();
            d.go('store');
          }
          return false;
        },
        exitFrame() {
          let roll = false;
          for (let ch = 2; ch <= 5; ch++) {
            if (d.rollOver(ch)) {
              roll = true;
              if (seedRolled !== ch) {
                if (seedRolled > 0) d.setCast(seedRolled, 141 + seedRolled);
                seedRolled = ch;
                d.setCast(seedRolled, 137 + seedRolled);
                break;
              }
            }
          }
          if (!roll) {
            if (seedRolled > 0) d.setCast(seedRolled, 141 + seedRolled);
            seedRolled = 0;
          }
          d.go(d.frame);
        },
      },
      // choose a seed
      8: {
        mouseUp() {
          csound.stop(1);
          seed = (d.clickOn - 1) as Crop;
          leaveSeeds();
          d.go('buy');
        },
      },
      // back to the store from the seed counter
      16: {
        mouseDown: () => d.press(),
        mouseUp() {
          leaveSeeds();
          d.go('store');
        },
      },
      // Harriet: say the last line again
      17: {
        mouseUp() {
          if (mySound && anim) {
            anim.stop();
            sellerTalk(mySound);
          }
        },
      },
      // the order form: init
      11: {
        exitFrame() {
          acres = 10;
          edAcres();
          d.setField(133, ' ');
          d.setField(112, SEED_NAMES[seed - 1]);
          d.setField(132, `$${price(seed).toFixed(2)}`);
          for (const ch of Object.values(editSprites)) d.puppetSprite(ch, true);
          setEdit('acres');
          for (let ch = 10; ch <= 13; ch++) {
            d.puppetSprite(ch, true);
            pointer(ch);
          }
          if (talk) {
            sellerTalk('seg67', () => sellerTalk('seg68'));
            for (const ch of [2, 14]) pointer(ch);
          }
        },
      },
      // order form loop
      2: {
        keyDown(key) {
          if (key === 'Escape') cancel();
          return false;
        },
        exitFrame() {
          d.go(d.frame);
        },
      },
      // leave buy -> back to the seed counter
      25: {
        exitFrame() {
          d.go('seeds');
        },
      },
      // down arrow (round up, -10)
      13: {
        mouseDown: press,
        mouseUp() {
          if (!d.sprite(editSprites.acres).editable) setEdit('acres');
          acres = roundAcres(value(d.field('AcresToPlant')), true);
          if (acres > 10) acres -= 10;
          edAcres();
        },
      },
      // up arrow (round down, +10)
      23: {
        mouseDown: press,
        mouseUp() {
          if (!d.sprite(4).editable) setEdit('acres');
          acres = roundAcres(value(d.field('AcresToPlant')), false) + 10;
          edAcres();
        },
      },
      // the Total field
      14: {
        keyDown: (key) => totalKey(key, 'total'),
        mouseDown() {
          if (!d.sprite(d.clickOn).editable) setEdit('total');
        },
      },
      // the Acres field
      18: {
        keyDown: (key) => totalKey(key, 'acres'),
        mouseUp() {
          if (!d.sprite(4).editable) setEdit('acres');
        },
      },
      // OK (11) / Cancel (10) on the order form
      15: {
        mouseDown: press,
        mouseUp() {
          if (anim) anim.endScript = null;
          if (d.clickOn === 10) cancel();
          else if (d.clickOn === 11) void pressOk();
        },
      },
      // catalogue: init (frame 12)
      5: {
        exitFrame() {
          initCatalog();
          for (const ch of PUPPETS) d.puppetSprite(ch, true);
          for (const ch of BTNS) {
            d.puppetSprite(ch, true);
            pointer(ch);
          }
          pageTransition = 3;
          showCatalogue(0);
          d.cursor(0);
        },
      },
      // catalogue loop
      22: {
        keyDown(key) {
          if (key === 'Escape') leaveCata();
          return false;
        },
        exitFrame() {
          d.go(d.frame);
        },
      },
      31: {
        mouseDown: press,
        mouseUp() {
          if (curPage > 1) turn(curPage - 1, 3);
        },
      },
      4: {
        mouseDown: press,
        mouseUp() {
          if (curPage < numPages()) turn(curPage + 1, 4);
        },
      },
      32: {
        mouseUp() {
          if (curPage !== seedsFirst) turn(seedsFirst, curPage < seedsFirst ? 4 : 3);
        },
      },
      33: {
        mouseUp() {
          if (productsFirst && curPage !== productsFirst) turn(productsFirst, curPage < productsFirst ? 4 : 3);
        },
      },
      24: {
        mouseDown: () => d.press(),
        mouseUp: leaveCata,
      },
      // BUY
      45: {
        mouseDown: press,
        mouseUp() {
          d.setField('numOfProducts', '1');
          d.setCast(S.numOfProducts, 'numOfProducts');
          setProductPrice();
          setTotal();
          // edShowOrderFormDialog
          d.setCursor(S.catalogMask, 'arrow');
          for (const ch of [S.catalogMask, S.orderDialog, S.dialogText, S.numOfProducts, S.productPrice2, S.productTotalPrice, S.cancelBtn, S.okBtn]) showIcon(c, ch);
          if (maxProducts > 1) {
            showIcon(c, S.countUpBtn);
            showIcon(c, S.countDownBtn);
            pointer(S.countUpBtn);
            pointer(S.countDownBtn);
            d.setCast(S.dialogText, 'bmpOrdrDlgTxtForMany');
          } else {
            hideIcon(c, S.countUpBtn);
            hideIcon(c, S.countDownBtn);
            d.setCast(S.dialogText, 'bmpOrdrDlgTxtForOne');
          }
        },
      },
      34: { mouseDown: press, mouseUp: () => hideOrderForm() },
      35: {
        mouseDown: press,
        async mouseUp() {
          d.cursor(4);
          catalogSoundOnly = true;
          await productsOk();
          catalogSoundOnly = false;
          d.cursor(0);
        },
      },
      36: { mouseDown: press, mouseUp: () => countArrows(false) },
      37: { mouseDown: press, mouseUp: () => countArrows(true) },
      // the mask under the order form swallows clicks
      47: { mouseDown() {}, mouseUp() {} },
    },
  };
};

export default factory;
