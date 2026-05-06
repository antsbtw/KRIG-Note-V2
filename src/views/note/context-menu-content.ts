/**
 * NoteView ContextMenu 注册(主区域右键)— Q4=A、Q8=A
 *
 * 5 项:Turn Into 4 项扁平 + Delete。Cut/Copy/Paste 留 L5-B3.3。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 5.4。
 */

import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';

const VIEW = 'note-view';

export function registerContextMenu(): void {
  contextMenuRegistry.register([
    {
      id: 'note-view.cm.turn-p',
      label: 'Turn into Paragraph',
      command: 'note-view.cm-set-paragraph',
      view: VIEW,
      enabledWhen: 'is-editable',
      order: 10,
    },
    {
      id: 'note-view.cm.turn-h1',
      label: 'Turn into H1',
      command: 'note-view.cm-set-h1',
      view: VIEW,
      enabledWhen: 'is-editable',
      order: 11,
    },
    {
      id: 'note-view.cm.turn-h2',
      label: 'Turn into H2',
      command: 'note-view.cm-set-h2',
      view: VIEW,
      enabledWhen: 'is-editable',
      order: 12,
    },
    {
      id: 'note-view.cm.turn-h3',
      label: 'Turn into H3',
      command: 'note-view.cm-set-h3',
      view: VIEW,
      enabledWhen: 'is-editable',
      order: 13,
    },
    {
      id: 'note-view.cm.delete',
      label: 'Delete block',
      command: 'note-view.cm-delete-block',
      view: VIEW,
      enabledWhen: 'is-editable',
      order: 20,
    },
  ]);
}
