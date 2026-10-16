// Developer's Cut: the hidden layer that revives content found in the decompile but never
// shipped (docs/spec/05-developers-cut.md, docs/secrets.md). Everything here is a no-op
// unless `state.devcut?.enabled`; with the flag off the sim is byte-for-byte unchanged and
// no extra RNG is drawn (05 §0.1.3, §2.5).
//
// The base sim calls in at four places only, each marked `[devcut]` in the core file:
//   newgame.ts   newGame({ devcut: true })  -> seedDevCut(s)
//   commands.ts  dispatch()                 -> devcutBefore / devcutAfter, and the
//                                              { type: 'devcut', action } command
//   rules.ts     monthCheck()               -> devcutMonthCheck (the wooden fence)
//   state.ts     GameState.devcut?          -> DevCutState
// Text ids emitted here resolve through src/content/devcut.json first (05 §2.3).
import { changeCash, dialog, emit, fillLogBook, rand, reject, type Ctx } from './ctx.ts';
import { addEvent, destroy, msg } from './rules.ts';
import { startCalendar } from './turn.ts';
import type { Command } from './commands.ts';
import type { GameState, Prompt } from './state.ts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Remake-only bookkeeping saved inside GameState.devcut (05 §2.2). */
export interface DevCutState {
  enabled: true;
  version: 1;
  /** DL11 Klondike letter answered (either way). */
  klondikeAnswered?: boolean;
  /** DL19 biscuit company: invested. */
  nyInvested?: boolean;
  /** Any goal check passed (1902/8, 1909/6, 1915/6). Used by the 40-year ending. */
  goalReached?: boolean;
  /** Propet 7.3 = 1 came from the wooden fence. */
  woodenFence?: boolean;
  /** Wooden-fence kits left in the catalogue (backup defCatalogItems #num: 1). */
  woodenFenceStock: number;
  /** year*100+month of the last wooden-fence cattle roll (one roll per month). */
  fenceRolled?: number;
  /** Unsold bushels survived the June/July 1894 strike visit. */
  strikeHeld?: boolean;
  /** The 20% strike spoilage has been applied (August 1894). */
  strikeSpoiled?: boolean;
  /** 40-year consolation ending: 'pending' while Goal01 is on screen, then 'shown'. */
  fortyYears?: 'pending' | 'shown';
  /** Retire epilogue variant chosen at the goal dialog (05 §3.9). */
  epilogue?: 'retire' | 'retireInTown';
  /** year*100+month of the last Ed / Norman nudge when leaving the field (05 §3.13). */
  nudged?: { ed?: number; norman?: number };
  /** A Studio Workbench tool altered this game (05 §6.3). */
  studioTouched?: boolean;
  /** Per-quirk override for the DC* quirks: true = reproduce the original data. */
  overrides?: Partial<Record<DcQuirkId, boolean>>;
}

export const isDevCut = (s: Pick<GameState, 'devcut'>): boolean => s.devcut?.enabled === true;

// ---------------------------------------------------------------------------
// DC* quirks (05 §2.4). Kept here rather than in fidelity.ts so the base quirk registry is
// untouched; the semantics match: classic reproduces the original data, remastered fixes it.
// ---------------------------------------------------------------------------

export const DC_QUIRKS = {
  DC1: { id: 'DC1', spec: '05 §2.4, §3.4', description: 'The "no oil" letter AL30 pays +$2000 although its text says "I\'m sorry about the money you lost" (copy of the AL29 line).', classic: '+$2000 cash.', remastered: '$0.' },
  DC2: { id: 'DC2', spec: '05 §2.4, §3.4', description: 'AL29 pays +$2000 cash, but the letter says "Your share of the profit is $2,500.00. I have sent it directly to your bank."', classic: '+$2000 cash.', remastered: '+$2500 to MyRecieve (collect at the bank).' },
  DC3: { id: 'DC3', spec: '05 §2.4, §3.3', description: 'Both Klondike Yes outcomes pay +$200 (ScoreScript 50.ls:80-82); AL12 is the "no gold" letter.', classic: '+$200 for AL12.', remastered: '$0 for AL12.' },
  DC4: { id: 'DC4', spec: '05 §2.4, §3.4', description: 'DL28 when you cannot afford it schedules AL31/AL32 and returns to the letter; answering again schedules a second follow-up in 1916/7.', classic: 'Duplicate 1916/7 lines.', remastered: 'Scheduled once.' },
} as const;
export type DcQuirkId = keyof typeof DC_QUIRKS;

