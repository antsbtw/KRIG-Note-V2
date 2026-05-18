/**
 * ThoughtView FloatingToolbar 注册(对齐 V1 ThoughtEditor 形态)
 *
 * V1 ThoughtEditor = NoteEditor variant='thought' 薄包装,完整继承 NoteEditor
 * 全部能力(charter §1.4 view 平等)。floating toolbar 同款 mark/math/link/color。
 *
 * 与 NoteView 字面差异:
 * - **不注册 💭 add-thought**:thought card 内再加 thought 会递归,V1 同款
 *   通过 thoughtPlugin 禁用同效果
 * - **不注册 🤖 ask-ai**:V1 字面禁 AskAIPanel(Note 独占,thought 内不接)
 */

import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

const VIEW = 'thought-view';

export function registerFloatingToolbar(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.floatingToolbar;
  floatingToolbarRegistry.register([
    ...ui.createMarkButtons(VIEW),
    ui.createMathButton(VIEW),
    ui.createLinkButton(VIEW),
    ui.createColorButton(VIEW),
  ]);
}
