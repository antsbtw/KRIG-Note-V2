# Block 框定渲染 — 实施文档

## 实施概览

基于 [需求文档](Block-框定渲染-需求文档.md) 的设计，在 `fix/note-ai-thought-interaction` 分支上实现了通用的 Block 框定能力。

## 架构设计

### 数据模型

采用 **Node Attribute** 方案，在所有 `group: 'block'` 的节点上自动注入三个 attrs：

```typescript
frameColor: string | null    // 边框颜色，如 '#337EA9'
frameStyle: 'solid' | 'double' | null  // 单线 / 双线
frameGroupId: string | null  // 多 block 分组 ID
```

通过 `BlockRegistry.buildSchema()` 的自动注入机制，所有 block 类型（textBlock、codeBlock、image、mathBlock 等）自动获得这三个属性，无需逐个修改 block 定义。

### 渲染层

创建独立的 `blockFramePlugin`，基于 ProseMirror `Decoration.node()` 实现：

- 扫描文档中所有带 `frameColor` 的 block 节点
- 按 `frameGroupId` 分组，计算每个 block 在组内的位置（only/first/middle/last）
- 使用 CSS 自定义属性 `--frame-color` 和 `--frame-style` 传递颜色和样式
- 统一 `.block-frame` CSS class 体系，与 Thought 的 `.thought-block-frame` 独立共存

**优势**：TextBlock 和 RenderBlock 共用同一套渲染逻辑，无需在 `render-block-base.ts` 中做额外处理。

### 操作层

在 Context Menu（右键菜单）和 Handle Menu（拖拽手柄菜单）中各增加一个"框定"入口：

- **Context Menu**：`▣ 框定` / `▣ 修改框定` + `▢ 删除框定`，hover 展开 FramePicker 子菜单
- **Handle Menu**：`▣ 框定` / `▣ 修改框定`，作为子菜单展开 FramePicker

FramePicker 组件提供：
- 9 种颜色选择（参考 Notion 调色板）
- 单线 / 双线切换
- 删除框定

## 新增/修改文件

### 新增文件

| 文件 | 说明 |
|---|---|
| `src/plugins/note/plugins/block-frame.ts` | 框定渲染插件 — Decoration 构建 + 颜色/样式常量导出 |
| `src/plugins/note/commands/frame-commands.ts` | 框定操作命令 — add/update/remove/getSelectedPositions |
| `src/plugins/note/components/FramePicker.tsx` | 颜色+样式选择面板组件 — Context Menu / Handle Menu 共用 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/plugins/note/registry.ts` | `buildSchema()` 自动注入 `frameColor` / `frameStyle` / `frameGroupId` attrs |
| `src/plugins/note/note.css` | 新增 `.block-frame` 系列样式（CSS 自定义属性驱动） |
| `src/plugins/note/components/NoteEditor.tsx` | 注册 `blockFramePlugin` |
| `src/plugins/note/components/ContextMenu.tsx` | 添加"框定"菜单项 + FramePicker 子菜单 |
| `src/plugins/note/components/HandleMenu.tsx` | 添加"框定"菜单项 + FramePicker 子菜单 |

## 颜色系统

| 颜色 | 色值 |
|---|---|
| Gray | `#787774` |
| Brown | `#9F6B53` |
| Orange | `#D9730D` |
| Yellow | `#CB912F` |
| Green | `#448361` |
| Blue | `#337EA9` |
| Purple | `#9065B0` |
| Pink | `#C14C8A` |
| Red | `#D44C47` |

## 交互流程

### 添加框定

1. **单 block**：点击 handle → 选择"框定" → 选颜色 → 自动应用 `solid` 样式
2. **多 block**：拖选多个 block → 右键 → 选择"框定" → 选颜色 → 共享同一个 `frameGroupId`
3. 首次选颜色时默认 `solid` 样式，之后可切换为 `double`

### 修改框定

1. 在已框定 block 上右键 / 点击 handle → 显示"修改框定"
2. 打开 FramePicker，当前颜色高亮显示
3. 点击新颜色或切换样式即时生效
4. 同一 `frameGroupId` 的所有 block 同步更新

### 删除框定

1. 右键菜单中显示"删除框定"选项
2. FramePicker 底部显示"删除框定"按钮
3. 删除时清空 `frameColor` / `frameStyle` / `frameGroupId`，同组 block 一并清除

## CSS 实现要点

- 使用 CSS 自定义属性 `--frame-color` 和 `--frame-style` 传递动态值
- 边框宽度：solid 3px，double 4px（double 需要更粗才能显示效果）
- 圆角：6px（only 四角，first 上两角，last 下两角）
- hover 背景：`color-mix(in srgb, var(--frame-color) 6%, transparent)`
- 与 Thought 线框独立共存，不冲突

## 后续迁移（暂不实施）

Thought 标注系统目前仍使用独立的 `.thought-block-frame` + Decoration 机制。未来可以将 Thought 的 block 线框迁移到新的框定系统：

1. Thought 创建时自动设置 `frameColor`（根据 thoughtType 映射颜色）
2. `thought-plugin.ts` 的 `buildBlockThoughtDecorations` 改为读取 `node.attrs.frameColor`
3. 删除 Thought 时同步清除框定 attrs

这个迁移可以在框定功能稳定后再执行。
