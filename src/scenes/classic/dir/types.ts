// Data shapes of the Classic edition's Director data (public/assets/classic/<MOVIE>/{cast,score}.json,
// written by scripts/prepare_classic.py from tools/extract + tools/score). See docs/classic-skin.md.

export type InkName =
  | 'copy'
  | 'transparent'
  | 'reverse'
  | 'ghost'
  | 'notCopy'
  | 'notTransparent'
  | 'notReverse'
  | 'notGhost'
  | 'matte'
  | 'mask'
  | 'blend'
  | 'darkest'
  | 'lightest'
  | 'backgroundTransparent'
  | string;

export interface TextStyle {
  start: number;
  height: number | null;
  ascent: number | null;
  style: number | null; // bit 1 bold, 2 italic, 4 underline
  size: number | null;
  color: string | null;
  font: string | null;
}

export interface CastMember {
  name: string;
  type: 'bitmap' | 'text' | 'button' | 'sound' | 'shape' | 'filmLoop' | 'digitalVideo' | string;
  // bitmap
  w?: number;
  h?: number;
  regX?: number;
  regY?: number;
  depth?: number;
  direct?: boolean;
  /** [left, top, right, bottom] */
  rect?: [number, number, number, number];
  // text / field
  text?: string;
  align?: number; // 0 left, 1 center, -1 right
  styles?: TextStyle[];
  // sound
  loop?: boolean;
  // shape
  shapeType?: number; // 1 rect, 2 roundRect, 3 oval, 4 line
  fill?: number;
  fore?: number;
  back?: number;
  line?: number;
}

export interface CastFile {
  movie: string;
  members: Record<string, CastMember>;
  palettes: Record<string, string[]>;
}

export interface ScoreSprite {
  ch: number;
  castId?: number;
  castName?: string | null;
  castLib?: string;
  castMissing?: boolean;
  type?: string;
  shape?: string;
  file?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  loc: [number, number];
  ink: number;
  inkName: string;
  fore: number;
  back: number;
  spriteType?: string;
  script?: { castId: number; castName?: string | null; castLib?: string; castMissing?: boolean };
  flags: string[];
  thickness?: number;
  blend?: number;
  relX?: number;
  relY?: number;
}

export interface ScorePalette {
  id: number;
  name?: string;
  lib?: string;
  builtin?: string;
  transition?: string;
}

export interface ScoreFrame {
  n: number;
  to?: number;
  tempo?: number;
  tempoMode?: { waitClick?: boolean; delaySec?: number; waitSound?: number; waitVideoChannel?: number };
  palette?: ScorePalette;
  transition?: { type: number; name: string; durationMs: number; chunkSize: number; area: string };
  sound1?: { castId: number; castName?: string; castLib?: string };
  sound2?: { castId: number; castName?: string; castLib?: string };
  script?: { castId: number; castName?: string | null; castLib?: string };
  sprites: ScoreSprite[];
}

export interface FilmLoop {
  name: string;
  rect: { top: number; left: number; bottom: number; right: number };
  frameCount: number;
  frames: ScoreFrame[];
}

export interface ScoreFile {
  movie: string;
  stage: { w: number; h: number; rect: { top: number; left: number; bottom: number; right: number }; bgColor: number; tempo: number; palette: ScorePalette & { extractorResolved?: string } };
  labels: Record<string, number>;
  frameCount: number;
  frames: ScoreFrame[];
  filmLoops?: Record<string, FilmLoop>;
}
