// Contract between the Remastered UI shell (src/remastered/**) and the real-time 3D world
// (src/world/**). The UI never touches three.js directly; the world never reads the sim.
// `worldViewFromGame()` (src/world/fromGame.ts) maps a GameState to a WorldView.
//
// Additive changes by the world agent (all optional; existing callers are unaffected):
//  - WorldView.drought?: 0..1 parched prairie (sim season scene 7). Defaults to 0.
//  - World3D.setAutoQuality?(on): the auto-quality governor is ON by default and never exceeds the level
//    passed to setQuality(); setAutoQuality(false) pins the quality.
//  - World3D.debugInfo?(): { backend: 'WebGPU' | 'WebGL2', place, quality, fps } for diagnostics.
//  - World3D.setSafeArea?({left,right,top,bottom}): fractions of the viewport covered by HTML UI; every shot
//    re-centres in the visible area (camera view offset) and widens slightly. Call on layout changes.
//  - Field size: the sim has 8 squares per homestead claim (Propet 5.1 numFields 1|2), so `field` has 8
//    squares, 16 after the 1909 second claim. The world lays out 2x4 squares per claim (original FIELD
//    screen) and accepts any length up to 16. Square i: claim = i>>3, row = (i&7)>>1, col = i&1.
//  - 'flood' (DisasterKind) is implemented as a rising sheet of brown water over the low ground.
//  - PickTarget props on Main Street: { kind: 'prop', id: 'business:0'..'business:3' } (owned-business
//    signs: Jan's Laundry, Reilly's Shirt Shop, Baylick & Sons Hardware, The Longview Hotel) and
//    'freightOffice' (Developer's Cut). Interior props: 'ledger', 'album', 'savings', 'newspaper',
//    'gramophone' (house); 'counter' (store); 'teller', 'loans' (bank).
//  - extras understood: 'gramophone', 'freightOffice', 'woodenFence' (wooden rail field fence).
//  - World3D.loading? / onLoadProgress?(fn): goTo() never shows a black frame while a place streams in or its
//    shaders compile: it keeps rendering the current place, reports progress, then cuts. Places are also
//    prefetched at idle once the homestead is up. Use it for a small "Riding into town..." indicator.
//  - WorldView.mail?: letter waiting -> the mailbox flag is up (live even when the mailbox is baked into a plate).
//  - World3D.setActivity?(a): frame-rate governor ('play' 60 cap, 'ui'/'idle' 24, 'covered' 0).
//  - setQuality(q) with the governor on is a cap: the world starts at 'med' and climbs while fps > 70.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'storm' | 'snow';
export type Quality = 'low' | 'med' | 'high' | 'ultra';

/** Camera destinations. Interiors are separate sets the camera cuts to. */
export type Place =
  | 'title' // slow cinematic drift over the homestead
  | 'homestead' // hub: the diorama view of house, barn, windmill, field edge, mailbox, road to town
  | 'field' // overview of the 16 (or 32 after 1909) squares
  | 'pen' // livestock pen / barn
  | 'house' // house interior (sod, furnished sod or frame house)
  | 'mainStreet' // town street
  | 'store' // general store interior
  | 'bank' // bank interior
  | 'elevator'; // grain elevator by the railroad

export type SquareStage = 'prairie' | 'plowed' | 'planted' | 'sprout' | 'growing' | 'ripe' | 'stubble' | 'burnt';
export type CropKind = 'wheat' | 'winterWheat' | 'oats' | 'corn' | 'barley' | null;

export interface FieldSquareView {
  stage: SquareStage;
  crop: CropKind;
  /** 0..1 within the stage, for smooth growth. */
  growth: number;
}

export interface WorldView {
  year: number;
  month: number; // 1..12
  /** Hour of day, 0..24 (the UI animates it; the calendar sets mornings). */
  hour: number;
  season: Season;
  weather: WeatherKind;
  wind: number; // 0..1
  snowCover: number; // 0..1
  /** 16 squares; 32 after the 1909 second claim. */
  field: FieldSquareView[];
  house: 'none' | 'wagon' | 'sod' | 'sodFurnished' | 'frame';
  barn: boolean;
  windmill: boolean;
  /** 0 none, 1 wood, 2 barbed wire */
  fence: 0 | 1 | 2;
  stove: boolean;
  animals: { cows: number; horses: number; pigs: number; chickens: number };
  /** Number of family members visible around the homestead (adults + children). */
  family: number;
  /** Town grows over the decades: 0 (1880 frontier town) .. 1 (1918 established town). */
  townGrowth: number;
  /** Businesses the player owns on Main Street (indices 0..3), shown with a sign. */
  ownedBusinesses: boolean[];
  /** Developer's Cut extras that have a physical presence (gramophone, freight office...). */
  extras: string[];
  /** 0..1 drought (parched, bleached prairie). Optional, default 0. */
  drought?: number;
  /** A letter is waiting: the mailbox flag is raised. Optional, default false. */
  mail?: boolean;
}

