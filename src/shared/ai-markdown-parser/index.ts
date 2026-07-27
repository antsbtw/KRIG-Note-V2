/**
 * AI markdown 解析子模块出口
 *
 * 用途:把 SSE 抓到的 / extractor 拿到的 AI 回复 markdown 文本无损转成 PM doc JSON,
 * 直接喂给 thought.updateThought({ doc }) — 实现"提取整页对话不失真"原则。
 *
 * 链路（B4b 收官）:markdown(string) → aiMarkdownToPmNodes（AI 预处理 → markdownCore）
 *      → PMNode[] → 包成 doc → NoteDocEnvelope。ExtractedBlock 中间态已废，① 是核的薄 caller。
 */

import { aiMarkdownToPmNodes } from './ai-preprocess';
import type { NoteDocEnvelope } from '../ipc/note-folder-types';

export { aiMarkdownToPmNodes } from './ai-preprocess';
export { wrapAITurnsInToggle } from './wrap-ai-turns';

/**
 * 一步函数:AI markdown → NoteDocEnvelope(直接 setable to thought.updateThought)。
 * 空产物兜底一个空 paragraph（PM doc content 不能空）。
 */
export function aiMarkdownToNoteDoc(markdown: string): NoteDocEnvelope {
  const nodes = aiMarkdownToPmNodes(markdown);
  const content = nodes.length > 0 ? nodes : [{ type: 'paragraph' }];
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content } as unknown as NoteDocEnvelope['payload'],
  };
}
