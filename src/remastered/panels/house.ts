// The House (§5.9): the family home with labelled props (Ledger, Family Album, Savings box,
// Newspapers; the gramophone in the Developer's Cut), the savings box as ONE two-way slider,
// the family at a glance, and the original house hints behind "Ask a neighbor".
import '../styles/books.css';
import { gramophoneAvailable, newspaperIssues, reproduces, type GameState } from '../../sim/index.ts';
import { member } from '../../game/text.ts';
import type { PickTarget } from '../../world/api.ts';
import { portrait } from '../core/art.ts';
import { audio, resumeSceneMusic, syncScene } from '../core/audio.ts';
import { getAudioDirector } from '../../audio/index.ts';
import { h, icon, prose, put } from '../core/dom.ts';
import { money, monthName } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { rm, setRm } from '../core/settings.ts';
import { devcutContent, ensureDevcut } from '../core/text.ts';
import { mountGramophone } from '../devcut/index.ts';
import { badge, unavailable } from '../ui/badges.ts';
import { btn, drawer, tabs, toast } from '../ui/kit.ts';
import { isCompact, liftToFoot } from '../ui/compact.ts';
import { familyRoster } from './ledger.ts';
import { savingsHint, savingsRule } from '../core/simapi.ts';
import type { PanelEnv } from './index.ts';

const HOUSE_NAME = ['', 'The sod house', 'The furnished sod house', 'The wooden house'];
const prop = (id: string): PickTarget => ({ kind: 'prop', id });

