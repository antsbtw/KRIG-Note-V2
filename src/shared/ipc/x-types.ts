/**
 * x-types — X 集成的 IPC 数据契约(shared 层,renderer / preload / main 共用)。
 *
 * 这里只放**纯数据类型**(IPC 可序列化),不放运行时逻辑。shared 层不能 import
 * @capabilities/@platform(架构边界),故依赖的类型要么从 @drivers(shared 可达)引,
 * 要么内联结构。
 */

import type { ArticlePlan } from '@drivers/text-editing-driver/serializers/note-to-article-plan';

/**
 * 一次 note→X Article 发布的「中间态」诊断信封(X_PLAN_CACHE_DUMP 的载荷)。
 *
 * 动机(总指挥 2026-06-14):发布链路修 bug 难,根因是没有可检查的中间态缓存。把每次发布
 * 算好的 ArticlePlan(中间态)连同渲图结果一起落盘,即可离线直接看某 block 在 plan 里
 * 到底在不在 / 格式对不对 —— 一眼分清「规范化阶段(切分/降级)丢的」还是「上传阶段(driver)丢的」。
 *
 * renderFailures 内联 BlockRenderFailure 结构({source,kind,reason}),避免 shared 跨层 import
 * @capabilities/x-extraction。
 */
export interface XPlanCacheEnvelope {
  /** 落盘时间戳(epoch ms,renderer 侧 Date.now()) */
  capturedAt: number;
  /** note 标题(plan.title;空则 '(untitled)') */
  noteTitle: string;
  /** note 实例 id(对账用) */
  instanceId: string;
  /** ★ 核心中间态:title + 有序 steps + 发布前预检 warnings */
  plan: ArticlePlan;
  /** 已渲成 media:// 的兜底块清单(Mermaid/mathVisual) */
  rendered: { kind: string; source: string; mediaUrl: string }[];
  /** 渲图失败(分清是渲图失败,还是 plan 切分错)。内联 BlockRenderFailure 结构。 */
  renderFailures: { source: string; kind: string; reason: string }[];
  /** 兜底块 kinds(对账:识别出几个待转图块) */
  fallbackBlockKinds: string[];
}
