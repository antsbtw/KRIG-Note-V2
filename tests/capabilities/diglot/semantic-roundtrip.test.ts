/**
 * 语义面 ⇄ 画布 双向一致(00 §6 的核心承诺)
 *
 * ⭐ 这是整轮的差异点所在:mermaid 只能「文本→图」,
 * 这里要求**两个方向都成立且不打架**。
 *
 * ⚠️ 本文件测的是**逻辑层的往返一致性**,不是 React 组件
 * (回环抑制在 MindSemanticPane 里靠 ref 标记,要挂载真 CM6 才跑得到)。
 * 端到端要真机点:左边改字 → 右边变;右边拖 → 左边文本变。
 */
import { describe, it, expect } from 'vitest';
import { notImplementedEngine as engine } from '@capabilities/diglot-model/engine-contract';
import {
  emptyMindFile,
  fileToSnapshot,
  snapshotToFile,
} from '@capabilities/diglot-model/mind-file';
import { contentToText, toMermaidMindmap } from '@capabilities/diglot-model/mermaid-mindmap';

function snap() {
  const r = fileToSnapshot(emptyMindFile());
  if (!r.ok) throw new Error('夹具失败');
  return r.value;
}

describe('语义面 → 画布', () => {
  it('⭐ 改文本 → 树跟着变', () => {
    const base = snap();
    const before = base.s.nodes.length;
    // 用户在文本里加了一行
    const edited = [
      'mindmap',
      '  root((主题))',
      '    分支A',
      '      叶子1',
      '      叶子2',
      '    分支B',
      '      叶子3',
      '    分支C',
    ].join('\n');
    const r = fileToSnapshot({ format: 'diglot-mind/v0', semantic: edited, graphic: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.s.nodes.length).toBe(before + 1);
    expect(r.value.s.nodes.some((n) => contentToText(n.content) === '分支C')).toBe(true);
  });

  it('⚠️ 坏语法 → 拒绝,调用侧据此保持上一有效状态(C6)', () => {
    const r = fileToSnapshot({
      format: 'diglot-mind/v0',
      semantic: 'flowchart TD\n  A-->B',
      graphic: '',
    });
    expect(r.ok, '不是 mindmap 就该拒绝').toBe(false);
    expect('value' in r, '不返回半个模型').toBe(false);
  });

  it('⭐ 改文本时 G 层原样带过去(改标签不该动布局,C3)', () => {
    const base = snap();
    const id = base.s.nodes.find((n) => n.parent !== null)!.id;
    const pinned = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 42, y: 43 });
    const graphic = snapshotToFile(pinned).graphic;
    expect(graphic).toContain('pos=42,43');

    // 只改了某个标签的文本
    // ⚠️ v1 的 semantic 是 note doc JSON —— 字符串替换仍然有效(标签就在里面),
    //   但 format 必须声明 v1,否则会走 mermaid 解析分支。
    const edited = snapshotToFile(pinned).semantic.replace('叶子1', '叶子壹');
    const r = fileToSnapshot({ format: 'diglot-mind/v1', semantic: edited, graphic });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ⭐ G 条目必须还在
    expect(snapshotToFile(r.value).graphic).toBe(graphic);
  });
});

describe('画布 → 语义面', () => {
  it('⭐⭐ 拖动节点 → 语义文本零变更(C4 在文本面上的体现)', () => {
    const base = snap();
    const id = base.s.nodes.find((n) => n.parent !== null)!.id;
    const before = snapshotToFile(base).semantic;

    const dragged = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 9, y: 9 });
    // ⭐ 拖动只落 G 层 —— 语义面**一个字都不该变**
    expect(snapshotToFile(dragged).semantic).toBe(before);
    // 而 G 层多了一条
    expect(snapshotToFile(dragged).graphic).toContain('pos=9,9');
  });

  it('⭐ 改结构(裸拖改父)→ 语义文本**必须**跟着变', () => {
    const base = snap();
    const before = snapshotToFile(base).semantic;
    const leaf = base.s.nodes.find((n) => contentToText(n.content) === '叶子1')!;
    const newParent = base.s.nodes.find((n) => contentToText(n.content) === '分支B')!;

    const moved = engine.applyAction(base, {
      kind: 'canvas.dragReparent',
      id: leaf.id,
      newParent: newParent.id,
    });
    const after = snapshotToFile(moved).semantic;
    // ⭐ 这就是「拖了节点,文本跟着变」—— mermaid 做不到的那半
    expect(after).not.toBe(before);
    // ⚠️ v1 的 semantic 是 note doc JSON,没有"缩进行"可言 ——
    //   结构次序改看 **mermaid 投影**(它正是用缩进表达层级的那个形态)。
    const lines = toMermaidMindmap(moved.s).split('\n');
    const bIdx = lines.findIndex((l) => l.includes('分支B'));
    const leafIdx = lines.findIndex((l) => l.includes('叶子1'));
    expect(leafIdx, '叶子1 应排在分支B 之后').toBeGreaterThan(bIdx);
  });

  it('⭐ round-trip:文本 → 图 → 文本,字节一致', () => {
    const base = snap();
    const text1 = snapshotToFile(base).semantic;
    const r = fileToSnapshot({ format: 'diglot-mind/v1', semantic: text1, graphic: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(snapshotToFile(r.value).semantic).toBe(text1);
  });
});
