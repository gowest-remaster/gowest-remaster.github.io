// Typed loaders for the generated content JSON in this folder.
// The JSON is produced by `bun tools/content/build.ts` (repo root) — do not edit it by hand.
// See docs/content.md for what each file contains.

/** Where a string came from. */
export type ContentSource =
  | "text-member" // verbatim text member (field) of an original movie
  | "lingo-literal" // verbatim string literal in the decompiled Lingo
  | "transcribed"; // only exists as bitmap art or audio; transcribed in docs/spec or by Whisper

export type MovieName =
  | "ALBUM" | "BANK09" | "BHOUSE1" | "CALEND" | "FIELD" | "HOUSE1" | "HOUSE2" | "HOUSE3" | "INTRO" | "LOGIN"
  | "NEWS" | "OPEN" | "ORGPLAY" | "PLAY" | "SHARED" | "STORE" | "TSTREET1" | "TTALK" | "GOWEST";

/** A text member, referenced by stable id `<MOVIE>.<name>` (or `<MOVIE>.#<castId>` when unnamed). */
export interface TextRef {
  id: string;
  movie: MovieName;
  castId: number;
  name: string;
  text: string;
  source: ContentSource;
}
export interface SrcRef {
  movie: string;
  castId?: number;
  name: string;
}
export interface LingoRef {
  movie: string;
  script: string;
  line: number;
}
/** Lingo literal value: lists, property lists (keys keep '#'), symbols as "#name", point()/rect() as {point:[x,y]}. */
export type LingoValue = number | string | null | LingoValue[] | { [k: string]: LingoValue };

// ---------------------------------------------------------------- raw dumps
export interface RawTextFile {
  movie: MovieName;
  origin: string;
  members: { castId: number; name: string; type: "text" | "button"; text: string }[];
}
export interface LingoStringsFile {
  note: string;
  strings: { text: string; refs: LingoRef[] }[];
}

// ---------------------------------------------------------------- events / letters
export interface EventRef {
  item: number; // 1-based item index in the AllEvents line (item 5 = first arg)
  name: string;
  movie?: string;
  castId?: number;
  memberType?: string;
  textId?: string; // -> TextRef.id
  unresolved?: boolean;
}
export interface ScheduledEvent {
  id: string;
  year: number;
  month: number;
  day: number;
  type: number;
  typeName: string;
  args: string[];
  refs: EventRef[];
  raw: string;
  addedBy?: LingoRef[]; // only for events appended at run time
}
export interface EventsFile {
  note: string;
  types: Record<string, string>;
  templateSrc: SrcRef;
  shippedSrc: SrcRef & { identicalToTemplate: boolean };
  schedule: ScheduledEvent[];
  dynamic: ScheduledEvent[];
  dynamicFragments: { text: string; refs: LingoRef[] }[];
  choiceLines: TextRef;
  choiceLinesAlt: TextRef;
  weddingOptions: TextRef[];
  texts: { family: TextRef[]; doctor: TextRef[] };
}
export type Letter = TextRef & { signatureY: number | null };
export interface LettersFile {
  note: string;
  letters: Letter[];
  politics: Letter[];
  templates: TextRef[];
}

