// Renders every sim prompt (state.pending) and informational dialog event with the verbatim
// content text, and turns the player's answer into a sim Command.
import { doctorListItems, eventTextId, type Command, type GameState, type Prompt, type SimEvent } from '../sim/index.ts';
import { assetUrl, hasOrig, orig } from '../engine/assets.ts';
import { getContent, lines, member, text } from '../game/text.ts';
import { buildLetter } from '../game/letters.ts';
import { h, money, prose } from './dom.ts';
import { openDialog, type DialogButton } from './dialog.ts';

const portraitUrl = (key: string) => (hasOrig(key) ? assetUrl(orig(key).file) : null);

export function portraitFor(dbox: string | undefined | null): string | null {
  if (!dbox || dbox === 'DBox0' || dbox === '0') return null;
  return portraitUrl(`CALEND.${dbox}`) ?? portraitUrl(`FIELD.${dbox}`);
}

export function speakerFor(s: GameState, dbox: string | undefined | null): string | null {
  switch (dbox) {
    case 'DBox2':
    case 'DBox13':
      return 'Lilly Mae';
    case 'DBox12':
      return validName(s.propet.babyNames[1]) ?? 'Your daughter';
    case 'DBox23':
      return validName(s.propet.babyNames[2]) ?? 'Your son';
    case 'DBox01':
    case 'DBox32':
      return validName(s.propet.babyNames[0]) ?? 'Your son';
    case 'DBox1':
    case 'DBox19':
    case 'NeibY':
    case 'NeibO':
      return 'Your neighbor';
    case 'DBox8':
      return 'The banker';
    case 'DBox9':
      return 'The teacher';
    case 'DBox11':
      return 'The doctor';
    case 'DBox5':
      return 'The storekeeper';
    default:
      return null;
  }
}
const validName = (n: string) => (n && n !== 'a' ? n : null);

const ok = <T,>(value: T, label = 'OK'): DialogButton<T> => ({ label, value, primary: true });

/** Default portrait for FIELD / town messages that the sim emits without a DBox. */
function defaultBox(id: string, year: number): string | undefined {
  if (/^(NoPlow|Noplow|NoPlant|NoHarv|StopPlow|StopHarv|FDBK|EndHarv|OneWor|ManyWor|NoMoney|Tractor)/.test(id)) return year < 1887 ? 'NeibY' : 'NeibO';
  if (/^SEG\d/.test(id) && /^SEG(6|7)/.test(id)) return 'DBox5';
  if (/^(Loan|SEG0|BigReturn|NothingToReturn|TakeMoney|needharvest|OK)$/.test(id) || /^SEG0/.test(id)) return 'DBox8';
  if (/^NoM\d|^NOM\d/.test(id)) return year < 1887 ? 'DBox1' : 'DBox19';
  return undefined;
}

/** Informational dialog event (no answer needed). */
export async function showInfo(s: GameState, e: Extract<SimEvent, { type: 'dialog' }>) {
  if (e.id === 'MyGoal') {
    await openDialog({ title: 'Your goal', body: String(e.params?.goal ?? ''), buttons: [ok(true)] });
    return;
  }
  let body = text(e.id);
  if (e.id === 'SEG69' && e.params?.total !== undefined) body = `${body}\n\n${money(Number(e.params.total))}`;
  const box = e.dbox ?? defaultBox(e.id, s.date.year);
  await openDialog({ body, portrait: portraitFor(box), speaker: speakerFor(s, box), buttons: [ok(true)] });
}

/** Ask the pending prompt; resolves with the command answering it. */
export async function askPrompt(s: GameState, p: Prompt): Promise<Command> {
  switch (p.kind) {
    case 'message':
      return askMessage(s, p);
    case 'neighborHelp':
      return askNeighbor(s, p);
    case 'houseOffer':
      return askHouse(s, p);
    case 'politicianLetter':
      return askPolitician(s, p);
    case 'goalChoice':
      return askGoal(s, p.text, p.answers);
    case 'event':
      return askEvent(s, p);
  }
}

async function askMessage(s: GameState, p: Extract<Prompt, { kind: 'message' }>): Promise<Command> {
  if (p.text === 'Extra1' || p.text === 'Extra2') {
    const img = portraitUrl(`CALEND.${p.text.toLowerCase()}`);
    await openDialog({
      title: 'Election day',
      content: img ? h('img', { src: img, class: 'dialog-picture' }) : h('p', null, p.text),
      buttons: [ok(true)],
    });
    return { type: 'ack' };
  }
  await openDialog({ body: text(p.text), portrait: portraitFor(p.dbox), speaker: speakerFor(s, p.dbox), buttons: [ok(true)] });
  return { type: 'ack' };
}

