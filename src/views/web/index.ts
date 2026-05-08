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
    // W4.2 C4:依赖 web-rendering capability(charter § 1.2 注册原则)
    // — driver(web-sync-driver / web-translate-driver)是 capability 内部实现细节,view 不可见
    'web-rendering',
  ],
  component: WebView,
  navSideTab: { label: 'Web', icon: '🌐', order: 3 },
});

registerWebCommands();
registerWebContextMenu();
