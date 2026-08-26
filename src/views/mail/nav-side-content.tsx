/**
 * Mail view 的 NavSide 内容 —— 邮箱账号面板(阶段 1)
 *
 * 与 ebook 的书架、note 的目录树同构:都是「本 view 的资源清单」。
 *
 * ⚠️ 阶段 0 时 mail-view 是 navSideDisabled(webview 类 view 没有面板内容),
 * 阶段 1 有了账号配置才解禁 —— 见 views/mail/index.ts 的注释。
 */

import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { AccountPanel } from './AccountPanel';

export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'mail-view',
    title: '邮箱账号',
    // contentRenderer 无参 —— wsId 由 AccountPanel 内部 useWsId() 订阅
    // (照 ebook 的 BookshelfPanel)。这里现读会拿到快照值,切 ws 后面板不更新。
    contentRenderer: () => <AccountPanel />,
  });
}
