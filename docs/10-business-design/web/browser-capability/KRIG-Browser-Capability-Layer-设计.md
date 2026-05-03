# KRIG Browser Capability Layer 设计文档

> 文档类型：架构设计文档  
> 产品名称：KRIG / KRIG Note  
> 状态：设计阶段 | 创建日期：2026-04-16 | 版本：v0.1
>
> **文档目的**：定义 KRIG 基于 Electron 的浏览器底层掌控能力，作为 Module 5（Gemma4）、WebView、WebBridge、AI 工作流与网页自动化的统一能力底座。

---

## 一、问题定义

### 1.1 当前问题不是某类网页，而是缺少浏览器原型级能力层

当前在 Claude / ChatGPT / Gemini 页面上暴露出来的问题，只是症状，不是目标本身。

真正的问题是：KRIG 仍然把网页处理理解成“对若干页面做提取脚本”，而不是“作为 Electron 内部浏览器原型，对任意网页具备稳定的观测、解析、交互与落库能力”。

目前的提取链过于依赖：

- 页面 DOM 结构
- 右键菜单位置
- 懒加载状态
- iframe 层级
- 页面内按钮文本

这会带来几个直接问题：

- 页面一改版，提取逻辑就失效
- 同一份内容在网络层、DOM 层、渲染层并不总是同构
- 用户能看见，不等于 DOM 层就能稳定拿到
- AI 服务页面只是暴露问题最快的一类页面，普通网页、知识库、内嵌工具页、表单页、仪表盘页、后台系统、内容站点都会遇到同类问题

### 1.2 新目标

KRIG 需要的不是“若干个站点适配脚本”，也不是“围绕 Chrome DevTools / CDP 暴露出来的约定接口拼装能力”，而是一层统一的：

**Browser Capability Layer**

这层应当让 KRIG 具备：

- 对浏览器网络流量、资源加载、下载、frame、渲染树的底层观测能力
- 对页面 DOM / Frame / 渲染结果 / 下载结果的读取能力
- 对鼠标、键盘、滚动、选择、导航、表单、下载的程序化控制能力
- 对网页内容抽取、附件入库、截图回退、自动化执行的统一抽象
- 对所有类型网页都成立的、站点无关的数据模型与交互模型

### 1.3 一句话原则

**人既然能通过浏览器看到并操作内容，KRIG 就必须在合适的层级上具备等价的程序能力。**

这里的“合适层级”不一定是 DOM；它可能是：

- 网络层
- 资源加载层
- Frame 层
- 渲染层
- 下载层
- 自动化交互层

这里的“程序能力”也不应当被理解为某个浏览器厂商暴露出的调试接口能力，而应当是 Electron 作为浏览器原型所允许 KRIG 掌控的真实底层能力。CDP 可以是实现手段之一，但不能成为架构前提。

---

## 二、设计目标

### 2.1 总目标

建立一套与具体站点解耦、与 Chrome 特定调试接口解耦的浏览器底层能力体系，使上层模块只关心“我要做什么”，而不关心“网页的当前实现细节是什么、某个浏览器调试接口恰好能给什么”。

### 2.2 设计目标列表

1. 统一网页交互能力  
支持普通网页、AI 网页、登录页、表单页、知识页、嵌入工具页、后台系统、仪表盘页。

2. 统一内容采集能力  
正文、结构化数据、图片、附件、iframe 内容、可视区域、用户选区，统一抽象。

3. 统一自动化能力  
导航、点击、输入、等待、滚动、截图、下载、上传、监听响应。

4. 统一存储落地能力  
网页正文、附件、截图、提取记录统一入 KRIG 内部存储，不依赖外部路径。

5. 通用网页优先  
底层数据模型、缓存格式、交互抽象必须首先服务于任意网页，而不是先服务于 Claude / ChatGPT / Gemini 等个性化页面。

6. 支持 Module 5  
为 Gemma4/Agent 提供稳定的 browser state、browser actions、browser memory。

