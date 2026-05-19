/**
 * AIView self-register 入口
 *
 * import 时触发副作用:注册 view + ViewSwitcher Tab + 命令。
 * NavSide tab order=4(view-definition.ts 预留位置:Note<eBook<Web<AI<Graph)。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { AIView } from './AIView';
import { registerAICommands } from './ai-commands';

registerView({
  id: 'ai-view',
  install: [
    // 横切 AI 能力(charter § 1.2 注册原则)— driver 隐于 capability,view 不可见
    'ai-conversation',
  ],
  component: AIView,
  navSideTab: { label: 'AI', icon: '🤖', order: 4 },
});

registerAICommands();
