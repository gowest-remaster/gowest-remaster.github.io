// The Ledger (§5.9, wireframe W8): every logbook entry on one ruled, scrollable page with
// editable notes, charts of the family's fortunes, a Year in Review card per year, and the
// family roster. Replaces the original 3-rows-a-page logbook.
import '../styles/books.css';
import { reproduces, type GameState, type MonthSnapshot } from '../../sim/index.ts';
import { LOG_ACTIONS, LOG_LOCATIONS } from '../../sim/data/tables.ts';
import { portrait } from '../core/art.ts';
import { h, icon, put } from '../core/dom.ts';
import { money, MONTHS_SHORT, monthName, num } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { reasonLabel } from '../core/journal.ts';
import { reasonText } from './goals.ts';
import { barChart, lineChart, sparkline } from '../ui/charts.ts';
import { btn, segmented, sheetFrame, tabs } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { thenAndNow } from '../ui/thennow.ts';

type Tab = 'entries' | 'charts' | 'review' | 'thennow' | 'family';
const PLACE_ICON: Record<number, keyof typeof ICONS> = { 1: 'bank', 2: 'house', 3: 'field', 4: 'store', 5: 'home', 6: 'elevator', 7: 'pen' };
const FILTERS: { id: number; label: string }[] = [
  { id: 0, label: 'All' },
  { id: 3, label: 'Fields' },
  { id: 4, label: 'Store' },
  { id: 6, label: 'Grain' },
  { id: 1, label: 'Bank' },
  { id: 2, label: 'Home' },
  { id: 7, label: 'Livestock' },
];

interface Point {
  year: number;
  mon: number;
  cash: number;
  savings: number;
  score: number;
  upkeep: number;
  worth: number;
}

function points(s: GameState): Point[] {
  const hist: MonthSnapshot[] | undefined = s.extra.history;
  if (hist && hist.length) return hist.map((m) => ({ year: m.year, mon: m.mon, cash: m.cash, savings: m.savings, score: m.score, upkeep: m.lifePrice, worth: m.cash + m.savings + m.farmValue - m.loanAmount }));
  return session.journal.snapshots.map((m) => ({ year: m.year, mon: m.mon, cash: m.cash, savings: m.savings, score: m.score, upkeep: m.upkeep, worth: m.netWorth }));
}

const short = (y: number, m: number) => `${MONTHS_SHORT[m - 1]} '${String(y).slice(2)}`;
const dollars = (v: number) => (Math.abs(v) >= 10000 ? `$${Math.round(v / 1000)}k` : money(Math.round(v)));

