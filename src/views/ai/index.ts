/**
 * AIView self-register 入口
 *
 * import 时触发副作用:注册 view + ViewSwitcher Tab + 命令。
 * NavSide tab order=4(view-definition.ts 预留位置:Note<eBook<Web<AI<Graph)。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { AIView } from './AIView';
import { registerAICommands } from './ai-commands';
import { registerAINavSide } from './nav-side-content';

registerView({
  id: 'ai-view',
  install: [
    // 横切 AI 能力(charter § 1.2 注册原则)— driver 隐于 capability,view 不可见
    'ai-extraction',
    // X 集成:AI navSide 四入口里的 X 用 x-extraction 渲染(铁律 3 独立路径)
    'x-extraction',
  ],
  component: AIView,
  navSideTab: { label: 'AI', icon: '🤖', order: 4 },
});

registerAICommands();
registerAINavSide(); // navSide 四入口快速导航(Claude/ChatGPT/Gemini/X)