7. DOM 不是唯一入口  
当 DOM 不稳定时，允许退回到网络层、frame 层或渲染层。

8. Electron 原生能力优先  
优先使用 Electron 可直接掌控的 session、webContents、下载、生命周期、资源加载与渲染能力；任何基于 CDP / DevTools 协议的方案都必须被视为可替换实现，而不是系统边界。

### 2.3 非目标

1. 不试图在 v0.1 就完全替代所有现有 WebBridge 代码。
2. 不在 v0.1 强行统一所有 AI 服务的业务逻辑。
3. 不在 v0.1 解决所有复杂站点的自动登录与反爬问题。
4. 不把某个站点的私有接口结构直接上升为底层标准模型。

---

## 三、核心设计原则

### 3.1 数据分层优先级

当同一份内容可以从多层获取时，优先级应为：

1. 网络层
2. 下载层
3. Frame 层
4. DOM 层
5. 渲染截图层

含义：

- 正文优先走网络响应
- 附件优先走真实下载
- iframe/widget 优先走 frame 内部资源
- DOM 只做定位与结构辅助
- 截图是 fallback，不是主链

这套优先级适用于所有网页，不是 AI 页面特例。

### 3.2 站点适配是上层插件，不是底层能力

底层能力只回答：

- 当前页面有哪些 frame
- 页面发起了哪些请求
- 哪个元素可点击
- 哪块区域可截图
- 哪个下载完成了
- 当前页面有哪些可定位锚点
- 当前页面有哪些可泛化的 artifact / attachment / interaction surface

站点适配层才回答：

- Claude 的回复区在哪里
- ChatGPT 的 conversation API 是什么
- Gemini 的流响应如何解析

并且站点适配层只能做“解释与增强”，不能反向定义底层数据模型。

### 3.3 通用网页对象先于站点对象

Browser Capability Layer 的底层输出必须先表达通用网页对象，例如：

- NetworkRecord
- DownloadRecord
- FrameState
- DomAnchor
- ArtifactRecord
- InteractionTarget

而不是直接表达：

- ClaudeConversation
- ChatGPTMessage
- GeminiChunk

这些站点特化对象只能作为 adapter 的派生结果存在，不能成为底层标准输出。

### 3.4 用户看到的内容必须可回溯

任何进入 KRIG 的网页数据，都应当能回答：

- 来源于哪个页面
- 来源于哪一层（network/dom/frame/render/download）
- 来源于哪个 frame
- 发生于什么时间
- 对应哪次用户动作或自动任务

### 3.5 Electron 原生能力优先于浏览器调试协议

架构设计时必须以 Electron 自身可掌控的浏览器能力为边界：

- session / partition
- webContents / WebContentsView
- 导航与生命周期
- 下载与资源落地
- frame / 渲染结果
- 注入脚本与运行时桥接

CDP / DevTools 协议可以作为某些功能的一个实现来源，例如 response body capture，但：

- 不能成为唯一实现
- 不能反向塑造底层接口
- 不能把 KRIG 的能力定义为“Chrome 约定的 API 能给什么”

底层接口应当描述 KRIG 想掌控的浏览器能力，而不是某个协议恰好暴露的命令集。

### 3.6 附件就是附件

下载型 artifact 一律先按文件处理：

- 先下载原始 bytes
- 入 KRIG 内部 media store
- 再交给 Note 作为内部附件块处理

不要在下载层根据文件类型随意改写成正文块。

### 3.7 先结构化缓存，再导入

任何复杂网页提取，尤其是含 artifact / iframe / 附件的提取，都应当先产生结构化缓存，再决定如何导入 Note，而不是边抓边拼 markdown。

### 3.8 网络层必须同时支持查询式和订阅式

L1 Network Capture 不能只提供：

- `listRequests()`
- `waitForRequest()`
- `getResponseBody()`

这类查询式接口。

