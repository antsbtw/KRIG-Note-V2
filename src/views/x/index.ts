/**
 * X 命令注册入口(X 集成 阶段 0/1)
 *
 * X 不再是独立 navSide tab —— 用户拍板把 X 放进 AI navSide 的服务切换器做导航
 * (AIView 选 'x' 时用 x-extraction.Host 渲染 X webview)。故本模块**不** registerView,
 * 只注册 X 提取命令 + 模块级广播订阅(右键提取推文 → tweetBlock)。
 *
 * import 时机:platform/renderer/index.tsx 显式拉一次(触发命令注册副作用)。
 */

import { registerXCommands } from './x-commands';
import { registerXSendConfirmPopup } from './send-confirm-popup';
import { registerXTestCommands } from './x-test-commands';

registerXCommands();
// 阶段 2.5-a:注册「发到 X」发送前确认弹窗(发推/回复注入前预览 + 确认)。
registerXSendConfirmPopup();
// 2026-06-14:逐块底层测试命令(dev,x-view.test-drive-<kind>;每块独立驱动+验证完整落定)。
registerXTestCommands();
