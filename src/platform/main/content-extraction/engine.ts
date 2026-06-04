/**
 * engine — 提取引擎抽象(可替换接口)
 *
 * 动机:通用网页正文提取没有"装上就完美"的库 —— Defuddle / Readability / Trafilatura
 * 都会在某些站翻车,只是翻车的样子不同。为了不把整条链路锁死在 Defuddle 一家、
 * 将来能低成本试别的引擎(或并存多引擎),把"webview → FullPageResult"这一步
 * 收口到 ExtractionEngine 接口后面。
 *
 * 边界:
 *  - 引擎只负责"从 guest 页面抽出 FullPageResult"(注入脚本 / 解析 / 该引擎专属的
 *    正文清洗)。引擎专属 npm 包(defuddle bundle 等)住在各自 *-engine.ts。
 *  - 引擎**无关**的后处理(YouTube 字幕、超时 race、落盘缓存)留在 capture.ts 编排层。
 *  - 新增引擎 = 加一个实现 ExtractionEngine 的 *-engine.ts + 在 registry 注册,
 *    capture.ts 与其上层(右键菜单 / renderer pipeline)零改动。
 */

import type { WebContents } from 'electron';
import type { FullPageResult } from './types';

export interface ExtractionEngine {
  /** 引擎标识(诊断 / 选择用),如 'defuddle' / 'readability'。 */
  readonly id: string;
  /**
   * 从 guest webview 提取整页 → FullPageResult。
   * 失败 / 不支持 / 解析报错 → 返回 null(调用方降级,不抛)。
   * 注:超时 race 由 capture.ts 编排层统一套,引擎实现不必自管超时。
   */
  extract(guest: WebContents): Promise<FullPageResult | null>;
}

/** 已注册引擎(id → 引擎);capture.ts 按 active id 取。 */
const engines = new Map<string, ExtractionEngine>();
let activeEngineId = 'defuddle';

/** 注册一个提取引擎(各 *-engine.ts 模块加载时调用)。 */
export function registerExtractionEngine(engine: ExtractionEngine): void {
  if (engines.has(engine.id)) {
    console.warn(`[content-extraction] engine '${engine.id}' already registered, overwriting`);
  }
  engines.set(engine.id, engine);
}

/** 设置当前活跃引擎 id(将来接设置项 / 按站点切换可用)。 */
export function setActiveEngine(id: string): void {
  if (!engines.has(id)) {
    console.warn(`[content-extraction] setActiveEngine: '${id}' not registered, keeping '${activeEngineId}'`);
    return;
  }
  activeEngineId = id;
}

/** 取当前活跃引擎;未注册则返回 undefined(capture.ts 降级 null)。 */
export function getActiveEngine(): ExtractionEngine | undefined {
  return engines.get(activeEngineId);
}
