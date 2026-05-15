/**
 * NoteView FloatingToolbar 注册(C2:工厂函数化,内容来源 text-editing capability)
 *
 * V1 顺序(参考 src/plugins/note/components/FloatingToolbar.tsx):
 *   B / I / U / S / <>(5 mark)
 *   ─── 分隔
 *   ∑(行内公式 — V1 在颜色之前,选中文字 → 转 mathInline)
 *   ─── 分隔
 *   🔗(链接 popup)
 *   ─── 分隔
 *   颜色(V1 单按钮综合面板)
 *
 * 本文件职责(C2 后):
 * - 仅决定"NoteView 用哪些 floating-toolbar item + 顺序"(view 拼装)
 * - 内容工厂在 @capabilities/text-editing/ui/floating-toolbar/items(text-editing capability)
 * - NoteView 自己的浮条增量在本文件继续往下追加(目前无)
 *
 * 占位项(留 sub-stage):
 * - V1 颜色按钮综合面板 IconTextColor 含上次用色记忆 — 留 ColorPicker UX 升级
 * - V1 没的"清除格式"按钮 — 跟 context menu 移除格式一起做
 */

import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import {
  createMarkButtons,
  createMathButton,
  createLinkButton,
  createColorButton,
} from '@capabilities/text-editing/ui/floating-toolbar/items';

const VIEW = 'note-view';

export function registerFloatingToolbar(): void {
  floatingToolbarRegistry.register([
    ...createMarkButtons(VIEW),
    createMathButton(VIEW),
    createLinkButton(VIEW),
    createColorButton(VIEW),
  ]);
}
