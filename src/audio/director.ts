// AudioDirector: the one object the game talks to.
//
//   const audio = getAudioDirector();
//   audio.attachUnlock();                         // starts on the first click/key/touch
//   audio.setScene({ place: 'homestead', season: 'spring', weather: 'clear', hour: 8, wind: 0.3, tension: 0 });
//   audio.sting('sting_letter'); audio.sfx('paper');
//   const v = audio.playVoice('TSTREET.700'); v.on(e => ...); await v.done;
//
// Graph: music/ambience/sfx/voice buses -> master -> destination. Music and ambience each have a duck
// node that dips under voice. Settings (volumes, mute, reduced audio, captions) persist in localStorage.
import { AmbienceMixer } from './ambience.ts';
import { BufferCache, loadManifests, type Manifests } from './loader.ts';
import { computeMix, ONCE_EVENTS } from './mix.ts';
import { MusicPlayer, type ChangeOptions } from './music.ts';
import { loadSettings, saveSettings } from './settings.ts';
import type { AudioSettings, Mix, MusicEvent, Scene } from './types.ts';
import { VoicePlayer, type VoiceHandle } from './voice.ts';

/** UI sounds allowed in reduced-audio mode (quiet, informative ones). */
const REDUCED_SFX = new Set(['tick', 'paper_soft', 'chime']);
/** Stings dropped in reduced-audio mode (sudden / dramatic ones). */
const REDUCED_STING_SKIP = new Set(['sting_disaster', 'sting_bad']);

/** Rotation hand-off near a loop's end: the same clean dip as any change (never an overlap). */
const ROTATE: ChangeOptions = {};

const DUCK_MUSIC = 0.32; // about -10 dB under voice
const DUCK_AMB = 0.6; // about -4.4 dB

export class AudioDirector {
  ctx: AudioContext | null = null;
  settings: AudioSettings = loadSettings();
  private manifests: Manifests | null = null;
  private ready: Promise<void> | null = null;
  private master!: GainNode;
  private buses!: { music: GainNode; ambience: GainNode; sfx: GainNode; voice: GainNode };
  private duck!: { music: GainNode; ambience: GainNode };
  private cache!: BufferCache;
  music!: MusicPlayer;
  ambience!: AmbienceMixer;
  voice!: VoicePlayer;
  private scene: Scene | null = null;
  private lastMix: Mix | null = null;
  private pendingOneshotScene = false;
  private rot: { plan: string[]; idx: number; advancing: boolean } = { plan: [], idx: 0, advancing: false };
  private rotTimer: ReturnType<typeof setInterval> | null = null;
  /** A one-shot event (goal/finale) that already played; ignored until the caller changes event. */
  private consumedEvent: MusicEvent = null;
  private consumedAt = 0;
  private listeners = new Set<(s: AudioSettings) => void>();
  private unlockAttached = false;

