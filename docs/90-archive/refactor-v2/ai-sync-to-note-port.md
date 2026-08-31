# V2 ai-sync 实施 Prompt — AI 对话自动同步到右槽 Note

**目的**：给一个新会话用，独立完成"AI Web 在左槽 + Note 在右槽 + AI 回复自动追加到 Note 末尾"功能的 V1→V2 迁移。

**为什么独立做**：当前"问 AI → Thought card"链路验证麻烦（6 步）；ai-sync 直接走"对话→Note"短链路（3 步），UI 反馈快，验证容易。验证完 ai-sync 后再回头修问 AI 路径。

---

## 任务概述

V1 有一个工作模式叫 `ai-sync`：
- 用户在 NavSide 点 🤖 AI → 左槽自动加载 AI Web (claude.ai/chatgpt.com/gemini)
- 用户在 NavSide 选一个 Note → 右槽打开
- 用户在 AI Web 里跟 AI 对话
- **每次 AI 回复完成，自动**把 `❓ 用户提问 + 🔀 Toggle 包裹的 AI 回复` 块追加到右槽 Note 末尾
- 用户看着对话实时同步进 Note，无需手动点任何按钮

V2 需要复刻这个交互。当前 V2 已完成：
- AI View（NavSide tab 🤖，order=4）
- ai-conversation capability（前台 webview + SSE 拦截 + extractFull 完整对话提取 + image proxy）
- 三服务 markdown 不失真渲染（ResultParser + extractedBlocksToPmDoc 在 `src/shared/ai-markdown-parser/`）
- text-editing capability + note capability + 完整 PM schema

**唯一缺**：把 AI 回复实时（或半实时）追加到 right slot 那个 note 的末尾。

---

## V1 完整链路参考

### V1 核心文件

| 文件 | 行数 | 角色 |
|---|---|---|
| `src/plugins/web/main/register.ts:72-85` | 14 | 注册 ai-sync workMode |
| `src/plugins/ai-note-bridge/triggers/sse-trigger.ts` | ~200 | 每 1s 轮询 SSE responses，检测 message_stop → 调 emitLatest |
| `src/plugins/ai-note-bridge/index.ts` + `processClaudeArtifactsLive` | 50 | 实时模式 artifact placeholder 替换为提示 callout |
| `src/plugins/note/ai-workflow/sync-note-receiver.ts` | ~180 | insertTurnIntoNote(view, payload)：核心实现 |
| `src/plugins/note/components/NoteView.tsx:602` | 25 | 监听 'as:append-turn' ViewMessage |

### V1 数据流

```
Claude 对话完成 (流式结束 message_stop)
  ↓
sse-trigger.ts 每 1s 轮询 webview.executeJavaScript('window.__krig_sse_responses')
  ↓
检测到某条 streaming: true → false (新完成的 turn)
  ↓
调 extractClaudeConversation(webview) 拿当前对话的 messages[]
  ↓
找到下一条还没同步过的 human message + 后续 assistant message
  ↓
processClaudeArtifactsLive(markdown, url) 替换 artifact 占位符
  ↓
viewAPI.sendToOtherSlot({
  protocol: 'ai-sync',
  action: 'as:append-turn',
  payload: { turn: { index, userMessage, markdown, timestamp }, source }
})
  ↓
NoteView 监听器(NoteView.tsx:602) 接收
  ↓
调 editorHandle.insertAiTurn(payload)
  ↓
sync-note-receiver.ts insertTurnIntoNote(view, payload):
  1. user message → ❓ Callout 块 (emoji='❓')
  2. AI markdown → 🔀 Toggle 块,内嵌 parseMarkdownToNodes 解析后的 PM nodes
     - parseMarkdownToNodes 调 viewAPI.aiParseMarkdown(markdown) IPC → Atom[] → atomsToDoc → PM JSON
  3. horizontalRule 分隔
  4. resolveInsertPos: 当前光标 block 末尾 or 文档末尾
  5. 清理多余空 paragraph (避免间距)
  6. 逐 node insert + 移动光标支持连续同步
```

