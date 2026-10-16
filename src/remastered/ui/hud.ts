// The persistent HUD: the tear-off calendar, money (cash, savings, upkeep, runway), the
// Advance control (speeds, +1 month, Pause), the goal ribbon, Undo, Help, Menu and the hotbar
// with live badges. Present on every in-game screen.
import gsap from 'gsap';
import type { GameState, SimEvent } from '../../sim/index.ts';
import type { App } from '../core/app.ts';
import { advanceStatus, stopNote, type AdvanceStatus, type CalendarRunner } from '../core/calendar.ts';
import { h, icon, put } from '../core/dom.ts';
import { GOAL_NAMES, money, monthName, MONTHS_CAPS } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { hotbarPanels, onRegistry } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { reducedMotion, rm, setRm, SPEED_LABEL, SPEEDS, type Speed } from '../core/settings.ts';
import { goalChecklist, runway, savingsRule } from '../core/simapi.ts';
import { btn, countTo, setDisabled, toast } from './kit.ts';
import { grainWaiting } from './badges.ts';
import { onRecent, unreadCount, notify } from './notify.ts';
import { mailbox } from '../core/quiet.ts';
import { audio, soundCaption } from '../core/audio.ts';

export function mountHud(app: App, cal: CalendarRunner) {
  // ---------------------------------------------------------------- top right cluster
  const goalBtn = h('button', { type: 'button', class: 'goal-ribbon pe', 'aria-label': 'Goals & Standing (G)' });
  const undoBtn = btn('Undo', { kind: 'plain', icon: 'undo', cls: 'hud-chipbtn', onClick: () => doUndo() });
  const helpBtn = btn('', { kind: 'plain', icon: 'help', cls: 'hud-round', title: 'Help & keys (?)', onClick: () => app.keys.help?.() });
  const menuBtn = btn('', { kind: 'plain', icon: 'menu', cls: 'hud-round', title: 'Menu (Esc)', onClick: () => app.keys.menu?.() });
  helpBtn.setAttribute('aria-label', 'Help and keyboard map');
  menuBtn.setAttribute('aria-label', 'Menu');
  const bellN = h('span', { class: 'bell-n' });
  const bellBtn = btn('', { kind: 'plain', icon: 'mail', cls: 'hud-round bell-btn', title: 'Mail & messages (M): letters you were sent, and everything the game told you', onClick: () => (app.sheets.some((m) => m.def.id === 'mailbox' || m.def.id === 'recent') ? app.closeSheets() : void app.go('mailbox')) });
  bellBtn.setAttribute('aria-label', 'Mail and messages');
  bellBtn.append(bellN);
  // a number for letters waiting to be read; a small dot for messages you haven't looked at
  const syncBell = () => {
    const letters = session.state ? mailbox().filter((m) => !m.read).length : 0;
    bellN.textContent = letters ? (letters > 9 ? '9+' : String(letters)) : '';
    bellN.classList.toggle('dot', !letters && unreadCount() > 0);
    bellBtn.dataset.tip = letters ? `${letters} ${letters === 1 ? 'letter' : 'letters'} to read · Mail & messages (M)` : 'Mail & messages (M): letters you were sent, and everything the game told you';
  };
  onRecent(syncBell);
  session.on('change', syncBell);
  app.on('sheet', syncBell);
  const top = h('div', { class: 'hud-top' }, goalBtn, undoBtn, bellBtn, helpBtn, menuBtn);
  goalBtn.addEventListener('click', () => void app.go('goals'));

  // ---------------------------------------------------------------- calendar leaf
  const leafM = h('div', { class: 'leaf-m' });
  const leafD = h('div', { class: 'leaf-d num' });
  const leafY = h('div', { class: 'leaf-y num' });
  const leaf = h('button', { type: 'button', class: 'leaf', 'data-tip': 'Today’s date. Click to open the Almanac (A).' }, h('div', { class: 'leaf-rings' }, h('i'), h('i')), leafM, leafD, leafY);
  leaf.addEventListener('click', () => void app.go('almanac'));

  // ---------------------------------------------------------------- money
  const cashV = h('b', { class: 'num' });
  const boxV = h('b', { class: 'num' });
  const upkeepV = h('b', { class: 'num' });
  const runPips = h('span', { class: 'pips', 'aria-hidden': 'true' });
  const runV = h('b', { class: 'num' });
  const bankChip = h('button', { type: 'button', class: 'bank-chip', hidden: true });
  bankChip.addEventListener('click', () => void app.go('bank'));
  const stat = (ico: keyof typeof ICONS, label: string, v: HTMLElement, tip: string, ...extra: HTMLElement[]) =>
    h('div', { class: 'stat', tabindex: 0, 'data-tip': tip }, icon(ICONS[ico]), h('span', { class: 'stat-l' }, label), v, ...extra);
  // Cash opens the Ledger (every coin in and out); the savings box opens the house, where it lives
  const cashStat = stat('coin', 'Cash', cashV, 'Money in your pocket. The store, the bank and the land office take cash only. Click for the Ledger: every coin in and out (L).');
  cashStat.classList.add('linky');
  cashStat.addEventListener('click', () => void app.go('ledger'));
  const boxStat = stat('box', 'Savings box', boxV, '');
  boxStat.classList.add('linky');
  for (const st of [cashStat, boxStat]) st.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), st.click()));
  boxStat.addEventListener('click', () => (session.state && session.s.propet.house > 0 ? void app.go('house', { focus: 'savings' }) : undefined));
  const runStat = stat('hourglass', 'Runway', runV, 'How many months your money covers your upkeep.', runPips);
  const money_ = h(
    'div',
    { class: 'hud-money' },
    cashStat,
    boxStat,
    stat('kettle', 'Upkeep', upkeepV, 'What your family needs each month for food and clothes. It goes up with each new child and down when you own a milk cow.'),
    runStat,
    bankChip,
  );

  // ---------------------------------------------------------------- advance controls
  const advLabel = h('span', { class: 'adv-label' });
  const advSub = h('span', { class: 'adv-sub' });
  const advIco = icon(ICONS.play);
  const advBtn = h('button', { type: 'button', class: 'btn btn-go adv-btn' }, advIco, h('span', { class: 'adv-text' }, advLabel, advSub), h('kbd', null, 'Space'));
  advBtn.addEventListener('click', () => void doAdvance());
  const oneBtn = btn('+1 month', { kind: 'brass', small: true, title: 'Advance one month (Shift+Space)', onClick: () => void doAdvance({ months: 1 }) });
  const speedV = h('span', { class: 'speed-v' });
  const speedDown = h('button', { type: 'button', class: 'speed-arrow', 'aria-label': 'Slower ([)' }, '◂');
  const speedUp = h('button', { type: 'button', class: 'speed-arrow', 'aria-label': 'Faster (])' }, '▸');
  speedDown.addEventListener('click', () => shiftSpeed(-1));
  speedUp.addEventListener('click', () => shiftSpeed(1));
  const speed = h('div', { class: 'speed', 'data-tip': 'How fast the months go by when you press Advance ([ and ] keys). The game always stops for anything important.' }, speedDown, speedV, speedUp);
  const controls = h('div', { class: 'hud-controls' }, advBtn, oneBtn, speed);

  // ---------------------------------------------------------------- hotbar
  const hotbar = h('nav', { class: 'hotbar', 'aria-label': 'Places and books' });

  const plank = h('div', { class: 'hud-plank pe' }, leaf, h('div', { class: 'hud-mid' }, money_, controls), hotbar);
  const digest = h('div', { class: 'digest-host' });
  const root = h('div', { class: 'hud' }, top, digest, plank);
  app.hudHost.append(root);
  // keep --hud-h equal to the plank's real height so cards never hide under it
  const syncHudH = () => {
    const top = plank.getBoundingClientRect().top;
    document.documentElement.style.setProperty('--plank-h', `${Math.ceil(window.innerHeight - top + 6)}px`);
    document.documentElement.style.setProperty('--hud-h', `${Math.ceil(window.innerHeight - top + 6)}px`);
  };
  const ro = new ResizeObserver(syncHudH);
  ro.observe(plank);
  window.addEventListener('resize', syncHudH);
  new MutationObserver(syncHudH).observe(app.hudHost, { childList: true, subtree: false, attributes: true, attributeFilter: ['hidden'] });

  // ---------------------------------------------------------------- behaviour
  let last: GameState | null = null;
  let status: AdvanceStatus | null = null;

  function shiftSpeed(d: number) {
    const i = SPEEDS.indexOf(rm().speed);
    const n = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))] as Speed;
    setRm({ speed: n });
    renderSpeed();
    toast(`Speed: ${SPEED_LABEL[n]}`, { icon: 'hourglass', seconds: 1.4 });
  }
  function renderSpeed() {
    speedV.textContent = SPEED_LABEL[rm().speed];
  }

  async function doAdvance(opts: { months?: number } = {}) {
    if (cal.running) return cal.pause();
    if (!session.state) return;
    if (app.sheets.length) app.closeSheets();
    const st = advanceStatus(session.s);
    if (!st.ok) {
      notify(st.reason ?? 'Not now.', { icon: 'warn' });
      app.root.dispatchEvent(new CustomEvent('rm-nudge'));
      return;
    }
    if (app.placeId !== 'homestead' && app.placeId !== 'field') await app.go('homestead');
    audio.sfx('calendar-page');
    await cal.advance(opts);
  }

  function doUndo() {
    if (!session.canUndo) return;
    const label = session.undoLabel;
    if (session.undo()) toast(`Undone: ${label}`, { icon: 'undo' });
  }

  app.keys.advance = () => void doAdvance();
  app.keys.month = () => void doAdvance({ months: 1 });
  app.keys.speedDown = () => shiftSpeed(-1);
  app.keys.speedUp = () => shiftSpeed(1);
  app.keys.undo = doUndo;

  function renderHotbar(s: GameState | null) {
    const cur = app.placeId;
    const sheet = app.sheets[app.sheets.length - 1]?.def.id;
    const defs = hotbarPanels().filter((d) => d.hotbar!.bar !== false && !(s && d.hotbar!.hidden?.(s)));
    const seen = session.state ? (session.journal.badgeSeen ??= {}) : {};
    put(
      hotbar,
      ...defs.map((d, i) => {
        const hb = d.hotbar!;
        const why = s ? hb.disabled?.(s) ?? null : null;
        const raw = s ? hb.badge?.(s, app) ?? null : null;
        const active = d.id === cur || d.id === sheet;
        // notification badges clear once seen (and stay clear until they say something new)
        const clears = !!raw && (hb.clearOnOpen || raw.clear);
        const sig = raw && s ? `${raw.text}|${s.date.year}-${s.date.mon}` : '';
        if (clears && active) seen[d.id] = sig;
        const b = clears && seen[d.id] === sig ? null : raw;
        const el = h(
          'button',
          {
            type: 'button',
            class: `hot${active ? ' on' : ''}${why ? ' dim' : ''}${hb.group === 'book' ? ' is-book' : ''}${i > 0 && defs[i - 1].hotbar!.group !== hb.group ? ' sep' : ''}`,
            'aria-current': active ? 'page' : null,
            'data-id': d.id,
            'aria-label': `${hb.label}${b ? `, ${b.text}` : ''}${why ? ` (${why})` : ''}`,
            'data-tip': why ? `${hb.label}: ${why}` : `${hb.label}${b ? ` · ${b.tip ?? b.text}` : ''} (key ${hb.key.toUpperCase()})`,
          },
          h('kbd', null, hb.key.toUpperCase()),
          icon(hb.icon, 'ico hot-ico'),
          h('span', { class: 'hot-l' }, hb.label),
          b ? h('span', { class: `badge tone-${b.tone ?? 'info'}` }, b.text) : null,
        );
        el.addEventListener('click', () => {
          if (why) return void toast(why, { icon: 'calendar' });
          if (d.kind === 'sheet' && sheet === d.id) app.closeSheet();
          else void app.go(d.id, s && hb.params ? hb.params(s) : {});
        });
        return el;
      }),
    );
  }

  function render(s: GameState, _events: SimEvent[] = []) {
    const p = s.propet;
    // calendar leaf
    const flipped = last && (last.date.mon !== s.date.mon || last.date.year !== s.date.year);
    leafM.textContent = MONTHS_CAPS[s.date.mon - 1];
    leafD.textContent = String(s.date.day || 1);
    leafY.textContent = String(s.date.year);
    leaf.setAttribute('aria-label', `${monthName(s.date.mon)} ${s.date.day}, ${s.date.year}. Open the Almanac.`);
    if (flipped && !reducedMotion()) gsap.fromTo(leaf, { rotateX: -70, transformOrigin: '50% 0%' }, { rotateX: 0, duration: 0.35, ease: 'back.out(2)' });
    // money
    const prevCash = last?.propet.cash ?? p.cash;
    const prevBox = last?.propet.savings ?? p.savings;
    countTo(cashV, prevCash, p.cash, (n) => money(n, { cents: true }));
    countTo(boxV, prevBox, p.savings, (n) => money(n, { cents: true }));
    boxStat.dataset.tip = `${savingsRule(s)} Click to open it in the house.`;
    upkeepV.textContent = `${money(p.lifePrice)}/mo`;
    if (last && p.cash !== prevCash && !app.busy) {
      const d = p.cash - prevCash;
      flyMoney(cashV.parentElement!, d);
      soundCaption(d > 0 ? '[coins jingle]' : '[coins clink]');
    }
    const rw = runway(s);
    runV.textContent = rw.infinite ? '∞' : `${rw.months} mo`;
    put(runPips, ...Array.from({ length: 6 }, (_, i) => h('i', { class: rw.infinite || rw.months > i * 2 ? (rw.level === 'ok' ? 'on' : `on ${rw.level}`) : '' })));
    runStat.classList.toggle('low', rw.level !== 'ok');
    runStat.dataset.tip = rw.infinite
      ? `Your businesses earn ${money(rw.business)}/mo, more than your upkeep.`
      : `How long your money lasts. Upkeep ${money(rw.upkeep)}/mo${rw.business ? ` − businesses ${money(rw.business)}/mo` : ''}: cash covers ${rw.cashMonths} mo, the savings box ${rw.savingsMonths} more.${grainWaiting(s).bushels ? ` Plus about ${money(grainWaiting(s).value)} of grain to sell at the elevator.` : ''}`;
    bankChip.hidden = s.myRecieve <= 0;
    if (s.myRecieve > 0) put(bankChip, icon(ICONS.bank), `${money(s.myRecieve, { cents: true })} at the bank`);
    // goal ribbon
    const g = goalChecklist(s);
    goalBtn.dataset.tip = `${GOAL_NAMES[g.goal] ?? 'Goal'}, checked ${monthName(g.check.mon)} ${g.check.year}. ${g.reqs.map((r) => `${r.met ? '✓' : '✗'} ${r.label}${!r.met && r.target && r.value !== undefined && r.target > 1 ? ` (${typeof r.target === 'number' && r.target >= 100 ? `${money(Math.round(r.value))} of ${money(r.target)}` : `${r.value} of ${r.target}`})` : ''}`).join(' · ')}. The bar shows how close you are today.`;
    put(
      goalBtn,
      icon(ICONS.goals),
      h('span', { class: 'gr-text' }, h('span', { class: 'gr-name' }, GOAL_NAMES[g.goal] ?? 'Goal'), h('span', { class: 'gr-meter' }, h('i', { style: { width: `${Math.round(g.progress * 100)}%` } })), h('span', { class: 'gr-sub' }, `${Math.round(g.progress * 100)}% · checked ${monthName(g.check.mon, 'short')} ${g.check.year}`)),
      g.milestones ? h('span', { class: 'gr-hearts', title: 'Family milestones' }, ...g.milestones.map((m) => icon(m.state === 'earned' ? ICONS.heartFull : ICONS.heart, `ico heart ${m.state}`))) : null,
    );
    // undo
    undoBtn.hidden = !session.canUndo;
    if (session.canUndo) undoBtn.title = `Undo: ${session.undoLabel} (Ctrl+Z)`;
    // advance
    renderAdvance(s);
    renderHotbar(s);
    last = s;
  }

  function renderAdvance(s: GameState) {
    if (cal.running) {
      advLabel.textContent = 'Pause';
      advSub.textContent = 'at the end of this month';
      advIco.innerHTML = ICONS.pause;
      advBtn.classList.add('running');
      setDisabled(advBtn, null);
      setDisabled(oneBtn, 'The calendar is running.');
      return;
    }
    advBtn.classList.remove('running');
    advIco.innerHTML = ICONS.play;
    status = advanceStatus(s);
    advLabel.textContent = status.label;
    // one short line: where time will stop (the objective pill explains the rest)
    const why = status.ok ? stopNote(s) : null;
    advSub.textContent = why ? `stopped: ${why}` : status.ok && !status.firstPress && status.sub ? status.sub : '';
    advSub.hidden = !advSub.textContent;
    advBtn.classList.toggle('blocked', !status.ok);
    advBtn.setAttribute('aria-disabled', String(!status.ok));
    advBtn.dataset.tip = status.ok ? 'Space' : status.reason ?? '';
    setDisabled(oneBtn, status.ok && !status.firstPress ? null : status.reason ?? 'Not now');
  }


  function flyMoney(target: HTMLElement, delta: number) {
    if (reducedMotion() || !delta) return;
    const fly = h('div', { class: `money-fly ${delta > 0 ? 'up' : 'down'}` }, money(delta, { sign: true, cents: !Number.isInteger(delta) }));
    target.append(fly);
    gsap.fromTo(fly, { y: delta > 0 ? 10 : 0, opacity: 0 }, { y: delta > 0 ? -18 : 18, opacity: 1, duration: 0.5, ease: 'power2.out', onComplete: () => void gsap.to(fly, { opacity: 0, duration: 0.6, delay: 0.6, onComplete: () => fly.remove() }) });
    gsap.fromTo(target, { scale: 1 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1 });
  }

  session.on('change', (s, ev) => render(s, ev));
  session.on('loaded', (s) => {
    last = null;
    render(s);
  });
  cal.on('running', () => session.state && renderAdvance(session.s));
  // ---------------------------------------------------------------- end-of-run digest (calm-ui §7)
  let runStart: { year: number; mon: number; cash: number; savings: number; mail: number } | null = null;
  let digestTimer = 0;
  cal.on('running', (on) => {
    const s = session.state;
    if (on && s && !runStart) runStart = { year: s.date.year, mon: s.date.mon, cash: s.propet.cash, savings: s.propet.savings, mail: mailbox().length };
    if (on) put(digest);
  });
  cal.on('stopped', (reason, evs) => {
    const s = session.state;
    const start = runStart;
    runStart = null;
    if (!s || !start || s.extra.ended) return;
    const months = evs.filter((e) => e.type === 'monthAdvanced').length;
    if (!months) return;
    let inc = 0;
    let out = 0;
    let upkeep = 0;
    for (const e of evs) if (e.type === 'cash') {
      if (e.reason === 'livingCost' && e.delta < 0) upkeep += -e.delta;
      else if (e.delta > 0 && e.reason !== 'savingsBox') inc += e.delta;
      else if (e.delta < 0 && e.reason !== 'savingsBox') out += -e.delta;
    }
    const letters = mailbox().length - start.mail;
    const happened = evs.filter((e) => e.type === 'disaster').length;
    const span = start.year === s.date.year ? `${monthName(start.mon, 'short')} → ${monthName(s.date.mon, 'short')} ${s.date.year}` : `${monthName(start.mon, 'short')} ${start.year} → ${monthName(s.date.mon, 'short')} ${s.date.year}`;
    const why: Record<string, string> = { plantingSeason: s.date.mon === 4 ? 'planting season' : 'harvest season', townTalk: 'a new talk in town (optional)', mail: 'mail came', money: 'money is short', disaster: 'something happened', event: 'a letter needs you', letter: 'a letter needs you', neighborHelp: 'a neighbor asks for help' };
    const parts = [`${months} ${months === 1 ? 'month' : 'months'}`, upkeep ? `upkeep −${money(upkeep)}` : null, inc ? `+${money(inc)} in` : null, out ? `−${money(out)} out` : null, letters ? `${letters} ${letters === 1 ? 'letter' : 'letters'} in the mailbox` : null, happened ? `${happened} ${happened === 1 ? 'event' : 'events'}` : null].filter(Boolean) as string[];
    const sums = session.journal.summaries.filter((m) => m.year * 12 + m.mon > start.year * 12 + start.mon);
    const detail = h('ol', { class: 'digest-list', hidden: true }, ...sums.map((m) => h('li', null, h('b', null, `${monthName(m.mon, 'short')} ${m.year}`), ' ', m.lines.join(' · '))));
    const more = h('button', { type: 'button', class: 'digest-more', 'aria-expanded': 'false' }, 'Details');
    more.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      more.setAttribute('aria-expanded', String(!detail.hidden));
      window.clearTimeout(digestTimer);
    });
    const close = h('button', { type: 'button', class: 'digest-x', 'aria-label': 'Dismiss' });
    close.innerHTML = ICONS.close;
    const card = h('div', { class: 'digest', role: 'status' }, h('div', { class: 'digest-head' }, h('b', null, span), why[reason] ? h('span', { class: 'digest-why' }, `· stopped: ${why[reason]}`) : null, more, close), h('div', { class: 'digest-sum' }, parts.join(' · ')), detail);
    close.addEventListener('click', () => put(digest));
    card.addEventListener('pointerenter', () => window.clearTimeout(digestTimer));
    card.addEventListener('pointerleave', () => detail.hidden && armDigest());
    put(digest, card);
    notify(`${span}: ${parts.join(' · ')}`, { icon: 'calendar', quiet: true });
    if (!reducedMotion()) gsap.from(card, { y: 8, opacity: 0, duration: 0.25 });
    armDigest();
  });
  function armDigest() {
    window.clearTimeout(digestTimer);
    digestTimer = window.setTimeout(() => {
      const c = digest.firstElementChild as HTMLElement | null;
      if (!c) return;
      if (reducedMotion()) put(digest);
      else gsap.to(c, { opacity: 0, duration: 0.4, onComplete: () => put(digest) });
    }, 9000);
  }
  app.on('nav', () => put(digest));
  cal.on('month', (s) => {
    leafM.textContent = MONTHS_CAPS[s.date.mon - 1];
    leafY.textContent = String(s.date.year);
  });
  app.on('nav', () => {
    if (session.state) renderHotbar(session.s);
  });
  app.on('sheet', () => session.state && renderHotbar(session.s));
  app.on('busy', (b) => root.classList.toggle('busy', b));
  onRegistry(() => session.state && renderHotbar(session.s));
  renderSpeed();
  return { root, refresh: () => session.state && render(session.s) };
}
