// One guidance channel (docs/design/calm-ui.md §1, §5): a quiet "Next: …" pill under the
// breadcrumb that follows the player's progress and takes them there on click. The full
// checklist opens from it (collapsed by default). The thing to click next gets a soft glow, one
// at a time; nothing is said about anything the player already did. The first visit to a place
// can add a single short line under the pill (Guidance: Full, or Light for the essentials).
// Replaces the Today card, the neighbor-tip popups, the barn-and-well gate card and the Advance
// button's explanations.
import type { GameState } from '../../sim/index.ts';
import { buildableItems } from '../../sim/index.ts';
import type { App } from '../core/app.ts';
import { h, icon, put } from '../core/dom.ts';
import { ICONS } from '../core/icons.ts';
import { session } from '../core/session.ts';
import { onRm, rm, setRm } from '../core/settings.ts';
import { todaySuggestions, type Suggestion } from '../core/simapi.ts';
import { unreadMail } from '../core/quiet.ts';
import { glossify } from '../core/glossary.ts';
import { advanceStatus, lastStop, stopNote } from '../core/calendar.ts';
import { talkAvailable } from '../panels/street.ts';

interface Step {
  text: string;
  done?: boolean;
  /** take the player there */
  go?: () => void;
  /** CSS selector (or finder) for the one thing to glow, given where the player is */
  glow?: () => Element | null;
}

const q = (sel: string) => document.querySelector(sel);
/** the button that opens a place or book (books live off the hotbar: Goals on the ribbon, Mail on the top bar, Almanac on the date) */
const hot = (id: string) => q(`.hotbar .hot[data-id="${id}"]`) ?? q(({ goals: '.goal-ribbon', mailbox: '.bell-btn', almanac: '.leaf', ledger: '.hud-money .stat.linky' } as Record<string, string>)[id] ?? '.none');
const byText = (sel: string, re: RegExp) => [...document.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? '')) ?? null;

/** One line, the first time a place opens (Full: all of them; Light: the essentials). */
const FIRST: Record<string, { text: string; light?: boolean; skip?: (s: GameState) => boolean }> = {
  street: { text: 'Main Street: the store, the bank and the grain elevator. Travel never costs a day.' },
  talk: { text: 'Click a neighbor to hear them. Underlined words explain themselves.', light: true },
  store: { text: 'One sack of seed plants one square of your field.', light: true, skip: (s) => s.propet.seeds.some((x) => x >= 20) || s.cursit.numPlanted > 0 },
  field: { text: 'Pick a job, then click the squares to mark them.', light: true, skip: (s) => s.cursit.numPlowed > 0 || s.cursit.numPlanted > 0 },
  elevator: { text: 'Ed pays cash for your grain today. Prices change every year.' },
  bank: { text: 'Loans are repaid all at once, with interest, in December of their last year.', light: true, skip: (s) => s.propet.loanAmount > 0 },
  house: { text: 'Spare money can wait in the savings box under the bed.' },
  pen: { text: 'A milk cow lowers your upkeep. Animals need a barn for winter.', light: true },
  almanac: { text: 'The farming year at a glance. Click a month to bookmark it.' },
  ledger: { text: 'Every coin is written down here by itself.' },
  goals: { text: 'What the town will look for, and how close you are today.' },
  mailbox: { text: 'Letters that need no answer wait here for you.' },
};

