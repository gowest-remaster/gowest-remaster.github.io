// One dispatcher for the UI: every command goes to the core sim. (The Frontier rules layer that
// used to route through here was archived on 2026-10-16: work/archive/frontier/.)
import { dispatch, type Command, type CommandResult, type GameState } from '../../sim/index.ts';

export function simDispatch(s: GameState, cmd: Command): CommandResult {
  return dispatch(s, cmd);
}
