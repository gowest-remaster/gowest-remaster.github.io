// The prompt layer (§5.12): every sim prompt as a card you can hold. Letters unfold with their
// original letterhead, verbatim text and signature; decisions show consequence chips (from a
// dry run of the real resolver); donations get a coin purse with the standing bands; the
// doctor, wedding, baby, budget and questionnaire get their own small UIs. "Look around first"
// docks the card as an envelope so the player can browse before answering.
import gsap from 'gsap';
import { doctorListItems, eventTextId, type Command, type EventChoice, type GameState, type Prompt, type SimEvent } from '../../sim/index.ts';
import { lines, member } from '../../game/text.ts';
import type { App } from '../core/app.ts';
import { letterhead, portrait, signature, speakerFor } from '../core/art.ts';
import { audio } from '../core/audio.ts';
import { h, icon, linesBlock, prose, put, type Children } from '../core/dom.ts';
import { CROP_NAMES, money, monthName, num } from '../core/format.ts';
import { lastLoss } from '../core/calendar.ts';
import { ICONS } from '../core/icons.ts';
import { session } from '../core/session.ts';
import { reducedMotion, rm } from '../core/settings.ts';
import { choicePreview, preview, type Effects } from '../core/simapi.ts';
import { badgeIf, devcutContent, letterText, T } from '../core/text.ts';
import { assetUrl } from '../devcut/content.ts';
import { glossify } from '../core/glossary.ts';
import { quietPrompt, settleQuiet } from '../core/quiet.ts';
import { btn, chip, stepper, toast } from './kit.ts';

const item = (line: string[], n: number) => line[n - 1] ?? '';
const iv = (line: string[], n: number) => Number(item(line, n)) || 0;
const choiceLine = (n: number) => (lines('Text2')[n - 1] ?? '').trim();

let lastDisaster: Extract<SimEvent, { type: 'disaster' }> | null = null;

// ---------------------------------------------------------------------------
// consequence chips
// ---------------------------------------------------------------------------
export function effectChips(e: Effects, opts: { forceClear?: boolean } = {}): HTMLElement | null {
  const level = opts.forceClear ? 'clear' : rm().assists.chips;
  if (level === 'off') return null;
  const story = level === 'story';
  const out: (HTMLElement | null)[] = [];
  if (e.refused) out.push(chip('Not enough money', { icon: 'warn', tone: 'bad' }));
  else {
    const m = e.money;
    if (m) out.push(chip(story ? '' : `${money(m, { sign: true, cents: !Number.isInteger(m) })}`, { icon: 'coin', tone: m > 0 ? 'good' : 'bad', title: m > 0 ? 'Money in' : 'Money out' }));
    if (e.bank) out.push(chip(story ? '' : `${money(e.bank, { cents: true })} at the bank`, { icon: 'bank', tone: 'good' }));
    if (e.score) out.push(chip(story ? '' : `★ ${e.score > 0 ? '+' : ''}${e.score} standing`, { icon: 'star', tone: e.score > 0 ? 'good' : 'bad', title: 'Standing' }));
    if (e.upkeep) out.push(chip(story ? '' : `Upkeep ${e.upkeep > 0 ? '+' : '−'}${money(Math.abs(e.upkeep))}/mo`, { icon: 'kettle', tone: e.upkeep > 0 ? 'bad' : 'good', title: 'Monthly upkeep' }));
    if (e.helpers) out.push(chip(story ? '' : `${e.helpers > 0 ? '+' : ''}${e.helpers} family helper`, { icon: 'people', tone: e.helpers > 0 ? 'good' : 'bad', title: 'Family helpers in the field' }));
    if (level === 'detailed' && e.followUp) out.push(chip('A letter may follow later', { icon: 'letter', tone: 'info' }));
    if (!out.length) out.push(chip(story ? '' : 'No change to money or standing', { icon: 'check', tone: 'neutral' }));
  }
  return h('div', { class: `chips${story ? ' story' : ''}` }, ...out);
}

// ---------------------------------------------------------------------------
// letter paper and speech (also used by the Mailbox to reread letters)
// ---------------------------------------------------------------------------
export function letterPaper(s: GameState, id: string, had: string, sig: string, dear: boolean) {
  const lt = letterText(s, id, dear);
  const head = letterhead(had);
  const sg = signature(sig);
  return h(
    'div',
    { class: 'paper-letter' },
    head ? h('img', { class: 'lh', src: head, alt: '' }) : h('div', { class: 'lh-rule' }),
    h('div', { class: 'letter-text verbatim' }, linesBlock(lt.text)),
    sg ? h('img', { class: 'sig', src: sg, alt: 'signature' }) : null,
    badgeIf(lt),
  );
}