还必须提供事件/订阅模型，因为很多关键数据天然是流式的：

- SSE
- websocket
- chunked fetch response
- streaming JSON
- 下载进度
- 多 frame 并发请求

因此 L1 的设计原则应是：

- 历史数据可查询
- 实时数据可订阅
- 查询与订阅共享同一份 request/frame 关联模型

### 3.8.1 Response body 获取是 L1 的关键实施决策点

必须明确：

- `session.webRequest` 能稳定提供请求元信息与状态变化
- 但不能直接提供 response body

因此 L1 中的 `getResponseBody()` / `response-chunk` / `bodyRef` 不应被理解为 `webRequest` 天然自带能力，而应由独立的 body provider 负责补齐。

v0.1 推荐的实现策略：

1. `session/webRequest`
   - 负责 request / response 元信息
   - 负责 pageId / frameId / download 的归属关系

2. `response-body-provider`
   - 负责 response body 获取
   - 可由多实现来源组成，例如：
     - CDP / `webContents.debugger`
     - 页面注入的 fetch/XHR hook
     - 下载管线
     - 未来可扩展的其他 Electron 可控来源

3. `NetworkRecord` / `bodyRef`
   - 作为统一输出模型
   - 不暴露 provider 内部实现细节

这意味着：

- L1 的接口设计是成立的
- 但 body 获取路径必须在 Phase 2 明确选型
- 这是 v0.1 最早需要落地的硬技术决策之一

### 3.9 多页面不是例外，而是默认场景

对 Module 5 来说，多页面、多标签、多隐藏页面、多后台任务不是边角情况，而是默认能力需求。

所以 Browser Capability Layer 从一开始就要把资源生命周期建模清楚：

- 谁创建页面
- 谁持有页面
- 页面是否可见
- 页面是否共享 session
- 页面何时回收
- 谁可以复用已有页面

否则后面做：

- 后台抓取
- 多窗口协同
- Agent 并发浏览
- 同一站点多任务执行

时会不断返工。

---

## 四、总体架构

### 4.1 分层总览

```text
Browser Capability Layer
├── L0 Session / Lifecycle
├── L1 Resource / Network Capture
├── L2 Page Runtime
├── L3 Frame / Render Capture
├── L4 Interaction / Automation
├── L5 Artifact / Download Pipeline
└── L6 Output / Persistence Bridge
```

### 4.2 各层职责

#### L0 Session / Lifecycle

负责：

- BrowserWindow / WebContentsView / webview 生命周期
- session / partition 管理
- 导航事件
- frame 树变更
- webContents 状态诊断
- 生命周期事件订阅

#### L1 Resource / Network Capture

负责：

- request / response 拦截
- fetch / XHR / SSE / websocket 事件
- 下载开始 / 下载完成 / 下载失败
- 请求与 frame 的归属关联
- 流式事件订阅与回放
- 资源体获取能力抽象
- 多实现来源统一：
  - Electron session/webRequest
  - 下载管线
  - 页面注入 hook
  - 可替换的底层 body capture provider

#### L2 Page Runtime

负责：

- DOM 查询
- 标题/区块/选区定位
- 页面文本 / HTML / 属性读取
- runtime 注入脚本
- 页面级消息桥接

注意：

- DOM 在本层是辅助语义层，不是默认主数据源
- 主要职责是定位、验证可见性、补齐网络层无法表达的页面语义

#### L3 Frame / Render Capture

负责：

- frame 列举
- frame 可见性
- 区域截图
- frame 页面截图
- canvas/svg/img/iframe 可视结果抓取

约束：

- 同源 frame 可优先走 runtime / DOM / SVG 导出
- 跨域 frame 不能默认假设可直接结构化读取
- 对跨域 frame，底层更可靠的路径通常是：
  - render capture
  - 下载管线
  - network/source-first
  - frame 内已存在的可控桥接

因此：