/** The four original house hints (HOUSE1 "Hints", verbatim): ledger, newspapers, album, savings. */
function houseHints(): string[] {
  const raw = (member('Hints', 'HOUSE1') ?? '').replace(/\r/g, '');
  const body = raw.split('\n').slice(1).join('\n');
  return body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'house',
    title: (s) => HOUSE_NAME[s?.globals.whatHouse ?? 1] ?? 'House',
    kind: 'place',
    place: 'house',
    parent: 'homestead',
    available: (s) => unavailable.house(s),
    hotbar: { key: '3', label: 'House', icon: ICONS.house, order: 30, group: 'place', badge: (s) => badge.house(s), disabled: (s) => unavailable.house(s) },
    mount({ params }) {
      const d = drawer({ title: 'Home', eyebrow: '' });
      if (params.focus === 'savings') queueMicrotask(() => requestAnimationFrame(() => d.body.querySelector('.savings')?.scrollIntoView({ block: 'start' })));
      let hintsOn = false;
      // phones: three short pages (the house, the savings box, the family) instead of one long scroll
      let pane: 'home' | 'savings' | 'family' = params.focus === 'savings' ? 'savings' : 'home';
      const showSavings = () => {
        if (isCompact()) {
          pane = 'savings';
          render(session.s);
        } else d.body.querySelector('.savings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      let box = session.s.propet.savings;
      let gramUnmount: (() => void) | null = null;
      let recordPlaying = false;
      const gramHost = h('div', { class: 'gram-host', hidden: true });
      d.el.append(gramHost);

      if (!session.blocked && session.s.propet.house > 0) session.run({ type: 'enterHouse' }, 'Came home');
      // HOUSE3MUSIC (ui quirk): the 1996 wooden house never restarted the house music; keep the outdoor cue.
      if (session.s.globals.whatHouse === 3 && reproduces(session.s.fidelity, 'HOUSE3MUSIC')) window.setTimeout(() => syncScene('homestead', session.state), 0);
      void ensureDevcut(session.s);

      const hints = houseHints();
      const hint = (i: number) => (hintsOn && hints[i] ? h('div', { class: 'house-hint' }, icon(ICONS.help), prose(hints[i], 'prose verbatim small')) : null);

      function openGramophone() {
        const dc = devcutContent();
        if (!dc) return toast('The gramophone is being wound up. Try again in a moment.', { icon: 'volume' });
        gramHost.hidden = false;
        gramUnmount?.();
        gramUnmount = mountGramophone(gramHost, dc, {
          volume: rm().music,
          finaleHeard: session.journal.talks.includes(120),
          onVolume: (v) => setRm({ music: v }),
          onRecord: (rec, src) => {
            if (src.url) {
              const a = new Audio(src.url);
              a.volume = rm().music * rm().master;
              void a.play().catch(() => undefined);
            } else if (src.music) {
              recordPlaying = true;
              getAudioDirector().playMusic(src.music);
            }
            toast(`On the gramophone: ${rec.title}`, { icon: 'volume' });
          },
          onClose: () => {
            // the record was an override only while the gramophone played: back to the house's rotation
            if (recordPlaying) resumeSceneMusic('house', session.state);
            recordPlaying = false;
            gramUnmount?.();
            gramUnmount = null;
            gramHost.hidden = true;
          },
        });
      }

      function savingsCard(s: GameState) {
        const p = s.propet;
        const total = Math.floor((p.cash + p.savings) * 100) / 100;
        box = Math.min(box, total);
        const pocketV = h('b', { class: 'num' });
        const boxV = h('b', { class: 'num' });
        const pocketStack = h('div', { class: 'coins pocket' });
        const boxStack = h('div', { class: 'coins box' });
        const range = h('input', { type: 'range', min: '0', max: String(Math.floor(total)), step: '1', value: String(Math.round(box)), 'aria-label': 'Money in the savings box' }) as HTMLInputElement;
        const exact = h('input', { type: 'text', inputMode: 'decimal', class: 'exact', 'aria-label': 'Exact amount in the box' }) as HTMLInputElement;
        const apply = btn('', { kind: 'go', icon: 'box' });
        const stack = (el: HTMLElement, v: number) => put(el, ...Array.from({ length: Math.min(12, Math.ceil(v / Math.max(25, total / 12))) }, () => h('i')));
        const sync = (fromExact = false) => {
          const pocket = total - box;
          pocketV.textContent = money(pocket, { cents: true });
          boxV.textContent = money(box, { cents: true });
          if (!fromExact) exact.value = String(Math.round(box * 100) / 100);
          stack(pocketStack, pocket);
          stack(boxStack, box);
          const diff = Math.round((box - p.savings) * 100) / 100;
          const label = apply.querySelector('.btn-label')!;
          if (Math.abs(diff) < 0.01) {
            label.textContent = 'Move the slider';
            apply.disabled = true;
          } else {
            label.textContent = diff > 0 ? `Put ${money(diff, { cents: true })} in the box` : `Take ${money(-diff, { cents: true })} out`;
            apply.disabled = false;
          }
        };
        range.addEventListener('input', () => {
          box = Number(range.value);
          sync();
        });
        exact.addEventListener('input', () => {
          const v = Number(exact.value.replace(/[^0-9.]/g, ''));
          if (Number.isFinite(v)) {
            box = Math.max(0, Math.min(total, v));
            range.value = String(Math.round(box));
            sync(true);
          }
        });
        apply.addEventListener('click', () => {
          const diff = Math.round((box - p.savings) * 100) / 100;
          if (!diff) return;
          const r = diff > 0 ? session.run({ type: 'depositSavings', amount: Math.min(diff, session.s.propet.cash) }, `Put ${money(diff, { cents: true })} in the savings box`) : session.run({ type: 'withdrawSavings', amount: Math.min(-diff, session.s.propet.savings) }, `Took ${money(-diff, { cents: true })} from the savings box`);
          if (!r.events.some((e) => e.type === 'rejected' || e.type === 'dialog')) {
            audio.sfx('coin');
            toast(diff > 0 ? `Tucked ${money(diff, { cents: true })} under the bed.` : `Took ${money(-diff, { cents: true })} from the box.`, { icon: 'box', tone: 'good', quiet: true });
          }
        });
        sync();
        return h('section', { class: 'savings' },
          h('h3', { class: 'alm-h' }, icon(ICONS.box), 'The savings box'),
          hint(3),
          h('div', { class: 'sv-row' },
            h('div', { class: 'sv-side' }, h('span', { class: 'small muted' }, 'In your pocket'), pocketV, pocketStack),
            h('div', { class: 'sv-side right' }, h('span', { class: 'small muted' }, 'In the box'), boxV, boxStack)),
          range,
          h('div', { class: 'sv-exact phone-foot' }, h('label', { class: 'small' }, 'Exactly $', exact), apply),
          h('p', { class: 'small muted' }, savingsRule(s)),
          savingsHint(s) ? h('div', { class: 'callout' }, icon(ICONS.help), ' ', savingsHint(s)) : null);
      }

      function render(s: GameState) {
        const p = s.propet;
        const n = newspaperIssues(s);
        put(d.head, h('div', { class: 'eyebrow' }, `${monthName(s.date.mon)} ${s.date.year}`), h('h2', { class: 'drawer-title' }, HOUSE_NAME[s.globals.whatHouse] ?? 'Home'),
          isCompact() ? tabs<typeof pane>({ tabs: [{ id: 'home', label: 'The house' }, { id: 'savings', label: 'Savings box' }, { id: 'family', label: 'Family' }], value: pane, onChange: (v) => ((pane = v), render(session.s)) }).el : null);
        const things = h('div', { class: 'house-things' },
          // phones: the box under the bed can hide behind this card, so it gets a button of its own
          h('button', { type: 'button', class: 'thing thing-savings', onclick: showSavings }, icon(ICONS.box), h('b', null, 'Savings box'), h('span', { class: 'small muted' }, money(p.savings))),
          h('button', { type: 'button', class: 'thing', onclick: () => void app.go('ledger') }, icon(ICONS.ledger), h('b', null, 'The Ledger'), h('span', { class: 'small muted' }, `${s.logbook.length} entries`)),
          h('button', { type: 'button', class: 'thing', onclick: () => void app.go('album') }, icon(ICONS.album), h('b', null, 'Family Album'), h('span', { class: 'small muted' }, 'diary & keepsakes')),
          h('button', { type: 'button', class: 'thing', disabled: n === 0, 'data-tip': n ? '' : 'The first Gazette comes out in August 1880.', onclick: () => void app.go('newspaper') }, icon(ICONS.news), h('b', null, 'Newspapers'), h('span', { class: 'small muted' }, n ? `${n} ${n === 1 ? 'issue' : 'issues'}` : 'none yet')),
          gramophoneAvailable(s) ? h('button', { type: 'button', class: 'thing', onclick: openGramophone }, icon(ICONS.volume), h('b', null, 'Gramophone'), h('span', { class: 'small muted' }, 'play a record')) : null);
        const fam = familyRoster(s);
        const family = h('section', { class: 'fam-mini' },
            h('h3', { class: 'alm-h' }, icon(ICONS.people), 'The family'),
            h('div', { class: 'fam-row' }, ...fam.map((m) => {
              const por = m.dbox ? portrait(m.dbox) : null;
              return h('button', { type: 'button', class: 'fam-m', title: m.who, onclick: () => void app.go('ledger', { tab: 'family' }) }, por ? h('div', { class: 'portrait', style: { backgroundImage: `url("${por}")` } }) : h('div', { class: 'portrait you' }, icon(ICONS.people)), h('span', { class: 'small' }, m.name.split(' ')[0]), m.age !== null ? h('span', { class: 'tiny muted' }, m.age <= 0 ? 'baby' : `${m.age} yrs`) : null);
            })),
            p.stove ? h('p', { class: 'small' }, icon(ICONS.kettle), ' The cooking stove keeps the family warm and healthy.') : null,
            h('p', { class: 'small muted' }, `Upkeep ${money(p.lifePrice)} a month · ${p.familyWorkers} family ${p.familyWorkers === 1 ? 'helper' : 'helpers'} in the field`));
        if (isCompact()) put(d.body, ...(pane === 'savings' ? [savingsCard(s)] : pane === 'family' ? [family] : [things, hint(0), hint(1), hint(2)]));
        else put(d.body, things, hint(0), hint(1), hint(2), savingsCard(s), family);
        d.foot.hidden = isCompact() && pane !== 'home';
        put(d.foot, btn(hintsOn ? 'Hide the neighbor’s tips' : 'Ask a neighbor', { kind: 'ghost', small: true, icon: 'help', onClick: () => ((hintsOn = !hintsOn), render(session.s)) }));
        liftToFoot(d.body, d.foot);
        app.setLabels([
          { target: prop('ledger'), text: 'Ledger', onClick: () => void app.go('ledger') },
          { target: prop('album'), text: 'Family Album', onClick: () => void app.go('album') },
          { target: prop('savings'), text: 'Savings box', sub: money(p.savings), onClick: showSavings },
          ...(n ? [{ target: prop('newspaper'), text: 'Newspapers', badge: n > session.journal.papers.length ? 'new' : null, onClick: () => void app.go('newspaper') }] : []),
          ...(gramophoneAvailable(s) ? [{ target: prop('gramophone'), text: 'Gramophone', onClick: openGramophone }] : []),
        ]);
      }
      const el = h('div', { class: 'house-panel' }, d.el);
      return {
        el,
        update: (s) => {
          if (d.body.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT') return;
          box = s.propet.savings;
          render(s);
        },
        destroy: () => {
          gramUnmount?.();
          if (recordPlaying) resumeSceneMusic(app.placeId, session.state);
        },
        onPick: (t) => {
          if (t.kind !== 'prop') return false;
          if (t.id === 'ledger') void app.go('ledger');
          else if (t.id === 'album') void app.go('album');
          else if (t.id === 'newspaper' && newspaperIssues(session.s)) void app.go('newspaper');
          else if (t.id === 'gramophone' && gramophoneAvailable(session.s)) openGramophone();
          else if (t.id === 'savings') showSavings();
          else return false;
          return true;
        },
      };
    },
  });
}