  /** True once the AudioContext is running (after a user gesture). */
  get started(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get currentScene(): Scene | null {
    return this.scene;
  }

  get currentMix(): Mix | null {
    return this.lastMix;
  }

  /** Install one-time listeners that start audio on the first pointer/key/touch gesture. */
  attachUnlock(target: EventTarget = window) {
    if (this.unlockAttached) return;
    this.unlockAttached = true;
    const evs = ['pointerdown', 'keydown', 'touchend'];
    const handler = () => {
      void this.start();
      if (this.started) evs.forEach((e) => target.removeEventListener(e, handler, true));
    };
    evs.forEach((e) => target.addEventListener(e, handler, true));
    // Try to start right away. Browsers allow this after any earlier click on the page (sticky
    // activation) or when the site may autoplay (site setting / media engagement); otherwise the
    // context stays suspended and the first gesture above resumes it.
    void this.start().catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.unlockedOnce) void this.ctx.resume();
    });
  }

  private unlockedOnce = false;

  /** Create/resume the AudioContext. Must be called from a user gesture the first time. */
  start(): Promise<void> {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => (this.unlockedOnce = this.ctx!.state === 'running'));
    else this.unlockedOnce = true;
    return this.ready!;
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const mk = () => ctx.createGain();
    this.buses = { music: mk(), ambience: mk(), sfx: mk(), voice: mk() };
    this.duck = { music: mk(), ambience: mk() };
    this.duck.music.connect(this.buses.music);
    this.duck.ambience.connect(this.buses.ambience);
    for (const b of Object.values(this.buses)) b.connect(this.master);
    this.applyVolumes(0);
    this.cache = new BufferCache(ctx);
    this.ready = loadManifests().then((m) => {
      this.manifests = m;
      this.music = new MusicPlayer(ctx, this.cache, m.music, this.duck.music);
      this.ambience = new AmbienceMixer(ctx, this.cache, m.ambience, this.duck.ambience);
      this.voice = new VoicePlayer(ctx, this.cache, m.voice, this.buses.voice);
      this.voice.onActivity = (n) => this.setDuck(n > 0);
      this.music.onOneshotEnd = () => this.afterOneshot();
      for (const id of Object.keys(m.sfx.sfx)) void this.cache.load(m.sfx.sfx[id].files, true);
      if (this.scene) this.applyScene(this.scene, true);
    });
  }

  /** Manifests (null until started). Useful for audition/debug UIs. */
  get catalog(): Manifests | null {
    return this.manifests;
  }

  // ------------------------------------------------------------------ settings
  onSettings(cb: (s: AudioSettings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  updateSettings(patch: Partial<AudioSettings>) {
    const wasReduced = this.settings.reducedAudio;
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.applyVolumes(0.15);
    if (wasReduced !== this.settings.reducedAudio && this.scene) this.applyScene(this.scene, false);
    for (const cb of this.listeners) cb(this.settings);
  }

  private applyVolumes(glide: number) {
    if (!this.ctx) return;
    const s = this.settings;
    const now = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(now);
      if (glide > 0) p.setTargetAtTime(v, now, glide / 3);
      else p.setValueAtTime(v, now);
    };
    // perceptual taper: slider^2
    const taper = (x: number) => Math.max(0, Math.min(1, x)) ** 2;
    set(this.master.gain, s.muted ? 0 : taper(s.master));
    set(this.buses.music.gain, taper(s.music) * (s.reducedAudio ? 0.8 : 1));
    set(this.buses.ambience.gain, taper(s.ambience));
    set(this.buses.sfx.gain, taper(s.sfx));
    set(this.buses.voice.gain, taper(s.voice));
  }

  private setDuck(on: boolean) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const m = this.duck.music.gain;
    const a = this.duck.ambience.gain;
    m.cancelScheduledValues(now);
    a.cancelScheduledValues(now);
    m.setTargetAtTime(on ? DUCK_MUSIC : 1, now, on ? 0.05 : 0.5);
    a.setTargetAtTime(on ? DUCK_AMB : 1, now, on ? 0.08 : 0.6);
  }

  // ------------------------------------------------------------------ scene
  /**
   * Describe where the player is; music changes with a clean dip (no overlap) and ambience layers glide.
   * Safe to call often (every tick): nothing happens unless the resulting mix changes.
   */
  setScene(scene: Partial<Scene> & Pick<Scene, 'place'>, opts: ChangeOptions = {}) {
    const full: Scene = {
      season: 'spring',
      weather: 'clear',
      hour: 10,
      wind: 0.3,
      tension: 0,
      event: null,
      ...this.scene,
      ...scene,
    };
    // An event that already played is ignored if re-sent soon after (callers often keep passing it);
    // sent again later (next year's harvest) it plays again.
    if ('event' in scene && (scene.event !== this.consumedEvent || performance.now() - this.consumedAt > 180_000)) this.consumedEvent = null;
    if (full.event && full.event === this.consumedEvent) full.event = null;
    this.scene = full;
    if (this.manifests) this.applyScene(full, false, opts);
  }

  private applyScene(scene: Scene, force: boolean, opts: ChangeOptions = {}) {
    const mix = computeMix(scene, this.settings.reducedAudio);
    const prev = this.lastMix;
    this.lastMix = mix;
    if (force || !prev || prev.playlist.join('|') !== mix.playlist.join('|')) this.setPlan(mix.playlist, opts);
    if (force || !prev || JSON.stringify(prev.beds) !== JSON.stringify(mix.beds) || prev.indoor !== mix.indoor || prev.thunder !== mix.thunder) {
      this.ambience.apply(mix);
    }
  }

  // ------------------------------------------------------------------ rotation
  /**
   * Adopt a music plan. If the cue already playing belongs to the new plan it simply continues
   * (no restart when the hour or season shifts); otherwise the plan's first cue comes in on the bar.
   */
  private setPlan(plan: string[], opts: ChangeOptions = {}) {
    this.rot = { plan, idx: 0, advancing: false };
    if (!plan.length) {
      void this.music.play(null, opts);
      return;
    }
    const playing = this.music.playing;
    const keep = playing ? plan.indexOf(playing) : -1;
    if (keep >= 0) {
      this.rot.idx = keep;
    } else {
      if (this.music.cue(plan[0])?.kind === 'oneshot') this.pendingOneshotScene = true;
      void this.music.play(plan[0], opts);
    }
    this.rotTimer ??= setInterval(() => this.tickRotation(), 300);
  }

  /** Near the end of each pass, move to the next cue of the plan (or end a one-pass event). */
  private tickRotation() {
    const { plan } = this.rot;
    const pos = this.music.position();
    if (!plan.length || !pos || pos.cue !== plan[this.rot.idx % plan.length]) return;
    const cue = this.music.cue(pos.cue);
    if (!cue || cue.kind !== 'loop') return;
    const len = (cue.loopEnd ?? 0) - (cue.loopStart ?? 0);
    if (pos.seconds < len - 1.8) {
      this.rot.advancing = false;
      return;
    }
    if (this.rot.advancing) return;
    this.rot.advancing = true;
    const ev = this.scene?.event;
    if (this.scene && ev && ONCE_EVENTS.has(ev)) {
      // harvest / new year: one pass, then back to the place's music
      this.consumedEvent = ev;
      this.consumedAt = performance.now();
      this.scene = { ...this.scene, event: null };
      this.applyScene(this.scene, false, ROTATE);
      return;
    }
    if (plan.length < 2) return;
    this.rot.idx = (this.rot.idx + 1) % plan.length;
    void this.music.play(plan[this.rot.idx], ROTATE);
  }

  private afterOneshot() {
    // A one-shot (goal, finale) ended: clear the event and fall back to the place's music.
    if (!this.scene || !this.pendingOneshotScene) return;
    this.pendingOneshotScene = false;
    if (this.scene.event === 'goal' || this.scene.event === 'finale') {
      this.consumedEvent = this.scene.event;
      this.consumedAt = performance.now();
      this.scene = { ...this.scene, event: null };
      const mix = computeMix(this.scene, this.settings.reducedAudio);
      this.lastMix = mix;
      const plan = mix.playlist.length ? mix.playlist : [this.music.takeReturnCue() ?? 'parlor'];
      this.setPlan(plan.map((c) => (c === 'finale' ? 'parlor' : c)), { fadeIn: 3 });
    }
  }

  /**
   * Hand the music back to the current scene's rotation after an explicit `playMusic` override
   * (e.g. the Dev Cut gramophone). The place's plan comes back with a clean dip. If the cue
   * already playing belongs to the plan, it simply carries on. No-op before audio has started.
   */
  resumeRotation(opts: ChangeOptions = {}) {
    if (!this.manifests || !this.scene) return;
    const mix = computeMix(this.scene, this.settings.reducedAudio);
    this.lastMix = mix;
    this.setPlan(mix.playlist, opts);
  }

  /** Play a specific cue regardless of scene, until `resumeRotation()` or a setScene that changes the plan. */
  playMusic(id: string | null, opts: ChangeOptions = {}) {
    if (!this.manifests) return;
    this.rot = { plan: id ? [id] : [], idx: 0, advancing: false };
    void this.music.play(id, opts);
  }

  preloadMusic(ids: string[]) {
    if (this.manifests) ids.forEach((id) => this.music.preload(id));
  }

  // ------------------------------------------------------------------ one-shots
  /** Musical sting over the scene music (letters, decisions, news). */
  sting(id: string) {
    if (!this.manifests || this.settings.muted) return;
    if (this.settings.reducedAudio && REDUCED_STING_SKIP.has(id)) return;
    void this.music.sting(id, this.settings.reducedAudio ? 0.6 : 1);
  }

  /** Soft UI sound. In reduced-audio mode only the quiet informative ones play. */
  sfx(id: string, opts: { volume?: number; pan?: number } = {}) {
    if (!this.ctx || !this.manifests || this.settings.muted) return;
    if (this.settings.reducedAudio && !REDUCED_SFX.has(id)) return;
    const meta = this.manifests.sfx.sfx[id];
    if (!meta) {
      console.warn('[audio] unknown sfx', id);
      return;
    }
    const buf = this.cache.peek(meta.files);
    const play = (b: AudioBuffer) => {
      const ctx = this.ctx!;
      const src = ctx.createBufferSource();
      src.buffer = b;
      const g = ctx.createGain();
      g.gain.value = (opts.volume ?? 1) * Math.pow(10, (meta.gainDb ?? 0) / 20);
      let node: AudioNode = src.connect(g);
      if (opts.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = opts.pan;
        node = node.connect(p);
      }
      node.connect(this.buses.sfx);
      src.start();
      src.onended = () => g.disconnect();
    };
    if (buf) play(buf);
    else void this.cache.load(meta.files, true).then((b) => b && play(b));
  }

  /** Original voice line with caption events; music and ambience duck underneath. */
  playVoice(id: string, opts: { interrupt?: boolean } = {}): VoiceHandle {
    if (!this.voice) {
      // not started yet: return a handle that resolves immediately with no events
      const line = this.manifests?.voice.lines[id];
      return { id, line, captions: line?.captions ?? [], on: () => () => {}, done: Promise.resolve(), stop: () => {} };
    }
    return this.voice.play(id, { ...opts, muted: this.settings.muted || this.settings.voice <= 0 });
  }

  thunder() {
    if (this.ambience && !this.settings.reducedAudio) void this.ambience.thunder();
  }

  /** Fade everything out (e.g. leaving the game). */
  stopAll(fade = 1.5) {
    this.music?.stopAll(fade);
    this.ambience?.stopAll(fade);
    this.voice?.stopAll();
  }
}

let singleton: AudioDirector | null = null;

export function getAudioDirector(): AudioDirector {
  return (singleton ??= new AudioDirector());
}
