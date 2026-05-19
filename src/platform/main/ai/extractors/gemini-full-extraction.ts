/**
 * Gemini 完整对话提取(多 turn,简化版)
 *
 * V1 源:src/plugins/web-bridge/capabilities/gemini-content-extractor.ts(481 行)+
 *       gemini-extract-turn.ts + gemini-conversation-query.ts
 *
 * V2 简化:利用现有 SSECaptureManager.getAllGeminiResponses()(CDP 累积 StreamGenerate
 * 响应,parseGeminiResponse 已提 markdown + image)。本模块把多次 turn 累积成完整对话。
 *
 * 限制:
 * - 用户提问文本不在 StreamGenerate 响应内,要从 DOM 扒(本期暂不做,V1 也是 best-effort)
 * - 仅展示 AI 回复部分,标 "## 🤖 AI (Gemini) - 回复 N" 序号
 * - thinking chain / web search grounding 不提取(留独立 sub-phase)
 * - Imagen 图通过 ![image](https://...) 形式保留(由 ResultParser + image proxy 处理)
 */

import type { WebContents } from 'electron';
import { getActiveAIWebContents } from '../webview-registry';
// SSECaptureManager 在 ask-orchestrator 单例持有;通过 getter 拿
// (不能直接 import captureManager,因为它是 let,只通过 orchestrator 提供 api)

export interface GeminiFullExtractionResult {
  success: boolean;
  markdown?: string;
  title?: string;
  model?: string;
  turnCount?: number;
  artifactCount?: number;
  error?: string;
}

/**
 * 从 DOM 拿当前对话标题(Gemini 页面顶部显示)。
 */
async function readGeminiTitle(wc: WebContents): Promise<string> {
  try {
    const script = `(function() {
      var sel = '.conversation-title, [data-test-id="conversation-title"], h1';
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].textContent || '').trim();
        if (t && t.length < 200) return t;
      }
      return '';
    })()`;
    const result = await wc.executeJavaScript(script);
    return typeof result === 'string' ? result : '';
  } catch {
    return '';
  }
}

/**
 * 从 DOM 扒所有用户提问文本(.user-query-container)。
 * 简化:Gemini 一次 turn = 1 user query + 1 AI response,按 DOM 顺序枚举提问,
 * 跟 captureManager geminiResponses 一一配对。
 */
async function readGeminiUserQueries(wc: WebContents): Promise<string[]> {
  try {
    const script = `(function() {
      var nodes = document.querySelectorAll('.user-query-container, .user-query, [data-test-id="user-query"]');
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        var t = (nodes[i].textContent || '').trim();
        if (t) out.push(t);
      }
      return out;
    })()`;
    const result = await wc.executeJavaScript(script);
    return Array.isArray(result) ? (result as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * 入口 — 注:本函数需要 ask-orchestrator 注入 captureManager getter。
 * 接口设计:接受一个 getAllResponses 闭包,避免循环 import。
 */
export async function extractGeminiFullConversation(
  wc: WebContents,
  getAllResponses: () => ReadonlyArray<{ markdown: string; timestamp: number }>,
): Promise<GeminiFullExtractionResult> {
  void getActiveAIWebContents; // 保留 import 防 unused

  const responses = getAllResponses();
  if (responses.length === 0) {
    return {
      success: false,
      error: 'Gemini 响应缓存为空:请先在 Gemini 页面完成至少一次对话,然后再试',
    };
  }

  const title = (await readGeminiTitle(wc)) || 'Gemini 对话';
  const userQueries = await readGeminiUserQueries(wc);

  // 拼:user(从 DOM) + assistant(从 CDP cache) 交替
  // 简化:按顺序匹配第 i 条 query → 第 i 条 response;不匹配的部分降级标注
  const turnBlocks: string[] = [];
  const total = Math.max(userQueries.length, responses.length);
  let artifactCount = 0;
  for (let i = 0; i < total; i++) {
    if (i < userQueries.length) {
      turnBlocks.push(`## 👤 用户\n\n${userQueries[i]}`);
    }
    if (i < responses.length) {
      const r = responses[i];
      // 简单 artifact 检测:含 ![image]() 标记的算 artifact
      const imgs = (r.markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
      artifactCount += imgs;
      turnBlocks.push(`## 🤖 AI (Gemini)\n\n${r.markdown}`);
    }
  }

  const header = `# ${title}\n\n> Gemini 对话 · 共 ${responses.length} 条 AI 回复`;
  if (userQueries.length === 0 && responses.length > 0) {
    turnBlocks.unshift(
      '> ⚠️ 用户提问未从 DOM 提取(可能 Gemini UI 变更);仅显示 AI 回复部分。',
    );
  }
  const markdown = `${header}\n\n${turnBlocks.join('\n\n---\n\n')}`;

  return {
    success: true,
    markdown,
    title,
    turnCount: total,
    artifactCount,
  };
}
