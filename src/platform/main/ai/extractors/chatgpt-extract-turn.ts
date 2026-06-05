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
 * 与 claude-extract-turn.resolveAssistantTarget 同款(选择器换 ChatGPT)。
 * ordinal=-1 表示点击不在任何 assistant 回复内(或附近)。
 */
async function resolveAssistantTarget(
  wc: WebContents,
  x: number,
  y: number,
): Promise<ResolvedTarget> {
  const script = `(function() {
    var sel = ${JSON.stringify(CHATGPT_ASSISTANT_SELECTOR)};
    var parts = sel.split(',').map(function(s){ return s.trim(); });
    var list = Array.prototype.slice.call(document.querySelectorAll(parts[0]));
    for (var j = 1; j < parts.length; j++) {
      var extra = document.querySelectorAll(parts[j]);
      for (var k = 0; k < extra.length; k++) {
        var dup = false;
        for (var p = 0; p < list.length; p++) {
          if (list[p].contains(extra[k]) || extra[k].contains(list[p])) { dup = true; break; }
        }
        if (dup) continue;
        var inserted = false;
        for (var p2 = 0; p2 < list.length; p2++) {
          if (list[p2].compareDocumentPosition(extra[k]) & Node.DOCUMENT_POSITION_PRECEDING) {
            list.splice(p2, 0, extra[k]); inserted = true; break;
          }
        }
        if (!inserted) list.push(extra[k]);
      }
    }
    if (list.length === 0) return { ordinal: -1, preview: '' };
    var el = document.elementFromPoint(${x}, ${y});
    var hit = null;
    for (var i = 0; i < parts.length && !hit; i++) {
      hit = el && el.closest ? el.closest(parts[i]) : null;
    }
    if (!hit) {
      var best = null;
      for (var n = 0; n < list.length; n++) {
        var rect = list[n].getBoundingClientRect();
        var dy = 0;
        if (${y} < rect.top) dy = rect.top - ${y};
        else if (${y} > rect.bottom) dy = ${y} - rect.bottom;
        var insideBand = ${y} >= rect.top - 24 && ${y} <= rect.bottom + 24;
        if (!insideBand && dy > 240) continue;
        if (!best || dy < best.dy) best = { node: list[n], dy: dy };
      }
      hit = best ? best.node : null;
    }
    if (!hit) return { ordinal: -1, preview: '' };
    var text = (hit.innerText || hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    return { ordinal: list.indexOf(hit), preview: text };
  })()`;
  try {
    const r = await wc.executeJavaScript(script);
    if (r && typeof r.ordinal === 'number') {
      return { ordinal: r.ordinal, preview: typeof r.preview === 'string' ? r.preview : '' };
    }
    return { ordinal: -1, preview: '' };
  } catch {
    return { ordinal: -1, preview: '' };
  }
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
