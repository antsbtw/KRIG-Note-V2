/**
 * WebView self-register 入口(L5-B4)
 *
 * import 时触发副作用:注册 view + ViewSwitcher Tab + 右键菜单。
 * 后续(L5-B4.x):书签 / 历史 / 翻译 / 内容捕获等在此追加。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { WebView } from './WebView';
import { registerWebContextMenu } from './context-menu-integration';
import { registerNavSide, registerBookmarkContextMenu } from './nav-side-content';
import { registerWebCommands } from './web-commands';
import { registerWebBookmarkCommands } from './web-bookmark-commands';

registerView({
  /** ⭐ 命令注册(registry 收着,等本窗口 wsId 就绪后跑)—— 卸载本模块只需删 renderer 里那一行 import */
  commands: (wsId: string): void => {
    registerWebCommands(wsId);
    registerWebBookmarkCommands(wsId);
  },
  id: 'web-view',
  install: [
    // W4.2 C4:依赖 web-rendering capability(charter § 1.2 注册原则)
    // — driver(web-sync-driver / web-translate-driver)是 capability 内部实现细节,view 不可见
    'web-rendering',
    'learning',  // 2026-05-25:选区右键 📖 查词 / 🌐 翻译(走 learning.ui.dictionaryPanel)
    'content-extraction',  // 网页剪藏:右键「📥 提取到笔记」→ Defuddle 抓页 → note
  ],
  component: WebView,
  navSideTab: { label: 'Web', icon: '🌐', order: 3, navSideOnSwitch: 'collapse' },
});

registerWebContextMenu();
registerNavSide();
registerBookmarkContextMenu();
