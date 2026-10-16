// The small provenance marker. Players see it only on Dev Cut text that is NEW
// (source 'reconstructed'); the Studio also shows 'original' / 'adapted' badges.
import { ensureStyles, h } from './dom.ts';
import type { DcProvenance, DcSource } from './content.ts';

const TITLES: Record<string, string> = {
  reconstructed: 'New text written for the remake. It was not in the 1996 game.',
  original: 'Original 1996 material.',
  adapted: 'Original 1996 material, used in a role the evidence suggests.',
  unheard: 'Not yet listened to: the description comes from the file name and context.',
};

/** "reconstructed" pill for in-game text. */
export function reconstructedBadge(): HTMLElement {
  ensureStyles();
  return h('span', { class: 'dc-badge', title: TITLES.reconstructed, 'aria-label': 'reconstructed text' }, 'reconstructed');
}

/** Badge for any source/provenance; null for plain original text when `quietOriginal`. */
export function sourceBadge(src: DcSource | DcProvenance | 'unheard', quietOriginal = false): HTMLElement | null {
  ensureStyles();
  if (src === 'original' && quietOriginal) return null;
  if (src === 'reconstructed' || src === 'reconstruction') return reconstructedBadge();
  const label = src === 'original-data' ? 'original' : src === 'unheard' ? 'not yet listened to' : src;
  const cls = src === 'original-data' ? 'original' : src;
  return h('span', { class: `dc-badge ${cls}`, title: TITLES[cls] ?? '' }, label);
}
