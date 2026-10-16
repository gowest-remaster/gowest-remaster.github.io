// Town Talk on the boardwalk (§5.7): the townsfolk in their original 1996 art, each in a
// wooden frame with a name plate. Click someone to hear their recorded line with a subtitle;
// lines chain as in the original (Norman asks, Sven answers), and someone who only answers
// says their hello (the default line the original never played, the `ttd_` bug). "Hear
// everyone" plays the talk in order; a transcript fills as lines are heard and is kept in the
// Almanac. Read-only (usable while a letter waits). Dev Cut: a second click plays the B take.
import { reproduces, type GameState } from '../../sim/index.ts';
import { getContent } from '../../game/text.ts';
import type { TownTalkLine } from '../../content/content.ts';
import type { App } from '../core/app.ts';
import { rmArt } from '../core/art.ts';
import { audio } from '../core/audio.ts';
import { h, icon, put } from '../core/dom.ts';
import { ICONS } from '../core/icons.ts';
import { glossify } from '../core/glossary.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { btn, sheetFrame } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';
import { TALK_TOPIC } from './street.ts';

const ROLES: Record<string, string> = {
  Ed: 'runs the Grain Elevator',
  'Ma Watson': 'came here 25 years ago',
  Norman: 'works at the bank',
  Harriet: 'keeps the General Store',
  Sven: 'your nearest neighbor',
  Daniel: 'a neighbor who helps build',
  Sophie: 'runs a cattle ranch',
  Kate: 'Sophie’s daughter',
  Jesse: 'Sophie’s son',
};

/** The original resting-cast art for a townsperson (layer 1..9) in a given year. */
export function townsfolkArt(layer: number, year: number): string | null {
  const grown = year >= 1887;
  const key: Record<number, string> = {
    1: '1-1',
    2: '1-2',
    3: '1-3',
    4: '1-4',
    5: grown ? '2-5' : '1-5',
    6: '1-6',
    7: grown ? '2-7' : '1-7',
    8: year >= 1890 ? '2-8' : '1-8k',
    9: year >= 1890 ? '2-9' : '1-9',
  };
  return key[layer] ? rmArt(`ttalk/${key[layer]}`) : null;
}

interface Person {
  layer: number;
  speaker: string;
  line: TownTalkLine | null;
  alt: TownTalkLine | null;
  /** only answers someone else: clicked directly, says hello */
  follower: boolean;
}

