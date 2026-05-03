# image — 图片

> **类型**：RenderBlock（见 `base/render-block.md`）
> **位置**：文档中任意位置
> **状态**：已实现

---

## 一、定义

image 是图片 Block——显示图片 + 可选的图说（caption）。

```
┌──────────────────────────────────────────┐
│          [对齐工具栏 ◁ ▣ ▷]              │  ← hover 时显示
│                                          │
│  ↔ handle │    [图片内容]     │ handle ↔  │  ← 左右 resize handles
│                                          │
├──────────────────────────────────────────┤
│ 图说文字（可选，支持 inline 格式化）      │
└──────────────────────────────────────────┘
```

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'paragraph',          // caption（图说）
  group: 'block',
  draggable: true,
  selectable: true,
  attrs: {
    atomId:       { default: null },    // Atom 持久化 ID
    sourcePages:  { default: null },    // 来源页码（PDF 提取）
    thoughtId:    { default: null },    // Thought 锚定 ID
    src:          { default: null },    // 图片 URL / data URI / 本地路径
    alt:          { default: '' },      // alt 文字
    title:        { default: '' },      // 图片标题
    width:        { default: null },    // 显示宽度（null = 自适应）
    height:       { default: null },    // 显示高度
    alignment:    { default: 'center' },// 对齐方式：'left' | 'center' | 'right'
  },
}
```

### content 说明

`paragraph`——图说是一个 paragraph，支持 inline 格式化（bold/italic/link）。图片本身由 NodeView 渲染（不在 ProseMirror 文档模型中）。

---

## 三、NodeView

image 需要自定义 NodeView，包含**三种状态**：

### 3.1 空状态（placeholder）

```
┌─────────────────────────────────┐
│  🖼  [Upload]  [Embed link]     │  ← 虚线边框
└─────────────────────────────────┘
```

- **Upload 按钮**：触发隐藏的 `<input type="file" accept="image/*">`，通过 FileReader 转为 data URI
- **Embed link 按钮**：显示 URL 输入框 + 提交按钮，输入图片 URL

### 3.2 AI 描述占位（AI placeholder）

当 `src` 为空但存在 AI 生成的描述时，显示描述文字占位。

### 3.3 图片显示状态

```
┌─ image NodeView ────────────────────────┐
│ [对齐工具栏]（hover 时显示，左/中/右）    │
│ [图片 <img>]（渲染型，NodeView 控制）     │
│ [左 resize handle] [右 resize handle]    │
│ contentDOM → paragraph（caption）         │
└─────────────────────────────────────────┘
```

- 图片通过 `<img src>` 渲染
- **Resize handles**：左右两侧拖拽手柄，拖拽时按比例缩放，显示宽度指示器
- **对齐工具栏**：hover 时在图片上方显示 left/center/right 三个按钮
- 图片点击可选中（蓝色边框 `#8ab4f8`）
- caption 是 ProseMirror 管理的 paragraph
- 图片加载完成后自动捕获 `naturalWidth/naturalHeight`

---

## 四、Capabilities

```typescript
capabilities: {
  turnInto: [],                   // 图片不能转为其他类型
  marks: [],
  canDelete: true,
  canDrag: true,
}
```

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Image',
  icon: '🖼️',
  group: 'Media',
  keywords: ['image', 'picture', 'photo', 'img'],
  description: 'Embed an image',
}
```

---

## 六、创建方式

| 入口 | 行为 |
|------|------|
| SlashMenu 选择 Image | 插入空 image Block（placeholder 状态） |
| 粘贴剪贴板中的图片 | 自动创建 image Block（data URI） |
| 拖拽图片文件到编辑器 | 自动创建 image Block |
| Upload 按钮 | 文件选择器 → FileReader → data URI |
| Embed link | URL 输入框 → 直接设置 src |

### 粘贴处理（paste plugin）

- 检测 `clipboardData.files` / `clipboardData.items` 中的图片
- FileReader 读取为 data URI
- 智能插入位置：
  - 当前在空 paragraph → 替换为 image
  - 否则 → 在当前 block 之后插入
- 插入后光标移动到 caption

---

## 七、Thought 锚定

image 支持 Thought 锚定（通过 node attribute，不是 Mark）：

- 包含在 `NODE_THOUGHT_TYPES` 集合中
- `thoughtId` attr 存储关联的 Thought ID
- DOM 上设置 `data-thought-id` + `.thought-anchor-node` class

---

## 八、Atom 持久化

### AtomContent 类型

```typescript
interface ImageContent {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  caption?: string;            // 从 paragraph 提取的纯文本
  alignment?: 'left' | 'center' | 'right';
  originalSrc?: string;        // 原始外部 URL（下载前）
  mediaId?: string;            // MediaStore ID
}
```

### Converter（双向转换）

- **atomToTiptap**：Atom → ProseMirror node（含 caption paragraph）
- **tiptapToAtom**：ProseMirror node → Atom（从 paragraph 提取 caption 文本）

---

## 九、Markdown 导出

```typescript
case 'image':
  return `![${node.attrs.alt}](${node.attrs.src})`;
```

---

## 十、未来升级路径

### 10.1 Tab Container 升级

image 升级为 Tab Container：
```
[图片] [AI 分析] [标注]
┌──────────────────────┐
│ 原始图片 / AI 描述 / 标注层 │
└──────────────────────┘
图说文字
```

---

## 十一、设计原则

1. **caption 是 paragraph**——图说支持 inline 格式化，不是纯文本 attr
2. **图片由 NodeView 渲染**——不在 ProseMirror 文档模型中
3. **三种状态**——空（placeholder）→ AI 描述占位 → 图片显示
4. **alignment 是 attr**——对齐方式通过 node attr 存储，CSS 通过 `data-alignment` 选择器响应
5. **Thought 通过 node attr**——RenderBlock 类节点使用 attr 而非 Mark 做 Thought 锚定
