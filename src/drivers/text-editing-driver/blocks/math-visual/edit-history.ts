/**
 * math-visual 全屏编辑的撤销 / 重做(2026-11-06 用户:「cmd+Z 的取消操作没有生效吗?」)
 *
 * 为什么自己做:全屏面板拦下了按键,⌘Z 到不了 note 编辑器;就算到了,面板里镜像的
 * data 也不会跟着回退。所以面板自己记一份编辑历史。
 *
 * 规则:
 * - 只记「编辑」:工具切换、缩略图、视图范围(缩放 / 平移)不算,撤销时视图保持当前不动。
 * - 600ms 内的连续改动合并成一步(输入框逐字打、参数动画)。
 * - 最多记 100 步。
 */

import type { MathVisualData } from './types';

/** 参与比较的部分:去掉不算编辑的字段 */
export function historyKey(d: MathVisualData): string {
  return JSON.stringify({ ...d, toolMode: undefined, thumbnail: undefined, domain: undefined, range: undefined });
}

/** 撤销 / 重做后要套用的数据:内容回到 snapshot,视图与工具保持 current 的 */
export function restoreKeepingView(snapshot: MathVisualData, current: MathVisualData): MathVisualData {
  return {
    ...snapshot,
    domain: current.domain,
    range: current.range,
    toolMode: current.toolMode,
    thumbnail: current.thumbnail,
  };
}

export class EditHistory {
  private past: MathVisualData[] = [];
  private future: MathVisualData[] = [];
  private lastAt = -Infinity;

  constructor(private readonly limit = 100, private readonly mergeMs = 600) {}

  /** 一次改动:prev → next。不算编辑的改动直接忽略。 */
  record(prev: MathVisualData, next: MathVisualData, now: number): void {
    if (historyKey(prev) === historyKey(next)) return;
    const merge = now - this.lastAt < this.mergeMs && this.past.length > 0;
    if (!merge) {
      this.past.push(prev);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.lastAt = now;
  }

  /** 返回要回到的状态;没有可撤销的返回 null */
  undo(current: MathVisualData): MathVisualData | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    this.lastAt = -Infinity; // 撤销后的下一次改动另起一步
    return restoreKeepingView(prev, current);
  }

  redo(current: MathVisualData): MathVisualData | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.lastAt = -Infinity;
    return restoreKeepingView(next, current);
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}
