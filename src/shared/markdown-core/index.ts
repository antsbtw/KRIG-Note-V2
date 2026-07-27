/**
 * markdown-core —— 唯一 markdown → PMNode[] 解析核（B4b 收官：全 block 进核）。
 *
 * **铁律**：
 *  - 纯 sync、无副作用、无媒体 I/O（base64→media:// 本地化留各自外壳做后处理，src 原样）。
 *  - 覆盖全部 block：heading / paragraph / horizontalRule / codeBlock（fence 长度配对）/
 *    mathBlock / mathInline + 基础 inline mark（B1）；table / callout（B2）；image / video /
 *    audio / htmlBlock / fileBlock / externalRef（B3）；blockquote / list / task（B4a）。
 *    入口 loop 见 parse.ts（B4b 接入全构造器）。极罕见空 mathBlock / 全零单元格 table 仍
 *    产 UNCOVERED 哨兵交 caller，不静默吞。
 *
 * 消费方：
 *  - ① aiMarkdownToNoteDoc：AI 预处理（JSON/widget/LaTeX/包裹展开/<<IMAGE>>）→ markdownCore
 *    → PMNode[]（B4b 废 ExtractedBlock 中间态，① 成核的薄 caller）。① 无媒体本地化，raw src 即可。
 *  - ② markdownToProseMirror：暂保留自己的 async 外壳 loop（媒体本地化），调各构造器；
 *    未来可薄化到调 markdownCore + 外壳后处理，不在 B4b 范围。
 */

export { markdownCore } from './parse';
export type { PMNode, PMMark, UncoveredNode } from './types';
export { UNCOVERED_TYPE, isUncovered, uncoveredNode } from './types';
export { parseInline, applyMark } from './inline';
export { tryParseFencedCode } from './fence';
export type { FencedCode } from './fence';
export {
  buildHeadingNode,
  buildParagraphNode,
  buildHorizontalRuleNode,
  buildCodeBlockNode,
  buildMathBlockNode,
  tryParseCodeBlock,
} from './blocks';
// 阶段 B2：table + callout canonical 构造器（①② 都调）。
export {
  CALLOUT_EMOJI_MAP,
  calloutEmojiFor,
  buildCalloutNode,
  buildTableNode,
  splitCellOnBr,
} from './table-callout';
// 阶段 B3：媒体类 block canonical 构造器 + 纯解析（src 原样，async 本地化留外壳）。
export {
  parseImageSrc,
  buildImageNode,
  buildVideoNode,
  buildAudioNode,
  buildHtmlBlockNode,
  buildFileBlockNode,
  buildExternalRefNode,
  tryParseMediaTag,
  tryParseObsidianVideoEmbed,
} from './media-blocks';
export type { ParsedImageSrc } from './media-blocks';
// 阶段 B4a：blockquote/list canonical 构造器 + list 标记分类（递归内容留外壳，核纯 sync）。
export {
  stripBlockquotePrefix,
  buildBlockquoteNode,
  classifyListLine,
  buildListItemNode,
  buildBulletListNode,
  buildOrderedListNode,
  buildTaskItemNode,
  buildTaskListNode,
} from './blockquote-list';
export type { ListMarkerKind, ListLineInfo } from './blockquote-list';

