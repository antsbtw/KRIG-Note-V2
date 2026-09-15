/**
 * Web 能力层控制台 —— dev-only 右栏 view
 *
 * ⭐ 形态按 `02-testing.md §3.5.4`:**右栏一个 view**,不是独立窗口。
 * 理由是文档里那句:「**验收台必须和被观察的页面同屏**」——
 * 开独立窗口反而做不到,人得在两个窗口之间来回看,对照就失效了。
 *
 * ⭐ 内部分类按用户 2026-09-15 拍板的**控制 / 输入 / 输出** ——
 * 与 `01-contract.md:15` 的三分法同源(文档 §3.5.4 原写的是按模块分的五个面板,
 * 那套更像实现视角;三分法是契约视角)。
 *
 * ⚠️ **dev-only**:`import.meta.env.DEV` 为假时**不注册** ——
 * Vite 在 prod build 会把整段 dead-code 掉,用户看不见这个 view。
 * 主侧同理:`registerWebConsoleHandlers` 在 `app.isPackaged` 时直接 return。
 */
import { registerView } from '@slot/view-type-registry/register-view';
import { WebConsoleView } from './WebConsoleView';

if (import.meta.env.DEV) {
  registerView({
    id: 'web-console-view',
    install: ['x-extraction'],
    component: WebConsoleView,
    slotPickerEntry: { label: '能力控制台', icon: '🧰', order: 62 },
  });
}