/** Does this Dev Cut game reproduce DC quirk `id`? */
export function dcReproduces(s: Pick<GameState, 'devcut' | 'fidelity'>, id: DcQuirkId): boolean {
  const o = s.devcut?.overrides?.[id];
  if (o !== undefined) return o;
  return s.fidelity.mode === 'classic';
}

// ---------------------------------------------------------------------------
// Seeding (05 §3, seed-line table)
// ---------------------------------------------------------------------------

/** Seed lines in original `AllEvents` syntax. Each month is free of base events. */
export const DEVCUT_SEED_LINES: readonly string[] = [
  '1885,9,0,6,DL19,0,Sig0,5,-500,0,0,1', // dc.ny-cousins (biscuit company)
  '1893,10,0,5,DC_Kate1,Old,0', // dc.kate-invitation (reconstruction)
  '1895,5,0,5,DC_Jesse1,Jessy,0', // dc.jesse-farewell (reconstruction)
  '1897,10,0,6,DL11,0,Sig11,14,-75,0,0', // dc.klondike
  '1915,5,0,6,DL28,0,Sig11,13,-800,0,0', // dc.oil-wichita
];

/** Lines appended later by Dev Cut hooks (for the schedule lint). */
export const DEVCUT_APPENDED_LINES = {
  AL62: '1888,9,0,7,AL62,0,Sig0,0,100,0,0,1',
  AL41: '1919,10,0,7,AL41,0,Sig35,0,0,0,0,1',
  AL53: '1919,10,0,7,AL53,0,Sig35,0,0,0,0,1',
} as const;

/** Called at the end of newGame() when the Dev Cut is on. Draws no RNG. */
export function seedDevCut(s: GameState) {
  s.devcut = { enabled: true, version: 1, woodenFenceStock: 1 };
  for (const l of DEVCUT_SEED_LINES) s.events.push(l.split(','));
  for (const line of s.events) {
    const [y, m, , , id] = line;
    // dc.birth-yeshouse: the 1889 notice in its draft form (prompt inline).
    if (id === 'Baby3' && y === '1889' && m === '2') line[4] = 'YesHouse';
    // dc.deed-signature: AL43 signed by the clerk it names (unused SIG43 "Robert Evans").
    if (id === 'AL43') line[6] = 'Sig43';
    // dc.portrait-speakers: the teacher after 1887 is the older Sophie (DBox91).
    if ((id === 'Sop3' || id === 'Sop4') && Number(y) >= 1887) line[5] = 'DBox91';
  }
}

// ---------------------------------------------------------------------------
// Dev Cut commands (dispatched as { type: 'devcut', action })
// ---------------------------------------------------------------------------

export type DevCutAction =
  /** General Store: the Ready-Made Wooden Fence page (CATALG10, $200). */
  | { kind: 'buyWoodenFence' }
  /** Freight office: ship all unsold grain with offer `offer` (index into freightQuote().offers). */
  | { kind: 'shipGrain'; offer: number }
  /** Leaving the FIELD screen: Ed / Norman nudges (NoPlow6 / GoBank). */
  | { kind: 'leaveField' }
  /** A Studio Workbench tool touched this game. */
  | { kind: 'studioTouch' };

// ---------------------------------------------------------------------------
// Wooden fence (05 §3.12)
// ---------------------------------------------------------------------------

export const WOODEN_FENCE = { price: 200, untilYear: 1883, untilMonth: 3, breakOdds: 4 } as const;

export interface WoodenFenceOffer {
  price: number;
  stock: number;
  /** false from April 1883 (barbed wire arrives): the page shows SOLD OUT. */
  available: boolean;
  soldOut: boolean;
}

/** The CATALG10 page as the catalogue should show it, or null outside the Dev Cut. */
export function woodenFenceOffer(s: GameState): WoodenFenceOffer | null {
  if (!isDevCut(s)) return null;
  const { year, mon } = s.date;
  const inWindow = year < WOODEN_FENCE.untilYear || (year === WOODEN_FENCE.untilYear && mon <= WOODEN_FENCE.untilMonth);
  const stock = inWindow ? s.devcut!.woodenFenceStock : 0;
  return { price: WOODEN_FENCE.price, stock, available: inWindow && stock > 0, soldOut: !inWindow || stock <= 0 };
}

