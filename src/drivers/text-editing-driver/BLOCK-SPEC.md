# text-editing-driver Block 子协议 v0.1

> **本协议定义 text-editing-driver 内 block 自治模块的注册接口**。
>
> driver 协议 v0.2 铁律 4 规定 "driver 内部细节自由演化",block 是 driver 内部的自治模块。本子协议是 driver 内部的"block 注册规约",不对外暴露给 view。
>
> 设计输入:[V1-block-operations.md](../../../docs/RefactorV2/research/V1-block-operations.md)(V1 30+ block 抽象研究)。
>
> 文档版本:v0.1
> 编写日期:2026-05-05
> 上下文:L5-A 实施前,定 textBlock 接口 + 留位 L5-B/L5-C/L6+ 增量

---

> **L6 更新(2026-05-11)**: 原"合一节点 text-block(attrs.level/isTitle)"已按 PM 标准拆为
> **paragraph + heading** 双节点(详见 Decision 005)。本文档 §4 文本流类 block 描述按拆分后版本:
> - `paragraph` 节点(BlockSpec.id='paragraph'): content='inline\*',attrs={isTitle: false}
>   - isTitle=true 表示 noteTitle(文档首块特殊形态,不是 heading)
> - `heading` 节点(BlockSpec.id='heading'): content='inline\*',attrs={level: 1-6}
>   - level 范围 1-6 (CommonMark);UI 入口当前仅样式化 1-3,schema 支持完整 1-6
> - 命名:paragraph / heading 是 PM 标准命名(无短横线兼容问题);其他节点命名风格未变。

---

## 0. 设计哲学

### 0.1 block 是 driver 内部自治模块

block 不对 view 暴露(view 看到的是 driver Host)。driver 内部用 BlockSpec 接口注册 block,统一拼装 PM Schema。

block 自治意味着:
- 每个 block 是独立 src 目录
- 自由演化(改一个 block 不影响其他)
- 通过 BlockSpec 接口"声明自己是什么"

### 0.2 接口形态:声明性 + 实现性混合(Q-W2=C 用户拍板)

V1 病例:V1 BlockDef 是"统一接口字段"(每个 block 填同样字段),压制了 block 自由演化。

V2 BlockSpec 走**混合形态**:
- **声明性字段**(简单 block 用):`selectionBehavior: 'text' | 'node'` 之类(简化常见情况)
- **实现性字段**(复杂 block 用):`actions.selectAll: (view, node, pos) => ...` 之类(完全自定义)

90% block 用声明性字段,10% 复杂 block 用实现性字段。block 间不一致问题由"每 block 自治"自然解决。

### 0.3 自适应文件结构(driver 协议 § 1.2 + Q-Y2=C)

block 目录唯一约束:`spec.ts` 必须存在。其他文件按需开:
- 简单 block(textBlock):`spec.ts + README.md`(2 文件)
- 中等 block(image):`spec.ts + node-view.ts + README.md`(3 文件)
- 复杂 block(mathBlock / table):多文件

---

## 1. BlockSpec 接口定义

### 1.1 v0.1 接口(L5-A 用)

