/**
 * AI Host renderer 侧 registry — 记录「每个 ws 的 AI Host webview 的 guest webContents id」
 *
 * 背景(多 ws / 多实例串扰 bug,与 X 发推同款):main 侧 ai-webview-registry 是**全局单例**
 * (per-serviceId 一个 wc,「最后 navigate 胜出」),不区分 ws、也不区分「AI-view 的 AI 网页」
 * vs「内置浏览器里同一 AI 网页」。当用户同时开多个 workspace(每个挂自己的 AI view),或
 * 内置浏览器 + AI-view 同时在 claude.ai,问 AI / 提取整页 / 单条提取 / ai-sync 注入或抓取会
 * 打到「最后 navigate 的」那个实例 —— 内容落进 / 抓自用户没在看的框,表现「日志说成功,
 * 但用户在看的那个 AI 框是空的 / 抓到别的对话」。
 *
 * 修法(对称 x-host-registry,总指挥拍板):每个 AIView 实例(per-ws)把自己挂的 AI Host
 * 的 guest wc id 登记到本 registry(键 = wsId);问 AI / 提取 / ai-sync 时按活跃 ws 取对应
 * wc id,明确传给 main 精确定位,**不再依赖全局「最后 navigate」**。
 *
 * 与 X 的差异(§3.2 总指挥拍板):未命中(本 ws 未登记 / wc 已销毁)时 main **fail loud**
 * 明确报错,**不**静默回退全局 active —— 回退等于没修(项目铁律 fail-loud)。
 *
 * 归属本 capability(而非 views/ai)是因 view 间不能互相 import,AIView(views/ai)与未来
 * 其他 view 都经 capability API 读写本 registry,与 [[project-x-drag-to-post-method]] 同范式。
 *
 * 生命周期:AI Host dom-ready / url 变化时 set(那时 guest wc id 可取);AIView 卸载时 clear。
 * 模块级单例(renderer 侧)。
 */

/** wsId → 该 ws 的 AI Host guest webContents id */
const wsToAIWcId = new Map<string, number>();

export function registerAIHostWcId(wsId: string, wcId: number): void {
  wsToAIWcId.set(wsId, wcId);
}

export function clearAIHostWcId(wsId: string): void {
  wsToAIWcId.delete(wsId);
}

export function getAIHostWcId(wsId: string): number | null {
  return wsToAIWcId.get(wsId) ?? null;
}