function buyWoodenFence(ctx: Ctx) {
  const s = ctx.s;
  const offer = woodenFenceOffer(s)!;
  if (!offer.available) return reject(ctx, 'notInCatalog');
  // T8: catalogue purchases are cash only.
  if (s.propet.cash < offer.price) return dialog(ctx, 'SEG71');
  changeCash(ctx, -offer.price, 'catalog');
  fillLogBook(ctx, 4, 18, offer.price, 0);
  s.devcut!.woodenFenceStock -= 1;
  s.propet.fence += 1; // the store increments 7.3, as for wire fence
  s.devcut!.woodenFence = true;
  emit(ctx, { type: 'built', item: 'woodenFence' });
}

/**
 * Hook in `monthCheck` (CheckFence). A wooden fence keeps the cattle out, until in a
 * September with mature crops they break it on random(4) = 1. Draws RNG only when a
 * wooden fence stands. Returns the stop message or null.
 */
export function devcutMonthCheck(ctx: Ctx): Prompt | null {
  const s = ctx.s;
  const dc = s.devcut;
  if (!dc?.enabled || !dc.woodenFence) return null;
  if (s.propet.fence !== 1) {
    dc.woodenFence = false; // barbed wire went up over it
    return null;
  }
  const { year, mon } = s.date;
  const key = year * 100 + mon;
  if (!(mon === 9 && s.cursit.numHarved > 0 && s.globals.mainView < 9) || dc.fenceRolled === key) return null;
  dc.fenceRolled = key;
  if (rand(ctx, WOODEN_FENCE.breakOdds) !== 1) return null;
  s.globals.type = 12;
  const lost = destroy(ctx);
  s.propet.fence = 0;
  dc.woodenFence = false;
  s.globals.fenceEvent = 1;
  emit(ctx, { type: 'disaster', kind: 'cattle', squares: lost });
  return msg('NoFence3', 'DBox6');
}

// ---------------------------------------------------------------------------
// Freight office (05 §4.1): the cut multi-dealer market, from FIELD `Dealers` (cast 1135)
// ---------------------------------------------------------------------------

/** assets/FIELD/1135-Dealers.txt verbatim: year,half, then groups of pct,transport,cents,soundId. */
export const RAW_FIELD_DEALERS = `1880,1,-2,1,12,98,+2,2,06,169
1880,2,0,1,12,168,+2,2,07,169
1881,1,0,1,12,170,+2,2,07,171
1881,2,0,1,12,172,+3,2,07,173
1882,1,-3,1,12,174,+3,2,08,175
1882,2,-3,1,12,176,+3,1,16,177
1887,2,+1,1,14,180,+3,1,18,181
1888,1,-2,1,14,178,+2,1,18,179
1888,2,+2,1,14,184,+4,1,20,185
1893,2,-30,1,14,186,-40,1,20,187,-20,1,18,188
1894,2,0,2,10,189,+4,2,18,179,+2,2,15,191
1914,2,+2,1,15,193,+3,1,15,194,0,1,10,195
1915,1,+2,1,14,196,+7,1,15,197,0,1,10,198,+10,3,40,199
1915,2,+2,1,14,196,+7,1,15,197,0,1,10,198,+10,3,40,199
1916,1,+2,1,14,196,+7,1,15,197,0,1,10,198,+10,3,40,199
1916,2,+2,1,14,196,+7,1,15,197,0,1,10,198,+10,3,40,199
1917,1,+5,1,14,200,+10,1,15,201,-10,1,10,202,+10,3,40,203
1917,2,+5,1,14,200,-10,1,15,201,+10,1,10,202,+10,3,40,203
1918,1,+5,1,14,204,+10,1,15,205,-10,1,10,206,+10,3,40,207
1918,2,+5,1,14,204,+10,1,15,205,-10,1,10,206,+10,3,40,207
1919,1,+2,1,14,204,-2,1,15,205,+7,1,15,206,+10,3,40,207
1919,2,+2,1,14,204,-2,1,15,205,+7,1,15,206,+10,3,40,207`;

