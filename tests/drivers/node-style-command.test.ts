/**
 * node-style-command headless 整 doc 改样式回归守护(L5-G5 / G5.4)
 *
 * 画板文字节点平时无挂载 EditorView,改样式走 headless 纯 doc 变换。
 * 锁住:toggleMark / setTextColor / setAlign / toggleList 的整 doc 语义。
 *
 * 注:headless schema 用与 Host 等价的全 ENABLED_BLOCKS(不缩水,避免 schema 漂移 —
 * 文字节点 doc 可含 table/math 等)。其中 math-block node-view 模块级 new
 * IntersectionObserver —— 浏览器有,node 测试环境无,这里补最小 stub(产品侧渲染进程
 * 原生有该 global,非产品 bug)。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { DriverSerialized } from '@drivers/text-editing-driver/types';

// 全 ENABLED_BLOCKS import 链顺带拉起 learning vocab 集成,它 lazy 调
// requireCapabilityApi('text-editing')。shared setup.ts 的 mock 对未 stub cap 抛错,
// 这里补成 noop(与本测试无关 — 本测试只验 headless doc 变换)。
// 深 no-op:任意属性访问 / 调用都返回另一个 no-op,吞掉 learning 集成的链式调用。
const deepNoop: unknown = new Proxy(function () {} as object, {
  get: () => deepNoop,
  apply: () => deepNoop,
});
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => deepNoop),
  requireCapabilityApi: vi.fn(() => deepNoop),
}));

// 测试环境(node)无 IntersectionObserver / ResizeObserver — 补最小 stub,
// 让 enabled-blocks 的 node-view 模块能 eval(它们在产品渲染进程里有原生实现)。
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
const g = globalThis as unknown as Record<string, unknown>;
g.IntersectionObserver ??= NoopObserver;
g.ResizeObserver ??= NoopObserver;
// 全 ENABLED_BLOCKS import 链顺带拉起 learning vocab 集成,它 lazy 读 window.electronAPI。
// node 测试环境无 window/electronAPI — 补最小 stub(产品渲染进程原生有,非产品 bug)。
g.window ??= g;
const win = g.window as Record<string, unknown>;
win.electronAPI ??= { learningVocabList: () => Promise.resolve([]) };
win.addEventListener ??= () => {};
win.removeEventListener ??= () => {};

// 动态 import:确保上面的 stub 先于 driver 模块 eval(静态 import 会被提升)。
let applyNodeStyleCommand: typeof import('@drivers/text-editing-driver/node-style-command').applyNodeStyleCommand;

beforeAll(async () => {
  ({ applyNodeStyleCommand } = await import(
    '@drivers/text-editing-driver/node-style-command'
  ));
});

function makeDoc(): DriverSerialized {
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '世界' }] },
      ],
    },
  };
}

function firstTextMarks(doc: DriverSerialized): string[] {
  const payload = doc.payload as {
    content: { content?: { marks?: { type: string }[] }[] }[];
  };
  return (payload.content[0].content?.[0]?.marks ?? []).map((m) => m.type);
}

describe('applyNodeStyleCommand (headless 整 doc 改样式 — G5.4)', () => {
  it('toggleMark bold:整 doc 加粗', () => {
    const out = applyNodeStyleCommand(makeDoc(), { kind: 'toggleMark', mark: 'bold' });
    expect(out).not.toBeNull();
    expect(firstTextMarks(out!)).toContain('bold');
  });

  it('toggleMark bold 两次:整 doc 取消加粗', () => {
    const bolded = applyNodeStyleCommand(makeDoc(), { kind: 'toggleMark', mark: 'bold' });
    const unbolded = applyNodeStyleCommand(bolded!, { kind: 'toggleMark', mark: 'bold' });
    expect(unbolded).not.toBeNull();
    expect(firstTextMarks(unbolded!)).not.toContain('bold');
  });

  it('setTextColor:整 doc 文字色 → textStyle mark 带 color', () => {
    const out = applyNodeStyleCommand(makeDoc(), { kind: 'setTextColor', color: '#ff0000' });
    expect(out).not.toBeNull();
    const payload = out!.payload as {
      content: { content?: { marks?: { type: string; attrs?: { color?: string } }[] }[] }[];
    };
    const mark = payload.content[0].content?.[0]?.marks?.find((m) => m.type === 'textStyle');
    expect(mark?.attrs?.color).toBe('#ff0000');
  });

  it('setAlign center:paragraph align=center', () => {
    const out = applyNodeStyleCommand(makeDoc(), { kind: 'setAlign', align: 'center' });
    expect(out).not.toBeNull();
    const payload = out!.payload as { content: { attrs?: { align?: string } }[] };
    expect(payload.content[0].attrs?.align).toBe('center');
  });

  it('toggleList bullet:整 doc 包成 bulletList', () => {
    const out = applyNodeStyleCommand(makeDoc(), { kind: 'toggleList', list: 'bullet' });
    expect(out).not.toBeNull();
    const payload = out!.payload as { content: { type: string }[] };
    expect(payload.content[0].type).toBe('bulletList');
  });

  it('toggleList bullet 两次:回到非列表 paragraph', () => {
    const listed = applyNodeStyleCommand(makeDoc(), { kind: 'toggleList', list: 'bullet' });
    const unlisted = applyNodeStyleCommand(listed!, { kind: 'toggleList', list: 'bullet' });
    expect(unlisted).not.toBeNull();
    const payload = unlisted!.payload as { content: { type: string }[] };
    expect(payload.content[0].type).toBe('paragraph');
  });

  it('坏 doc:返回 null(fail loud,view 不写盘)', () => {
    const bad = { format: 'nope', version: '0.1', payload: {} } as unknown as DriverSerialized;
    expect(applyNodeStyleCommand(bad, { kind: 'toggleMark', mark: 'bold' })).toBeNull();
  });
});