### V1 关键代码片段

`sync-note-receiver.ts:45-120` (核心 insertTurnIntoNote)：

```typescript
export async function insertTurnIntoNote(view: EditorView, payload: AppendTurnPayload): Promise<void> {
  const { turn, source } = payload;
  const { schema } = view.state;
  const nodes: PMNode[] = [];

  // 1. User question → ❓ Question Callout
  if (turn.userMessage.trim()) {
    const calloutType = schema.nodes.callout;
    const userPara = textBlockType.create(null, [schema.text(turn.userMessage.trim())]);
    nodes.push(calloutType.create({ emoji: '❓' }, [userPara]));
  }

  // 2. AI answer → 🔀 Toggle 包裹解析后的 PM nodes
  if (turn.markdown.trim()) {
    const toggleType = schema.nodes.toggleList;
    const labelText = `回答 (${source.serviceName})`;
    const labelNode = textBlockType.create(null, [schema.text(labelText)]);
    const contentNodes = await parseMarkdownToNodes(schema, turn.markdown);  // markdown → PM nodes
    nodes.push(toggleType.create({ open: true }, [labelNode, ...contentNodes]));
  }

  // 3. 分隔线
  if (schema.nodes.horizontalRule) {
    nodes.push(schema.nodes.horizontalRule.create());
  }

  // 4-6. 插入位置 + 清理 + dispatch
  // ... (参考 V1 完整实现)
}
```

`sse-trigger.ts:186-201` (emit 触发)：

```typescript
viewAPI.sendToOtherSlot({
  protocol: 'ai-sync',
  action: 'as:append-turn',
  payload: {
    turn: { index, userMessage, markdown, timestamp: Date.now() },
    source: { serviceId, serviceName },
  },
});
```

---

## V2 已有的轮子（直接复用，不要重新造）

### 1. AI Webview registry（前台 webContents 拿取）
`src/platform/main/ai/webview-registry.ts`：`getActiveAIWebContents(serviceId)` 拿前台 AI webview 的 webContents

### 2. Claude 对话提取
`src/platform/main/ai/extractors/claude-api-extractor.ts`：
- `extractClaudeConversation(wc)` 调 `/api/.../chat_conversations/{id}` 拿完整 messages[]
- `extractLatestClaudeResponse(wc)` 拿最新一条 user + assistant

### 3. SSE response 轮询基础
`src/platform/main/ai/interceptor.ts SSECaptureManager`：
- `getStatus()` 拿 `{ count, latestStreaming, hooked }`
- `getLatestResponse()` 拿最新完成的 markdown
- 每个 webContents 已有 SSE hook 安装好

### 4. Markdown → PM doc 不失真渲染
`src/shared/ai-markdown-parser/`：
- `aiMarkdownToNoteDoc(markdown)` 一步函数 → NoteDocEnvelope
- 或更底层 `ResultParser().parse(md)` → `ExtractedBlock[]` → `extractedBlocksToPmDoc(blocks)` → PM doc JSON

### 5. Note CRUD capability
`src/capabilities/note/`：
- `noteCapability.createNote({ title, doc, folderId })` → NoteInfo
- `noteCapability.updateNote(id, { doc })`

### 6. text-editing instance registry（向 PM 内插块）
`src/capabilities/text-editing/types.ts`：
- `instanceRegistry.getFocusedInstanceId()` 拿当前 focused PM instance
- driver api 应该有 insertAtEnd / insertAtCursor 之类的方法（如果没有需要新加）

### 7. workspace bus 跨槽通信
`src/slot/workspace-bus/`：
- `bus.channels.emit(channel, payload)` + `bus.channels.subscribe(channel, cb)` + `getLastValue`
- 已用于 Note→AI 的 'ai.paste-and-send' 通道（参考 src/views/ai/AIView.tsx）

