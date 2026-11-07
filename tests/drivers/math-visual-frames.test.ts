/**
 * math-visual 分帧(题意图 P2,2026-11-07)
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md §3.2
 * 样本 = Andy / Betsy 三帧:帧 1 只有 Andy;帧 2 多出 Betsy 与 Andy 虚影;帧 3 多出圆与打叉虚线
 */
import { describe, it, expect } from 'vitest';
import {
  isFramed, visibleInFrame, rangeAfterInsertingFrame, rangeAfterRemovingFrame,
} from '@drivers/text-editing-driver/blocks/math-visual/frames';
import { historyKey } from '@drivers/text-editing-driver/blocks/math-visual/edit-history';
import type { FrameRange, MathVisualData } from '@drivers/text-editing-driver/blocks/math-visual/types';
import { DEFAULT_CANVAS_CONFIG } from '@drivers/text-editing-driver/blocks/math-visual/types';

const SAMPLE: Record<string, FrameRange | undefined> = {
  mathville: undefined,          // 每帧都在
  andy: { from: 1 },             // 帧 1 起
  betsy: { from: 2 },            // 帧 2 起
  andyGhost: { from: 2, to: 2 }, // 只在帧 2(虚影)
  ring: { from: 3 },             // 帧 3 起
  struck: { from: 3 },
};
const visibleAt = (i: number) => Object.entries(SAMPLE).filter(([, r]) => visibleInFrame(r, i)).map(([k]) => k);

describe('可见性', () => {
  it('Andy / Betsy 三帧逐步叠加', () => {
    expect(visibleAt(1)).toEqual(['mathville', 'andy']);
    expect(visibleAt(2)).toEqual(['mathville', 'andy', 'betsy', 'andyGhost']);
    expect(visibleAt(3)).toEqual(['mathville', 'andy', 'betsy', 'ring', 'struck']);
  });
  it('0~1 帧不算分帧(行为与原来一样)', () => {
    expect(isFramed(undefined)).toBe(false);
    expect(isFramed([{ id: 'a', text: '' }])).toBe(false);
    expect(isFramed([{ id: 'a', text: '' }, { id: 'b', text: '' }])).toBe(true);
  });
});

describe('加帧 / 删帧后对象的帧号', () => {
  it('在第 2 帧后插入:之后的帧号 +1;正好在第 2 帧结束的不延续', () => {
    expect(rangeAfterInsertingFrame({ from: 3 }, 2)).toEqual({ from: 4 });
    expect(rangeAfterInsertingFrame({ from: 1 }, 2)).toEqual({ from: 1 });             // 延续到新帧
    expect(rangeAfterInsertingFrame({ from: 2, to: 2 }, 2)).toEqual({ from: 2, to: 2 }); // 虚影不延续
    expect(rangeAfterInsertingFrame({ from: 1, to: 3 }, 2)).toEqual({ from: 1, to: 4 });
    expect(rangeAfterInsertingFrame(undefined, 2)).toBeUndefined();
  });
  it('删第 2 帧:之后的帧号 -1;跨过的缩一格;只在第 2 帧的返回 null(由调用方挪到相邻帧,不静默删)', () => {
    expect(rangeAfterRemovingFrame({ from: 3 }, 2)).toEqual({ from: 2 });
    expect(rangeAfterRemovingFrame({ from: 1, to: 3 }, 2)).toEqual({ from: 1, to: 2 });
    expect(rangeAfterRemovingFrame({ from: 1, to: 2 }, 2)).toEqual({ from: 1, to: 1 });
    expect(rangeAfterRemovingFrame({ from: 2 }, 2)).toEqual({ from: 2 });   // 原第 3 帧起
    expect(rangeAfterRemovingFrame({ from: 2, to: 2 }, 2)).toBeNull();
    expect(rangeAfterRemovingFrame(undefined, 2)).toBeUndefined();
  });
});

describe('撤销历史不把逐帧缩略图当编辑', () => {
  it('只改了 frameThumbnails → historyKey 不变', () => {
    const base: MathVisualData = {
      functions: [], domain: [-5, 5], range: [-5, 5], parameters: [], annotations: [],
      canvas: DEFAULT_CANVAS_CONFIG, frames: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }],
    };
    expect(historyKey({ ...base, frameThumbnails: ['<svg/>', '<svg/>'] })).toBe(historyKey(base));
    expect(historyKey({ ...base, frames: [{ id: 'a', text: '甲改' }, { id: 'b', text: '乙' }] })).not.toBe(historyKey(base));
  });
});
