# Web Translate — Slot 间通信协议设计

## 核心原则

1. **同一时刻只有单向通信** — 鼠标所在的 slot 是发送方（controller），对面是接收方（passive）
2. **controller 只发不收，passive 只收不发** — 没有例外
3. **控制权由用户活动自动触发** — 不需要手动切换

## 两个 Slot 的职责

| | Left Slot (WebView) | Right Slot (TranslateWebView) |
|---|---|---|
| 内容 | 原文网页 | 翻译后的同一网页 |
| 翻译 | 无 | 自行注入 Google Translate |
| 同步脚本 | 自行注入 sync-inject.js | 自行注入 sync-inject.js |
| poll | 自行 poll 自己的 guest | 自行 poll 自己的 guest |

**关键：两个 slot 是完全独立的 View，各自管理自己的 guest。通信只通过 ViewMessage。**

## 生命周期

```
用户点击"翻译"按钮
  → ensureRightSlot('web-translate')
  → Shell 创建右侧 WebContentsView，加载 web.html?variant=translate
  → TranslateWebView 组件渲染
  → TranslateWebView 发送 REQUEST_URL 给左侧
  → 左侧回复 NAVIGATE（当前 URL）
  → 右侧 webview loadURL → did-finish-load
  → 右侧自行注入翻译 + 同步脚本
  → 右侧发送 READY 给左侧
  → 左侧启动同步轮询
  → 双方就绪，用户开始操作
```

## 通信消息定义

### 1. NAVIGATE — 导航同步

**方向：controller → passive**

当 controller 侧的用户点击链接导致页面导航时，通知 passive 侧跟随加载同一 URL。

```typescript
{
  protocol: 'web-translate',
  action: 'wt:navigate',
  payload: { url: string }
}
```

**规则：**
- 只有 controller 发送，passive 收到后 loadURL，不回发
- passive 的 did-navigate 因为自己不是 controller，所以不发 NAVIGATE

### 2. REQUEST_URL — 初始化请求

**方向：右侧 → 左侧（仅初始化时一次）**

右侧 renderer 就绪后，向左侧请求当前正在浏览的 URL。

```typescript
{
  protocol: 'web-translate',
  action: 'wt:request-url',
  payload: {}
}
```

**规则：**
- 仅在右侧首次渲染时发送一次
- 左侧收到后无条件回复 NAVIGATE（不受控制权限制，因为这是初始化）

### 3. READY — 就绪通知

**方向：右侧 → 左侧**

右侧页面加载完成、同步脚本注入后，通知左侧可以开始同步。

```typescript
{
  protocol: 'web-translate',
  action: 'wt:ready',
  payload: {}
}
```

**规则：**
- 左侧收到后启动同步轮询（如果还没启动的话）
- 每次右侧页面导航完成后都会发送

### 4. SYNC_EVENTS — 同步事件批量传输

**方向：controller → passive**

controller 侧的 SyncDriver 轮询 guest 事件队列，将采集到的事件打包发给 passive 侧。

```typescript
{
  protocol: 'web-translate',
  action: 'wt:sync-events',
  payload: {
    events: SyncEvent[],
    fromSide: 'left' | 'right'
  }
}
```

**规则：**
- 只有 controller 发送
- passive 收到后应用到自己的 guest
- passive 不发送 SYNC_EVENTS

### 5. TAKE_CONTROL — 控制权切换

**方向：新 controller → 旧 controller**

当一侧检测到用户活动（poll 到了事件），自动抢占控制权。

```typescript
{
  protocol: 'web-translate',
  action: 'wt:take-control',
  payload: { fromSide: 'left' | 'right' }
}
```

**规则：**
- 收到方立即变为 passive（清空自己的事件队列）
- 发送方变为 controller（开始发送 SYNC_EVENTS）

## 控制权状态机

```
            ┌─────────────────────────────────────────┐
            │         TAKE_CONTROL (from right)       │
            ▼                                         │
     ┌──────────────┐                         ┌──────────────┐
     │  Left:       │    SYNC_EVENTS ────→    │  Right:      │
     │  CONTROLLER  │    NAVIGATE ────→       │  PASSIVE     │
     │  (poll+send) │                         │  (recv+apply)│
     └──────────────┘                         └──────────────┘
            │                                         ▲
            │         TAKE_CONTROL (from left)        │
            └─────────────────────────────────────────┘
            
            ▲                                         │
            │         TAKE_CONTROL (from left)        │
            ┌─────────────────────────────────────────┘
            │                                         ▼
     ┌──────────────┐                         ┌──────────────┐
     │  Left:       │    ←──── SYNC_EVENTS    │  Right:      │
     │  PASSIVE     │    ←──── NAVIGATE       │  CONTROLLER  │
     │  (recv+apply)│                         │  (poll+send) │
     └──────────────┘                         └──────────────┘
```

**初始状态：两侧都是 PASSIVE。**

第一次用户交互自动触发 TAKE_CONTROL。

## 控制权触发时机

SyncDriver 在 poll 时：
1. 始终读取 guest 的 `__mirroSyncQueue`（清空队列）
2. 如果队列为空 → 不做任何事
3. 如果队列非空（说明用户在操作本侧）：
   a. 如果当前是 passive → 发送 TAKE_CONTROL 给对面 → 自己变 controller
   b. 发送 SYNC_EVENTS 给对面

这样**控制权判定完全基于 guest 内的用户活动**，不依赖 host renderer 的 DOM 事件。

## 每个 Slot 的内部流程

### Left Slot (WebView.tsx)

```
setupWebview(el):
  1. 创建 SyncDriver('left')
  2. 绑定 webview
  3. did-navigate → if controller: send NAVIGATE
  4. did-finish-load → reinject sync script

onMessage:
  TAKE_CONTROL → yield (变 passive, 清空队列)
  SYNC_EVENTS → handleRemoteEvents (仅 passive 时执行)
  NAVIGATE → loadURL (仅 passive 时触发的导航不回发)
  REQUEST_URL → 回复 NAVIGATE（无条件，初始化用）
  READY → start sync polling
```

### Right Slot (TranslateWebView.tsx)

```
setupWebview(el):
  1. 创建 SyncDriver('right')
  2. 绑定 webview
  3. did-finish-load:
     a. start sync polling
     b. send READY
     c. 异步注入 Google Translate（不阻塞同步）
  4. did-navigate → if controller: send NAVIGATE

useEffect (mount):
  send REQUEST_URL（一次性初始化）

onMessage:
  TAKE_CONTROL → yield
  SYNC_EVENTS → handleRemoteEvents (仅 passive 时执行)
  NAVIGATE → loadURL
```

## 翻译注入独立于通信

翻译注入（TranslateDriver）是右侧 View 的**内部行为**：
- 在 did-finish-load 后异步执行
- 不通过 ViewMessage 与左侧通信
- 注入失败不影响同步功能
- 每步 executeJavaScript 有超时保护

## 事件类型与方向规则

| 事件类型 | 方向 | 说明 |
|----------|------|------|
| scroll-delta | controller → passive | 像素级滚动增量 |
| scroll-anchor | controller → passive | 锚点元素矫正 |
| click | controller → passive | 按钮/toggle 点击 |
| input | left → right only | 输入框值同步（不反向） |
| input-enter | right → left only | 右侧输入 → 翻译 → 回填左侧 |
| submit | controller → passive | 表单提交 |
| selection | controller → passive | 文本选择高亮 |

`input` 和 `input-enter` 有方向限制，通过 `fromSide` 字段在接收端过滤。
