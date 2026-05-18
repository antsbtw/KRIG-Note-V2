/**
 * ThoughtView self-register 入口(V1 形态对齐:hidden view + 被动召唤 + per-resource 列卡片)
 *
 * 见 src/plugins/thought/main/register.ts(V1 同模式)。
 *
 * 关键差异于 v0.4 §5.7 早期设计:
 * - **删 NavSide tab**:V1 thought 是 hidden workmode,只通过 Note ⌘⇧M / 💭 floating /
 *   eBook 高亮等被动召唤右槽;无主动入口列全部 thoughts
 * - **删 folder**:V1 thought 不进 folder(也无 NavSide tab 暴露此功能);v0.5 §7 横切
 *   语义保留 — thought 仍可挂多 source(note/book/graph),只是无全局 NavSide 入口
 * - **删 tree-builder / nav-side-content**:V1 形态用 ThoughtPanel 纵向列卡片,不是树
 *
 * install 列表(v0.5 §7 横切定位 + V1 形态对齐):
 * - selection / clipboard / undo-redo:基础
 * - thought:本横切层
 * - text-editing:卡片内编辑器(ThoughtCardEditor 走 Host)
 * - learning / math-rendering:卡片内查词 + 公式
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { ThoughtView } from './ThoughtView';
import { registerThoughtCommands } from './thought-commands';
import { registerNoteBridge } from './note-bridge';

registerView({
  id: 'thought-view',
  install: [
    'selection',
    'clipboard',
    'undo-redo',
    'thought',
    'text-editing',
    'learning',
    'math-rendering',
  ],
  component: ThoughtView,
  // 不设 navSideTab — V1 形态 thought 是 hidden view(只被动召唤右槽)
});

registerThoughtCommands();
registerNoteBridge();
