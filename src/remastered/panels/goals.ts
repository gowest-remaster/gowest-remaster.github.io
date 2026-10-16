// Goals & Standing (§5.17, wireframe W2): the goal and its check date, the real checklist,
// family milestones (revealed only after they happen), the Standing track with the politician
// letter thresholds and every ★ change with its reason, the original guidelines verbatim, and
// the achievements deed.
import { reasonLabel } from '../core/journal.ts';
import '../styles/books.css';
import { farmValue, type GameState } from '../../sim/index.ts';
import { BUSINESSES } from '../../sim/data/tables.ts';
import { member } from '../../game/text.ts';
import { h, icon, prose, put, svg } from '../core/dom.ts';
import { GOAL_NAMES, money, monthName } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { goalChecklist, type Milestone } from '../core/simapi.ts';
import { meter, sheetFrame } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';

const THRESHOLDS = [30, 50, 60, 70, 80, 85];
const GOAL_LINE: Record<number, string> = {
  1: 'To be a successful farmer.',
  2: 'To be a successful businessperson.',
  3: 'To be a successful politician.',
};
const EVENT_KIND: Record<number, string> = { 1: 'A new baby', 2: 'A donation', 3: 'A family decision', 4: 'The doctor’s list', 5: 'Family news', 6: 'A letter answered', 7: 'A letter', 9: 'The questionnaire', 10: 'A wedding', 11: 'The town budget', 15: 'Law school' };