/** FIELD `Transport` (cast 1139): 1 Train, 2 Wagon, 3 Train and Boat. */
export type Transport = 1 | 2 | 3;
export interface FreightGroup {
  pct: number;
  transport: Transport;
  cents: number;
  sound: number;
}
export interface FreightRow {
  year: number;
  half: 1 | 2;
  groups: FreightGroup[];
}

export const FREIGHT_ROWS: readonly FreightRow[] = RAW_FIELD_DEALERS.split('\n').map((l) => {
  const v = l.split(',').map(Number);
  const groups: FreightGroup[] = [];
  for (let i = 2; i + 3 < v.length; i += 4) groups.push({ pct: v[i], transport: v[i + 1] as Transport, cents: v[i + 2], sound: v[i + 3] });
  return { year: v[0], half: v[1] as 1 | 2, groups };
});

/** Destination keys; labels live in devcut.json `freight.destinations` (reconstruction). */
export type FreightDestination = 'hauler' | 'kansasCity' | 'chicago' | 'europe';

export interface FreightOffer {
  /** 1-based group in the Dealers row (group 1 is Ed, never offered here). */
  group: number;
  destination: FreightDestination;
  transport: Transport;
  pct: number;
  cents: number;
  /** price per bushel after the market % and freight, per crop */
  prices: [number, number, number, number];
  net: number;
  /** Wagons risk the O'Grady rainstorm (4 in 10, 21-50% lost). */
  rainRisk: boolean;
  /** original voice id from the table (the files 98, 168-207 do not survive) */
  sound: number;
}

export interface FreightQuote {
  row: FreightRow | null;
  bushels: [number, number, number, number];
  offers: FreightOffer[];
  /** why there is nothing to offer */
  closed: null | 'strike' | 'noCrops' | 'noRow';
}

const PRICE_MIN = 0.2;
const PRICE_MAX = 2.5;
const round2 = (x: number) => Math.round(x * 100) / 100;

function destinationOf(group: number, t: Transport): FreightDestination {
  if (t === 2) return 'hauler';
  if (t === 3) return 'europe';
  return group <= 2 ? 'kansasCity' : 'chicago';
}

/** Latest (year, half) row at or before the date (the table has gaps). */
export function freightRow(year: number, mon: number): FreightRow | null {
  const half = mon <= 6 ? 1 : 2;
  const key = year * 10 + half;
  let best: FreightRow | null = null;
  for (const r of FREIGHT_ROWS) if (r.year * 10 + r.half <= key) best = r;
  return best;
}

function hasCrops(s: GameState) {
  return s.cursit.harvestValue > 0 || s.cursit.bushels.some((b) => b > 0);
}

/** The freight office board for today. Pure. */
export function freightQuote(s: GameState): FreightQuote {
  const bushels = [...s.cursit.bushels] as FreightQuote['bushels'];
  const { year, mon } = s.date;
  const row = freightRow(year, mon);
  if (year === 1894 && (mon === 6 || mon === 7)) return { row, bushels, offers: [], closed: 'strike' };
  if (!hasCrops(s)) return { row, bushels, offers: [], closed: 'noCrops' };
  if (!row) return { row, bushels, offers: [], closed: 'noRow' };
  const offers: FreightOffer[] = [];
  row.groups.forEach((g, i) => {
    const group = i + 1;
    if (group === 1) return; // Ed's own baseline stays at the elevator (03 §1.5)
    if (g.transport === 2 && year >= 1886) return; // O'Grady's hauler covers wagons from 1886
    const prices = s.cursit.prices.map((p) => round2(Math.min(PRICE_MAX, Math.max(PRICE_MIN, p * (1 + g.pct / 100))) - g.cents / 100)) as FreightOffer['prices'];
    const net = round2(Math.max(0, bushels.reduce((a, b, k) => a + b * prices[k], 0)));
    offers.push({ group, destination: destinationOf(group, g.transport), transport: g.transport, pct: g.pct, cents: g.cents, prices, net, rainRisk: g.transport === 2, sound: g.sound });
  });
  return { row, bushels, offers, closed: null };
}

