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

registerXCommands();
