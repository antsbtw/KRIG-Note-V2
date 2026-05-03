# Thought 模块设计文档

:::callout[NOTE]
**目标**：在 KRIG-Note 中构建 Thought 模块 —— 一个 NoteView 的变种 View，
通过 Slot 双工通信与主文档联动，通过 SurrealDB 图关系管理 Note ↔ Thought 关联。
:::

---

:::toggle-heading[## 一、概念定义]

### Thought ≠ Comment

Thought 不是轻量批注，而是**附着于主文档锚点的完整思考文档**。

- 每个 Thought 是一个独立的 block-flow 文档（段落、标题、公式、代码、图片等）
- 支持 5 种语义分类：💭 思考、❓ 疑问、⭐ 重要、☐ 待办、🔍 分析
- 通过锚点（mark / node attr）绑定到主文档的具体位置

### 与 Note 的关系

| 维度 | Note | Thought |
|------|------|---------|
| 定位 | 主文档，知识载体 | 附属文档，思考载体 |
| 内容 | 完整叙事 | 针对某锚点的深度分析 |
| 独立性 | 完全独立 | 依附于 Note（通过图关系） |
| 编辑器 | 完整 ProseMirror | 精简版 ProseMirror（复用 schema） |
| 存储 | `note` table | `thought` table + `thought_of` edge |
| UI 位置 | Left Slot | Right Slot（面板式） |

:::

---

:::toggle-heading[## 二、架构总览]

### 系统拓扑

```
┌─ NavSide ─┤─ Left Slot (Note) ──┤ Divider ├── Right Slot (Thought) ─┐
│           │                      │         │                          │
│           │  ProseMirror Editor   │  ←  →  │  ThoughtPanel            │
│           │  ┌ thought marks ┐   │ ViewMsg │  ├─ ThoughtCard × N      │
│           │  └ node attrs    ┘   │         │  │  └─ ThoughtEditor     │
│           └──────────────────────┴─────────┘  └──────────────────────┘
│                      │                                  │
│                      └──────── SurrealDB ───────────────┘
│                         note ──thought_of──→ thought
└───────────────────────────────────────────────────────────────────────
```

### 分层架构

```
┌───────────────────────────────────────────────────┐
│  L4: View 组件层                                   │
│  NoteView（已有）     ThoughtView（新增）            │
│  ├ NoteEditor         ├ ThoughtPanel               │
│  ├ FloatingToolbar     ├ ThoughtCard               │
│  └ thought marks       └ ThoughtEditor             │
├───────────────────────────────────────────────────┤
│  L3: 注册表层                                      │
│  WorkModeRegistry  ProtocolRegistry  BlockRegistry │
│  ← 新增 'thought' workMode + 'note-thought' 协议   │
├───────────────────────────────────────────────────┤
│  L2: Slot 通信层                                   │
│  ViewMessage 双工  ──  main 路由  ──  协议匹配       │
│  ← 复用现有机制，无需修改框架                         │
├───────────────────────────────────────────────────┤
│  L1: 数据层                                        │
│  thought table  +  thought_of edge  +  graphStore  │
│  ← 新增 table、edge、thoughtStore                   │
└───────────────────────────────────────────────────┘
```

### 设计原则

1. **注册制**：Thought 通过 WorkModeRegistry、ProtocolRegistry 注册，框架不硬编码
2. **View 独立**：ThoughtView 是独立 renderer，与 NoteView 无代码耦合
3. **通信走协议**：Note ↔ Thought 的所有交互通过 ViewMessage 双工通道
4. **数据走图关系**：Note 和 Thought 的关联通过 SurrealDB RELATE 构建
5. **最大复用**：ThoughtEditor 复用 BlockRegistry 的 schema、converters、nodeViews

:::

---

:::toggle-heading[## 三、数据层设计]

### 3.1 Thought 数据模型

```typescript
// src/shared/types/thought-types.ts

export type ThoughtType = 'thought' | 'question' | 'important' | 'todo' | 'analysis';

export type AnchorType = 'inline' | 'block' | 'node';

export interface ThoughtRecord {
  id: string;                    // Format: thought-{timestamp}-{random}

  // 锚点信息（冗余存储，避免每次查图边）
  anchor_type: AnchorType;
  anchor_text: string;           // 锚点预览文本
  anchor_pos: number;            // ProseMirror 文档位置（用于排序）

  // 分类与状态
  type: ThoughtType;
  resolved: boolean;
  pinned: boolean;

  // 内容
  doc_content: Atom[];           // 复用 Atom 格式，与 Note 一致

  // 时间戳
  created_at: number;
  updated_at: number;
}
```

### 3.2 SurrealDB Schema 扩展

```sql
-- thought table
DEFINE TABLE IF NOT EXISTS thought SCHEMALESS;
DEFINE INDEX IF NOT EXISTS thought_type ON thought FIELDS type;
DEFINE INDEX IF NOT EXISTS thought_updated ON thought FIELDS updated_at;
DEFINE INDEX IF NOT EXISTS thought_resolved ON thought FIELDS resolved;

-- note → thought 图关系边
DEFINE TABLE IF NOT EXISTS thought_of SCHEMALESS;
-- 边属性：anchor_type, anchor_pos, created_at
```

### 3.3 图关系

```
note:⟨noteId⟩ ──thought_of──→ thought:⟨thoughtId⟩
```

**边属性**：

| 属性 | 类型 | 说明 |
|------|------|------|
| `anchor_type` | `'inline' \| 'block' \| 'node'` | 锚点类型 |
| `anchor_pos` | `number` | 文档位置（排序用） |
| `created_at` | `number` | 关系创建时间 |

**查询模式**：

```sql
-- 查询某笔记的所有 Thought
SELECT *,
  <-thought_of.anchor_type AS anchor_type,
  <-thought_of.anchor_pos AS anchor_pos
FROM thought
WHERE <-thought_of<-(note WHERE id = note:⟨$noteId⟩);

-- 查询某 Thought 属于哪篇笔记
SELECT in.id AS note_id, in.title AS note_title
FROM thought_of
WHERE out = thought:⟨$thoughtId⟩;
```

**图关系的优势**：
- 未来扩展 `ebook ──thought_of──→ thought` 时，Thought 模块零改动
- 支持跨源查询：一个 Thought 理论上可同时关联 Note 和 EBook
- 与现有 `sourced_from`、`clipped_from`、`links_to` 模式一致

### 3.4 thoughtStore

遵循 `noteStore` 的接口模式：

```typescript
// src/main/storage/thought-store.ts

export interface IThoughtStore {
  create(thought: Omit<ThoughtRecord, 'id' | 'created_at' | 'updated_at'>): Promise<ThoughtRecord>;
  get(id: string): Promise<ThoughtRecord | null>;
  save(id: string, updates: Partial<ThoughtRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  listByNote(noteId: string): Promise<ThoughtRecord[]>;
}

export const thoughtStore: IThoughtStore = { ... };
```

### 3.5 graphStore 扩展

在现有 `graphStore` 中新增 Thought 相关方法：

```typescript
// src/main/association/graph-store.ts (追加)

export interface ThoughtOfEdge {
  anchor_type: AnchorType;
  anchor_pos: number;
  created_at: number;
}

// 新增方法
async relateNoteToThought(noteId: string, thoughtId: string, edge: ThoughtOfEdge): Promise<void>;
async removeNoteToThought(noteId: string, thoughtId: string): Promise<void>;
async findThoughtsForNote(noteId: string): Promise<ThoughtRecord[]>;
async findNoteForThought(thoughtId: string): Promise<{ id: string; title: string } | null>;
```

:::

---

:::toggle-heading[## 四、注册层设计]

### 4.1 ViewType 扩展

```typescript
// src/shared/types.ts
export type ViewType = 'note' | 'ebook' | 'web' | 'graph' | 'thought';
```

### 4.2 WorkMode 注册

```typescript
// src/main/app.ts — registerPlugins()

workModeRegistry.register({
  id: 'thought',
  viewType: 'thought',
  icon: '💭',
  label: 'Thought',
  order: 10,
  hidden: true,        // 不在 NavSide tab 中显示，仅作为 right slot
});
```

`hidden: true` 表明 Thought 不是独立入口，只通过 Note 侧操作触发打开。

### 4.3 Protocol 注册

```typescript
// src/main/app.ts — registerPlugins()

protocolRegistry.register({
  id: 'note-thought',
  match: { left: { type: 'note' }, right: { type: 'thought' } },
});
```

单向注册：Thought 只出现在 Right Slot，Note 只在 Left Slot 触发。

### 4.4 ViewType Renderer 配置

```typescript
// src/main/window/shell.ts — VIEW_TYPE_CONFIG

thought: {
  devServerUrl: THOUGHT_VIEW_DEV_URL,
  htmlFile: 'thought.html',
  prodDir: 'thought_view',
},
```

### 4.5 Vite 构建配置

新增 `vite.thought.config.mts`，遵循现有 view renderer 模式：

```typescript
// vite.thought.config.mts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: 'thought.html',
    },
  },
});
```

在 `forge.config.ts` 中注册为新的 renderer entry。

:::

---

:::toggle-heading[## 五、通信协议设计]

### 5.1 ViewMessage 协议

所有 Note ↔ Thought 的交互通过 ViewMessage，框架只路由，不解析 payload。

```typescript
// 消息格式
interface ViewMessage {
  protocol: 'note-thought';
  action: string;
  payload: unknown;
}
```

### 5.2 Action 定义

**Note → Thought（Left → Right）**：

| action | payload | 说明 |
|--------|---------|------|
| `create` | `{ thoughtId, anchorType, anchorText, anchorPos, type }` | Note 创建锚点后通知 Thought 新增卡片 |
| `activate` | `{ thoughtId }` | 点击锚点，Thought 面板展开并滚动到对应卡片 |
| `scroll-sync` | `{ visibleAnchorIds: string[] }` | Note 滚动时发送可见锚点 ID 列表 |
| `note-loaded` | `{ noteId }` | Note 加载新文档，Thought 加载对应 thoughts |

**Thought → Note（Right → Left）**：

| action | payload | 说明 |
|--------|---------|------|
| `scroll-to-anchor` | `{ thoughtId }` | 点击锚点预览，Note 滚动到锚点位置并闪烁 |
| `delete` | `{ thoughtId }` | 删除 Thought，Note 移除对应 mark/attr |
| `type-change` | `{ thoughtId, newType }` | 类型变更，Note 更新锚点样式 |

### 5.3 通信时序

**创建 Thought 流程**：

```
用户选中文字 → Cmd+Shift+M
    │
    ├─ NoteEditor: 添加 thought mark (ProseMirror transaction)
    ├─ NoteEditor: thoughtStore.create(...)
    ├─ NoteEditor: graphStore.relateNoteToThought(noteId, thoughtId, edge)
    ├─ NoteEditor: viewAPI.sendToOtherSlot({ action: 'create', payload: {...} })
    │
    └─→ ThoughtPanel: 收到 'create' → 新增 ThoughtCard → 自动展开编辑器
```

**点击锚点流程**：

```
用户点击 thought mark
    │
    ├─ thoughtPlugin: 检测 click on [data-thought-id]
    ├─ thoughtPlugin: viewAPI.sendToOtherSlot({ action: 'activate', payload: { thoughtId } })
    │
    └─→ ThoughtPanel: 收到 'activate' → 展开 ThoughtCard → 滚动到可见区域
```

**删除 Thought 流程**：

```
用户点击 ThoughtCard 删除按钮
    │
    ├─ ThoughtPanel: thoughtStore.delete(thoughtId)
    ├─ ThoughtPanel: graphStore.removeNoteToThought(noteId, thoughtId)
    ├─ ThoughtPanel: viewAPI.sendToOtherSlot({ action: 'delete', payload: { thoughtId } })
    ├─ ThoughtPanel: 移除 ThoughtCard
    │
    └─→ NoteEditor: 收到 'delete' → 移除 thought mark / node attr
```

:::

---

:::toggle-heading[## 六、View 组件层设计]

### 6.1 ThoughtView（L3 容器）

NoteView 的精简变种，负责面板管理而非文档编辑。

```typescript
// src/plugins/thought/components/ThoughtView.tsx

export function ThoughtView() {
  // 状态：思考列表、过滤条件、排序方式、当前激活 ID
  // 监听 ViewMessage：create / activate / scroll-sync / note-loaded
  // 渲染：Header（过滤 + 排序） + ThoughtCard 列表
}
```

### 6.2 ThoughtPanel

面板 UI，管理卡片列表的过滤、排序、滚动同步。

**过滤**：
- 按类型：all | thought | question | important | todo | analysis
- 按状态：显示/隐藏已 resolved

**排序**：
- 文档位置（`anchor_pos` 升序，对应阅读顺序）
- 时间降序 / 升序

### 6.3 ThoughtCard

单个 Thought 的卡片组件，toggle 展开/收起。

```
┌─ ThoughtCard ──────────────────────────────────┐
│  Header: [💭] 标题摘要                    14:32  │
├────────────────────────────────────────────────┤
│  AnchorPreview: "原文选中的文字..."    [↗ 跳转]  │
├────────────────────────────────────────────────┤
│  ThoughtEditor (ProseMirror)                   │
│  ┌────────────────────────────────────────┐    │
│  │ 用户的思考内容...                        │    │
│  └────────────────────────────────────────┘    │
├────────────────────────────────────────────────┤
│  ActionBar: [类型切换 ▼] [✓ Resolve] [🗑 删除]  │
└────────────────────────────────────────────────┘
```

**行为**：
- 收起时销毁 EditorView，展开时重建（性能优化）
- 标题 = content 中第一段非空文字
- 锚点预览可点击，触发 `scroll-to-anchor`
- 激活时显示蓝色边框

### 6.4 ThoughtEditor

NoteEditor 的精简版，复用完整编辑能力。

**复用**：
- `blockRegistry.buildSchema()` — 相同 schema
- `blockRegistry.buildNodeViews()` — 相同 nodeViews
- `converterRegistry` — 相同 Atom ↔ PM 转换
- marks keymap（Cmd+B/I/U/S/E）
- SlashMenu、FloatingToolbar
- InputRules
- history（每个 ThoughtEditor 独立 undo/redo）

**排除**：
- `thoughtPlugin`（避免递归——Thought 编辑器内不能再加 Thought）
- `blockSelectionPlugin`（单卡片无需多块选择）
- `titleGuardPlugin`（Thought 无强制标题）
- `blockHandlePlugin`（卡片内简化交互）
- `headingCollapsePlugin`（卡片内不折叠）
- `vocabHighlightPlugin`（Thought 非阅读场景）
- `fromPageDecorationPlugin`（无 PDF 锚点）

**文档结构**：

```
doc
  └── paragraph+    // 无 noteTitle，直接从段落开始
```

:::

---

:::toggle-heading[## 七、NoteView 侧改动]

### 7.1 thought mark（已有）

schema 中已定义 `thought` mark，converter 已处理。无需修改。

```typescript
// 已有定义
thought: {
  attrs: { thoughtId: {} },
  inclusive: false,
  parseDOM: [{ tag: 'span[data-thought-id]', ... }],
  toDOM: (mark) => ['span', { 'data-thought-id': mark.attrs.thoughtId, class: 'thought-anchor' }, 0],
}
```

### 7.2 node attr（已有）

image、video、audio、tweet 已有 `thoughtId: { default: null }`。无需修改。

### 7.3 新增：thoughtPlugin

```typescript
// src/plugins/note/plugins/thought-plugin.ts

export function thoughtPlugin(): Plugin {
  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        // 检测点击 [data-thought-id] 元素
        // → viewAPI.sendToOtherSlot({ action: 'activate', payload: { thoughtId } })
      },
      handleDOMEvents: {
        mouseover(view, event) {
          // hover thought-anchor → 显示 tooltip "💭 点击查看思考"
        },
      },
    },
  });
}
```

### 7.4 新增：addThought 命令

```typescript
// src/plugins/note/commands/thought-commands.ts

export function addThought(view: EditorView, type: ThoughtType): void {
  const { state } = view;
  const { selection } = state;

  // 三条路径：
  // 1. 有文字选择 → inline mark
  // 2. 光标在 textBlock 无选择 → block mark（整段）
  // 3. 光标在 image/codeBlock/mathBlock/video/audio → node attr
}
```

### 7.5 新增：锚点样式

```css
/* src/plugins/note/note.css (追加) */

.thought-anchor {
  background-color: rgba(255, 212, 0, 0.15);
  border-bottom: 2px solid rgba(255, 212, 0, 0.5);
  cursor: pointer;
  transition: background-color 0.15s;
}

.thought-anchor:hover {
  background-color: rgba(255, 212, 0, 0.3);
}

.thought-anchor--active {
  background-color: rgba(255, 212, 0, 0.35);
  animation: thought-flash 0.4s ease-in-out 3;
}

.thought-anchor--resolved {
  background-color: rgba(255, 212, 0, 0.05);
  border-bottom: 1px dashed rgba(255, 212, 0, 0.2);
}

@keyframes thought-flash {
  50% { background-color: rgba(255, 212, 0, 0.6); }
}
```

### 7.6 触发方式

| 入口 | 触发 | 阶段 |
|------|------|------|
| `Cmd+Shift+M` | 创建 Thought + 打开 Right Slot | Phase 1 |
| FloatingToolbar 💭 按钮 | 同上 | Phase 1 |
| 右键菜单 "Add Thought" | 同上 | Phase 2 |

:::

---

:::toggle-heading[## 八、Thought 类型系统]

### 5 种语义类型

| 类型 | 标识 | 色值 | 使用场景 |
|------|------|------|---------|
| `thought` | 💭 | `#ffd400` (yellow) | 自由联想、发散思考 |
| `question` | ❓ | `#4a9eff` (blue) | 不理解、需验证的内容 |
| `important` | ⭐ | `#ff5252` (red) | 关键概念、核心公式 |
| `todo` | ☐ | `#4caf50` (green) | 需要后续跟进的任务 |
| `analysis` | 🔍 | `#ab47bc` (purple) | 深度分析、推导、对比论证 |

创建时默认为 `thought` 类型，可在 ThoughtCard 的 ActionBar 中切换。

:::

---

:::toggle-heading[## 九、锚点系统]

### 三种锚点模式

**1. Inline Mark（文字选择）**

```
用户选中 "量子纠缠" → Cmd+Shift+M
→ 添加 thought mark: <span data-thought-id="xxx">量子纠缠</span>
→ anchorType: 'inline', anchorText: '量子纠缠'
```

**2. Block Mark（整段）**

```
光标在段落中，无选择 → Cmd+Shift+M
→ 添加 thought mark 到整段文字
→ anchorType: 'block', anchorText: '段落前 60 字...'
```

**3. Node Attr（特殊节点）**

```
光标在 image / codeBlock / mathBlock / video / audio → Cmd+Shift+M
→ setNodeMarkup: thoughtId = 'xxx'
→ anchorType: 'node', anchorText: '[图片] alt text' / '[代码] first 60 chars' / '[公式] first 60 chars'
```

Node 锚点的视觉反馈：

```css
[data-thought-id].thought-anchor-node {
  outline: 2px solid rgba(255, 212, 0, 0.5);
  outline-offset: 2px;
}
```

:::

---

:::toggle-heading[## 十、新增/修改文件清单]

### 新增文件

| 文件 | 层级 | 说明 |
|------|------|------|
| `src/shared/types/thought-types.ts` | L1 数据 | ThoughtRecord、ThoughtType、AnchorType |
| `src/main/storage/thought-store.ts` | L1 数据 | Thought CRUD |
| `src/main/storage/schema.ts` | L1 数据 | += thought table + thought_of edge |
| `src/main/association/graph-store.ts` | L1 数据 | += relateNoteToThought 等方法 |
| `thought.html` | L3 注册 | Thought renderer HTML 入口 |
| `vite.thought.config.mts` | L3 注册 | Vite 构建配置 |
| `src/plugins/thought/renderer.tsx` | L4 组件 | ThoughtView 渲染入口 |
| `src/plugins/thought/components/ThoughtView.tsx` | L4 组件 | L3 容器 |
| `src/plugins/thought/components/ThoughtPanel.tsx` | L4 组件 | 面板列表 |
| `src/plugins/thought/components/ThoughtCard.tsx` | L4 组件 | 卡片（toggle） |
| `src/plugins/thought/components/ThoughtEditor.tsx` | L4 组件 | 精简版编辑器 |
| `src/plugins/thought/thought.css` | L4 组件 | 面板样式 |
| `src/plugins/thought/thought-protocol.ts` | L2 通信 | Action 常量定义 |
| `src/plugins/note/plugins/thought-plugin.ts` | L4 组件 | Note 侧交互插件 |
| `src/plugins/note/commands/thought-commands.ts` | L4 组件 | addThought 命令 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/shared/types.ts` | ViewType += `'thought'` |
| `src/main/app.ts` | += thought workMode 注册 + note-thought 协议注册 |
| `src/main/window/shell.ts` | += thought renderer 配置 |
| `forge.config.ts` | += thought renderer entry + preload |
| `src/plugins/note/components/NoteEditor.tsx` | += thoughtPlugin 加入 plugin 列表 |
| `src/plugins/note/components/FloatingToolbar.tsx` | += 💭 按钮 |
| `src/plugins/note/note.css` | += thought-anchor 样式 |

:::

---

:::toggle-heading[## 十一、实施阶段]

### Phase 1 — MVP

**目标**：跑通 创建 → 编辑 → 保存 → 加载 的完整链路。

- [ ] 数据层：thought table + thought_of edge + thoughtStore + graphStore 扩展
- [ ] 注册层：ViewType 扩展 + workMode 注册 + protocol 注册 + Vite 构建
- [ ] NoteView 侧：thoughtPlugin + addThought 命令 + 锚点样式 + FloatingToolbar 按钮
- [ ] ThoughtView：ThoughtView + ThoughtPanel + ThoughtCard + ThoughtEditor
- [ ] 通信：create / activate / delete / note-loaded / scroll-to-anchor

### Phase 2 — 增强

- [ ] 5 种类型切换 + 类型过滤 + 排序（文档位置 / 时间）
- [ ] Resolve/Reopen 状态 + 隐藏已解决
- [ ] 双向滚动同步（Note 滚动 → Thought 高亮 / Thought 点击 → Note 定位闪烁）
- [ ] 全屏编辑模式（ThoughtView 占满，隐藏 NoteView）
- [ ] Pinned 置顶

### Phase 3 — 扩展

- [ ] `ebook ──thought_of──→ thought`（EBook 标注 → Thought）
- [ ] AI → Thought 自动生成
- [ ] Thought 导出（Markdown / PDF）
- [ ] 跨笔记 Thought 搜索
- [ ] 右键菜单 "Add Thought"

:::

---

:::toggle-heading[## 十二、设计原则验证]

| 原则 | 验证 |
|------|------|
| **注册制** | Thought 通过 workModeRegistry.register() 声明，框架不硬编码 |
| **分层** | L1 数据 → L2 通信 → L3 注册 → L4 组件，各层独立 |
| **View 独立** | ThoughtView 是独立 renderer，与 NoteView 无 import 依赖 |
| **Slot 是纯布局** | Slot 不知道 Thought 的存在，只提供位置 |
| **View 不知道对面** | Thought 通过 sendToOtherSlot 通信，不直接引用 NoteView |
| **通信经过路由** | 消息经 main 进程路由，协议匹配后转发 |
| **框架不理解消息** | 框架只看 protocol + sender ID，不解析 payload |
| **图关系松耦合** | Note 和 Thought 通过 thought_of 边关联，互不依赖对方 schema |
| **复用最大化** | ThoughtEditor 复用 BlockRegistry 全套 schema/converter/nodeView |

:::
