/**
 * input-rules — markdown 风格输入快捷
 *
 * Block-level(headings):
 *   `# ` → h1 / `## ` → h2 / `### ` → h3
 *
 * Mark-level(markdown):
 *   `**xx** ` → bold / `*xx* ` → italic / `\`xx\` ` → code / `~~xx~~ ` → strike
 *
 * 触发字符必须是空格 — 跟 V1 / Notion / Tiptap 一致(避免输入中误触)。
 *
 * 注意 IME(中文拼音)期间 inputRules 自动跳过(prosemirror-inputrules 标准行为)。
 */

import { inputRules, InputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { TextSelection, type Plugin } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import type { Schema, MarkType, NodeType } from 'prosemirror-model';

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];
  const paragraph = schema.nodes.paragraph;
  const heading = schema.nodes.heading;

  // ── Headings(block-level): `# `..`###### ` → heading{level} ──
  // D2 决议: heading.level 范围 1-6 (CommonMark 标准)
  if (paragraph && heading) {
    rules.push(headingRule(/^#\s$/, 1));
    rules.push(headingRule(/^##\s$/, 2));
    rules.push(headingRule(/^###\s$/, 3));
    rules.push(headingRule(/^####\s$/, 4));
    rules.push(headingRule(/^#####\s$/, 5));
    rules.push(headingRule(/^######\s$/, 6));
  }

  // ── Marks(inline,markdown 风格;触发字符是空格)──
  if (schema.marks.bold) {
    rules.push(markInputRule(/\*\*([^*]+)\*\*\s$/, schema.marks.bold));
  }
  if (schema.marks.italic) {
    // 注意:用 (?<!\*) 否定前瞻,避免吞 **bold** 中的 *
    rules.push(markInputRule(/(?<!\*)\*([^*]+)\*\s$/, schema.marks.italic));
  }
  if (schema.marks.code) {
    rules.push(markInputRule(/`([^`]+)`\s$/, schema.marks.code));
  }
  if (schema.marks.strike) {
    rules.push(markInputRule(/~~([^~]+)~~\s$/, schema.marks.strike));
  }

  // ── Lists / Quote / HR / CodeBlock (block-level wrapping)──
  // 节点 id 用驼峰(PM content expression 不支持短横线;paragraph / heading 用 PM 标准命名)
  const bulletList = schema.nodes.bulletList;
  const orderedList = schema.nodes.orderedList;
  const taskList = schema.nodes.taskList;
  const taskItem = schema.nodes.taskItem;
  const blockquote = schema.nodes.blockquote;
  const horizontalRule = schema.nodes.horizontalRule;
  const codeBlock = schema.nodes.codeBlock;
  const listItem = schema.nodes.listItem;

  if (bulletList && listItem) {
    // 严格行首(V1 同款):不允许前导空格
    rules.push(wrapInListRule(/^[-*]\s$/, bulletList, listItem));
  }
  if (orderedList && listItem) {
    rules.push(
      wrapInListRule(
        /^(\d+)\.\s$/,
        orderedList,
        listItem,
        (match) => ({ start: parseInt(match[1], 10) || 1 }),
      ),
    );
  }
  if (taskList && taskItem) {
    rules.push(wrapInTaskRule(/^\[\]\s$/, taskList, taskItem, false));
    rules.push(wrapInTaskRule(/^\[ \]\s$/, taskList, taskItem, false));
    rules.push(wrapInTaskRule(/^\[x\]\s$/i, taskList, taskItem, true));
  }
  if (blockquote) {
    rules.push(wrappingInputRule(/^>\s$/, blockquote));
  }
  if (horizontalRule) {
    rules.push(horizontalRuleRule(horizontalRule));
  }
  if (codeBlock) {
    rules.push(codeBlockRule(codeBlock));
  }

  return inputRules({ rules });
}

/**
 * wrapInListRule — `- ` / `1. ` 触发,把当前 paragraph 包成 list > list-item > paragraph
 *
 * 用 prosemirror-inputrules.wrappingInputRule 不直接合适,因为我们的 schema 是
 * list > list-item > paragraph 三层(list-item 内必须包 paragraph/heading 才合法)。
 * 手写规则确保结构正确。
 *
 * 注: input-rule 仅对 paragraph 触发(在 heading 上不触发 list 包装 — 跟 V1 一致)。
 */
function wrapInListRule(
  regex: RegExp,
  listType: NodeType,
  listItemType: NodeType,
  getAttrs?: (match: RegExpMatchArray) => Record<string, unknown>,
): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    // 必须在 paragraph 第一个位置触发(行首)
    const blockStart = $start.before($start.depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'paragraph') return null;
    // 不在已有 list 里(避免在 listItem 内再触发)
    if ($start.depth > 1) {
      const parent = $start.node($start.depth - 1);
      if (parent.type.name === 'listItem' || parent.type.name === 'taskItem') return null;
    }
    const tr = state.tr.delete(start, end); // 删触发字符
    // 当前 paragraph 不变,把它包进 listItem 再包进 list
    const updated = tr.doc.nodeAt(blockStart);
    if (!updated) return null;
    const item = listItemType.create(null, [updated.copy(updated.content)]);
    const list = listType.create(getAttrs?.(match) ?? null, Fragment.from(item));
    tr.replaceWith(blockStart, blockStart + updated.nodeSize, list);
    // 把光标放进 list > listItem > paragraph 内
    // 路径偏移:list 起点 (blockStart) + 1(进入 list)+ 1(进入 listItem)+ 1(进入 paragraph)= +3
    const cursorPos = blockStart + 3;
    tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
    return tr;
  });
}

/** wrapInTaskRule — `[]` / `[ ]` / `[x]` → taskList > taskItem > paragraph */
function wrapInTaskRule(
  regex: RegExp,
  taskListType: NodeType,
  taskItemType: NodeType,
  checked: boolean,
): InputRule {
  return new InputRule(regex, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'paragraph') return null;
    if ($start.depth > 1) {
      const parent = $start.node($start.depth - 1);
      if (parent.type.name === 'listItem' || parent.type.name === 'taskItem') return null;
    }
    const tr = state.tr.delete(start, end);
    const updated = tr.doc.nodeAt(blockStart);
    if (!updated) return null;
    const item = taskItemType.create({ checked }, [updated.copy(updated.content)]);
    const list = taskListType.create(null, Fragment.from(item));
    tr.replaceWith(blockStart, blockStart + updated.nodeSize, list);
    const cursorPos = blockStart + 3;
    tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)));
    return tr;
  });
}

/** `---` 行首 → 替换为 horizontalRule + 新空 paragraph,光标进 paragraph */
function horizontalRuleRule(hrType: NodeType): InputRule {
  return new InputRule(/^---$/, (state, _match, start) => {
    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const blockEnd = $start.after($start.depth);
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return null;
    const tr = state.tr.replaceWith(blockStart, blockEnd, [hrType.create(), paragraph.create()]);
    // 光标移到新 paragraph 内(跳过 hr 占的位置)
    const newPos = blockStart + hrType.create().nodeSize + 1;
    tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));
    return tr;
  });
}

/** ``` 触发(无空格 / 无 lang)→ 换成 codeBlock,光标进 codeBlock */
function codeBlockRule(codeBlockType: NodeType): InputRule {
  return new InputRule(/^```$/, (state, _match, start) => {
    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const blockEnd = $start.after($start.depth);
    const tr = state.tr.replaceWith(blockStart, blockEnd, codeBlockType.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(blockStart + 1)));
    return tr;
  });
}

/** heading 规则:把当前 paragraph 节点切换为 heading{level} */
function headingRule(regex: RegExp, level: number): InputRule {
  return new InputRule(regex, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'paragraph') return null;
    // title paragraph 不允许转 heading
    if (node.attrs.isTitle) return null;
    const headingType = state.schema.nodes.heading;
    if (!headingType) return null;
    return state.tr
      .delete(start, end)
      .setNodeMarkup(blockStart, headingType, { level });
  });
}

/**
 * mark 规则:匹配 `prefix CONTENT suffix space`,把 CONTENT 加 mark + 删除 prefix/suffix
 *
 * regex 必须在第一个 capture group 暴露 mark 内容。
 *
 * 触发后 setStoredMarks([]) 让下一字符不带 mark(否则继续输入会粘 mark — 不符合 markdown 心智)。
 */
function markInputRule(regex: RegExp, markType: MarkType): InputRule {
  return new InputRule(regex, (state, match, start, end) => {
    const full = match[0];
    const content = match[1];
    if (!content) return null;

    const tr = state.tr;
    // full 长度 = prefix + content + suffix + " ";结尾空格保留(用户输入它的)
    // 删 end-1(空格之前一格)直到 end:不删,让空格留下 — 但 suffix 要删
    // 简化策略:先把整个 full 替换成 content,再加 mark,再补一个空格
    const beforeFull = end - full.length;
    // 1) 删掉整个 full
    tr.delete(beforeFull, end);
    // 2) 在 beforeFull 处插入 content
    tr.insertText(content, beforeFull);
    const contentEnd = beforeFull + content.length;
    // 3) 给 content 加 mark
    tr.addMark(beforeFull, contentEnd, markType.create());
    // 4) 补回触发的空格(无 mark)
    tr.removeStoredMark(markType);
    tr.insertText(' ', contentEnd);
    // 5) 清 stored marks(下一字符不粘)
    tr.setStoredMarks([]);
    return tr;
  });
}
