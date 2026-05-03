# Block 框定渲染 — 需求文档

## 背景

当前 Thought 标注系统对 block 级标注使用 ProseMirror Decoration 在 block DOM 上添加 CSS class 来画线框。这种方式存在以下局限：

1. **Decoration 与渲染分离** — Decoration 是临时的视觉层，需要每次文档变化时重新扫描 mark 并重建
2. **ThoughtEditor 中公式块不渲染** — ThoughtView 作为独立 View，某些 block（mathBlock 等）的 NodeView 渲染环境可能不完整（如 KaTeX CSS 缺失）
3. **颜色固定** — 当前线框颜色绑定到 Thought 类型，无法自由选择
4. **无法复用** — 框定能力只服务于 Thought 标注，其他场景（AI 引用高亮、协作编辑标记等）无法使用

## 目标

为所有 block 类型提供一个**通用的框定渲染能力**：传入颜色参数即可在 block 外围画边框。

## 设计方案

### 方案：在 render-block-base 中增加框定支持

`render-block-base.ts` 是所有 RenderBlock（image、codeBlock、mathBlock、videoBlock 等）的基类，负责创建外层 DOM 包裹。在这个层面添加框定能力：

```
RenderBlock DOM 结构：
┌─ .render-block ──────────────────────┐
│  ┌─ .render-block__frame (新增) ───┐ │  ← 框定层（可选，有 thoughtId 时显示）
│  │  ┌─ .render-block__content ───┐ │ │
│  │  │  实际 block 内容            │ │ │
│  │  └────────────────────────────┘ │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 接口设计

```typescript
interface BlockFrameOptions {
  /** 边框颜色（CSS color） */
  color: string;
  /** 边框宽度（默认 2px） */
  width?: number;
  /** 边框样式：solid / dashed / dotted */
  style?: 'solid' | 'dashed' | 'dotted';
  /** 圆角（默认 6px） */
  radius?: number;
  /** 点击回调 */
  onClick?: () => void;
  /** 框定 ID（用于标识，如 thoughtId） */
  id?: string;
}
```

### TextBlock 的框定

TextBlock 不使用 RenderBlock 基类（它直接由 ProseMirror 渲染为 `<div>` 或 `<p>`）。TextBlock 的框定仍需通过 Decoration，但可以统一 CSS class 命名和样式：

- 单 block：`thought-block-frame--only`（四边圆角）
- 多 block 首：`thought-block-frame--first`（上圆角）
- 多 block 中：`thought-block-frame--middle`（无圆角）
- 多 block 尾：`thought-block-frame--last`（下圆角）

### 颜色系统

| 来源 | 颜色 |
|---|---|
| Thought 思考 | `#4a9eff` |
| Thought 疑问 | `#ff5252` |
| Thought 重要 | `#ffab40` |
| Thought 待办 | `#4caf50` |
| Thought 分析 | `#ab47bc` |
| AI 回复 | `#6366f1` |
| 自定义 | 任意 CSS color |

## 涉及文件

- `src/plugins/note/blocks/render-block-base.ts` — 基类添加框定 DOM
- `src/plugins/note/note.css` — 框定样式
- `src/plugins/note/plugins/thought-plugin.ts` — Decoration 构建（TextBlock 用）
- `src/plugins/thought/components/ThoughtEditor.tsx` — 确保 KaTeX 等渲染正确

## 实施建议

1. 先在 `feature/noteview-enhancement` 分支实施
2. 从 render-block-base 开始，验证单个 block 类型（如 mathBlock）的框定效果
3. 扩展到所有 RenderBlock 类型
4. 最后处理 TextBlock（通过 Decoration）
5. 统一 Thought 标注系统使用新的框定能力

## 相关上下文

- 当前 Thought 标注的三种视觉效果：inline 下划线 / block 线框（Decoration）/ node outline
- `fix/note-ai-thought-interaction` 分支已实现基础的 block 线框，但通过 Decoration 实现
- ThoughtEditor 复用 NoteEditor 的 BlockRegistry 和 NodeView，但独立运行在 Right Slot
