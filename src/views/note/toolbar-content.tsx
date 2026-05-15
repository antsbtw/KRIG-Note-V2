/**
 * NoteView 顶部 Toolbar 注册(C2:工厂函数化,内容来源 text-editing capability)
 *
 * 顺序(Q5=B 决议,L5-B2):heading dropdown + 5 mark button + 🔗 link + A / A̲ color
 *
 * 本文件职责(C2 后):
 * - 仅决定"NoteView 用哪些 toolbar item + 顺序"(view 拼装)
 * - 内容工厂在 @capabilities/text-editing/ui/toolbar/items
 * - NoteView 自己的 toolbar 增量在本文件继续往下追加(目前无)
 */

import { toolbarRegistry } from '@slot/toolbar-registry/toolbar-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

const VIEW = 'note-view';

export function registerToolbar(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.toolbar;
  toolbarRegistry.register([
    ui.createHeadingDropdown(VIEW),
    ui.createSeparator(VIEW, 'sep1', 20),
    ...ui.createToolbarMarkButtons(VIEW),
    ui.createToolbarLinkButton(VIEW),
    ...ui.createToolbarColorButtons(VIEW),
  ]);
}
