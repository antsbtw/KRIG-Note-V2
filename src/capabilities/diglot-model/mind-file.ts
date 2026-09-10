/**
 * diglot-model — mind 文件格式(v0)
 *
 * ⭐ 用户拍板(2026-09-10):**方案 A —— 独立 variant,共用 graph 库**。
 * `variant='mindmap'` 复用 `graph_canvas` 表与 `library.create/load/save`。
 *
 * ⚠️⚠️ **这是脚手架,不是最终归属(必须记账)**:
 * `01-mind-spec.md` §3.4 的规格方向是「**mind 就是一篇 note**,
 * `type=mind` 只是解释器选择;同一 blocks 数据可按大纲或导图解释,切换零转换」。
 * 那条路(方案 B)才能让富文本/公式/图片整类白送、树骨架直接复用
 * note 的 `parentId`/`order`/`noteId`(03 §3.2)。
 *
 * 现在走 A 是为了**先把引擎接到真东西上看一眼** ——
 * 双向同步在内存里全绿了,但还没被任何真实交互验证过。
 * ⭐ 迁移到 B 时,本格式的两段文本可**直接喂给 note 导入**,不会白写。
 *
 * ⭐ **为什么两段都存纯文本**:
 * - C1 幂等验的就是**字节** —— 存结构体只能验对象相等,弱得多
 * - 出问题**肉眼能看**(这是「别猜、看真实数据」的前提)
 * - 将来导出 `.md` 零转换:S 层本就是 mermaid,G 层包进 HTML 注释
 *   即可在任何 Markdown 环境**渲染为干净大纲**(00 §4)
 */

import { parseGLayer, serializeGLayer, wrapGLayer } from './g-layer';
import { parseMermaidMindmap, toMermaidMindmap } from './mermaid-mindmap';
import type { ParseResult } from './engine-contract';
import type { DiglotSnapshot } from './engine-contract';

/** 格式标识 —— ⚠️ 带版本,将来改格式时能认出旧档而不是静默错读。 */
export const MIND_FILE_FORMAT = 'diglot-mind/v0' as const;

/**
 * mind 文件内容(存进 `graph_canvas.doc_content`)。
 *
 * ```jsonc
 * {
 *   "format": "diglot-mind/v0",
 *   "semantic": "mindmap\n  root((主题))\n    分支A",  // S 层:mermaid 语法
 *   "graphic": "^m002 pos=420,180\n"                    // G 层:规范形
 * }
 * ```
 */
export interface MindFile {
  readonly format: typeof MIND_FILE_FORMAT;
  /** ⭐ S 层 —— 用户书写,**机器不改写**。前期兼容 mermaid `mindmap` 语法。 */
  readonly semantic: string;
  /** ⭐ G 层 —— 规范形,稀疏。空图时为空串(**不写空壳**)。 */
  readonly graphic: string;
}

/**
 * 新建 mind 的初始内容。
 *
 * ⭐ 用仓库既有的 `Mindmap` 模板(`mermaid-renderer.ts` `MERMAID_TEMPLATES`),
 * 而不是空白 —— **新建即有东西可拖**,能立刻验证双向同步是否真的通。
 *
 * ⚠️ G 层为空串:新建的图**一个 G 条目都没有**,
 * 全靠自动布局(C5 缺省即自动)。这正是稀疏纪律的起点。
 */
export function emptyMindFile(): MindFile {
  return {
    format: MIND_FILE_FORMAT,
    semantic: [
      'mindmap',
      '  root((主题))',
      '    分支A',
      '      叶子1',
      '      叶子2',
      '    分支B',
      '      叶子3',
    ].join('\n'),
    graphic: '',
  };
}

/**
 * 快照 → 文件。
 * ⭐ 幂等:同一快照序列化两次字节相同(C1 由 G 层保证,S 层由 toMermaid 保证)。
 */
export function snapshotToFile(snap: DiglotSnapshot): MindFile {
  return {
    format: MIND_FILE_FORMAT,
    semantic: toMermaidMindmap(snap.s),
    graphic: serializeGLayer(snap.g),
  };
}

/**
 * 文件 → 快照。
 *
 * ⚠️ **坏档不静默兜底**(C6 / 可靠性纲领):
 * 解析失败返回 `ok:false` 且**不返回半个模型**,调用侧保持上一有效状态、
 * 把错误显示出来 —— 而不是给一张空图假装打开成功。
 */
export function fileToSnapshot(raw: unknown): ParseResult<DiglotSnapshot> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: [{ line: 1, message: 'mind 文件内容不是对象' }] };
  }
  const f = raw as Partial<MindFile>;
  if (f.format !== MIND_FILE_FORMAT) {
    return {
      ok: false,
      errors: [{ line: 1, message: `未知 mind 文件格式:${String(f.format)}(期望 ${MIND_FILE_FORMAT})` }],
    };
  }
  if (typeof f.semantic !== 'string') {
    return { ok: false, errors: [{ line: 1, message: 'mind 文件缺少 semantic(S 层)' }] };
  }
  // graphic 缺省视为空 G 层 —— ⚠️ 这是**格式定义**(稀疏:没条目就是没内容),
  // 不是静默兜底:类型错(非字符串非缺席)仍然报错。
  if (f.graphic !== undefined && typeof f.graphic !== 'string') {
    return { ok: false, errors: [{ line: 1, message: 'mind 文件的 graphic(G 层)不是字符串' }] };
  }

  const s = parseMermaidMindmap(f.semantic);
  if (!s.ok) return { ok: false, errors: s.errors };

  const g = parseGLayer(f.graphic ?? '');
  if (!g.ok) return { ok: false, errors: g.errors };

  return { ok: true, value: { s: s.value, g: g.value } };
}

/**
 * 导出为单一 Markdown 文本(`.md` 落盘用)。
 *
 * ⭐ S 层是 mermaid 代码块,G 层包进 HTML 注释 ——
 * 在任何 Markdown 环境**渲染为干净大纲 + 一张 mermaid 图**,
 * G 层不可见但**不丢失**(round-trip 的依据,00 §4)。
 */
export function mindFileToMarkdown(f: MindFile): string {
  const fence = ['```mermaid', f.semantic, '```', ''].join('\n');
  return fence + wrapGLayer(f.graphic);
}