/** Friendly label for a standing reason (an event text id, a key like business2, or a UI label). */
export function reasonText(s: GameState, reason: string): string {
  const b = reason.match(/^business(\d)$/);
  if (b) return `Bought ${BUSINESSES[Number(b[1]) - 1]?.id ?? 'a business'}`;
  if (reason === 'claim') return 'Signed the second claim';
  if (/\s/.test(reason)) return reason;
  const line = s.events.find((l) => l[4] === reason);
  if (line) {
    const kind = EVENT_KIND[Number(line[3])] ?? 'A letter';
    return `${kind} (${monthName(Number(line[1]), 'short')} ${line[0]})`;
  }
  if (/^doc|^list/i.test(reason)) return 'The doctor’s list';
  if (/^Wed/.test(reason)) return 'A wedding';
  if (/^D[Ll]\d/.test(reason)) return 'A donation';
  // anything else: the sim's own words for it, never a raw id
  const label = reasonLabel(reason);
  return label !== reason ? label : reason.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function milestoneEl(m: Milestone) {
  const ico = m.state === 'earned' ? ICONS.heartFull : ICONS.heart;
  // an unrevealed moment is one plain line; a revealed one says what it was and how it went
  const text = m.revealed ? m.label : 'Still to come';
  const state = m.state === 'earned' ? 'Earned' : m.state === 'missed' ? 'Missed' : m.revealed ? 'Still to come' : null;
  return h('div', { class: `ms ms-${m.state}` }, icon(ico, 'ico ms-heart'), h('div', null, h('div', null, text), state ? h('div', { class: 'small muted' }, state) : null));
}

function standingTrack(score: number) {
  const W = 600;
  const max = 100;
  const x = (v: number) => 14 + ((W - 28) * Math.min(max, Math.max(0, v))) / max;
  const root = svg('svg', { viewBox: `0 0 ${W} 46`, class: 'standing-track', role: 'img', 'aria-label': `Standing ${score} on a scale to 100` });
  root.append(svg('line', { x1: 14, x2: W - 14, y1: 18, y2: 18, stroke: 'var(--parch-edge)', 'stroke-width': 6, 'stroke-linecap': 'round' }));
  root.append(svg('line', { x1: 14, x2: x(score), y1: 18, y2: 18, stroke: 'var(--good)', 'stroke-width': 6, 'stroke-linecap': 'round' }));
  for (const t of THRESHOLDS) {
    root.append(svg('line', { x1: x(t), x2: x(t), y1: 10, y2: 26, stroke: score >= t ? 'var(--good)' : 'var(--ink-faint)', 'stroke-width': 2 }));
    root.append(svg('text', { x: x(t), y: 42, 'text-anchor': 'middle' }, String(t)));
  }
  root.append(svg('text', { x: 14, y: 42, 'text-anchor': 'start' }, '0'));
  root.append(svg('circle', { cx: x(score), cy: 18, r: 8, fill: 'var(--good)', stroke: 'var(--parch-hi)', 'stroke-width': 3 }));
  return root;
}

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'goals',
    title: 'Goals & Standing',
    kind: 'sheet',
    size: 'lg',
    readOnly: true,
    hotbar: { key: 'g', label: 'Goals', icon: ICONS.goals, order: 110, group: 'book', bar: false },
    mount() {
      const { el, body } = sheetFrame({ title: 'Goals & Standing', icon: 'goals', onClose: () => app.closeSheet('goals'), cls: 'goals' });
      function render(s: GameState) {
        const g = goalChecklist(s);
        const p = s.propet;
        const left = g.monthsLeft;
        const when = left < 0 ? 'The check date has passed.' : left === 0 ? 'Checked this month!' : left < 24 ? `in ${left} months` : `in ${Math.floor(left / 12)} years`;
        const result = s.extra.goalResults?.find((r) => r.goal === g.goal);
        const reqs = h('ul', { class: 'reqs' }, ...g.reqs.map((r) => {
          const frac = r.met ? 1 : r.value !== undefined && r.target ? r.value / r.target : 0;
          return h('li', { class: r.met ? 'met' : '' },
            icon(r.met ? ICONS.check : ICONS.cross, `ico req-ico ${r.met ? 'good' : 'bad'}`),
            h('div', { class: 'req-t' }, h('div', null, r.label), r.hint && !r.met ? h('div', { class: 'small muted' }, r.hint) : null),
            r.target && r.target > 1 ? h('div', { class: 'req-m' }, meter(frac, { tone: r.met ? 'good' : 'brass' }), h('span', { class: 'small num' }, r.label.includes('$') ? `${money(r.value ?? 0)}` : `${r.value ?? 0} / ${r.target}`)) : null);
        }));
        const standing = [...session.journal.standing].reverse();
        const guide = member(`G${g.goal}`);
        const busn = p.business.map((v, i) => (v > 0 ? BUSINESSES[i].id : null)).filter(Boolean) as string[];
        const house = s.globals.whatHouse >= 3 ? 'a wooden house' : s.globals.whatHouse === 2 ? 'a furnished sod house' : p.house ? 'a sod house' : 'a covered wagon';
        put(body,
          h('div', { class: 'goal-head' },
            h('div', { class: 'goal-badge' }, icon(ICONS.goals)),
            h('div', null, h('div', { class: 'eyebrow' }, `Your goal · ${GOAL_NAMES[g.goal]}`), h('div', { class: 'goal-line verbatim' }, (member('Goals') ?? '').split('\n')[g.goal - 1]?.trim() || GOAL_LINE[g.goal]), h('div', { class: 'muted' }, `Checked in ${monthName(g.check.mon)} ${g.check.year} · ${when}`)),
            h('div', { class: 'goal-pct' }, h('b', null, `${Math.round(g.progress * 100)}%`), h('span', { class: 'small muted' }, 'ready'))),
          result ? h('div', { class: `callout ${result.met ? 'good' : 'warn'}` }, result.met ? `Reached in ${monthName(result.mon)} ${result.year}!` : `Not reached at the ${monthName(result.mon)} ${result.year} check.${result.retry ? ' One more check comes a year later.' : ''}`) : null,
          h('div', { class: 'grid2 goals-grid' },
            h('div', null,
              h('h3', { class: 'alm-h' }, icon(ICONS.check), 'What the town will look for'), reqs,
              g.milestones ? h('div', { class: 'milestones' }, h('h3', { class: 'alm-h' }, icon(ICONS.heart), 'Family milestones'), h('p', { class: 'small muted' }, 'Earn two of these three. Each is revealed once its moment has come.'), ...g.milestones.map(milestoneEl)) : null,
              guide ? h('details', { class: 'orig-words' }, h('summary', null, 'In the original words'), prose(guide, 'prose verbatim small')) : null),
            h('div', null,
              h('h3', { class: 'alm-h' }, icon(ICONS.star), `Standing ★ ${p.score}`),
              standingTrack(p.score),
              h('p', { class: 'small muted' }, g.goal === 3 ? 'Letters from the party arrive as your standing passes 30, 50, 60, 70, 80 and 85.' : 'Standing is how Longview remembers your family: gifts, weddings, businesses and choices.'),
              standing.length
                ? h('ol', { class: 'standing-log' }, ...standing.slice(0, 40).map((e) => h('li', null, h('b', { class: e.delta > 0 ? 'good' : 'bad' }, `${e.delta > 0 ? '+' : ''}${e.delta}`), h('span', null, reasonText(s, e.reason)), h('span', { class: 'small muted' }, `${monthName(e.mon, 'short')} ${e.year}`))))
                : h('p', { class: 'empty' }, 'No standing earned yet.'))),
          h('section', { class: 'deed' },
            h('div', { class: 'deed-title' }, 'The ', s.name.last || 'Family', ' Homestead'),
            h('div', { class: 'deed-sub' }, `Buffalo County, Kansas · ${monthName(s.date.mon)} ${s.date.year}`),
            h('dl', { class: 'kv deed-kv' },
              h('dt', null, 'Land'), h('dd', null, `${160 * p.numFields} acres (${p.numFields === 2 ? 'two claims' : 'one claim'})`),
              h('dt', null, 'Home'), h('dd', null, `${house}${p.barn === 1 ? ', a barn' : ''}${p.windmill === 1 ? ', a well & windmill' : ''}${p.fence ? ', a fence' : ''}`),
              h('dt', null, 'Animals'), h('dd', null, `${p.horses} horses · ${p.cows} cows · ${p.pigs} pigs`),
              h('dt', null, 'Equipment'), h('dd', null, [p.plows ? `${p.plows} plow${p.plows > 1 ? 's' : ''}` : '', p.tractors ? `${p.tractors} tractor${p.tractors > 1 ? 's' : ''}` : '', p.car ? 'an automobile' : '', p.camera ? 'a Kodak camera' : '', p.stove ? 'a cooking stove' : ''].filter(Boolean).join(' · ') || '—'),
              h('dt', null, 'In town'), h('dd', null, busn.length ? busn.join(' · ') : '—'),
              h('dt', null, 'Farm value'), h('dd', { class: 'num' }, money(farmValue(s)))),
            h('div', { class: 'deed-seal' }, 'LAND OFFICE')),
        );
      }
      return { el, update: (s) => render(s) };
    },
  });
}
