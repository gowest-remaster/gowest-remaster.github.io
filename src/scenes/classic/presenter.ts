// Fallback presentation of sim dialogs for movies that have no dialog of their own: a
// Windows 95 message box over the stage (as Lingo's `alert` showed in the original) for
// plain messages, and the shared prompt dialogs for anything that needs an answer. Movies
// with original dialog art (CALEND DBoxes, FIELD neighbours...) override these.
import type { Presenter } from '../../engine/game.ts';
import { askPrompt, showTownTalk } from '../../ui/prompts.ts';
import { text } from '../../game/text.ts';
import type { ClassicContext } from './context.ts';

export function stageAlert(host: HTMLElement, body: string, buttons: string[] = ['OK']): Promise<number> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'classic-alert-back';
    const box = document.createElement('div');
    box.className = 'classic-alert';
    const title = document.createElement('div');
    title.className = 'classic-alert-title';
    title.textContent = 'Go West!';
    const msg = document.createElement('div');
    msg.className = 'classic-alert-msg';
    msg.textContent = body.replace(/\r/g, '\n');
    const row = document.createElement('div');
    row.className = 'classic-alert-buttons';
    const done = (i: number) => {
      window.removeEventListener('keydown', key, true);
      back.remove();
      resolve(i);
    };
    buttons.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b;
      btn.onclick = () => done(i);
      row.append(btn);
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter') done(0);
      else if (e.key === 'Escape') done(buttons.length - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', key, true);
    box.append(title, msg, row);
    back.append(box);
    host.append(back);
    (row.firstChild as HTMLButtonElement | null)?.focus();
  });
}

export function fallbackPresenter(c: ClassicContext): Presenter {
  const host = () => (c as unknown as { layer: HTMLElement }).layer;
  return {
    async info(_s, e) {
      await stageAlert(host(), text(e.id));
    },
    prompt: (s, p) => askPrompt(s, p),
    townTalk: (id) => showTownTalk(id),
    async rejected(_s, e) {
      if (e.dialog) await stageAlert(host(), text(e.dialog));
    },
  };
}
