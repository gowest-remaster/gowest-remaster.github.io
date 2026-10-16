// Director-style sound for the Classic edition: numbered sound channels playing the original
// WAV cast members and external files (puppetSound, `sound playFile`, soundBusy), the MIDI
// background music (pre-rendered with the project SoundFont, loops like edStateBgMusic) and the
// `soundLevel` 0..7 of the Options panel. Uses Web Audio so `soundBusy` is exact.
import { settings } from '../../../engine/settings.ts';
import { CLASSIC_BASE, extUrl, type Member } from './cast.ts';

type Chan = { src: AudioBufferSourceNode; gain: GainNode; url: string; started: number; dur: number; loop: boolean } | null;

class ClassicSound {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private chans: Chan[] = Array(9).fill(null);
  private master: GainNode | null = null;
  /** Director soundLevel 0..7 */
  level = 7;
  private music: HTMLAudioElement | null = null;
  private musicUrl: string | null = null;
  musicOn = true;

  constructor() {
    const unlock = () => void this.ac()?.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ac(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyVolume();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  private vol() {
    return (this.level / 7) * settings().master;
  }

  applyVolume() {
    if (this.master) this.master.gain.value = this.vol();
    if (this.music) this.music.volume = Math.min(1, this.vol() * settings().music * 1.2);
  }

  setLevel(l: number) {
    this.level = Math.max(0, Math.min(7, Math.round(l)));
    this.applyVolume();
  }

  private buffer(url: string) {
    let p = this.buffers.get(url);
    if (!p) {
      const ctx = this.ac();
      p = ctx
        ? fetch(url)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))))
            .then((b) => ctx.decodeAudioData(b))
            .catch(() => null)
        : Promise.resolve(null);
      this.buffers.set(url, p);
    }
    return p;
  }

  memberUrl(m: Member) {
    // FLAC: bit-exact with the original WAV, about half the size (2026-10-17 size pass)
    return `${CLASSIC_BASE}${m.lib}/s/${m.id}.flac`;
  }

  /** Preload (decode) a sound so it starts without delay. */
  preload(url: string) {
    void this.buffer(url);
  }

  /** Play a URL on a channel (1..8). Resolves when it starts. */
  async play(ch: number, url: string, loop = false) {
    this.stop(ch);
    const ctx = this.ac();
    if (!ctx) return;
    const token = {};
    this.pending[ch] = token;
    const buf = await this.buffer(url);
    if (this.pending[ch] !== token) return;
    delete this.pending[ch];
    if (!buf) return; // missing/undecodable file: the channel is free again
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const gain = ctx.createGain();
    src.connect(gain).connect(this.master!);
    src.start();
    const c = { src, gain, url, started: ctx.currentTime, dur: buf.duration, loop };
    this.chans[ch] = c;
    src.onended = () => {
      if (this.chans[ch] === c) this.chans[ch] = null;
    };
  }
  private pending: Record<number, object> = {};

  playMember(ch: number, m: Member, loop?: boolean) {
    return this.play(ch, this.memberUrl(m), loop ?? !!m.loop);
  }

  /** `sound playFile ch, path` with an original Windows path. */
  async playFile(ch: number, path: string) {
    // the channel counts as busy from the call on (soundBusy right after `sound playFile`)
    this.stop(ch);
    const token = {};
    this.pending[ch] = token;
    const url = await extUrl(path);
    if (this.pending[ch] !== token) return;
    if (url) await this.play(ch, url, false);
    else delete this.pending[ch];
  }

  stop(ch: number) {
    delete this.pending[ch];
    const c = this.chans[ch];
    if (c) {
      try {
        c.src.stop();
      } catch {
        /* already stopped */
      }
      this.chans[ch] = null;
    }
  }

  stopAll() {
    for (let i = 1; i < this.chans.length; i++) this.stop(i);
  }

  busy(ch: number) {
    // a suspended context (no user gesture yet) never finishes a sound: don't block on it
    if (this.ctx && this.ctx.state !== 'running') return false;
    return !!this.chans[ch] || !!this.pending[ch];
  }

  /** Seconds since the channel started (for narration cues), or -1. */
  time(ch: number) {
    const c = this.chans[ch];
    if (!c || !this.ctx) return -1;
    return this.ctx.currentTime - c.started;
  }

  duration(ch: number) {
    return this.chans[ch]?.dur ?? 0;
  }

  /** Background music by MIDI file stem ("GP1", "GANCOUA"); null stops it. */
  playMusic(stem: string | null) {
    if (!stem || !this.musicOn) {
      this.stopMusic();
      if (stem) this.musicUrl = null;
      return;
    }
    const base = `${CLASSIC_BASE}ext/music/${stem.toUpperCase()}`;
    const a = document.createElement('audio');
    const canOgg = a.canPlayType('audio/ogg; codecs=opus') !== '';
    const url = `${base}.${canOgg ? 'ogg' : 'm4a'}`;
    if (this.musicUrl === url && this.music && !this.music.paused) return;
    this.stopMusic();
    a.src = url;
    a.loop = true;
    this.music = a;
    this.musicUrl = url;
    this.applyVolume();
    a.play().catch(() => {
      const retry = () => {
        if (this.music === a) a.play().catch(() => undefined);
        window.removeEventListener('pointerdown', retry);
      };
      window.addEventListener('pointerdown', retry);
    });
  }

  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.src = '';
    }
    this.music = null;
    this.musicUrl = null;
  }
}

export const csound = new ClassicSound();