function shipGrain(ctx: Ctx, offerIndex: number) {
  const s = ctx.s;
  const q = freightQuote(s);
  if (q.closed === 'strike') return dialog(ctx, 'DC_FreightStrike', 'DC_Clerk');
  if (q.closed === 'noCrops') return dialog(ctx, 'DC_FreightNoCrops', 'DC_Clerk');
  const o = q.offers[offerIndex];
  if (!o) return reject(ctx, 'noSuchFreightOffer');
  const c = s.cursit;
  c.harvestValue = 0;
  c.harvestBushels = 0;
  c.bushels = [0, 0, 0, 0];
  let net = o.net;
  if (o.rainRisk && rand(ctx, 10) < 5) {
    // the O'Grady rain rule (03 §1.5): 40% chance, 21-50% lost, telegram
    const loss = rand(ctx, 30) + 20;
    net = net - (net * loss) / 100;
    c.telegram = { year: s.date.year, month: s.date.mon, net, pending: 1 };
  }
  s.myRecieve += net;
  fillLogBook(ctx, 6, 6, 0, 0); // Dealer / Sell; the income is logged when collected at the bank
  emit(ctx, { type: 'dialog', id: 'DC_FreightShipped', dbox: 'DC_Clerk', params: { net: round2(net), destination: o.destination } });
}

// ---------------------------------------------------------------------------
// Leaving the field (05 §3.13): Ed and Norman nudge
// ---------------------------------------------------------------------------

function leaveField(ctx: Ctx) {
  const s = ctx.s;
  const dc = s.devcut!;
  const key = s.date.year * 100 + s.date.mon;
  dc.nudged ??= {};
  if (s.cursit.bushels.some((b) => b > 0) && dc.nudged.ed !== key) {
    dc.nudged.ed = key;
    dialog(ctx, 'NoPlow6', s.date.year < 1890 ? 'TWNMAP79' : 'TWNMAP80');
  }
  if (s.myRecieve > 0 && dc.nudged.norman !== key) {
    dc.nudged.norman = key;
    dialog(ctx, 'GoBank', 'H-FIE108');
  }
}

function devcutCommand(ctx: Ctx, action: DevCutAction) {
  switch (action.kind) {
    case 'buyWoodenFence':
      return buyWoodenFence(ctx);
    case 'shipGrain':
      return shipGrain(ctx, action.offer);
    case 'leaveField':
      return leaveField(ctx);
    case 'studioTouch':
      ctx.s.devcut!.studioTouched = true;
      return;
  }
}

// ---------------------------------------------------------------------------
// Endings (05 §3.8, §3.9)
// ---------------------------------------------------------------------------

/** "You ran a profitable farm": cash + savings at least the $500 starting capital. */
export const FORTY_YEARS_MIN_WORTH = 500;

function goalReachedNow(s: GameState): boolean {
  return s.devcut?.goalReached === true || s.ttalk.some((t) => t.id === 303);
}

/** Would the final calendar click show Goal01 before the finale? Pure. */
export function fortyYearsEligible(s: GameState): boolean {
  return isDevCut(s) && !s.extra.ended && s.globals.eog === 0 && !goalReachedNow(s) && s.propet.cash + s.propet.savings >= FORTY_YEARS_MIN_WORTH;
}

