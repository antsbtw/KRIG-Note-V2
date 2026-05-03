# Paste Module 设计与专题路线

> 创建：2026-04-13
> 状态：骨架完成（dispatcher + generic handler），各 source 专题待讨论。

---

## 一、背景

KRIG Note 要让用户从**任意来源**粘贴内容都得到合理的 block 结构：
Word 的表格要是表格、AI 对话的 LaTeX 要渲染、Wikipedia 的段落不要
炸成 one-`<a>`-per-line。

但每种来源的剪贴板内容（text/plain、text/html、mso-* 样式、自定义 span
class、等等）都是历史演化出来的一团专有格式，用一套通用转换器处理注定
会在某些 source 上失真。本模块的思路是**按 source 拆**：一个 dispatcher
+ 多个 per-source handler，一个一个 source 专题攻关。

---

## 二、最终形态

```
用户 Cmd+V
    │
    ▼
smart-paste-plugin.handlePaste (ProseMirror plugin)
    │
    │  1) 读 clipboardData → {plain, html, hasImage}
    │  2) Shift 按下？→ plainText branch（独立）
    │
    ▼
dispatcher: 按注册顺序试 HANDLERS
    ├─ wordHandler.detect(cb)    → word-specific table/callout 映射
    ├─ notionHandler.detect(cb)  → notion callout/column/toggle 映射
    ├─ excelHandler.detect(cb)   → excel cell 保留数字/公式
    ├─ wikiHandler.detect(cb)    → wiki 去掉 anchor 噪音
    ├─ aiCodeHandler.detect(cb)  → AI assistants 特殊情况
    └─ genericHandler.detect(cb) ← 永远 true，兜底
    │
    ▼ （首个 detect=true）
handler.toMarkdown(cb) → {markdown, via}
    │
    ▼
viewAPI.markdownToPMNodes(md) → md-to-pm → ProseMirror JSON
    │
    ▼
replaceSelection(Slice(Fragment.from(nodes)))
```

每个 handler 负责：
- **detect**：看 HTML 头是否有 source 签名（`mso-*` / `notion-*` /
  `data-katex-mathml` / CSS class 规则）
- **toMarkdown**：把 clipboard 当前这个 source 的内容**准确翻译**到
  Markdown。允许利用 source 的元信息（如 Word 的 callout-like
  `<div>` → `> [!callout]`，Notion 的 column 布局 → 两列 `columnList`
  语法）

---

## 三、已完成

| Item | 状态 |
|---|---|
| Dispatcher + Shift 分支 | ✅ `smart-paste-plugin.ts` |
| 接口定义（`PasteHandler`） | ✅ `types.ts` |
| `genericHandler`（兜底） | ✅ `sources/generic.ts` |
| 通用 `htmlToMarkdown`（Wiki-safe 表格 / 标题 / 代码 / KaTeX annotation） | ✅ `html-to-markdown.ts` |
| `paste-media` 与 dispatcher 互让：图像 + 结构 HTML 共存时让表格赢 | ✅ `plugins/paste-media.ts` |

---

## 四、专题清单（每项是一次独立 PR / 调试）

按预期收益大小列：

### 4.1 Word（MS Word / Office 365 for Word）

**特征签名**：
- HTML 含 `xmlns:w="urn:schemas-microsoft-com:office:word"`
- 大量 `mso-*` CSS 属性
- `<td>` 带 inline `width` / `style="background:..."`

**期望**：
- 表格 → Markdown table（行列准确，表头识别）
- "核心价值"类带背景色的 `<div>` → KRIG `calloutBlock` 或 blockquote
- 合并单元格（colspan / rowspan） → 最大努力拆分，或标注
- inline 文本的粗体/斜体 → `**` / `*` marks
- 单元格 padding / 行高 → CSS 承担（modified `.pm-table` rules）

**已知坑**：
- Word 经常同时塞一张 PNG 截图。`paste-media` 已处理这条路径。
- Windows Word 的 HTML head 有不规范的嵌套 `<div>`，需要容错 parse。

### 4.2 Excel

**特征**：
- `xmlns:x="urn:schemas-microsoft-com:office:excel"`
- 每个 `<td>` 可能带 `x:num` / `x:fmla`（公式）/ `style="mso-number-format:..."`

**期望**：
- 表格 → Markdown table
- 公式：作为原始公式文字保留（或放 `<!-- formula: =SUM(...) -->` 注释）
- 数字格式化（千分位 / 百分比）→ 输出时保留显示值，原值可放注释

### 4.3 Notion

**特征**：
- HTML 含 `data-block-id` / `notion-*` class
- Column 布局：`<div class="notion-column">` 嵌套
- Callout: 带 emoji 图标 + 背景色的 `<div>`
- Toggle list: `<details><summary>`
- 代码块：`<pre><code class="language-xxx">`