// ---------------------------------------------------------------- dialogs / hints / bubbles / credits
export interface DialogsFile {
  note: string;
  calendar: TextRef[];
  moneyCrisis: TextRef[];
  field: TextRef[];
  calendarExtra: TextRef[];
  goalLists: TextRef[];
  fieldExtra: TextRef[];
  street: TextRef[];
  bank: TextRef[];
  bankPayDate: TextRef[];
  house: TextRef[];
  exitDialog: TextRef;
  perMovieCopies: TextRef[];
  runtimeFieldDefaults: TextRef[];
  goals: TextRef;
  myGoal: TextRef;
  startupChecks: TextRef[];
  lingo: { text: string; source: "lingo-literal"; refs: LingoRef[] }[];
  bitmapText: {
    note: string;
    login: { screen: string; title: string; body: string; buttons: string; keys: string; source: "transcribed" }[];
    optionsPanel: string[];
    claimForm: { text: string; bitmap: string; source: "transcribed" };
    introPoster: { text: string; bitmap: string; source: "transcribed" };
    goalPanel: { text: string; bitmap: string; source: "transcribed" };
  };
}
export interface HintsFile {
  note: string;
  hints: (TextRef & { ranges: { index: number; lines: [number, number]; text: string }[] })[];
  qtexts: TextRef[];
}
export interface Bubble {
  n: number;
  text: string;
  source: "transcribed";
  bitmap: { movie: "SHARED"; castId: number; name: string; file: string } | null;
}
export interface BubblesFile {
  note: string;
  bubbles: Bubble[];
}
export type CreditsFile = TextRef & { note: string; lines: string[]; window: number; maxLines: number; ticksPerLine: number };

// ---------------------------------------------------------------- trivia / album / catalog
export interface TriviaQuestion {
  n: number;
  question: TextRef;
  answers: [TextRef, TextRef, TextRef, TextRef];
  correct: 1 | 2 | 3 | 4;
  bonus: number;
  explanation: TextRef;
}
export interface TriviaFile {
  note: string;
  questions: TriviaQuestion[];
}
export interface AlbumFile {
  note: string;
  page1: TextRef;
  page2: TextRef;
  sharedPageDefaults: TextRef[];
  generalCaptions: TextRef[];
  datedCaptions: (TextRef & { unlockYear: number; unlockMonth: number })[];
  printDialog: TextRef[];
}
export interface CatalogItem {
  type: "seedsMenu" | "seeds" | "products";
  name: string;
  year: number;
  month: number;
  cast: string;
  loc: { point: [number, number] };
  num?: number;
  price?: number;
}
export interface CatalogFile {
  note: string;
  items: CatalogItem[];
  template: CatalogItem[];
  storeBackup: CatalogItem[];
  seedPrices: TextRef[];
  seedsNameField: TextRef;
}

// ---------------------------------------------------------------- tables / state
export interface NumericTable<Row> {
  src: SrcRef;
  columns: string[];
  notes?: string;
  raw: string;
  rows: (Row & { _extra?: string })[];
}
export interface LinesTable {
  src: SrcRef;
  values: string[];
}
export interface RawRowsTable {
  src: SrcRef;
  raw: string;
  rows: (number | string | null)[][];
}
export type YearRow<K extends string> = { year: number } & Record<K, number | null>;
export interface TablesFile {
  LandValue: NumericTable<YearRow<"landValue">>;
  Lst: NumericTable<YearRow<"cow" | "pig" | "horse">>;
  BuAc2: NumericTable<YearRow<"pricePerAcre" | "bushelsPerAcre" | "pricePerBushel">>;
  BuAc3: NumericTable<YearRow<"pricePerAcre" | "bushelsPerAcre" | "pricePerBushel">>;
  BuAc4: NumericTable<YearRow<"pricePerAcre" | "bushelsPerAcre" | "pricePerBushel">>;
  Destroied: NumericTable<{ matureSquares: number; maxTrampled: number }>;
  Seasons: NumericTable<Record<string, number | null>>;
  Business: { src: SrcRef; raw: string; rows: (number | null)[][] };
  DealersStreet: RawRowsTable;
  DealersField: RawRowsTable;
  DealerScheduleStreet: RawRowsTable;
  YearCal: RawRowsTable;
  monthsUpper: LinesTable; // "JAN." … (calendar, logbook)
  months: LinesTable; // "Jan." … (field, newspaper dates)
  actions: LinesTable;
  locations: LinesTable;
  goals: LinesTable;
  transport: LinesTable;
  priceDay: LinesTable;
  signatureY: { src: SrcRef; values: Record<string, number> };
  doctorList: { id: string; text: string; items: { label: string; price: number }[] }[];
  orgplayPriceList: { note: string; text: string };
  lingoConstants: Record<string, { value: LingoValue; refs: LingoRef[] }[]>;
}
export interface StateFile {
  note: string;
  templates: TextRef[];
  shared: TextRef[];
}

