// The Almanac (§3.2): This Year (season ribbon with field windows, fuzzy frost/heat edges,
// pins, bookmarks, runway), Coming Up (known obligations with countdowns), Lore (neighbor's
// wisdom, unlocked as the story reaches it) and Past Talks & Papers (transcripts with replay,
// every Gazette issue reached). Also exports `seasonRibbon()` for the Homestead hub.
import '../styles/books.css';
import { newspaperIssues, reproduces, type GameState } from '../../sim/index.ts';
import { getContent } from '../../game/text.ts';
import { loadContent, type NewsFile } from '../../content/content.ts';
import type { App } from '../core/app.ts';
import { audio } from '../core/audio.ts';
import { h, icon, put } from '../core/dom.ts';
import { money, MONTHS_CAPS, monthName, monthsBetween } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { rm } from '../core/settings.ts';
import { almanacPins, loanInfo, runway, type AlmanacPin } from '../core/simapi.ts';
import { btn, chip, sheetFrame, tabs, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';

// ---------------------------------------------------------------------------
// The year ribbon (shared by the hub and the This Year tab)
// ---------------------------------------------------------------------------

const SEASON_ICON = ['snow', 'snow', 'snow', 'sprout', 'sprout', 'sun', 'sun', 'sun', 'leaf', 'leaf', 'snow', 'snow'] as const;
const SEASON_WORD = ['winter', 'winter', 'winter', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter'];

/** % position of a date within the year (Jan 1 = 0, Dec 31 = 100). */
const pos = (mon: number, day = 1) => ((mon - 1 + (day - 1) / 30) / 12) * 100;

interface Band {
  cls: string;
  from: number;
  to: number;
  label: string;
  fuzzyEnd?: boolean;
  title: string;
  row: number;
}

function bands(s: GameState, detailed: boolean): Band[] {
  const reveal = rm().assists.seasonReveal;
  const may = reveal ? s.random.summerDay : 21;
  const oct = reveal ? s.random.winterDay : 20;
  const heat = reveal ? `Summer heat arrives May ${s.random.summerDay}` : 'Summer heat arrives May 17–25';
  const frost = reveal ? `First frost October ${s.random.winterDay}` : 'First frost October 14–25';
  const out: Band[] = [
    { cls: 'plow', from: pos(4), to: pos(5, may), label: 'plow', fuzzyEnd: !reveal, title: `Plowing: April until the heat. ${heat}.`, row: 0 },
    { cls: 'plow', from: pos(9), to: pos(10, oct), label: 'plow', fuzzyEnd: !reveal, title: `Plowing: September until the frost. ${frost}.`, row: 0 },
    { cls: 'ripe', from: pos(6), to: pos(9), label: 'ripening · harvest from Sept 1', title: 'Spring crops ripen in June, but can only be harvested from September.', row: 1 },
    { cls: 'harv', from: pos(9), to: pos(11), label: 'harvest', title: 'Harvest spring wheat, oats and corn in September and October.', row: 1 },
  ];
  if (detailed) {
    out.push(
      { cls: 'plant', from: pos(4), to: pos(7), label: 'plant spring wheat · oats · corn', title: 'Spring crops are planted April to June, on plowed squares.', row: 2 },
      { cls: 'plant ww', from: pos(9), to: pos(12), label: 'plant winter wheat', title: 'Winter wheat is planted September to November.', row: 2 },
      { cls: 'harv ww', from: pos(4), to: pos(6), label: 'winter wheat harvest', title: 'Winter wheat planted last autumn is harvested in April and May.', row: 1 },
    );
  }
  return out;
}

function bandEls(s: GameState, detailed: boolean) {
  return bands(s, detailed).map((b) =>
    h('div', { class: `band ${b.cls}${b.fuzzyEnd ? ' fuzzy' : ''} row${b.row}`, style: { left: `${b.from}%`, width: `${b.to - b.from}%` }, 'data-tip': b.title }, h('span', null, b.label)),
  );
}

function monthCells(s: GameState, onClick?: (m: number) => void) {
  const marks = new Set(session.journal.bookmarks.filter((b) => b.year === s.date.year).map((b) => b.mon));
  return MONTHS_CAPS.map((m, i) => {
    const now = i + 1 === s.date.mon;
    const past = i + 1 < s.date.mon;
    const cell = h(
      onClick ? 'button' : 'div',
      { class: `mcell${now ? ' now' : ''}${past ? ' past' : ''} s-${SEASON_WORD[i]}`, 'data-tip': `${monthName(i + 1)} · ${SEASON_WORD[i]}${onClick ? ' · click to bookmark' : ''}` },
      icon(ICONS[SEASON_ICON[i]], 'ico mico'),
      h('span', null, m),
      marks.has(i + 1) ? icon(ICONS.bookmark, 'ico bmk') : null,
    ) as HTMLElement;
    if (onClick) {
      (cell as HTMLButtonElement).type = 'button';
      cell.addEventListener('click', () => onClick(i + 1));
    }
    return cell;
  });
}

function pinsThisYear(s: GameState) {
  return almanacPins(s).filter((p) => p.year === s.date.year || (p.year === s.date.year + 1 && monthsBetween(s.date.year, s.date.mon, p.year, p.mon) <= 12));
}

/** Compact season ribbon for the Homestead hub (top centre). */
export function seasonRibbon(s: GameState, app: App): HTMLElement {
  const pins = pinsThisYear(s).slice(0, 3);
  const open = btn('Open Almanac', { kind: 'ghost', small: true, kbd: 'A', onClick: () => void app.go('almanac') });
  return h(
    'section',
    { class: 'card ribbon alm', 'aria-label': 'The year at a glance' },
    h('div', { class: 'spread' }, h('span', { class: 'eyebrow' }, `The year at a glance · ${s.date.year}`), open),
    h('div', { class: 'months' }, ...monthCells(s)),
    h('div', { class: 'yr-bands' }, ...bandEls(s, false), h('div', { class: 'now-line', style: { left: `${pos(s.date.mon, s.date.day || 1)}%` } })),
    pins.length
      ? h('div', { class: 'pins' }, ...pins.map((p) => h('button', { type: 'button', class: `pin${p.urgent ? ' urgent' : ''}`, onclick: () => p.go && void app.go(p.go) }, icon(ICONS.pin), p.text)))
      : h('div', { class: 'pins muted' }, 'No deadlines pinned this year.'),
  );
}

// ---------------------------------------------------------------------------
// Lore: true, general facts the family would learn (new UI copy). Never predicts a roll.
// ---------------------------------------------------------------------------

interface Lore {
  id: string;
  text: string;
  from: string;
  unlocked: (s: GameState) => boolean;
}
// classic fidelity spoils grain (Q12); remastered keeps it
let reproducesQ12 = false;
const after = (s: GameState, y: number, m = 1) => s.date.year > y || (s.date.year === y && s.date.mon >= m);
const LORE: Lore[] = [
  { id: 'sacks', text: 'Seed comes in sacks. One sack plants one 20-acre square of the field.', from: 'Harriet at the General Store', unlocked: () => true },
  { id: 'windows', text: 'Plow in April and May, or in September and October. Summer heat and the first frost stop the plow.', from: 'Your neighbor', unlocked: () => true },
  { id: 'ripe', text: 'Spring crops ripen in June, but you can’t bring them in until September.', from: 'Your neighbor', unlocked: () => true },
  { id: 'winterwheat', text: 'Winter wheat is planted in autumn and harvested in spring, before September’s dangers.', from: 'Your neighbor', unlocked: (s) => after(s, 1880, 6) },
  { id: 'revert', text: 'Plowed land left unplanted goes back to grass in November.', from: 'Your neighbor', unlocked: (s) => after(s, 1880, 6) },
  { id: 'barn', text: 'Animals need a barn to live through a Kansas winter.', from: 'Ma Watson', unlocked: () => true },
  { id: 'well', text: 'By July the creek runs nearly dry. A well and a windmill keep water on the farm.', from: 'Your neighbor', unlocked: () => true },
  { id: 'september', text: 'Septembers bring prairie fire, grasshoppers and stray cattle. Harvested grain is safe in the barn.', from: 'The Longview Gazette', unlocked: (s) => after(s, 1880, 9) },
  { id: 'fence', text: 'A barbed-wire fence keeps stray cattle out of your crops. Wood is scarce on the prairie.', from: 'Your neighbor', unlocked: (s) => after(s, 1881, 9) },
  { id: 'neighbors', text: 'Neighbors who help in your field will ask for help in return. Once you owe them three times, they ask in April or September.', from: 'Daniel', unlocked: (s) => s.cursit.neighborDebt > 0 || after(s, 1881) },
  { id: 'grain', text: 'Your grain waits at the farm until you sell it at the elevator.', from: 'Ed at the Grain Elevator', unlocked: (s) => s.cursit.bushels.some((b) => b > 0) || after(s, 1880, 10) },
  { id: 'ogrady', text: 'The O’Grady hauler pays a few cents more a bushel, minus his fee, and the money waits at the bank. Storms sometimes ruin part of a wagonload.', from: 'Ed at the Grain Elevator', unlocked: (s) => after(s, 1886) },
  { id: 'box', text: 'Money in the savings box earns no interest. The store, the bank and the land office take cash only.', from: 'The banker', unlocked: () => true },
  { id: 'loan', text: 'A bank loan must be repaid all at once, in December of its last year. Interest grows every year.', from: 'The banker', unlocked: (s) => s.cursit.firstHarv === 1 },
  { id: 'fair', text: 'The livestock fair comes to the pen in April and May. A cow gives milk, which lowers your upkeep.', from: 'Your neighbor', unlocked: (s) => after(s, 1881, 4) },
  { id: 'deed', text: 'After five years on the claim, a homestead becomes yours to keep.', from: 'The land office', unlocked: (s) => after(s, 1885, 3) },
  { id: 'drought', text: 'In drought years there is less wheat for sale, so the elevator pays much more for every bushel.', from: 'Ed at the Grain Elevator', unlocked: (s) => after(s, 1887) },
  { id: 'tractor', text: 'A steam tractor plows and harvests a square in 2 days instead of 6.', from: 'The Farmer’s Choice catalog', unlocked: (s) => after(s, 1887, 4) },
  { id: 'business', text: 'A business in town pays its income every month, forever.', from: 'Brown & Fryer Real Estate', unlocked: (s) => after(s, 1895, 4) },
  { id: 'claim', text: 'The Enlarged Homestead Act gives a second claim of 160 acres, doubling your field.', from: 'The land office', unlocked: (s) => after(s, 1909, 4) },
];

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

type Tab = 'year' | 'coming' | 'lore' | 'past' | 'timeline';

function countdown(s: GameState, p: AlmanacPin) {
  const m = monthsBetween(s.date.year, s.date.mon, p.year, p.mon);
  if (m < 0) return 'now';
  if (m === 0) return 'this month';
  if (m === 1) return 'next month';
  if (m < 24) return `in ${m} months`;
  return `in ${Math.round(m / 12)} years`;
}

let news: NewsFile | null = null;

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'almanac',
    title: 'Almanac',
    kind: 'sheet',
    size: 'xl',
    readOnly: true,
    hotbar: { key: 'a', label: 'Almanac', icon: ICONS.almanac, order: 90, group: 'book', bar: false },
    mount(ctx) {
      let tab: Tab = (ctx.params.tab as Tab) ?? 'year';
      const tb = tabs<Tab>({
        tabs: [
          { id: 'year', label: 'This Year' },
          { id: 'coming', label: 'Coming Up' },
          { id: 'lore', label: 'Lore' },
          { id: 'past', label: 'Past Talks & Papers' },
          { id: 'timeline', label: 'Timeline' },
        ],
        value: tab,
        onChange: (t) => {
          tab = t;
          render(session.s);
        },
      });
      const { el, body } = sheetFrame({ title: 'The Farmer’s Almanac', icon: 'almanac', sub: '\u00a0', tabs: tb.el, onClose: () => app.closeSheet('almanac'), cls: 'almanac alm' });
      const sub = el.querySelector('.sheet-sub') as HTMLElement;
      if (!news) void loadContent('news.json').then((n) => ((news = n), tab === 'past' && render(session.s)));

      function toggleBookmark(s: GameState, mon: number) {
        const bm = session.journal.bookmarks;
        const year = mon < s.date.mon ? s.date.year + 1 : s.date.year;
        const i = bm.findIndex((b) => b.year === year && b.mon === mon);
        if (i >= 0) {
          bm.splice(i, 1);
          toast(`Bookmark removed: ${monthName(mon)} ${year}`, { icon: 'bookmark' });
        } else {
          bm.push({ year, mon, label: monthName(mon) });
          toast(`Bookmarked ${monthName(mon)} ${year}. Advance stops there.`, { icon: 'bookmark', tone: 'good' });
        }
        render(s);
      }

      function yearTab(s: GameState) {
        const rw = runway(s);
        const pins = pinsThisYear(s);
        const rwText = rw.infinite
          ? `Your businesses earn ${money(rw.business)}/mo, more than your upkeep of ${money(rw.upkeep)}/mo.`
          : `Upkeep ${money(rw.upkeep)}/mo · cash covers ${rw.cashMonths} ${rw.cashMonths === 1 ? 'month' : 'months'} · savings ${rw.savingsMonths} more${rw.business ? ` · businesses +${money(rw.business)}/mo` : ''}`;
        return h(
          'div',
          { class: 'alm-year' },
          h('div', { class: 'alm-ribbon' },
            h('div', { class: 'months big' }, ...monthCells(s, (m) => toggleBookmark(s, m))),
            h('div', { class: 'yr-bands tall' }, ...bandEls(s, true), h('div', { class: 'now-line', style: { left: `${pos(s.date.mon, s.date.day || 1)}%` } }, h('span', null, 'today'))),
            h('div', { class: 'band-key small muted' },
              rm().assists.seasonReveal ? `Farmer’s intuition: heat from May ${s.random.summerDay}, frost from October ${s.random.winterDay}.` : 'The soft edges are the summer heat (May 17–25) and the first frost (October 14–25). The exact day changes every year.'),
          ),
          h('div', { class: 'grid2' },
            h('div', null, h('h3', { class: 'alm-h' }, icon(ICONS.pin), 'Pinned this year'),
              pins.length ? h('ul', { class: 'pinlist' }, ...pins.map((p) => h('li', { class: p.urgent ? 'urgent' : '' }, h('b', null, `${monthName(p.mon, 'short')} ${p.year}`), h('span', null, p.text), p.go ? btn('Go', { kind: 'link', small: true, onClick: () => void app.go(p.go!) }) : null))) : h('p', { class: 'muted' }, 'No deadlines this year.')),
            h('div', null, h('h3', { class: 'alm-h' }, icon(ICONS.bookmark), 'Your bookmarks'),
              session.journal.bookmarks.length
                ? h('ul', { class: 'pinlist' }, ...[...session.journal.bookmarks].sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon)).map((b) => h('li', null, h('b', null, `${monthName(b.mon, 'short')} ${b.year}`), h('span', null, b.label), btn('Remove', { kind: 'link', small: true, onClick: () => { session.journal.bookmarks.splice(session.journal.bookmarks.indexOf(b), 1); render(s); } }))))
                : h('p', { class: 'muted small' }, 'Click a month above to bookmark it. The calendar stops there when you press Advance.'),
              h('h3', { class: 'alm-h' }, icon(ICONS.hourglass), 'Runway'),
              h('p', { class: `runway-line ${rw.level}` }, rwText)),
          ),
        );
      }

      function comingTab(s: GameState) {
        const pins = [...almanacPins(s)].sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon));
        const li = loanInfo(s);
        if (!pins.length) return h('div', { class: 'empty' }, 'Nothing is pinned yet. Deadlines appear here as soon as you plant, borrow or a window opens.');
        return h('div', null,
          h('p', { class: 'muted small' }, 'Things you already know are coming. Surprises (letters, weather, visitors) are never listed here.'),
          h('ol', { class: 'coming' }, ...pins.map((p) => {
            const extra = p.kind === 'loan' && li.has ? h('div', { class: 'small' }, `You have ${money(s.propet.cash + s.propet.savings, { cents: true })} of ${money(li.due, { cents: true })}.`) : null;
            return h('li', { class: `coming-item k-${p.kind}${p.urgent ? ' urgent' : ''}` },
              h('div', { class: 'when' }, h('b', null, monthName(p.mon, 'short')), h('span', null, String(p.year))),
              h('div', { class: 'what' }, h('div', null, p.text), extra, h('div', { class: 'cd' }, countdown(s, p))),
              p.go ? btn('Go', { kind: 'ghost', small: true, onClick: () => void app.go(p.go!) }) : null);
          })));
      }

      function loreTab(s: GameState) {
        reproducesQ12 = reproduces(s.fidelity, 'Q12');
        const open = LORE.filter((l) => l.unlocked(s));
        const locked = LORE.length - open.length;
        return h('div', null,
          h('p', { class: 'muted small' }, 'Neighbor’s wisdom: things your family learns as the years go by.'),
          h('div', { class: 'lore-grid' }, ...open.map((l) => h('figure', { class: 'lore-card' }, h('blockquote', null, l.id === 'grain' ? (reproducesQ12 ? 'Sell your grain before the harvest deadline, or it spoils.' : l.text) : l.text), h('figcaption', null, `— ${l.from}`)))),
          locked ? h('p', { class: 'muted small center' }, `${locked} more ${locked === 1 ? 'lesson' : 'lessons'} still to learn.`) : null);
      }

      function pastTab(s: GameState) {
        const talks = getContent()?.townTalk?.talks ?? [];
        const heard = session.journal.talks;
        const nIssues = newspaperIssues(s);
        const talkEls = heard.length
          ? heard.map((id) => {
              const t = talks.find((x) => x.talk === id);
              if (!t) return null;
              const lines = t.lines.filter((l) => !l.alt);
              const det = h('details', { class: 'talk-tr' },
                h('summary', null, icon(ICONS.talk), h('span', null, t.title || `Town talk ${id}`), h('span', { class: 'muted small' }, ` · ${lines.length} ${lines.length === 1 ? 'voice' : 'voices'}`)),
                h('div', { class: 'tr-lines' }, ...lines.map((l) => {
                  const play = btn('', { kind: 'plain', icon: 'replay', title: 'Hear it again', onClick: () => void audio.playVoice(l.voiceId, { speaker: l.speaker, text: l.text }) });
                  play.setAttribute('aria-label', `Hear ${l.speaker} again`);
                  return h('div', { class: 'tr-line' }, play, h('b', null, l.speaker), h('span', { class: 'verbatim' }, l.text));
                })),
                btn('Hear everyone', { kind: 'ghost', small: true, icon: 'volume', onClick: async () => { for (const l of lines) await audio.playVoice(l.voiceId, { speaker: l.speaker, text: l.text }); } }));
              return det;
            })
          : [h('p', { class: 'muted' }, 'Talks you hear on Main Street are written down here, so a missed tip is never lost.')];
        const papers = Array.from({ length: nIssues }, (_, i) => {
          const iss = news?.issues[i];
          const read = session.journal.papers.includes(i + 1);
          const b = h('button', { type: 'button', class: `paper-chip${read ? ' read' : ''}` }, h('span', { class: 'pc-mast' }, 'The Longview Gazette'), h('b', null, iss?.dateText ?? `Issue ${i + 1}`), h('span', { class: 'small' }, iss?.articles[0]?.headline ?? ''), read ? null : chip('unread', { tone: 'info' }));
          b.addEventListener('click', () => void app.go('newspaper', { issue: i + 1 }));
          return b;
        });
        return h('div', { class: 'grid2 past' },
          h('div', null, h('h3', { class: 'alm-h' }, icon(ICONS.talk), 'Town talks heard'), ...talkEls),
          h('div', null, h('h3', { class: 'alm-h' }, icon(ICONS.news), 'Newspapers'), papers.length ? h('div', { class: 'paper-list' }, ...papers) : h('p', { class: 'muted' }, 'The first Longview Gazette comes out in August 1880.')));
      }

      /** America, 1880–1919, as your family heard it: every Gazette issue reached and every talk heard. */
      function timelineTab(s: GameState) {
        if (!news) {
          void loadContent('news.json').then((n) => ((news = n), tab === 'timeline' && render(session.s)));
          return h('div', { class: 'empty' }, 'Gathering the clippings…');
        }
        const MON: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
        const items: { year: number; mon: number; kind: 'paper' | 'talk'; text: string; open: () => void }[] = [];
        const n = newspaperIssues(s);
        news.issues.slice(0, n).forEach((iss, i) => {
          const heads = iss.articles.map((a) => a.headline).filter(Boolean).slice(0, 3) as string[];
          items.push({ year: iss.year, mon: iss.month, kind: 'paper', text: heads.join(' · '), open: () => void app.go('newspaper', { issue: i + 1 }) });
        });
        const talks = getContent()?.townTalk?.talks ?? [];
        for (const id of session.journal.talks) {
          const tk = talks.find((x) => x.talk === id);
          const m = tk?.title.match(/^(\w{3})\w*\.?\s+(?:\d+,\s+)?(\d{4})\s*\(([^)]+)\)/);
          if (!tk || !m) continue;
          items.push({ year: Number(m[2]), mon: MON[m[1]] ?? 1, kind: 'talk', text: `Town talk: ${m[3]}`, open: () => { tab = 'past'; tb.set('past'); render(session.s); } });
        }
        items.sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon));
        if (!items.length) return h('div', { class: 'empty' }, 'History arrives with the Gazette and the talk on Main Street. Your timeline fills in as you hear it.');
        return h('div', null,
          h('p', { class: 'muted small' }, 'America from 1880 to 1919, as your family heard it in Longview. Click a line to read it again.'),
          h('ol', { class: 'timeline-am' }, ...items.map((it) => {
            const b = h('button', { type: 'button', class: `tl-item k-${it.kind}` }, h('span', { class: 'tl-when' }, `${monthName(it.mon, 'short')} ${it.year}`), icon(ICONS[it.kind === 'paper' ? 'news' : 'talk'], 'ico tl-ico'), h('span', { class: 'tl-what' }, it.text));
            b.addEventListener('click', it.open);
            return h('li', null, b);
          })));
      }

      function render(s: GameState) {
        sub.textContent = `${monthName(s.date.mon)} ${s.date.year} · ${s.name.last ? `the ${s.name.last} homestead` : 'your homestead'}`;
        put(body, tab === 'year' ? yearTab(s) : tab === 'coming' ? comingTab(s) : tab === 'lore' ? loreTab(s) : tab === 'timeline' ? timelineTab(s) : pastTab(s));
      }
      return { el, update: (s) => render(s), crumb: () => ({ year: 'This Year', coming: 'Coming Up', lore: 'Lore', past: 'Talks & Papers', timeline: 'Timeline' })[tab] };
    },
  });
}