/** Things the player can click in the 3D view. */
export type PickTarget =
  | { kind: 'place'; place: Place }
  | { kind: 'square'; index: number }
  | { kind: 'mailbox' }
  | { kind: 'build'; item: 'house' | 'barn' | 'windmill' | 'woodFence' | 'barbedFence' }
  | { kind: 'prop'; id: string }; // interior props: 'ledger', 'album', 'savings', 'newspaper', 'gramophone', 'counter', 'teller', ...

export type DisasterKind = 'fire' | 'tornado' | 'grasshoppers' | 'drought' | 'hail' | 'blizzard' | 'flood';

export interface World3D {
  /** Attach the canvas into `host` (fills it) and start rendering. */
  mount(host: HTMLElement): Promise<void>;
  /** Apply a new world state. Changes animate (growth, snow, season) unless instant. */
  setView(view: WorldView, opts?: { instant?: boolean }): void;
  /** Fly or cut the camera. Resolves when the move ends. */
  goTo(place: Place, opts?: { instant?: boolean }): Promise<void>;
  /** Hover/click picking. The world highlights hoverable targets itself. */
  onPick(fn: (t: PickTarget) => void): void;
  onHover(fn: (t: PickTarget | null) => void): void;
  /** Which targets are interactive right now (others don't highlight). */
  setInteractive(targets: PickTarget[] | 'all' | 'none'): void;
  /** Selected field squares get an outline. */
  setSelectedSquares(indices: number[]): void;
  /** Screen position (CSS px, relative to host) of a target for anchoring HTML labels; null when off-screen. */
  project(t: PickTarget): { x: number; y: number } | null;
  /** Show blueprint ghosts for buildable items. */
  setGhosts(items: PickTarget[]): void;
  /** Cinematic for a disaster; resolves when done (skippable via skip()). */
  playDisaster(kind: DisasterKind): Promise<void>;
  /** Time-lapse of field work: squares flip one by one over `seconds`. */
  playFieldWork(kind: 'plow' | 'plant' | 'harvest', squares: number[], seconds: number): Promise<void>;
  /** Animate a month passing (sun sweep, weather change) over `seconds`. */
  playMonthPass(next: WorldView, seconds: number): Promise<void>;
  skip(): void;
  setQuality(q: Quality): void;
  readonly quality: Quality;
  /** Average fps over the last second (for the auto-quality governor). */
  readonly fps: number;
  /** Pause rendering (e.g. full-screen overlay); resumes on false. */
  setPaused(paused: boolean): void;
  dispose(): void;
  /** Optional: enable/disable the auto-quality governor (default on, capped at setQuality's level). */
  setAutoQuality?(on: boolean): void;
  /** Optional: fractions (0..1) of the viewport covered by UI panels, so shots centre in the visible area. */
  setSafeArea?(area: { left?: number; right?: number; top?: number; bottom?: number }): void;
  /** Optional diagnostics. */
  debugInfo?(): { backend: string; place: Place; quality: Quality; fps: number };
  /** Optional: the place currently being prepared by goTo() (assets + shader compile), or null. */
  readonly loading?: { place: Place; progress: number } | null;
  /** Optional: progress callbacks for goTo() preparation; progress 0..1, done when the cut happens. Returns unsubscribe. */
  onLoadProgress?(fn: (e: { place: Place; progress: number; done: boolean }) => void): () => void;
  /** Optional: frame governor. 'play' (default) caps at 60 fps; 'ui' (full panel open) and 'idle' render at
   *  24 fps; 'covered' (a full-screen sheet hides the canvas) renders nothing. Animations in flight
   *  (transitions, month pass, field work, disasters) always run at 60. */
  setActivity?(a: 'idle' | 'ui' | 'play' | 'covered'): void;
}
