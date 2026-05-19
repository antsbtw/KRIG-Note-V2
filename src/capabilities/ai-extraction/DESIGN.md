# ai-extraction capability

**Status**: v0.2 (改名自 ai-conversation,2026-05-19)
**Owner**: assistant + wenwu
**Created**: 2026-05-18
**Renamed**: 2026-05-19(ai-conversation → ai-extraction,对齐目录命名"装的什么"原则)

## 定位

横切 capability：任何 view (note / ai-view / thought / future) 都能 install 'ai-extraction' 获得相同的"问 AI / 抓取整页对话"能力。与 thought capability 同性质（charter §1.4 line 196）。

**职责边界**:本 capability 只负责"抓取",**不负责落库** — 抓取结果由调用方决定写入哪个 thought(参见 src/views/ai/ai-commands.ts 的 extract-conversation)。

## 实现路径

延续 V1 web-bridge 方案 —— **Web 自动化 + SSE 拦截**，零 API key、复用用户浏览器登录。

```
┌─────────────────────────────────────────────┐
│ view (AI View / Note / Thought / ...)       │
│   install: ['ai-extraction', ...]         │
│   const ai = requireCapabilityApi<...>(...) │
│   ai.askAI('claude', '总结一下') ─────────┐ │
│                                            │ │
│   <ai.Host serviceId={s} ref={...} />    │ │
└─────────────┬──────────────────────────────│─┘
              │ this file                    │
              ▼                              │
┌─────────────────────────────────────────────┐
│ capabilities/ai-extraction/               │
│   types.ts:    AIConversationApi            │
│   index.ts:    Registry 注册 + 薄包装        │
│   Host.tsx:    嵌 webview(不做 sync driver) │
└─────────────┬──────────────────────────────│─┘
              │ window.electronAPI.aiAsk     │
              ▼                              │
┌─────────────────────────────────────────────┐
│ platform/main/ai/                           │
│   ask-orchestrator → backgroundAI →         │
│   SSECaptureManager → pasteText → click →   │
│   waitForResponse → broadcast               │
└─────────────────────────────────────────────┘
```

## API 表面

| 方法/属性 | 用途 |
|---|---|
| `askAI(serviceId, prompt, opts?)` | 端到端发问取完整 Markdown |
| `openSession(serviceId)` | 让后台 webview 提前预热(AI View Host mount 用) |
| `getServiceList()` | 三服务清单(UI 下拉菜单) |
| `getSSEStatus()` | debug |
| `onResponseReady(cb)` | 订阅 AI 完成广播(所有 askAI 调用都触发) |
| `onError(cb)` | 订阅 AI 错误广播 |
| `Host` | webview 组件供 view 渲染(嵌 claude.ai/chatgpt.com/gemini.google.com) |

## 与其他 capability 的关系

- **thought**: AI 回复落 thought atom (type='ai-response')，跨 view 集成时调 thought capability。
- **web-rendering**: 两者独立 — web-rendering 是通用 webview, ai-extraction 专属 AI 网站(走 SSE 拦截 + Auto-fill prompt)。partition 共享 'persist:webview' 复用登录。

## 历史

- V1: `src/plugins/web-bridge/capabilities/` 散落在 web plugin 内, 通过 ai-web/ai-sync 两个 workMode variant 暴露。
- V2 Phase 1-2 (feature/ai-view): 抽到独立 capability, 让所有 view 都能复用。