```ts
import type { NodeSpec, NodeViewFactory } from 'prosemirror-model';
import type { Plugin, Command } from 'prosemirror-state';

/** L5-A v0.1 接口 */
export interface BlockSpec {
  // ── 元数据 ──
  /** block ID,跨 driver 唯一 */
  readonly id: string;

  /** 显示名(给 SlashMenu / 等 UI 用)*/
  readonly displayName: string;

  // ── PM Schema ──
  /** PM nodeSpec(必需)— driver 收集所有 block.spec 拼装成 Schema */
  readonly spec: NodeSpec;

  // ── PM NodeView(可选,driver 渲染用)──
  /** 自定义 NodeView 工厂(可选,缺则走 PM 默认 toDOM)*/
  readonly nodeView?: NodeViewFactory;

  // ── PM Plugin(可选,block 自带 plugin)──
  /** block 自带的 PM plugin(driver 装配 EditorView 时收集进 plugin 列表)*/
  readonly plugin?: () => Plugin | Plugin[];

  // ── 容器规则(L5-A 用 'leaf' / 'inline-only' / 'block+';L5-B+ 加函数形式)──
  /** 容器规则,影响 selection / dnd / 删除行为 */
  readonly containerRule?: 'leaf' | 'inline-only' | 'block+';

  /** cascadeBoundary:整体不可拆(table / columnList 用,L5-A 不用)*/
  readonly cascadeBoundary?: boolean;

  // L5-B+ 接口位(本版不强制实施,占位):
  // selectionBehavior?: 'text' | 'node' | 'cell' | 'custom';
  // pasteGuard?: { mode, filter? };
  // serializers?: { toMarkdown?, toHTML?, toAtom? };
  // parsers?: { fromMarkdown?, fromHTML?, fromAtom? };
  // inputRules?: InputRule[];
  // editingMode?: 'inline' | 'embedded' | 'popover';
  // dropAccepts?: string[];
  // requires?: string[];           // 依赖其他 block(table 依赖 tableRow / tableCell)
  // shortcuts?: Record<string, Command>;  // 块特殊键盘
  // enterBehavior?: { action, exitCondition };
  // actions?: { selectAll?, selectBlock?, copy?, ... };  // 复杂 block 完全自定义
}
```

### 1.2 L5-A 必需字段

L5-A 的 textBlock 只需要:

```ts
const textBlockSpec: BlockSpec = {
  id: 'text-block',
  displayName: 'Paragraph',
  spec: { ... },                  // PM nodeSpec(必需)
  nodeView: undefined,            // L5-A 走 toDOM
  plugin: undefined,              // L5-A 无块自带 plugin
  containerRule: 'inline-only',   // textBlock 含 inline
  cascadeBoundary: false,
};
```

**只 5 个字段**,简洁。

### 1.3 L5-B/C/L6+ 接口扩展计划

按 driver 协议铁律 4(driver 内部细节自由演化),BlockSpec 接口随阶段递增:

| 阶段 | 加什么字段 | 触发条件 |
|---|---|---|
| L5-B | `selectionBehavior` / `pasteGuard` / `serializers` / `parsers` / `inputRules` / `shortcuts` / `enterBehavior` | 加多 block(heading / list / blockquote / code-block)+ 多 envelope clipboard + undo-redo + dnd 时验证完整接口 |
| L5-C | `editingMode` / `dropAccepts` | noteLink + image 块加入,验证 inline atom + drop |
| L6 | `requires` / `actions`(复杂 block 自定义)| table 依赖 tableRow / tableCell;mathBlock / codeBlock 复杂 editingMode |
| L7+ | 用户自定义 block 注册 | 插件市场 |

每阶段升级本协议到 v0.X。

---

## 2. block 注册机制

### 2.1 注册时机

driver 启动时(模块 load 时)收集 block:

```ts
// src/drivers/text-editing-driver/index.ts
import { textBlockSpec } from './blocks/text-block/spec';

const ALL_BLOCKS: BlockSpec[] = [
  textBlockSpec,
  // L5-B+ 加:headingSpec, bulletListSpec, orderedListSpec, codeBlockSpec, ...
];

// driver 单例使用 ALL_BLOCKS 拼装 Schema
```

L5-A 阶段所有 block 启动时一次性注册。L7+ 才考虑动态注册(用户插件)。

### 2.2 schema-builder 收集

driver 内部 schema-builder.ts 收集 block.spec 拼装 PM Schema:

```ts
function buildSchema(blocks: BlockSpec[]): Schema {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: 'block+' },
    text: { group: 'inline' },
  };
  for (const block of blocks) {
    nodes[block.id] = injectFrameworkAttrs(block.spec);
  }
  return new Schema({ nodes, marks: {} });   // L5-A 无 marks
}
```