- `captureFrame()` 应被理解为“尽可能获取该 frame 的可视结果”
- `exportSVG()` 只对当前访问权限允许的上下文成立
- 不能在顶层接口上承诺“任意 frame 均可结构化读取”

#### L4 Interaction / Automation

负责：

- 点击
- 输入
- 键盘
- 鼠标
- 滚动
- hover
- 右键菜单
- 等待条件

#### L5 Artifact / Download Pipeline

负责：

- 正文与 artifact 的结构化拆分
- 文件型 artifact 下载
- iframe/widget 型 artifact 数据或渲染结果获取
- 占位符与实体位置绑定
- 将通用网页对象整理为页面级结构化缓存

#### L6 Output / Persistence Bridge

负责：

- 结构化缓存写盘
- media store 入库
- Note / Thought / Module 5 的标准输出
- 调试追踪与回放

---

## 五、关键能力模型

### 5.1 Browser State

Browser Capability Layer 应提供稳定的浏览器状态快照。

```ts
export type BrowserState = {
  pageId: string;
  url: string;
  title: string;
  partition: string;
  loading: boolean;
  readyState: 'loading' | 'interactive' | 'complete' | 'unknown';
  visibility: 'foreground' | 'background' | 'hidden';
  owner: 'user' | 'agent' | 'system';
  reusable: boolean;
  frames: FrameState[];
  downloads: DownloadState[];
  selection?: SelectionState | null;
  capturedAt: string;
};
```

### 5.2 Frame State

```ts
export type FrameState = {
  frameId: string;
  parentFrameId?: string | null;
  url: string;
  origin: string;
  visible: boolean;
  bounds?: Rect | null;
  kind: 'main' | 'subframe' | 'guest' | 'unknown';
};
```

### 5.3 Network Record

```ts
export type NetworkRecord = {
  requestId: string;
  pageId: string;
  frameId?: string | null;
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  startedAt: string;
  finishedAt?: string;
  bodyRef?: string;
};
```

### 5.4 Network Event

```ts
export type NetworkEvent =
  | {
      kind: 'request-start';
      pageId: string;
      frameId?: string | null;
      requestId: string;
      url: string;
      method: string;
      at: string;
    }
  | {
      kind: 'response-chunk';
      pageId: string;
      frameId?: string | null;
      requestId: string;
      mimeType?: string;
      chunkText?: string;
      chunkBytesRef?: string;
      at: string;
    }
  | {
      kind: 'response-complete';
      pageId: string;
      frameId?: string | null;
      requestId: string;
      status?: number;
      bodyRef?: string;
      at: string;
    }
  | {
      kind: 'download-complete';
      pageId: string;
      frameId?: string | null;
      downloadId: string;
      filename: string;
      storageRef?: string;
      at: string;
    };
```

### 5.4 Download Record

```ts
export type DownloadRecord = {
  downloadId: string;
  pageId: string;
  frameId?: string | null;
  url: string;
  filename: string;
  mimeType?: string;
  byteLength?: number;
  storageRef?: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  startedAt: string;
  finishedAt?: string;
};
```

### 5.5 Artifact Record

```ts
export type ArtifactRecord = {
  artifactId: string;
  pageId: string;
  frameId?: string | null;
  kind: 'text' | 'image' | 'file' | 'widget' | 'chart' | 'table' | 'code' | 'unknown';
  sourceLayer: 'network' | 'download' | 'dom' | 'frame' | 'render';
  title?: string;
  mimeType?: string;
  url?: string;
  domAnchorId?: string;
  storageRef?: string;
  previewRef?: string;
  createdAt: string;
};
```

### 5.6 Page Resource Lease

```ts
export type PageResourceLease = {
  leaseId: string;
  pageId: string;
  owner: 'user' | 'agent' | 'system';
  purpose: string;
  visibility: 'foreground' | 'background' | 'hidden';
  partition: string;
  acquiredAt: string;
  expiresAt?: string;
  reusable: boolean;
};
```

