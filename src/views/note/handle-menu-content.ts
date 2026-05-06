/**
 * NoteView HandleMenu 注册 — Q3=A:6 项(Turn Into 4 项扁平 + Duplicate + Delete)
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 5.3。
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';

const VIEW = 'note-view';

export function registerHandleMenu(): void {
  handleRegistry.register([
    {
      id: 'note-view.h.turn-p',
      label: 'Turn into Paragraph',
      command: 'note-view.handle-set-paragraph',
      view: VIEW,
      order: 10,
    },
    {
      id: 'note-view.h.turn-h1',
      label: 'Turn into H1',
      command: 'note-view.handle-set-h1',
      view: VIEW,
      order: 11,
    },
    {
      id: 'note-view.h.turn-h2',
      label: 'Turn into H2',
      command: 'note-view.handle-set-h2',
      view: VIEW,
      order: 12,
    },
    {
      id: 'note-view.h.turn-h3',
      label: 'Turn into H3',
      command: 'note-view.handle-set-h3',
      view: VIEW,
      order: 13,
    },
    {
      id: 'note-view.h.copy',
      label: 'Duplicate',
      command: 'note-view.handle-copy-block',
      view: VIEW,
      order: 20,
    },
    {
      id: 'note-view.h.delete',
      label: 'Delete',
      command: 'note-view.handle-delete-block',
      view: VIEW,
      order: 30,
    },
  ]);
}