async function askNeighbor(s: GameState, p: Extract<Prompt, { kind: 'neighborHelp' }>): Promise<Command> {
  const box = s.date.year < 1887 ? 'DBox1' : 'DBox19';
  const yes = await openDialog<boolean>({
    body: text('MyHelp'),
    content: h('p', { class: 'note' }, `Helping takes about ${p.days} days.`),
    portrait: portraitFor(box),
    speaker: speakerFor(s, box),
    buttons: [{ label: 'No', value: false, cancel: true }, { label: 'Yes', value: true, primary: true }],
  });
  return { type: 'answerNeighborHelp', yes };
}

async function askHouse(_s: GameState, p: Extract<Prompt, { kind: 'houseOffer' }>): Promise<Command> {
  const yes = await openDialog<boolean>({
    body: text(p.text),
    content: h('p', { class: 'note' }, `Cost: ${money(p.cost)}`),
    buttons: [{ label: 'No', value: false, cancel: true }, { label: 'Yes', value: true, primary: true }],
  });
  return { type: 'answerHouseOffer', yes };
}

const ALM: Record<number, { id: string; had: string; sig: string }> = {
  1: { id: 'ALM1', had: 'Had5', sig: 'SIG50' },
  2: { id: 'ALM2', had: 'Had2', sig: 'SIG1' },
  3: { id: 'ALM3', had: 'Had2', sig: 'SIG1' },
  4: { id: 'ALM4', had: 'Had3', sig: 'SIG4' },
  5: { id: 'ALM5', had: 'Had3', sig: 'SIG4' },
  6: { id: 'ALM6', had: 'Had4', sig: 'SIG6' },
};

async function askPolitician(s: GameState, p: Extract<Prompt, { kind: 'politicianLetter' }>): Promise<Command> {
  const l = ALM[p.level];
  await showLetter(s, l.id, l.had, l.sig, true, [ok(true)]);
  return { type: 'resolveEvent', choice: {} };
}

function letterNode(s: GameState, name: string, had: string, sig: string, dear: boolean): HTMLElement {
  const hadUrl = had && had !== '0' ? portraitUrl(`CALEND.${had}`) : null;
  const sigUrl = sig && sig !== '0' ? portraitUrl(`CALEND.${sig.toUpperCase()}`) : null;
  return h(
    'div',
    { class: 'letter' },
    hadUrl ? h('img', { class: 'letterhead', src: hadUrl, alt: '' }) : null,
    h('div', { class: 'letter-text' }, buildLetter(s, name, dear)),
    sigUrl ? h('img', { class: 'signature', src: sigUrl, alt: '' }) : null,
  );
}

function showLetter<T>(s: GameState, name: string, had: string, sig: string, dear: boolean, buttons: DialogButton<T>[], extra?: Node) {
  return openDialog<T>({ content: h('div', null, letterNode(s, name, had, sig, dear), extra ?? null), buttons, size: 'lg', paper: true, className: 'letter-dialog' });
}

function choiceLine(n: number): string {
  return (lines('Text2')[n - 1] ?? '').trim();
}

async function askGoal(_s: GameState, textId: string, answers: number[]): Promise<Command> {
  // The goal texts list the options after "I want to"; the answers map them to goal numbers.
  const raw = (member(textId) ?? '').replace(/\r/g, '');
  const parts = raw.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const intro = parts.slice(0, parts.length - answers.length).join('\n\n');
  const opts = parts.slice(parts.length - answers.length);
  let picked = 1;
  const list = h('div', { class: 'choices' });
  opts.forEach((o, i) => {
    const id = `goal-${i}`;
    list.append(h('label', { class: 'choice', for: id }, h('input', { type: 'radio', name: 'goal', id, checked: i === 0, onchange: () => (picked = i + 1) }), h('span', null, o)));
  });
  await openDialog({ body: intro, content: list, buttons: [ok(true)], size: 'lg' });
  return { type: 'resolveEvent', choice: { option: picked } };
}

// ---------------------------------------------------------------------------
// Scheduled events (types 1..15)
// ---------------------------------------------------------------------------

const item = (line: string[], n: number) => line[n - 1] ?? '';

