# SVG 渲染增强 与 HTML Block 需求文档

> 文档类型：需求文档  
> 创建日期：2026-04-18 | 版本：v1.0  
> 目标分支：独立 feature 分支实现，完成后合并回 main  
> 前置文档：`docs/web/browser-capability/Artifact-Import-设计.md`

---

## 一、背景

KRIG Note 正在从 Claude / ChatGPT / Gemini 等 AI 页面提取对话内容导入 Note。AI 产出的 artifact 主要有两类：

1. **SVG 图表** — 流程图、思维导图、数据可视化、知识结构图
2. **HTML 页面** — 交互式图表（D3/Chart.js）、UI 原型、仪表盘、小工具

当前 SVG 通过 `<img>` 标签渲染，存在 CSS 隔离、无交互、字体 fallback 等问题。HTML artifact 当前以代码块形式呈现，不可预览。

本需求要解决两个问题：
1. 在 Image Block 中增强 SVG 渲染能力（不新建 block）
2. 新建 HTML Block，用 sandbox iframe 安全地渲染 HTML artifact

---

## 二、需求 1：Image Block SVG 渲染增强

### 2.1 现状

当前 Image Block（`src/plugins/note/blocks/image.ts`）对所有格式统一使用 `<img>` 标签：

```ts
const img = document.createElement('img');
img.src = node.attrs.src;  // 无论 PNG/JPG/SVG 都走这条路
```

SVG 通过 `<img>` 渲染时的问题：

| 问题 | 原因 |
|------|------|
| CSS 变量失效 | `<img>` 是隔离上下文，外部 CSS 不可用 |
| 事件处理器无效 | `<img>` 中 SVG 的 onclick 等不执行 |
| 字体 fallback | SVG 指定的字体在隔离上下文中不可用 |
| 无法缩放查看 | 大图缩小后细节模糊 |

当前的缓解措施（`extract-turn.ts` 中的 `prepareSvgForImgTag`）：
- 注入 xmlns 声明
- 替换 CSS 变量为具体颜色值
- 注入内嵌 `<style>` 块
- 注入白色背景矩形
- 移除 onclick 事件处理器

这些预处理已经让大部分 SVG 可显示，但治标不治本。

### 2.2 方案：Image Block 内部 SVG 分支渲染

在 Image Block 的 NodeView 中，检测 `src` 是否为 SVG，如果是则切换为 `<div>` + `innerHTML` 直接渲染 SVG DOM，替代 `<img>` 标签。

#### 2.2.1 渲染逻辑分支

```
createContent(node):
  if src ends with '.svg' or src starts with 'data:image/svg+xml':
    → SVG 渲染路径（新增）
  else:
    → 原有 <img> 渲染路径（不变）
```

#### 2.2.2 SVG 渲染路径实现

```html
<div class="image-block__wrapper" data-alignment="center">
  <div class="image-block__img-area">
    <!-- 左 resize handle -->
    <div class="image-block__svg-canvas">
      <!-- SVG DOM 直接插入 -->
      <svg xmlns="..." viewBox="0 0 680 620">...</svg>
    </div>
    <!-- 右 resize handle -->
  </div>
</div>
<div class="image-block__caption">...</div>
```

#### 2.2.3 SVG 内容获取方式

1. `src` 是 `media://images/xxx.svg` → 通过 fetch 读取 SVG 文本 → `innerHTML` 插入
2. `src` 是 `data:image/svg+xml;base64,...` → base64 解码 → `innerHTML` 插入

```ts
async function loadSvgContent(src: string): Promise<string | null> {
  try {
    if (src.startsWith('data:image/svg+xml;base64,')) {
      return atob(src.split(',')[1]);
    }
    const response = await fetch(src);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
```

#### 2.2.4 SVG 样式注入

SVG DOM 插入后，需要注入以下样式确保正确显示：

```ts
function injectSvgStyles(container: HTMLElement): void {
  const svg = container.querySelector('svg');
  if (!svg) return;

  // 1. 确保 SVG 自适应容器宽度
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';

  // 2. 白色背景（暗色主题下）
  svg.style.backgroundColor = '#ffffff';
  svg.style.borderRadius = '8px';

  // 3. 如果 SVG 没有内嵌 <style>，注入默认样式
  if (!svg.querySelector('style')) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      text { font-family: system-ui, -apple-system, sans-serif; }
      .ts { font-size: 13px; fill: #525252; }
      .th { font-size: 15px; fill: #171717; font-weight: 600; }
    `;
    svg.insertBefore(style, svg.firstChild);
  }
}
```

#### 2.2.5 Resize 处理

SVG 路径的 resize 和 `<img>` 路径不同：

- `<img>` 的 resize 改 `img.style.width`
- SVG 的 resize 改容器 `div` 的 `width`，SVG 通过 `width: 100%` 自适应

```ts
// resize handler 中
if (isSvg) {
  svgCanvas.style.width = `${newWidth}px`;
} else {
  img.style.width = `${newWidth}px`;
}
```

#### 2.2.6 update() 方法适配

```ts
update(node, contentEl):
  // 检测 SVG ↔ 非 SVG 切换 → 返回 false 重建
  const hasSvgCanvas = !!contentEl.querySelector('.image-block__svg-canvas');
  const isSvg = isSvgSrc(node.attrs.src);
  if (hasSvgCanvas !== isSvg) return false;

  if (isSvg) {
    // SVG: 如果 src 变了，重新 fetch + innerHTML
    const canvas = contentEl.querySelector('.image-block__svg-canvas');
    // ... 更新逻辑
  } else {
    // 原有 <img> 更新逻辑不变
  }
