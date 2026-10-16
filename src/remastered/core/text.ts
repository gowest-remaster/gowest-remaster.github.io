// Text resolution for the Remastered UI: verbatim original content (game/text.ts), with the
// Developer's Cut texts layered first in Dev Cut games (devcut/README §2).
import type { GameState } from '../../sim/index.ts';
import { member, text as origText } from '../../game/text.ts';
import { buildLetter } from '../../game/letters.ts';
import { devcutText, fillPlaceholders, loadDevcut, reconstructedBadge, type DevcutContent } from '../devcut/index.ts';
import { assetUrl } from '../devcut/content.ts';

let dc: DevcutContent | null = null;
export async function ensureDevcut(s: GameState | null) {
  if (s?.devcut?.enabled && !dc) {
    try {
      dc = await loadDevcut();
    } catch (e) {
      console.warn('devcut content failed to load', e);
    }
  }
}
export const devcutContent = () => dc;

export interface ResolvedText {
  text: string;
  reconstructed: boolean;
}

const ph = (s: GameState) => ({ firstName: s.name.first, son1: s.propet.babyNames[0] !== 'a' ? s.propet.babyNames[0] : '', name: `${s.name.first} ${s.name.last}`.trim() });

/** Dialog/message text by id. */
export function T(s: GameState | null, id: string): ResolvedText {
  if (s?.devcut?.enabled && dc) {
    const t = devcutText(dc, id);
    if (t) return { text: fillPlaceholders(t.text, ph(s)), reconstructed: t.source === 'reconstructed' };
  }
  return { text: origText(id), reconstructed: false };
}
export const txt = (s: GameState | null, id: string) => T(s, id).text;

/** Letter text (with "Dear <name>," and name substitutions). */
export function letterText(s: GameState, id: string, dear: boolean): ResolvedText {
  if (s.devcut?.enabled && dc) {
    const t = devcutText(dc, id);
    if (t && !member(id)) return { text: fillPlaceholders(t.text, ph(s)), reconstructed: t.source === 'reconstructed' };
  }
  return { text: buildLetter(s, id, dear), reconstructed: false };
}

export function badgeIf(r: ResolvedText) {
  return r.reconstructed ? reconstructedBadge() : null;
}

/** Dev Cut portraits/signatures (DBox3, DBox4, Sig0, DC_Clerk…) when the original art lacks them. */
export function devcutPortrait(id: string | null | undefined): string | null {
  if (!id || !dc) return null;
  const p = dc.portraits[id];
  return p ? assetUrl(p.asset) : null;
}
export function devcutSignature(id: string | null | undefined): string | null {
  if (!id || !dc) return null;
  const p = dc.signatures[id];
  return p ? assetUrl(p.asset) : null;
}