function mount(app: App, params: Record<string, unknown>) {
  const tt = getContent().townTalk;
  const id = Number(params.id ?? 101);
  const talk = tt.talks.find((t) => t.talk === id);
  const s = session.state;
  const year = s?.date.year ?? 1880;
  const devcut = !!s?.devcut?.enabled;
  const silentDefaults = s ? reproduces(s.fidelity, 'TTDSILENT') : false;
  const all = talk?.lines ?? [];
  const main = all.filter((l) => !l.alt);
  const chain = tt.chains[String(id)] ?? { followers: {}, defaults: [] };
  // chains are keyed by character number (sprite − 1); layerBySprite maps it to the layer
  const layerOf = (c: number) => tt.layerBySprite[c] ?? c;
  const followers = new Map<number, number[]>(Object.entries(chain.followers).map(([k, v]) => [layerOf(Number(k)), v.map(layerOf)]));
  const followerSet = new Set([...followers.values()].flat());
  const people: Person[] = main.map((l) => ({ layer: l.layer, speaker: l.speaker, line: l, alt: all.find((x) => x.alt && x.layer === l.layer) ?? null, follower: followerSet.has(l.layer) }));
  const order = people.filter((p) => !p.follower);
  const byLayer = new Map(people.map((p) => [p.layer, p]));
  const chairEmpty = !byLayer.has(2) && year >= 1905 && id !== 120;

  // transcript entries in the order heard
  const heard: { layer: number; speaker: string; text: string; kind: 'line' | 'hello' | 'alt' }[] = [];
  const clicks = new Map<number, number>();
  let speaking = -1;
  let token = 0;
  const stage = h('div', { class: 'tt-stage' });
  const transcript = h('ol', { class: 'tt-transcript' });
  // the line being spoken, large, right under the townsfolk (the page itself never grows)
  const live = h('div', { class: 'tt-live', 'aria-live': 'polite' });
  let liveKey = '';

  function render() {
    put(
      stage,
      ...people.map((p) => {
        const art = townsfolkArt(p.layer, year);
        const said = heard.some((x) => x.layer === p.layer);
        const b = h(
          'button',
          { type: 'button', class: `tt-person${said ? ' heard' : ''}${speaking === p.layer ? ' speaking' : ''}`, 'aria-label': `${p.speaker}, ${ROLES[p.speaker] ?? ''}. ${said ? 'Hear again' : 'Listen'}` },
          h('span', { class: 'tt-frame' }, art ? h('img', { class: 'tt-art', src: art, alt: '', draggable: false }) : h('span', { class: 'tt-medal' }, p.speaker[0])),
          h('span', { class: 'tt-plate' }, h('span', { class: 'tt-name' }, p.speaker), h('span', { class: 'tt-role' }, ROLES[p.speaker] ?? '')),
          icon(speaking === p.layer ? ICONS.volume : said ? ICONS.replay : ICONS.talk, 'ico tt-ico'),
        );
        b.addEventListener('click', () => void click(p));
        return b;
      }),
      chairEmpty
        ? h('div', { class: 'tt-person chair', 'data-tip': 'Ma Watson’s chair' }, h('span', { class: 'tt-frame' }, rmArt('ttalk/1-0') ? h('img', { class: 'tt-art', src: rmArt('ttalk/1-0')!, alt: 'An empty rocking chair' }) : null), h('span', { class: 'tt-plate' }, h('span', { class: 'tt-name' }, 'Ma Watson’s chair'), h('span', { class: 'tt-role' }, 'in loving memory')))
        : null,
    );
    put(transcript, ...heard.map((x, i) => h('li', { class: `${i === heard.length - 1 && speaking === x.layer ? 'now' : ''} ${x.kind}` }, h('b', null, x.speaker), h('span', { class: 'verbatim' }, x.text))));
    glossify(transcript);
    if (!heard.length) transcript.append(h('li', { class: 'empty' }, 'Everything said is written down here.'));
    // keep the newest line in view by scrolling only the transcript panel (scrollIntoView also
    // scrolled the sheet sideways and pushed the townsfolk out of sight)
    transcript.scrollTop = transcript.scrollHeight;
    const cur = speaking >= 0 ? heard[heard.length - 1] : null;
    const k = cur ? `${heard.length}|${cur.speaker}` : 'idle';
    if (k !== liveKey) {
      liveKey = k;
      if (cur) {
        const art = townsfolkArt(cur.layer, year);
        put(live, art ? h('img', { class: 'tt-live-face', src: art, alt: '' }) : null, h('div', { class: 'tt-live-body' }, h('b', null, cur.speaker), glossify(h('p', { class: 'verbatim' }, cur.text))));
        live.classList.add('on');
      } else {
        put(live, h('p', { class: 'tt-live-hint' }, heard.length ? 'Click anyone to hear them again, or read it all below.' : 'Click someone to hear what they have to say, or press “Hear everyone”.'));
        live.classList.remove('on');
      }
    }
  }

  async function say(t: number, p: Person, kind: 'line' | 'hello' | 'alt') {
    if (t !== token) return false;
    speaking = p.layer;
    let text = '';
    let voice: string | null = null;
    if (kind === 'hello') {
      const d = tt.defaultLines.find((x) => x.layer === p.layer);
      text = d?.text ?? 'Hello, neighbor.';
      voice = silentDefaults ? null : `TTALK.TTD_${p.layer}`;
    } else {
      const l = kind === 'alt' ? p.alt! : p.line!;
      text = l.text;
      voice = l.voiceId;
    }
    heard.push({ layer: p.layer, speaker: p.speaker, text, kind });
    render();
    if (voice) await audio.playVoice(voice, { speaker: p.speaker, text });
    else await new Promise((r) => setTimeout(r, Math.max(1200, text.split(/\s+/).length * 330)));
    return t === token;
  }

  /** A leader plays their line, then their followers answer, as the original chained them. */
  async function playChain(t: number, p: Person) {
    if (!(await say(t, p, 'line'))) return false;
    for (const f of followers.get(p.layer) ?? []) {
      const fp = byLayer.get(f);
      if (fp && !(await say(t, fp, 'line'))) return false;
    }
    return true;
  }

  async function click(p: Person) {
    const t = ++token;
    audio.stopVoice();
    const n = (clicks.get(p.layer) ?? 0) + 1;
    clicks.set(p.layer, n);
    if (p.follower) await say(t, p, 'hello');
    else if (devcut && p.alt && n % 2 === 0) await say(t, p, 'alt');
    else await playChain(t, p);
    if (t === token) {
      speaking = -1;
      render();
    }
  }

  async function everyone() {
    const t = ++token;
    audio.stopVoice();
    for (const p of order) if (!(await playChain(t, p))) return;
    speaking = -1;
    render();
  }

  const j = session.journal;
  if (!j.talks.includes(id)) j.talks.push(id);
  const issue = getNewsIssue(id);
  const { el } = sheetFrame(
    {
      title: TALK_TOPIC[id] ? `Town talk: ${TALK_TOPIC[id]}` : 'Town Talk',
      eyebrow: 'The boardwalk, Main Street',
      sub: `${talk?.title?.replace(/\s*\(.*\)$/, '') ?? ''}${id === 101 ? '' : ' · a new conversation this month'}`,
      icon: 'talk',
      onClose: () => app.closeSheet('talk'),
      foot: [
        btn('Hear everyone', { kind: 'go', icon: 'volume', onClick: () => void everyone() }),
        btn('Read it all', { kind: 'ghost', title: 'Show every line without playing the voices', onClick: () => {
          token++;
          audio.stopVoice();
          speaking = -1;
          heard.length = 0;
          for (const p of order) {
            heard.push({ layer: p.layer, speaker: p.speaker, text: p.line!.text, kind: 'line' });
            for (const f of followers.get(p.layer) ?? []) {
              const fp = byLayer.get(f);
              if (fp?.line) heard.push({ layer: fp.layer, speaker: fp.speaker, text: fp.line.text, kind: 'line' });
            }
          }
          render();
        } }),
        issue ? btn('Read the newspaper on the bench', { kind: 'brass', icon: 'news', onClick: () => void app.go('newspaper', { issue }) }) : null,
        h('span', { class: 'small muted tt-kept' }, 'Everything said here is kept in your Almanac.'),
      ],
      cls: 'talk-sheet',
    },
    h('div', { class: 'tt-grid' }, h('div', { class: 'tt-boardwalk' }, stage), live, h('details', { class: 'tt-side', open: true }, h('summary', { class: 'eyebrow' }, 'Transcript'), transcript)),
  );
  render();
  return {
    el,
    destroy() {
      token++;
      audio.stopVoice();
    },
    update(_s: GameState) {},
  };
}

function getNewsIssue(talkId: number): number | null {
  // news.json is loaded lazily by the newspaper panel; the talk→issue links are fixed (03 §5.2).
  const MAP: Record<number, number> = { 102: 1, 105: 2, 107: 3, 109: 4, 111: 6, 112: 7, 115: 8, 116: 9, 117: 11, 119: 12 };
  return MAP[talkId] ?? null;
}

export function register(_env: PanelEnv) {
  registerPanel({ id: 'talk', title: 'Town Talk', kind: 'sheet', parent: 'street', readOnly: true, size: 'xl', mount: ({ app, params }) => mount(app, params) });
}
