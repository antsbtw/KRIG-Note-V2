# Artifact Import 设计：从 Browser Capability 到 Note

> 文档类型：设计文档  
> 创建日期：2026-04-18 | 版本：v0.1  
> 前置文档：`KRIG-Browser-Capability-Layer-设计.md`、`Defuddle-vs-Browser-Capability-对比分析.md`

---

## 一、问题定义

### 1.1 现有链路的瓶颈

当前 AI 对话内容导入 Note 的链路（`AIWebView.tsx` → `extractTurnAt()`）存在以下问题：

| 问题 | 原因 |
|------|------|
| 长对话中 artifact 缺失 | 一次只提取单条消息（右键点击定位），不知道整个对话有多少 artifact |
| artifact 下载靠 DOM 模拟 | iframe 型靠 SVG 导出，card 型靠模拟点击下载按钮，依赖 DOM 结构和滚动位置 |
| Claude UI 改版即失效 | 选择器、按钮文案、iframe 结构变化就需要修代码 |
| 占位符匹配脆弱 | markdown 中的 artifact 占位符和 DOM 中的 iframe/card 靠顺序匹配，跳过一个就全错位 |
| 不支持整页提取 | 只能逐条消息提取，不能一次导入整个对话 |

### 1.2 Browser Capability 已经解决的

经过 Phase 1-5 的实现，Browser Capability Layer 现在能够：

- **准确识别**页面中的全部 artifact（9/9，通过 conversation API 提取）
- **精确定位**每个 artifact 在对话中的位置（messageUuid + messageIndex + toolUseId）
- **获取源码**：`widget_code`（HTML/SVG）和 `file_text`（文件内容）直接在 API 响应中
- **追踪下载**：已下载的 artifact 有 storageRef 路径
- **关联 frame**：每个 widget artifact 对应哪个 iframe

### 1.3 需要建立的连接

```
已有                                    缺失                          已有
┌─────────────────┐              ┌──────────────┐              ┌──────────────┐
│ Browser          │              │ Artifact      │              │ Note 编辑器   │
│ Capability       │  ──────────→ │ Import        │ ──────────→  │              │
│ artifacts.json   │              │ Pipeline      │              │ as:append-turn│
│ conversation.json│              │              │              │ → Atoms → PM  │
└─────────────────┘              └──────────────┘              └──────────────┘
```

---

## 二、设计目标

### 2.1 两种导入模式

| 模式 | 触发方式 | 范围 | 说明 |
|------|---------|------|------|
| **单条提取** | 右键菜单 → "提取到笔记" | 单条 assistant 消息 | 替代现有 `extractTurnAt` 的 artifact 获取部分 |
| **整页提取** | 工具栏按钮或菜单 | 整个对话的所有消息 | 新功能，将完整对话导入为一篇 Note |

### 2.2 核心原则

1. **Artifact 数据从 conversation API 获取，不从 DOM 获取**  
   widget_code / file_text 已在 API 响应中，不需要模拟点击或 iframe 导出。

2. **复用 Note 导入后半段**  
   生成 markdown → `as:append-turn` → Note 编辑器。不重建导入管线。

3. **Browser Capability 提供数据，不提供 UI**  
   artifact 识别、元数据、源码获取由 browser-capability 负责。  
   UI 交互（菜单、进度、错误提示）仍由 AIWebView 负责。

4. **渐进替代，不一次性替换**  
   新链路和旧链路可共存。新链路先用于 Claude，ChatGPT/Gemini 仍走旧链路。

---

## 三、数据流设计

### 3.1 单条提取（右键菜单）