### 8. workspace state 订阅
`workspaceManager.subscribe()` + `ws.slotBinding.left/right` 拿当前 left/right viewId

---

## 实施任务清单

### Step 1：定 V2 ai-sync 触发模式（设计决策）

V1 用"每 1s webview executeJavaScript 轮询"是因为没有更好的事件源。V2 应该改成：
**事件驱动**：扩 SSECaptureManager 加 onResponseComplete 订阅；每次 SSE response 从 streaming:true → false 时触发 emit。零轮询。

```typescript
// SSECaptureManager 新增:
private completionListeners: Set<(record: SSEResponseRecord) => void> = new Set();
onResponseComplete(cb): () => void { ... }
// inject script 内的 readSSEStream 在 record.streaming=false 时 main 进程收到通知
// (通过 executeJavaScript 主动 push 或 dom-ready event 监听)
```

**或更简单**：保留轮询但放在 main 进程，每 1s 调 captureManager.getStatus() 检测 count 增加。

### Step 2：建 ai-sync 协调器

`src/platform/main/ai/ai-sync-orchestrator.ts`：

```typescript
/**
 * ai-sync — AI Web 左槽 + Note 右槽,AI 回复自动追加到 Note 末尾。
 *
 * 工作模式:用户开 AI View(左)+ 任意 Note(右)→ 跟 AI 对话 → 每次 turn 完成自动同步。
 */

import { getActiveAIWebContents } from './webview-registry';
import { extractClaudeConversation } from './extractors/claude-api-extractor';
import { aiMarkdownToNoteDoc, ResultParser, extractedBlocksToPmDoc } from '@shared/ai-markdown-parser';

// 跟踪每个服务已同步的 message uuid,避免重复
const syncedMessages = new Map<AIServiceId, Set<string>>();

// 启动 ai-sync 监听(当 left=ai-view + right=note-view 时启用,反之 disable)
export function startAISync(serviceId: AIServiceId): void { ... }
export function stopAISync(serviceId: AIServiceId): void { ... }

// 每次 turn 完成触发
async function emitTurn(serviceId, turn) {
  // broadcast 给所有 renderer:
  broadcast(IPC_CHANNELS.AI_SYNC_APPEND_TURN, { serviceId, turn });
}
```

### Step 3：renderer 端 ai-sync 接收 + 插入到 Note

`src/capabilities/ai-conversation/index.ts` 加 `onAppendTurn(cb)` 订阅 API。

`src/views/note/ai-sync-integration.ts`（新文件）：

```typescript
/**
 * Note 侧 ai-sync 集成:
 *   - 检测 ws.slotBinding 是 left=ai-view + right=note-view 时启动同步
 *   - 订阅 ai-conversation.onAppendTurn
 *   - 拿到 turn 调 driver API 追加到当前 active note 末尾
 */

function startWatchingForAISync(): void {
  workspaceManager.subscribe(() => {
    const ws = workspaceManager.get(workspaceManager.getActiveId());
    if (!ws) return;
    if (ws.slotBinding.left === 'ai-view' && ws.slotBinding.right === 'note-view') {
      ensureAISyncRunning(currentService);  // start
    } else {
      stopAISync();
    }
  });
}

async function handleAppendTurn(turn) {
  // 1. 拿 right slot active note id
  const noteId = ws.pluginStates['note']?.rightActiveNoteId ?? ws.pluginStates['note']?.activeNoteId;
  // 2. 拿 right slot text-editing PM instance
  // 3. 构造 ❓ callout + 🔀 toggle PM nodes(同 V1)
  // 4. driver.insertAtEnd(instanceId, nodes)
  // 5. 滚动到末尾
}
```

### Step 4：driver api 加 insertAtEnd（如不存在）

`src/drivers/text-editing-driver/api.ts`：

