/**
 * X Host renderer 侧 registry — 记录「每个 ws 的 AI-view X Host 的 guest webContents id」
 *
 * 背景(多 ws / 多实例串扰 bug,实测坐实):main 侧 x-webview-registry 是**全局单例**
 * (per-serviceId 一个 wc,「最后 navigate 胜出」),不区分 ws、也不区分「AI-view 的 X」
 * vs「内置浏览器的 X」。当用户同时开了内置浏览器 X 和 AI-view X,发推注入会打到「最后
 * navigate 的」那个(常是内置浏览器 X)——内容落进了用户没在看的实例,表现「日志说注入
 * 成功,但右栏框是空的」。
 *
 * 修法(总指挥拍板:只打当前活跃 ws 的 AI-view X):每个 AIView 实例(per-ws)把自己挂的
 * X Host 的 guest wc id 登记到本 registry(键 = wsId);发推 / 提取推文时按活跃 ws 取对应
 * wc id,明确传给 main 注入,**不再依赖全局「最后 navigate」**。归属本 capability(而非
 * views/x)是因 view 间不能互相 import,AIView(views/ai)与 send-to-x(views/x)都经
 * capability API 读写本 registry。
 *
 * 生命周期:AIView 的 X Host dom-ready / url 变化时 set(那时 guest wc id 可取);
 * AIView 卸载时 clear。模块级单例(renderer 侧)。
 *
 * 收口 ①(2026-06-11):底层 `Map<wsId,wcId>` + 三函数模板下沉到 shared 的
 * `createWsHostRegistry` 工厂,与 ai-host-registry 合一;本文件只 new 一个 X 专属实例 +
 * 保留历史导出名(consumers 不动)。
 */

import { createWsHostRegistry } from '@shared/ws-host-registry';

const xHostRegistry = createWsHostRegistry('x-host');

export function registerXHostWcId(wsId: string, wcId: number): void {
  xHostRegistry.register(wsId, wcId);
}

export function clearXHostWcId(wsId: string): void {
  xHostRegistry.clear(wsId);
}

export function getXHostWcId(wsId: string): number | null {
  return xHostRegistry.get(wsId);
}
