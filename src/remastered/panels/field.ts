// The Field (§5.2): verb palette with reasons before you click, paint-select squares in 3D
// (mirrored by a keyboard-friendly square map), the job card with crew sliders and a live
// estimate, the crop picker with yield outlook, the time-lapse, and the harvest receipt.
import { grainQuote, reproduces, type Crop, type GameState, type Helpers, type Planting, type SimEvent } from '../../sim/index.ts';
import { YIELD_CORN, YIELD_OATS, YIELD_WHEAT } from '../../sim/data/tables.ts';
import type { PickTarget } from '../../world/api.ts';
import { h, icon, put } from '../core/dom.ts';
import { CROP_NAMES, money, monthName, num, plural } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { reducedMotion, rm, SPEED_SECONDS } from '../core/settings.ts';
import { cropState, fieldStatus, jobEstimate, sowable, SOW_WINDOW, squares, yieldOutlook, type SquareInfo, type Verb } from '../core/simapi.ts';
import { T } from '../core/text.ts';
import { worldViewOf } from '../core/worldview.ts';
import { audio, soundCaption } from '../core/audio.ts';
import { badge } from '../ui/badges.ts';
import { btn, drawer, toast } from '../ui/kit.ts';
import { quietDialogs } from '../ui/overlays.ts';
import { crewPicker } from './crew.ts';
import type { PanelEnv } from './index.ts';
import '../styles/field.css';
import { isCompact, isTouch } from '../ui/compact.ts';

const VERBS: { id: Verb; label: string; icon: keyof typeof ICONS; ing: string }[] = [
  { id: 'plow', label: 'Plow', icon: 'plow', ing: 'plowing' },
  { id: 'plant', label: 'Plant', icon: 'seed', ing: 'planting' },
  { id: 'harvest', label: 'Harvest', icon: 'scythe', ing: 'harvesting' },
];
const CROPS: Crop[] = [2, 3, 4, 1];
/** What a square is, in words the 3D view and the map agree on ("Spring wheat, growing, ripens in June"). */
function sqLabel(s: GameState, q: SquareInfo): string {
  if (!q.owned) return 'part of the 1909 land claim';
  const crop = q.crop ? `${CROP_NAMES[q.crop]}, ` : '';
  if (q.ripe) return `${crop}${cropState(s).square}`;
  if (q.planted) {
    const spring = q.crop !== 1;
    const word = q.stage === 'planted' ? 'sown' : q.stage === 'sprout' ? 'sprouting' : 'growing';
    return `${crop}${word}, ${spring ? 'ripens in June' : 'harvest next April'}`;
  }
  if (q.stage === 'plowed') return 'plowed, ready for seed';
  if (q.stage === 'prairie') return 'prairie grass: plow it first';
  return `${crop}${STAGE_LABEL[q.stage] ?? q.stage}`;
}
const STAGE_LABEL: Record<string, string> = { prairie: 'prairie grass', plowed: 'plowed', planted: 'sown', sprout: 'sprouting', growing: 'growing', ripe: 'ripe', stubble: 'stubble', burnt: 'burnt', trampled: 'trampled', eaten: 'eaten', frost: 'frost-killed' };

