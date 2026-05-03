# Artifact 导入指南 — SVG 与 HTML Block

> 文档类型：开发指南  
> 创建日期：2026-04-18 | 版本：v1.0  
> 适用分支：任何需要从 AI 页面提取 artifact 并导入 Note 的分支

---

## 一、概述

KRIG Note 从 Claude / ChatGPT 等 AI 页面提取 artifact（SVG 图表、HTML 交互页面），导入到 Note 中渲染。本文档定义了提取链路中的处理规范，确保各分支的实现保持一致。

### 两种 Artifact 类型

| 类型 | MIME | 提取输出格式 | Note 中的 Block | 渲染方式 |
|------|------|-------------|----------------|---------|
| SVG 图表 | `image/svg+xml` | `![title](media://images/xxx.svg)` | Image Block（SVG 分支） | DOM innerHTML |
| HTML 页面 | `text/html` | `!html[title](media://files/xxx.html)` | HTML Block | sandbox iframe |

---

## 二、SVG Artifact 导入

### 2.1 提取端处理（extract-turn.ts）

SVG artifact 只做 **最小预处理**，保留原始内容：

```
原始 SVG → prepareSvgForDom() → 保存到 media store → 输出 markdown
```

`prepareSvgForDom()` 只做两件事：

1. **注入 xmlns** — `innerHTML` 解析需要完整 XML 命名空间
2. **移除事件处理器** — `onclick` 等在 Note 上下文中无法执行且有安全风险

**不做的事**（以前 `prepareSvgForImgTag` 做了但现在移除了）：

- ~~CSS 变量替换为固定颜色~~
- ~~注入白色背景矩形~~
- ~~注入 `<style>` 块~~
- ~~`width="100%"` 替换为固定值~~

### 2.2 输出格式

```markdown
![artifact_title](media://images/xxx.svg)
```

标准 markdown 图片语法。ResultParser 将其解析为 `type: 'image'` 的 ExtractedBlock。

### 2.3 渲染端处理（image.ts）

Image Block 检测到 `src` 以 `.svg` 结尾或以 `data:image/svg+xml` 开头时，走 SVG 渲染路径：

```
fetch(media://xxx.svg) → arrayBuffer → TextDecoder('utf-8') → innerHTML → injectSvgStyles()
```

关键点：

- **UTF-8 强制解码**：`media://` 协议返回的 response 可能未声明 charset，必须用 `arrayBuffer()` + `TextDecoder('utf-8')` 而不是 `response.text()`
- **Claude CSS 变量注入**：SVG 容器上注入 Claude 暗色主题 CSS 变量定义，让 SVG 中的 `var(--color-text-primary)` 等正确解析
- **不强制白色背景**：保留 SVG 原始视觉效果

### 2.4 Claude CSS 变量映射

SVG 容器注入的 CSS 变量（暗色主题值）：

```css
--color-text-primary: #e8e8e8;
--color-text-secondary: #a3a3a3;
--color-text-tertiary: #737373;
--color-bg-primary: #1e1e1e;
--color-bg-secondary: #2a2a2a;
--color-bg-tertiary: #3a3a3a;
--color-border-primary: #5a5a5a;
--color-border-secondary: #4a4a4a;
--color-border-tertiary: #3a3a3a;
/* 以及 --color-background-*, --text-color-*, --bg-color, --fg-color 等别名 */
```

> **扩展其他 AI 平台**：ChatGPT / Gemini 的 SVG 使用不同的 CSS 变量名。需要时在 `injectSvgStyles()` 中根据来源平台选择对应的变量映射集。目前仅实现了 Claude 通道。

---

## 三、HTML Artifact 导入

### 3.1 提取端处理（extract-turn.ts）

```
HTML widget_code → base64 编码 → 保存到 media store → 输出 !html 标记
```

不做任何内容修改，原样保存。

### 3.2 输出格式

```markdown
!html[artifact_title](media://files/xxx.html)
```

