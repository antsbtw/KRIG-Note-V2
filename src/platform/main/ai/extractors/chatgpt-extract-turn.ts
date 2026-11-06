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
 * selector:见下方 CHATGPT_ASSISTANT_SELECTOR(与 ai-service-types.ts chatgpt.selectors.assistantMessage 同步)
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
import { convertFenceArtifacts } from './fence-artifacts';

/**
 * 2026-11-04 真机实测:ChatGPT 改版,页面上 data-message-author-role / data-turn / article
 * 全部为 0 → 右键恒报「不在任何 AI 回复内」。新版每条 AI 回复的容器是
 * `div[data-content-search-unit-key="<turn>:<n>:assistant"]`(内含 markdown 正文 + 表格等)。
 * 新标记放首位(主选择器);旧两条留作次选,兼容灰度期旧页面。
 */
const CHATGPT_ASSISTANT_SELECTOR =
  '[data-content-search-unit-key$=":assistant"], [data-message-author-role="assistant"], .agent-turn';

/**
 * 回复块上带「消息 id」的属性(2026-11-04 真机日志看到新版带前两个;旧版在 data-message-id)。
 * 值与对话数据(mapping tree)里 message.id 是同一个 UUID → 能精确对上,不用猜文字/序号。
 */
const CHATGPT_MESSAGE_ID_ATTRS = [
  'data-chatgpt-search-message-ids',
  'data-chatgpt-selection-message-id',
  'data-message-id',
];

type ResolvedTarget = { ordinal: number; preview: string; ids: string[] };

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
  return locateOrdinalByPoint(wc, x, y, CHATGPT_ASSISTANT_SELECTOR, CHATGPT_MESSAGE_ID_ATTRS);
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

  // ── message 定位 ──
  // ⭐ 优先按 id 精确对上(2026-11-04:ChatGPT 改版后页面块与数据条目不再一一对应,
  //    靠文字前缀/序号会对错条);页面没带 id(旧版/灰度)才走原来的文字匹配 + 序号。
  // 一个页面块可能含多条 assistant message(如工具调用前后各一段)→ 按数据顺序全取、拼起来,
  // 与用户在那一块里看到的一致。
  let picked: ChatGPTNormalizedMessage[] = [];
  let method: string;
  if (target.ids.length > 0) {
    const idSet = new Set(target.ids);
    picked = assistantMsgs.filter((m) => idSet.has(m.id));
    method = 'id';
    if (picked.length === 0) {
      // 不兜底:页面明确说了是哪条,数据里没有 = 数据不是这页的/过期,猜一条只会对错
      console.warn('[chatgpt-extract-turn] 页面块的消息 id 在对话数据里找不到', {
        pageIds: target.ids,
        dataAssistantIds: assistantMsgs.map((m) => m.id),
      });
      return { success: false, error: '页面上这条回复在对话数据里找不到(数据可能未同步),请刷新页面后再试' };
    }
  } else {
    method = 'text';
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
      method = 'ordinal';
      msg = assistantMsgs[ordinal] ?? assistantMsgs[assistantMsgs.length - 1];
    }
    if (!msg) {
      return {
        success: false,
        error: `定位到第 ${ordinal + 1} 条回复,但对话数据仅 ${assistantMsgs.length} 条(页面与数据不同步?请刷新后重试)`,
      };
    }
    picked = [msg];
  }

  const parts = picked.map((m) => buildChatGPTMessageBody(m, fileMap));
  // ```svg / ```html 代码块 → 图 / 网页块(不转的话 note 里只是一大段源码)
  const fence = await convertFenceArtifacts(
    parts.map((p) => p.body.trim()).filter(Boolean).join('\n\n'),
    'chatgpt',
  );
  const built = {
    body: fence.markdown,
    artifactCount: parts.reduce((n, p) => n + p.artifactCount, 0) + fence.count,
  };
  const msg = picked[0];
  console.log('[chatgpt-extract-turn] 选中', {
    method,
    pageIds: target.ids,
    pickedIds: picked.map((m) => m.id),
    ordinal,
    preview: target.preview.slice(0, 40),
    fenceArtifacts: fence.count,
    picked: built.body.replace(/\s+/g, ' ').slice(0, 40),
  });
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
