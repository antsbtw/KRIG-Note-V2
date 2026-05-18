/**
 * NoteView ContextMenu 注册(S3:learning 2 项也走 capability 工厂,view 端零业务增量)
 *
 * V1 右键菜单层级(参考 src/plugins/note/components/ContextMenu.tsx):
 *   Cut / Copy / Paste(剪贴板组)— text-editing 通用
 *   ─── 分隔
 *   Select All                  — text-editing 通用
 *   ─── 分隔
 *   ✖ 移除格式 / 🔗 移除链接     — text-editing 通用(real-mark 检测留 sub-stage)
 *   ─── 分隔
 *   📖 查词 / 🌐 翻译           — learning 通用(S3 起;原 note-view 业务上提)
 *   ─── 分隔
 *   🗑 删除 Block                — text-editing 通用
 *
 * 注册(S3 后,全部走 capability 工厂):
 * - text-editing 通用 7 项 → @capabilities/text-editing/ui/context-menu/items
 * - learning 通用 2 项     → @capabilities/learning/ui/context-menu/items
 *
 * 设计:
 * - **Turn Into 已从 context menu 移除**(归 handle 菜单 — cm = "改文字 / 操作选区",
 *   "改 block 类型"走 handle ⠿ 菜单)
 * - V1 规划但 V2 未实装项(Ask AI / Frame / Thought 等)沿用 "不注册" 策略
 *
 * 当前 NoteView 没有 cm 业务增量(查词/翻译 上提后);若未来加 Ask AI 等 NoteView
 * 专属右键项,在 register 数组追加。
 */

import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { LearningApi } from '@capabilities/learning/types';

const VIEW = 'note-view';

export function registerContextMenu(): void {
  const te = requireCapabilityApi<TextEditingApi>('text-editing').ui.contextMenu;
  const lr = requireCapabilityApi<LearningApi>('learning').ui.contextMenu;
  contextMenuRegistry.register([
    ...te.createClipboardGroup(VIEW),       // Cut / Copy / Paste
    te.createSelectAllItem(VIEW),            // Select All
    ...te.createRemoveMarksGroup(VIEW),      // 移除格式 / 移除链接
    lr.createDictionaryLookupItem(VIEW),     // 📖 查词(S3 走 learning 工厂)
    lr.createTranslateItem(VIEW),            // 🌐 翻译(S3 走 learning 工厂)
    te.createDeleteBlockItem(VIEW),          // 删除 Block
    // thought-view:点击位置有 thought anchor 时显 "删除Thought"
    {
      id: 'note-view.delete-thought-at-cursor',
      label: '💭 删除 Thought',
      command: 'thought-view.delete-thought-at-cursor',
      enabledWhen: 'has-thought',
      view: VIEW,
      group: 'thought',
      order: 200,
    },
  ]);
}