async function askEvent(s: GameState, p: Extract<Prompt, { kind: 'event' }>): Promise<Command> {
  const line = s.events[p.line];
  const type = Number(item(line, 4));
  const tid = eventTextId(s, p);
  const yesNo = (label?: string): DialogButton<boolean>[] => [
    { label: 'No', value: false, cancel: true },
    { label: label ?? 'Yes', value: true, primary: true },
  ];
  switch (type) {
    case 1: {
      // Baby naming: Text2 line (item 6) "My baby's name is:"
      const input = h('input', { type: 'text', class: 'field', maxLength: 10, autocomplete: 'off', placeholder: 'Name' }) as HTMLInputElement;
      input.addEventListener('input', () => (input.value = input.value.replace(/[^A-Za-z]/g, '')));
      const box = item(line, 7);
      const content = h('label', { class: 'inline-field' }, h('span', null, choiceLine(Number(item(line, 6)))), input);
      await openDialog({
        body: text(tid),
        content,
        portrait: portraitFor(box),
        buttons: [{ label: 'OK', value: true, primary: true, disabled: () => input.value.trim().length === 0 }],
        onMount: (_el, api) => input.addEventListener('input', api.refresh),
      });
      return { type: 'resolveEvent', choice: { name: input.value.trim() } };
    }
    case 2: {
      const input = h('input', { type: 'text', inputMode: 'numeric', class: 'field money-field', maxLength: 5, autocomplete: 'off', placeholder: '0' }) as HTMLInputElement;
      input.addEventListener('input', () => (input.value = input.value.replace(/\D/g, '')));
      const extra = h('label', { class: 'inline-field' }, h('span', null, choiceLine(Number(item(line, 8)))), h('span', { class: 'dollar' }, '$'), input);
      const res = await showLetter<'ok' | 'cancel'>(s, item(line, 5), item(line, 6), item(line, 7), item(line, 12) !== '1', [
        { label: 'Cancel', value: 'cancel', cancel: true },
        { label: 'OK', value: 'ok', primary: true, disabled: () => !(Number(input.value) > 0) },
      ], extra);
      if (res === 'cancel') return { type: 'resolveEvent', choice: { cancel: true } };
      return { type: 'resolveEvent', choice: { amount: Number(input.value) } };
    }
    case 3:
    case 15: {
      const box = item(line, 7);
      const yes = await openDialog<boolean>({
        body: text(tid),
        content: type === 3 && Number(item(line, 6)) ? h('p', { class: 'choice-line' }, choiceLine(Number(item(line, 6)))) : undefined,
        portrait: portraitFor(box),
        speaker: speakerFor(s, box),
        buttons: yesNo(),
      });
      return { type: 'resolveEvent', choice: { yes } };
    }
    case 4: {
      if (p.stage === 'main') {
        await openDialog({ body: text(tid), portrait: portraitFor('DBox11'), speaker: 'The doctor', buttons: [ok(true)] });
        return { type: 'resolveEvent', choice: {} };
      }
      return askDoctorList(s);
    }
    case 5: {
      const box = item(line, 6);
      await openDialog({ body: text(tid), portrait: portraitFor(box), speaker: speakerFor(s, box), buttons: [ok(true)] });
      return { type: 'resolveEvent', choice: {} };
    }
    case 6: {
      const yes = await showLetter<boolean>(s, item(line, 5), item(line, 6), item(line, 7), item(line, 12) !== '1', yesNo(), h('p', { class: 'choice-line' }, choiceLine(Number(item(line, 8)))));
      return { type: 'resolveEvent', choice: { yes } };
    }
    case 7: {
      await showLetter(s, item(line, 5), item(line, 6), item(line, 7), item(line, 12) !== '1', [ok(true)]);
      return { type: 'resolveEvent', choice: {} };
    }
    case 9:
      return askQuestionnaire();
    case 10:
      return askWedding(s, line, tid);
    case 11:
      return askBudget(line);
    default:
      await openDialog({ body: text(tid), buttons: [ok(true)] });
      return { type: 'resolveEvent', choice: {} };
  }
}

async function askDoctorList(s: GameState): Promise<Command> {
  const id = s.propet.stove > 0 ? '0DocList' : 'ListBase';
  const rows = lines(id).map((l) => l.trim()).filter(Boolean);
  const items = doctorListItems(s.propet.stove > 0);
  const checks = items.map(() => false);
  const total = h('div', { class: 'list-total' });
  const upd = () => (total.textContent = `Total: ${money(items.reduce((a, d, i) => a + (checks[i] ? d.price : 0), 0))}`);
  const list = h('div', { class: 'checklist' });
  rows.forEach((r, i) => {
    const m = r.match(/^(.*?):\s*\$\s*([\d.]+)/);
    const label = m ? m[1] : r;
    const price = m ? `$${m[2].trim()}` : '';
    list.append(h('label', { class: 'check-row' }, h('input', { type: 'checkbox', onchange: (e: Event) => ((checks[i] = (e.target as HTMLInputElement).checked), upd()) }), h('span', { class: 'lbl' }, label), h('span', { class: 'price' }, price)));
  });
  upd();
  const res = await openDialog<'ok' | 'cancel'>({
    title: 'For your family’s health',
    content: h('div', null, list, total),
    portrait: portraitFor('DBox11'),
    speaker: 'The doctor',
    buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'OK', value: 'ok', primary: true }],
  });
  if (res === 'cancel') return { type: 'resolveEvent', choice: { cancel: true } };
  return { type: 'resolveEvent', choice: { items: checks } };
}