/** Text id + presentation for the retire epilogue card (devcut.json `texts`). */
export function epilogueCard(s: GameState): { id: string; dbox: 'Pic1' | 'Pic2'; params: Record<string, string> } | null {
  const v = s.devcut?.epilogue;
  if (!v) return null;
  return {
    id: v === 'retire' ? 'DC_Retire' : 'DC_RetireInTown',
    dbox: s.date.year < 1890 ? 'Pic1' : 'Pic2',
    params: { Son1: s.propet.babyNames[0], Name: [s.name.first, s.name.last].filter(Boolean).join(' ') },
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure; no sim effect)
// ---------------------------------------------------------------------------

/** Gramophone prop in the parlour: houses 2 and 3 from 1895 (05 §5.1). */
export function gramophoneAvailable(s: GameState): boolean {
  return isDevCut(s) && s.globals.whatHouse >= 2 && s.date.year >= 1895;
}

/** Freight office hotspot on Main Street (05 §4.1). */
export function freightOfficeOpen(s: GameState): boolean {
  return isDevCut(s) && hasCrops(s);
}

/** Message portraits the Dev Cut re-assigns (05 §3.10). */
const PORTRAIT_OVERRIDES: Record<string, string> = { LoanRet: 'DBox4', LoanEnd: 'DBox4', NoM4: 'DBox4' };

// ---------------------------------------------------------------------------
// Dispatch hooks
// ---------------------------------------------------------------------------

/** Snapshot taken before a command runs; null when the Dev Cut is off. */
export interface DevCutFrame {
  cmd: Command;
  prevPrompt: Prompt | null;
  eventsLen: number;
  /** true when the Dev Cut fully handled the command (the base `run` is skipped). */
  handled: boolean;
}

/** Called by dispatch() before the base command runs. */
export function devcutBefore(ctx: Ctx, cmd: Command): DevCutFrame | null {
  const s = ctx.s;
  if (!isDevCut(s)) {
    if (cmd.type === 'devcut') reject(ctx, 'devcutDisabled');
    return null;
  }
  const frame: DevCutFrame = { cmd, prevPrompt: s.pending, eventsLen: s.events.length, handled: false };
  const dc = s.devcut!;
  switch (cmd.type) {
    case 'devcut':
      devcutCommand(ctx, cmd.action);
      frame.handled = true;
      break;
    case 'startCalendar': {
      // dc.forty-years-ending: Goal01 before the Dec 1919 finale.
      const { year, mon } = s.date;
      const final = year > 1919 || (year === 1919 && mon === 12);
      if (final && s.globals.mail <= 0 && dc.fortyYears === undefined && fortyYearsEligible(s)) {
        dc.fortyYears = 'pending';
        const p = msg('Goal01', 'DBox0');
        s.pending = p;
        emit(ctx, { type: 'prompt', prompt: p });
        frame.handled = true;
      }
      break;
    }
    case 'plow':
    case 'harvest': {
      // dc.field-tractor-tip: advisory only.
      const w = cmd.helpers?.workers ?? 0;
      if (s.propet.tractors >= 1 && w > s.propet.tractors) dialog(ctx, 'Tractor', 'DBox6');
      break;
    }
    case 'enterTown':
    case 'sellGrain': {
      // dc.strike-voices: grain held through the 1894 strike without a barn spoils 20%.
      const { year, mon } = s.date;
      if (year === 1894 && mon >= 8 && dc.strikeHeld && !dc.strikeSpoiled) {
        dc.strikeSpoiled = true;
        const barn = s.propet.barn === 1 || s.propet.barn === 2;
        if (!barn) {
          const c = s.cursit;
          c.bushels = c.bushels.map((b) => Math.floor(b * 0.8)) as typeof c.bushels;
          c.harvestBushels = c.bushels.reduce((a, b) => a + b, 0);
          c.harvestValue = Math.round(c.harvestValue * 0.8 * 100) / 100;
        }
        dialog(ctx, 'TSTREET.721', 'DBox3', { spoiled: barn ? 0 : 1 });
      }
      break;
    }
  }
  return frame;
}

/** Called by dispatch() after the base command ran (or was skipped). */
export function devcutAfter(ctx: Ctx, frame: DevCutFrame | null) {
  if (!frame) return;
  const s = ctx.s;
  const dc = s.devcut!;
  const { cmd, prevPrompt } = frame;

  if (cmd.type === 'resolveEvent' && prevPrompt?.kind === 'event') afterEvent(ctx, frame, cmd.choice.yes);
  if (cmd.type === 'resolveEvent' && prevPrompt?.kind === 'goalChoice') afterGoal(ctx, prevPrompt);
  if (frame.eventsLen < s.events.length) patchAppended(ctx, frame.eventsLen);

  if (s.pending?.kind === 'goalChoice' || s.extra.goalPrompt || s.ttalk.some((t) => t.id === 303)) dc.goalReached = true;

  // Goal01 acknowledged: continue straight into the finale (talk 120).
  if (cmd.type === 'ack' && prevPrompt?.kind === 'message' && prevPrompt.text === 'Goal01' && dc.fortyYears === 'pending') {
    dc.fortyYears = 'shown';
    if (!s.pending) startCalendar(ctx);
  }

  // dc.nohouse-kate: little Kate fetches you to town instead of a silent refusal.
  if (cmd.type === 'startCalendar' && ctx.out.some((e) => e.type === 'rejected' && e.reason === 'visitTownTalkFirst')) dialog(ctx, 'NoHouse', 'H-FIE112');

  // dc.field-lucky-plow: the sick horse recovered (FDB18 spring / FDBK19 autumn).
  if (cmd.type === 'plow' && ctx.out.some((e) => e.type === 'dialog' && e.id === 'StopPlow4')) {
    const fb = ctx.out.find((e) => e.type === 'dialog' && e.id === 'FDBK7');
    if (fb && fb.type === 'dialog') fb.id = s.date.mon <= 6 ? 'FDB18' : 'FDBK19';
  }

  // dc.strike-voices: note grain that survived the strike visit (remastered T1 keeps it).
  if (cmd.type === 'sellGrain' && s.date.year === 1894 && (s.date.mon === 6 || s.date.mon === 7) && s.cursit.bushels.some((b) => b > 0)) dc.strikeHeld = true;

  // dc.portrait-speakers: Norman gives the bank's advice on the board.
  if (s.pending?.kind === 'message' && PORTRAIT_OVERRIDES[s.pending.text]) s.pending.dbox = PORTRAIT_OVERRIDES[s.pending.text];
}

const lineId = (l: readonly string[] | undefined) => l?.[4] ?? '';

function afterEvent(ctx: Ctx, frame: DevCutFrame, yes: boolean | undefined) {
  const s = ctx.s;
  const dc = s.devcut!;
  const p = frame.prevPrompt as Extract<Prompt, { kind: 'event' }>;
  const line = s.events[p.line];
  const id = lineId(line);
  const brokeBack = s.pending?.kind === 'message' && s.pending.text === 'NoM';
  if (id === 'DL11') dc.klondikeAnswered = true;
  if (id === 'DL19' && yes !== false && !brokeBack && !dc.nyInvested) {
    dc.nyInvested = true;
    addEvent(ctx, DEVCUT_APPENDED_LINES.AL62);
  }
  // DC2 remastered: George sent $2,500 "directly to your bank".
  if (id === 'AL29' && !brokeBack && !dcReproduces(s, 'DC2')) s.myRecieve += 2500;
  // dc.daughter-al41 / al53: the 1905/7 college decision appends its 1919 letter.
  const has = (x: string) => s.events.some((l) => lineId(l) === x);
  if (has('AL35') && !has('AL41')) addEvent(ctx, DEVCUT_APPENDED_LINES.AL41);
  if (has('AL51') && !has('AL53')) addEvent(ctx, DEVCUT_APPENDED_LINES.AL53);
}

function afterGoal(ctx: Ctx, prev: Extract<Prompt, { kind: 'goalChoice' }>) {
  const s = ctx.s;
  const dc = s.devcut!;
  dc.goalReached = true;
  if (s.extra.ended !== 'retired') return;
  dc.epilogue = prev.text === 'Goal3' || prev.text === 'Goal4' ? 'retireInTown' : 'retire';
  const card = epilogueCard(s)!;
  // The card comes before gameOver('retired'), then the town sings, then the save prompt.
  const at = ctx.out.findIndex((e) => e.type === 'gameOver');
  const ev = { type: 'dialog' as const, id: card.id, dbox: card.dbox, params: card.params };
  if (at >= 0) ctx.out.splice(at, 0, ev);
  else ctx.out.push(ev);
}

/** DC1-DC4 patches on follow-up lines the base sim just appended. */
function patchAppended(ctx: Ctx, from: number) {
  const s = ctx.s;
  for (let i = from; i < s.events.length; i++) {
    const l = s.events[i];
    const id = lineId(l);
    if ((id === 'AL30' && !dcReproduces(s, 'DC1')) || (id === 'AL29' && !dcReproduces(s, 'DC2')) || (id === 'AL12' && !dcReproduces(s, 'DC3'))) l[8] = '0';
  }
  if (!dcReproduces(s, 'DC4')) {
    const oil = new Set(['AL29', 'AL30', 'AL31', 'AL32']);
    const isOil = (l: string[]) => l[0] === '1916' && l[1] === '7' && oil.has(lineId(l));
    const firstOil = s.events.findIndex(isOil);
    for (let i = s.events.length - 1; i >= from; i--) if (i > firstOil && isOil(s.events[i])) s.events.splice(i, 1);
  }
}

