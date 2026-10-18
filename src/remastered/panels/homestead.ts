// The Homestead hub (§5.1): the 3D diorama with labelled props, the season ribbon, the Today
// card (with the 1880 Arrival checklist), blueprint ghosts leading to the Build card, the
// mailbox and the trivia card.
import gsap from 'gsap';
import { buildableItems, livestockMarketOpen, type BuildItem, type GameState, type Helpers } from '../../sim/index.ts';
import { getContent } from '../../game/text.ts';
import type { PickTarget } from '../../world/api.ts';
import type { Label } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { dateLong, money, monthName, MONTHS_SHORT, plural } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { unreadMail } from '../core/quiet.ts';
import { session } from '../core/session.ts';
import { reducedMotion, rm, setAssists, setRm } from '../core/settings.ts';
import { almanacPins, buildEstimate, monthStates, todaySuggestions, type Suggestion } from '../core/simapi.ts';
import { audio, soundCaption } from '../core/audio.ts';
import { badge } from '../ui/badges.ts';
import { btn, chip, drawer, toast } from '../ui/kit.ts';
import { crewPicker } from './crew.ts';
import type { PanelEnv } from './index.ts';
import { isCompact } from '../ui/compact.ts';
import '../styles/homestead.css';

const BUILD_INFO: Record<BuildItem, { name: string; icon: keyof typeof ICONS; does: string }> = {
  house: { name: 'Sod house', icon: 'house', does: 'A home built from squares of prairie sod.' },
  barn: { name: 'Barn', icon: 'home', does: 'Shelter for the animals. Without it they won’t survive the winter.' },
  windmill: { name: 'Well & windmill', icon: 'sun', does: 'Water for the family and the animals all year.' },
  woodFence: { name: 'Wooden fence', icon: 'pen', does: 'Keeps stray cattle out of the crops.' },
  barbedFence: { name: 'Barbed-wire fence', icon: 'pen', does: 'Keeps stray cattle out of the crops.' },
};

