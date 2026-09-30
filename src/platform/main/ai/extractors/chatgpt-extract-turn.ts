/**
 * ChatGPT 单条 turn 提取(右键「提取此对话到笔记」)
 *
 * 对齐 Claude 单条提取(claude-extract-turn.ts)的策略:
 *   1. resolveAssistantTarget(wc,x,y) — guest DOM elementFromPoint 定位被点的 assistant
 *      回复块,返 { ordinal, preview }(ordinal=在所有 assistant 节点中的序号;preview=
 *      命中节点 innerText)
 *   2. loadChatGPTConversation(wc) — 复用整页提取的结构化加载(API mapping tree →
 *      messages[] + fileMap),数据可靠(非 DOM 拼)
 *   3. 文本预览匹配优先 + ordinal 兜底:被点 preview 跟每条 assistant message 的 text
 *      求公共前缀,免疫 DOM/数据节点数不齐导致的错位(同 Claude)
 *   4. buildChatGPTMessageBody(msg, fileMap) — 单条 → markdown(嵌入图/文件)
 *   5. 配对前一条 user 提问
 *
 * selector:ai-service-types.ts chatgpt.selectors.assistantMessage
 *   '[data-message-author-role="assistant"], .agent-turn'
 */

import type { WebContents } from 'electron';
import {
  loadChatGPTConversation,
  buildChatGPTMessageBody,
  isChatGPTVisibleMessage,
  type ChatGPTNormalizedMessage,
} from './chatgpt-full-extraction';
import type { ExtractedSingleTurn } from './claude-extract-turn';
import { locateOrdinalByPoint } from './locate-ordinal';

const CHATGPT_ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], .agent-turn';

type ResolvedTarget = { ordinal: number; preview: string };

/**
 * 归一化用于「DOM 预览 ↔ message 源文本」匹配。
 *
 * DOM innerText 是渲染后的纯文本(无 markdown 标记),而 message.text 是 markdown 源
 * (含 ** / * / ` / # / > 等)。直接比对会在第一个标记处分叉(实测正文开头
 * "下面是一段**包含..." vs DOM "下面是一段包含..." 在第 6 字就分叉 → 公共前缀 <12 误判)。
 * 故剥掉常见 markdown 标记 + 折叠空白,只留可见文字再比。
 */
function normalizeForMatch(s: string): string {
  return s
    .replace(/[*_`#>~]/g, '') // markdown 强调/标题/引用/代码/删除线标记
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 在 guest 页用 (x,y) 定位被右键的 assistant 回复块,返 { ordinal, preview }。
 *
 * ⭐ 2026-09-30 收口:脚本本体搬进 `web.dom` 的预注册表
 * (`dom/locate-scripts.ts`),与 Claude / Gemini 共用同一份 ——
 * 收口前这里与 claude-extract-turn 是**逐字节相同**的两份,
 * 且都把坐标直接插进脚本文本(project-x-inject-template-escape 那一类)。
 */
async function resolveAssistantTarget(
  wc: WebContents,
  x: number,
  y: number,
): Promise<ResolvedTarget> {
  return locateOrdinalByPoint(wc, x, y, CHATGPT_ASSISTANT_SELECTOR);
}

/**
 * 右键单条提取入口(ChatGPT)。
 */
export async function extractChatGPTTurnAt(
  wc: WebContents,
  x: number,
  y: number,
): Promise<ExtractedSingleTurn> {
  const target = await resolveAssistantTarget(wc, x, y);
  if (target.ordinal < 0) {
    return { success: false, error: '右键位置不在任何 AI 回复内,请对准某条回复再试' };
  }
  const ordinal = target.ordinal;

  const loaded = await loadChatGPTConversation(wc);
  if (!loaded.data) {
    return { success: false, error: loaded.error || '加载对话失败' };
  }
  const { messages, fileMap } = loaded.data;

  // 可见 assistant 消息 —— 关键:必须过滤掉「转 markdown 为空」的 message。
  // ChatGPT mapping tree 里常夹着 text 为空的占位/工具 assistant message,它们不在
  // DOM 里渲染成可见回复;若把它们算进来,DOM ordinal(数的是可见回复)就跟数据数组
  // 错位 —— 实测 assistant=[空, 正文],ordinal=0 兜底命中空那条 → 误报「无可提取内容」。
  // 用 buildChatGPTMessageBody 产物判空(顺带覆盖纯 widget message:图表/carousel 非空)。
  const assistantMsgs = messages.filter((m) => {
    if (m.role !== 'assistant' || !isChatGPTVisibleMessage(m)) return false;
    return buildChatGPTMessageBody(m, fileMap).body.trim().length > 0;
  });
  if (assistantMsgs.length === 0) {
    return { success: false, error: '对话内没有 AI 回复可提取' };
  }

  // ── message 定位:文本预览匹配优先,ordinal 兜底 ──
  let msg: ChatGPTNormalizedMessage | undefined;
  const preview = normalizeForMatch(target.preview);
  if (preview.length >= 12) {
    let bestScore = 0;
    let bestMsg: ChatGPTNormalizedMessage | undefined;
    for (const m of assistantMsgs) {
      const body = normalizeForMatch(m.text);
      if (!body) continue;
      const lim = Math.min(preview.length, body.length);
      let common = 0;
      while (common < lim && preview[common] === body[common]) common++;
      const contains = body.startsWith(preview) || preview.startsWith(body.slice(0, preview.length));
      const score = contains ? Math.max(common, preview.length) : common;
      if (score > bestScore) { bestScore = score; bestMsg = m; }
    }
    if (bestMsg && bestScore >= 12) {
      msg = bestMsg;
    }
  }
  if (!msg) {
    // ordinal 兜底:clamp 到有效范围(只有 1 条非空时 ordinal 越界也回退到它)
    msg = assistantMsgs[ordinal] ?? assistantMsgs[assistantMsgs.length - 1];
  }
  if (!msg) {
    return {
      success: false,
      error: `定位到第 ${ordinal + 1} 条回复,但对话数据仅 ${assistantMsgs.length} 条(页面与数据不同步?请刷新后重试)`,
    };
  }

  const built = buildChatGPTMessageBody(msg, fileMap);
  if (!built.body.trim()) {
    // assistantMsgs 已过滤空 message,正常到不了这里;真到了说明仍在生成
    return { success: false, error: '该回复无可提取内容(可能仍在生成中?请等回复完成再试)' };
  }

  // 配对前一条 user 提问:在 messages 全序列里找 msg 之前最后一个可见 user
  const msgPos = messages.indexOf(msg);
  let userMessage = '';
  for (let i = msgPos - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && isChatGPTVisibleMessage(m) && m.text.trim()) {
      userMessage = m.text.trim();
      break;
    }
  }

  return {
    success: true,
    userMessage,
    markdown: built.body,
    artifactCount: built.artifactCount,
  };
}
