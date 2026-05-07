/**
 * AI Service Profile 类型定义
 *
 * 每个 AI 服务的 URL、DOM 选择器、SSE 拦截策略、输入方式各不相同。
 * 将差异收敛到 Profile 配置表中，上层逻辑不关心具体服务的实现细节。
 *
 * 设计文档：docs/web/AI-Workflow-Protocol-设计.md §三
 */

// ═══════════════════════════════════════════════════════
// §1  AI Service ID
// ═══════════════════════════════════════════════════════

export type AIServiceId = 'chatgpt' | 'claude' | 'gemini';

// ═══════════════════════════════════════════════════════
// §2  SSE 拦截策略
// ═══════════════════════════════════════════════════════

/**
 * 三大 AI 服务的 SSE 拦截策略各不相同：
 * - fetch-hook:       hook window.fetch，拦截 SSE text_delta（Claude）
 * - conversation-api: 检测 DOM 完成后调 conversation API 获取完整 Markdown（ChatGPT）
 * - cdp-network:      CDP 网络层拦截 StreamGenerate（Gemini）
 */
export type SSEInterceptStrategy =
  | 'fetch-hook'
  | 'conversation-api'
  | 'cdp-network';

/**
 * 输入方式：
 * - paste-contenteditable: 模拟粘贴到 contentEditable 元素（ChatGPT / Claude）
 * - paste-textarea:        模拟粘贴到 textarea 元素（Gemini）
 */
export type AIInputMethod =
  | 'paste-contenteditable'
  | 'paste-textarea';

// ═══════════════════════════════════════════════════════
// §3  AIServiceProfile 接口
// ═══════════════════════════════════════════════════════

export interface AIServiceSelectors {
  /** 输入框 CSS selector */
  inputBox: string;
  /** 发送按钮 CSS selector */
  sendButton: string;
  /** 消息列表容器 */
  messageList: string;
  /** 用户消息元素 */
  userMessage: string;
  /** AI 回复元素 */
  assistantMessage: string;
  /** 对话标题元素（可选） */
  conversationTitle?: string;
}

export interface AIServiceInterceptConfig {
  /** 拦截策略 */
  strategy: SSEInterceptStrategy;
  /** 匹配拦截的请求 URL pattern（字符串会被转为 RegExp） */
  endpointPattern: string;
}

export interface AIServiceInputConfig {
  /** 输入方式 */
  method: AIInputMethod;
  /** 是否支持粘贴图片 */
  supportsImage: boolean;
  /** 是否支持上传文件 */
  supportsFile: boolean;
  /** 发送快捷键 */
  submitKey: 'Enter' | 'Ctrl+Enter';
}

export interface AIServiceProfile {
  /** 服务标识 */
  id: AIServiceId;
  /** 显示名称 */
  name: string;
  /** 图标（emoji） */
  icon: string;

  // ── URL ──
  /** 服务基础 URL */
  baseUrl: string;
  /** 新对话 URL */
  newChatUrl: string;
  /** URL 匹配正则（字符串形式，运行时转为 RegExp） */
  urlPattern: string;

  // ── DOM ──
  selectors: AIServiceSelectors;

  // ── SSE 拦截 ──
  intercept: AIServiceInterceptConfig;

  // ── 输入 ──
  input: AIServiceInputConfig;
}

// ═══════════════════════════════════════════════════════
// §4  三服务配置
// ═══════════════════════════════════════════════════════

/**
 * Claude — Anthropic
 *
 * SSE 策略：hook window.fetch → 拦截 /api/organizations/.../chat_conversations/.../completion
 * 流格式：Server-Sent Events，text_delta 事件包含增量文本
 * 完成信号：message_stop 事件
 */
const CLAUDE_PROFILE: AIServiceProfile = {
  id: 'claude',
  name: 'Claude',
  icon: '✦',
  baseUrl: 'https://claude.ai',
  newChatUrl: 'https://claude.ai/new',
  urlPattern: '^https://claude\\.ai',
  selectors: {
    inputBox: '[contenteditable="true"].ProseMirror',
    sendButton: 'button[aria-label="Send Message"]',
    messageList: '[class*="conversation-content"]',
    userMessage: '[data-is-streaming="false"][class*="human"]',
    assistantMessage: '.font-claude-response, [class*="font-claude-response"]:not([class*="response-body"])',
    conversationTitle: 'button[data-testid="chat-menu-trigger"]',
  },
  intercept: {
    strategy: 'fetch-hook',
    endpointPattern: '/api/',
  },
  input: {
    method: 'paste-contenteditable',
    supportsImage: true,
    supportsFile: true,
    submitKey: 'Enter',
  },
};

