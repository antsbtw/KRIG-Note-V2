/**
 * Claude 完整对话提取(多 turn + artifact)
 *
 * 新链路(V1 路径迁过来,2026-05-19):
 *   1. fetchClaudeConversationRaw(wc) — 调 /api/.../chat_conversations/{id}
 *      ?tree=True&rendering_mode=messages&render_all_tools=true(关键!不带 render_all_tools
 *      就只有 placeholder 拿不到 artifact 源码)
 *   2. getConversationData(raw) — 结构化 raw JSON;识别每条 assistant message 的 content[]
 *      数组中 tool_use 节点(widget_code / file_text / local_resource),整理成
 *      ConversationMessage.contentParts(text/artifact 交错)+ artifacts[]
 *   3. extractFullConversationFromData(conv) — 每个 assistant turn 调 messageToMarkdown
 *      → contentParts 转 markdown(text 原样;artifact 走 artifactToMarkdown:SVG 转
 *      data:image/svg+xml;base64 存 mediaStore → media:// URL;其他 fence)
 *   4. buildFullMarkdownFromExtracted(turns) — 拼成"## 👤 用户 / ## 🤖 AI" 标题分隔
 *      的完整 markdown(兼容下游 ai-sync 渲染管线)
 *
 * 旧链路(postMessage hook + fillArtifactPlaceholders)已被替换 —
 * V1 实测主路径就是 API + render_all_tools,postMessage hook 是不稳的补充。
 *
 * 返 markdown string(交给 ResultParser → PMDoc → Toggle 包 turns)。
 */

import type { WebContents } from 'electron';
import {
  fetchClaudeConversationRaw,
  type ClaudeMessage,
  type ClaudeConversation,
} from './claude-api-extractor';
import { getConversationData } from './claude-conversation-query';
import {
  extractFullConversationFromData,
  buildFullMarkdownFromExtracted,
  type ExtractedTurn,
} from './claude-extract-turn';

export interface ClaudeFullExtractionResult {
  success: boolean;
  /** 多 turn 拼接后的完整 markdown(成功时;artifact 已替换为 media:// 图 / fence)*/
  markdown?: string;
  /** 元数据 */
  title?: string;
  model?: string;
  turnCount?: number;
  artifactCount?: number;
  /**
   * 结构化 turns(后续 sub-phase 用于 PM 端按 turn 单独 toggle 包装;本期 markdown
   * 字段已含 ## heading 分隔,renderer 端 wrapAITurnsInToggle 就能识别)
   */
  turns?: ExtractedTurn[];
  error?: string;
}

/**
 * 入口:从当前 Claude webview 拿完整对话 + artifact。
 */
export async function extractClaudeFullConversation(
  wc: WebContents,
): Promise<ClaudeFullExtractionResult> {
  // 1. 拿 raw JSON(URL 带 render_all_tools=true,fetchClaudeConversationRaw 已封装)
  const raw = await fetchClaudeConversationRaw(wc);
  if (!raw) {
    return {
      success: false,
      error: 'Failed to extract Claude conversation (not on claude.ai/chat/{id}? not logged in?)',
    };
  }

  // 2. 结构化 — 把 content[].tool_use 中的 widget_code/file_text 提出来
  const conversation = getConversationData(raw);
  if (!conversation || conversation.messages.length === 0) {
    return { success: false, error: 'Conversation is empty or unparsable' };
  }

  // 3. 每个 assistant turn 转 markdown(artifact 走 mediaStore.putBase64 → media:// URL)
  const extracted = await extractFullConversationFromData(conversation);
  if (!extracted) {
    return { success: false, error: 'No assistant messages to extract' };
  }

  // 4. 拼完整 markdown(## 用户 / ## AI 标题分隔)
  const markdown = buildFullMarkdownFromExtracted(extracted);

  const artifactCount = extracted.turns.reduce((sum, t) => sum + t.artifactCount, 0);

  return {
    success: true,
    markdown,
    title: extracted.title,
    model: extracted.model,
    turnCount: extracted.turns.length,
    artifactCount,
    turns: extracted.turns,
  };
}

// 重 export 类型给上层用
export type { ClaudeMessage, ClaudeConversation };
