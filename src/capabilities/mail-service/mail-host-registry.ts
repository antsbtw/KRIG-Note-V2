/**
 * Mail Host renderer 侧 registry — 记录「每个 ws 的 Mail Host guest webContents id」
 *
 * 背景(多 ws / 多实例串扰,AI 问答 / X 发推都实测踩过):main 侧 mail-webview-registry
 * 是**全局单例**(per-serviceId 一个 wc,「最后 navigate 胜出」),不区分 ws、也不区分
 * 「Mail view 的 Gmail」vs「内置浏览器里打开的 Gmail」。用户同时开两者时,提取会打到
 * 「最后 navigate 的」那个 —— 抓自用户没在看的框。
 *
 * 修法(与 AI / X 同范式):每个 MailView 实例(per-ws)把自己挂的 Mail Host guest
 * wc id 登记到本 registry(键 = wsId);提取时按活跃 ws 取对应 wc id 明确传给 main,
 * **不再依赖全局「最后 navigate」**。
 *
 * 归属本 capability(而非 views/mail)是因 view 间不能互相 import 运行时。
 * 底层 Map + 三函数模板复用 shared 的 createWsHostRegistry 工厂(与 ai/x 合一)。
 *
 * 生命周期:Mail Host dom-ready / url 变化时 register(那时 guest wc id 可取);
 * MailView 卸载时 clear。模块级单例(renderer 侧)。
 */

import { createWsHostRegistry } from '@shared/ws-host-registry';

const mailHostRegistry = createWsHostRegistry('mail-host');

export function registerMailHostWcId(wsId: string, wcId: number): void {
  mailHostRegistry.register(wsId, wcId);
}

export function clearMailHostWcId(wsId: string): void {
  mailHostRegistry.clear(wsId);
}

export function getMailHostWcId(wsId: string): number | null {
  return mailHostRegistry.get(wsId);
}
