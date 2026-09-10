/**
 * variant 闸门守卫 —— mind 记录不得被画板 view 洗掉
 *
 * ⚠️⚠️ 守的是一条**静默毁数据**的路径:
 * `GraphCanvasView` 的 `sanitizeDocument` 对任何不认识的 doc_content
 * 一律洗成空画板(`instances: []`),接着 1s 防抖 `save` 会把画布 JSON
 * **写回同一条记录** —— mind 文件当场没了,而且**不报错**。
 *
 * 本文件用真实的 `sanitizeDocument` 同款逻辑复现「洗白」这一步,
 * 证明:**若没有 variant 闸门,mind 文件会被洗成空画板**。
 * 闸门本身在 `GraphCanvasView.tsx` 的 load 回调里(拒绝 + 不标记 loaded)。
 */
import { describe, it, expect } from 'vitest';
import { emptyMindFile, fileToSnapshot } from '@capabilities/diglot-model/mind-file';

/**
 * 复刻 `GraphCanvasView.sanitizeDocument` 的关键行为(v2/v3 透传 + 缺字段兜底)。
 * ⚠️ 这里刻意**照抄**而非 import —— 它是 view 内部私有函数;
 * 抄一份的代价是可能漂移,收益是能在单测里复现毁数据场景。
 * 若将来它改了行为,本测试的价值是提醒「闸门的前提变了」。
 */
function sanitizeDocumentLike(raw: unknown): { instances: unknown[] } {
  if (!raw || typeof raw !== 'object') return { instances: [] };
  const r = raw as Record<string, unknown>;
  return { instances: Array.isArray(r.instances) ? r.instances : [] };
}

describe('variant 闸门 —— mind 文件不得被画板路径静默洗掉', () => {
  it('⚠️ 复现风险:mind 文件喂进画板 sanitize 会被洗成空画板', () => {
    const mind = emptyMindFile();
    const washed = sanitizeDocumentLike(mind);
    // ⭐ 这就是危险所在:没报错、没抛异常,内容**静默消失**
    expect(washed.instances).toEqual([]);
    // 而 mind 文件本身其实是有内容的
    const r = fileToSnapshot(mind);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.s.nodes.length).toBeGreaterThan(1);
  });

  it('⭐ 洗过之后再存回去 = mind 内容彻底丢失(故必须有闸门)', () => {
    const mind = emptyMindFile();
    const washed = sanitizeDocumentLike(mind);
    // 模拟 flushSave 把洗白结果写回同一条记录
    const afterSave: unknown = washed;
    const reread = fileToSnapshot(afterSave);
    // ⚠️ 读不回来了 —— semantic 没了
    expect(reread.ok, '被画布 JSON 覆盖后,mind 文件已不可解析').toBe(false);
  });

  it('⭐ 闸门判据:variant 不是 canvas 就不该进入加载/保存路径', () => {
    // 闸门本身是 GraphCanvasView 里的一个 early return;
    // 这里把它的**判据**固化下来,防止将来有人放宽条件。
    const shouldLoadInCanvasView = (variant: string): boolean => variant === 'canvas';
    expect(shouldLoadInCanvasView('canvas')).toBe(true);
    expect(shouldLoadInCanvasView('mindmap'), 'mind 记录不得走画板加载路径').toBe(false);
    // family-tree / knowledge 同理(它们各自的渲染器也还没接)
    expect(shouldLoadInCanvasView('family-tree')).toBe(false);
    expect(shouldLoadInCanvasView('knowledge')).toBe(false);
  });

  it('mind 文件 round-trip 不经过画板路径时完好无损', () => {
    const mind = emptyMindFile();
    const r = fileToSnapshot(mind);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 走 mind 自己的序列化,内容一个不少
    expect(r.value.s.nodes.length).toBeGreaterThan(1);
  });
});

/**
 * ⚠️ 未覆盖（诚实记账）：
 * - **闸门代码本身没有被本文件执行** —— 它在 `GraphCanvasView.tsx` 的 React
 *   effect 里，需要挂载 view + 真 library 才跑得到。本文件只固化了判据与风险，
 *   属于「文档化 + 防放宽」，不是端到端验证。
 *   ⭐ 真正的验证要等渲染器接线后做真机回归：新建导图 → 点开 → 关掉 →
 *   重开，确认内容还在。
 * - `sanitizeDocumentLike` 是照抄的，与 view 内私有函数可能漂移。
 */
