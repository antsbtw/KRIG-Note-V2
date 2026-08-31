/**
 * blockquote / list 的 canonical 构造器 + 标记分类（阶段 B4a）——①② 都调的唯一真源。
 *
 * **铁律**：核纯 sync、无副作用、无媒体 I/O。
 *
 * 指挥拍板（见 docs/90-archive/tasks/2026-07-27-stage-B4a-blockquote-list-proposal.md）：
 *  - blockquote：采 ② 递归任意 block（CommonMark 兼容；① 从 inline-only 升级为递归）。
 *  - list：取「① item 内嵌 block ∪ ② task list」并集（不丢任一侧能力）。
 *  - 子列表嵌套：本任务保持 flatten（两侧现状），真嵌套另立项。
 *
 * **async 分层（关键）**：blockquote/list 的**内容递归**留在各自外壳做 —— ② 的 blockquote/
 * list item 内容可含 image，需走 ② 外壳的 async 媒体本地化（resolvePMImageSrc）；核若强行
 * sync 递归 markdownCore 会丢 ② 的嵌套媒体本地化（回归）。故核只提供**canonical 构造器**
 * （吃已解析好的内层 PMNode）+ **list 标记分类**（sync 纯正则），递归由 caller 用自己的
 * pipeline 做（② 递归 markdownToProseMirror 保持 async 媒体本地化；① 递归自己的 block 解析）。
 * 核纯度不破、② 嵌套媒体本地化不丢 —— 与 B3「解析进核、async 留外壳」同一分层原则。
 */

import type { PMNode } from './types';

// ─── blockquote ─────────────────────────────────────────────────────

/**
 * 从 blockquote 行剥引用前缀 `>`（沿用 ② 的容错：trimStart 容忍行首缩进 + `\s?` 容忍
 * `>` 后 0/1 空格）。防无限递归的根因（2026-06-30 relay-design-v2 栈溢出）就在这个容错剥离。
 */
export function stripBlockquotePrefix(line: string): string {
  return line.replace(/^\s*>\s?/, '');
}

/**
 * blockquote canonical 节点：`blockquote > (已解析的内层 block+)`。
 * 内层 block 由 caller 递归自己的 pipeline 产出（② async / ① sync）后传进来 —— 核不递归、
 * 不碰媒体。内层为空时兜一个空 paragraph（blockquote schema content='block+' 不许空）。
 */
export function buildBlockquoteNode(innerBlocks: PMNode[]): PMNode {
  return {
    type: 'blockquote',
    content: innerBlocks.length > 0 ? innerBlocks : [{ type: 'paragraph' }],
  };
}

// ─── list 标记分类（sync 纯正则）────────────────────────────────────

export type ListMarkerKind = 'bullet' | 'ordered' | 'task';

export interface ListLineInfo {
  kind: ListMarkerKind;
  /** task 专用：`[x]` → true，`[ ]` → false；非 task 为 undefined */
  checked?: boolean;
  /** 剥掉标记（含 task 的 `[ ]`）后的正文文本 */
  text: string;
}

/**
 * 分类一行是否为 list item 起始，返回类型 + 正文（不命中返 null）。
 * 识别顺序：task（`- [ ]` / `* [x]`）优先于 bullet（否则 `[ ]` 落进 bullet 正文），
 * 再 ordered（`1.`）。缩进（`^\s*`）容忍但不据此判嵌套（本任务 flatten，缩进被剥）。
 *
 * 与 ②/① 现有正则对齐：
 *  - task：② `^\s*[-*]\s+\[([ x])\]\s`（core 收口，① 以前无 task）
 *  - bullet：`^\s*[-*+]\s+`（① 含 `+`，② 只 `-*`；core 取并集含 `+`，对 ② 是超集扩展——
 *    `+ item` ② 以前落 paragraph，现在识别为 bullet，属能力增强，非回归丢内容）
 *  - ordered：`^\s*\d+\.\s+`
 */
export function classifyListLine(line: string): ListLineInfo | null {
  // task list（必须先于 bullet）
  const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
  if (task) {
    return { kind: 'task', checked: task[1].toLowerCase() === 'x', text: task[2] };
  }
  // bullet（排除 task 的 `- [ ]` 已在上面截获；这里 `- [x` 若非合法 task 会当 bullet）
  const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
  if (bullet) {
    return { kind: 'bullet', text: bullet[1] };
  }
  // ordered
  const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
  if (ordered) {
    return { kind: 'ordered', text: ordered[1] };
  }
  return null;
}

// ─── list canonical 构造器（吃已解析内层 block）─────────────────────

/**
 * listItem canonical 节点：`listItem > (block+)`。
 * itemBlocks 由 caller 产出（首个 paragraph + 可选内嵌 block；② 单行时就一个 paragraph）。
 * 空兜一个空 paragraph（listItem schema content='block+' 不许空）。
 */
export function buildListItemNode(itemBlocks: PMNode[]): PMNode {
  return {
    type: 'listItem',
    content: itemBlocks.length > 0 ? itemBlocks : [{ type: 'paragraph' }],
  };
}

/** bulletList / orderedList canonical 节点：`(bullet|ordered)List > listItem+`。 */
export function buildBulletListNode(items: PMNode[]): PMNode {
  return { type: 'bulletList', content: items };
}
export function buildOrderedListNode(items: PMNode[]): PMNode {
  return { type: 'orderedList', content: items };
}

/**
 * taskItem canonical 节点：`taskItem{checked,createdAt} > (block+)`。
 * createdAt 由 caller 传（导入时刻；核不产时间 —— Date.now 非纯，且核在 shared 禁副作用）。
 * itemBlocks 同 listItem。
 */
export function buildTaskItemNode(
  checked: boolean,
  createdAt: string,
  itemBlocks: PMNode[],
): PMNode {
  return {
    type: 'taskItem',
    attrs: { checked, createdAt },
    content: itemBlocks.length > 0 ? itemBlocks : [{ type: 'paragraph' }],
  };
}

/** taskList canonical 节点：`taskList > taskItem+`。 */
export function buildTaskListNode(items: PMNode[]): PMNode {
  return { type: 'taskList', content: items };
}
