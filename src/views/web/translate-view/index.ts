/**
 * TranslateWebView self-register 入口(L5-B4.2)
 *
 * 跟 web-view 区别:
 * - 不挂 navSideTab(不出现在 ViewSwitcher,只能通过 link 路由 / WebToolbar 翻译按钮触发)
 * - 主要承担 right slot 翻译镜像角色
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { TranslateWebView } from './TranslateWebView';
import './translate-view.css';

registerView({
  id: 'web-translate-view',
  install: [
    // 跟 web-view 同款:不挂 5 capability(纯 webview 嵌入,无 selection / clipboard / undo 等编辑能力)
  ],
  component: TranslateWebView,
  // 不挂 navSideTab — 隐式 view,通过命令(WebToolbar 翻译按钮)触发 slotBinding.right
});