```
用户右键点击 assistant 消息
  ↓
resolveMsgIndex() → msgIndex         [不变，仍用 DOM 定位点击位置]
  ↓
查询 browser-capability artifact 数据  [新增]
  ├─ getArtifacts(pageId) → 全量 artifact 列表
  ├─ 按 messageIndex 过滤出当前消息的 artifact
  └─ 每个 artifact 有 title, kind, toolUseId, widget_code/file_text
  ↓
从 conversation API 数据生成 markdown   [替代现有的 extractClaudeConversation 部分逻辑]
  ├─ assistant 消息的 text content → markdown 正文
  ├─ tool_use(show_widget) → 内联 artifact
  │   ├─ SVG widget_code → 导出为图片 → ![title](data:image/svg+xml;...)
  │   └─ HTML widget_code → 保存为附件 → [title](attachment:ref)
  ├─ tool_use(create_file) → 代码块或附件
  └─ tool_use(view/present_files) → 引用标记
  ↓
sendToOtherSlot("ai-sync", "as:append-turn")  [不变]
  ↓
Note 编辑器接收并渲染                          [不变]
```

### 3.2 整页提取（新功能）

```
用户点击"整页提取"按钮
  ↓
查询 browser-capability 数据
  ├─ conversation.json → 完整对话
  ├─ artifacts.json → 全部 artifact
  └─ downloads.json → 已下载文件
  ↓
按消息顺序生成 markdown
  for each message in chat_messages:
    ├─ human message → callout block (❓)
    └─ assistant message →
        ├─ text content → markdown
        ├─ show_widget artifact → 图片/附件
        ├─ create_file artifact → 代码块/附件
        └─ 分隔线 (---)
  ↓
sendToOtherSlot("ai-sync", "as:import-conversation")  [新 action]
  ↓
Note 编辑器接收，创建完整文档
  ├─ 标题：对话名称
  ├─ 元数据：来源、时间、模型
  └─ 内容：逐 turn 插入
```

---

## 四、Artifact 素材获取策略

### 4.1 不同类型 artifact 的获取方式

| artifact kind | 数据来源 | 获取方式 | 输出格式 |
|--------------|---------|---------|---------|
| show_widget (SVG) | `widget_code` 含 `<svg` | 直接从 API 响应取 | 保存为 .svg → 图片块 |
| show_widget (HTML) | `widget_code` 含 `<div`/`<style` | 直接从 API 响应取 | 保存为 .html 附件 + 截图预览 |
| create_file | `file_text` + `path` | 直接从 API 响应取 | 按文件类型：代码块 / 附件 |
| view | `path` | 仅记录引用 | 文本引用标记 |
| present_files | `filepaths` | 仅记录引用 | 文件列表标记 |
| 已下载的 artifact | `storageRef` | 从本地临时文件读取 | 入 media store → 内部引用 |

### 4.2 SVG widget 的处理

SVG 是最常见的 widget 类型（本次测试 9 个 artifact 中 6 个是 SVG）。处理方式：

```
widget_code 含 <svg
  → 提取 SVG 字符串
  → 写入 media store（.svg 文件）
  → 在 Note 中作为图片块引用
```

不需要 iframe 渲染、不需要截图、不需要 DOM 操作。

### 4.3 HTML widget 的处理

HTML widget（交互式图表等）无法直接嵌入 Note。策略：

```
widget_code 是 HTML
  → 保存为 .html 附件 → media store
  → 可选：用 offscreen webContents 渲染一次 → 截图作为预览
  → 在 Note 中：附件块 + 预览图
```

### 4.4 已下载文件的处理

部分 artifact 在用户操作时已被下载（storageRef 不为空）：

```
storageRef 存在
  → 读取本地文件
  → 入 media store
  → 在 Note 中作为附件块或图片块
```

---

## 五、接口设计

### 5.1 Browser Capability 侧：Artifact Query API

在现有 `trace-writer` 基础上暴露查询接口（已部分实现）：

```ts
// 已有
getArtifacts(pageId: string): ArtifactRecord[]
getArtifactCandidates(pageId: string): ArtifactRecord[]

// 需新增
getConversationData(pageId: string): ClaudeConversationData | null
getArtifactContent(pageId: string, artifactId: string): ArtifactContent | null
```

