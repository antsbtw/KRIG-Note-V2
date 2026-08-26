/**
 * MailView self-register — navSide tab 📧 order=7(邮箱模块 阶段 0)
 *
 * 与 AI / Social 一样是 webview 类 view:
 * - navSideOnSwitch: 'collapse' —— 切过来时收起 navSide 面板(webview 要全宽)
 * - navSideDisabled: true —— 本 view 无 NavSide 内容,禁止点已激活 tab 展开空面板
 *   (阶段 2 做原生收件箱时,账号树/文件夹会进 navSide,那时去掉这个标记)
 * - slotPickerChildren —— SlotPicker 里展开为各服务商子项,而非 view 本身
 *
 * 见 docs/tasks/2026-08-26-mail-module-design.md
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { MailView } from './MailView';
import { registerNavSide } from './nav-side-content';

registerNavSide();

registerView({
  id: 'mail-view',
  install: ['mail-service'],
  component: MailView,
  navSideTab: {
    label: 'Mail',
    icon: '📧',
    order: 7,
    // 阶段 0 时是 collapse + navSideDisabled(webview 类 view 无面板内容)。
    // 阶段 1 有了账号面板 → 解禁,切过来时展开(账号配置是使用邮箱同步的入口)。
    navSideOnSwitch: 'expand',
    slotPickerChildren: [
      { subId: 'gmail', label: 'Gmail', icon: '📧' },
      { subId: 'outlook', label: 'Outlook', icon: '📨' },
      { subId: 'qq', label: 'QQ 邮箱', icon: '🐧' },
      { subId: 'netease163', label: '163 邮箱', icon: '📬' },
    ],
  },
});
