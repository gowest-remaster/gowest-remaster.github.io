// Contracts between the Classic scene (one Director stage) and the per-movie ports.
//
// Each original movie (CALEND, FIELD, TSTREET1, STORE, BANK09, TTALK, HOUSE1..3, BHOUSE1,
// ALBUM, NEWS, LOGIN, OPEN, INTRO) is a MovieModule: its Lingo frame/sprite scripts ported to
// TypeScript handlers keyed by the script's castId, plus movie-script handlers. Presentation
// logic is ported faithfully; game rules are NOT re-implemented here: they come from the pure
// sim through `game.run(...)` and the scene controllers (src/scenes/controllers/*).
import type { GameState, Command, SimEvent } from '../../sim/index.ts';
import type { Presenter, ViewHooks } from '../../engine/game.ts';
import type { SceneId } from '../../engine/scene.ts';
import type { DirPlayer, Handlers, ScriptTable } from './dir/player.ts';

export type MovieName =
  | 'LOGIN'
  | 'OPEN'
  | 'INTRO'
  | 'CALEND'
  | 'FIELD'
  | 'TSTREET1'
  | 'STORE'
  | 'BANK09'
  | 'TTALK'
  | 'HOUSE1'
  | 'HOUSE2'
  | 'HOUSE3'
  | 'BHOUSE1'
  | 'ALBUM'
  | 'NEWS';

/** Which engine scene a movie belongs to (for saves / resume). */
export const SCENE_OF: Record<MovieName, SceneId> = {
  LOGIN: 'title',
  OPEN: 'title',
  INTRO: 'title',
  CALEND: 'board',
  FIELD: 'field',
  TSTREET1: 'town',
  STORE: 'town',
  BANK09: 'town',
  TTALK: 'board',
  HOUSE1: 'house',
  HOUSE2: 'house',
  HOUSE3: 'house',
  BHOUSE1: 'house',
  ALBUM: 'house',
  NEWS: 'house',
};

/**
 * Director globals that outlive a movie (the original keeps them across `go to movie`).
 * Game state proper lives in the sim (`game.state`); these are presentation globals only.
 */
export interface ClassicGlobals {
  /** g_Marker: destination chosen from a location bar / where to return after a message */
  marker: string | number;
  /** g_RetFromE: label the Options panel OK returns to */
  retFromE: string;
  /** g_Mode: 1 while a modal action runs (menu clicks ignored) */
  mode: number;
  /** g_Enter: per-screen init flag (0 = init on next exitFrame, 1 = done, -1 = exit dialog up) */
  enter: number;
  /** g_MMapSound: ambience last played on the map */
  mmapSound: string;
  /** g_MyMidi: 1 = player turned the music off */
  myMidi: number;
  /** g_HofVol: Options volume knob x (232..310), 0 = derive from the level */
  hofVol: number;
  /** g_IntroReturn: CALEND label INTRO returns to */
  introReturn: string;
  /** INTRO mode */
  runningMode: 'newGame' | 'oldGame';
  /** g_Filename: background MIDI of the current location ("GP1", "GANCOUA") or null */
  music: string | null;
  /** g_rolled: sprite currently showing a callout bubble */
  rolled: number;
  /** free-form per-movie globals (ported names, e.g. g.x.g_WhatN) */
  x: Record<string, unknown>;
}

export function freshGlobals(): ClassicGlobals {
  return { marker: 0, retFromE: 'Begin', mode: 0, enter: 0, mmapSound: '', myMidi: 0, hofVol: 0, introReturn: 'Start', runningMode: 'newGame', music: null, rolled: 0, x: {} };
}

export interface ClassicContext {
  /** the stage: Lingo-like API (sprites, fields, go, cursors, sounds) */
  d: DirPlayer;
  /** Director globals shared by all movies */
  g: ClassicGlobals;
  /** the live sim state (null before a game exists: LOGIN/OPEN/INTRO) */
  readonly state: GameState | null;
  /** `go(label, "MOVIE")`: load another movie on the same stage (saves the location). */
  goMovie(name: MovieName, frame?: number | string): Promise<void>;
  /** current movie name */
  readonly movie: MovieName | null;
  /** run a sim command through the session (animation hooks, dialogs, autosave) */
  run(cmd: Command): Promise<{ state: GameState; events: SimEvent[] } | null>;
  /** `halt()` / quit to the title (after an optional save). */
  quit(save: boolean): Promise<void>;
  /** Start a new game (INTRO claim form done) and go to CALEND "Start". */
  startGame(first: string, last: string, goal: number): Promise<void>;
  /** Show a Windows-style message box on the stage (Lingo `alert`); resolves with the button index. */
  alert(text: string, buttons?: string[]): Promise<number>;
}

export interface MovieModule {
  /** frame and sprite script handlers by script castId (movie cast or SHARED) */
  scripts: ScriptTable;
  /** movie-script handlers used when no sprite/frame handler takes an event (mouseUp, keyDown...) */
  movie?: Handlers;
  /** `on startMovie` (after the cast is loaded, before the first frame's scripts run) */
  startMovie?(): void | Promise<void>;
  /** `on stopMovie` */
  stopMovie?(): void;
  /** the label/frame to start at when the caller gives none */
  startFrame?: number | string;
  /** how sim dialogs/prompts are shown while this movie is on stage (falls back to a stage alert box) */
  presenter?: Presenter;
  /** sim event animation hooks while this movie is on stage */
  view?: ViewHooks;
  /** draw extra things after the sprites (e.g. the signature ink) */
  afterDraw?(ctx: CanvasRenderingContext2D): void;
  /** per-animation-frame update (seconds) */
  update?(dt: number): void;
}

export type MovieFactory = (c: ClassicContext) => MovieModule;
