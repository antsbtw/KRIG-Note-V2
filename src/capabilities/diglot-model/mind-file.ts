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
import { noteDocToTree, treeToNoteDoc } from './note-projection';
import type { SLayer } from './types';
import type { ParseResult } from './engine-contract';
import type { DiglotSnapshot } from './engine-contract';

/** 格式标识 —— ⚠️ 带版本,将来改格式时能认出旧档而不是静默错读。 */
export const MIND_FILE_FORMAT = 'diglot-mind/v1' as const;

/**
 * ⭐ 旧格式:S 层存 mermaid 文本。**仍然可读**(用户已有文件),只是不再写出。
 *
 * ⚠️ v0 为什么废弃(实测,规格 03 §5.6):mermaid 的 mindmap 语法
 * **一个节点只有一行纯文本标签**,装不下「节点 = 标题 + 正文」——
 * 内存里 2 块,存一次变 1 块,行内公式直接变空串。
 */
export const MIND_FILE_FORMAT_V0 = 'diglot-mind/v0' as const;

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
  /**
   * ⭐⭐ S 层 —— **note doc(PM JSON)序列化串**,用户书写、机器不改写。
   *
   * ⚠️ v0 曾是 mermaid 文本,已废(见 MIND_FILE_FORMAT_V0):
   * mermaid 装不下节点正文 / 行内公式 / marks。
   * ⭐ 改存 note doc 之后,「格式装不下富内容」这类问题不会再出现 ——
   * note doc 本来就是富文本的完整载体。
   *
   * mermaid 降为**导入/导出**通道(用户口径:导入居多),是**有损投影**:
   * 只保住层级 + 标题纯文本。
   */
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
  // ⭐ 模板仍用 mermaid **书写**(可读性好),但立刻转成 v1 的 note doc 存法 ——
  //   ⚠️ 不能直接把 mermaid 串塞进 v1 的 semantic:格式说它是 note doc JSON,
  //     塞 mermaid 进去就是**声明与内容不符**(改版本号时踩过:夹具全红)。
  const seed = parseMermaidMindmap(
    [
      'mindmap',
      '  root((主题))',
      '    分支A',
      '      叶子1',
      '      叶子2',
      '    分支B',
      '      叶子3',
    ].join('\n'),
  );
  if (!seed.ok) {
    // ⚠️ 模板是代码里写死的,解析不了说明代码本身坏了 —— fail loud,不给半张空图
    throw new Error('[diglot] 内置 mind 模板解析失败(代码 bug,不是用户数据问题)');
  }
  return {
    format: MIND_FILE_FORMAT,
    semantic: JSON.stringify(treeToNoteDoc(seed.value)),
    graphic: '',
  };
}

/**
 * 快照 → 文件。
 * ⭐ 幂等:同一快照序列化两次字节相同(C1 由 G 层保证,S 层由 toMermaid 保证)。
 */
