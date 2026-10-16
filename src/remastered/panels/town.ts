// Main Street and its buildings: street.ts, store.ts, bank.ts, elevator.ts, pen.ts, talk.ts register here.
import type { PanelEnv } from './index.ts';
import * as street from './street.ts';
import * as talk from './talk.ts';
import * as store from './store.ts';
import * as bank from './bank.ts';
import * as elevator from './elevator.ts';
import * as pen from './pen.ts';

export function register(env: PanelEnv) {
  for (const m of [street, talk, store, bank, elevator, pen]) m.register(env);
}