export function register(env: PanelEnv) {
  const { app } = env;
  registerPanel({
    id: 'field',
    title: 'Field',
    kind: 'place',
    place: 'field',
    parent: 'homestead',
    hotbar: { key: '2', label: 'Field', icon: ICONS.field, order: 20, group: 'place', badge: (s) => badge.field(s) },
    mount() {
      if (!session.blocked) session.run({ type: 'enterField' }, 'Visited the field');
      const root = h('div', { class: 'fieldp' });
      const verbsEl = h('section', { class: 'card verbs float tl' });
      const d = drawer({ title: 'Field work', eyebrow: 'Job card' });
      d.el.classList.add('jobcard');
      root.append(verbsEl, d.el);

      /** null = no job picked: the card shows the field's state (and what was just done) */
      let verb: Verb | null = null;
      let chosen = false;
      /** the last finished job, said once, calmly, with what comes next (not a modal, no verb switch) */
      let done: { text: string; next: string; act?: { label: string; icon: keyof typeof ICONS; run: () => void } } | null = null;
      const prefs = () => (session.journal.fieldPrefs ??= {});
      const sel = new Set<number>();
      const plantMap = new Map<number, Crop>();
      let crop: Crop = 2;
      let helpers: Helpers = { workers: 0, neighbors: 0, family: 0 };
      /** the crew last used for a job, remembered per job (calm-ui: no re-sliding every time) */
      // phones: with no crew remembered for a job, the whole family turns out (free); neighbors and hands stay opt-in
      const crewFor = (v: Verb): Helpers => (v === 'plant' ? helpers : { ...{ workers: 0, neighbors: 0, family: isCompact() ? 99 : 0 }, ...(prefs().crew?.[v] ?? {}) });
      let breakChoice: 'repair' | 'newSteel' = 'repair';
      let dragMode: boolean | null = null;
      /** the square under the pointer in 3D (mirrored on the map, named in a small tip) */
      let hovered = 0;
      const sqTip = h('div', { class: 'sq-tip', hidden: true });
      root.append(sqTip);
      const ptr = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        ptr.x = e.clientX;
        ptr.y = e.clientY;
        if (!sqTip.hidden) placeTip();
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      const placeTip = () => {
        sqTip.style.transform = `translate(${Math.round(ptr.x + 14)}px, ${Math.round(ptr.y + 16)}px)`;
      };
      let working = false;
      /** the last harvest's receipt, shown at the top of the job card until the next job (not a modal) */
      let lastReceipt: HTMLElement | null = null;
      const up = () => (dragMode = null);
      window.addEventListener('pointerup', up);

      const s0 = () => session.s;
      const sq = () => squares(s0());

      function eligible(q: SquareInfo, v: Verb | null = verb) {
        if (!q.owned || !v) return false;
        if (v === 'plow') return !q.plowed && !q.planted && !q.ripe && s0().cursit.plow[q.n - 1] === 0;
        if (v === 'plant') return q.plowed && !q.planted && !q.ripe;
        return q.ripe;
      }

      function pickVerb(s: GameState) {
        if (chosen) return;
        const st = fieldStatus(s);
        const free = CROPS.find((c) => s.propet.seeds[c - 1] >= 20 && sowable(s, c));
        if (free) crop = free;
        // open on the job there is to do; with nothing to do, show the field as it is (no verb)
        const v: Verb | null = st.harvest.ok ? 'harvest' : st.plant.ok && sq().some((q) => eligible(q, 'plant')) ? 'plant' : st.plow.ok && sq().some((q) => eligible(q, 'plow')) ? 'plow' : null;
        chosen = true;
        if (v) choose(v);
      }

      /** pick a job and pre-select the sensible squares and crew for it */
      function choose(v: Verb) {
        verb = v;
        sel.clear();
        plantMap.clear();
        helpers = crewFor(v);
        if (v === 'harvest') sq().filter((q) => q.ripe).forEach((q) => sel.add(q.n));
        else if (v === 'plant') fillPlant();
        else (prefs().plow ?? []).forEach((n) => sq()[n - 1] && eligible(sq()[n - 1], 'plow') && sel.add(n));
      }

      /** every plowed square, with the chosen seed first and then any other seed in season */
      function fillPlant() {
        const s = s0();
        const left = new Map<Crop, number>(CROPS.map((c) => [c, sowable(s, c) ? Math.floor(s.propet.seeds[c - 1] / 20) : 0]));
        const order = [crop, ...CROPS.filter((c) => c !== crop)];
        for (const q of sq()) {
          if (!eligible(q, 'plant')) continue;
          const c = order.find((x) => (left.get(x) ?? 0) > 0);
          if (!c) break;
          left.set(c, left.get(c)! - 1);
          plantMap.set(q.n, c);
          sel.add(q.n);
        }
      }

      /** the last plow or plant job, again */
      function sameAsLast() {
        if (verb === 'plant') {
          sel.clear();
          plantMap.clear();
          const s = s0();
          const left = new Map<Crop, number>(CROPS.map((c) => [c, sowable(s, c) ? Math.floor(s.propet.seeds[c - 1] / 20) : 0]));
          for (const [n, c] of prefs().plant ?? []) {
            const q = sq()[n - 1];
            if (!q || !eligible(q, 'plant') || !(left.get(c as Crop) ?? 0)) continue;
            left.set(c as Crop, left.get(c as Crop)! - 1);
            plantMap.set(n, c as Crop);
            sel.add(n);
          }
        } else if (verb === 'plow') {
          sel.clear();
          (prefs().plow ?? []).forEach((n) => sq()[n - 1] && eligible(sq()[n - 1], 'plow') && sel.add(n));
        }
        if (verb) helpers = crewFor(verb);
        render(s0());
      }

      function setVerb(v: Verb) {
        lastReceipt = null;
        done = null;
        chosen = true;
        choose(v);
        render(s0());
      }

      function toggle(n: number, on?: boolean) {
        if (working || session.blocked) return;
        const q = sq()[n - 1];
        if (!q || !eligible(q)) {
          if (q && !q.owned) toast('Field 2 becomes yours with the 1909 land claim.', { icon: 'pin' });
          return;
        }
        if (verb === 'harvest') return;
        const want = on ?? !sel.has(n);
        if (verb === 'plant') {
          if (want) {
            const sacks = Math.floor(s0().propet.seeds[crop - 1] / 20) - [...plantMap.values()].filter((c) => c === crop).length;
            if (!sowable(s0(), crop)) return void toast(`${CROP_NAMES[crop]} is sown ${SOW_WINDOW[crop]}.`, { icon: 'seed' });
            if (sacks <= 0) return void toast(`No more ${CROP_NAMES[crop].toLowerCase()} seed. Buy sacks at the General Store.`, { icon: 'seed', action: { label: 'Store', onClick: () => void app.go('store') } });
            plantMap.set(n, crop);
            sel.add(n);
          } else {
            plantMap.delete(n);
            sel.delete(n);
          }
        } else if (want) sel.add(n);
        else sel.delete(n);
        render(s0());
      }

      // ------------------------------------------------------------ rendering
      function renderVerbs(s: GameState) {
        const st = fieldStatus(s);
        put(
          verbsEl,
          h('div', { class: 'verb-row', role: 'group', 'aria-label': 'Field work' }, ...VERBS.map((v) => {
            const status = st[v.id];
            const orig = status.dialog ? T(s, status.dialog).text : '';
            const b = h('button', { type: 'button', class: `verb${verb === v.id ? ' on' : ''}${status.ok ? '' : ' off'}`, 'aria-pressed': String(verb === v.id), 'data-tip': status.ok ? '' : `“${orig.replace(/\s+/g, ' ').trim()}”` }, icon(ICONS[v.icon], 'ico verb-ico'), h('span', { class: 'verb-l' }, v.label), h('span', { class: 'verb-s' }, status.ok ? verbHint(s, v.id) : status.reason ?? 'Not now'));
            b.addEventListener('click', () => setVerb(v.id));
            return b;
          })),
          // phones: the job card is a slim strip at the bottom, so the seed choice rides in this toolbar
          isCompact() && verb === 'plant' ? seedTray(s) : null,
        );
      }

      function verbHint(s: GameState, v: Verb) {
        const list = sq();
        if (v === 'plow') return `${list.filter((q) => eligible(q, 'plow')).length} squares of grass`;
        if (v === 'plant') {
          const sacks = s.propet.seeds.reduce((a, b) => a + Math.floor(b / 20), 0);
          return `${plural(sacks, 'sack')} of seed`;
        }
        return `${list.filter((q) => q.ripe).length} ripe squares`;
      }

      function squareMap(s: GameState) {
        const list = sq();
        const two = s.propet.numFields > 1;
        const grid = h('div', { class: 'sqmap', role: 'grid', 'aria-label': 'Field squares' });
        list.forEach((q) => {
          if (q.n === 9) grid.append(h('div', { class: 'sqmap-sep' }, two ? 'Field 2' : 'Field 2 comes with the free land claim of 1909'));
          if (!two && q.n > 8) return;
          const el = h('button', {
            type: 'button',
            class: `msq st-${q.stage}${sel.has(q.n) ? ' sel' : ''}${eligible(q) ? ' can' : ''}${q.owned ? '' : ' locked'}`,
            role: 'gridcell',
            'aria-pressed': String(sel.has(q.n)),
            'aria-label': `Square ${q.n}: ${sqLabel(s, q)}`,
            'data-n': String(q.n),
            'data-tip': `Square ${q.n}: ${sqLabel(s, q)}`,
          }, q.crop || plantMap.get(q.n) ? cropChip((plantMap.get(q.n) ?? q.crop) as Crop) : null);
          el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            dragMode = !sel.has(q.n);
            toggle(q.n, dragMode);
          });
          el.addEventListener('pointerenter', (e) => e.buttons & 1 && dragMode !== null && toggle(q.n, dragMode));
          if (hovered === q.n) el.classList.add('hov');
          el.addEventListener('keydown', (e) => {
            const i = q.n - 1;
            const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
            if (mv !== undefined) {
              e.preventDefault();
              (grid.querySelector(`[data-n="${Math.min(16, Math.max(1, i + 1 + mv))}"]`) as HTMLElement | null)?.focus();
            } else if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              toggle(q.n);
            }
          });
          grid.append(el);
        });
        return grid;
      }

      /** one swatch per state present in the field, in the same colors as the map (and the 3D crops) */
      function legend(s: GameState) {
        const present = new Map<string, string>();
        for (const q of sq()) if (q.owned) present.set(q.stage, q.ripe ? cropState(s).square : STAGE_LABEL[q.stage]);
        const crops = new Set(sq().filter((q) => q.owned && q.crop).map((q) => q.crop as Crop));
        return h('div', { class: 'sq-legend', 'aria-label': 'Key' },
          ...[...present].map(([st, label]) => h('span', { class: 'lg' }, h('i', { class: `msq-sw st-${st}` }), label)),
          ...[...crops].map((c) => h('span', { class: 'lg' }, cropChip(c), CROP_NAMES[c])));
      }

      function seedTray(s: GameState) {
        return h(
          'div',
          { class: 'seed-tray' },
          ...CROPS.map((c) => {
            const used = [...plantMap.values()].filter((x) => x === c).length;
            const sacks = Math.floor(s.propet.seeds[c - 1] / 20) - used;
            const ok = sowable(s, c);
            const b = h('button', { type: 'button', class: `sack c${c}${crop === c ? ' on' : ''}${!ok || sacks <= 0 ? ' off' : ''}`, 'data-tip': ok ? `${plural(sacks + used, 'sack')} in the barn: ${used} marked to plant, ${sacks} left · 1 sack plants 1 square` : `Sown ${SOW_WINDOW[c]}` }, cropChip(c), h('span', { class: 'sack-n' }, CROP_NAMES[c]), h('span', { class: 'sack-c num' }, ok ? (used ? `${used} marked · ${sacks} left` : `${sacks} ${sacks === 1 ? 'sack' : 'sacks'}`) : SOW_WINDOW[c]));
            b.addEventListener('click', () => {
              crop = c;
              render(s0());
            });
            return b;
          }),
        );
      }

      /** one-click way out of a "not now": where to go or what to do instead (calm-ui: no dead ends) */
      function fixFor(s: GameState, dialog: string | undefined, reason: string | undefined): { label: string; icon: keyof typeof ICONS; run: () => void } | null {
        const st = fieldStatus(s);
        const goTo = (id: string, label: string, ic: keyof typeof ICONS, params: Record<string, unknown> = {}) => ({ label, icon: ic, run: () => void app.go(id, params) });
        switch (dialog) {
          case 'NoPlant1':
          case 'NoPlant5':
            return goTo('store', 'Buy seed at the General Store', 'store');
          case 'NoPlant2':
          case 'NoPlant3':
            return st.plow.ok ? { label: 'Plow squares first', icon: 'plow', run: () => setVerb('plow') } : null;
          case 'NoPlow5':
          case 'NoPlant4':
            return st.harvest.ok ? { label: 'Harvest first', icon: 'scythe', run: () => setVerb('harvest') } : null;
          case 'NoM2':
            return goTo('house', 'Take money from the savings box', 'box', { focus: 'savings' });
          case 'NoM3':
            return goTo('elevator', 'Sell grain at the elevator', 'elevator');
          case 'NoM1':
          case 'NoM4':
          case 'NoM6':
            return goTo('bank', 'Ask the bank for a loan', 'bank');
        }
        if (reason === 'Answer the letter first.') return { label: 'Read the letter', icon: 'mail', run: () => document.querySelector<HTMLButtonElement>('.letter-dock')?.click() };
        return null;
      }

      function fixBtn(f: ReturnType<typeof fixFor>) {
        return f ? btn(f.label, { kind: 'brass', small: true, icon: f.icon, onClick: f.run }) : null;
      }

      function renderJob(s: GameState) {
        if (!verb) return renderOverview(s);
        const st = fieldStatus(s)[verb];
        const v = VERBS.find((x) => x.id === verb)!;
        const n = sel.size;
        d.head.querySelector('.drawer-title')!.textContent = n ? `${v.label} ${plural(n, 'square')} · ${num(n * 20)} acres` : `${v.label}`;
        const body: (HTMLElement | null)[] = [];
        const estEl = h('div', { class: 'est-host' });
        let ready = false;
        if (!st.ok) body.push(h('div', { class: 'callout warn' }, h('b', null, st.reason ?? 'Not now.'), st.dialog ? h('div', { class: 'small verbatim' }, `“${T(s, st.dialog).text.replace(/\s+/g, ' ').trim()}”`) : null, fixBtn(fixFor(s, st.dialog, st.reason))));
        const last = verb === 'plow' ? (prefs().plow ?? []) : verb === 'plant' ? (prefs().plant ?? []).map(([n]) => n) : [];
        const same = last.length && last.join(',') !== [...sel].sort((a, b) => a - b).join(',') ? h('button', { type: 'button', class: 'btn btn-link btn-sm same-last' }, `Same as last time (${plural(last.length, 'square')})`) : null;
        same?.addEventListener('click', sameAsLast);
        body.push(h('div', { class: 'small muted map-hint' }, verb === 'harvest' ? 'All ripe squares are harvested together.' : `${verb === 'plant' ? 'Every plowed square is marked with seed you have. ' : ''}${isTouch() ? 'Tap or drag' : 'Click or drag'} across squares to change it. Each square is 20 acres.`, same ? ' ' : null, same));
        body.push(squareMap(s), legend(s));
        if (verb === 'plant') body.push(h('div', { class: 'eyebrow' }, 'Seed'), seedTray(s));
        let est: ReturnType<typeof jobEstimate> | null = null;
        const sess = s.sessions.field;
        if (verb !== 'plant') {
          const base = s.propet.tractors > 0 ? 2 : 6;
          const nb = sess?.neighbors ?? 0;
          const jobVerb = verb;
          body.push(h('div', { class: 'eyebrow' }, `Crew · ${s.propet.tractors > 0 ? 'steam tractor: 2 days a square' : 'horse team: 6 days a square'}`));
          body.push(crewPicker({ family: s.propet.familyWorkers, neighbors: nb, neighborsNote: s.cursit.goodwill > 0 ? `Neighbors are cool toward you since you turned down their call for help. They help again from ${s.cursit.goodwill === 1 ? (s.date.mon >= 6 && s.date.mon < 11 ? 'next June' : 'November') : s.date.mon >= 6 && s.date.mon < 11 ? 'November' : 'June'}.` : null, neighborsLabel: 'free, but they will want help back', wage: sess?.wage ?? 5, base, initial: helpers, onChange: (hh) => { helpers = hh; if (ready) { (prefs().crew ??= {})[jobVerb] = { ...hh }; renderEstimate(); } } }).el);
          body.push(neighborDebtLine(s));
        }
        body.push(estEl);
        if (verb === 'plow' && s.propet.tractors === 0) {
          const radio = (val: typeof breakChoice, label: string) => {
            const r = h('input', { type: 'radio', name: 'brk', checked: breakChoice === val }) as HTMLInputElement;
            r.addEventListener('change', () => (breakChoice = val));
            return h('label', null, r, ' ', label);
          };
          body.push(h('div', { class: 'eyebrow' }, 'If the plow breaks'), h('div', { class: 'radio-row' }, radio('repair', `Repair it (+10 days${s.fidelity.mode === 'classic' ? ', $10' : ', free'})`), radio('newSteel', 'Buy new steel ($50)')));
        }
        // yield outlook
        if (verb === 'plant' && plantMap.size) {
          const counts = new Map<Crop, number>();
          plantMap.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
          const rows = [...counts].map(([c, k]) => outlookRow(s, c, k));
          body.push(h('div', { class: 'eyebrow' }, 'Yield outlook'), ...rows, h('div', { class: 'tiny muted' }, 'A range, not a promise: land and luck decide the rest. Prices are set at harvest.'));
        }
        if (verb === 'harvest') {
          const yo = yieldOutlook(s);
          if (yo.length) body.push(h('div', { class: 'eyebrow' }, 'Expected harvest'), ...yo.map((y) => h('div', { class: 'outlook' }, cropChip(y.crop), h('span', null, `${CROP_NAMES[y.crop]}: about `, h('b', { class: 'num' }, `${num(y.min)}–${num(y.max)} bu`)))));
        }
        if (lastReceipt && !s.cursit.bushels.some((b) => b > 0)) lastReceipt = null;
        put(d.body, lastReceipt, ...body);
        // foot
        d.foot.hidden = false;
        const start = btn('', { kind: 'go', wide: true, icon: v.icon, onClick: () => void startJob() });
        const fixHost = h('span', { class: 'fix-host' });
        put(d.foot, start, fixHost, sel.size && verb !== 'harvest' ? btn('Clear', { kind: 'link', small: true, onClick: () => { sel.clear(); plantMap.clear(); render(s0()); } }) : null);
        function renderEstimate() {
          if (verb === 'plant') {
            put(estEl, n ? h('div', { class: 'callout' }, `Planting takes no time and no money. ${plural(n, 'sack')} of seed will be used.`) : null);
            setStart();
            return;
          }
          const count = verb === 'harvest' ? s.cursit.numHarved : n;
          if (!count) {
            put(estEl);
            setStart();
            return;
          }
          est = jobEstimate(s, verb!, count, helpers, verb === "plow" ? [...sel] : undefined);
          const wageMath = helpers.workers ? h('span', { class: 'muted' }, ` (${helpers.workers} × ${money(est.wage)} × ${est.days} days)`) : h('span', { class: 'muted' }, ' — no hired hands');
          put(
            estEl,
            h('div', { class: 'callout est' },
              h('div', null, h('b', { class: 'num big' }, plural(est.days, 'day')), ' → finish ', h('b', null, `${monthName(est.finish.mon, 'short')} ${est.finish.day}`), est.monthsCrossed ? h('span', { class: 'muted' }, ` · into ${monthName(est.finish.mon)}`) : null),
              h('div', null, 'Wages ', h('b', { class: 'num' }, money(est.wages)), wageMath),
              helpers.neighbors ? h('div', { class: 'small' }, `Help you'll owe your neighbors after this: ${Math.min(3, est.debtAfter)} of 3${est.debtAfter >= 3 ? '. At 3, a neighbor asks you for 7–10 days of help next April or September.' : ''}`) : null,
              est.weatherRisk === 'summer' ? h('div', { class: 'warn-t small' }, '⚠ Summer heat may stop work after about May 17–25.') : null,
              est.weatherRisk === 'frost' ? h('div', { class: 'warn-t small' }, '⚠ Frost may stop work after about October 14–25.') : null,
              !est.affordable ? h('div', { class: 'bad small' }, `Not enough cash for those wages (${money(s.propet.cash, { cents: true })}).`) : null,
            ),
          );
          setStart();
        }
        function setStart() {
          const label = start.querySelector('.btn-label')!;
          let why: string | null = null;
          let fix: ReturnType<typeof fixFor> = null;
          if (app.busy) why = 'Time is passing…';
          else if (session.blocked) (why = 'Answer the letter first.'), (fix = fixFor(s, undefined, why));
          else if (!st.ok) (why = st.reason ?? 'Not now'), (fix = fixFor(s, st.dialog, st.reason));
          else if (verb !== 'harvest' && !n) why = verb === 'plow' ? 'Mark squares to plow' : sq().some((q) => eligible(q, 'plant')) ? 'Mark squares to plant' : 'No plowed squares to plant';
          else if (est && !est.affordable && verb !== 'plant') (why = 'Not enough cash for those wages'), (fix = helpers.workers ? { label: 'No hired hands', icon: 'people', run: () => ((helpers = { ...helpers, workers: 0 }), (prefs().crew ??= {})[verb as 'plow' | 'harvest'] = { ...helpers }, render(s0())) } : fixFor(s, 'NoM4', undefined));
          start.disabled = !!why;
          label.textContent = why ?? (verb === 'plant' ? `Plant ${plural(n, 'square')}` : `Start ${v.ing}${est ? ` · ${plural(est.days, 'day')}${est.wages ? ` · ${money(est.wages)}` : ''}` : ''}`);
          put(fixHost, st.ok || !d.body.querySelector('.callout.warn .btn') ? fixBtn(fix) : null);
        }
        ready = true;
        renderEstimate();
      }

      /** neighbor help, said plainly: how much you owe, when they ask, what happens if you say no */
      function neighborDebtLine(s: GameState) {
        const debt = s.cursit.neighborDebt;
        const used = s.cursit.workNow + s.globals.workNow1;
        if (!debt && !used) return null;
        const owe = Math.min(3, debt + used);
        return h('div', { class: 'small muted owe' }, icon(ICONS.people, 'ico'), ` You owe your neighbors ${owe} of 3 turns of help. `, owe >= 3 ? 'Next April or September a neighbor will ask you to help for 7–10 days. Say yes and you stay friends; say no and they won\'t help in your field for most of a year.' : 'At 3, a neighbor asks for your help in April or September; you don\'t need to do anything until then.');
      }

      /** no job picked: what the field looks like, what was just done and what comes next */
      function renderOverview(s: GameState) {
        const crop = cropState(s);
        d.head.querySelector('.drawer-title')!.textContent = 'Your field';
        const st = fieldStatus(s);
        const why = !st.plow.ok && !st.plant.ok && !st.harvest.ok ? (st.harvest.reason ?? st.plant.reason ?? st.plow.reason) : null;
        if (lastReceipt && !s.cursit.bushels.some((b) => b > 0)) lastReceipt = null;
        put(
          d.body,
          lastReceipt,
          done ? h('div', { class: 'callout good done-note' }, h('b', null, done.text), h('div', null, h('span', { class: 'eyebrow' }, 'Next'), ' ', done.next), done.act ? btn(done.act.label, { kind: 'go', small: true, icon: done.act.icon, onClick: done.act.run }) : null) : null,
          !done && crop.phase !== 'none' ? h('div', { class: 'callout' }, crop.line, '.') : null,
          !done && why ? h('div', { class: 'small muted' }, why) : null,
          h('div', { class: 'small muted map-hint' }, 'Pick a job above to mark squares. Point at a square to see what it is.'),
          squareMap(s),
          legend(s),
          neighborDebtLine(s),
        );
        d.foot.hidden = true;
      }

      function outlookRow(s: GameState, c: Crop, k: number) {
        const table = c <= 2 ? YIELD_WHEAT : c === 3 ? YIELD_OATS : YIELD_CORN;
        const ba = table.get(s.date.year + (c === 1 ? 1 : 0))?.ba ?? table.get(s.date.year)?.ba ?? 0;
        const min = Math.round(ba * 20 * k * 0.85 * 0.8);
        const max = Math.round(ba * 20 * k * 1.15 * 1.2);
        const when = c === 1 ? 'ripens in November, harvest next April–May' : 'ripens in June, harvest September–October';
        return h('div', { class: 'outlook' }, cropChip(c), h('span', null, `${CROP_NAMES[c]} ×${k}: `, h('b', { class: 'num' }, `${num(min)}–${num(max)} bu`), h('small', { class: 'muted' }, ` · ${when}`)));
      }

      function render(s: GameState) {
        pickVerb(s);
        if (verb === 'harvest' && !working) {
          sel.clear();
          sq().filter((q) => q.ripe).forEach((q) => sel.add(q.n));
        }
        for (const n of [...sel]) if (!eligible(sq()[n - 1])) {
          sel.delete(n);
          plantMap.delete(n);
        }
        renderVerbs(s);
        renderJob(s);
        root.classList.toggle('neutral', !verb);
        app.world.setSelectedSquares([...sel].map((n) => n - 1));
      }

      // ------------------------------------------------------------ the job
      async function startJob() {
        const s = s0();
        const squaresBefore = [...sel].sort((a, b) => a - b);
        const land = s.sessions.field?.land ?? 1;
        const countsBefore = new Map<Crop, number>();
        sq().filter((q) => q.ripe && q.crop).forEach((q) => countsBefore.set(q.crop as Crop, (countsBefore.get(q.crop as Crop) ?? 0) + 1));
        if (verb === 'plant') {
          const plantings: Planting[] = [...plantMap].map(([square, c]) => ({ square, crop: c }));
          const r = session.run({ type: 'plant', plantings }, `Planted ${plural(plantings.length, 'square')}`);
          if (r.events.some((e) => e.type === 'log')) {
            audio.sfx('seed');
            soundCaption('[seed scattering]');
            prefs().plant = plantings.map((x) => [x.square, x.crop]);
            const spring = r.state.cursit.deadlineMonth === 10;
            const next = spring ? 'Wait for it to grow: it ripens in June, and you harvest it from September 1 to the end of October. Nothing to do here until then.' : 'Wait for it to grow: winter wheat rests through the winter, and you harvest it from April to the end of May.';
            done = { text: `Done: ${plural(plantings.length, 'square')} planted.`, next };
            toast(`Planted ${plural(plantings.length, 'square')}. ${spring ? 'It ripens in June; harvest by the end of October.' : 'It ripens before winter; harvest by the end of next May.'}`, { icon: 'sprout', tone: 'good', quiet: true });
          }
          sel.clear();
          plantMap.clear();
          // stay on the field's overview: no jump to another job (calm-ui)
          verb = null;
          chosen = true;
          render(session.s);
          return;
        }
        working = true;
        quietDialogs('StopPlow3', 'StopPlow4');
        app.setBusy(true);
        const r = session.run(
          verb === 'plow' ? { type: 'plow', squares: squaresBefore, helpers, plowBreakChoice: breakChoice } : { type: 'harvest', helpers },
          verb === 'plow' ? `Plowed ${plural(squaresBefore.length, 'square')}` : 'Harvested the crop',
        );
        if (verb === 'plow' && r.events.some((e) => e.type === 'dateChanged')) prefs().plow = squaresBefore;
        try {
          const worked = r.events.some((e) => e.type === 'dateChanged');
          if (worked) {
            audio.sfx(verb === 'plow' ? 'plow' : 'scythe');
            soundCaption(verb === 'plow' ? '[plow turning sod]' : '[scythes swishing]');
            const secs = reducedMotion() ? 0.3 : Math.min(6, Math.max(1.5, squaresBefore.length * Math.max(0.25, SPEED_SECONDS[rm().speed])));
            root.classList.add('working');
            await app.world.playFieldWork(verb === 'plow' ? 'plow' : 'harvest', squaresBefore.map((n) => n - 1), secs);
            app.world.setView(worldViewOf(r.state));
          }
        } finally {
          working = false;
          root.classList.remove('working');
          app.setBusy(false);
        }
        if (r.events.some((e) => e.type === 'dialog' && e.id === 'StopPlow3'))
          toast(r.events.some((e) => e.type === 'cash' && e.reason === 'plowSteel') ? 'Your plow broke on the hard sod. You bought new steel for $50, as planned.' : 'Your plow broke on the hard sod. You repaired it, as planned: 10 more days.', { icon: 'plow', speaker: 'Your neighbor', seconds: 6 });
        if (r.events.some((e) => e.type === 'dialog' && e.id === 'StopPlow4')) toast('One of your horses fell sick, so the work went slower.', { icon: 'pen', seconds: 6 });
        const harvestEv = r.events.find((e): e is Extract<SimEvent, { type: 'harvest' }> => e.type === 'harvest');
        if (verb === 'plow' && r.events.some((e) => e.type === 'dialog' && e.id === 'FDBK7')) {
          const plowed = r.state.cursit.numPlowed - s.cursit.numPlowed;
          toast(`${T(r.state, 'FDBK7').text.replace(/\s+/g, ' ').trim()}`, { icon: 'plow', tone: 'good', speaker: 'Your neighbor', quiet: true });
          if (plowed > 0 && r.state.propet.seeds.every((x) => x < 20)) app.tip('need-seed', 'Your squares are plowed. Seed comes in sacks from the General Store: one sack plants one square.');
        }
        const plowedNow = r.state.cursit.numPlowed - s.cursit.numPlowed;
        if (verb === 'plow' && plowedNow > 0) {
          const after = session.s;
          const seed = after.propet.seeds.some((x, i) => x >= 20 && sowable(after, (i + 1) as Crop));
          done = {
            text: `Done: ${plural(plowedNow, 'square')} plowed, on ${monthName(after.date.mon)} ${after.date.day}.`,
            next: seed ? 'Plant them with your seed.' : 'Buy seed at the General Store, then plant them. One sack plants one square.',
            act: seed ? { label: 'Plant now', icon: 'seed', run: () => setVerb('plant') } : { label: 'Go to the General Store', icon: 'store', run: () => void app.go('store') },
          };
        }
        sel.clear();
        verb = null;
        chosen = true;
        if (harvestEv) await receipt(s, r.state, harvestEv, countsBefore, land, helpers);
        render(session.s);
      }

      async function receipt(before: GameState, after: GameState, e: Extract<SimEvent, { type: 'harvest' }>, counts: Map<Crop, number>, land: number, hh: Helpers) {
        const landF = land === 0 ? 0.85 : land === 2 ? 1.15 : 1;
        const rows = [...counts].map(([c, k]) => {
          const table = c <= 2 ? YIELD_WHEAT : c === 3 ? YIELD_OATS : YIELD_CORN;
          const ba = table.get(before.date.year)?.ba ?? 0;
          return h('tr', null, h('td', null, cropChip(c), ' ', CROP_NAMES[c]), h('td', { class: 'num' }, `${k} sq × 20 ac × ${ba.toFixed(1)} bu/ac × land ${landF.toFixed(2)} × luck ${e.index >= 0 ? '+' : ''}${e.index}%`), h('td', { class: 'num' }, h('b', null, `${num(e.bushels[c - 1])} bu`)));
        });
        const wages = before.propet.cash - after.propet.cash;
        const deadline = before.cursit.deadlineYear ? `${monthName(before.cursit.deadlineMonth)} ${before.cursit.deadlineYear}` : '';
        const classic = after.fidelity.mode === 'classic';
        audio.sting('harvest');
        lastReceipt = h('section', { class: 'receipt-inline' },
          h('div', { class: 'spread' }, h('h3', { class: 'card-title' }, 'Harvest receipt'), btn('', { kind: 'plain', icon: 'close', small: true, title: 'Put the receipt away', onClick: () => ((lastReceipt = null), render(session.s)) })),
          h('div', { class: 'receipt-paper' },
            h('table', { class: 'ledger-t' }, h('tbody', null, ...rows), h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td'), h('td', { class: 'num' }, `${num(e.bushels.reduce((a, b) => a + b, 0))} bu`)))),
            wages > 0 && hh.workers ? h('p', { class: 'small' }, `Hired hands: ${money(wages)}`) : null,
            h('p', { class: 'small' }, classic && deadline ? `Unsold grain spoils at the end of ${deadline}. Sell it at the elevator.` : 'Your grain waits safely at the farm until you sell it.'),
            h('p', { class: 'small muted' }, `Ed would pay about ${money(grainQuote(after).localTotal)} at today's prices.`),
            h('p', { class: 'small verbatim muted' }, `“${T(after, after.date.year === 1880 ? 'EndHarv1' : 'EndHarv').text.replace(/\s+/g, ' ').trim()}”`)),
          btn('Go sell it', { kind: 'go', icon: 'elevator', onClick: () => void app.go('elevator') }));
        toast(`Harvest: ${num(e.bushels.reduce((a, b) => a + b, 0))} bushels`, { icon: 'wheat', tone: 'good', quiet: true });
      }

      return {
        el: root,
        update(s) {
          if (!working) render(s);
        },
        onHover(t: PickTarget | null) {
          const n = t && t.kind === 'square' ? t.index + 1 : 0;
          if (n === hovered) return;
          hovered = n;
          d.body.querySelectorAll('.msq.hov').forEach((e) => e.classList.remove('hov'));
          const q = n ? sq()[n - 1] : null;
          if (!q) return void (sqTip.hidden = true);
          d.body.querySelector(`.msq[data-n="${n}"]`)?.classList.add('hov');
          put(sqTip, h('b', null, `Square ${n}`), ' ', sqLabel(session.s, q));
          sqTip.hidden = false;
          placeTip();
        },
        onPick(t: PickTarget) {
          if (t.kind === 'square') {
            const n = t.index + 1; // world squares are 0-based
            if (dragMode === null) dragMode = !sel.has(n);
            toggle(n, dragMode);
            return true;
          }
          return false;
        },
        onKey(e) {
          if (e.key === 'p' || e.key === 'P') return (setVerb('plow'), true);
          if (e.key === 'n' || e.key === 'N') return (setVerb('plant'), true);
          if (e.key === 'v' || e.key === 'V') return (setVerb('harvest'), true);
          if (e.key === 'Enter' && !working) {
            (d.foot.querySelector('.btn-go') as HTMLButtonElement | null)?.click();
            return true;
          }
          return false;
        },
        destroy() {
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointermove', onMove);
          app.world.setSelectedSquares([]);
          const s = session.state;
          if (s?.devcut?.enabled && !session.blocked) session.run({ type: 'devcut', action: { kind: 'leaveField' } } as never, 'Left the field');
        },
      };
    },
  });
}

const CROP_TAG: Record<Crop, string> = { 1: 'WW', 2: 'SW', 3: 'Oa', 4: 'Co' };

/** Crop swatch. Q16 (ui quirk): classic rules draw oats with corn's art and corn with oats'. */
function cropChip(c: Crop) {
  const s = session.state;
  const swap = !!s && s.fidelity.mode === 'classic' && reproduces(s.fidelity, 'Q16');
  const art = swap && (c === 3 || c === 4) ? (c === 3 ? 4 : 3) : c;
  return h('span', { class: `crop c${art}` }, CROP_TAG[art as Crop]);
}