async function askWedding(s: GameState, line: string[], tid: string): Promise<Command> {
  const opts = (member('WL0') ?? member(item(line, 6)) ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  let picked = 0;
  const list = h('div', { class: 'choices' });
  opts.slice(0, 3).forEach((o, i) => {
    const id = `wed-${i}`;
    list.append(h('label', { class: 'choice', for: id }, h('input', { type: 'radio', name: 'wed', id, onchange: () => ((picked = i + 1), api?.refresh()) }), h('span', null, o), h('span', { class: 'price' }, money(Number(item(line, 8 + i))))));
  });
  let api: { refresh(): void } | undefined;
  const box = item(line, 7);
  const res = await openDialog<'ok' | 'cancel'>({
    body: text(tid),
    content: list,
    portrait: portraitFor(box),
    speaker: speakerFor(s, box),
    size: 'lg',
    buttons: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: 'OK', value: 'ok', primary: true, disabled: () => picked === 0 }],
    onMount: (_e, a) => (api = a),
  });
  if (res === 'cancel') return { type: 'resolveEvent', choice: { cancel: true } };
  return { type: 'resolveEvent', choice: { option: picked } };
}

async function askQuestionnaire(): Promise<Command> {
  const raw = (member('ListM8') ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const head = raw.slice(0, 4);
  const issues = raw.slice(4, 10);
  const answers = issues.map(() => false);
  const list = h('div', { class: 'checklist' });
  issues.forEach((t, i) => list.append(h('label', { class: 'check-row' }, h('input', { type: 'checkbox', onchange: (e: Event) => (answers[i] = (e.target as HTMLInputElement).checked) }), h('span', { class: 'lbl' }, t))));
  await openDialog({ title: `${head[0]} · ${head[1]}`, body: head.slice(2).join('\n\n'), content: list, size: 'lg', buttons: [ok(true)] });
  return { type: 'resolveEvent', choice: { answers } };
}

async function askBudget(line: string[]): Promise<Command> {
  const id = item(line, 5);
  const raw = (member(id) ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const n = Number(item(line, 6));
  const budget = Number(item(line, 7));
  const costs = Array.from({ length: n }, (_, i) => Number(item(line, 8 + i)));
  // header lines, then project/cost pairs, then TOTAL
  const headerEnd = raw.findIndex((l) => /PROJECTS FOR/.test(l));
  const head = raw.slice(0, headerEnd + 1);
  const names: string[] = [];
  for (let i = headerEnd + 1; i < raw.length && names.length < n; i += 2) names.push(raw[i]);
  const picks = costs.map(() => false);
  const total = h('div', { class: 'list-total' });
  const upd = () => {
    const t = costs.reduce((a, c, i) => a + (picks[i] ? c : 0), 0);
    total.textContent = `TOTAL: ${money(t)} of ${money(budget)}`;
    total.classList.toggle('over', t > budget);
  };
  const list = h('div', { class: 'checklist' });
  names.forEach((t, i) => list.append(h('label', { class: 'check-row' }, h('input', { type: 'checkbox', onchange: (e: Event) => ((picks[i] = (e.target as HTMLInputElement).checked), upd()) }), h('span', { class: 'lbl' }, t), h('span', { class: 'price' }, money(costs[i])))));
  upd();
  await openDialog({ body: head.join('\n\n'), content: h('div', null, list, total), size: 'lg', buttons: [ok(true)] });
  return { type: 'resolveEvent', choice: { projects: picks } };
}

// ---------------------------------------------------------------------------
// Town talk (text version; voiced playback comes with the TTALK scene)
// ---------------------------------------------------------------------------

export async function showTownTalk(id: number) {
  const talk = getContent().townTalk.talks.find((t) => t.talk === id);
  if (!talk) return;
  const body = h('div', { class: 'talk' });
  for (const l of talk.lines.filter((x) => !x.alt)) body.append(h('div', { class: 'talk-line' }, h('div', { class: 'talk-speaker' }, l.speaker), prose(l.text, 'talk-text')));
  await openDialog({ title: 'Town talk', content: body, size: 'lg', className: 'talk-dialog', buttons: [ok(true, 'Thank you, neighbors')] });
}
