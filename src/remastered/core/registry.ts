// Panel registry. Every screen of the Remastered UI is a panel registered here, so later
// layers (the Developer's Cut) can add panels and hotbar entries without touching
// the shell:
//
//   registerPanel({ id: 'studio-notes', title: 'Notes', kind: 'sheet',
//     hotbar: { key: 'm', label: 'Market', icon: ICONS.coin, order: 120, group: 'book' },
//     mount: (ctx) => ({ el: h('div', null, '…') }) });
//
// kinds: 'place' = a location the camera travels to (one at a time, has a parent for Back);
//        'sheet' = a book/paper overlay opened over the current place (stackable);
//        'screen' = full-screen flows without the HUD (title, new game, epilogue).
import type { GameState, SimEvent } from '../../sim/index.ts';
import type { PickTarget, Place } from '../../world/api.ts';
import type { App } from './app.ts';

export interface Badge {
  text: string;
  tone?: 'info' | 'urgent' | 'good';
  /** plain-words meaning for the tooltip ("Goal 17% ready") */
  tip?: string;
  /** news, not a to-do: hidden once the place has been opened this month (until it says something new) */
  clear?: boolean;
}

export interface HotbarDef {
  key: string;
  label: string;
  icon: string;
  order: number;
  group?: 'place' | 'book';
  /** live badge from state */
  badge?(s: GameState, app: App): Badge | null;
  /** null = available, else the reason it is dimmed */
  disabled?(s: GameState): string | null;
  /** true = not shown at all in this game (e.g. Developer's Cut-only entries) */
  hidden?(s: GameState): boolean;
  /**
   * false = keyboard shortcut only, no button on the hotbar (the thing has one home elsewhere:
   * the Almanac on the date leaf, the Ledger in the house and on Cash, Goals on the top ribbon,
   * the Mailbox on the bell). Fewer buttons, one place for each thing (calm-ui §6).
   */
  bar?: boolean;
  /** a notification badge (not a state badge): hidden once the panel has been opened, until it changes */
  clearOnOpen?: boolean;
  /** params to open with from the hotbar (e.g. straight to the trivia card) */
  params?(s: GameState): Record<string, unknown>;
}

export interface PanelCtx {
  app: App;
  params: Record<string, unknown>;
}

export interface PanelInstance {
  el: HTMLElement;
  /** state changed (after any command) */
  update?(s: GameState, events: SimEvent[]): void;
  destroy?(): void;
  /** a 3D pick while this panel is active; return true when handled */
  onPick?(t: PickTarget): boolean;
  onHover?(t: PickTarget | null): void;
  /** key press while this panel is on top; return true when handled */
  onKey?(e: KeyboardEvent): boolean;
  /** Back pressed while on top; return true to consume (e.g. close an inner card) */
  onBack?(): boolean;
  /** crumb suffix shown after the title (e.g. "Loans") */
  crumb?(): string | null;
}

export interface PanelDef {
  id: string;
  title: string | ((s: GameState | null) => string);
  kind: 'place' | 'sheet' | 'screen';
  place?: Place;
  parent?: string;
  hotbar?: HotbarDef;
  /** sheets: usable while a letter is held (read-only browsing) */
  readOnly?: boolean;
  /** layout hint for sheets */
  size?: 'md' | 'lg' | 'xl' | 'full';
  /** null = can open, else the reason (shown as a toast) */
  available?(s: GameState): string | null;
  mount(ctx: PanelCtx): PanelInstance;
}

const panels = new Map<string, PanelDef>();
const listeners = new Set<() => void>();

export function registerPanel(def: PanelDef) {
  panels.set(def.id, def);
  listeners.forEach((l) => l());
}
export function getPanel(id: string) {
  return panels.get(id);
}
export function allPanels() {
  return [...panels.values()];
}
export function hotbarPanels() {
  return allPanels()
    .filter((p) => p.hotbar)
    .sort((a, b) => a.hotbar!.order - b.hotbar!.order);
}
export function onRegistry(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const titleOf = (def: PanelDef, s: GameState | null) => (typeof def.title === 'function' ? def.title(s) : def.title);

/** Map a world place to the panel that presents it. */
export const PLACE_PANEL: Record<Place, string> = {
  title: 'title',
  homestead: 'homestead',
  field: 'field',
  pen: 'pen',
  house: 'house',
  mainStreet: 'street',
  store: 'store',
  bank: 'bank',
  elevator: 'elevator',
};