```ts
type ClaudeConversationData = {
  uuid: string;
  name: string;
  model?: string;
  currentLeafMessageUuid?: string;
  messages: ClaudeMessage[];
};

type ClaudeMessage = {
  uuid: string;
  sender: 'human' | 'assistant';
  index: number;
  textContent: string;                    // 纯文本/markdown 部分
  artifacts: MessageArtifact[];           // 该消息中的 artifact
};

type MessageArtifact = {
  artifactId: string;
  toolUseId: string;
  toolName: string;                       // show_widget / create_file / view / ...
  title: string;
  kind: ArtifactRecord['kind'];
  content: ArtifactContent | null;        // widget_code / file_text / null
};

type ArtifactContent =
  | { type: 'widget_code'; code: string; mimeType: string }   // SVG 或 HTML
  | { type: 'file_text'; text: string; path: string }         // create_file 的内容
  | { type: 'downloaded'; storageRef: string; mimeType?: string; byteLength?: number };
```

### 5.2 AIWebView 侧：新的提取入口

```ts
// 单条提取（替代现有 artifact 下载逻辑）
async function extractTurnViaCapability(
  pageId: string,
  msgIndex: number,
): Promise<{ userMessage: string; markdown: string } | null>

// 整页提取（新功能）
async function extractFullConversation(
  pageId: string,
): Promise<{ title: string; turns: TurnData[] } | null>

type TurnData = {
  index: number;
  userMessage: string;
  markdown: string;          // 含 artifact 内联引用
  timestamp?: string;
};
```

### 5.3 Note 接收侧

单条提取复用现有 `as:append-turn`。

整页提取新增 `as:import-conversation`：

```ts
// 新 action
{
  protocol: 'ai-sync',
  action: 'as:import-conversation',
  payload: {
    title: string;
    turns: TurnData[];
    source: { serviceId: string; serviceName: string; url: string };
    metadata: { model?: string; createdAt?: string };
  }
}
```

---

## 六、与现有链路的关系

### 6.1 实施顺序

```
Phase A：数据验证 ✅ 已完成
  - browser-capability 识别 artifact → artifacts.json 落盘
  - 人工验证识别准确性（9/9 artifact 全部识别到）

Phase D：旧链路清理 ✅ 已完成
  - 移除 processClaudeArtifactsFull（340行 DOM 模拟下载逻辑）
  - 移除 AIWebView 中 iframe/card artifact 下载代码和死函数
  - processClaudeArtifactsLive 保留用于 fallback

Phase B：单条提取 ✅ 已完成已测试
  - 右键菜单 → browserCapabilityExtractTurn → Note
  - conversation-query.ts 提取结构化对话数据
  - extract-turn.ts 生成 markdown（SVG/HTML/代码块）
  - DOM assistant-only 索引正确映射到 conversation 消息

Phase C：整页提取 ✅ 已完成已测试
  - "提取整页对话" 按钮 → extractFullConversation → Note
  - as:import-conversation 逐 turn 插入（callout + toggle）

Phase B+: bash_tool local_resource ✅ 已完成
  - 从 tool_result 识别 local_resource
  - present_files 关联 local_resource 文件
  - Claude wiggle API 主动下载 sandbox 文件
  - 按类型分流：SVG → image block，HTML → html-block，其他 → 代码块
```

### 6.2 哪些代码不变

| 模块 | 状态 |
|------|------|
| `resolveMsgIndex()` | 不变，仍用 DOM 定位用户点击 |
| `ResultParser.parse()` | 不变，markdown → ExtractedBlock[] |
| `createAtomsFromExtracted()` | 不变，ExtractedBlock[] → Atom[] |
| `converterRegistry.atomsToDoc()` | 不变，Atom[] → ProseMirror |
| `sync-note-receiver.ts` | 扩展支持 `as:import-conversation` |
| IPC `AI_PARSE_MARKDOWN` | 不变 |

### 6.3 哪些代码被替代

