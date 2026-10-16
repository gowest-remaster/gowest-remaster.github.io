// Cut Content (the Developer's Cut archive): the whole UI from ../devcut, full screen.
import '../styles/flows.css';
import type { App } from '../core/app.ts';
import { h } from '../core/dom.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { mountStudio } from '../devcut/index.ts';

export function register(app: App) {
  registerPanel({
    id: 'studio',
    title: 'Cut Content',
    kind: 'screen',
    mount: ({ params }) => {
      const host = h('div', { class: 'studio-host' });
      const leave = () => (session.state && !params.fromTitle ? app.closeScreen() : void app.go('title'));
      const tools: Record<string, () => void> = {
        MClick: () => void app.go('intro', { back: 'title' }),
      };
      let unmount: (() => void) | null = null;
      queueMicrotask(() => {
        unmount = mountStudio(host, { onClose: leave, room: params.room as string | undefined, tools });
      });
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') leave();
      };
      window.addEventListener('keydown', onKey);
      return { el: host, destroy: () => (unmount?.(), window.removeEventListener('keydown', onKey)) };
    },
  });
}
