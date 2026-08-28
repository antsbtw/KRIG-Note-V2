/**
 * 邮箱账号弹窗模块出口(阶段 1)
 *
 * - registerMailAccountPopup():注册到 popupRegistry(由 views/mail/index.ts 调一次)
 * - MAIL_ACCOUNT_POPUP_ID:toolbar ⚙ 按钮 popupController.toggle 用
 *
 * ## 为什么是弹窗而不是 navSide
 *
 * 初版把账号面板放 navSide(与 ebook 书架、note 目录树同构)。实测(用户截图)
 * 200px 窄栏装不下配置表单:「服务器设置(企业自建邮箱才需要改)」折成两行、
 * 「前往生成 ↗」链接断行,很难看。且账号配置是**低频操作**(配一次用很久),
 * 不值得为它常驻占掉一栏 —— webview 类 view 的全宽比什么都重要。
 *
 * 故改为 tabbar ⚙ 按钮弹出,mail-view 恢复 navSideDisabled。
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { AccountPanel } from './AccountPanel';

/** popup ID(popupRegistry 注册 + popupController.toggle 用) */
export const MAIL_ACCOUNT_POPUP_ID = 'mail-view.popup.accounts';

export function registerMailAccountPopup(): void {
  popupRegistry.register({
    id: MAIL_ACCOUNT_POPUP_ID,
    view: 'mail-view',
    Component: AccountPanel,
    // 表单比列表高;给足宽度,避免重演 navSide 里的折行
    estimatedSize: { width: 380, height: 420 },
  });
}