/** The family, with ages (birth years from the event schedule). */
export function familyRoster(s: GameState) {
  const n = s.propet.babyNames;
  const ok = (x: string) => x && x !== 'a';
  const y = s.date.year;
  const kid = (name: string, born: number, who: string, dbox: string, works: boolean) => ({ name, who, age: y - born, dbox, born, works });
  const out = [
    { name: `${s.name.first} ${s.name.last}`.trim() || 'You', who: 'Homesteader', age: null as number | null, dbox: '', born: 0, works: true },
    { name: 'Lilly Mae', who: 'Your eldest daughter', age: null as number | null, dbox: 'DBox2', born: 0, works: s.propet.daughterWorks === 1 || s.propet.familyWorkers > 0 },
  ];
  if (ok(n[0])) out.push(kid(n[0], 1880, 'Your son', 'DBox01', false));
  if (ok(n[1])) out.push(kid(n[1], 1884, 'Your daughter', 'DBox12', false));
  if (ok(n[2])) out.push(kid(n[2], 1889, 'Your younger son', 'DBox23', s.propet.sonWorks === 1));
  return out;
}

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'ledger',
    title: 'Ledger',
    kind: 'sheet',
    size: 'xl',
    readOnly: true,
    hotbar: { key: 'l', label: 'Ledger', icon: ICONS.ledger, order: 100, group: 'book', bar: false },
    mount(ctx) {
      let tab: Tab = (ctx.params.tab as Tab) ?? 'entries';
      let filter = 0;
      let saveTimer = 0;
      const tb = tabs<Tab>({
        tabs: [
          { id: 'entries', label: 'Entries' },
          { id: 'charts', label: 'Charts' },
          { id: 'review', label: 'Year in Review' },
          { id: 'thennow', label: 'Then & Now' },
          { id: 'family', label: 'Family' },
        ],
        value: tab,
        onChange: (t) => {
          tab = t;
          render(session.s);
        },
      });
      const { el, body } = sheetFrame({ title: 'The Family Ledger', icon: 'ledger', sub: 'Kept by hand, every entry since 1880', tabs: tb.el, onClose: () => app.closeSheet('ledger'), cls: 'ledger' });

      function entries(s: GameState) {
        const log = s.logbook.map((e, i) => ({ e, i })).filter(({ e }) => !filter || e.loc === filter || (filter === 6 && e.loc === 8));
        const seg = segmented({ options: FILTERS.map((f) => ({ value: f.id, label: f.label })), value: filter, onChange: (v) => ((filter = v), render(s)), label: 'Filter by place' });
        const totals = log.reduce((a, { e }) => ({ cost: a.cost + e.cost, income: a.income + e.income }), { cost: 0, income: 0 });
        if (!s.logbook.length) return h('div', null, seg.el, h('div', { class: 'empty' }, 'Nothing written yet. Every purchase, sale and job will be entered here by itself.'));
        const rows = log.map(({ e, i }) => {
          // LOGNOTES (ui quirk): in the 1996 logbook a note was kept only when committed (Enter);
          // leaving the page otherwise lost it. Fixed: every keystroke is saved.
          const lossy = reproduces(s.fidelity, 'LOGNOTES');
          const note = h('input', { type: 'text', class: 'note-in', value: session.journal.notes[i] ?? '', placeholder: lossy ? 'add a note, then press Enter…' : 'add a note…', 'aria-label': 'Note' }) as HTMLInputElement;
          const commit = () => {
            session.journal.notes[i] = note.value;
            window.clearTimeout(saveTimer);
            saveTimer = window.setTimeout(() => void session.save('auto'), 800);
          };
          if (lossy) note.addEventListener('keydown', (ev) => ev.key === 'Enter' && commit());
          else note.addEventListener('input', commit);
          const place = LOG_LOCATIONS[e.loc] ?? (e.loc === 8 ? 'Dealer' : e.loc === 9 ? 'Game board' : '');
          return h('tr', null,
            h('td', { class: 'nowrap' }, `${e.date.replace(/\.$/, '')}, ${e.year}`),
            h('td', { class: 'nowrap' }, icon(ICONS[PLACE_ICON[e.loc] ?? 'home'], 'ico place-ico'), ' ', place),
            h('td', null, (LOG_ACTIONS[e.act] ?? '').trim()),
            h('td', { class: 'num cost' }, e.cost ? money(e.cost, { cents: true }) : '—'),
            h('td', { class: 'num inc' }, e.income ? money(e.income, { cents: true }) : '—'),
            h('td', { class: 'num' }, money(e.total, { cents: true })),
            h('td', { class: 'notes' }, note));
        });
        const tbody = h('tbody', null, ...rows);
        const table = h('table', { class: 'ledger-t ruled' },
          h('thead', null, h('tr', null, ...['Date', 'Place', 'Action', 'Cost', 'Income', 'Balance', 'Notes'].map((t) => h('th', null, t)))),
          tbody,
          h('tfoot', null, h('tr', null, h('td', { colspan: '3' }, `${log.length} entries`), h('td', { class: 'num cost' }, money(totals.cost, { cents: true })), h('td', { class: 'num inc' }, money(totals.income, { cents: true })), h('td', { colspan: '2' }))));
        const wrap = h('div', { class: 'ledger-scroll' }, table);
        requestAnimationFrame(() => (wrap.scrollTop = wrap.scrollHeight));
        return h('div', { class: 'entries' }, h('div', { class: 'spread' }, seg.el, h('span', { class: 'small muted' }, 'Notes save as you type.')), wrap);
      }

      function charts(s: GameState) {
        const pts = points(s);
        if (pts.length < 2) return h('div', { class: 'empty' }, 'The charts fill in month by month. Advance the calendar a little and come back.');
        const x = pts.map((p) => short(p.year, p.mon));
        const title = (i: number) => `${monthName(pts[i].mon)} ${pts[i].year}`;
        const years = [...session.journal.years].sort((a, b) => a.year - b.year);
        const thisYear = years.findIndex((y) => y.year === s.date.year);
        const card = (t: string, sub: string, chart: HTMLElement) => h('figure', { class: 'chart-card' }, h('figcaption', null, h('b', null, t), h('span', { class: 'small muted' }, sub)), chart);
        return h('div', { class: 'chart-grid' },
          card('Net worth', 'cash + savings + land, animals and tools, less any loan', lineChart({ x, xTitle: title, series: [{ label: 'Net worth', color: 'var(--c1)', values: pts.map((p) => p.worth) }], yFormat: dollars, ariaLabel: 'Net worth over time' })),
          card('Cash and savings', 'money in your pocket and in the box', lineChart({ x, xTitle: title, series: [{ label: 'Cash', color: 'var(--c2)', values: pts.map((p) => p.cash) }, { label: 'Savings box', color: 'var(--c3)', values: pts.map((p) => p.savings) }], yFormat: dollars, ariaLabel: 'Cash and savings over time' })),
          card('Harvests', 'bushels brought in each year', barChart({ x: years.map((y) => String(y.year)), series: { label: 'Bushels', color: 'var(--c2)', values: years.map((y) => y.bushels) }, highlight: thisYear, yFormat: (v) => num(v), ariaLabel: 'Bushels harvested per year' })),
          card('Grain income', 'money from grain sales each year', barChart({ x: years.map((y) => String(y.year)), series: { label: 'Grain sales', color: 'var(--c1)', values: years.map((y) => y.sales) }, highlight: thisYear, yFormat: dollars, ariaLabel: 'Grain income per year' })),
          card('Upkeep', 'what the family needs each month', lineChart({ x, xTitle: title, series: [{ label: 'Upkeep', color: 'var(--c4)', values: pts.map((p) => p.upkeep) }], yFormat: (v) => money(Math.round(v)), ariaLabel: 'Monthly upkeep over time', height: 160 })),
          card('Standing ★', 'how Longview remembers your family', lineChart({ x, xTitle: title, series: [{ label: 'Standing', color: 'var(--c3)', values: pts.map((p) => p.score) }], refs: [{ y: 30, label: '30' }, { y: 60, label: '60' }, { y: 90, label: '90' }].filter((r) => r.y <= Math.max(30, ...pts.map((p) => p.score)) + 30), ariaLabel: 'Standing over time', height: 160 })),
        );
      }

      function review(s: GameState) {
        const years = [...session.journal.years].sort((a, b) => b.year - a.year);
        if (!years.length) return h('div', { class: 'empty' }, 'At each New Year your year is summed up here.');
        const pts = points(s);
        return h('div', { class: 'review-grid' }, ...years.map((y) => {
          const d = y.endWorth - y.startWorth;
          const spark = pts.filter((p) => p.year === y.year).map((p) => p.worth);
          const upk = session.journal.upkeep.filter((u) => u.year === y.year);
          return h('article', { class: `yr-card${y.year === s.date.year ? ' current' : ''}` },
            h('header', null, h('span', { class: 'yr' }, String(y.year)), y.year === s.date.year ? h('span', { class: 'pill brass' }, 'so far') : null),
            h('dl', { class: 'kv' },
              h('dt', null, 'Harvest'), h('dd', { class: 'num' }, y.bushels ? `${num(y.bushels)} bu` : '—'),
              h('dt', null, 'Worth at harvest'), h('dd', { class: 'num' }, y.harvestValue ? money(y.harvestValue) : '—'),
              h('dt', null, 'Grain sales'), h('dd', { class: 'num' }, y.sales ? money(y.sales) : '—'),
              h('dt', null, 'Net worth'), h('dd', { class: `num ${d >= 0 ? 'good' : 'bad'}` }, `${money(y.endWorth)} (${money(d, { sign: true })})`)),
            spark.length > 1 ? sparkline(spark, 'var(--c1)', 220, 34) : null,
            y.events.length || upk.length ? h('ul', { class: 'yr-ev' }, ...y.events.map((e) => h('li', null, e)), ...upk.map((u) => h('li', null, `${monthName(u.mon, 'short')}: upkeep ${u.delta > 0 ? '+' : '−'}${money(Math.abs(u.delta))} (${/^[A-Z][A-Za-z]*\d/.test(u.reason) ? reasonText(s, u.reason) : reasonLabel(u.reason)})`))) : h('p', { class: 'small muted' }, 'A quiet year.'),
            btn('Write about this year', { kind: 'link', small: true, icon: 'album', onClick: () => void app.go('album') }));
        }));
      }

      function family(s: GameState) {
        const roster = familyRoster(s);
        return h('div', null,
          h('div', { class: 'roster' }, ...roster.map((m) => {
            const por = m.dbox ? portrait(m.dbox) : null;
            return h('div', { class: 'member' },
              por ? h('div', { class: 'portrait lg', style: { backgroundImage: `url("${por}")` } }) : h('div', { class: 'portrait lg you' }, icon(ICONS.people)),
              h('div', { class: 'm-name' }, m.name),
              h('div', { class: 'small muted' }, m.who),
              m.age !== null ? h('div', { class: 'small' }, m.age <= 0 ? 'a baby' : `${m.age} years old`) : null);
          })),
          h('p', { class: 'muted small center' }, `Family helpers in the field: ${s.propet.familyWorkers}. Monthly upkeep: ${money(s.propet.lifePrice)}.`));
      }

      function render(s: GameState) {
        put(body, tab === 'entries' ? entries(s) : tab === 'charts' ? charts(s) : tab === 'review' ? review(s) : tab === 'thennow' ? thenAndNow(s, session.journal) : family(s));
      }
      let lastLen = -1;
      return {
        el,
        update: (s) => {
          // don't rebuild the entries table under the player's typing cursor, nor the slider mid-drag
          if (tab === 'entries' && lastLen === s.logbook.length && body.contains(document.activeElement)) return;
          if (tab === 'thennow' && body.contains(document.activeElement)) return;
          lastLen = s.logbook.length;
          render(s);
        },
        crumb: () => ({ entries: 'Entries', charts: 'Charts', review: 'Year in Review', thennow: 'Then & Now', family: 'Family' })[tab],
      };
    },
  });
}