| 模块 | 替代方式 |
|------|---------|
| `extractClaudeConversation()` 中的 artifact 下载逻辑 | 从 browser-capability 获取 widget_code |
| `downloadClaudeArtifact()` | 不再需要（SVG/HTML 源码已有） |
| `claude-artifact-download/card-path.ts` | 退役 |
| `claude-artifact-download/iframe-path.ts` | 退役 |
| `processClaudeArtifactsFull()` 的占位符替换 | 用 artifact 元数据精确替换 |

---

## 七、实施任务

### Phase D：旧链路清理（先做）

| # | 任务 | 说明 |
|---|------|------|
| D.1 | 移除 `claude-artifact-download/card-path.ts` | DOM 模拟点击下载，已被 API 数据替代 |
| D.2 | 移除 `claude-artifact-download/iframe-path.ts` | iframe SVG 导出，已被 widget_code 替代 |
| D.3 | 移除 `processClaudeArtifactsFull()` | 占位符顺序替换逻辑，已被精确匹配替代 |
| D.4 | 简化 `extractTurnAt()` 中的 Claude artifact 处理 | 移除 CDP 拦截、模拟下载、占位符替换，保留消息定位和 markdown 生成壳 |
| D.5 | 清理 `claude-ui-constants.ts` 中不再使用的选择器 | 移除与 DOM 模拟下载相关的常量 |
| D.6 | 验证清理后现有功能不报错 | 右键菜单仍可触发，只是 artifact 暂时不下载 |

### Phase B：单条提取（新链路）

| # | 任务 | 说明 |
|---|------|------|
| B.1 | 实现 `getConversationData()` | 从 trace-writer 内存/文件中提取结构化对话数据 |
| B.2 | 实现 `getArtifactContent()` | 从 conversation JSON 中提取 widget_code / file_text |
| B.3 | 实现 SVG artifact → media store | SVG widget_code → .svg 文件 → 内部引用 |
| B.4 | 实现 HTML artifact → 附件 | HTML widget_code → .html 附件 |
| B.5 | 实现 `extractTurnViaCapability()` | 整合 B.1-B.4，生成单条消息的 markdown |
| B.6 | AIWebView 右键菜单接入新链路 | extractTurnAt() 调用 B.5 |
| B.7 | 验证：长对话多 artifact 提取 | 确认 artifact 完整性和内容正确性 |

### Phase C：整页提取（新功能）

| # | 任务 | 说明 |
|---|------|------|
| C.1 | 实现 `extractFullConversation()` | 遍历全部消息，生成 turns 数组 |
| C.2 | 实现 `as:import-conversation` 处理 | Note 接收侧支持整页导入 |
| C.3 | UI 入口：整页提取按钮 | AIWebView 工具栏或菜单 |
| C.4 | 验证：完整对话导入 | 验证长对话、多 artifact、混合类型 |

### Phase E：SVG Block（Note 渲染增强）

#### 问题

当前 SVG artifact 通过 `<img>` 标签渲染，存在本质局限：

| `<img>` 渲染 SVG 的局限 | 影响 |
|------------------------|------|
| CSS 变量/外部样式不可用 | SVG 中 `var(--color-*)` 全部失效，需要预处理替换 |
| 无法交互 | hover、点击节点等原生 SVG 交互丢失 |
| 分辨率受容器宽度限制 | 大图缩小后细节模糊 |
| 中文字体 fallback | SVG 指定的字体在 `<img>` 隔离上下文中不可用，字距偏差 |
| 无法导出/复制源码 | 用户无法获取原始 SVG |

当前 `prepareSvgForImgTag()` 通过预处理（替换 CSS 变量、注入 `<style>` 和白背景）部分缓解了问题，但这是治标不治本的方案。

#### 方案：SVG 独立 Block

在 Note 编辑器中新增 `svg-block`（类似 `image-block`），使用 `<div>` 容器 + `innerHTML` 直接渲染 SVG DOM，而非 `<img>` 标签：