### 5.7 Dom Anchor

```ts
export type DomAnchor = {
  anchorId: string;
  pageId: string;
  selectorHint?: string;
  textPreview?: string;
  rect?: Rect | null;
  role?: string;
  headingPath?: string[];
  ordinal?: number;
};
```

### 5.8 Rect / Selection

```ts
export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SelectionState = {
  text: string;
  html?: string;
  rects: Rect[];
  anchorNodeText?: string;
  focusNodeText?: string;
};
```

---

## 六、模块目录结构建议

### 6.1 新目录结构

建议在现有 `src/plugins/web-bridge/` 基础上演进为：

```text
src/plugins/browser-capability/
├── README.md
├── index.ts
│
├── core/
│   ├── session-manager.ts
│   ├── page-registry.ts
│   ├── frame-registry.ts
│   ├── lifecycle-monitor.ts
│   ├── lease-manager.ts
│   └── capability-errors.ts
│
├── network/
│   ├── request-observer.ts
│   ├── response-store.ts
│   ├── network-event-bus.ts
│   ├── response-body-provider.ts
│   ├── sse-capture.ts
│   ├── websocket-capture.ts
│   ├── fetch-hook.ts
│   └── download-monitor.ts
│
├── runtime/
│   ├── dom-reader.ts
│   ├── section-locator.ts
│   ├── selection-reader.ts
│   ├── runtime-bridge.ts
│   └── inject-scripts/
│       ├── dom-bridge.ts
│       ├── selection-capture.ts
│       ├── artifact-postmessage-hook.ts
│       └── page-probe.ts
│
├── render/
│   ├── page-capture.ts
│   ├── rect-capture.ts
│   ├── frame-capture.ts
│   ├── svg-export.ts
│   └── canvas-capture.ts
│
├── interaction/
│   ├── click.ts
│   ├── keyboard.ts
│   ├── mouse.ts
│   ├── scroll.ts
│   ├── form-fill.ts
│   ├── context-menu.ts
│   └── waiters.ts
│
├── artifact/
│   ├── artifact-probe.ts
│   ├── attachment-pipeline.ts
│   ├── frame-artifact-pipeline.ts
│   ├── render-fallback-pipeline.ts
│   ├── placeholder-mapper.ts
│   └── adapters/
│       ├── claude-adapter.ts
│       ├── chatgpt-adapter.ts
│       ├── gemini-adapter.ts
│       └── generic-web-adapter.ts
│
├── persistence/
│   ├── capture-cache.ts
│   ├── media-store-bridge.ts
│   ├── note-output-bridge.ts
│   └── debug-trace-store.ts
│
└── types/
    ├── browser-state.ts
    ├── core-types.ts
    ├── network-types.ts
    ├── artifact-types.ts
    ├── interaction-types.ts
    ├── output-types.ts
    └── capability-interfaces.ts
```

### 6.2 与现有 WebBridge 的关系

短期内不要求一次性迁移。建议：

- `src/plugins/web-bridge/` 继续作为现有实现
- 新的 `browser-capability/` 先承接底层能力抽象
- 再逐步把：
  - `capabilities/interceptor.ts`
  - `capabilities/writer.ts`
  - `capabilities/cdp-interceptor.ts`
  - `claude-artifact-download/*`
  拆回新的结构里

### 6.3 迁移原则

1. 先抽象接口，再迁移实现
2. 先收口底层能力，再保留站点适配差异
3. 先让新旧层共存，不强行一次性替换
4. 任何依赖 CDP 的实现都必须挂在可替换 provider 之下，不直接暴露为顶层能力接口

---

## 七、第一版 TypeScript 接口草案

### 7.1 顶层 Capability 接口