```

### 2.3 不需要改的部分

| 模块 | 状态 |
|------|------|
| image block schema（attrs） | 不变 — src/alt/width/height/alignment 足够 |
| imageConverter（atom ↔ PM） | 不变 — src 原样传递 |
| ResultParser | 不变 — `![alt](url.svg)` 已正确解析为 image block |
| extract-turn.ts | 不变 — 已输出 `![title](media://xxx.svg)` |
| CSS 类名 | 新增 `.image-block__svg-canvas`，其余不变 |

### 2.4 CSS 新增

```css
.image-block__svg-canvas {
  display: flex;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
}

.image-block__svg-canvas svg {
  width: 100%;
  height: auto;
  display: block;
}
```

### 2.5 验收标准

- [ ] SVG 格式的图片在 Note 中直接渲染为可见图表（不是 alt text）
- [ ] SVG 中的中文文字正确显示
- [ ] SVG 中的颜色节点（绿/紫/橙/灰等）正确渲染
- [ ] 连接线和箭头正确显示
- [ ] 白色背景在暗色主题下可见
- [ ] Resize handle 对 SVG 正常工作
- [ ] 对齐（左/中/右）对 SVG 正常工作
- [ ] Caption 正常显示
- [ ] PNG/JPG/GIF 等非 SVG 图片不受影响

---

## 三、需求 2：HTML Block（新建）

### 3.1 使用场景

AI 生成的 HTML artifact 类型：
- 交互式数据图表（D3、Chart.js、ECharts）
- UI 原型和组件预览
- 数据仪表盘
- 教学演示（动画、交互）
- 小工具/计算器

这些 HTML 包含 `<script>` 标签，不能用 `innerHTML` 注入（安全风险），必须用 **sandbox iframe** 渲染。

### 3.2 Schema 设计

```ts
// 文件：src/plugins/note/blocks/html-block.ts

export const htmlBlockBlock: BlockDef = {
  name: 'htmlBlock',
  group: 'block',
  nodeSpec: {
    content: 'textBlock',             // caption
    group: 'block',
    draggable: true,
    selectable: true,
    attrs: {
      atomId:      { default: null },
      sourcePages: { default: null },
      thoughtId:   { default: null },
      src:         { default: null },  // media:// URL（.html 文件）
      title:       { default: '' },
      height:      { default: 400 },   // iframe 高度（可调整）
      sandbox:     { default: 'allow-scripts' },
    },
    parseDOM: [{ tag: 'div.html-block' }],
    toDOM() { return ['div', { class: 'html-block' }, 0]; },
  },
  nodeView: createRenderBlockView(htmlBlockRenderer, 'htmlBlock'),
  capabilities: { canDelete: true, canDrag: true },
};
```

### 3.3 NodeView 渲染

```ts
const htmlBlockRenderer: RenderBlockRenderer = {
  label() { return 'HTML'; },

  createContent(node, view, getPos) {
    const content = document.createElement('div');
    content.classList.add('html-block');

    if (node.attrs.src) {
      // ── 渲染状态 ──
      const wrapper = document.createElement('div');
      wrapper.classList.add('html-block__wrapper');

      // Header bar
      const header = document.createElement('div');
      header.classList.add('html-block__header');

      const titleSpan = document.createElement('span');
      titleSpan.classList.add('html-block__title');
      titleSpan.textContent = node.attrs.title || 'HTML Preview';

      const toolbar = document.createElement('div');
      toolbar.classList.add('html-block__toolbar');

      // 查看源码按钮
      const srcBtn = document.createElement('button');
      srcBtn.textContent = '源码';
      srcBtn.title = '查看 HTML 源码';
      srcBtn.addEventListener('click', () => {
        // 切换源码/预览视图
        toggleSourceView(wrapper, node.attrs.src);
      });

      // 在新窗口打开按钮
      const openBtn = document.createElement('button');
      openBtn.textContent = '新窗口';
      openBtn.title = '在新窗口中打开';
      openBtn.addEventListener('click', () => {
        window.open(node.attrs.src, '_blank');
      });

      toolbar.appendChild(srcBtn);
      toolbar.appendChild(openBtn);
      header.appendChild(titleSpan);
      header.appendChild(toolbar);

      // iframe sandbox
      const iframe = document.createElement('iframe');
      iframe.classList.add('html-block__iframe');
      iframe.setAttribute('sandbox', node.attrs.sandbox || 'allow-scripts');
      iframe.style.width = '100%';
      iframe.style.height = `${node.attrs.height || 400}px`;
      iframe.style.border = 'none';
      iframe.style.borderRadius = '0 0 8px 8px';
      iframe.style.backgroundColor = '#ffffff';

      // 加载 HTML 内容
      loadHtmlContent(node.attrs.src).then((html) => {
        if (html) {
          iframe.srcdoc = html;
        }
      });

      // 高度调整 handle
      const resizeHandle = document.createElement('div');
      resizeHandle.classList.add('html-block__resize-height');
      setupHeightResize(resizeHandle, iframe, (newHeight) => {
        updateAttrs({ height: newHeight });
      });

      wrapper.appendChild(header);
      wrapper.appendChild(iframe);
      wrapper.appendChild(resizeHandle);
      content.appendChild(wrapper);
    } else {
      // ── Placeholder 状态 ──
      const placeholder = createPlaceholder({
        icon: '🌐',
        uploadLabel: 'Upload HTML',
        uploadAccept: '.html,.htm',
        embedLabel: 'Embed HTML',
        embedPlaceholder: 'Paste HTML code or URL...',
        onUpload: (dataUrl) => { /* 保存到 media store */ },
        onEmbed: (input) => { /* 保存到 media store */ },
      });
      content.appendChild(placeholder);
    }

    // Caption
    const captionDOM = document.createElement('div');
    captionDOM.classList.add('html-block__caption');
    content.appendChild(captionDOM);
    (content as any)._captionDOM = captionDOM;

    return content;
  },
};
```

### 3.4 HTML 内容加载

```ts
async function loadHtmlContent(src: string): Promise<string | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
```

### 3.5 安全性

| 措施 | 说明 |
|------|------|
| `sandbox="allow-scripts"` | 允许脚本执行，但禁止表单提交、弹窗、导航 |
| 不加 `allow-same-origin` | iframe 内无法访问 Note 页面的 cookie/storage |
| `srcdoc` 而非 `src` | 内容通过 srcdoc 注入，不是导航到 URL |
| 白名单 CSP（可选） | 可在 srcdoc 的 `<meta>` 中注入 CSP 限制外部资源加载 |

**不加 `allow-same-origin` 的原因**：如果加了，iframe 内的脚本可以通过 `parent.document` 访问 Note 编辑器 DOM。AI 生成的 HTML 不可控，必须隔离。

### 3.6 CSS

```css
.html-block__wrapper {
  border: 1px solid var(--color-border, #e5e5e5);
  border-radius: 8px;
  overflow: hidden;
}

.html-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--color-bg-secondary, #f5f5f5);
  border-bottom: 1px solid var(--color-border, #e5e5e5);
  font-size: 12px;
}

.html-block__title {
  font-weight: 500;
  color: var(--color-text-secondary, #525252);
}

.html-block__toolbar button {
  background: transparent;
  border: 1px solid var(--color-border, #d4d4d4);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  margin-left: 4px;
  color: var(--color-text-secondary, #525252);
}

.html-block__iframe {
  display: block;
  width: 100%;
}

.html-block__resize-height {
  height: 6px;
  cursor: ns-resize;
  background: transparent;
}
.html-block__resize-height:hover {
  background: var(--color-border, #e5e5e5);
}
```

### 3.7 Atom Converter

```ts
// 文件：src/plugins/note/converters/render-block-converters.ts 中新增

export const htmlBlockConverter: AtomConverter = {
  atomTypes: ['htmlBlock'],
  pmType: 'htmlBlock',

  toAtom(node: PMNode, parentId?: string): Atom {
    const captionText = node.firstChild?.textContent || undefined;
    return createAtom('htmlBlock', {
      src: node.attrs.src || '',
      title: node.attrs.title || '',
      height: node.attrs.height || 400,
      caption: captionText,
    }, parentId);
  },

  toPM(atom: Atom): PMNodeJSON {
    const c = atom.content as any;
    const captionContent = c.caption
      ? [{ type: 'text', text: c.caption }]
      : [];
    return {
      type: 'htmlBlock',
      attrs: {
        src: c.src,
        title: c.title,
        height: c.height,
      },
      content: [{ type: 'textBlock', content: captionContent }],
    };
  },
};
```

### 3.8 与提取链路的集成

当前 `extract-turn.ts` 遇到 HTML widget 时输出代码块：
```ts
return `\`\`\`html\n${content.code.trimEnd()}\n\`\`\`\n`;
```

改为保存到 media store 并输出 htmlBlock atom：

```ts
if (content.type === 'widget_code' && content.mimeType !== 'image/svg+xml') {
  // HTML widget → 保存到 media store
  const put = await ensureMediaStore();
  if (put) {
    const dataUrl = `data:text/html;base64,${Buffer.from(content.code, 'utf-8').toString('base64')}`;
    const result = await put(dataUrl, 'text/html', `${artifact.title}.html`);
    if (result.success && result.mediaUrl) {
      // 使用自定义 markdown 语法或直接生成 atom
      return `!html[${artifact.title}](${result.mediaUrl})\n`;
    }
  }
  // Fallback: 代码块
  return `\`\`\`html\n${content.code.trimEnd()}\n\`\`\`\n`;
}
```

**ResultParser 扩展**：

需要在 `result-parser.ts` 中识别 `!html[title](url)` 语法：

```ts
// 在 image 匹配之后
const htmlMatch = line.trim().match(/^!html\[([^\]]*)\]\(([^)]+)\)\s*$/);
if (htmlMatch) {
  blocks.push({
    type: 'htmlBlock',
    tag: 'div',
    text: htmlMatch[1],
    src: htmlMatch[2],
    headingLevel: 0,
  });
  continue;
}
```

### 3.9 Block 注册

在 `src/plugins/note/blocks/index.ts` 中：

```ts
import { htmlBlockBlock } from './html-block';

