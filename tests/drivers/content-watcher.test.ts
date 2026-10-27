/**
 * 盯一段内容(instanceRegistry.watch / notifyDocChanged)—— 发推预览窗「回 note 改,预览跟着刷新」靠它(2026-10-27)
 *
 * 钉:选区两头 / 中间打字都还在范围里;选区前面插字范围跟着挪;整篇模式取整个 doc;取消后不再推;实例删了推 null。
 */
import { describe, expect, it } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { instanceRegistry } from '../../src/drivers/text-editing-driver/instance-registry';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('甲乙丙丁')), schema.node('paragraph', null, schema.text('后面'))]);
const texts = (c: unknown[] | null): string => JSON.stringify(c).replace(/[^一-鿿|]/g, '');

function setup(range: { from: number; to: number; whole: boolean }) {
  const id = `t-${Math.random()}`;
  instanceRegistry.set(id, { view: {} as EditorView });
  let state = EditorState.create({ doc });
  const got: Array<unknown[] | null> = [];
  const stop = instanceRegistry.watch(id, { ...range, onChange: (c) => got.push(c) });
  const insert = (pos: number, s: string): void => {
    const tr = state.tr.insertText(s, pos);
    state = state.apply(tr);
    instanceRegistry.notifyDocChanged(id, tr, state.doc);
  };
  return { id, got, stop, insert };
}

describe('盯一段内容', () => {
  /** 「乙丙」= 位置 2..4(段落开头是 1) */
  it('中间打字:新字在里面', () => {
    const w = setup({ from: 2, to: 4, whole: false });
    w.insert(3, '新');
    expect(texts(w.got[0])).toBe('乙新丙');
  });
  it('两头打字也算在里面', () => {
    const w = setup({ from: 2, to: 4, whole: false });
    w.insert(2, '头');
    w.insert(5, '尾');
    expect(texts(w.got[1])).toBe('头乙丙尾');
  });
  it('选区前面插字:范围跟着挪,内容不变', () => {
    const w = setup({ from: 2, to: 4, whole: false });
    w.insert(1, '前前');
    expect(texts(w.got[0])).toBe('乙丙');
  });
  it('整篇模式:每次取整个 doc', () => {
    const w = setup({ from: 0, to: 0, whole: true });
    w.insert(9, '!');
    expect(texts(w.got[0])).toBe('甲乙丙丁后面');
  });
  it('取消后不再推', () => {
    const w = setup({ from: 2, to: 4, whole: false });
    w.stop();
    w.insert(3, '新');
    expect(w.got).toHaveLength(0);
  });
  it('实例删了推 null(预览窗据此说「note 已关闭」)', () => {
    const w = setup({ from: 2, to: 4, whole: false });
    instanceRegistry.delete(w.id);
    expect(w.got).toEqual([null]);
  });
});
