/**
 * NoteView ContextMenu 注册 — L5-B3.2 扩展 Turn Into
 */

import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';

const VIEW = 'note-view';

export function registerContextMenu(): void {
  contextMenuRegistry.register([
    { id: 'note-view.cm.turn-p', label: 'Turn into Paragraph', command: 'note-view.cm-turn-paragraph',
      view: VIEW, enabledWhen: 'is-editable', order: 10 },
    { id: 'note-view.cm.turn-h1', label: 'Turn into H1', command: 'note-view.cm-turn-h1',
      view: VIEW, enabledWhen: 'is-editable', order: 11 },
    { id: 'note-view.cm.turn-h2', label: 'Turn into H2', command: 'note-view.cm-turn-h2',
      view: VIEW, enabledWhen: 'is-editable', order: 12 },
    { id: 'note-view.cm.turn-h3', label: 'Turn into H3', command: 'note-view.cm-turn-h3',
      view: VIEW, enabledWhen: 'is-editable', order: 13 },
    { id: 'note-view.cm.turn-bullet', label: 'Turn into Bullet List', command: 'note-view.cm-turn-bullet',
      view: VIEW, enabledWhen: 'is-editable', order: 14 },
    { id: 'note-view.cm.turn-ordered', label: 'Turn into Numbered List', command: 'note-view.cm-turn-ordered',
      view: VIEW, enabledWhen: 'is-editable', order: 15 },
    { id: 'note-view.cm.turn-task', label: 'Turn into Task List', command: 'note-view.cm-turn-task',
      view: VIEW, enabledWhen: 'is-editable', order: 16 },
    { id: 'note-view.cm.turn-quote', label: 'Turn into Quote', command: 'note-view.cm-turn-quote',
      view: VIEW, enabledWhen: 'is-editable', order: 17 },
    { id: 'note-view.cm.turn-code', label: 'Turn into Code Block', command: 'note-view.cm-turn-code',
      view: VIEW, enabledWhen: 'is-editable', order: 18 },
    { id: 'note-view.cm.turn-callout', label: 'Turn into Callout', command: 'note-view.cm-turn-callout',
      view: VIEW, enabledWhen: 'is-editable', order: 19 },
    { id: 'note-view.cm.turn-toggle', label: 'Turn into Toggle List', command: 'note-view.cm-turn-toggle',
      view: VIEW, enabledWhen: 'is-editable', order: 20 },
    { id: 'note-view.cm.delete', label: 'Delete block', command: 'note-view.cm-delete-block',
      view: VIEW, enabledWhen: 'is-editable', order: 30 },
  ]);
}
