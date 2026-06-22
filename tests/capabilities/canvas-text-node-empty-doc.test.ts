/**
 * L5-G6c bug2 — 双击几何 shape 起空 doc 编辑(可编辑性补全)
 *
 * 背景:双击 ellipse 等几何 shape 无反应,根因 = 视图 gate `inst.doc === undefined → return`
 * (诊断 log 坐实:hit=krig.basic.ellipse / doc undefined? = true)。修复 = 双击没 doc 的
 * 几何 shape 惰性起空 doc 进编辑(initialDoc undefined → docToDriverSerialized 给空 doc)。
 *
 * 本测锁底层不变量:docToDriverSerialized(undefined) → 合法可编辑空 doc(EditOverlay 据此起编辑)。
 */
import { describe, it, expect } from 'vitest';
import { docToDriverSerialized } from '@capabilities/canvas-text-node/atom-bridge';

describe('L5-G6c bug2 — 几何 shape 首次双击起空 doc', () => {
  it('docToDriverSerialized(undefined) → 合法空 DriverSerialized(EditOverlay 可起编辑)', async () => {
    const d = (await docToDriverSerialized(undefined)) as {
      format?: string;
      payload?: { type?: string; content?: unknown[] };
    };
    expect(d.format).toBe('pm-doc-json');
    expect(d.payload?.type).toBe('doc');
    expect(Array.isArray(d.payload?.content)).toBe(true);
    // 空 doc = 一个空 paragraph(非 NoteView 全屏 title)
    expect(d.payload!.content!.length).toBeGreaterThanOrEqual(1);
  });

  it('docToDriverSerialized(null) 同样起空 doc(防御)', async () => {
    const d = (await docToDriverSerialized(null)) as { format?: string };
    expect(d.format).toBe('pm-doc-json');
  });
});
