// House and the books: house.ts, ledger.ts, album.ts, newspaper.ts, almanac.ts, goals.ts register here.
import type { PanelEnv } from './index.ts';
import * as house from './house.ts';
import * as ledger from './ledger.ts';
import * as album from './album.ts';
import * as newspaper from './newspaper.ts';
import * as almanac from './almanac.ts';
import * as goals from './goals.ts';
import * as mailbox from './mailbox.ts';

export function register(env: PanelEnv) {
  for (const m of [house, almanac, ledger, goals, album, newspaper, mailbox]) m.register(env);
}