/**
 * ChatGPT — OpenAI
 *
 * SSE 策略：检测 DOM 回复完成后，调 /backend-api/conversation/ API 获取完整 Markdown
 * ChatGPT 的 SSE 流格式不稳定，直接从 API 获取最终结果更可靠
 * 完成信号：conversation API 响应中 status === 'finished_successfully'
 */
const CHATGPT_PROFILE: AIServiceProfile = {
  id: 'chatgpt',
  name: 'ChatGPT',
  icon: '◉',
  baseUrl: 'https://chatgpt.com',
  newChatUrl: 'https://chatgpt.com/',
  urlPattern: '^https://chatgpt\\.com',
  selectors: {
    inputBox: '#prompt-textarea',
    sendButton: 'button[data-testid="send-button"]',
    messageList: '[class*="react-scroll-to-bottom"]',
    userMessage: '[data-message-author-role="user"]',
    assistantMessage: '[data-message-author-role="assistant"], .agent-turn',
    conversationTitle: 'title',
  },
  intercept: {
    strategy: 'conversation-api',
    endpointPattern: '/backend-api/conversation',
  },
  input: {
    method: 'paste-contenteditable',
    supportsImage: true,
    supportsFile: true,
    submitKey: 'Enter',
  },
};

/**
 * Gemini — Google
 *
 * SSE 策略：CDP 网络层拦截 StreamGenerate 请求
 * 通过 webContents.debugger API 监听 Network.responseReceived
 * 完成信号：响应流关闭
 */
const GEMINI_PROFILE: AIServiceProfile = {
  id: 'gemini',
  name: 'Gemini',
  icon: '◆',
  baseUrl: 'https://gemini.google.com',
  newChatUrl: 'https://gemini.google.com/app',
  urlPattern: '^https://gemini\\.google\\.com',
  selectors: {
    inputBox: '.ql-editor[contenteditable="true"]',
    sendButton: 'button.send-button',
    messageList: 'infinite-scroller',
    userMessage: '.user-query-container',
    assistantMessage: '.response-container',
    conversationTitle: '.conversation-title',
  },
  intercept: {
    strategy: 'cdp-network',
    endpointPattern: 'StreamGenerate',
  },
  input: {
    method: 'paste-contenteditable',
    supportsImage: true,
    supportsFile: true,
    submitKey: 'Enter',
  },
};

// ═══════════════════════════════════════════════════════
// §5  注册表 + 查询
// ═══════════════════════════════════════════════════════

/** 所有已注册的 AI 服务 Profile */
export const AI_SERVICE_PROFILES: readonly AIServiceProfile[] = [
  CLAUDE_PROFILE,
  CHATGPT_PROFILE,
  GEMINI_PROFILE,
] as const;

/** 默认 AI 服务 */
export const DEFAULT_AI_SERVICE: AIServiceId = 'claude';

/**
 * 根据 ID 查找 Profile
 */
export function getAIServiceProfile(id: AIServiceId): AIServiceProfile {
  const profile = AI_SERVICE_PROFILES.find(p => p.id === id);
  if (!profile) throw new Error(`Unknown AI service: ${id}`);
  return profile;
}

/**
 * 根据 URL 检测当前 AI 服务
 * @returns 匹配的 Profile，未匹配返回 null
 */
export function detectAIServiceByUrl(url: string): AIServiceProfile | null {
  return AI_SERVICE_PROFILES.find(p => new RegExp(p.urlPattern).test(url)) ?? null;
}

/**
 * 获取所有服务的简要信息（用于 UI 下拉菜单）
 */
export function getAIServiceList(): Array<{ id: AIServiceId; name: string; icon: string }> {
  return AI_SERVICE_PROFILES.map(p => ({ id: p.id, name: p.name, icon: p.icon }));
}
