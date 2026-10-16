// Audio port for the Remastered UI over the audio engine (src/audio, AudioDirector). Keeps the
// game's "silence by design" rules: UI calls use semantic names that map to the few allowed
// sounds; anything else (plot clicks, plowing, hover) is deliberately silent. Voice lines emit
// captions through `onCaption` for the caption strip.
import { getAudioDirector } from '../../audio/index.ts';
import type { Place as AudioPlace, Weather } from '../../audio/types.ts';
import type { GameState } from '../../sim/index.ts';
import { Emitter } from './bus.ts';
import { seasonName } from './format.ts';
import { rm } from './settings.ts';
import { worldViewOf } from './worldview.ts';

export interface Caption {
  speaker: string | null;
  text: string;
  /** seconds the caption should stay up */
  seconds: number;
  kind: 'voice' | 'sound';
}

const bus = new Emitter<{ caption: [Caption]; captionEnd: [] }>();
export const onCaption = (fn: (c: Caption) => void) => bus.on('caption', fn);
export const onCaptionEnd = (fn: () => void) => bus.on('captionEnd', fn);

const director = getAudioDirector();

/** UI sound names → engine sfx ids (null = silent by design). */
const SFX: Record<string, string | null> = {
  paper: 'paper', envelope: 'paper', letter: 'paper', 'paper-soft': 'paper_soft', 'calendar-page': 'paper_soft', mailbox: 'paper_soft', page: 'paper_soft',
  coin: 'coin', coins: 'coin', 'coin-small': 'coin_small', tick: null, confirm: 'tick', chime: 'chime', 'store-bell': 'store_bell', bell: 'store_bell', stamp: 'stamp', sign: 'stamp',
};
const STING: Record<string, string> = {
  letter: 'sting_letter', decision: 'sting_decision', good: 'sting_good', bad: 'sting_bad', disaster: 'sting_disaster', year_end: 'sting_year_end', goal: 'sting_goal',
  birth: 'sting_good', harvest: 'sting_good', 'trivia-bell': 'sting_letter',
};

export async function loadAudio() {
  director.attachUnlock();
}

export function applyVolumes() {
  const s = rm();
  try {
    director.updateSettings({ master: s.master, music: s.music, ambience: s.ambience, sfx: s.sfx, voice: s.voice, captions: s.captions });
  } catch (e) {
    console.warn(e);
  }
}

const PLACE: Record<string, AudioPlace> = { title: 'title', homestead: 'homestead', field: 'field', pen: 'homestead', house: 'house', street: 'town', store: 'store', bank: 'bank', elevator: 'elevator', album: 'album', epilogue: 'credits', newgame: 'title', load: 'menu', studio: 'menu' };

/** Tell the mixer where we are (place, season, weather, tension). Cheap and idempotent. */
export function syncScene(placeId: string | null, s: GameState | null, event?: 'harvest' | 'new_year' | 'disaster' | 'finale' | 'goal' | null) {
  const place = PLACE[placeId ?? ''] ?? 'homestead';
  if (!s) return void director.setScene({ place, ...(event !== undefined ? { event } : {}) });
  const mon = s.date.mon;
  const season = seasonName(mon);
  const weather: Weather = season === 'winter' ? (mon === 1 || mon === 2 ? 'snow' : 'cloudy') : s.globals.mainView === 7 ? 'drought' : mon === 4 ? 'cloudy' : 'clear';
  const p = s.propet;
  const net = p.lifePrice - p.business.reduce((a, b) => a + b, 0);
  const months = net > 0 ? (p.cash + p.savings) / net : 99;
  const tension = s.extra.ended === 'bankrupt' || s.extra.ended === 'foreclosed' ? 0.8 : months < 2 ? 0.5 : 0;
  // the hour the world is showing, so the night and lamplight rotations play when it's dark
  let hour = 10;
  try {
    hour = worldViewOf(s).hour ?? 10;
  } catch {
    /* keep midday */
  }
  director.setScene({ place, season, weather, hour, wind: season === 'winter' ? 0.6 : 0.3, tension, ...(event !== undefined ? { event } : {}) });
}

/**
 * Hand the music back to the director's rotation for this place after an explicit override (the
 * Dev Cut gramophone). Syncs the scene first, then resumes the place's plan (clean dip).
 */
export function resumeSceneMusic(placeId: string | null, s: GameState | null) {
  syncScene(placeId, s);
  try {
    director.resumeRotation();
  } catch {
    /* audio not ready */
  }
}

let current: { stop(): void } | null = null;

export const audio = {
  setScene: (place: string, s: GameState | null = null) => syncScene(place, s),
  sting(id: string) {
    const k = STING[id] ?? (id.startsWith('disaster') ? 'sting_disaster' : id.startsWith('sting_') ? id : null);
    if (k) director.sting(k);
  },
  sfx(id: string) {
    const k = id in SFX ? SFX[id] : null;
    if (k) director.sfx(k);
  },
  /** Play an original voice line by voice.json id; resolves when it ends. Captions follow the recording. */
  async playVoice(id: string, opts: { speaker?: string | null; text?: string | null } = {}) {
    current?.stop();
    const v = director.playVoice(id, { interrupt: true });
    current = v;
    let gotCaption = false;
    const off = v.on((e) => {
      if (e.type === 'caption' && rm().captions) {
        gotCaption = true;
        bus.emit('caption', { speaker: opts.speaker ?? e.speaker ?? null, text: e.caption.text, seconds: Math.max(1.5, e.caption.end - e.caption.start), kind: 'voice' });
      } else if (e.type === 'end') bus.emit('captionEnd');
    });
    // lines without timed cues: show the whole transcript
    if (!v.line && opts.text && rm().captions) {
      const seconds = Math.max(2.5, opts.text.split(/\s+/).length / 2.6);
      bus.emit('caption', { speaker: opts.speaker ?? null, text: opts.text, seconds, kind: 'voice' });
      await new Promise((r) => setTimeout(r, seconds * 1000));
      bus.emit('captionEnd');
    } else await v.done;
    off();
    if (!gotCaption && opts.text && v.line) void 0;
    if (current === v) current = null;
  },
  stopVoice() {
    current?.stop();
    current = null;
    bus.emit('captionEnd');
  },
  unlock() {
    void director.start?.();
  },
  /**
   * Play a one-off original recording by URL (Dev Cut extras that the audio engine does not
   * carry, e.g. BABY.WAV), on the effects bus volume. Resolves when it ends (or fails).
   */
  playFile(url: string, opts: { bus?: 'sfx' | 'voice'; volume?: number } = {}): Promise<void> {
    const s = rm();
    const v = Math.max(0, Math.min(1, s.master * (opts.bus === 'voice' ? s.voice : s.sfx) * (opts.volume ?? 1)));
    if (v <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const a = new Audio(url);
      a.volume = v;
      const done = () => resolve();
      a.addEventListener('ended', done, { once: true });
      a.addEventListener('error', done, { once: true });
      a.play().catch(done);
    });
  },
};

/** Sound-effect caption ("[coins]") for the hard of hearing. */
export function soundCaption(text: string) {
  if (rm().soundCaptions) bus.emit('caption', { speaker: null, text, seconds: 1.6, kind: 'sound' });
}
