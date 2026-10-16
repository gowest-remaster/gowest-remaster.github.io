// Mail & messages: one sheet behind the bell, two tabs (calm-ui §3, §4).
//  - Letters: letters and notes the game no longer pushes at the player, with their original
//    letterhead, text and signature (the Mailbox);
//  - Messages: everything the game has said, newest first (Recent).
// The money record is the Ledger (in the house, or click Cash); the year's calendar is the Almanac.
import '../styles/books.css';
import type { GameState } from '../../sim/index.ts';
import { h, icon, put } from '../core/dom.ts';
import { money, monthName } from '../core/format.ts';
import { ICONS } from '../core/icons.ts';
import { mailbox, unreadMail, type MailEntry } from '../core/quiet.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { chip, sheetFrame, tabs } from '../ui/kit.ts';
import { letterPaper, speech } from '../ui/letters.ts';
import { markRead, recent, recentAction, unreadCount } from '../ui/notify.ts';
import type { App } from '../core/app.ts';
import type { PanelEnv } from './index.ts';

type Tab = 'letters' | 'messages';

function effectsLine(m: MailEntry) {
  const e = m.effects;
  if (!e) return null;
  const out: HTMLElement[] = [];
  if (e.money) out.push(chip(`${money(e.money, { sign: true, cents: !Number.isInteger(e.money) })}`, { icon: 'coin', tone: e.money > 0 ? 'good' : 'bad' }));
  if (e.score) out.push(chip(`★ ${e.score > 0 ? '+' : ''}${e.score} standing`, { icon: 'star', tone: e.score > 0 ? 'good' : 'bad' }));
  if (e.upkeep) out.push(chip(`Upkeep ${e.upkeep > 0 ? '+' : '−'}${money(Math.abs(e.upkeep))}/mo`, { icon: 'kettle', tone: e.upkeep > 0 ? 'bad' : 'good' }));
  return out.length ? h('div', { class: 'chips' }, ...out) : null;
}

function mountMail(app: App, id: string, params: Record<string, unknown>) {
  let tab: Tab = params.tab === 'messages' ? 'messages' : params.tab === 'letters' ? 'letters' : unreadMail() || !unreadCount() ? 'letters' : 'messages';
  let open: number | null = typeof params.at === 'number' ? params.at : null;
  const tb = tabs<Tab>({
    tabs: [
      { id: 'letters', label: 'Letters', badge: unreadMail() ? String(unreadMail()) : null },
      { id: 'messages', label: 'Everything said' },
    ],
    value: tab,
    onChange: (v) => ((tab = v), render(session.s)),
  });
  const f = sheetFrame({ title: 'Mail & messages', icon: 'mail', sub: 'Letters you were sent, and every message the game has given you. Money records are in the Ledger.', onClose: () => app.closeSheet(id), cls: 'mailbox', tabs: tb.el });

  function letters(s: GameState) {
    const list = [...mailbox()].reverse();
    if (open === null) open = list.find((m) => !m.read)?.at ?? list[0]?.at ?? null;
    const cur = list.find((m) => m.at === open) ?? null;
    if (cur && !cur.read) {
      cur.read = true;
      queueMicrotask(() => app.emit('sheet', id));
    }
    if (!list.length) return h('div', { class: 'empty' }, 'No letters yet. Letters and notes that need no answer are kept here for you to read.');
    return h(
      'div',
      { class: 'mail-grid' },
      h('ol', { class: 'mail-list' }, ...list.map((m) => {
        const b = h('button', { type: 'button', class: `mail-item${m.at === open ? ' on' : ''}${m.read ? '' : ' unread'}` }, icon(m.kind === 'letter' ? ICONS.mail : ICONS.talk, 'ico'), h('span', null, h('b', null, m.title), h('small', null, `${monthName(m.mon, 'short')} ${m.year}`)));
        b.addEventListener('click', () => ((open = m.at), render(session.s)));
        return h('li', null, b);
      })),
      h('div', { class: 'mail-read' }, cur
        ? [
            cur.letter ? letterPaper(s, cur.letter.id, cur.letter.had, cur.letter.sig, cur.letter.dear) : cur.speech ? speech(s, cur.speech.textId, cur.speech.dbox) : null,
            effectsLine(cur),
          ]
        : null),
    );
  }

  function messages() {
    markRead();
    const list = [...recent()].reverse();
    if (!list.length) return h('div', { class: 'empty' }, 'Nothing yet. Messages appear here as you play.');
    return h('ol', { class: 'recent-list' }, ...list.map((r) => {
      const act = recentAction(r.at);
      const li = h('li', { class: `tone-${r.tone ?? 'info'}` }, h('span', { class: 'recent-when' }, r.date), h('span', { class: 'recent-what' }, r.speaker ? h('b', null, `${r.speaker}: `) : null, r.text));
      if (act) {
        const b = h('button', { type: 'button', class: 'btn btn-link btn-sm' }, act.label);
        b.addEventListener('click', () => act.onClick());
        li.append(b);
      }
      return li;
    }));
  }

  function render(s: GameState) {
    tb.set(tab);
    put(f.body, tab === 'letters' ? letters(s) : messages());
  }
  return { el: f.el, update: (s: GameState) => render(s) };
}

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'mailbox',
    title: 'Mail & messages',
    kind: 'sheet',
    size: 'lg',
    readOnly: true,
    // one home: the bell on the top bar (and the mailbox on the homestead); M still opens it
    hotbar: { key: 'm', label: 'Mail', icon: ICONS.mail, order: 95, group: 'book', bar: false },
    mount: ({ params }) => mountMail(app, 'mailbox', params),
  });
  // older links ("Recent") open the same sheet on its messages tab
  registerPanel({
    id: 'recent',
    title: 'Mail & messages',
    kind: 'sheet',
    size: 'lg',
    readOnly: true,
    mount: ({ params }) => mountMail(app, 'recent', { tab: 'messages', ...params }),
  });
}