自定义语法。ResultParser 识别 `!html[title](url)` 并解析为 `type: 'htmlBlock'` 的 ExtractedBlock。

**Fallback**：如果 media store 不可用，降级为代码块输出：

```markdown
\`\`\`html
<html>...</html>
\`\`\`
```

### 3.3 渲染端处理（html-block.ts）

HTML Block 使用 sandbox iframe 渲染：

```
fetch(media://xxx.html) → arrayBuffer → TextDecoder('utf-8') → 注入高度上报脚本 → iframe.srcdoc
```

关键点：

- **sandbox="allow-scripts"**：允许 JS 执行，但禁止表单提交、弹窗、导航
- **不加 allow-same-origin**：iframe 内无法访问 Note 页面的 DOM/cookie/storage
- **srcdoc 注入**：不通过 `src` 导航，避免跨域问题
- **高度自适应**：注入脚本通过 `postMessage` 上报 `document.body.scrollHeight`，父页面动态调整 iframe 高度（200~2000px）
- **UTF-8 强制解码**：与 SVG 相同

### 3.4 Toolbar

HTML Block 复用 render-block toolbar 机制（hover 显示），提供两个按钮：

- `{ }` — 切换源码/预览视图
- `↗` — 在新窗口中打开

---

## 四、新分支接入检查清单

当其他分支需要处理 artifact 导入时，确保以下文件已同步：

### 提取端（main 进程 / browser-capability）

| 文件 | 要点 |
|------|------|
| `extract-turn.ts` | SVG 用 `prepareSvgForDom()`（不是 `prepareSvgForImgTag`）<br>HTML 用 `!html[title](url)` 格式输出 |

### 解析端（renderer / web-bridge）

| 文件 | 要点 |
|------|------|
| `result-parser.ts` | 识别 `!html[title](url)` 语法，解析为 `type: 'htmlBlock'` |
| `content-to-atoms.ts` | `htmlBlock` 类型 → `HtmlBlockContent` atom |

### 渲染端（renderer / note）

| 文件 | 要点 |
|------|------|
| `image.ts` | SVG 检测 → DOM 渲染路径 + Claude CSS 变量注入 + UTF-8 解码 |
| `html-block.ts` | sandbox iframe + 高度自适应 + UTF-8 解码 |
| `blocks/index.ts` | `htmlBlockBlock` 已注册 |
| `registry.ts` | `htmlBlockConverter` 已注册 |
| `note.css` | `.image-block__svg-canvas` + `.html-block__*` 样式 |

### 类型定义

| 文件 | 要点 |
|------|------|
| `atom-types.ts` | `HtmlBlockContent` 接口 + `'htmlBlock'` 在 `RenderAtomType` 中 |
| `extraction-types.ts` | `ExtractedBlock.type` 包含 `'htmlBlock'` |

---

## 五、常见问题

### Q: 中文显示为乱码？

A: `fetch` 返回的 response 未声明 `charset=utf-8`。必须用 `response.arrayBuffer()` + `new TextDecoder('utf-8').decode(buf)` 而不是 `response.text()`。`atob` 解码 base64 时也需要 `TextDecoder` 处理多字节字符。

### Q: SVG 颜色和 Claude 页面不一致？

A: SVG 中使用了 Claude 的 CSS 变量（如 `var(--color-text-primary)`）。渲染时需要在容器上注入对应的变量定义。当前只实现了 Claude 暗色主题映射。

### Q: HTML iframe 内容无法显示？

A: 检查 sandbox 属性是否包含 `allow-scripts`。不要加 `allow-same-origin`，否则 iframe 内脚本可访问 Note 编辑器 DOM。

### Q: 已有的 SVG 文件显示不正确？

A: 旧版本保存的 SVG 已经过 `prepareSvgForImgTag` 预处理（CSS 变量被替换、注入了白色背景）。需要从 Claude 重新提取一次，新保存的 SVG 会保留原始内容。
