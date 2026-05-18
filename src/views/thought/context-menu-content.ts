/**
 * ThoughtView ContextMenu 注册(对齐 V1 ThoughtEditor + V2 charter §1.4)
 *
 * V1 ThoughtEditor 字面继承 NoteEditor 右键菜单;V2 实施复刻 NoteView context menu
 * 全套(剪贴板组 + Select All + 移除格式/链接 + 查词/翻译 + 删 Block)。
 */

import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { LearningApi } from '@capabilities/learning/types';

const VIEW = 'thought-view';

export function registerContextMenu(): void {
  const te = requireCapabilityApi<TextEditingApi>('text-editing').ui.contextMenu;
  const lr = requireCapabilityApi<LearningApi>('learning').ui.contextMenu;
  contextMenuRegistry.register([
    ...te.createClipboardGroup(VIEW),
    te.createSelectAllItem(VIEW),
    ...te.createRemoveMarksGroup(VIEW),
    lr.createDictionaryLookupItem(VIEW),
    lr.createTranslateItem(VIEW),
    te.createDeleteBlockItem(VIEW),
  ]);
}
