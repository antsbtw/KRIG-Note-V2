/**
 * Gemini 单条 turn 提取(右键「提取此对话到笔记」)
 *
 * 数据来源:主动 fetch hNvQHb 拿完整对话历史(gemini-conversation-query),每个 turn 含
 * [用户提问 + AI markdown + 图 + groundings],turn 内天然对齐、零 DOM 抓内容。
 * DOM 仅用于「定位被点的是第几条回复」(elementFromPoint + .response-container,与
 * Claude/ChatGPT 同款定位语义 —— 定位坐标,不抓内容)。
 *
 * 序号映射:DOM 第 N 个 .response-container = 第 N 轮 AI 回复 = conv.turns[N]
 * (hNvQHb 已按时间正序排好,与 DOM 渲染顺序一致)。
 */

import type { WebContents } from 'electron';
import type { ExtractedSingleTurn } from './claude-extract-turn';
import { fetchGeminiConversation } from './gemini-conversation-query';
import { geminiTurnMarkdown } from './gemini-full-extraction';
import { locateOrdinalByPoint } from './locate-ordinal';

const GEMINI_ASSISTANT_SELECTOR = '.response-container';

/**
 * 在 guest 页用 (x,y) 定位被右键的 AI 回复块,返回它在所有 `.response-container` 中的序号。
 * 返 -1 表示不在任何回复内。
 *
 * ⭐ 2026-09-30 收口:脚本本体搬进 `web.dom` 的预注册表
 * (`dom/locate-scripts.ts`),与 ChatGPT / Claude 共用同一份。
 * ⚠️ 原实现是那两家的简化版(少了多候选 selector 合并),收口后一并获得该能力 ——
 * Gemini 目前只有单个 selector,行为不变。
 */
async function resolveResponseOrdinal(
  wc: WebContents,
  x: number,
  y: number,
): Promise<number> {
  const { ordinal } = await locateOrdinalByPoint(wc, x, y, GEMINI_ASSISTANT_SELECTOR);
  return ordinal;
}

/** 右键单条提取入口(Gemini)。*/
export async function extractGeminiTurnAt(
  wc: WebContents,
  x: number,
  y: number,
): Promise<ExtractedSingleTurn> {
  const conv = await fetchGeminiConversation(wc);
  if (!conv || conv.turns.length === 0) {
    return {
      success: false,
      error: 'Gemini 对话拉取失败或为空:请确认在对话页且已登录,然后重试',
    };
  }

  const ordinal = await resolveResponseOrdinal(wc, x, y);
  if (ordinal < 0) {
    return { success: false, error: '右键位置不在任何 AI 回复内,请对准某条回复再试' };
  }

  // DOM 回复序号 ↔ turn 序号对齐;越界回退到最后一轮
  const turn = conv.turns[ordinal] ?? conv.turns[conv.turns.length - 1];
  if (!turn || !turn.markdown.trim()) {
    return { success: false, error: '该回复无可提取内容(可能仍在生成中?请等回复完成再试)' };
  }

  const built = await geminiTurnMarkdown(wc, turn);
  return {
    success: true,
    userMessage: turn.userMessage.trim(),
    markdown: built.markdown,
    artifactCount: built.artifactCount,
  };
}