```
image-block:  <img src="media://xxx.svg">     ← 隔离上下文，CSS/交互不可用
svg-block:    <div class="svg-block">          ← 完整 DOM 上下文
                <div class="svg-block__canvas">
                  {SVG DOM 直接插入}
                </div>
                <div class="svg-block__toolbar">
                  [缩放] [导出 PNG] [查看源码]
                </div>
              </div>
```

#### SVG Block 的能力

| 能力 | 说明 |
|------|------|
| 完整 CSS 支持 | 可注入 Claude 主题变量或自定义样式表 |
| 主题适配 | Note 暗色/亮色主题切换时，SVG 跟随变化 |
| 交互保留 | hover 高亮、点击节点跳转、tooltip |
| 缩放 | pinch-zoom 或按钮缩放，不损失清晰度（矢量） |
| 导出 | 导出为 PNG/SVG 文件 |
| 源码查看 | 开发者可查看/复制原始 SVG |
| 自适应宽度 | 根据容器宽度自动缩放 viewBox |

#### Schema 设计

```ts
// ProseMirror node spec
svgBlock: {
  attrs: {
    src: { default: null },          // media:// URL（SVG 文件）
    svgContent: { default: null },   // 内联 SVG 源码（优先于 src）
    alt: { default: null },
    caption: { default: null },
    width: { default: null },
    height: { default: null },
    viewBox: { default: null },
    theme: { default: 'light' },     // 'light' | 'dark' | 'auto'
  },
  group: 'block',
  draggable: true,
}
```

#### 与 Artifact 提取的关系

当 `extract-turn.ts` 遇到 SVG artifact 时：

```
当前: widget_code → prepareSvgForImgTag() → media store → ![alt](media://xxx.svg) → image-block
未来: widget_code → media store + svgContent → svg-block atom → svg-block 渲染
```

`svg-block` 同时保存 `src`（media store 持久化）和 `svgContent`（渲染用），确保离线可用。

#### 实施任务

| # | 任务 | 说明 |
|---|------|------|
| E.1 | 定义 `svg-block` schema | ProseMirror node spec + attrs |
| E.2 | 实现 `svg-block` NodeView | DOM 渲染 + 样式注入 + 主题适配 |
| E.3 | 实现缩放/导出工具栏 | zoom + export PNG + view source |
| E.4 | `extract-turn` 输出 svg-block atom | 替代当前的 image-block 输出 |
| E.5 | Atom 序列化/反序列化 | svg-block ↔ Atom ↔ JSON 双向转换 |
| E.6 | 验证：多种 SVG 类型渲染 | 流程图/数据图/思维导图/代码图 |

#### 优先级

Phase E 在 Phase B/C 之后，因为：
- 当前 `<img>` + `prepareSvgForImgTag()` 已经可用（基本可读）
- SVG block 需要 Note 编辑器层面的改动，工作量较大
- 可以和其他 Note block 增强（video-block 等）一起推进

---

## 八、风险与约束

| 风险 | 应对 |
|------|------|
| conversation API 结构变化 | API 是 Claude 官方接口，比 DOM 结构稳定得多；且 trace-writer 已有容错 |
| widget_code 不包含外部资源 | 大部分 widget 是自包含的；如果引用外部 CDN 资源，需要额外处理 |
| 非 Claude 页面无 conversation API | Phase B 保留 fallback 到旧链路；Phase C 仅面向有 conversation 数据的页面 |
| SVG 在 Note 中渲染 | 当前用 `<img>` + 预处理可用但有局限；Phase E 规划了 svg-block 独立渲染方案 |
| 大对话导入性能 | 整页提取可能产生大量 atoms，需要测试 ProseMirror 的渲染性能 |

---

## 九、一句话总结

**用 Browser Capability 已识别的 artifact 元数据和 conversation API 中的 widget_code / file_text 替代 DOM 模拟下载，从根本上解决长对话多 artifact 提取不完整的问题，并在此基础上新增整页提取能力。**
