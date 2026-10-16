// Ports of the shared-cast (SHARED.DIR) scripts every location movie uses:
//   - the Options panel "EE" (credits, volume knob, music on/off, exit + save) and the credits
//     scroller (ScoreScript 3213-3221, 3271-3273; spec 01 §6.2-6.3)
//   - callout bubbles (MovieScript 3208 edRollOver, per-movie edBubble; §6.1)
//   - background MIDI (MovieScript 3209), ChangeCash/ALLMONEY money fields and the coin sound,
//     CASTDATE (LocDate field)
// Merge `sharedScripts(c)` into a movie's ScriptTable.
import type { ClassicContext } from '../context.ts';
import type { ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { numberToCurrency, YEAR_GB } from '../dir/lingo.ts';
import { reproduces, type QuirkId } from '../../../sim/index.ts';

/**
 * Presentation quirk switch (sim/fidelity.ts, scope 'ui'): true = show the 1996 behaviour.
 * Classic rules reproduce them all; a classic look over remastered rules shows the fixes.
 * Before a game exists (LOGIN/OPEN/INTRO of a new game) the classic behaviour is used.
 */
export function quirk(c: { state: { fidelity: Parameters<typeof reproduces>[0] } | null }, id: QuirkId): boolean {
  return c.state ? reproduces(c.state.fidelity, id) : true;
}

// ------------------------------------------------------------------ background music
/** `edPlayBgMusic(g_Filename)`: "GP1" (houses), "GANCOUA" (bank, livestock); null = none. */
export function edPlayBgMusic(c: ClassicContext, file: string | null) {
  c.g.music = file;
  if (c.g.myMidi === 1 || !file) return;
  csound.musicOn = true;
  csound.playMusic(file);
}

export function edStopBgMusic(c: ClassicContext) {
  void c;
  csound.stopMusic();
}

// ------------------------------------------------------------------ money / date fields
/**
 * ALLMONEY / ChangeCash display part: MyCash and Save fields from the sim; plays
 * "TownMap\Mo1.WAV" on channel 2 when the cash shown changes (as the original did).
 */
export function syncMoney(c: ClassicContext, sound = true) {
  const s = c.state;
  if (!s) return;
  const cash = numberToCurrency(Math.max(0, s.propet.cash));
  if (sound && c.d.field('MyCash') !== cash && c.d.field('MyCash') !== '') void csound.playFile(2, 'DATA\\SOUND\\TOWNMAP\\Mo1.WAV');
  c.d.setField('MyCash', cash);
  c.d.setField('Save', numberToCurrency(s.propet.savings));
}

/** CASTDATE (SHARED 3204): LocDate = "MON.\rDAY\rYEAR" (parts > 0 only). */
export function castDate(c: ClassicContext) {
  const s = c.state;
  if (!s) return;
  const parts = [YEAR_GB[s.date.mon - 1], s.date.day > 0 ? String(s.date.day) : '', String(s.date.year)];
  c.d.setField('LocDate', parts.join('\r'));
}

// ------------------------------------------------------------------ bubbles
/** Per-movie `edBubble` (CALEND MovieScript 1 and copies): show bubble "A-CALL<n>.PCT". */
export function edBubble(c: ClassicContext, sprite: number, bubNum: number, h: number, v: number) {
  const d = c.d;
  // bubble 92's cast is named "A-CALL92. PCT" (stray space), so the lookup fails (BUBBLE92)
  const m = d.member(`A-CALL${bubNum}.PCT`) ?? (bubNum === 92 && !quirk(c, 'BUBBLE92') ? d.member('A-CALL92. PCT') : null);
  if (!m) return;
  d.puppetSprite(sprite, true);
  d.setCast(sprite, m);
  d.setLoc(sprite, h, v);
  d.setVisible(sprite, true);
  // the bubble has no script: it must not swallow clicks meant for the hotspot under it
  // (it covers most of the logbook arrows and part of the savings box)
  d.sprite(sprite).passThrough = true;
}

/** `edRollOver(spriteList, bubbleList, bubbleSprite)`, called every frame. */
export function edRollOver(c: ClassicContext, sprites: number[], calls: number[], bubble: number) {
  const d = c.d;
  let roll = false;
  d.puppetSprite(bubble, true);
  for (let i = 0; i < sprites.length; i++) {
    const ch = sprites[i];
    if (d.rollOver(ch) && d.sprite(ch).visible) {
      roll = true;
      if (c.g.rolled !== ch) {
        const sp = d.sprite(ch);
        const alt = d.sprite(8).castNum === 351 ? 3 : 0;
        edBubble(c, bubble, calls[i] + alt, sp.locH - 10, sp.locV - 25);
        c.g.rolled = ch;
      }
      break;
    }
  }
  if (!roll) {
    d.setVisible(bubble, false);
    c.g.rolled = 0;
  }
}

// ------------------------------------------------------------------ Options panel "EE"
const LIST_E = [34, 35, 36, 37, 38, 39];
const LIST_E_PUP = [33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48];
const E_ROL: Record<number, number> = { 35: 40, 33: 41, 37: 42, 36: 42, 38: 43 };

/** The EE/Credits scripts (identical channel layout in every location movie). */
export function sharedScripts(c: ClassicContext): ScriptTable {
  const d = c.d;
  const g = c.g;
  const credits = { from: 1, to: 18, max: 105 };
  const putCredits = () => {
    const lines = d.field('Credits').replace(/\r\n?|\n/g, '\r').split('\r');
    d.setField('ActivCR', lines.slice(credits.from - 1, credits.to).join('\r'));
  };
  return {
    // 71: the options icon
    3221: {
      mouseDown() {
        if (g.mode === 0) d.press();
      },
      mouseUp() {
        if (g.mode !== 0) return;
        d.cursorOff();
        g.enter = 0;
        for (const ch of [20, 22, 23, 32, 33, 35]) d.puppetSprite(ch, false);
        for (const ch of LIST_E_PUP) {
          d.puppetSprite(ch, false);
          d.setVisible(ch, true);
        }
        d.go('EE');
      },
    },
    // 23: EE frame loop
    3213: {
      exitFrame() {
        if (g.enter === 0) {
          g.enter = 1;
          for (const ch of LIST_E_PUP) d.puppetSprite(ch, true);
          d.setCast(36, d.castNumber('OnYes') - g.myMidi);
          d.setCast(37, d.castNumber('OffNo') + g.myMidi);
          d.setLocH(34, g.hofVol > 0 ? g.hofVol : csound.level * 10 + 232);
          for (const ch of LIST_E) d.setCursor(ch, HAND);
        }
        if (g.enter !== -1) {
          for (const ch of [33, 35, 36, 37, 38]) {
            const cap = E_ROL[ch];
            const w = d.castNumber(`W${cap - 39}`);
            const y = d.castNumber(`Y${cap - 39}`);
            if (d.rollOver(ch) || d.rollOver(cap)) {
              if (d.sprite(cap).castNum === w) d.setCast(cap, y);
              continue;
            }
            // quirk: sprite 37 never reverts the shared MUSIC caption
            if (ch !== 37 && d.sprite(cap).castNum === y) d.setCast(cap, w);
          }
        }
        d.go(d.frame);
      },
    },
    // 72: volume knob
    3220: {
      async mouseDown() {
        await d.trackMouse(() => {
          if (d.mouseH >= 232 && d.mouseH <= 232 + 78) d.setLocH(34, d.mouseH);
        });
        const level = Math.trunc((d.sprite(34).locH - 232) / 10);
        g.hofVol = d.sprite(34).locH;
        csound.setLevel(level);
        if (!csound.busy(1)) beep();
      },
    },
    // 41: music ON
    3215: {
      mouseUp() {
        const ch = d.clickOn;
        if (d.sprite(ch).castNum === d.castNumber('OnNo')) {
          d.setCast(ch, 'OnYes');
          d.setCast(ch + 1, 'OffNo');
          g.myMidi = 0;
          edPlayBgMusic(c, g.music);
        }
      },
    },
    // 43: music OFF
    3216: {
      mouseUp() {
        const ch = d.clickOn;
        if (d.sprite(ch).castNum === d.castNumber('OffNo')) {
          d.setCast(ch, 'OffYes');
          d.setCast(ch - 1, 'OnNo');
          g.myMidi = 1;
          edStopBgMusic(c);
        }
      },
    },
    // 45: EXIT -> "Do you want to save your game?"
    3217: {
      mouseUp() {
        if (d.doubleClick) return;
        g.enter = -1;
        d.cursorOff();
        for (let ch = 44; ch <= 48; ch++) d.setLocV(ch, d.sprite(ch).locV - 1000);
        for (const ch of [46, 47, 48]) d.setCursor(ch, HAND);
      },
    },
    // 47: No (47) quits without saving / Cancel (48) closes the dialog
    3218: {
      mouseDown() {
        d.press();
      },
      async mouseUp() {
        const ch = d.clickOn;
        d.cursorOff();
        if (ch === 47) {
          await c.quit(false);
        } else {
          g.enter = 0;
          for (let i = 44; i <= 48; i++) d.setLocV(i, d.sprite(i).locV + 1000);
        }
      },
    },
    // 48: Yes = SAVE() and halt
    3219: {
      mouseDown() {
        d.press();
      },
      async mouseUp() {
        g.enter = 0;
        d.cursor(4);
        await c.quit(true);
      },
    },
    // 27: OK -> back to g_RetFromE
    3214: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        g.enter = 0;
        for (const ch of LIST_E_PUP) d.puppetSprite(ch, false);
        d.puppetSprite(23, false);
        d.cursorOff();
        d.go(g.retFromE);
      },
    },
    // 16: CREDITS
    3272: {
      mouseUp() {
        d.cursorOff();
        credits.from = 1;
        credits.to = 18;
        // CREDITS quirk: g_MaxLines = 105 of 124, so the last lines never show
        credits.max = quirk(c, 'CREDITS') ? 105 : Math.max(1, d.field('Credits').replace(/\r\n?|\n/g, '\r').split('\r').length - 17);
        putCredits();
        d.puppetSprite(33, false);
        for (const ch of LIST_E_PUP) d.puppetSprite(ch, false);
        d.startTimer();
        d.puppetSprite(23, true);
        d.go('Credits');
      },
    },
    // 15: credits loop
    3271: {
      exitFrame() {
        if (d.timer >= 30 && credits.from < credits.max) {
          d.startTimer();
          credits.from++;
          credits.to++;
          putCredits();
        } else if (credits.from >= credits.max && d.sprite(23).locV > 1000) {
          d.setLocV(23, d.sprite(23).locV - 1000);
          d.startTimer();
        } else if (d.sprite(23).locV < 1000 && d.timer >= 40) {
          d.setLocV(23, d.sprite(23).locV + 1000);
          credits.from = 1;
          credits.to = 18;
        }
        if (d.sprite(22).cursor !== HAND) d.setCursor(22, HAND);
        d.go(d.frame);
      },
    },
    // 17: back from the credits
    3273: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        g.enter = 0;
        d.puppetSprite(23, false);
        d.cursorOff();
        d.go('EE');
      },
    },
  };
}

let beepCtx: AudioContext | null = null;
/** Lingo `beep()`: the Windows default beep, approximated. */
export function beep() {
  try {
    beepCtx ??= new AudioContext();
    const o = beepCtx.createOscillator();
    const gn = beepCtx.createGain();
    o.frequency.value = 880;
    gn.gain.value = 0.08 * (csound.level / 7);
    o.connect(gn).connect(beepCtx.destination);
    o.start();
    o.stop(beepCtx.currentTime + 0.12);
  } catch {
    /* no audio */
  }
}
