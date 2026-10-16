// Shared types for the Remastered audio engine (src/audio). Manifests are written by tools/audio/*.py.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'drought';

/** Where the player is. Interior places muffle the outdoor beds. */
export type Place =
  | 'title'
  | 'menu'
  | 'homestead'
  | 'field'
  | 'house'
  | 'town'
  | 'store'
  | 'bank'
  | 'elevator'
  | 'album'
  | 'credits'
  | 'silent';

/** Moments that override the place's music while they are set. */
export type MusicEvent = 'harvest' | 'new_year' | 'disaster' | 'finale' | 'goal' | null;

export interface Scene {
  place: Place;
  season: Season;
  weather: Weather;
  /** 0-23 (fractions allowed). */
  hour: number;
  /** 0 calm .. 1 gale. */
  wind: number;
  /** 0 relaxed .. 1 crisis. Above ~0.65 outdoor places switch to the disaster cue. */
  tension: number;
  event?: MusicEvent;
}

export interface FileSet {
  ogg: string;
  m4a: string;
}

export interface MusicCue {
  id: string;
  title: string;
  key: string;
  kind: 'loop' | 'oneshot' | 'sting';
  contexts: string[];
  desc: string;
  files: FileSet;
  duration: number;
  loopStart?: number;
  loopEnd?: number;
  bpm: number;
  beatsPerBar: number;
  barSec: number;
  lufs: number;
  truePeakDb: number;
}

export interface MusicManifest {
  version: number;
  contexts: Record<string, string>;
  cues: Record<string, MusicCue>;
}

export interface AmbienceBed {
  files: FileSet;
  duration: number;
  loopStart: number;
  loopEnd: number;
  lufs: number;
  gainDb: number;
  tags: string[];
  desc: string;
}

export interface AmbienceManifest {
  version: number;
  beds: Record<string, AmbienceBed>;
  oneshots: Record<string, { files: FileSet; duration: number; lufs: number; gainDb: number; desc?: string }>;
}

export interface SfxManifest {
  version: number;
  sfx: Record<string, { files: FileSet; duration: number; peakDb: number; gainDb: number; desc?: string }>;
}

export interface Caption {
  start: number;
  end: number;
  text: string;
}

export interface VoiceLine {
  files: FileSet;
  duration: number;
  speaker: string;
  text: string;
  captions: Caption[];
  lufs: number;
  gainDb: number;
  timing: 'whisper' | 'estimated' | 'none';
  /** Sound effect filed under voice (e.g. the store door); has no captions. */
  nonSpeech?: boolean;
}

export interface VoiceManifest {
  version: number;
  lines: Record<string, VoiceLine>;
}

export interface AudioSettings {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
  voice: number;
  muted: boolean;
  /** Accessibility: no sudden or busy sounds (thunder, stings, most UI sounds), calmer beds, gentler music. */
  reducedAudio: boolean;
  captions: boolean;
}

/** Target mix the scene asks for: one music cue and a level (0..1) per ambience bed. */
export interface Mix {
  /** First cue of the plan. */
  music: string | null;
  /** Rotation: each cue plays one pass, then the next (a single entry just loops). */
  playlist: string[];
  beds: Record<string, number>;
  /** 0 = open air, 1 = fully indoors (outdoor beds muffled through a low-pass). */
  indoor: number;
  thunder: boolean;
}