export function register(env: PanelEnv) {
  const { app } = env;
  registerPanel({
    id: 'homestead',
    title: (s) => (s?.name.last ? `The ${s.name.last} Homestead` : 'Homestead'),
    kind: 'place',
    place: 'homestead',
    hotbar: { key: '1', label: 'Homestead', icon: ICONS.home, order: 10, group: 'place', badge: (s) => badge.homestead(s), params: (s) => (s.extra.triviaOpen ? { trivia: true } : {}) },
    mount({ params }) {
      const root = h('div', { class: 'hub' });
      const ribbonHost = h('div', { class: 'float tc hub-ribbon pe' });
      const today = h('section', { class: 'card today float tr' });
      const trivia = h('div', { class: 'float tr trivia-host pe' });
      // arriving to answer it (pill, hotbar badge) opens the card straight away
      let triviaOpen = params.trivia === true;
      const buildHost = h('div', { class: 'build-host' });
      // calm-ui: the Today card is replaced by the objective pill (its full list opens from there)
      root.append(ribbonHost, trivia, buildHost);
      let buildOpen: BuildItem | null = null;
      let triviaResult: { correct: boolean; bonus: number; q: number } | null = null;

      // ------------------------------------------------------------ ribbon
      function renderRibbon(s: GameState) {
        const remW = window.innerWidth / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
        if (rm().ribbonCollapsed || remW < 84) {
          // on a phone the full strip never fits: the button opens the Almanac's year instead
          put(ribbonHost, h('button', { type: 'button', class: 'ribbon-mini card', onclick: () => (isCompact() ? void app.go('almanac') : (setRm({ ribbonCollapsed: false }), renderRibbon(session.s))) }, icon(ICONS.almanac), `${monthName(s.date.mon)} ${s.date.year} · the year at a glance`));
          return;
        }
        put(ribbonHost, seasonRibbon(s, () => void app.go('almanac'), () => (setRm({ ribbonCollapsed: true }), renderRibbon(session.s))));
      }

      // ------------------------------------------------------------ today card
      function act(sg: Suggestion) {
        if (sg.go) return void app.go(sg.go);
        switch (sg.action) {
          case 'advance':
            return app.keys.advance?.();
          case 'mail':
            return openMail();
          case 'trivia':
            triviaOpen = true;
            return renderTrivia(session.s);
          case 'build': {
            const b = buildableItems(session.s)[0];
            if (b) openBuild(b);
            return;
          }
          case 'letter':
            return document.querySelector<HTMLButtonElement>('.letter-dock')?.click();
        }
      }

      function arrival(s: GameState) {
        if (s.date.year > 1880 || (s.date.year === 1880 && s.date.mon >= 11)) return null;
        const p = s.propet;
        const steps = [
          { t: 'Say hello to Longview', done: s.globals.firstTT === 1, go: () => void app.go('street') },
          { t: 'Let the neighbors raise your sod house', done: s.globals.houseStat !== 0, go: () => app.keys.advance?.() },
          { t: 'Buy seed at the General Store', done: p.seeds.some((x) => x > 0) || s.cursit.numPlanted > 0 || s.cursit.numHarved > 0, go: () => void app.go('store') },
          { t: 'Plow and plant', done: s.cursit.numPlanted > 0 || s.cursit.numHarved > 0 || s.cursit.firstHarv === 1, go: () => void app.go('field') },
          { t: 'Before winter: a barn and a well', done: p.barn === 1 && (p.windmill === 1 || p.extraWindmills > 0), go: () => (p.barn !== 1 ? openBuild('barn') : void app.go('store')) },
          { t: 'Let time pass', done: s.date.mon >= 7, go: () => app.keys.advance?.() },
        ];
        const next = steps.findIndex((x) => !x.done);
        return h(
          'div',
          { class: 'arrival' },
          h('div', { class: 'eyebrow' }, 'Arrival · spring 1880'),
          h('ol', null, ...steps.map((x, i) => {
            const li = h('li', { class: x.done ? 'done' : i === next ? 'next' : '' }, icon(x.done ? ICONS.check : i === next ? ICONS.next : ICONS.pin), h('span', null, x.t));
            if (i === next) li.append(btn('Go', { kind: 'go', small: true, onClick: x.go }));
            return li;
          })),
        );
      }

      function renderToday(s: GameState) {
        if (!today.isConnected) return;
        if (!rm().assists.todayCard) {
          put(today, h('button', { type: 'button', class: 'btn btn-link', onclick: () => setAssists({ todayCard: true }) }, 'Show tips'));
          today.classList.add('collapsed');
          return;
        }
        today.classList.remove('collapsed');
        const arr = arrival(s);
        // the Arrival checklist already covers these steps; don't say them twice
        const ARRIVAL_IDS = new Set(['hello', 'sod', 'build', 'seed', 'plow', 'plant']);
        const sg = todaySuggestions(s).filter((x) => !arr || !ARRIVAL_IDS.has(x.id)).slice(0, arr ? 2 : 4);
        put(
          today,
          h('div', { class: 'spread' }, h('h3', { class: 'card-title' }, 'What needs you'), h('span', { class: 'muted small num' }, dateLong(s.date))),
          arr,
          sg.length || arr
            ? h('ul', { class: 'today-list' }, ...sg.map((x) => {
                const li = h('li', null, h('span', null, x.text));
                const label = x.go ? goLabel(x.go) : x.action === 'advance' ? 'Advance' : x.action === 'mail' ? 'Open' : x.action === 'build' ? 'Build' : x.action === 'letter' ? 'Read' : x.action === 'trivia' ? 'Answer' : 'Go';
                const b = btn(label, { kind: 'ghost', small: true, onClick: () => act(x) });
                li.append(b);
                return li;
              }))
            : h('p', { class: 'muted small' }, 'All quiet. Press Advance when you’re ready; time stops by itself when something needs you.'),
          h('div', { class: 'today-foot' }, h('span', { class: 'muted tiny' }, 'Time stops by itself for letters, deadlines and disasters.'), btn('Hide tips', { kind: 'link', small: true, onClick: () => setAssists({ todayCard: false }) })),
        );
      }

      // ------------------------------------------------------------ labels + ghosts
      function renderLabels(s: GameState) {
        const L: Label[] = [];
        const field = badge.field(s);
        L.push({ target: { kind: 'place', place: 'field' }, text: 'Field', badge: field?.text, tone: field?.tone === 'urgent' ? 'urgent' : 'info' });
        if (s.propet.house > 0) L.push({ target: { kind: 'place', place: 'house' }, text: s.globals.whatHouse >= 3 ? 'House' : 'Sod house', badge: null });
        const st = badge.street(s);
        L.push({ target: { kind: 'place', place: 'mainStreet' }, text: 'Longview', sub: 'Main Street', badge: st?.text, tone: st?.tone === 'urgent' ? 'urgent' : 'info' });
        if (livestockMarketOpen(s)) L.push({ target: { kind: 'place', place: 'pen' }, text: 'Livestock fair', badge: 'Open', tone: 'good' });
        if (s.date.year > 1906 || (s.date.year === 1906 && s.date.mon >= 3) || s.globals.mail > 0)
          L.push({ target: { kind: 'mailbox' }, text: 'Mailbox', badge: s.globals.mail > 0 ? 'Letter!' : unreadMail() ? String(unreadMail()) : null, tone: s.globals.mail > 0 ? 'urgent' : 'info', onClick: openMail });
        const builds = s.globals.houseStat === 0 ? [] : buildableItems(s);
        app.world.setGhosts(builds.map((item) => ({ kind: 'build', item }) as PickTarget));
        for (const item of builds) L.push({ target: { kind: 'build', item }, text: `Build: ${BUILD_INFO[item].name}`, tone: 'ghost', sub: s.date.mon >= 3 && s.date.mon <= 10 ? 'click to plan' : 'from March', onClick: () => openBuild(item) });
        app.setLabels(L);
      }

      function openMail() {
        const s = session.s;
        // no new mail: the mailbox keeps the letters you already have (the same sheet as the top-bar mail button)
        if (s.globals.mail <= 0) return void app.go('mailbox', { tab: 'letters' });
        audio.sfx('mailbox');
        soundCaption('[mailbox creaks]');
        session.run({ type: 'openMail' }, 'Opened the mail');
      }

      // ------------------------------------------------------------ build card
      function openBuild(item: BuildItem) {
        buildOpen = item;
        renderBuild(session.s);
      }
      function renderBuild(s: GameState) {
        if (!buildOpen || !buildableItems(s).includes(buildOpen)) {
          buildOpen = null;
          put(buildHost);
          today.hidden = false;
          return;
        }
        today.hidden = true;
        const item = buildOpen;
        const info = BUILD_INFO[item];
        const d = drawer({ title: `Build: ${info.name}`, eyebrow: 'Construction' });
        let helpers: Helpers = { workers: 0, neighbors: 0, family: 0 };
        const est = h('div', { class: 'callout est' });
        const go = btn('', { kind: 'go', wide: true, icon: 'hammer', onClick: () => doBuild() });
        const upd = () => {
          const e = buildEstimate(s, item, helpers);
          put(
            est,
            h('div', null, h('b', { class: 'num' }, plural(e.days, 'day')), ' → finished ', h('b', null, `${monthName(e.finish.mon, 'short')} ${e.finish.day}`)),
            h('div', null, 'Wages ', h('b', { class: 'num' }, money(e.cost)), helpers.workers ? h('span', { class: 'muted' }, ` (${helpers.workers} × $5)`) : h('span', { class: 'muted' }, ' — neighbors and family build for free')),
            e.finish.mon !== s.date.mon ? h('div', { class: 'small muted' }, `The calendar moves into ${monthName(e.finish.mon)}.`) : null,
          );
          go.querySelector('.btn-label')!.textContent = e.reason ? e.reason : `Build it (${plural(e.days, 'day')})`;
          go.disabled = !!e.reason || session.blocked;
          if (session.blocked) go.title = 'Answer the letter first.';
          // a way out of every "not now"
          put(fix,
            session.blocked ? btn('Read the letter', { kind: 'brass', small: true, icon: 'mail', onClick: () => document.querySelector<HTMLButtonElement>('.letter-dock')?.click() }) : null,
            e.reason && /cash/i.test(e.reason) ? h('div', { class: 'small' }, 'Slide Hired hands to 0: neighbors and family build for free. Or ', btn('get cash at the bank', { kind: 'link', small: true, onClick: () => void app.go('bank') }), '.') : null,
            e.reason && /cold/i.test(e.reason) ? h('div', { class: 'small muted' }, 'Building starts again in March. Press Advance to let the winter pass.') : null);
        };
        const fix = h('div', { class: 'fix-host' });
        const crew = crewPicker({ family: s.propet.familyWorkers, neighbors: 3, neighborsLabel: 'free: neighbors build for nothing in return', initial: { neighbors: 3, family: s.propet.familyWorkers }, wage: 5, wageLabel: '$5 each, for the whole job', base: buildEstimate(s, item, { workers: 0, neighbors: 0, family: 0 }).base, onChange: (hh) => ((helpers = hh), upd()) });
        d.body.append(h('div', { class: 'build-hero' }, icon(ICONS[info.icon], 'ico build-ico'), h('p', null, info.does)), crew.el, est, fix);
        d.foot.hidden = false;
        d.foot.append(go, btn('Not now', { kind: 'link', onClick: () => ((buildOpen = null), renderBuild(session.s)) }));
        upd();
        put(buildHost, d.el);
        if (!reducedMotion()) gsap.from(d.el, { x: 30, opacity: 0, duration: 0.25 });
        async function doBuild() {
          const before = session.s;
          app.setBusy(true);
          audio.sfx('hammer');
          soundCaption('[hammering and sawing]');
          const r = session.run({ type: 'build', item, helpers }, `Built the ${info.name.toLowerCase()}`);
          buildOpen = null;
          try {
            if (r.events.some((e) => e.type === 'built')) {
              const { worldViewOf } = await import('../core/worldview.ts');
              await app.world.playMonthPass(worldViewOf(r.state), reducedMotion() ? 0.1 : 0.8);
            }
          } finally {
            app.setBusy(false);
          }
          if (r.events.some((e) => e.type === 'built')) toast(`${info.name} built! It took ${plural(dayDiff(before, r.state), 'day')}.`, { icon: 'hammer', tone: 'good' });
          renderBuild(session.s);
        }
      }

      // ------------------------------------------------------------ trivia
      function renderTrivia(s: GameState) {
        const q = s.extra.triviaOpen ? s.extra.triviaQuestion : triviaResult?.q ?? 0;
        if (!q) return put(trivia);
        const data = getContent().trivia.questions.find((x) => x.n === q);
        if (!data) return put(trivia);
        if (triviaResult) {
          put(
            trivia,
            h('section', { class: `card trivia ${triviaResult.correct ? 'right' : 'wrong'}` },
              h('div', { class: 'eyebrow' }, 'Trivia card'),
              h('h3', { class: 'card-title' }, triviaResult.correct ? `Right! +${money(triviaResult.bonus)}` : 'Not quite'),
              h('p', { class: 'verbatim' }, data.explanation.text.trim()),
              btn('Pin it back', { kind: 'ghost', small: true, onClick: () => ((triviaResult = null), (triviaOpen = false), renderTrivia(session.s)) })),
          );
          return;
        }
        if (!triviaOpen) {
          // a card pinned to the porch post: one small tab until the player picks it up
          const tab = h('button', { type: 'button', class: 'trivia-tab', 'data-tip': 'A question about life on the frontier. Answer it right to win the prize. It stays until the end of the month.' }, icon(ICONS.book), h('span', null, h('b', null, 'Trivia card'), ' · answer a question'), chip(`Win ${money(data.bonus)}`, { icon: 'coin', tone: 'good' }), h('span', { class: 'trivia-open' }, 'Open'));
          tab.addEventListener('click', () => ((triviaOpen = true), renderTrivia(session.s)));
          return put(trivia, tab);
        }
        const card = h('section', { class: 'card trivia' },
          h('div', { class: 'spread' }, h('div', { class: 'eyebrow' }, 'Trivia card · pick an answer'), chip(`Win ${money(data.bonus)}`, { icon: 'coin', tone: 'good' }), btn('', { kind: 'plain', icon: 'close', small: true, title: 'Later (it stays on the porch this month)', onClick: () => ((triviaOpen = false), renderTrivia(session.s)) })),
          h('p', { class: 'trivia-q verbatim' }, data.question.text.trim()),
          h('div', { class: 'trivia-a' }, ...data.answers.map((a, i) => btn(a.text.trim(), { kind: 'ghost', cls: 'trivia-btn', onClick: () => {
            const r = session.run({ type: 'answerTrivia', answer: i + 1 }, 'Answered the trivia card');
            const ev = r.events.find((e) => e.type === 'triviaAnswered');
            if (ev && ev.type === 'triviaAnswered') {
              triviaResult = { correct: ev.correct, bonus: ev.bonus, q };
              audio.sfx(ev.correct ? 'coins' : 'paper');
              soundCaption(ev.correct ? '[coins jingle]' : '[paper rustles]');
            }
            renderTrivia(session.s);
          } }))),
          h('div', { class: 'tiny muted' }, 'Answers to some questions are in the newspapers.'));
        put(trivia, card);
      }

      function update(s: GameState) {
        renderRibbon(s);
        renderToday(s);
        renderLabels(s);
        renderTrivia(s);
        if (buildOpen) renderBuild(s);
      }

      if (typeof params.build === 'string') {
        const want = params.build === 'fence' ? (buildableItems(session.s).find((b) => b.endsWith('Fence')) ?? null) : (params.build as BuildItem);
        if (want) buildOpen = want;
      }
      const offTrivia = session.on('change', (_s, ev) => {
        if (ev.some((e) => e.type === 'trivia')) {
          triviaResult = null;
          triviaOpen = false;
          audio.sting('trivia-bell');
          soundCaption('[porch bell] A trivia card!');
        }
      });

      return {
        el: root,
        update,
        onPick(t) {
          if (t.kind === 'build') {
            openBuild(t.item);
            return true;
          }
          if (t.kind === 'mailbox') {
            openMail();
            return true;
          }
          if (t.kind === 'place' && t.place === 'pen' && !livestockMarketOpen(session.s)) {
            toast('The livestock fair comes in April and May.', { icon: 'pen' });
            return true;
          }
          return false;
        },
        onBack() {
          if (buildOpen) {
            buildOpen = null;
            renderBuild(session.s);
            return true;
          }
          return false;
        },
        destroy() {
          offTrivia();
          app.world.setGhosts([]);
          app.setLabels([]);
        },
      };
    },
  });
}

