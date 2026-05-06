/**
 * NoteView HandleMenu 注册 — L5-B3.2 扩展 Turn Into
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';

const VIEW = 'note-view';

export function registerHandleMenu(): void {
  handleRegistry.register([
    { id: 'note-view.h.turn-p', label: 'Turn into Paragraph', command: 'note-view.handle-turn-paragraph',
      view: VIEW, order: 10 },
    { id: 'note-view.h.turn-h1', label: 'Turn into H1', command: 'note-view.handle-turn-h1',
      view: VIEW, order: 11 },
    { id: 'note-view.h.turn-h2', label: 'Turn into H2', command: 'note-view.handle-turn-h2',
      view: VIEW, order: 12 },
    { id: 'note-view.h.turn-h3', label: 'Turn into H3', command: 'note-view.handle-turn-h3',
      view: VIEW, order: 13 },
    { id: 'note-view.h.turn-bullet', label: 'Turn into Bullet List', command: 'note-view.handle-turn-bullet',
      view: VIEW, order: 14 },
    { id: 'note-view.h.turn-ordered', label: 'Turn into Numbered List', command: 'note-view.handle-turn-ordered',
      view: VIEW, order: 15 },
    { id: 'note-view.h.turn-task', label: 'Turn into Task List', command: 'note-view.handle-turn-task',
      view: VIEW, order: 16 },
    { id: 'note-view.h.turn-quote', label: 'Turn into Quote', command: 'note-view.handle-turn-quote',
      view: VIEW, order: 17 },
    { id: 'note-view.h.turn-code', label: 'Turn into Code Block', command: 'note-view.handle-turn-code',
      view: VIEW, order: 18 },
    { id: 'note-view.h.turn-callout', label: 'Turn into Callout', command: 'note-view.handle-turn-callout',
      view: VIEW, order: 19 },
    { id: 'note-view.h.turn-toggle', label: 'Turn into Toggle List', command: 'note-view.handle-turn-toggle',
      view: VIEW, order: 20 },
    // 复制 + 删除
    { id: 'note-view.h.copy', label: 'Duplicate', command: 'note-view.handle-copy-block',
      view: VIEW, order: 30 },
    { id: 'note-view.h.delete', label: 'Delete', command: 'note-view.handle-delete-block',
      view: VIEW, order: 40 },
  ]);
}
