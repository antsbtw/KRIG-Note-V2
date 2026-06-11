/**
 * ws-host-registry —— renderer 侧「每个 ws 的某类 Host webview guest wcId」注册表工厂
 *
 * 背景(多 ws / 多实例串扰 bug,X 发推 / AI 问答同款):main 侧 webview-registry-base 的
 * `createWebviewServiceRegistry` 是 **per-serviceKey 全局单例**(「最后 navigate 胜出」),
 * 不分 ws。多 ws 并存(每个挂自己的 AI / X webview),或内置浏览器 + AI-view 同站时,
 * 操作会打到「最后 navigate 的」那个实例 —— 内容落进 / 抓自用户没在看的框。
 *
 * 修法范式(总指挥拍板,已在 X 发推 / AI 问答跑通):每个 view 实例(per-ws)把自己挂的
 * Host guest wcId 登记到本 registry(键 = wsId);操作时按活跃 ws 取 wcId,IPC 透传到 main
 * `webContents.fromId` 精确定位,**不再依赖全局「最后 navigate」**。
 *
 * 本工厂把 AI / X 两份一字不差的 `Map<wsId,wcId>` registry 合一(收口 ① 底座下沉):
 * AI / X 各 `createWsHostRegistry(tag)` 一个独立实例 —— 命名空间天然隔离(AI 的 X vs
 * 内置浏览器 X 本就是不同 capability 的不同 registry,无需再加 service 维度)。
 *
 * 归属 shared 层(而非各 capability)是因 view 间 / capability 间不能互相 import 运行时;
 * shared 是纯类型 / 纯逻辑公共层,capability 可直接 import(无 npm、无跨层依赖)。
 *
 * 模块级单例(renderer 侧):每个 `createWsHostRegistry` 调用返回独立闭包 Map。
 */

/** 单个 ws-host registry 实例 */
export interface WsHostRegistry {
  /** 登记本 ws 的 Host guest wcId(Host dom-ready / url 变化时,那时 wcId 可取)*/
  register(wsId: string, wcId: number): void;
  /** 清除本 ws 登记(view 卸载时,避免 stale wcId 残留)*/
  clear(wsId: string): void;
  /** 取本 ws 的 Host guest wcId;未登记返 null */
  get(wsId: string): number | null;
}

/**
 * 创建一个 renderer 侧 ws→wcId 注册表。
 *
 * @param _tag 诊断标签(如 'ai-host' / 'x-host';目前仅文档用途,保留以备日志扩展)
 */
export function createWsHostRegistry(_tag: string): WsHostRegistry {
  const wsToWcId = new Map<string, number>();
  return {
    register(wsId: string, wcId: number): void {
      wsToWcId.set(wsId, wcId);
    },
    clear(wsId: string): void {
      wsToWcId.delete(wsId);
    },
    get(wsId: string): number | null {
      return wsToWcId.get(wsId) ?? null;
    },
  };
}
