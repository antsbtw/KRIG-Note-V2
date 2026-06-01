/**
 * Web 全局设置类型(per-ws 代理工程 · 阶段3)
 *
 * 跨层共享类型(纯类型,0 业务依赖):
 * - main 进程全局设置 store(web-settings-store.ts)定义/持久化 WebGlobalSettings
 * - renderer 侧 d.ts(electron-api.d.ts)声明 IPC 返回类型
 * - renderer 侧 web-settings-cache.ts 同步缓存
 *
 * 提到 shared 层避免 d.ts import main 代码(跨层依赖)。
 */

/** Web 全局设置(跨所有 ws 共用;搜索引擎 + 默认主页)*/
export interface WebGlobalSettings {
  /** 搜索 URL 模板,含 %s 占位(%s = 已 encodeURIComponent 的查询词)*/
  searchEngineTemplate: string;
  /** 默认主页 / 新 tab URL */
  defaultUrl: string;
}
