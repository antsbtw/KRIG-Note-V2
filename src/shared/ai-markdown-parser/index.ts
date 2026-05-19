/**
 * AI markdown 解析子模块出口
 *
 * 用途:把 SSE 抓到的 / extractor 拿到的 AI 回复 markdown 文本无损转成 PM doc JSON,
 * 直接喂给 thought.updateThought({ doc }) — 实现"提取整页对话不失真"原则。
 *
 * 链路:markdown(string) → ResultParser.parse() → ExtractedBlock[] →
 *      extractedBlocksToPmDoc() → PMDoc(JSON) → 包成 NoteDocEnvelope
 */

export { ResultParser } from './result-parser';
export { extractedBlocksToPmDoc } from './blocks-to-pm-doc';
export { wrapAITurnsInToggle } from './wrap-ai-turns';
export type {
  ExtractedBlock,
  ExtractedInline,
  ExtractedListItem,
} from './extraction-types';

import { ResultParser } from './result-parser';
import { extractedBlocksToPmDoc } from './blocks-to-pm-doc';
import type { NoteDocEnvelope } from '../ipc/note-folder-types';

/**
 * 一步函数:AI markdown → NoteDocEnvelope(直接 setable to thought.updateThought)。
 */
export function aiMarkdownToNoteDoc(markdown: string): NoteDocEnvelope {
  const parser = new ResultParser();
  const blocks = parser.parse(markdown);
  const doc = extractedBlocksToPmDoc(blocks);
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: doc as unknown as NoteDocEnvelope['payload'],
  };
}
