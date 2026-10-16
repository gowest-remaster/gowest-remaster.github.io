// One-shot sounds for the Classic app's shared HTML dialogs (engine/game.ts), built on Howler.
// Files come from public/assets/audio/sfx (encoded by scripts/prepare_assets.py as .opus + .m4a).
// The Classic replica plays its own original sounds (scenes/classic/dir/sound.ts); the Remastered
// app has its own engine (src/audio).
import { Howl, Howler } from 'howler';
import { onSettings, settings } from './settings.ts';

type SfxId = 'money' | 'harmon';

const BASE = `${import.meta.env.BASE_URL}assets/audio/`;
const src = (path: string) => [`${BASE}${path}.opus`, `${BASE}${path}.m4a`];

class AudioManager {
  private sfx = new Map<string, Howl>();
  private lastSfx = new Map<SfxId, number>();

  constructor() {
    onSettings(() => Howler.volume(settings().master));
    Howler.volume(settings().master);
  }

  /**
   * One-shot effect. Kept cosy on purpose: the same effect never repeats within `minGap`
   * seconds (no click trains while the calendar or a field job runs).
   */
  sfxPlay(id: SfxId, volume = 1, minGap = 1.5) {
    const now = performance.now();
    if (now - (this.lastSfx.get(id) ?? -Infinity) < minGap * 1000) return;
    this.lastSfx.set(id, now);
    let h = this.sfx.get(id);
    if (!h) {
      h = new Howl({ src: src(`sfx/${id}`), volume: 1 });
      this.sfx.set(id, h);
    }
    const n = h.play();
    h.volume(volume * settings().sfx, n);
  }
}

export const audio = new AudioManager();
