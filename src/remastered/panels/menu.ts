// The Esc menu (Resume · Save · Load · Settings · Help · About · Quit) and the Help sheet
// (keyboard map, "Ask a Neighbor" hints with the original verbatim hint text, glossary),
// plus quicksave/quickload and "What can I do now?".
import { h, icon, prose, put } from '../core/dom.ts';
import { dateShort } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { rmSaves } from '../core/saves.ts';
import { session } from '../core/session.ts';
import { todaySuggestions } from '../core/simapi.ts';
import { btn, confirm, sheetFrame, tabs, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import '../styles/menu.css';
import { GLOSSARY, onOpenGlossary } from '../core/glossary.ts';
import { showDiagnostics } from '../../crashlog.ts';

const KEYS: [string, string][] = [
  ['Space', 'Advance the calendar (again to pause)'],
  ['Shift + Space', 'Advance one month'],
  ['[  ]', 'Slower / faster months'],
  ['1 – 8', 'Homestead, Field, House, Main Street, Store, Bank, Elevator, Pen'],
  ['A · L · G', 'Almanac, Ledger, Goals'],
  ['Esc', 'Back one level (or the menu)'],
  ['Ctrl/⌘ + Z', 'Undo your last action (until time moves)'],
  ['H', 'What can I do now?'],
  ['?', 'This help'],
  ['F5 · F9', 'Quicksave · quickload'],
  ['Field: P · N · V', 'Plow · Plant · Harvest; arrows + Space mark squares; Enter starts'],
];


export function register(env: PanelEnv) {
  const { app } = env;
  hintsFor('CALEND.Hints');
  onOpenGlossary((term) => {
    // a notice that can't be set aside keeps the word's tooltip only
    if (app.holdLetter && !app.holdLetter('peek')) return;
    void app.go('help', { tab: 'glossary', term });
  });

  app.keys.menu = () => void app.go('menu');
  app.keys.help = () => (app.sheets.some((m) => m.def.id === 'help') ? app.closeSheet('help') : void app.go('help'));
  app.keys.whatNow = () => {
    if (!session.state) return;
    const sg = todaySuggestions(session.s)[0];
    toast(sg ? sg.text : 'All quiet on the homestead. Press Advance when you’re ready.', { icon: 'help', speaker: 'Your neighbor', action: sg?.go ? { label: 'Go', onClick: () => void app.go(sg.go!) } : undefined });
  };
  app.keys.quicksave = () => {
    if (!session.state) return;
    void session.save('quick').then(() => toast('Quicksaved.', { icon: 'save', tone: 'good' }));
  };
  app.keys.quickload = async () => {
    if (!session.profile) return;
    const rec = await rmSaves.get(session.profile.id, 'quick');
    if (!rec) return void toast('No quicksave yet. Press F5 to make one.', { icon: 'save' });
    await session.load(rec);
    app.closeSheets();
    void app.go(rec.place || 'homestead', { force: true });
    toast(`Loaded your quicksave from ${rec.label}.`, { icon: 'save' });
  };

  registerPanel({
    id: 'menu',
    title: 'Menu',
    kind: 'sheet',
    size: 'md',
    readOnly: true,
    mount() {
      const slots = h('div', { class: 'slots' });
      const renderSlots = async () => {
        if (!session.profile) return;
        const all = await rmSaves.list(session.profile.id);
        put(
          slots,
          ...[1, 2, 3].map((n) => {
            const r = all.find((x) => x.kind === 'slot' && x.slot === n);
            return h('div', { class: 'slot' }, h('div', null, h('b', null, `Slot ${n}`), h('div', { class: 'small muted' }, r ? `${r.label} · saved ${new Date(r.savedAt).toLocaleString()}` : 'Empty')),
              btn('Save here', { kind: 'brass', small: true, icon: 'save', onClick: async () => {
                if (r && !(await confirm('Replace this save?', [h('p', null, `Slot ${n} holds ${r.label}.`)], 'Replace'))) return;
                await session.save('slot', n);
                toast(`Saved to slot ${n}.`, { icon: 'save', tone: 'good' });
                void renderSlots();
              } }),
              r ? btn('Load', { kind: 'ghost', small: true, onClick: async () => {
                await session.load(r);
                app.closeSheets();
                void app.go(r.place || 'homestead', { force: true });
              } }) : null);
          }),
        );
      };
      void renderSlots();
      const s = session.state;
      const f = sheetFrame(
        { title: 'Menu', sub: s ? `${s.name.first} ${s.name.last} · ${dateShort(s.date)}` : undefined, onClose: () => app.closeSheet('menu'), icon: 'menu' },
        h('div', { class: 'menu-grid' },
          btn('Resume', { kind: 'go', icon: 'play', onClick: () => app.closeSheet('menu') }),
          btn('Settings', { kind: 'brass', icon: 'gear', onClick: () => void app.go('settings') }),
          btn('Help & keys', { kind: 'brass', icon: 'help', onClick: () => void app.go('help') }),
          btn('About this remaster', { kind: 'brass', icon: 'book', onClick: () => void app.go('about') }),
          btn('Load a game', { kind: 'brass', icon: 'calendar', onClick: () => void app.go('load') }),
          btn('Quit to title', { kind: 'ghost', icon: 'back', onClick: async () => {
            await session.save('auto');
            app.closeSheets();
            session.close();
            void app.go('title');
          } })),
        h('h3', { class: 'card-title' }, 'Save'),
        h('p', { class: 'small muted' }, 'The game saves itself every month and whenever you act. Keep a copy in a slot to come back to a moment.'),
        slots,
        // small and out of the way: the session log + memory for a bug report (Home Screen apps have no URL bar)
        h('div', { class: 'menu-diag' }, btn('Diagnostics', { kind: 'ghost', small: true, onClick: () => showDiagnostics() })),
      );
      return { el: f.el };
    },
  });

  registerPanel({
    id: 'help',
    title: 'Help',
    kind: 'sheet',
    size: 'lg',
    readOnly: true,
    mount({ params }) {
      let tab: 'neighbor' | 'keys' | 'glossary' = params.tab === 'glossary' || params.tab === 'keys' ? params.tab : 'neighbor';
      const focusTerm = typeof params.term === 'string' ? params.term : null;
      const t = tabs({ tabs: [{ id: 'neighbor', label: 'Ask a neighbor' }, { id: 'keys', label: 'Keys' }, { id: 'glossary', label: 'Glossary' }], value: tab, onChange: (v) => ((tab = v), render()) });
      const f = sheetFrame({ title: 'Help', sub: 'Everything you can do is one click or one key away.', onClose: () => app.closeSheet('help'), tabs: t.el, icon: 'help' });
      function render() {
        if (tab === 'keys') put(f.body, h('table', { class: 'ledger-t keys' }, h('tbody', null, ...KEYS.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', { style: { textAlign: 'left' } }, d))))));
        else if (tab === 'glossary') {
          const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
          put(f.body, h('p', { class: 'small muted' }, 'Words from the 1880s, in plain English. Underlined words in letters and talk link here.'), h('dl', { class: 'glossary' }, ...sorted.flatMap((g) => [h('dt', { id: `gl-${g.term.replace(/\W+/g, '-')}`, class: g.term === focusTerm ? 'hit' : '' }, g.term), h('dd', { class: g.term === focusTerm ? 'hit' : '' }, g.text)])));
          if (focusTerm) requestAnimationFrame(() => f.body.querySelector('dt.hit')?.scrollIntoView({ block: 'center' }));
        }
        else {
          const s = session.state;
          const place = app.placeId ?? 'homestead';
          const area = place === 'field' ? 'FIELD.Hints' : place === 'house' ? 'HOUSE1.Hints' : ['street', 'store', 'bank', 'elevator'].includes(place) ? 'TSTREET1.Hints' : 'CALEND.Hints';
          const hints = hintsFor(area);
          const sg = s ? todaySuggestions(s).slice(0, 4) : [];
          const steps: [string, string][] = [
            ['Look at “What needs you”', 'The card at the top right of the homestead lists what you can do next. Each line has a button that takes you there.'],
            ['Travel for free', 'The buttons on the bottom bar (or keys 1–8) take you anywhere: the field, your house, Main Street, the store, the bank, the elevator. Travel never costs a day.'],
            ['Farm the seasons', 'Plow and plant in spring (April–May), harvest in autumn (September–October), then sell your grain to Ed at the elevator.'],
            ['Let time pass', 'Press Advance (Space). Months go by until something needs you: a letter, a harvest, a deadline. Press again to pause.'],
            ['Point at anything', 'Point at a number, a badge or an underlined word to see what it means. Changed your mind? Undo (Ctrl+Z) takes back your last action.'],
          ];
          put(
            f.body,
            h('div', { class: 'help-now card' }, h('div', { class: 'eyebrow' }, 'What can I do now?'), sg.length ? h('ul', { class: 'help-now-list' }, ...sg.map((x) => h('li', null, h('span', null, x.text), x.go ? btn('Go', { kind: 'ghost', small: true, onClick: () => { app.closeSheets(); void app.go(x.go!); } }) : null))) : h('p', null, 'All quiet. Press Advance when you’re ready.')),
            h('h3', { class: 'card-title' }, 'How to play'),
            h('ol', { class: 'howto' }, ...steps.map(([t, d]) => h('li', null, h('b', null, t), h('span', null, d)))),
            h('details', { class: 'hint-old' }, h('summary', null, 'Your neighbor’s advice, in the original words of 1996'),
              hints.length ? h('div', { class: 'hint-list' }, ...hints.map((x) => h('div', { class: 'hint' }, icon(ICONS.talk), prose(x, 'prose verbatim')))) : h('p', { class: 'empty' }, 'No hints for this place.')),
          );
        }
      }
      render();
      return { el: f.el };
    },
  });
}

let hintCache: Map<string, string[]> | null = null;
function hintsFor(id: string): string[] {
  if (!hintCache) {
    hintCache = new Map();
    try {
      // hints.json is loaded lazily by the content loader; fall back to nothing if absent
      void import('../../content/hints.json').then((m) => {
        const data = (m as { default: { hints: { id: string; ranges: { text: string }[] }[] } }).default;
        for (const x of data.hints) hintCache!.set(x.id, [...new Set(x.ranges.map((r) => r.text.trim()))]);
      });
    } catch {
      /* ignore */
    }
  }
  return hintCache.get(id) ?? [];
}