export function speech(s: GameState, textId: string, dbox: string | undefined | null) {
  const r = T(s, textId);
  const por = portrait(dbox);
  const who = speakerFor(dbox, s.propet.babyNames);
  return h(
    'div',
    { class: 'speech big' },
    por ? h('div', { class: 'portrait lg', style: { backgroundImage: `url("${por}")` } }) : null,
    h('div', { class: 'speech-text' }, who ? h('div', { class: 'who' }, who) : null, prose(r.text, 'prose verbatim'), badgeIf(r)),
  );
}


// ---------------------------------------------------------------------------
// the layer
// ---------------------------------------------------------------------------
export function mountLetters(app: App) {
  const host = app.promptHost;
  let key = '';
  let held = false;
  let cardEl: HTMLElement | null = null;
  const dock = h('button', { type: 'button', class: 'letter-dock', hidden: true }, icon(ICONS.mail), h('span', { class: 'dock-t' }, 'A letter is waiting'), h('span', { class: 'dock-cta' }, 'Answer'));
  dock.addEventListener('click', () => {
    held = false;
    app.closeSheets();
    render();
  });
  host.append(dock);

  const answer = (cmd: Command, label: string, opts: { undoToast?: boolean } = {}) => {
    const before = session.s;
    const r = session.run(cmd, label);
    const moved = before.propet.cash + before.propet.savings !== r.state.propet.cash + r.state.propet.savings || before.propet.score !== r.state.propet.score;
    if (opts.undoToast && moved && session.canUndo) toast(/[.!?”"]$/.test(label) ? label : `${label}.`, { icon: 'check', tone: 'good', quiet: true, action: { label: 'Undo', onClick: () => session.undo() }, seconds: 10 });
    return r;
  };

  let settling = false;
  function render() {
    const s = session.state;
    const p = s?.pending ?? null;
    // a prompt that asks nothing is answered quietly and kept in the Mailbox (core/quiet.ts)
    if (p && s && !app.busy && quietPrompt(s)) {
      if (!settling) {
        settling = true;
        queueMicrotask(() => {
          settling = false;
          const r = settleQuiet();
          if (r?.note) toast(r.note, { icon: r.mail?.kind === 'letter' ? 'mail' : 'talk', action: r.mail ? { label: 'Read', onClick: () => void app.go('mailbox', { at: r.mail!.at }) } : undefined });
        });
      }
      return;
    }
    const visible = !!p && !app.busy && !app.screen && !s?.extra.ended;
    const k = p ? JSON.stringify(p) : '';
    if (!visible) {
      if (cardEl) {
        cardEl.remove();
        cardEl = null;
      }
      dock.hidden = true;
      host.classList.remove('open');
      if (!p) key = '';
      return;
    }
    if (k !== key) {
      key = k;
      held = false;
      cardEl?.remove();
      cardEl = build(s!, p!);
      // glossary words in the questionnaire, budgets and choice lists too (prose is already linked)
      cardEl.querySelectorAll<HTMLElement>('.checklist .lbl, .vig-t').forEach((el) => glossify(el));
      host.append(cardEl);
      if (!reducedMotion()) {
        const paper = cardEl.querySelector('.pcard');
        if (paper) gsap.from(paper, { opacity: 0, y: 30, rotate: -1.5, scale: 0.96, duration: 0.45, ease: 'back.out(1.4)' });
      }
      audio.sfx(p!.kind === 'event' || p!.kind === 'politicianLetter' ? 'envelope' : 'paper');
      app.announce('A letter needs your answer.');
    }
    cardEl!.hidden = held;
    dock.hidden = !held;
    host.classList.toggle('open', !held);
  }

  function hold() {
    held = true;
    render();
    toast('Your letter waits at the top of the screen. Look around, then answer.', { icon: 'mail', quiet: true });
  }

  // ---------------------------------------------------------------- card shell
  function shell(o: { kind: 'letter' | 'speech' | 'notice' | 'disaster' | 'certificate'; eyebrow: string; title?: string; body: Children; actions: Children; holdable?: boolean; cls?: string }) {
    const peek = o.holdable !== false
      ? h('div', { class: 'peek' },
          btn('Look around first', { kind: 'link', icon: 'eye', onClick: hold, title: 'Keep the letter and browse; answer when ready' }),
          btn('Ledger', { kind: 'link', small: true, onClick: () => { hold(); void app.go('ledger'); } }),
          btn('Almanac', { kind: 'link', small: true, onClick: () => { hold(); void app.go('almanac'); } }),
          btn('Goals', { kind: 'link', small: true, onClick: () => { hold(); void app.go('goals'); } }))
      : null;
    const card = h(
      'div',
      { class: `pcard pcard-${o.kind} ${o.cls ?? ''}`, role: 'dialog', 'aria-modal': 'false', 'aria-label': o.title ?? o.eyebrow, 'data-holdable': o.holdable === false ? 'false' : 'true' },
      h('div', { class: 'pc-eyebrow' }, o.eyebrow),
      o.title ? h('h2', { class: 'pc-title' }, o.title) : null,
      h('div', { class: 'pc-body' }, ...o.body),
      h('div', { class: 'pc-actions' }, ...o.actions),
      peek,
    );
    return h('div', { class: 'pwrap' }, h('div', { class: 'pbackdrop' }), card);
  }

  // ---------------------------------------------------------------- per prompt
  function build(s: GameState, p: Prompt): HTMLElement {
    switch (p.kind) {
      case 'message':
        return buildMessage(s, p);
      case 'neighborHelp': {
        const box = s.date.year < 1887 ? 'DBox1' : 'DBox19';
        const yes = preview(s, { type: 'answerNeighborHelp', yes: true });
        const debtNote = h('div', { class: 'callout' }, `Helping takes ${p.days} days and costs about ${money(Math.round((p.days * s.propet.lifePrice) / 30))} of upkeep. If you refuse, your debt is cleared too, but neighbors won't help in your field until ${s.date.mon <= 6 ? 'November' : 'next June'}.`);
        return shell({
          kind: 'speech',
          eyebrow: 'Your neighbor asks for help',
          body: [speech(s, 'MyHelp', box), debtNote],
          actions: [
            h('div', { class: 'opt' }, btn(`Yes, help for ${p.days} days`, { kind: 'go', onClick: () => answer({ type: 'answerNeighborHelp', yes: true }, 'Helped the neighbors') }), effectChips(yes)),
            h('div', { class: 'opt' }, btn('Not this time', { kind: 'ghost', onClick: () => answer({ type: 'answerNeighborHelp', yes: false }, 'Refused to help the neighbors') }), chip(`No neighbors in your field until ${s.date.mon <= 6 ? 'November' : 'next June'}`, { icon: 'people', tone: 'bad' })),
          ],
        });
      }
      case 'houseOffer': {
        const p2 = s.propet;
        const fromBox = Math.max(0, p.cost - p2.cash);
        const pay = fromBox > 0 ? `${money(p.cost)}: ${money(p2.cash)} cash + ${money(fromBox)} from the savings box` : `${money(p.cost)} from your cash`;
        return shell({
          kind: 'speech',
          eyebrow: 'A note from your neighbor',
          body: [speech(s, p.text, 'DBox5'), h('div', { class: 'callout good' }, pay)],
          actions: [
            btn(p.fromHouse === 1 ? 'Yes, buy the furniture' : 'Yes, buy the wooden house', { kind: 'go', onClick: () => answer({ type: 'answerHouseOffer', yes: true }, 'House upgrade') }),
            btn('Not now', { kind: 'ghost', onClick: () => answer({ type: 'answerHouseOffer', yes: false }, 'Declined the house upgrade') }),
          ],
        });
      }
      case 'politicianLetter': {
        const L: Record<number, [string, string, string]> = { 1: ['ALM1', 'Had5', 'SIG50'], 2: ['ALM2', 'Had2', 'SIG1'], 3: ['ALM3', 'Had2', 'SIG1'], 4: ['ALM4', 'Had3', 'SIG4'], 5: ['ALM5', 'Had3', 'SIG4'], 6: ['ALM6', 'Had4', 'SIG6'] };
        const [id, had, sig] = L[p.level] ?? L[1];
        return shell({ kind: 'letter', eyebrow: 'A letter arrives', body: [letterPaper(s, id, had, sig, true)], actions: [btn('Fold it away', { kind: 'go', onClick: () => answer({ type: 'resolveEvent', choice: {} }, 'Read a letter') })] });
      }
      case 'goalChoice':
        return buildGoalChoice(s, p);
      case 'event':
        return buildEvent(s, p);
    }
  }

  /** The consequence in numbers: which squares, what crop, about how much grain and money. */
  function lossDetail(textId: string) {
    const L = lastLoss;
    const want = textId === 'Fire' ? 'fire' : textId === 'GrH' ? 'grasshoppers' : textId.startsWith('NoFence') ? 'cattle' : null;
    if (!L || !want || L.kind !== want || !L.squares.length) return null;
    const crops = new Map<number, number>();
    for (const q of L.squares) crops.set(q.crop, (crops.get(q.crop) ?? 0) + 1);
    const map = h('div', { class: 'loss-map', 'aria-hidden': 'true' }, ...Array.from({ length: 8 }, (_, i) => h('i', { class: L.squares.some((q) => q.n === i + 1) ? 'lost' : '' })));
    return h('div', { class: 'loss' },
      map,
      h('div', null,
        h('div', null, h('b', null, `${L.squares.length} ${L.squares.length === 1 ? 'square' : 'squares'} lost`), ` (${[...crops].map(([c, k]) => `${CROP_NAMES[c]} ×${k}`).join(', ')}): squares ${L.squares.map((q) => q.n).join(', ')}.`),
        L.bushels.max ? h('div', null, `About ${num(L.bushels.min)}–${num(L.bushels.max)} bushels, worth roughly ${money(L.value)} at this year’s price.`) : null,
        h('div', { class: 'small' }, 'The field is bare now: plow again in spring or autumn.')));
  }

  function buildMessage(s: GameState, p: Extract<Prompt, { kind: 'message' }>) {
    const ack = (label = 'OK', then?: () => void) => btn(label, { kind: 'go', onClick: () => { answer({ type: 'ack' }, 'OK'); then?.(); } });
    const t = p.text;
    const pr = s.propet;
    // what happened (disasters)
    const DIS: Record<string, { title: string; icon: keyof typeof ICONS; loss: string; lore: string }> = {
      Fire: { title: 'Prairie fire', icon: 'fire', loss: 'The fire burned every ripe square in your field.', lore: 'Winter wheat is harvested in spring, before September’s fires.' },
      GrH: { title: 'Grasshoppers', icon: 'leaf', loss: 'A swarm ate your whole ripe crop.', lore: 'Septembers bring fire, hoppers and stray cattle. Harvesting early keeps grain safe in the barn.' },
      Rep: { title: 'Tornado', icon: 'warn', loss: 'The storm wrecked your barn and your windmill.', lore: 'Rebuild them from their blueprints on the homestead before November, or your animals won’t survive the winter.' },
      NoFence1: { title: 'Stray cattle', icon: 'pen', loss: `Cattle trampled ${lastDisaster?.squares ?? 'some'} ripe ${lastDisaster?.squares === 1 ? 'square' : 'squares'}.`, lore: 'Barbed wire arrives in the General Store catalogue in April 1883.' },
      NoFence2: { title: 'Stray cattle', icon: 'pen', loss: `Cattle trampled ${lastDisaster?.squares ?? 'some'} ripe ${lastDisaster?.squares === 1 ? 'square' : 'squares'}.`, lore: 'A barbed-wire fence from the General Store keeps the cattle out.' },
      NoFence3: { title: 'Stray cattle', icon: 'pen', loss: 'The cattle broke through your wooden fence.', lore: 'Barbed wire holds where wood gives way.' },
      AnimD: { title: 'A hard winter', icon: 'snow', loss: 'The cold killed your cows and pigs; one horse survived. Upkeep rises $10 a month for milk.', lore: 'Animals need a barn to survive the winter.' },
    };
    if (DIS[t]) {
      const d = DIS[t];
      return shell({
        kind: 'disaster',
        eyebrow: 'What happened',
        title: d.title,
        body: [h('div', { class: 'dis-ico' }, icon(ICONS[d.icon])), speech(s, t, p.dbox), h('div', { class: 'callout warn' }, d.loss, lossDetail(t)), h('div', { class: 'lore' }, icon(ICONS.book), h('span', null, h('b', null, 'Why: '), d.lore))],
        actions: [ack('I understand')],
        holdable: false,
      });
    }
    if (t === 'T623')
      return shell({ kind: 'notice', eyebrow: 'April 1880', title: 'Your sod house is built!', body: [speech(s, t, p.dbox), h('div', { class: 'callout good' }, 'Next: build a barn (its blueprint is on the homestead) and buy a windmill at the General Store.')], actions: [ack('Thank you, neighbors')], holdable: false });
    if (t === 'TakeMail')
      return shell({ kind: 'notice', eyebrow: 'The mailbox', title: 'You have mail', body: [h('div', { class: 'envelope' }, icon(ICONS.mail), h('span', { class: 'verbatim' }, T(s, t).text))], actions: [ack('Open the letter')], holdable: false });
    if (t === 'NoM2') {
      const need = Math.max(1, Math.ceil(pr.lifePrice - pr.cash));
      const one = Math.min(pr.savings, need);
      return shell({
        kind: 'speech', eyebrow: 'Money is short', body: [speech(s, t, p.dbox)],
        actions: [
          btn(`Take ${money(one)} from the box`, { kind: 'go', icon: 'box', onClick: () => { answer({ type: 'ack' }, 'OK'); if (!session.blocked) session.run({ type: 'withdrawSavings', amount: one }, 'Took money from the savings box'); } }),
          pr.savings > one ? btn(`Take all ${money(pr.savings)}`, { kind: 'brass', onClick: () => { answer({ type: 'ack' }, 'OK'); if (!session.blocked) session.run({ type: 'withdrawSavings', amount: session.s.propet.savings }, 'Emptied the savings box'); } }) : null,
          ack('Later'),
        ],
      });
    }
    if (t === 'NoM3') return shell({ kind: 'speech', eyebrow: 'Money is short', body: [speech(s, t, p.dbox)], actions: [ack('Go to the elevator', () => void app.go('elevator')), ack('Later')] });
    if (t === 'NoM4' || t === 'LoanRet') return shell({ kind: 'speech', eyebrow: t === 'LoanRet' ? 'The bank' : 'Money is short', body: [speech(s, t, p.dbox)], actions: [ack('Go to the bank', () => void app.go('bank')), ack('Later')] });
    if (t === 'NOM5' || t === 'LoanEnd' || t === 'GameIsOver') return shell({ kind: 'speech', eyebrow: 'The end of the trail', body: [speech(s, t, p.dbox)], actions: [ack('Go on')], holdable: false });
    if (t === 'Extra1' || t === 'Extra2') {
      return shell({ kind: 'notice', eyebrow: 'Election day', title: t === 'Extra2' ? 'You won the election!' : 'The votes are counted', body: [speech(s, t, p.dbox)], actions: [ack()] });
    }
    if (t === 'NoM' || t === 'Sys836') return shell({ kind: 'speech', eyebrow: 'Not quite', body: [speech(s, t, p.dbox)], actions: [ack('Try again')], holdable: false });
    if (t === 'NOM1') return shell({ kind: 'speech', eyebrow: 'Your neighbors', body: [speech(s, t, p.dbox), h('div', { class: 'chips' }, chip('+$100', { icon: 'coin', tone: 'good' }))], actions: [ack('Thank you')] });
    return shell({ kind: 'speech', eyebrow: speakerFor(p.dbox, s.propet.babyNames) ?? 'A word from Longview', body: [speech(s, t, p.dbox)], actions: [ack()] });
  }

  function buildGoalChoice(s: GameState, p: Extract<Prompt, { kind: 'goalChoice' }>) {
    const raw = (member(p.text) ?? '').replace(/\r/g, '');
    const parts = raw.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    const intro = parts.slice(0, parts.length - p.answers.length).join('\n\n');
    const opts = parts.slice(parts.length - p.answers.length);
    return shell({
      kind: 'certificate',
      eyebrow: 'You reached your goal! ★',
      title: 'What will you do next?',
      body: [prose(intro, 'prose verbatim')],
      actions: opts.map((o, i) => {
        const a = p.answers[i];
        const what = a === 4 ? 'The story ends here, with your family history.' : a === s.begin.goal ? 'Play on to 1919 with the goal you reached.' : a === 2 ? 'A new goal: Businessperson, checked in June 1909.' : a === 3 ? 'A new goal: Politician, checked in June 1915.' : 'Play on to 1919 with the goal you reached.';
        return btn([h('span', { class: 'opt-main' }, o), h('small', { class: 'opt-sub' }, what)], { kind: a === 4 ? 'ghost' : 'brass', cls: 'opt-wide', onClick: () => answer({ type: 'resolveEvent', choice: { option: i + 1 } }, 'Chose what comes next') });
      }),
      holdable: false,
    });
  }

  function buildEvent(s: GameState, p: Extract<Prompt, { kind: 'event' }>) {
    const line = s.events[p.line];
    const type = iv(line, 4);
    const tid = eventTextId(s, p);
    const resolve = (choice: EventChoice, label: string) => answer({ type: 'resolveEvent', choice }, label, { undoToast: true });
    const yesNo = (yesLabel: string, noLabel: string, yesChoice: EventChoice = { yes: true }, noChoice: EventChoice = { yes: false }) => [
      h('div', { class: 'opt' }, btn(yesLabel, { kind: 'go', onClick: () => resolve(yesChoice, yesLabel) }), effectChips(choicePreview(s, yesChoice))),
      h('div', { class: 'opt' }, btn(noLabel, { kind: 'ghost', onClick: () => resolve(noChoice, noLabel) }), effectChips(choicePreview(s, noChoice))),
    ];
    switch (type) {
      case 1: {
        audio.sting('birth');
        // Dev Cut: BABY.WAV, the cut birth sound (devcut.json audio.birth), under the card
        const dc = s.devcut?.enabled ? devcutContent() : null;
        if (dc?.audio.birth?.asset) void audio.playFile(assetUrl(dc.audio.birth.asset), { volume: 0.8 });
        const daughter = s.date.year === 1884;
        const input = h('input', { type: 'text', maxLength: 10, autocomplete: 'off', placeholder: 'Name', 'aria-label': 'Baby name' }) as HTMLInputElement;
        const go = btn('Welcome to the family', { kind: 'go', icon: 'heart', onClick: () => resolve({ name: input.value.trim() }, `Named the baby ${input.value.trim()}`) });
        const sync = () => {
          input.value = input.value.replace(/[^A-Za-z]/g, '');
          go.disabled = !input.value.trim();
          go.querySelector('.btn-label')!.textContent = input.value.trim() ? `Welcome, ${input.value.trim()}!` : 'Welcome to the family';
        };
        input.addEventListener('input', sync);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && !go.disabled && go.click());
        const names = daughter ? ['Clara', 'Emma', 'Ruth', 'Florence', 'Mary', 'Hattie'] : ['Samuel', 'Henry', 'Walter', 'Thomas', 'Albert', 'Jacob'];
        const sugg = h('div', { class: 'chips' }, ...names.map((n) => { const c = h('button', { type: 'button', class: 'chip name-chip' }, n); c.addEventListener('click', () => { input.value = n; sync(); input.focus(); }); return c; }));
        sync();
        const hideLabel = tid === 'YesHouse';
        return shell({
          kind: 'certificate', eyebrow: `${monthName(s.date.mon)} ${s.date.year}`, title: daughter ? 'A daughter is born' : 'A son is born',
          body: [speech(s, tid, item(line, 7)), h('label', { class: 'name-row' }, hideLabel ? null : h('span', null, choiceLine(iv(line, 6))), input), sugg, effectChips(choicePreview(s, { name: 'Abe' }), { forceClear: rm().assists.chips !== 'off' })],
          actions: [go],
          holdable: false,
        });
      }
      case 2: {
        const lp = s.propet.lifePrice;
        const q26 = s.fidelity.mode === 'classic';
        const t6 = q26 ? Math.trunc((lp * 6) / 100) : (lp * 6) / 100;
        const t10 = q26 ? Math.trunc((lp * 10) / 100) : (lp * 10) / 100;
        let amount = Math.ceil(t10 + 0.01);
        const max = Math.floor(s.propet.cash + s.propet.savings);
        amount = Math.min(amount, max);
        const bands = h('div', { class: 'bands' });
        const sendBtn = btn('', { kind: 'go', onClick: () => resolve({ amount }, `Donated ${money(amount)}`) });
        const purse = h('div', { class: 'purse-note small muted' });
        const renderBands = () => {
          const tier = amount === 0 && !q26 ? 0 : amount <= t6 ? 1 : amount <= t10 ? 2 : 3;
          put(bands,
            h('div', { class: tier === 1 ? 'on' : '' }, h('b', null, '★ +2'), h('span', null, `up to ${money(t6, { cents: !Number.isInteger(t6) })}`)),
            h('div', { class: tier === 2 ? 'on' : '' }, h('b', null, '★ +4'), h('span', null, `up to ${money(t10, { cents: !Number.isInteger(t10) })}`)),
            h('div', { class: tier === 3 ? 'on' : '' }, h('b', null, '★ +6'), h('span', null, `more than ${money(t10, { cents: !Number.isInteger(t10) })}`)));
          sendBtn.querySelector('.btn-label')!.textContent = amount > 0 ? `Send ${money(amount)}` : 'Send nothing';
          const fromBox = Math.max(0, amount - s.propet.cash);
          purse.textContent = `Purse: cash ${money(s.propet.cash, { cents: true })} · box ${money(s.propet.savings, { cents: true })}${fromBox > 0 ? ` · ${money(fromBox)} would come from the box` : ''}`;
        };
        const st = stepper({ value: amount, min: 0, max, format: (v) => money(v), label: 'dollars', onChange: (v) => { amount = v; renderBands(); } });
        renderBands();
        return shell({
          kind: 'letter', eyebrow: 'A letter arrives',
          body: [letterPaper(s, item(line, 5), item(line, 6), item(line, 7), item(line, 12) !== '1'), h('div', { class: 'purse' }, h('span', null, choiceLine(iv(line, 8)) || 'I will give:'), st.el), h('div', { class: 'small muted' }, 'How the town will remember it:'), bands, purse],
          actions: [sendBtn, btn('Not this time', { kind: 'ghost', onClick: () => resolve({ cancel: true }, 'Declined to donate') })],
        });
      }
      case 3:
      case 15: {
        const box = item(line, 7);
        const cl = type === 3 && iv(line, 6) ? choiceLine(iv(line, 6)) : '';
        return shell({ kind: 'speech', eyebrow: 'A family decision', body: [speech(s, tid, box)], actions: yesNo(cl ? `Yes: “${cl}”` : 'Yes', 'No') });
      }
      case 4: {
        if (p.stage === 'main') {
          const charge = preview(s, { type: 'resolveEvent', choice: {} });
          return shell({
            kind: 'speech', eyebrow: 'The doctor calls', body: [speech(s, tid, 'DBox11'), h('div', { class: 'small muted' }, `The visit costs $25, free when your cash is ${money(2 * s.propet.lifePrice)} or less.`), effectChips(charge)],
            actions: [btn('Thank you, doctor', { kind: 'go', onClick: () => resolve({}, "Doctor's visit") })],
          });
        }
        const items = doctorListItems(s.propet.stove > 0);
        const rows = lines(s.propet.stove > 0 ? '0DocList' : 'ListBase').map((l) => l.trim()).filter(Boolean);
        const picks = items.map(() => false);
        const total = h('div', { class: 'list-total' });
        const scoreTiers = [0, 3, 5, 8, 10];
        const upd = () => {
          const n = picks.filter(Boolean).length;
          const t = items.reduce((a, d, i) => a + (picks[i] ? d.price : 0), 0);
          put(total, h('span', null, `Total ${money(t, { cents: true })}`), n ? chip(`★ +${scoreTiers[n]} standing`, { icon: 'star', tone: 'good' }) : chip('Pick what your family needs', { tone: 'neutral' }));
          ok.disabled = t > s.propet.cash + s.propet.savings;
        };
        const list = h('div', { class: 'checklist' }, ...rows.map((r, i) => {
          const m = r.match(/^(.*?):\s*\$\s*([\d.]+)/);
          const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
          cb.addEventListener('change', () => { picks[i] = cb.checked; upd(); });
          const isStove = items[i]?.id === 'stove';
          return h('label', { class: 'check-row' }, cb, h('span', { class: 'lbl' }, m ? m[1] : r, isStove ? h('small', { class: 'muted' }, ' — improves the family’s health; stands in your house') : null), h('span', { class: 'price num' }, m ? `$${m[2].trim()}` : ''));
        }));
        const ok = btn('Buy these', { kind: 'go', onClick: () => resolve({ items: picks }, 'Bought health supplies') });
        upd();
        return shell({ kind: 'certificate', eyebrow: 'The doctor’s list', title: 'For your family’s health', body: [list, total], actions: [ok, btn('No, thank you', { kind: 'ghost', onClick: () => resolve({ cancel: true }, 'Declined the doctor’s list') })] });
      }
      case 5: {
        const box = item(line, 6);
        return shell({ kind: 'speech', eyebrow: speakerFor(box, s.propet.babyNames) ?? 'News from the family', body: [speech(s, tid, box), effectChips(choicePreview(s, {}))], actions: [btn('OK', { kind: 'go', onClick: () => resolve({}, 'OK') })] });
      }
      case 6:
        return shell({
          kind: 'letter', eyebrow: 'A letter arrives',
          body: [letterPaper(s, item(line, 5), item(line, 6), item(line, 7), item(line, 12) !== '1')],
          actions: yesNo(choiceLine(iv(line, 8)) ? `Yes: “${choiceLine(iv(line, 8))}”` : 'Yes', 'No'),
        });
      case 7:
        return shell({
          kind: 'letter', eyebrow: 'A letter arrives',
          body: [letterPaper(s, item(line, 5), item(line, 6), item(line, 7), item(line, 12) !== '1'), effectChips(choicePreview(s, {}))],
          actions: [btn('Fold it away', { kind: 'go', onClick: () => resolve({}, 'Read a letter') })],
        });
      case 9: {
        const raw = (member('ListM8') ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
        const head = raw.slice(0, 4);
        const issues = raw.slice(4, 10);
        const answers = issues.map(() => false);
        const list = h('div', { class: 'checklist' }, ...issues.map((t, i) => { const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.addEventListener('change', () => (answers[i] = cb.checked)); return h('label', { class: 'check-row' }, cb, h('span', { class: 'lbl verbatim' }, t)); }));
        return shell({ kind: 'certificate', eyebrow: head.slice(0, 2).join(' · '), title: 'Where do you stand?', body: [prose(head.slice(2).join('\n\n'), 'prose verbatim'), list], actions: [btn('Send my answers', { kind: 'go', onClick: () => resolve({ answers }, 'Answered the questionnaire') })] });
      }
      case 10: {
        const opts = (member('WL0') ?? member(item(line, 6)) ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).slice(0, 3);
        const ICO: (keyof typeof ICONS)[] = ['home', 'people', 'ring'];
        const cards = opts.map((o, i) => {
          const choice = { option: i + 1 };
          const e = choicePreview(s, choice);
          const price = iv(line, 8 + i);
          const can = s.propet.cash + s.propet.savings >= price;
          const b = h('button', { type: 'button', class: 'vignette', disabled: !can }, icon(ICONS[ICO[i]], 'ico vig-ico'), h('div', { class: 'vig-t verbatim' }, o), h('div', { class: 'big' }, money(price)), effectChips(e), !can ? h('div', { class: 'small bad' }, 'Not enough money') : null);
          b.addEventListener('click', () => resolve(choice, `Paid for ${['a family', 'a small', 'a town-square'][i]} wedding`));
          return b;
        });
        return shell({
          kind: 'speech', eyebrow: 'A wedding in the family',
          body: [speech(s, tid, item(line, 7)), h('div', { class: 'vignettes' }, ...cards), h('div', { class: 'small muted' }, 'The town will talk about it in July.')],
          actions: [h('div', { class: 'opt' }, btn('No paid wedding', { kind: 'ghost', onClick: () => resolve({ cancel: true }, 'No paid wedding') }), effectChips(choicePreview(s, { cancel: true })))],
        });
      }
      case 11: {
        const id = item(line, 5);
        const raw = (member(id) ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
        const n = iv(line, 6);
        const budget = iv(line, 7);
        const costs = Array.from({ length: n }, (_, i) => iv(line, 8 + i));
        const headerEnd = raw.findIndex((l) => /PROJECTS FOR/.test(l));
        const head = raw.slice(0, headerEnd + 1);
        const names: string[] = [];
        for (let i = headerEnd + 1; i < raw.length && names.length < n; i += 2) names.push(raw[i]);
        const picks = costs.map(() => false);
        const meterI = h('i');
        const tot = h('div', { class: 'list-total' });
        const ok = btn('Approve the plan', { kind: 'go', onClick: () => resolve({ projects: picks }, 'Set the town budget') });
        const upd = () => {
          const t = costs.reduce((a, c, i) => a + (picks[i] ? c : 0), 0);
          meterI.style.width = `${Math.min(100, (t / budget) * 100)}%`;
          meterI.parentElement!.classList.toggle('tone-bad', t > budget);
          put(tot, `Spent ${money(t)} of ${money(budget)}`, t > budget ? h('span', { class: 'bad' }, ` · ${money(t - budget)} over`) : null);
          ok.disabled = t > budget;
        };
        const list = h('div', { class: 'checklist' }, ...names.map((t, i) => { const cb = h('input', { type: 'checkbox' }) as HTMLInputElement; cb.addEventListener('change', () => { picks[i] = cb.checked; upd(); }); return h('label', { class: 'check-row' }, cb, h('span', { class: 'lbl verbatim' }, t), h('span', { class: 'price num' }, money(costs[i]))); }));
        const meter = h('div', { class: 'meter tone-brass budget-meter' }, meterI);
        upd();
        return shell({ kind: 'certificate', eyebrow: 'Town council', title: 'The mayor’s budget', body: [prose(head.join('\n\n'), 'prose verbatim small'), list, meter, tot], actions: [ok] });
      }
      default:
        return shell({ kind: 'speech', eyebrow: 'News', body: [speech(s, tid, null)], actions: [btn('OK', { kind: 'go', onClick: () => resolve({}, 'OK') })] });
    }
  }

  session.on('change', (_s, ev) => {
    const d = ev.find((e): e is Extract<SimEvent, { type: 'disaster' }> => e.type === 'disaster');
    if (d) lastDisaster = d;
    render();
  });
  session.on('loaded', () => {
    key = '';
    render();
  });
  app.on('busy', render);
  app.on('nav', render);
  app.holdLetter = (mode) => {
    if (!host.classList.contains('open') || !cardEl) return true;
    const card = cardEl.querySelector<HTMLElement>('.pcard');
    if (card?.dataset.holdable !== 'false') {
      hold();
      return true;
    }
    if (mode !== 'esc') return false;
    // Esc on a notice with a single answer (sod house, disaster, mail) reads as "OK"
    const btns = card.querySelectorAll<HTMLButtonElement>('.pc-actions button:not([disabled])');
    if (btns.length === 1 && !card.querySelector('input, .vignette, .checklist')) btns[0].click();
    return false;
  };
  return { render, hold, get held() { return held; } };
}
