/**
 * AI 侧预注册脚本 —— 把 `ai/inject-scripts/` 的 6 个脚本注册进 `web.dom`
 *
 * ⭐ 注册后,业务方调 `run(pageId, AI_SCRIPTS.xxx, params)`,
 * **拿不到也传不进脚本字符串** —— 这是转义事故的类型层面根治。
 *
 * ⚠️ 脚本本体**没有搬动**,仍在 `ai/inject-scripts/`(`08` §1.2:迁移=换调用方,不是搬代码)。
 * 这里只是把它们**登记**进注册表。
 *
 * ── 参数安全 ──
 * 三个带参脚本(sse-capture / chatgpt-fetch-conversation / chatgpt-read-cache)
 * 本来就用 `JSON.stringify` 插值 —— 实测确认,不是假设。
 * 本文件保持这个形态,并由 `dom-script-params-safe` 守卫扫死。
 */

import {
  getSSECaptureScript,
  getSSEReadLatestScript,
  getSSEStatusScript,
  getSSEClearScript,
} from '../../ai/inject-scripts/sse-capture';
import {
  getArtifactPostMessageHookScript,
  getArtifactReadScript,
} from '../../ai/inject-scripts/artifact-postmessage-hook';
import {
  getChatGPTConversationHookScript,
  getChatGPTFetchConversationScript,
  getChatGPTReadCacheScript,
} from '../../ai/inject-scripts/chatgpt-conversation-hook';
import type { RegisteredScript, ScriptId } from './types';
import type { ScriptRegistry } from './script-registry';

/** 脚本 id 常量 —— 调用方只认这些,不认字符串 */
export const AI_SCRIPTS = {
  sseCapture: 'ai.sse-capture' as ScriptId,
  artifactHook: 'ai.artifact-postmessage-hook' as ScriptId,
  artifactRead: 'ai.artifact-read' as ScriptId,
  chatgptConversationHook: 'ai.chatgpt-conversation-hook' as ScriptId,
  chatgptFetchConversation: 'ai.chatgpt-fetch-conversation' as ScriptId,
  chatgptReadCache: 'ai.chatgpt-read-cache' as ScriptId,
  sseReadLatest: 'ai.sse-read-latest' as ScriptId,
  sseStatus: 'ai.sse-status' as ScriptId,
  sseClear: 'ai.sse-clear' as ScriptId,
} as const;

/** 参数取值助手:缺参数就抛,不静默用默认值(那会让「忘了传」变成静默错误) */
function requireString(params: Readonly<Record<string, unknown>>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string') {
    throw new Error(`[web.dom] 脚本参数 ${key} 必须是 string,收到 ${typeof v}`);
  }
  return v;
}

export const AI_SCRIPT_DEFINITIONS: readonly RegisteredScript[] = [
  {
    id: AI_SCRIPTS.sseCapture,
    purpose: 'AI 页面注入 fetch hook,截 SSE 回复(ChatGPT/Claude 的取数底座)',
    build: (p) => getSSECaptureScript(requireString(p, 'serviceId'), requireString(p, 'endpointPattern')),
  },
  {
    id: AI_SCRIPTS.artifactHook,
    purpose: 'Claude artifact 的 postMessage hook —— 抓 artifact 源码',
    build: () => getArtifactPostMessageHookScript(),
  },
  {
    id: AI_SCRIPTS.artifactRead,
    purpose: '读回 artifact hook 缓存的消息',
    build: () => getArtifactReadScript(),
  },
  {
    id: AI_SCRIPTS.chatgptConversationHook,
    purpose: 'ChatGPT 页面注入 fetch hook,缓存 conversation / textdocs / estuary 响应',
    build: () => getChatGPTConversationHookScript(),
  },
  {
    id: AI_SCRIPTS.chatgptFetchConversation,
    purpose: '⭐ 提取时**实时**拉当前对话树(stale-cache 修复,见 project-chatgpt-extract-stale-cache)',
    build: (p) => getChatGPTFetchConversationScript(requireString(p, 'conversationId')),
  },
  {
    id: AI_SCRIPTS.chatgptReadCache,
    purpose: '读回 ChatGPT hook 缓存的响应(按 URL 子串 + mode 过滤)',
    build: (p) => {
      const mode = p.mode;
      if (mode !== 'all' && mode !== 'latest' && mode !== 'first') {
        throw new Error(`[web.dom] chatgpt-read-cache 的 mode 非法: ${String(mode)}`);
      }
      return getChatGPTReadCacheScript(requireString(p, 'urlSubstring'), mode);
    },
  },
  {
    id: AI_SCRIPTS.sseReadLatest,
    purpose: '读回页面缓存的最新一条已完成回复(ChatGPT/Claude 的 page-cache)',
    build: () => getSSEReadLatestScript(),
  },
  {
    id: AI_SCRIPTS.sseStatus,
    purpose: '读回捕获状态(条数/流式中/hook 装没装上)—— 排查「怎么没抓到」的第一站',
    build: () => getSSEStatusScript(),
  },
  {
    id: AI_SCRIPTS.sseClear,
    purpose: '清空页面缓存的回复',
    build: () => getSSEClearScript(),
  },
];

/** 把 AI 脚本全部注册进给定 registry */
export function registerAIScripts(registry: ScriptRegistry): void {
  for (const def of AI_SCRIPT_DEFINITIONS) {
    registry.register(def);
  }
}