### 2.3 EditorView 装配收集

driver 内部 editor-view-builder.ts 收集 block.plugin / block.nodeView:

```ts
function buildEditorView(container: HTMLElement, schema: Schema, blocks: BlockSpec[], doc: PMNode): EditorView {
  // 1. 收集 nodeViews
  const nodeViews: Record<string, NodeViewFactory> = {};
  for (const block of blocks) {
    if (block.nodeView) nodeViews[block.id] = block.nodeView;
  }

  // 2. 收集 plugins
  const blockPlugins: Plugin[] = [];
  for (const block of blocks) {
    const result = block.plugin?.();
    if (Array.isArray(result)) blockPlugins.push(...result);
    else if (result) blockPlugins.push(result);
  }

  // 3. 装配
  const state = EditorState.create({
    doc,
    plugins: [
      ...blockPlugins,
      keymap(baseKeymap),     // L5-A 最小集
    ],
  });

  return new EditorView(container, { state, nodeViews, dispatchTransaction: ... });
}
```

---

## 3. block 模块文件约定

### 3.1 必需文件

每个 block 目录必须有:

```
blocks/<block-id>/
├── spec.ts          ← export const <id>Spec: BlockSpec(必需)
└── README.md        ← 设计说明 + 演化记录(必需)
```

### 3.2 可选文件(按需)

```
blocks/<block-id>/
├── node-view.ts            ← NodeView 工厂(spec.nodeView 引用此处)
├── plugin.ts                ← 块自带 PM plugin(spec.plugin 引用)
├── schema.ts                ← 复杂 NodeSpec 拆分(spec.ts 太长时)
├── popover-editor.tsx        ← popover 编辑组件(mathBlock 等用)
├── styles.css               ← block 样式
└── ...                       (其他按需)
```

### 3.3 import 路径约定

block 内部:
- ✅ import PM 类型(`prosemirror-model` 等):基础设施 npm,允许
- ✅ import `src/shared/` utility
- ❌ import 其他 block(`../math-block/...`):block 间零代码 import(对应 driver 协议铁律 5)
- ❌ import 5 capability:block 是 driver 内部细节,通过 driver 整体跟 capability 协作,block 自己不调 capability
- ❌ import view:依赖反转

---

## 4. L5-A:textBlock 详细规约

### 4.1 spec.ts(草案)

```ts
// src/drivers/text-editing-driver/blocks/text-block/spec.ts
import type { BlockSpec } from '../../types';
import type { NodeSpec } from 'prosemirror-model';

const textBlockNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /** null=paragraph, 1/2/3=heading 级别 */
    level: { default: null },
  },
  defining: true,
  parseDOM: [
    { tag: 'p' },
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
  ],
  toDOM(node) {
    const { level } = node.attrs;
    if (level === 1) return ['h1', 0];
    if (level === 2) return ['h2', 0];
    if (level === 3) return ['h3', 0];
    return ['p', 0];
  },
};

export const textBlockSpec: BlockSpec = {
  id: 'text-block',
  displayName: 'Paragraph',
  spec: textBlockNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
```

### 4.2 L5-A textBlock 不实施

V1 textBlock 有的字段,L5-A 阶段不实施(留 L5-B+):
- `isTitle` attr(noteTitle 模式 — V2 由 NoteView 自己管标题,driver 不关心)
- `textIndent` attr(首行缩进)
- `align` attr(对齐)
- `open` attr(heading 折叠)
- `noteTitleNodeView`(NoteTitle 自定义渲染)

L5-A 只要"段落 + 三级标题"基本功能。

---

## 5. block 间一致性(协议层面)

虽然 block 自治,但有几条**共同约束**:

### 5.1 命名规约

block.id 全 kebab-case:`text-block` / `math-block` / `code-block` / `note-link` / 等。

跨 driver block ID 全局唯一(driver 自己用 driver 名作前缀避免冲突,如 `text-editing-driver` 内 block 不重名)。

