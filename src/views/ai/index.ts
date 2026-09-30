/**
 * AIView self-register 入口
 *
 * import 时触发副作用:注册 view + ViewSwitcher Tab + 命令。
 * NavSide tab order=4(view-definition.ts 预留位置:Note<eBook<Web<AI<Graph)。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { AIView } from './AIView';
import { AI_SERVICE_PROFILES } from '@shared/types/ai-service-types';
import { registerAICommands } from './ai-commands';

registerView({
  /** ⭐ 命令注册(registry 收着,等本窗口 wsId 就绪后跑)—— 卸载本模块只需删 renderer 里那一行 import */
  commands: registerAICommands,
  id: 'ai-view',
  install: ['ai-extraction'],
  component: AIView,
  navSideTab: {
    label: 'AI',
    icon: '🤖',
    order: 5,
    navSideOnSwitch: 'collapse',
    navSideDisabled: true,
    slotPickerChildren: AI_SERVICE_PROFILES.map((p) => ({
      subId: p.id,
      label: p.name,
      icon: p.icon,
    })),
  },
});