```ts
export interface IBrowserCapabilityLayer {
  core: IBrowserCoreAPI;
  state: IBrowserStateAPI;
  network: IBrowserNetworkAPI;
  runtime: IBrowserRuntimeAPI;
  render: IBrowserRenderAPI;
  interaction: IBrowserInteractionAPI;
  artifact: IBrowserArtifactAPI;
  persistence: IBrowserPersistenceAPI;
}
```

### 7.2 Core API

```ts
export interface IBrowserCoreAPI {
  subscribeLifecycle(
    listener: (event: PageLifecycleEvent) => void | Promise<void>,
  ): Promise<() => void>;
}
```

### 7.3 State API

```ts
export interface IBrowserStateAPI {
  getPageState(pageId: string): Promise<BrowserState>;
  listFrames(pageId: string): Promise<FrameState[]>;
  getActiveFrame(pageId: string): Promise<FrameState | null>;
  acquirePageLease(input: {
    pageId?: string;
    owner: 'user' | 'agent' | 'system';
    purpose: string;
    visibility?: 'foreground' | 'background' | 'hidden';
    partition?: string;
    reusable?: boolean;
    ttlMs?: number;
  }): Promise<PageResourceLease>;
  releasePageLease(leaseId: string): Promise<void>;
  listLeases(): Promise<PageResourceLease[]>;
}
```

### 7.4 Network API

```ts
export interface IBrowserNetworkAPI {
  listRequests(pageId: string, filter?: {
    frameId?: string;
    urlIncludes?: string;
    resourceType?: string;
    limit?: number;
  }): Promise<NetworkRecord[]>;

  getResponseBody(requestId: string): Promise<Uint8Array | null>;

  getResponseBodyByRef(bodyRef: string): Promise<Uint8Array | null>;

  waitForRequest(pageId: string, matcher: {
    urlIncludes?: string;
    method?: string;
    resourceType?: string;
    timeoutMs?: number;
  }): Promise<NetworkRecord | null>;

  captureSSE(pageId: string, config: {
    urlIncludes: string;
    parser: 'text-delta' | 'json-line' | 'raw';
  }): Promise<void>;

  listDownloads(pageId: string): Promise<DownloadRecord[]>;

  subscribe(pageId: string, config: {
    kinds: Array<NetworkEvent['kind']>;
    frameId?: string;
    urlIncludes?: string;
  }, listener: (event: NetworkEvent) => void | Promise<void>): Promise<() => void>;
}
```

说明：

- `getResponseBody()` 是能力描述，不规定内部必须通过 DevTools 协议实现
- 底层应允许多个 body provider 并存，并在同一 `NetworkRecord` / `bodyRef` 模型下统一输出
- `session.webRequest` 只解决元信息，不解决 body 本身
- body provider 的技术选型必须在 Phase 2 明确落地

### 7.5 Runtime API

```ts
export interface IBrowserRuntimeAPI {
  eval<T = unknown>(pageId: string, script: string): Promise<T>;

  query(pageId: string, selector: string): Promise<DomAnchor | null>;

  queryAll(pageId: string, selector: string): Promise<DomAnchor[]>;

  getText(pageId: string, selector?: string): Promise<string>;

  getHTML(pageId: string, selector?: string): Promise<string>;

  getSelection(pageId: string): Promise<SelectionState | null>;

  locateSections(pageId: string, headings: string[]): Promise<Array<{
    heading: string;
    anchor: DomAnchor;
  }>>;
}
```

### 7.6 Render API

```ts
export interface IBrowserRenderAPI {
  capturePage(pageId: string): Promise<Uint8Array>;

  captureRect(pageId: string, rect: Rect): Promise<Uint8Array>;

  captureRects(pageId: string, rects: Rect[]): Promise<Uint8Array[]>;

  captureFrame(pageId: string, frameId: string): Promise<Uint8Array | null>;

  exportSVG(pageId: string, selector: string): Promise<string | null>;
}
```

说明：

- `captureFrame()` 的语义是“尽可能获取 frame 的可视捕获结果”
- 对跨域 frame，不保证能直接进入其 DOM 结构做精细抽取
- `exportSVG()` 仅在当前权限允许访问相关上下文时成立