### 5.2 schema 兼容性

block 加新 attrs default 不破已存 doc(PM 自动用 default 填补)。

block 改 content 表达式风险高,需要 migration(L7+ 真要改时设计)。

### 5.3 命名空间共享

block 注册到 5 capability 时(L5-B+):
- selection source 用 `text-editing-driver.<block-id>`(driver 协议铁律 6a)
- clipboard contentType 用 `text-editing-driver.<block-id>.<format>`
- dnd source.type 用 `text-editing-driver.block.<block-id>`

注:**block 在 driver 内部不直接调 capability,这些注册由 driver 整体 / driver 内部 capability-integrations/ 模块代为完成**。block 只声明自己的 spec / 行为,driver 整体收集后注册。

---

## 6. 风险 + 开放问题

### 6.1 BlockSpec 接口演化兼容?

L5-A v0.1 接口字段少,L5-B/C/L6 加字段。已实施 block(textBlock)需要适配吗?

**推荐**:**新字段全部 optional**,缺失走 default。textBlock 在 L5-B 加新字段时,如不需要可以保持 v0.1 形态。

### 6.2 复杂 block(mathBlock 等)用 actions 实现性接口时,接口形态怎样?

driver 协议草案给的 `actions.selectAll: (view, node, pos) => ...`。但每个 action 的具体签名(参数 / 返回值)需要 driver 内部实施时验证。

**推荐**:L5-B 加第一个复杂 block(image / blockquote)时落地 actions 接口。L5-A 不预设。

### 6.3 driver 默认 baseKeymap 跟 block 自己的 keymap 冲突?

block 通过 spec.plugin 加 PM plugin(里面可能有 keymap)。driver 装配时 baseKeymap 是兜底。

**推荐**:plugin 装配顺序 — block.plugin 在 baseKeymap 之前(具体规则参考 V1 NoteEditor.tsx 经验)。L5-A 只 textBlock 无块自带 keymap,无冲突。L5-B 加新 block 时验证。

### 6.4 block 内部状态(NodeView 内的 React state / 全局监听 / 等)生命周期?

mathBlock 这种 popover 编辑模式,block 内部维护"editing"状态 + 全局 mousedown 监听。driver Host unmount 时这些会泄漏吗?

**推荐**:block.nodeView 工厂返回 NodeView 接口,**必须实现 destroy 方法**清理内部状态。driver 负责销毁 EditorView 时调用所有 NodeView 的 destroy。L5-B 加复杂 block 时验证。

### 6.5 BlockSpec 是否需要"block 实例数限制"?

某些 block 全文档只能一个(如 V1 noteTitle 的 isTitle=true)。

**推荐**:V2 不预设这种约束。NoteView 通过自己的业务逻辑保证(如笔记标题不在 block 里,而是 NoteView 自己渲染),不污染 BlockSpec 接口。

### 6.6 BlockSpec.id 跟 PM nodeSpec name 的关系?

PM Schema 内部用 nodeSpec name 标识节点。BlockSpec.id 跟 PM nodeSpec name **必须一致**(driver schema-builder 用 BlockSpec.id 作 nodeSpec name)。

**约束**:driver 内部 schema-builder 拼装时:
```ts
nodes[block.id] = block.spec;  // block.id 直接当 nodeSpec name
```

block 作者要保证 PM nodeSpec 内部不再额外指定 name。

---

## 7. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;BlockSpec L5-A 接口(5 字段)+ L5-B/C/L6+ 接口位预告 + 注册机制 + 文件约定 + textBlock 详细规约 + 协议层共同约束(命名 / schema / 命名空间共享)+ 6 个风险/开放问题。 |
| 2026-05-05 | v0.1.1 | **AI 复审 P2 文档对齐**: § 1.3 引用"铁律 8(演化能力优先)" → "铁律 4(driver 内部细节自由演化)"(v0.2 协议铁律编号体系对齐,演化优先理念已合并到铁律 4)。 |
