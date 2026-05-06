/**
 * NoteView SlashMenu 注册 — Q2=A:4 项(Paragraph / H1 / H2 / H3)
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 5.2。
 */

import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';

const VIEW = 'note-view';

export function registerSlashMenu(): void {
  slashRegistry.register([
    {
      id: 'note-view.slash.p',
      label: 'Paragraph',
      command: 'note-view.slash-set-paragraph',
      keywords: ['p', 'paragraph', 'text', 'plain'],
      view: VIEW,
      order: 10,
    },
    {
      id: 'note-view.slash.h1',
      label: 'Heading 1',
      command: 'note-view.slash-set-h1',
      keywords: ['h1', 'heading', 'title', 'header'],
      view: VIEW,
      order: 20,
    },
    {
      id: 'note-view.slash.h2',
      label: 'Heading 2',
      command: 'note-view.slash-set-h2',
      keywords: ['h2', 'heading', 'header'],
      view: VIEW,
      order: 30,
    },
    {
      id: 'note-view.slash.h3',
      label: 'Heading 3',
      command: 'note-view.slash-set-h3',
      keywords: ['h3', 'heading', 'header'],
      view: VIEW,
      order: 40,
    },
  ]);
}
