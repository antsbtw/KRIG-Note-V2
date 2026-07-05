/**
 * 回归守护:导入文档(块 attrs.id=null)编辑后保存不能因缺 id 静默丢失。
 *
 * bug:导入 note 的块带 attrs.id=null;若某编辑路径在 auto-block-id-plugin 补 id 前就
 * emit,主进程 updateNote → diffBlockTree → dissectPmDoc 撞 "block has no attrs.id" throw
 * → note.update handler 抛未捕获 rejection → renderer 无感 → 改动静默不保存。
 * 用户实测报错:`Error occurred in handler for 'note.update': [dissect-pm-doc] block of
 * type paragraph has no attrs.id`。
 *
 * 修复:updateNote 在写库边界用 ensureBlockIds(→injectIdsForCreate)补齐缺 id
 * (reliability 纲领:写库必经处 fail-safe 而非 fail,兜底并 warn 留痕)。
 *
 * 本测试用真实 schema + 真实 auto-block-id-plugin + 真实 dissectPmDoc 离线重放:
 * 锁住 ① 无 id doc 会 throw(bug 存在性)② 补 id 后 dissect OK(修复效果)
 * ③ 有 plugin 在场时删块/turn-into 后 doc 被补齐(前端正常路径不炸)。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';

const deepNoop: unknown = new Proxy(function () {} as object, {
  get: () => deepNoop,
  apply: () => deepNoop,
});
vi.mock('@slot/capability-registry/get-capability-api', () => ({
  getCapabilityApi: vi.fn(() => deepNoop),
  requireCapabilityApi: vi.fn(() => deepNoop),
}));
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
g.window ??= g;
const win = g.window as Record<string, unknown>;
win.electronAPI ??= { learningVocabList: () => Promise.resolve([]) };
win.addEventListener ??= () => {};
win.removeEventListener ??= () => {};

/* eslint-disable @typescript-eslint/no-explicit-any */
let schema: any, buildAutoBlockIdPlugin: any, serializeDoc: any, deserializeDoc: any, dissectPmDoc: any;

beforeAll(async () => {
  const sb = await import('@drivers/text-editing-driver/schema-builder');
  const eb = await import('@drivers/text-editing-driver/enabled-blocks');
  const pl = await import('@drivers/text-editing-driver/plugins/build-auto-block-id-plugin');
  const ds = await import('@platform/main/note/dissect-pm-doc');
  schema = sb.buildSchema(eb.ENABLED_BLOCKS);
  buildAutoBlockIdPlugin = pl.buildAutoBlockIdPlugin;
  serializeDoc = sb.serializeDoc;
  deserializeDoc = sb.deserializeDoc;
  dissectPmDoc = ds.dissectPmDoc;
});

/** 仿导入产物:所有 block 的 attrs.id 缺失(id:null),含嵌套 list > listItem > paragraph */
function importedEnvelope() {
  return {
    format: 'pm-doc-json' as const,
    version: '0.1',
    payload: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, isTitle: true }, content: [{ type: 'text', text: '第一章' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文段落一' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '映射概念' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }] },
          ],
        },
      ],
    },
  };
}

/** 判定:dissect 是否 throw(= 真实保存链路会不会拒绝) */
function dissectResult(doc: any): string | null {
  try {
    dissectPmDoc('note:test', serializeDoc(doc).payload);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

describe('handle 删块/turn-into 后保存(导入无 id doc)', () => {
  it('基线:刚加载(未 dispatch)的无 id doc dissect 必 throw', () => {
    const doc = deserializeDoc(importedEnvelope(), schema);
    expect(dissectResult(doc)).toContain('has no attrs.id');
  });

  it('修复:写库边界补齐缺失 attrs.id 后,同一无 id doc dissect 应 OK', () => {
    // 复刻 updateNote → ensureBlockIds → injectIdsForCreate 的兜底规则:递归、跳结构性
    // 容器、只补 attrs 里声明了 id 字段但为空的 block。
    const STRUCTURAL = new Set(['bulletList', 'orderedList', 'taskList', 'columnList', 'columnBlock']);
    let counter = 0;
    function fillIds(node: any): any {
      const out: any = { type: node.type };
      if (node.attrs !== undefined) out.attrs = { ...node.attrs };
      if (node.marks !== undefined) out.marks = node.marks;
      if (node.text !== undefined) out.text = node.text;
      if (Array.isArray(node.content)) out.content = node.content.map(fillIds);
      if (!STRUCTURAL.has(node.type) && out.attrs && 'id' in out.attrs && !out.attrs.id) {
        out.attrs.id = `test-ulid-${counter++}`;
      }
      return out;
    }
    const rawPayload = serializeDoc(deserializeDoc(importedEnvelope(), schema)).payload;
    const filled = fillIds(rawPayload);
    let threw: string | null = null;
    try {
      dissectPmDoc('note:test', filled);
    } catch (e) {
      threw = (e as Error).message;
    }
    expect(threw, `补 id 后 dissect 仍报错:${threw}`).toBeNull();
  });

  it('删除顶层段落后 emit 的 doc,dissect 应 OK(plugin 已补齐剩余块 id)', () => {
    const doc = deserializeDoc(importedEnvelope(), schema);
    let state = EditorState.create({ schema, doc, plugins: [buildAutoBlockIdPlugin()] });
    // 定位 '正文段落一' 段落的 pos(顶层第 2 块)
    let pPos = -1;
    state.doc.forEach((n: any, offset: number) => {
      if (n.type.name === 'paragraph' && n.textContent === '正文段落一') pPos = offset;
    });
    expect(pPos).toBeGreaterThanOrEqual(0);
    const node = state.doc.nodeAt(pPos);
    // 模拟 deleteBlockAt:delete 该块整段
    const tr = state.tr.delete(pPos, pPos + node!.nodeSize);
    state = state.apply(tr); // 跑 appendTransaction 补 id
    const msg = dissectResult(state.doc);
    console.log('[repro] 删块后 dissect:', msg ?? 'OK');
    expect(msg, `删块后仍报错:${msg}`).toBeNull();
  });

  it('turn-into(list item lift)后 emit 的 doc,dissect 应 OK', async () => {
    const doc = deserializeDoc(importedEnvelope(), schema);
    let state = EditorState.create({ schema, doc, plugins: [buildAutoBlockIdPlugin()] });
    // 定位第一个 listItem 的 pos
    let itemPos = -1;
    state.doc.descendants((n: any, p: number) => {
      if (n.type.name === 'listItem' && itemPos < 0) itemPos = p;
    });
    expect(itemPos).toBeGreaterThan(0);
    const node = state.doc.nodeAt(itemPos);
    // 复刻 turnIntoAt 的 lift(listItem → 提取内容)
    const { liftTarget } = await import('prosemirror-transform');
    const range = state.doc.resolve(itemPos + 1).blockRange(state.doc.resolve(itemPos + node!.nodeSize - 1));
    const depth = range ? liftTarget(range) : null;
    expect(depth).not.toBeNull();
    const tr = state.tr.lift(range!, depth!);
    state = state.apply(tr);
    const msg = dissectResult(state.doc);
    console.log('[repro] turn-into lift 后 dissect:', msg ?? 'OK');
    expect(msg, `turn-into 后仍报错:${msg}`).toBeNull();
  });
});