**期望**：
- Column → KRIG `columnList` / `column`
- Callout → `calloutBlock` 带 emoji
- Toggle → `toggleList`
- 代码块 → fenced code with language

### 4.4 Wikipedia / 一般博客

**特征**：
- `text/html` 大量 `<a>` 包裹术语
- `text/plain` 是扁平化文字，没任何 markdown 标记

**期望**：
- 纯段落，不要被 `<a>` 炸成每链接一个 block
- 粗体 / 斜体 可选保留（第二优先级）
- 外链可选保留为 `[text](url)`（当前 generic 丢失了，因 Wiki HTML
  里 anchor 太密被我们划成"不结构化"而忽略）

**策略讨论**：
- wikiHandler 可以做精细识别：段落内的 `<a>` → 保留为 link marks（
  不破坏 paragraph），表格 → generic 表格处理，参考文献区 `<ol>` →
  ordered list。

### 4.5 AI Assistants（Claude / ChatGPT / Gemini 直接复制的 HTML）

**特征**：
- Claude: `<span class="katex">`, fenced code 带 language
- ChatGPT: markdown 已经完好保留在 text/plain（大多数场景）
- Gemini: KaTeX + 代码块 + 表格齐全

**期望**：
- 默认走 generic（text/plain 就是好 markdown）
- 如果 text/plain 丢失（某些截取情况）→ HTML 路径用 KaTeX
  annotation 恢复 LaTeX（html-to-markdown 已有此能力）

### 4.6 VS Code / 代码编辑器

**特征**：
- HTML 带 `<span style="color: ...">` 语法高亮
- text/plain 就是纯代码

**期望**：
- 永远走 text/plain 直接生成 fenced code block
- 语言探测：通过源 class 或启发式（第一行 `#!/bin/bash` 等）

---

## 五、当前"generic" 的行为清单

`genericHandler` 做什么 / 不做什么：

**做**：
- 有 `<table>` / `<h1-6>` → 通过 `htmlToMarkdown` 产出 Markdown 表格 /
  标题
- 其他 → 用 `text/plain`（如果是 Markdown 格式就自动渲染，否则做成
  一个段落）

**不做**：
- Wikipedia 的"一段话全是链接" → HTML 被忽略，链接丢失但版面干净
- Word 的 callout-like `<div>` 带背景色 → 识别不到，变成普通段落
- Excel 公式 → 识别不到，只拿计算结果显示值
- Notion 的 column 布局 → 识别不到，扁平化

这些都是**预期的**：generic 只做"安全但保守"的翻译，精细度交给各专题
handler。

---

## 六、开发流程约定

做一个 source handler 的步骤（以 Word 为例）：

1. **收集样本**：从该 source 复制 3-5 种典型内容（纯文字 / 表格 /
   列表 / 带图 / callout 等），把 clipboard 的 text/html 保存下来
   作为回归测试语料。

2. **写 detect**：找最稳定的签名。Word 是 `mso-*` 或 `xmlns:w=...`；
   Notion 是 `data-block-id`。宁严勿滥——detect 误中比漏检更坏，
   因为会吞掉本该交给 generic 的内容。

3. **写 toMarkdown**：在 handler 文件里实现。可以调用通用
   `htmlToMarkdown` 做基础工作，然后在前后加 source-specific 的
   pre-processing（去除 mso 属性 / 解析 callout div / 等）或
   post-processing（LaTeX 归一化 / 公式从注释恢复 / 等）。

4. **注册**：在 `smart-paste-plugin.ts` 的 `HANDLERS` 数组里
   `unshift(wordHandler)`（放在 generic 之前）。

5. **设计文档更新**：把这个 source 的专题标记为✅。

6. **手工回归测试**：复制样本粘到 note，确认视觉效果。

---

## 七、不处理的场景

- **本编辑器内部 copy/paste**：PM 默认行为，不经过 dispatcher。
- **从 `.md` 文件导入**：走 `main/storage/md-to-atoms.ts`，不是
  clipboard 路径。
- **Image-only clipboard**：`paste-media` 处理，不经过 dispatcher。
- **Drag-drop 文件**：未来单独模块，不复用这里的 dispatcher。

---

## 八、已知未解问题

1. **第一列视觉样式** — 目前 CSS 对"所有表格的第一列"统一做 bold +
   darker bg，这在 Word-style 两列（label / value）表格上正确，
   但对多列数据表格可能显得多余。未来可引入"表格样式标签"
   （`<table data-krig-style="row-labels">` 等）或让用户自己切换。

2. **HTML→Markdown 的边缘 case**：嵌套表格、复杂 `<figure>`、
   Word 的浮动元素等目前会降级成 innerText 扁平化。

3. **跨 source 的识别冲突**：某些工具（Coda、Craft、新 Notion
   web 版）HTML 和 Notion 形似但不同。detect 要考虑先后顺序和
   回退策略。