function goLabel(id: string) {
  return { field: 'Field', store: 'Store', street: 'Main Street', bank: 'Bank', elevator: 'Elevator', house: 'House', pen: 'Pen', goals: 'Goals', homestead: 'Go' }[id] ?? 'Go';
}

function dayDiff(a: GameState, b: GameState) {
  return (b.date.year - a.date.year) * 360 + (b.date.mon - a.date.mon) * 30 + (b.date.day - a.date.day);
}

/** The compact Almanac strip for the hub (the mockup's "year at a glance"). */
export function seasonRibbon(s: GameState, open: () => void, collapse?: () => void) {
  const st = monthStates();
  const months = h('div', { class: 'rb-months' }, ...MONTHS_SHORT.map((m, i) => h('div', { class: `rb-m st-${st[i]}${i + 1 === s.date.mon ? ' now' : ''}`, 'data-l': m[0].toUpperCase() }, m.toUpperCase())));
  const pct = (m: number, d = 0) => ((m - 1 + d) / 12) * 100;
  const band = (cls: string, a: number, b: number, label: string, title: string) => h('div', { class: `rb-band ${cls}`, style: { left: `${a}%`, width: `${b - a}%` }, 'data-tip': title }, label);
  const bands = h(
    'div',
    { class: 'rb-bands' },
    band('plow', pct(4), pct(5, 0.65), 'plow', 'Plow and plant from April until the summer heat (May 17–25)'),
    band('plow', pct(9), pct(10, 0.55), 'plow', 'Plow and plant from September until the first frost (Oct 14–25)'),
    band('harv w', pct(4), pct(6), 'w. wheat', 'Winter wheat sown last autumn is harvested in April and May'),
    band('harv', pct(9), pct(11), 'harvest', 'Harvest spring crops in September and October'),
    band('ripe', pct(6), pct(9), 'spring crops ripen', 'Spring crops ripen in June; you can harvest them from September 1'),
    h('div', { class: 'rb-now', style: { left: `${pct(s.date.mon, (s.date.day || 1) / 30)}%` } }),
  );
  const pins = almanacPins(s).filter((p) => p.year === s.date.year || (p.year === s.date.year + 1 && p.mon <= 3)).slice(0, 3);
  return h(
    'section',
    { class: 'card ribbon', tabindex: 0, 'aria-label': `The year at a glance, ${s.date.year}` },
    h('div', { class: 'spread' }, h('span', { class: 'eyebrow' }, `The year at a glance · ${s.date.year}`), h('span', { class: 'row' }, btn('Open Almanac', { kind: 'link', small: true, kbd: 'A', onClick: open }), collapse ? btn('', { kind: 'plain', icon: 'minus', cls: 'rb-collapse', title: 'Collapse', onClick: collapse }) : null)),
    months,
    bands,
    pins.length ? h('div', { class: 'rb-pins' }, ...pins.map((p) => h('span', { class: p.urgent ? 'urgent' : '' }, icon(ICONS.pin), `${p.text}`))) : h('div', { class: 'rb-pins muted' }, txtSafe()),
  );
}
const txtSafe = () => 'No deadlines pinned. Plant in spring, harvest in autumn.';