### 7.7 Interaction API

```ts
export interface IBrowserInteractionAPI {
  click(pageId: string, target: {
    selector?: string;
    anchorId?: string;
    rect?: Rect;
  }): Promise<void>;

  rightClick(pageId: string, target: {
    selector?: string;
    anchorId?: string;
    rect?: Rect;
  }): Promise<void>;

  type(pageId: string, selector: string, text: string): Promise<void>;

  press(pageId: string, key: string): Promise<void>;

  scrollTo(pageId: string, y: number): Promise<void>;

  scrollBy(pageId: string, dy: number): Promise<void>;

  hover(pageId: string, selector: string): Promise<void>;

  waitFor(pageId: string, condition: {
    selector?: string;
    textIncludes?: string;
    urlIncludes?: string;
    timeoutMs?: number;
  }): Promise<boolean>;
}
```

### 7.8 Artifact API

```ts
export interface IBrowserArtifactAPI {
  probe(pageId: string, scope?: {
    selection?: SelectionState;
    headings?: string[];
    rects?: Rect[];
  }): Promise<ArtifactRecord[]>;

  downloadAttachment(pageId: string, artifactId: string): Promise<DownloadRecord | null>;

  captureVisualArtifact(pageId: string, artifactId: string): Promise<ArtifactRecord | null>;

  resolveArtifactsForSections(pageId: string, sections: Array<{
    heading: string;
    anchor?: DomAnchor;
  }>): Promise<ArtifactRecord[]>;
}
```

说明：

- `ArtifactRecord` 是通用输出模型
- 但 `probe()` 不应被误解为“完全不依赖 adapter 的纯底层识别器”
- 更准确的职责划分应是：
  - 底层提供通用 artifact surface、frame/download/render/runtime 能力
  - adapter 基于这些能力解释站点语义
  - 最终统一输出 `ArtifactRecord`

### 7.9 Persistence API

```ts
export interface IBrowserPersistenceAPI {
  writeCaptureTrace(input: {
    pageId: string;
    stage: string;
    payload: unknown;
  }): Promise<string>;

  putMedia(input: {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ storageRef: string }>;

  appendToNote(input: {
    noteId: string;
    content:
      | { kind: 'markdown'; markdown: string }
      | { kind: 'structured'; blocks: unknown[] };
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
```

---

## 八、对 Module 5 的支持方式

### 8.1 Module 5 不应该直接碰站点细节

Gemma4 / Orchestrator 不应该自己理解：

- 哪个 selector 是 Claude 输入框
- 哪个 iframe 是 widget
- 哪个按钮才是真正 Download

这些应由 Browser Capability Layer + adapter 提供。

### 8.2 给 Module 5 的能力应是高阶接口

例如：

```ts
export interface IModule5BrowserTools {
  open(url: string): Promise<void>;
  askAI(input: { service: 'claude' | 'chatgpt' | 'gemini'; prompt: string }): Promise<string>;
  extractCurrentPage(): Promise<BrowserCaptureResult>;
  downloadCurrentArtifact(): Promise<ArtifactRecord | null>;
  captureVisibleRegion(): Promise<{ storageRef: string }>;
}
```

Module 5 看到的是工具，而不是具体网页脚本。

### 8.3 Module 5 需要资源管理，而不是裸 pageId

Module 5 在多实例编排下，不应该直接拿一个 `pageId` 当成永久句柄使用。

更稳的模式应当是：

- 先申请 `PageResourceLease`
- 在 lease 生命周期内操作页面
- 任务完成或超时后释放

这样可以避免：

- 隐藏页面泄漏
- 后台 window 无上限增长
- 同一页面被多个任务抢占
- 用户页面和 agent 页面状态混淆

建议 Module 5 内部状态也按 lease 组织，而不是按 pageId 裸组织。

