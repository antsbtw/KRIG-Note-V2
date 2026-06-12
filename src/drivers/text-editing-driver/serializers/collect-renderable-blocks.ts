/**
 * 收集「视觉即内容、纯文本装不下」的 block(公式 / 代码)→ 供渲染成图。
 *
 * 缘起(X 截图 2026-06):X compose 是纯文本,mathBlock 序列化成 `$$..$$` 裸源码、
 * codeBlock 丢高亮。发推前要把这些 block 渲染成图当附件发(复用 atomsToSvg + 2.5-b
 * 附件管道)。本模块只负责「识别 + 取出这些 block 的 atom JSON」(与 markdown 序列化
 * 同源走 slice/doc),渲染/喂图在 view 层做。
 *
 * 与 pm-to-markdown 同层(都是「PM node → 某种产物」),刻意放一起,别散到别处
 * (见 docs/reference/block-serialization-map.md 的分层张力)。
 *
 * 本期范围(总指挥 2026-06-12 拍板):
 * - mathBlock(块级公式)、codeBlock(含 Mermaid,按 language 区分)。
 * - mathInline(行内公式)**不收**:atomsToSvg 顶层只渲块级,行内单独成图割裂语境,
 *   降级保留文本源码($latex$),留 TODO。
 * - table 本期不做(降级文本至少能读)。
 *
 * 顺序:按 block 在文档中出现的先后(与 4 图额度「取前 4」语义对齐)。
 * 嵌套:递归进 container(blockquote / list / callout / column 等),里面的
 * 公式/代码块一样收(它们在正文里同样会裸奔)。
 */

import type { Node as PMNode, Slice } from 'prosemirror-model';

/** 一个待渲染成图的 block。atom 是 node.toJSON()(atomsToSvg 直接消费的形态)。 */
export interface RenderableBlock {
  /**
   * math = 块级公式;code = 普通代码块;mermaid = mermaid 代码块(走专用渲染);
   * mathVisual = 函数图像(直接拿 thumbnail SVG attr,X Articles 内嵌图扩展,2026-06-12)。
   */
  kind: 'math' | 'code' | 'mermaid' | 'mathVisual';
  /** node.toJSON() —— 即 atomsToSvg 消费的 Atom 形态(mathBlock/codeBlock) */
  atom: Record<string, unknown>;
  /** 代码块语言(code/mermaid 用;math 为空)。 */
  language?: string;
  /** 源码文本(mermaid 渲染需要;也供调试)。 */
  source: string;
}

function nodeSource(node: PMNode): string {
  // mathBlock / codeBlock 都是 content='text*',textContent 即源码;
  // 兼容老数据 attrs.latex(mathBlock 旧形态)。
  return ((node.attrs?.latex as string) || node.textContent || '');
}

/**
 * 收集选项。
 * - includeMathVisual:额外收 mathVisual(函数图像)→ X Articles 内嵌图扩展用。
 *   **默认 false**:发推/回复路径(原消费者)不收 mathVisual,行为零变化(防回归)。
 */
export interface CollectOptions {
  includeMathVisual?: boolean;
}

/** 单个 node:若是公式/代码块 → push 到 out;否则递归其子(收容器内的)。 */
function walkNode(node: PMNode, out: RenderableBlock[], opts: CollectOptions): void {
  const name = node.type.name;
  if (name === 'mathBlock') {
    out.push({ kind: 'math', atom: node.toJSON() as Record<string, unknown>, source: nodeSource(node) });
    return; // 公式块内无更深的可渲染 block
  }
  if (name === 'codeBlock') {
    const language = ((node.attrs?.language as string) || '').toLowerCase();
    out.push({
      kind: language === 'mermaid' ? 'mermaid' : 'code',
      atom: node.toJSON() as Record<string, unknown>,
      language,
      source: nodeSource(node),
    });
    return;
  }
  if (name === 'mathVisual' && opts.includeMathVisual) {
    // 函数图像:source 用 thumbnail(SVG)—— render 时直接拿,不重渲(矩阵建议)。
    out.push({
      kind: 'mathVisual',
      atom: node.toJSON() as Record<string, unknown>,
      source: (node.attrs?.thumbnail as string) || '',
    });
    return; // mathVisual 内 caption 不收渲
  }
  // 其他:递归子节点(容器 block 里也可能嵌公式/代码)。
  node.forEach((child) => walkNode(child, out, opts));
}

/** 从整篇 doc 收集。 */
export function collectRenderableBlocksFromDoc(doc: PMNode, opts: CollectOptions = {}): RenderableBlock[] {
  const out: RenderableBlock[] = [];
  doc.forEach((child) => walkNode(child, out, opts));
  return out;
}

/** 从选区 slice 收集(与 getSelectionMarkdown 同源 state.selection.content())。 */
export function collectRenderableBlocksFromSlice(slice: Slice, opts: CollectOptions = {}): RenderableBlock[] {
  const out: RenderableBlock[] = [];
  if (!slice || slice.size === 0) return out;
  slice.content.forEach((child) => walkNode(child, out, opts));
  return out;
}