export function mountObjective(app: App) {
  const label = h('span', { class: 'obj-text' });
  const pill = h('button', { type: 'button', class: 'obj-pill', 'aria-label': 'Next step' }, h('span', { class: 'obj-k' }, 'Next'), label, icon(ICONS.next, 'ico obj-go'));
  const more = h('button', { type: 'button', class: 'obj-more', 'aria-expanded': 'false', 'aria-label': 'Show the checklist', title: 'Checklist' }, icon(ICONS.calendar, 'ico'));
  const list = h('div', { class: 'obj-list card', hidden: true });
  const hint = h('div', { class: 'obj-hint', hidden: true });
  const root = h('div', { class: 'rm-objective' }, h('div', { class: 'obj-row' }, pill, more), hint, list);
  app.root.append(root);
  // panels anchored top-left (the field's job strip, left drawers) sit below the pill and its hint
  const row = root.firstElementChild as HTMLElement;
  const measure = () => {
    const hgt = root.hidden ? 0 : row.offsetHeight + (hint.hidden ? 0 : hint.offsetHeight + 6) + 8;
    app.root.style.setProperty('--obj-h', `${hgt}px`);
  };
  const ro = new ResizeObserver(measure);
  ro.observe(row);
  ro.observe(hint);
  new MutationObserver(measure).observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  let current: Step | null = null;
  let glowEl: Element | null = null;
  let raf = 0;
  let hintTimer = 0;

  const mode = () => rm().assists.guidance ?? 'light';

  function arrival(s: GameState): Step[] | null {
    if (s.date.year > 1880 || (s.date.year === 1880 && s.date.mon >= 11)) return null;
    const p = s.propet;
    const at = () => app.placeId;
    const hasSeed = p.seeds.some((x) => x >= 20) || s.cursit.numPlanted > 0 || s.cursit.numHarved > 0 || s.cursit.firstHarv === 1 || s.cursit.bushels.some((b) => b > 0);
    const wm = p.windmill === 1 || p.extraWindmills > 0;
    return [
      { text: 'Say hello to your neighbors on Main Street', done: s.globals.firstTT === 1, go: () => void app.go('street'), glow: () => (at() === 'street' ? q('.talk-cta button') : hot('street')) },
      { text: 'Let the neighbors raise your sod house: press Advance', done: s.globals.houseStat !== 0, go: () => app.keys.advance?.(), glow: () => q('.adv-btn') },
      { text: 'Build a barn from its blueprint', done: p.barn === 1, go: () => void app.go('homestead', { build: 'barn' }), glow: () => (at() === 'homestead' ? (q('.build-host .btn-go:not([disabled])') ?? byText('.wlabel.tone-ghost', /barn/i)) : hot('homestead')) },
      { text: wm ? 'Buy seed at the General Store' : 'Buy seed and a windmill at the General Store', done: hasSeed && wm, go: () => void app.go('store'), glow: () => (at() === 'store' ? (q('.slip .btn-go:not([disabled])') ?? q('.callout.suggest .btn-go') ?? q('button[aria-label="More sacks of Spring wheat"]')) : hot('store')) },
      {
        text: s.cursit.numPlowed > 0 && s.cursit.numPlanted === 0 ? 'Plant your plowed squares' : 'Plow and plant your field',
        done: s.cursit.numPlanted > 0 || s.cursit.numHarved > 0 || s.cursit.firstHarv === 1,
        go: () => void app.go('field'),
        glow: () => (at() === 'field' ? (q('.jobcard .btn-go:not([disabled])') ?? q('.sack:not(.off):not(.on)') ?? q('.msq.can') ?? q('.verb:not(.off):not(.on)')) : hot('field')),
      },
      { text: 'Let time pass until the harvest: press Advance', done: s.date.mon >= 9 || s.cursit.firstHarv === 1, go: () => app.keys.advance?.(), glow: () => q('.adv-btn') },
    ];
  }

  function fromSuggestion(sg: Suggestion): Step {
    const go = () => {
      if (sg.go) return void app.go(sg.go);
      if (sg.action === 'advance') return app.keys.advance?.();
      if (sg.action === 'mail') return void app.go('mailbox');
      if (sg.action === 'trivia') return void app.go('homestead', { trivia: true });
      if (sg.action === 'build') {
        const b = buildableItems(session.s)[0];
        return void app.go('homestead', b ? { build: b } : {});
      }
    };
    const glow = () => {
      if (sg.action === 'advance') return q('.adv-btn');
      if (sg.action === 'trivia') return app.placeId === 'homestead' ? q('.trivia-tab') : hot('homestead');
      if (sg.go && app.placeId !== sg.go) return hot(sg.go);
      if (sg.go === 'elevator') return byText('.elevator .btn-go', /Sell to Ed/);
      if (sg.go === 'field') return q('.jobcard .btn-go:not([disabled])') ?? q('.verb:not(.off):not(.on)');
      if (sg.go === 'bank') return byText('.bank .btn-go', /Collect/);
      if (sg.go === 'street') return q('.talk-cta.fresh button');
      return null;
    };
    return { text: sg.text.replace(/\.$/, ''), go, glow };
  }

  function steps(s: GameState): { now: Step | null; all: Step[] } {
    const arr = arrival(s);
    const raw = todaySuggestions(s).filter((x) => x.id !== 'letter' && (!arr || !['hello', 'sod', 'build', 'seed', 'plow', 'plant'].includes(x.id)));
    const sugg = raw.map(fromSuggestion);
    // say why time stopped, in the pill, until the player acts on it or presses Advance again
    const note = stopNote(s);
    const tt = talkAvailable(s);
    const talkIdx = raw.findIndex((x) => x.id === 'talk');
    if (talkIdx >= 0 && tt) sugg[talkIdx].text = `Optional: new talk in town, “${tt.topic ?? 'this month’s news'}”`;
    if (note && lastStop?.reason === 'townTalk' && tt?.fresh && talkIdx >= 0) {
      // harvest, selling and money come first; the talk is said as the reason time stopped
      const urgent = raw[0] && raw[0].priority >= 78 && raw[0].id !== 'talk';
      const [st] = sugg.splice(talkIdx, 1);
      if (urgent) sugg.splice(1, 0, { ...st, text: `Optional: time also stopped for a new talk in town, “${tt.topic ?? 'this month’s news'}”` });
      else sugg.unshift({ ...st, text: `Time stopped for a new talk in town: “${tt.topic ?? 'this month’s news'}”. Optional` });
    } else if (note && lastStop?.reason === 'plantingSeason' && sugg.length) {
      sugg[0] = { ...sugg[0], text: `Time stopped: ${note}. ${sugg[0].text}` };
    }
    // letters can wait: they come after anything with a deadline (harvest, selling, money)
    if (unreadMail()) {
      const at = raw.findIndex((x) => x.priority < 60);
      sugg.splice(at < 0 ? sugg.length : at, 0, { text: `Read your mail (${unreadMail()})`, go: () => void app.go('mailbox'), glow: () => q('.bell-btn') });
    }
    const all = [...(arr ?? []), ...sugg];
    const open = arr?.find((x) => !x.done) ?? null;
    // money, harvest and deadlines outrank the tutorial once it's done
    return { now: open ?? sugg[0] ?? null, all };
  }

  function render() {
    const s = session.state;
    const off = mode() === 'off' || !s || !!app.screen || !!s.extra.ended;
    root.hidden = off;
    if (off) return setGlow(null);
    const { now, all } = steps(s!);
    current = now;
    if (s!.pending) {
      label.textContent = 'Answer the letter';
      pill.classList.add('quiet');
    } else if (now) {
      label.textContent = now.text;
      pill.classList.remove('quiet');
    } else {
      const st = advanceStatus(s!);
      label.textContent = st.ok ? `${st.label} when you’re ready` : st.reason ?? 'All quiet';
      pill.classList.add('quiet');
    }
    if (!list.hidden) renderList(all);
    queueGlow();
  }

  function renderList(all: Step[]) {
    put(
      list,
      h('div', { class: 'eyebrow' }, 'What you can do'),
      all.length
        ? h('ol', { class: 'obj-steps' }, ...all.map((x) => {
            const li = h('li', { class: x.done ? 'done' : '' }, icon(x.done ? ICONS.check : ICONS.pin, 'ico'), h('span', null, x.text));
            if (!x.done && x.go) {
              const b = h('button', { type: 'button', class: 'btn btn-link btn-sm' }, 'Go');
              b.addEventListener('click', () => {
                list.hidden = true;
                more.setAttribute('aria-expanded', 'false');
                x.go!();
              });
              li.append(b);
            }
            return li;
          }))
        : h('p', { class: 'small muted' }, 'All quiet. Press Advance when you’re ready.'),
      h('div', { class: 'obj-mode' }, h('span', { class: 'small muted' }, 'Guidance'), ...(['full', 'light', 'off'] as const).map((m) => {
        const b = h('button', { type: 'button', class: `btn btn-link btn-sm${mode() === m ? ' on' : ''}` }, m === 'full' ? 'Full' : m === 'light' ? 'Light' : 'Off');
        b.addEventListener('click', () => setRm({ assists: { ...rm().assists, guidance: m, preset: 'custom' } }));
        return b;
      })),
    );
  }

  function setGlow(el: Element | null) {
    if (el === glowEl) return;
    glowEl?.classList.remove('hint-glow');
    glowEl = el;
    el?.classList.add('hint-glow');
  }
  function queueGlow() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (mode() === 'off' || app.busy || !current?.glow || session.state?.pending) return setGlow(null);
      setGlow(current.glow());
    });
  }

  function showHint(text: string) {
    if (mode() === 'off') return;
    put(hint, glossify(h('span', null, text)));
    hint.hidden = false;
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => (hint.hidden = true), 7000);
  }
  function firstVisit(id: string | null) {
    if (!id || !session.state) return;
    const f = FIRST[id];
    if (!f) return;
    const key = `place:${id}`;
    const seen = rm().seenTips;
    if (seen.includes(key)) return;
    if (mode() === 'off' || (mode() === 'light' && !f.light) || f.skip?.(session.s)) return;
    setRm({ seenTips: [...seen, key] });
    showHint(f.text);
  }

  pill.addEventListener('click', () => {
    if (session.state?.pending) return document.querySelector<HTMLButtonElement>('.letter-dock')?.click();
    current?.go?.();
  });
  more.addEventListener('click', () => {
    list.hidden = !list.hidden;
    more.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden && session.state) renderList(steps(session.s).all);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!list.hidden && !root.contains(e.target as Node)) {
      list.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    }
  });
  // a refused Advance press nudges the pill instead of opening a card
  app.root.addEventListener('rm-nudge', () => {
    root.classList.remove('nudge');
    void root.offsetWidth;
    root.classList.add('nudge');
  });

  session.on('change', () => render());
  session.on('loaded', () => render());
  app.on('nav', (id) => {
    hint.hidden = true;
    render();
    firstVisit(id);
  });
  app.on('sheet', (id) => {
    render();
    firstVisit(id);
  });
  app.on('busy', () => render());
  onRm(() => render());
  // place panels re-render their buttons: keep the glow on the live element
  new MutationObserver(() => current && glowEl && !glowEl.isConnected && queueGlow()).observe(app.root, { childList: true, subtree: true });
  app.tip = (_id: string, text: string) => showHint(text);
  return { render, showHint };
}
