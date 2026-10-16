// Full-screen flows: title, new game (with the intro chapters, goal and claim), load,
// settings, about, the Studio and the epilogue.
import type { PanelEnv } from './index.ts';
import * as title from './title.ts';
import * as newgame from './newgame.ts';
import * as intro from './intro.ts';
import * as load from './load.ts';
import * as settings from './settings.ts';
import * as about from './about.ts';
import * as studio from './studio.ts';
import * as epilogue from './epilogue.ts';

export function register(env: PanelEnv) {
  for (const m of [title, newgame, intro, load, settings, about, studio, epilogue]) m.register(env.app);
}
