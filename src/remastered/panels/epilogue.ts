// The end of the story. Completed: the whole town sings "Home on the Range" (talk 120, with
// subtitles), then the Family History book. Retired: the Dev Cut farewell card when present,
// then the book. Bankrupt / foreclosed: a kind recap with Rewind, Start over or Title.
import gsap from 'gsap';
import '../styles/flows.css';
import { getContent } from '../../game/text.ts';
import { epilogueCard, type GameState } from '../../sim/index.ts';
import type { App } from '../core/app.ts';
import { rmArt } from '../core/art.ts';
import { audio, syncScene } from '../core/audio.ts';
import { h, icon, prose, put, svg } from '../core/dom.ts';
import { GOAL_NAMES, money, monthName, num } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import type { Journal } from '../core/journal.ts';
import { registerPanel } from '../core/registry.ts';
import { rmSaves } from '../core/saves.ts';
import { session } from '../core/session.ts';
import { reducedMotion, rm } from '../core/settings.ts';
import { netWorth } from '../core/simapi.ts';
import { devcutContent, T } from '../core/text.ts';
import { assetUrl } from '../devcut/content.ts';
import { btn } from '../ui/kit.ts';
import { enterSave, ORNAMENT } from './title.ts';

function lineChart(points: { x: number; y: number }[], o: { w?: number; h?: number; color?: string; fmt?: (v: number) => string; xfmt?: (v: number) => string; label: string }) {
  const W = o.w ?? 560;
  const H = o.h ?? 160;
  const L = 52;
  const B = 22;
  const s = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label });
  if (points.length < 2) {
    s.append(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'Not enough years to draw yet'));
    return s;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(...ys, 1);
  const X = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - 10);
  const Y = (v: number) => 8 + (1 - (v - y0) / (y1 - y0 || 1)) * (H - B - 8);
  for (const g of [y0, (y0 + y1) / 2, y1]) {
    s.append(svg('line', { class: 'grid', x1: L, x2: W - 10, y1: Y(g), y2: Y(g) }), svg('text', { x: L - 6, y: Y(g) + 4, 'text-anchor': 'end' }, (o.fmt ?? String)(g)));
  }
  const step = Math.max(1, Math.ceil((x1 - x0) / 8));
  for (let v = x0; v <= x1; v += step) s.append(svg('text', { x: X(v), y: H - 4, 'text-anchor': 'middle' }, (o.xfmt ?? String)(v)));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  s.append(svg('path', { d: `${d} L${X(x1)},${Y(y0)} L${X(x0)},${Y(y0)} Z`, fill: o.color ?? 'var(--c1)', opacity: '0.12' }), svg('path', { d, fill: 'none', stroke: o.color ?? 'var(--c1)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  return s;
}

export function familyHistory(s: GameState, j: Journal) {
  const last = s.name.last || 'Homestead';
  const years = s.date.year - 1880;
  const kids = s.propet.babyNames.map((n, i) => ({ n: n && n !== 'a' ? n : null, i })).filter((k) => k.n);
  const items = [
    { year: 1880, mon: 4, text: `${s.name.first} ${s.name.last} signed the homestead claim for 160 acres in Buffalo County.` },
    ...j.keepsakes.filter((k) => k.kind !== 'letter').map((k) => ({ year: k.year, mon: k.mon, text: `${k.title}${k.detail && k.kind !== 'baby' ? ` (${k.detail})` : ''}` })),
    ...(s.extra.goalResults ?? []).map((g) => ({ year: g.year, mon: g.mon, text: `Goal checked: ${GOAL_NAMES[g.goal]} — ${g.met ? 'reached!' : 'not reached this time'}` })),
  ].sort((a, b) => a.year * 12 + a.mon - (b.year * 12 + b.mon));
  const letters = j.keepsakes.filter((k) => k.kind === 'letter').length;
  const bushels = j.years.reduce((a, y) => a + y.bushels, 0);
  const worth = netWorth(s);
  const pages = s.album.texts.map((t, i) => ({ t, pic: s.album.pictures[i], i })).filter((p) => p.i >= 2 && (p.t.trim() || p.pic > 0)).slice(0, 12);
  return h(
    'article',
    { class: 'history-book' },
    h('div', { class: 'hb-title' }, h('div', { class: 'k' }, 'A FAMILY HISTORY'), h('h1', null, `The ${last} Homestead`), h('div', { class: 'muted' }, `Buffalo County, Kansas · 1880–${s.date.year}`), h('div', { class: 'title-orn', html: ORNAMENT, style: 'margin:.6rem auto 0;width:18rem;color:var(--brass-lo);filter:none' })),
    h(
      'section',
      { class: 'hb-sec' },
      h('h2', null, 'At a glance'),
      h(
        'div',
        { class: 'recap-stats' },
        h('div', null, h('b', null, `${years} ${years === 1 ? 'year' : 'years'}`), 'on the prairie'),
        h('div', null, h('b', null, money(worth)), 'worth of the farm'),
        h('div', null, h('b', null, num(bushels)), 'bushels harvested'),
        h('div', null, h('b', null, `★ ${s.propet.score}`), 'standing in Longview'),
        h('div', null, h('b', null, String(letters)), letters === 1 ? 'letter received' : 'letters received'),
        ((n) => h('div', null, h('b', null, String(n)), n === 1 ? 'business owned' : 'businesses owned'))(s.propet.business.filter((b) => b > 0).length),
      ),
    ),
    kids.length ? h('section', { class: 'hb-sec' }, h('h2', null, 'The children'), h('div', { class: 'kids' }, ...kids.map((k) => h('div', { class: 'kid' }, icon(ICONS.baby), h('b', null, k.n!), h('small', { class: 'muted' }, `born ${[1880, 1884, 1889][k.i]}`))))) : null,
    h('section', { class: 'hb-sec' }, h('h2', null, 'Our years'), h('ol', { class: 'timeline' }, ...items.map((it) => h('li', null, h('b', null, `${monthName(it.mon, 'short')} ${it.year}`), it.text)))),
    h(
      'section',
      { class: 'hb-sec' },
      h('h2', null, 'What we built'),
      h('div', { class: 'small muted' }, 'Net worth by month'),
      lineChart(j.snapshots.map((p) => ({ x: p.year + (p.mon - 1) / 12, y: p.netWorth })), { label: 'Net worth over the years', fmt: (v) => money(Math.round(v / 100) * 100), xfmt: (v) => String(Math.floor(v)) }),
      j.years.length > 1 ? h('div', { class: 'small muted', style: 'margin-top:.6rem' }, 'Bushels harvested by year') : null,
      j.years.length > 1 ? lineChart(j.years.map((y) => ({ x: y.year, y: y.bushels })), { label: 'Harvest by year', color: 'var(--c2)', fmt: (v) => num(v) }) : null,
    ),
    pages.length
      ? h(
          'section',
          { class: 'hb-sec' },
          h('h2', null, 'From the family album'),
          h(
            'div',
            { class: 'album-strip' },
            ...pages.map((p, k) => {
              const pic = p.pic > 0 ? rmArt(`album/${p.pic}`) : null;
              return h('figure', { style: { '--r': `${(k % 3) - 1}deg` } as unknown as Partial<CSSStyleDeclaration> }, pic ? h('img', { src: pic, alt: '' }) : null, h('figcaption', null, p.t.trim() || ' '));
            }),
          ),
        )
      : null,
    h('section', { class: 'hb-sec' }, prose(`Forty years after the claim was signed, the ${last} family could look back on their homestead and the town that grew up around it.`, 'prose')),
  );
}

/** Extra chapters for the family history book (e.g. a Developer's Cut page). */
export const historyExtras: ((s: GameState) => Node | null)[] = [];

export function register(app: App) {
  registerPanel({
    id: 'epilogue',
    title: 'The End of the Trail',
    kind: 'screen',
    mount: () => {
      const s = session.state;
      const root = h('div', { class: 'fs epi' });
      const scroll = h('div', { class: 'fs-scroll' });
      root.append(scroll);
      let stopped = false;
      let finale: HTMLAudioElement | null = null;
      const toTitle = () => {
        stopped = true;
        session.close();
        void app.go('title');
      };
      const actions = (...extra: HTMLElement[]) => h('div', { class: 'epi-actions no-print' }, ...extra, btn('Print', { kind: 'ghost', icon: 'print', onClick: () => window.print() }), btn('Back to the title', { kind: 'brass', onClick: toTitle }));
      if (!s) {
        put(scroll, h('div', { class: 'epi-scene' }, h('div', { class: 'epi-h' }, h('h1', null, 'The end of the trail')), h('div'), actions()));
        return { el: root };
      }
      const reason = s.extra.ended ?? 'completed';
      const j = session.journal;

      function book() {
        put(scroll, actions(), familyHistory(s!, j), ...historyExtras.map((f) => f(s!)).filter((x): x is Node => !!x), actions());
        if (!reducedMotion()) gsap.from(scroll.querySelector('.history-book'), { opacity: 0, y: 30, duration: 0.6 });
      }

      async function sing() {
        const talk = getContent().townTalk.talks.find((t) => t.talk === 120);
        const lines = talk?.lines.filter((l) => !l.alt) ?? [];
        const list = h('div', { class: 'epi-lines' });
        const fin = getContent().townTalk.finaleText?.text ?? '';
        put(
          scroll,
          h('div', { class: 'epi-scene' }, h('div', { class: 'epi-h' }, h('div', { class: 'k' }, `DECEMBER ${s!.date.year}`), h('h1', null, 'Well, neighbor, you made it!')), list, h('div', { class: 'epi-actions' }, btn('Open the family history', { kind: 'go', icon: 'book', onClick: () => ((stopped = true), audio.stopVoice(), finale?.pause(), book()) }))),
        );
        if (fin) list.append(h('div', { class: 'epi-line' }, prose(fin, 'prose verbatim')));
        syncScene('epilogue', s!, 'finale');
        const dc = s!.devcut?.enabled ? devcutContent() : null;
        if (dc?.audio.finale?.newer?.asset) {
          finale = new Audio(assetUrl(dc.audio.finale.newer.asset));
          finale.volume = Math.max(0, Math.min(1, rm().master * rm().music));
          void finale.play().catch(() => undefined);
        }
        for (const l of lines) {
          if (stopped) return;
          const el = h('div', { class: 'epi-line' }, h('b', null, l.speaker), h('div', { class: 'verbatim' }, l.text));
          list.append(el);
          if (!reducedMotion()) gsap.from(el, { opacity: 0, y: 12, duration: 0.4 });
          el.scrollIntoView({ block: 'end', behavior: reducedMotion() ? 'auto' : 'smooth' });
          if (finale) await new Promise((r) => setTimeout(r, 2600));
          else await audio.playVoice(l.voiceId, { speaker: l.speaker, text: l.text });
        }
        if (!stopped) window.setTimeout(() => !stopped && book(), 1800);
      }

      async function lost() {
        const why = T(s, reason === 'foreclosed' ? 'LoanEnd' : 'NOM5').text;
        // Rewind points that can still change the story: never the doomed month itself (its
        // autosave already holds the farewell letter), spread out so there is time to act.
        const DOOM = new Set(['NOM5', 'LoanEnd', 'GameIsOver']);
        const endAt = s!.date.year * 12 + s!.date.mon;
        const at = (r: { state: GameState }) => r.state.date.year * 12 + r.state.date.mon;
        const ring = (session.profile ? await rmSaves.list(session.profile.id) : [])
          .filter((r) => r.kind === 'ring' && !r.state.extra.ended && !(r.state.pending?.kind === 'message' && DOOM.has(r.state.pending.text)) && at(r) < endAt)
          .sort((a, b) => at(b) - at(a));
        const picks: typeof ring = [];
        for (const r of ring) if (!picks.length || at(picks[picks.length - 1]) - at(r) >= 4) picks.push(r);
        const rewinds = picks.slice(0, 3).map((r) => btn(`Rewind to ${monthName(r.state.date.mon)} ${r.state.date.year}`, { kind: picks[0] === r ? 'go' : 'ghost', icon: 'replay', title: `Cash ${money(r.state.propet.cash)} · savings ${money(r.state.propet.savings)} then`, onClick: () => session.profile && void enterSave(app, r, session.profile) }));
        put(
          scroll,
          h('div', { class: 'epi-scene' }, h('div', { class: 'epi-h' }, h('div', { class: 'k' }, `${monthName(s!.date.mon).toUpperCase()} ${s!.date.year}`), h('h1', null, 'The end of the trail')), h('div', { class: 'epi-lines' }, h('div', { class: 'epi-line' }, prose(why, 'prose verbatim')), h('div', { class: 'epi-line' }, h('b', null, 'Looking back'), farmedLine(s!.date.year - 1880))), actions(...rewinds, btn('Start over', { kind: 'brass', onClick: () => ((stopped = true), void app.go('newgame')) }))),
          familyHistory(s!, j),
        );
      }

      function retired() {
        const card = epilogueCard(s!);
        if (!card) return book();
        const t = T(s, card.id);
        put(scroll, h('div', { class: 'epi-scene' }, h('div', { class: 'epi-h' }, h('div', { class: 'k' }, 'A NEW CHAPTER'), h('h1', null, 'Retirement')), h('div', { class: 'epi-lines' }, h('div', { class: 'epi-line' }, prose(t.text, 'prose verbatim'))), h('div', { class: 'epi-actions' }, btn('Open the family history', { kind: 'go', icon: 'book', onClick: book }))));
      }

      if (reason === 'completed') void sing();
      else if (reason === 'retired') retired();
      else void lost();
      return { el: root, destroy: () => ((stopped = true), audio.stopVoice(), finale?.pause()) };
    },
  });
}

/** "Looking back" line; a short run has no history worth pointing at, so don't promise one. */
function farmedLine(years: number) {
  if (years < 1) return 'You farmed less than a year on the prairie. Every claim starts somewhere.';
  if (years < 2) return 'You farmed one year on the prairie. Every claim starts somewhere.';
  return `You farmed ${years} years on the prairie. Here is what you built.`;
}
