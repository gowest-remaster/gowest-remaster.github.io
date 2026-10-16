// Player-facing grouping of the fidelity registry (sim/fidelity.ts) for the New Game
// "Advanced" panel. Only presentation metadata lives here; the rules are in the sim.
import type { QuirkId } from '../sim/index.ts';

export type RulesArea = 'Farm' | 'Town' | 'Bank' | 'House' | 'Album';
export const AREAS: RulesArea[] = ['Farm', 'Town', 'Bank', 'House', 'Album'];

const AREA_OF: Partial<Record<QuirkId, RulesArea>> = {
  T1: 'Town', T2: 'Town', T7: 'Town', T8: 'Town', T18: 'Town', T21: 'Town', OGNEG: 'Town', LOGLOC: 'Town',
  T11: 'Bank', T12: 'Bank', T13: 'Bank', T17: 'Bank',
  SAVLOG: 'House',
  ANIMIDX: 'Album', CAPSCAN: 'Album',
};

export function areaOf(id: QuirkId): RulesArea {
  return AREA_OF[id] ?? 'Farm';
}