// 在 RenderBlock 区域添加
blockRegistry.register(htmlBlockBlock);

// SlashMenu
blockRegistry.registerSlashItem({
  id: 'html', blockName: 'htmlBlock', label: 'HTML Preview', icon: '🌐',
  group: 'media', keywords: ['html', 'web', 'preview', '网页'], order: 6,
});
```

### 3.10 验收标准

- [ ] HTML artifact 在 Note 中通过 iframe 渲染为可交互的网页
- [ ] JavaScript 在 iframe 内正常执行（allow-scripts）
- [ ] iframe 内脚本无法访问 Note 编辑器（无 allow-same-origin）
- [ ] Header bar 显示 title + 源码/新窗口按钮
- [ ] 高度可拖拽调整
- [ ] 源码查看模式可切换
- [ ] "在新窗口打开"可用
- [ ] Caption 正常显示
- [ ] 从 SlashMenu 可插入空 HTML Block（placeholder 状态）
- [ ] 粘贴 HTML 代码可创建 HTML Block
- [ ] Atom 序列化/反序列化正确

---

## 四、实施顺序

```
1. Image Block SVG 渲染增强（改动小，无新 block）
   ├── 修改 image.ts 的 createContent / update
   ├── 新增 CSS
   └── 测试 SVG 渲染