export function snapshotToFile(snap: DiglotSnapshot): MindFile {
  // ⚠️⚠️ **不要在这里给节点写显式 id**(2026-09-10 试过,被 C4 断言挡回)。
  //
  // 动机曾是:用户在文本里增删行后,解析器按行序重分配 id,G 条目会配错。
  // 但把 id 写进语义文本,会让「拖动节点」产生的 G 条目**反过来改动语义文本**
  // (多出 `m002[分支A]`)—— 直接违反 C4「画布拖动 → S 层零变更」。
  //
  // ⭐ 两者不可兼得:**id 不能既是语义面的内容,又对语义面透明**。
  // 正解方向(未做):把稳定 id 变成**书写表面之外**的东西 ——
  // KRIG 投影里它天然存在(block id,见 01 §5),平文本投影才需要 `^id`,
  // 而 `^id` 应由**用户主动写**(规格 §3.2「想连线,先命名」),不是机器补。
  // 记账见 03-projection-map §6。
  return {
    format: MIND_FILE_FORMAT,
    // ⭐⭐ 存 note doc,不再存 mermaid —— 富内容(正文块/公式/marks)完整保住。
    //   ⚠️ treeToNoteDoc 与 noteDocToTree 严格互逆(§5.5 有往返断言钉着),
    //     所以这是无损的;而 toMermaidMindmap 是有损投影,只配做导出。
    semantic: JSON.stringify(treeToNoteDoc(snap.s)),
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
  // ⚠️ 读入端的 format 可能是 v0(旧档)或任意脏值 —— 类型放宽到 string,
  //   不能用 Partial<MindFile>(它把 format 窄化成 v1,v0 分支会被判成"不可能")。
  const f = raw as { format?: string; semantic?: unknown; graphic?: unknown };
  // ⭐ v0(mermaid)仍然可读 —— 用户已有文件不能打不开。
  //   ⚠️ 只读不写:存盘一律写 v1,等于**打开即迁移**,无损
  //   (v0 每个节点本来就只有一行标签)。
  const isV0 = f.format === MIND_FILE_FORMAT_V0;
  if (f.format !== MIND_FILE_FORMAT && !isV0) {
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

  // ⭐ v0 = mermaid 文本;v1 = note doc 的 JSON 串
  const s = isV0 ? parseMermaidMindmap(f.semantic) : parseNoteDocSemantic(f.semantic);
  if (!s.ok) return { ok: false, errors: s.errors };

  const g = parseGLayer(f.graphic ?? '');
  if (!g.ok) return { ok: false, errors: g.errors };

  return { ok: true, value: { s: s.value, g: g.value } };
}

/**
 * ⭐⭐ 从 **semantic 内容本身**判断格式版本。
 *
 * ⚠️ 为什么需要它:`mind_doc` 表**不存 format**(mind-store §8 实测:
 * 存了读回来是 undefined,所以那一层只留 semantic/graphic 两段文本)。
 * 加载时若写死一个版本,另一个版本的文件就打不开 ——
 * v1 上线后写死 v0,会让**所有新存的图都加载失败**。
 *
 * ⭐ 判据可靠:v1 是 JSON 对象串(`{"format":"pm-doc-json",...}`),
 * v0 是 mermaid 文本(必须以 `mindmap` 开头,见 parseMermaidMindmap)。
 * 两者在语法上不可能混淆。
 */
export function detectMindFormat(semantic: string): typeof MIND_FILE_FORMAT | typeof MIND_FILE_FORMAT_V0 {
  return semantic.trimStart().startsWith('{') ? MIND_FILE_FORMAT : MIND_FILE_FORMAT_V0;
}

/**
 * v1 的 S 层:note doc JSON 串 → SLayer。
 *
 * ⚠️ 解析失败**不兜底**(C6 / 可靠性纲领):返回 ok:false,
 * 调用侧保持上一有效状态并显示错误,而不是给一张空图假装打开成功。
 */
function parseNoteDocSemantic(text: string): ParseResult<SLayer> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [{ line: 1, message: `S 层不是合法 JSON:${e instanceof Error ? e.message : String(e)}` }],
    };
  }
  try {
    const tree = noteDocToTree(doc);
    return { ok: true, value: tree };
  } catch (e) {
    return {
      ok: false,
      errors: [{ line: 1, message: `S 层不是合法 note doc:${e instanceof Error ? e.message : String(e)}` }],
    };
  }
}

/**
 * 导出为单一 Markdown 文本(`.md` 落盘用)。
 *
 * ⭐ S 层是 mermaid 代码块,G 层包进 HTML 注释 ——
 * 在任何 Markdown 环境**渲染为干净大纲 + 一张 mermaid 图**,
 * G 层不可见但**不丢失**(round-trip 的依据,00 §4)。
 */
export function mindFileToMarkdown(f: MindFile): string {
  // ⚠️⚠️ v1 的 `semantic` 是 **note doc JSON**,不能直接塞进 ```mermaid 围栏
  //   (那样 markdown 里会渲出一坨 JSON)。这里现投影成 mermaid ——
  //   ⭐ 这正是 mermaid 的新定位:**导出通道**,而且是**有损**的
  //   (只保住层级 + 标题纯文本;正文块 / 行内公式 / marks 都表达不了,见 03 §5.6)。
  const tree = fileToSnapshot(f);
  const mermaid = tree.ok ? toMermaidMindmap(tree.value.s) : '';
  const fence = ['```mermaid', mermaid, '```', ''].join('\n');
  return fence + wrapGLayer(f.graphic);
}
