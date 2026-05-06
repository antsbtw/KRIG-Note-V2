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

import { inputRules, InputRule } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import type { Schema, MarkType } from 'prosemirror-model';

export function buildInputRules(schema: Schema): Plugin {
  const rules: InputRule[] = [];
  const textBlock = schema.nodes['text-block'];

  // ── Headings(block-level)──
  if (textBlock) {
    rules.push(headingRule(/^#\s$/, 1));
    rules.push(headingRule(/^##\s$/, 2));
    rules.push(headingRule(/^###\s$/, 3));
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

  return inputRules({ rules });
}

/** heading 规则:把当前 text-block 节点的 attrs.level 改成 N */
function headingRule(regex: RegExp, level: number): InputRule {
  return new InputRule(regex, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    const blockStart = $start.before($start.depth);
    const node = state.doc.nodeAt(blockStart);
    if (!node || node.type.name !== 'text-block') return null;
    return state.tr
      .delete(start, end)
      .setNodeMarkup(blockStart, undefined, { ...node.attrs, level });
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