2. HTML Block 新建（独立新 block）
   ├── 新建 html-block.ts
   ├── 新增 htmlBlockConverter
   ├── 扩展 ResultParser（!html 语法）
   ├── 修改 extract-turn.ts 输出格式
   ├── 注册 block + SlashMenu
   └── 测试 HTML 渲染 + 安全性
```

---

## 五、关键文件清单

### 需求 1（SVG 渲染增强）

| 文件 | 改动 |
|------|------|
| `src/plugins/note/blocks/image.ts` | createContent 增加 SVG 分支渲染路径 |
| `src/plugins/note/blocks/image.ts` | update 增加 SVG ↔ img 切换检测 |
| `src/plugins/note/note.css` | 新增 `.image-block__svg-canvas` 样式 |

### 需求 2（HTML Block）

| 文件 | 改动 |
|------|------|
| `src/plugins/note/blocks/html-block.ts` | 新建 — schema + NodeView |
| `src/plugins/note/blocks/index.ts` | 注册 htmlBlockBlock + SlashMenu |
| `src/plugins/note/converters/render-block-converters.ts` | 新增 htmlBlockConverter |
| `src/plugins/note/note.css` | 新增 `.html-block__*` 样式 |
| `src/plugins/web-bridge/pipeline/result-parser.ts` | 识别 `!html[](url)` 语法 |
| `src/plugins/browser-capability/artifact/extract-turn.ts` | HTML artifact 改为输出 `!html` 格式 |

---

## 六、参考

- Image Block 现有实现：`src/plugins/note/blocks/image.ts`
- Block 注册入口：`src/plugins/note/blocks/index.ts`
- RenderBlock 基类：`src/plugins/note/blocks/render-block-base.ts`
- Atom Converter：`src/plugins/note/converters/render-block-converters.ts`
- ResultParser：`src/plugins/web-bridge/pipeline/result-parser.ts`
- Artifact 提取：`src/plugins/browser-capability/artifact/extract-turn.ts`
- SVG Block 设计（Phase E）：`docs/web/browser-capability/Artifact-Import-设计.md`
