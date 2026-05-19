/**
 * Claude 完整对话提取(多 turn + artifact)
 *
 * 链路:
 *   1. extractClaudeConversation(wc) — 调 Claude /api/.../chat_conversations/{id}
 *      拿到 messages[](所有 turn,含 artifact placeholder "This block is not supported...")
 *   2. readCapturedArtifactMessages(wc) — 从注入的 artifact-postmessage-hook 读
 *      window.__krig_artifact_messages(SVG/HTML/code 源码 + iframe postMessage 数据)
 *   3. collectArtifactSources — 提取每条捕获的源码字符串(去重 + newest first)
 *   4. fillArtifactPlaceholders / replaceArtifactPlaceholders — 把 message text 里
 *      的 placeholder 替换为真 artifact 源码(```fence```)或 callout fallback
 *   5. buildFullMarkdown — 把所有 turn(user + assistant 交替)拼成完整对话 markdown
 *      格式:## 👤 用户  / ## 🤖 AI(Claude) 标题分隔
 *
 * 返 string(markdown),交给 ResultParser → PMDoc → thought atom doc 渲染。
 */

import type { WebContents } from 'electron';
import {
  extractClaudeConversation,
  readCapturedArtifactMessages,
  collectArtifactSources,
  fillArtifactPlaceholders,
  replaceArtifactPlaceholders,
  trimLeadingArtifactPlaceholder,
  collapseAdjacentArtifactPlaceholders,
  type ClaudeMessage,
  type ClaudeConversation,
} from './claude-api-extractor';

export interface ClaudeFullExtractionResult {
  success: boolean;
  /** 多 turn 拼接后的完整 markdown(成功时) */
  markdown?: string;
  /** 元数据(显示在卡片头) */
  title?: string;
  model?: string;
  turnCount?: number;
  artifactCount?: number;
  error?: string;
}

/**
 * 入口:从当前 Claude webview 拿完整对话 + 填 artifact。
 */
export async function extractClaudeFullConversation(
  wc: WebContents,
): Promise<ClaudeFullExtractionResult> {
  const conv = await extractClaudeConversation(wc);
  if (!conv) {
    return {
      success: false,
      error: 'Failed to extract Claude conversation (not on claude.ai/chat/{id}? not logged in?)',
    };
  }
  if (conv.messages.length === 0) {
    return { success: false, error: 'Conversation is empty' };
  }

  // 读 postMessage hook 捕获的 artifact 源码
  const capturedMessages = await readCapturedArtifactMessages(wc);
  const artifactSources = collectArtifactSources(capturedMessages);

  // 拼接所有 turn
  const conversationUrl = wc.getURL() || '';
  let artifactCount = 0;
  const turnBlocks: string[] = [];

  for (let i = 0; i < conv.messages.length; i++) {
    const msg = conv.messages[i];
    if (msg.sender === 'human') {
      turnBlocks.push(`## 👤 用户\n\n${msg.text || '(空消息)'}`);
    } else if (msg.sender === 'assistant') {
      let text = trimLeadingArtifactPlaceholder(msg.text || '');
      text = collapseAdjacentArtifactPlaceholders(text);
      // 优先用 fillArtifactPlaceholders(有真源码)→ 失败的回退 replaceArtifactPlaceholders(callout fallback)
      const filled = fillArtifactPlaceholders(text, artifactSources);
      const finalText =
        filled.remaining > 0
          ? replaceArtifactPlaceholders(filled.text, conversationUrl)
          : filled.text;
      artifactCount += filled.filled;
      turnBlocks.push(`## 🤖 AI (${conv.model || 'Claude'})\n\n${finalText}`);
    }
  }

  // 顶部加标题元数据(可读性)
  const header = buildHeader(conv);
  const markdown = `${header}\n\n${turnBlocks.join('\n\n---\n\n')}`;

  return {
    success: true,
    markdown,
    title: conv.name || '未命名对话',
    model: conv.model,
    turnCount: conv.messages.length,
    artifactCount,
  };
}

function buildHeader(conv: ClaudeConversation): string {
  const parts = [`# ${conv.name || '未命名对话'}`];
  if (conv.model) parts.push(`> 模型: \`${conv.model}\``);
  parts.push(`> 共 ${conv.messages.length} 条消息`);
  return parts.join('\n\n');
}

// 重 export 类型给上层用
export type { ClaudeMessage, ClaudeConversation };
