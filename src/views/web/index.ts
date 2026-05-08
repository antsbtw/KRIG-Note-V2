/**
 * WebView self-register 入口(L5-B4)
 *
 * import 时触发副作用:注册 view + ViewSwitcher Tab + 右键菜单。
 * 后续(L5-B4.x):书签 / 历史 / 翻译 / 内容捕获等在此追加。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { WebView } from './WebView';
import { registerWebContextMenu } from './context-menu-integration';
import { registerWebCommands } from './web-commands';

registerView({
  id: 'web-view',
  install: [
    // L5-B4 v1 不挂 capability(WebView 不参与 selection / clipboard / undo 等编辑能力);
    // 后续 web-bridge 内容捕获 epic 时按需补 capability
  ],
  component: WebView,
  navSideTab: { label: 'Web', icon: '🌐', order: 3 },
});

registerWebCommands();
registerWebContextMenu();
