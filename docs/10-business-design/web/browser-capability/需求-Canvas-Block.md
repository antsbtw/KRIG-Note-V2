# 需求：NoteView Canvas Block

> 类型：功能增强  
> 创建日期：2026-04-21  
> 状态：已实现  
> 分支：`feature/noteview`  
> 前置：Stage 1 ChatGPT 提取验证

---

## 一、背景

ChatGPT Canvas 是一个交互式编辑器，支持代码和文档两种模式。提取 ChatGPT 对话时，Canvas 内容通过 `/textdocs` API 获取，包含：

| 字段 | 说明 | 示例 |
|------|------|------|
| `title` | Canvas 标题 | "React Counter Component" |
| `textdoc_type` | 内容类型 | `code/react`, `code/python`, `document` |
| `content` | 完整内容 | 代码或 Markdown 文本 |

当前处理方式：代码类型渲染为 fenced code block，文档类型渲染为 Markdown 段落。缺少 Canvas 特有的视觉呈现——标题栏、语言标注、折叠/展开等。

## 二、参考：Claude Artifact Block

Claude 的 Artifact 在 NoteView 中已有专门的 block 实现（HTML Block），提供：
- 标题栏 + 类型标签
- iframe 沙箱渲染（HTML/SVG 内容）
- 打开/折叠交互

Canvas Block 应该借鉴这个模式，但针对 ChatGPT Canvas 的特点做调整。

## 三、期望行为

### 3.1 代码类型 Canvas (`code/*`)

渲染为带标题栏的代码面板：

```
┌──────────────────────────────────────────────────┐
│ 📄 React Counter Component  JavaScript  Copy  Preview │
├──────────────────────────────────────────────────┤
│ import { useState } from "react";                │
│ import { Button } from "@/components...          │
│                                                  │
│ export default function CounterApp() {           │
│   const [count, setCount] = useState(0);         │
│   ...                                            │
└──────────────────────────────────────────────────┘
```

功能：
- 标题栏显示 Canvas 标题（📄 前缀）+ 语言类型标签
- 代码区域语法高亮（使用 NoteView 现有的代码高亮能力）
- **Copy 按钮**：复制代码到剪贴板
- **Preview 按钮**：弹出浮窗执行代码并显示运行结果（见 §3.3）

### 3.2 文档类型 Canvas (`document`)

渲染为带标题栏的文档面板：

```
┌─────────────────────────────────────────┐
│ 📄 项目需求文档              Document     │
├─────────────────────────────────────────┤
│ ## 项目概述                              │
│                                         │
│ 这是一个...                              │
│                                         │
│ ### 技术栈                               │
│ - React                                 │
│ - TypeScript                            │
└─────────────────────────────────────────┘
```

功能：
- 标题栏显示 Canvas 标题 + "Document" 标签
- 文档内容渲染为 Markdown（使用 NoteView 的渲染能力）

### 3.3 JavaScript Preview 浮窗

点击 Canvas 代码面板的 **Preview** 按钮，弹出居中模态浮窗执行代码：

```
┌─────────────────────────────────────┐
│ React Counter Component          ✕  │
├─────────────────────────────────────┤
│                                     │
│      ┌─────────────────────┐        │
│      │  React Counter      │        │
│      │  Count: 0           │        │
│      │  [−] [Reset] [＋]   │        │
│      └─────────────────────┘        │
│                                     │
└─────────────────────────────────────┘
```

执行策略：
- **纯 JS**（无 JSX 特征）：直接 eval，捕获 console 输出 + 返回值，暗色终端风格
- **React/JSX**（检测到 JSX 标签、hooks、React 引用）：
  - 注入 React 18 + ReactDOM + Babel Standalone + Tailwind CSS CDN
  - Babel 转译 JSX（`presets: ['react', ['env', { modules: 'commonjs' }]]`）
  - 第三方组件（`Button`、`Card` 等）自动降级为原生 HTML 元素（透传 props + children）
  - 查找 `export default` 或名为 `App` 的组件进行渲染

浮窗行为：
- Esc 键 / 点击 ✕ / 点击背景 → 关闭浮窗，回到代码编辑
- iframe `sandbox="allow-scripts allow-same-origin"`（支持 CDN 加载）
- iframe 高度自适应内容

## 四、技术方案

### 4.1 方案：复用 codeBlock + Code Plugin 体系

Canvas Block 不作为独立 block 类型实现，而是**扩展现有 codeBlock**：

1. **`title` 属性**：codeBlock NodeSpec 新增 `title` attr，有值时切换为 Canvas 模式
2. **Canvas 操作按钮组**：`title` 存在时，toolbar 右侧显示 `Copy` + `Preview`，隐藏普通 Copy 按钮和语言下拉
3. **Code Plugin 体系**：Preview 能力通过 `CodeLanguagePlugin` 接口注入，codeBlock 核心不知道任何语言的实现细节

```typescript
// CodeBlockContent 新增 title 字段
export interface CodeBlockContent {
  code: string;
  language: string;
  title?: string;      // 可选标题（如 ChatGPT Canvas 标题）
}
```

### 4.2 Code Plugin 接口

