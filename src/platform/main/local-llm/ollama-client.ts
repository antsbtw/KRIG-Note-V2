/**
 * 通用 Ollama 客户端（与 X 无关，未来 Agent 模块共用）
 *
 * 调用 Ollama OpenAI 兼容接口：POST /v1/chat/completions
 * 主进程直接 fetch，不经 webview。
 */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaCallOptions {
  model: string;
  messages: OllamaMessage[];
  endpoint?: string;           // 默认 'http://localhost:11434'
  timeoutMs?: number;          // 默认 30000
  temperature?: number;        // 默认 0.2
  responseFormat?: 'json_object' | 'text';
}

export interface OllamaResponse {
  content: string;
}

/**
 * 调用 Ollama，返回模型文本回复。
 * 失败（网络不通 / 模型未拉取 / 超时）→ throw（fail loud，调用方决定降级策略）。
 */
export async function callOllama(opts: OllamaCallOptions): Promise<OllamaResponse> {
  const endpoint = opts.endpoint ?? 'http://localhost:11434';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const url = `${endpoint}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    stream: false,
  };

  if (opts.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`Ollama response missing choices[0].message.content`);
  }

  return { content };
}