// ---------------------------------------------------------------- news / town talk / voice
export interface NewsArticle {
  id: string; // "<year><n>"
  n: number;
  headline: string | null;
  headlineOnFrontPage: string | null;
  text: string;
  caption: string | null;
  transcriberNotes: string[];
  image: string | null;
  source: "transcribed";
}
export interface NewsIssue {
  index: number;
  year: number;
  month: number;
  day: number;
  dateText: string;
  openedFromTownTalk: number[];
  frontPage: { image: string; sharedCast: number | null; layoutNotes: string | null; source: "transcribed" };
  articles: NewsArticle[];
}
export interface NewsFile {
  note: string;
  issues: NewsIssue[];
}
export interface VoiceLine {
  id: string;
  audio: string | null;
  originalPath: string;
  speaker: string | null;
  context: string | null;
  text: string | null; // null = non-speech sound effect
  source: "transcribed";
  corrected: boolean;
  alt?: boolean;
  unused?: boolean;
  lingo?: LingoRef[];
  segments?: { start: number; end: number; text: string }[];
}
export interface VoiceFile {
  note: string;
  layers: Record<string, string>;
  lines: VoiceLine[];
  unmappedAudio: { audio: string; reason: string }[];
}
export interface TownTalkLine {
  layer: number;
  speaker: string;
  alt: boolean;
  voiceId: string;
  audio: string | null;
  text: string;
  source: "transcribed";
}
export interface TownTalkFile {
  note: string;
  layers: Record<string, string>;
  layerBySprite: number[];
  regularTalks: number[];
  schedule: { year: number; month: number; day: number; talk: number; folder: string }[];
  chains: Record<string, { followers: Record<string, number[]>; defaults: number[] }>;
  talks: { talk: number; title: string; lines: TownTalkLine[] }[];
  defaultLines: { layer: number; speaker: string; text: string; audio: string | null }[];
  finaleText: TextRef;
}

// ---------------------------------------------------------------- loaders
export interface ContentFiles {
  "events.json": EventsFile;
  "letters.json": LettersFile;
  "dialogs.json": DialogsFile;
  "hints.json": HintsFile;
  "bubbles.json": BubblesFile;
  "credits.json": CreditsFile;
  "trivia.json": TriviaFile;
  "album.json": AlbumFile;
  "catalog.json": CatalogFile;
  "tables.json": TablesFile;
  "state.json": StateFile;
  "news.json": NewsFile;
  "townTalk.json": TownTalkFile;
  "voice.json": VoiceFile;
  "lingo.strings.json": LingoStringsFile;
}

// Vite code-splits each JSON file; nothing is loaded until asked for.
const modules = import.meta.glob<unknown>("./*.json", { import: "default" });

export async function loadContent<K extends keyof ContentFiles>(file: K): Promise<ContentFiles[K]> {
  const m = modules[`./${file}`];
  if (!m) throw new Error(`content file missing: ${file} (run: bun tools/content/build.ts)`);
  return (await m()) as ContentFiles[K];
}

export async function loadRawText(movie: MovieName): Promise<RawTextFile> {
  const m = modules[`./text.${movie}.json`];
  if (!m) throw new Error(`no raw text dump for ${movie}`);
  return (await m()) as RawTextFile;
}

/** Load several files at once: `const { events, letters } = await loadAll(["events", "letters"])`. */
export async function loadAll<K extends keyof ContentFiles>(files: K[]): Promise<{ [P in K]: ContentFiles[P] }> {
  const entries = await Promise.all(files.map(async (f) => [f, await loadContent(f)] as const));
  return Object.fromEntries(entries) as { [P in K]: ContentFiles[P] };
}
