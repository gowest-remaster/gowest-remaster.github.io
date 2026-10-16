// FIELD controller (02 §5) for the Classic FIELD movie: the field session, crop art (with the Q16
// swap) and the "can this action start?" checks. The movie runs the plow / plant / harvest commands itself.
import { reproduces, type Command, type CommandResult, type Crop } from '../../sim/index.ts';
import { game } from '../../engine/game.ts';

export type FieldAction = 'plow' | 'plant' | 'harvest';

export class FieldController {
  get state() {
    return game.state!;
  }

  /** Crop art index: Q16 swaps oats/corn graphics in classic presentation. */
  cropArt(crop: Crop): 'RedW' | 'WhiteW' | 'Oats' | 'Corn' {
    const swap = reproduces(this.state.fidelity, 'Q16') && this.state.fidelity.mode === 'classic';
    if (crop === 1) return 'RedW';
    if (crop === 2) return 'WhiteW';
    if (crop === 3) return swap ? 'Corn' : 'Oats';
    return swap ? 'Oats' : 'Corn';
  }

  session() {
    return this.state.sessions.field ?? { neighbors: 0, wage: 5, land: 1 };
  }

  /**
   * Can the action start? Returns null when it can, else the sim result carrying the
   * explanatory dialog (NoPlow / NoPlant / NoHarv / NoM), which the caller applies.
   */
  check(action: FieldAction): CommandResult | null {
    const cmd: Command =
      action === 'plow'
        ? { type: 'plow', squares: [] }
        : action === 'plant'
          ? { type: 'plant', plantings: [] }
          : { type: 'harvest', helpers: { workers: 99, neighbors: 0, family: 0 } };
    const r = game.peek(cmd);
    if (!r) return null;
    const blocked = r.events.some((e) => e.type === 'dialog');
    return blocked ? r : null;
  }
}