```typescript
export interface CodeLanguagePlugin {
  languages: string[];       // 匹配哪些语言标识
  hasPreview: boolean;       // 是否支持 Preview
  renderPreview?: (...) => void;    // inline 预览渲染
  schedulePreview?: (...) => void;  // 防抖预览
  openFullscreen?: (ctx) => void;   // 浮窗预览（JS Plugin 使用）
  activate?: (ctx) => void;
  deactivate?: (ctx) => void;
  destroy?: () => void;
}
```

Preview 按钮行为：
- 有 `openFullscreen` → 弹出浮窗（如 JS Plugin）
- 无 `openFullscreen` → inline toggle 预览区（如 HTML/Mermaid Plugin）

### 4.3 已注册的 Code Plugin

| Plugin | 语言 | Preview 方式 | 文件 |
|--------|------|-------------|------|
| `mermaidPlugin` | mermaid | inline SVG 渲染 + 全屏编辑器 | `code-plugins/mermaid-plugin.ts` |
| `htmlPlugin` | html, svg | inline iframe 沙箱 | `code-plugins/html-plugin.ts` |
| `markdownPlugin` | markdown | inline Markdown 渲染 | `code-plugins/markdown-plugin.ts` |
| `jsPlugin` | javascript, typescript, jsx, tsx | **浮窗 iframe 沙箱** | `code-plugins/js-plugin.ts` |

### 4.4 JS Plugin 实现细节

**第三方组件降级机制**：

1. 解析 import 语句，提取被导入的标识符名称（`Button`、`Card` 等）
2. 为每个标识符生成降级组件——根据名称推断原生标签（`Button` → `<button>`，`Card` → `<div>`）
3. 降级组件透传所有 props（`className`、`onClick` 等）和 children
4. 注入到 Function 参数，代码中引用 `Button` 时实际调用降级组件

**CDN 依赖**：

| 库 | CDN |
|----|-----|
| React 18 | `unpkg.com/react@18/umd/react.production.min.js` |
| ReactDOM 18 | `unpkg.com/react-dom@18/umd/react-dom.production.min.js` |
| Babel Standalone | `unpkg.com/@babel/standalone@7/babel.min.js` |
| Tailwind CSS | `cdn.tailwindcss.com` |

### 4.5 Markdown 语法

复用 fenced code block + `title="..."` 属性：

```markdown
```javascript title="React Counter Component"
import { useState } from "react";
...
```
```

result-parser 解析 `title="..."` 后传递给 codeBlock atom。

### 4.6 ProseMirror Node

现有 codeBlock 的 attrs 新增 `title`：

```typescript
codeBlock: {
  attrs: {
    language: { default: '' },
    title: { default: '' },     // ← 新增
  },
}
```

### 4.7 影响范围

| 模块 | 改动 |
|------|------|
| `src/shared/types/atom-types.ts` | `CodeBlockContent` 新增 `title?: string` |
| `src/shared/types/extraction-types.ts` | `ExtractedBlock` 新增 `codeTitle?: string` |
| `src/plugins/note/blocks/code-block.ts` | nodeSpec attrs 加 `title`；Canvas 按钮组（Copy + Preview）；Preview 按钮根据 plugin 走浮窗或 inline |
| `src/plugins/note/blocks/code-plugins/js-plugin.ts` | **新增**：JS/JSX Preview 浮窗，React + Babel + Tailwind 沙箱执行 |
| `src/plugins/note/blocks/code-plugins/index.ts` | 注册 `jsPlugin` |
| `src/plugins/note/converters/render-block-converters.ts` | codeBlockConverter round-trip `title` |
| `src/plugins/web-bridge/pipeline/result-parser.ts` | `collectCodeBlock` 解析 `title="..."` |
| `src/plugins/web-bridge/pipeline/content-to-atoms.ts` | 传递 `codeTitle` → `title` |
| `src/plugins/browser-capability/artifact/chatgpt-extract-turn.ts` | Canvas 输出 ``` + `title="..."` |
| `src/plugins/note/note.css` | Canvas 按钮组样式 + JS Preview 浮窗样式（`.js-preview-*`） |

## 五、验收标准

| # | 标准 |
|---|------|
| 1 | 代码类型 Canvas 渲染为带标题栏（📄 Title + 语言标签）+ 语法高亮的代码面板 |
| 2 | 文档类型 Canvas 渲染为带标题栏的 Markdown 文档面板 |
| 3 | Canvas 标题栏右侧显示 Copy + Preview 按钮（隐藏普通 Copy 和语言下拉） |
| 4 | Copy 按钮复制代码到剪贴板，显示 "✓ Copied" 反馈 |
| 5 | JS/JSX/TS/TSX 的 Preview 按钮弹出居中浮窗，iframe 沙箱执行代码 |
| 6 | React 组件正常渲染（含 Tailwind CSS 样式），第三方组件自动降级 |
| 7 | 浮窗支持 Esc / ✕ / 点击背景关闭 |
| 8 | 纯 JS 代码执行结果以 console 输出形式展示 |
| 9 | ChatGPT 提取的 Canvas 内容正确渲染为 Canvas Block |
| 10 | 不影响现有 codeBlock（无 title 时行为完全不变） |
| 11 | 不影响 Mermaid / HTML / Markdown 等已有 Plugin 的 Preview 行为 |
| 12 | Claude Artifact（HTML Block）行为不变 |
