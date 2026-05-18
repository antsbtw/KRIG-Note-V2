/**
 * ThoughtView self-register 入口
 *
 * 横切思考层 — NavSide 第 6 个 tab(thought-view-port.md v0.5 §0/§3)。
 * import 时触发副作用:注册 view + 命令 + NavSide 内容。
 *
 * install 列表(v0.5 §7 横切定位 + Phase 2 范围):
 * - selection / clipboard / undo-redo:基础交互
 * - thought:本横切层
 * - folder:Thought tab 的文件夹(已加 'thought' viewType)
 * - text-editing:Phase 3 卡片编辑器接入(Phase 2 用 textarea 占位)
 * - learning / math-rendering:卡片内查词 + 公式(Phase 3+ 启用)
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { ThoughtView } from './ThoughtView';
import { registerThoughtCommands } from './thought-commands';
import { registerNavSide } from './nav-side-content';

registerView({
  id: 'thought-view',
  install: [
    'selection',
    'clipboard',
    'undo-redo',
    'thought',
    'folder',
    'text-editing',
    'learning',
    'math-rendering',
  ],
  component: ThoughtView,
  navSideTab: { label: 'Thought', icon: '💭', order: 6 },
});

registerThoughtCommands();
registerNavSide();