---

## 九、对现有问题的落地意义

### 9.1 为什么 AI 页面只能作为验证样本，而不是架构中心

Claude / ChatGPT / Gemini 只能作为验证样本，因为它们同时覆盖了：

- 网络正文
- 附件下载
- iframe/widget
- 动态渲染
- 流式响应

但它们不能反向定义 Browser Capability Layer 的数据模型、缓存格式与接口边界。

真正的架构中心应当是：

- 通用网页对象
- 通用交互能力
- 通用落库能力

### 9.2 Claude artifact 问题如何被重新归类

目前这类问题可以被拆为：

1. 正文提取问题  
应该走 network / API 层。

2. Download card 问题  
应该走 download 层。

3. isolated-segment iframe 问题  
应该走 frame / render 层。

4. DOM 锚点问题  
只负责“用户点了哪一段”，不负责承载真实数据。

### 9.3 为什么当前截图方案不是优选

因为它：

- 对滚动状态敏感
- 对标题区间计算敏感
- 拿到的是视觉结果，不是结构化 artifact
- 很难保证和页面逻辑一一对应

它应该保留，但只能是 fallback。

---

## 十、第一阶段实施建议

### Phase 1：能力收口

目标：把现在零散的能力统一收口。

交付：

- `IBrowserCapabilityLayer` 顶层接口
- `network / runtime / render / interaction / persistence` 五个 API 雏形
- 调试 trace 统一写盘

### Phase 2：通用网页对象模型落地

目标：先建立对任意网页成立的结构化对象模型与缓存模型。

交付：

- 通用 `ArtifactRecord` 页面级缓存
- 通用 `DownloadRecord` 页面级缓存
- 通用 `DomAnchor` / `FrameState` 页面级缓存
- Response body provider 抽象，避免绑定单一协议实现
- DOM 只做定位与结构辅助

### Phase 3：多类型网页验证

目标：在不同类型页面上验证同一套底层能力。

验证样本：

- 普通内容网页
- 表单/后台网页
- 含 iframe/widget 网页
- Claude / ChatGPT / Gemini 作为高复杂度样本

交付：

- 通用网页提取
- 通用附件下载
- 通用可视区截图
- Module 5 统一 browser tools
- adapter 仅作为增强层接入

---

## 十一、当前决策

### 决策 1

KRIG 不再把网页提取能力定义为“DOM 提取器”，而定义为“Browser Capability Layer”。

### 决策 2

正文、附件、iframe/widget、截图必须走不同层级，不再强行用一条链处理。

### 决策 3

下载型 artifact 一律先作为附件入 KRIG 内部存储，再由 Note 决定如何展示。

### 决策 4

站点适配是 Browser Capability Layer 之上的 adapter，不是底层能力的一部分。

### 决策 5

Module 5 只调用高层 browser tools，不直接接触网页 DOM 细节。

### 决策 6

底层能力模型必须首先服务于通用网页，而不是首先服务于某几个个性化页面。

### 决策 7

KRIG 的浏览器能力边界由 Electron 作为浏览器原型所允许的掌控能力定义，而不是由 Chrome DevTools / CDP 的现成接口定义。

---

## 十二、下一步建议

建议下一步直接落这四件事：

1. 在 `src/plugins/browser-capability/` 建立空目录与第一版接口文件  
2. 把现有 `web-bridge` 中的网络拦截、下载拦截、截图能力收口到新接口  
3. 先建立 response body provider 抽象，避免把 CDP 直接写进顶层架构  
4. 先用普通网页 + 复杂网页混合样本验证通用对象模型，而不是先围绕单站点做专用链

5. 同时补上两项底层基础设施：
   - Network Event Bus（流式订阅）
   - Page Lease Manager（多页面资源生命周期）

---

## 附录：一句话总结

**KRIG 需要的不是“提取网页内容”，而是“掌控浏览器中的数据、交互、渲染与落库过程”。**