```typescript
/**
 * 在 doc 末尾插入一组 PM nodes(ai-sync 用)。
 * 跳过末尾空 paragraph(若有)避免多余间距;插入后 setSelection 到最后让光标跟随。
 */
insertNodesAtEnd(instanceId: string, nodesJson: unknown[]): boolean {
  const inst = instanceRegistry.get(instanceId);
  if (!inst) return false;
  const { state } = inst.view;
  const nodes = nodesJson.map(j => PMNode.fromJSON(state.schema, j));
  const endPos = state.doc.content.size;
  const tr = state.tr;
  // ... 清理末尾空 paragraph + 逐个 insert
  inst.view.dispatch(tr.scrollIntoView());
  return true;
}
```

### Step 5：拼装 ❓ Callout + 🔀 Toggle PM JSON

新写 helper `src/views/note/ai-sync-blocks.ts`（参考 V1 sync-note-receiver.ts:45-120）：

```typescript
export function buildAITurnPmNodes(turn: { userMessage: string; markdown: string }, source: { serviceName: string }): unknown[] {
  const nodes: unknown[] = [];
  // 1. ❓ Callout 用户提问
  if (turn.userMessage.trim()) {
    nodes.push({
      type: 'callout', attrs: { emoji: '❓' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: turn.userMessage.trim() }] }],
    });
  }
  // 2. 🔀 Toggle AI 回答
  if (turn.markdown.trim()) {
    const parser = new ResultParser();
    const blocks = parser.parse(turn.markdown);
    const pmDoc = extractedBlocksToPmDoc(blocks);
    nodes.push({
      type: 'toggleList',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: `回答 (${source.serviceName})` }] },
        ...(pmDoc.content as unknown[]),
      ],
    });
  }
  // 3. 分隔线
  nodes.push({ type: 'horizontalRule' });
  return nodes;
}
```

### Step 6：channel-names + IPC + preload + electron-api.d.ts + capability API

加 3 个通道：
- `AI_SYNC_START`: renderer → main 启动 ai-sync(serviceId)
- `AI_SYNC_STOP`: renderer → main 停止
- `AI_SYNC_APPEND_TURN`: main → renderer 推送 { serviceId, turn, source }

### Step 7：测试

1. 启动 app → NavSide 点 🤖 AI → 左槽出现 AI Web
2. 从 toolbar SlotToggle 选 📝 Note → 右槽出现 Note tab
3. 在 NavSide 选个具体笔记 → 右槽 NoteView 加载
4. 在左槽 Claude 输入"hello" + Enter → AI 回复
5. **预期**：AI 回复完成时右槽 Note 末尾自动追加 ❓ "hello" + 🔀 "回答 (Claude)" Toggle + ---
6. 继续问下一个问题 → 末尾继续追加
7. 切换不同 note → 同步停止；回到原 note → 同步恢复
8. 关掉 left AI tab → 同步停止
9. 验证 ChatGPT、Gemini 三服务都生效

---

## 关键约束

1. **V2 cwd 严格守门**：每个 bash 命令都 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`（memory feedback 已记录 cwd 漂移多次教训）
2. **V2 屏障**：view 不直 import main / electron / 其他 view；走 commandRegistry / capability requireCapabilityApi
3. **复用已有 markdown 解析**：直接调 `aiMarkdownToNoteDoc(md)` 或 `ResultParser+extractedBlocksToPmDoc`，**不要重写**
4. **不失真原则**（用户已表态）：所有 AI 回复 markdown 必须经 ResultParser 不能 split('\n\n')
5. **分阶段 commit**：建议 step 1-2 一个 commit、3-4 一个、5-6 一个、7 验证一个
6. **typecheck + lint 双 0 warning** 才能 commit

---

## 当前 V2 分支状态

`feature/ai-view` 已 17 个 commit（含 AI View 主舞台 + 问 AI + 提取到 thought + markdown 不失真 + 三服务 extractor + image proxy）。本次 ai-sync 在同分支继续，或新开 `feature/ai-sync-to-note` 都可。

实施完后用户会逐项验证（参考 Step 7 的 9 个测试点）。
