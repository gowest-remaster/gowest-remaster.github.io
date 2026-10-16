// All Remastered panels. Each module registers its panel definitions (core/registry.ts).
// Later layers (Developer's Cut extras) add their own register() calls here.
import type { App } from '../core/app.ts';
import type { CalendarRunner } from '../core/calendar.ts';
import * as homestead from './homestead.ts';
import * as field from './field.ts';
import * as menu from './menu.ts';
import * as town from './town.ts';
import * as books from './books.ts';
import * as flows from './flows.ts';

export interface PanelEnv {
  app: App;
  cal: CalendarRunner;
}

export function registerAllPanels(app: App, cal: CalendarRunner) {
  const env: PanelEnv = { app, cal };
  for (const m of [homestead, field, menu, town, books, flows]) m.register(env);
}
