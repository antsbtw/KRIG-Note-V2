# Decision 005 — text-block 拆分为 paragraph + heading（V2 代码改造任务）

> **状态**：实施任务（待新对话执行）
> **设计师 / 审计师**：本对话（feature/L6-data-modeling 分支）
> **实施者**：新对话（feature/L6-block-decomposition 分支）
> **决议日期**：2026-05-11

---

## 0. 本文档的执行指南

### 0.1 角色与流程

```
本对话 (feature/L6-data-modeling)
    ↓ 写出本文档（设计师）
    ↓
新对话 (feature/L6-block-decomposition) — 独立 session
    ↓ 按本文档执行代码改造（实施者）
    ↓ 每完成一个步骤 commit 一次
    ↓ 完成后停下,通知本对话
    ↓
本对话 (feature/L6-data-modeling)
    ↓ 验证测试清单 + 审计代码（审计师）
    ↓ 通过 → 合到 main
    ↓ 不通过 → 列问题清单 → 新对话继续修
```

### 0.2 实施纪律（实施者必须遵守）

1. **严格按本文档执行**，不要自行扩展范围。发现文档遗漏 → 停下来等本对话补充，不要自行决定。
2. **每完成一个 §5 步骤 commit 一次**（细粒度 commit 便于回滚 / 审计）。
3. **不动 V1 任何代码**（pwd 在 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`，按 [feedback_v2_is_workspace_v1_is_reference](../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_v2_is_workspace_v1_is_reference.md)）。
4. **不合并到 main**，所有 commit 留在 `feature/L6-block-decomposition` 分支。
5. **完成所有 §5 步骤后停下**，发消息 "L6-block-decomposition 改造完成请审计"。不要继续做别的事。
6. 实施期间若发现本文档矛盾 / 不可行 → 立刻停下汇报，不要"绕过"。

### 0.3 本文档为何要冗余复述决议链

本文档面向**独立新对话**，那个对话不会自动继承本对话的数据建模上下文。因此本文档必须自包含：

- 不假设读者知道 "decision 003 走法 B"、"naming-conventions §1.2.1 PM 优先例外" 等内容。
- 所有关键规范 / 命名 / 阶梯 / 处置原则在本文档内**复述清楚**。
- 不用 "按 Phase 2b 决议处置" 这种内部引用。

---

## 1. 改造目标（What）

### 1.1 V2 当前状态

V2 当前用**一个合一节点 `text-block`** + 两个 attrs 表达三种语义：

```ts
// src/drivers/text-editing-driver/blocks/text-block/spec.ts
const textBlockNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    level: { default: null },     // null = paragraph; 1/2/3 = heading
    isTitle: { default: false },  // true = 文档标题（doc 首块）
  },
  defining: true,
  parseDOM: [
    { tag: 'p', getAttrs: el => ({ level: null, isTitle: el.getAttribute('data-is-title') === 'true' }) },
    { tag: 'h1', attrs: { level: 1, isTitle: false } },
    { tag: 'h2', attrs: { level: 2, isTitle: false } },
    { tag: 'h3', attrs: { level: 3, isTitle: false } },
  ],
  toDOM(node) {
    const level = node.attrs.level as number | null;
    const isTitle = node.attrs.isTitle as boolean;
    if (isTitle) return ['p', { 'data-is-title': 'true', class: 'krig-note-title' }, 0];
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

→ V2 用 `text-block.attrs.level === null` 表达 paragraph，`level === 1/2/3` 表达 heading，`isTitle === true` 表达 noteTitle。

### 1.2 V2 目标状态

按 PM 标准把 `text-block` 拆为**两个独立节点**：

```ts
// paragraph (PM 标准命名)
const paragraphNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    isTitle: { default: false },  // 文档标题 attrs 仍留在 paragraph 上
  },
  defining: true,
  parseDOM: [
    { tag: 'p', getAttrs: el => ({ isTitle: el.getAttribute('data-is-title') === 'true' }) },
  ],
  toDOM(node) {
    const isTitle = node.attrs.isTitle as boolean;
    if (isTitle) return ['p', { 'data-is-title': 'true', class: 'krig-note-title' }, 0];
    return ['p', 0];
  },
};

// heading (PM 标准命名)
const headingNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    level: { default: 1 },         // 必填字段（1-6），默认 1
  },
  defining: true,
  parseDOM: [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
    { tag: 'h4', attrs: { level: 4 } },
    { tag: 'h5', attrs: { level: 5 } },
    { tag: 'h6', attrs: { level: 6 } },
  ],
  toDOM(node) {
    const level = node.attrs.level as number;
    return [`h${level}`, 0];
  },
};
```

### 1.3 关键决议

#### D1: noteTitle 归属

**决议**：noteTitle 是 **paragraph 的特殊形态**（保留 `paragraph.attrs.isTitle: true`）。**不**是 heading level=1，**不**是独立节点。

**理由**：V2 当前注释明确写 `(用普通 p 而非 h1 — 区别于 markdown 的 # 标题)` —— V2 设计哲学是 noteTitle ≠ heading（noteTitle 是"加大字号的段落"，不是章节标题）。拆分时保留这个哲学。

#### D2: heading.level 范围

**决议**：heading.level 范围扩到 **1-6**（CommonMark 标准），不只 V2 当前的 1-3。

**理由**：一次到位，避免后续再改 schema。UI 渲染层即便暂时只样式化 1-3，schema 支持 1-6 留出扩展余地。

#### D3: 命名风格

**决议**：新节点 id 用 **PM 标准命名 + camelCase 兼容**：
- `paragraph`（不是 `text-block` 也不是 `textBlock`，因为这是 PM 标准命名，无歧义）
- `heading`（同理）

注意：V2 现有节点 id 命名混用风格（多数驼峰如 `bulletList` / `codeBlock`，少数带连字符如 `text-block`）。本次改造**不批量改其他节点命名**，只把 `text-block` 拆为 PM 标准的 `paragraph` + `heading`。

---

## 2. 改造背景（Why）

### 2.1 V2 当前合一架构的债务

V2 用 `text-block + level attrs` 是 V1 直迁的选择，主要好处：

- 跨类型转换（paragraph ↔ heading）只改 attrs，不用 PM `setBlockType` 切节点类型 → 撤销栈、光标更稳。
- noteTitle 跟 heading 用同一节点 + 两个 attrs 解耦，简洁。

但带来**架构债**：

| 债务 | 影响 |
|---|---|
| 节点 type 不表达语义 | 违反 PM 设计哲学；序列化 / 第三方 plugin 识别需要查 attrs |
| schema 约束靠手写 | 不能用 PM `content` 表达式直接约束 |
| 跨 view 渲染要查 attrs | Graph / Canvas / 等其他 view 渲染 atom 时要判断 level，多一层逻辑 |
| 未来扩展 heading 行为困难 | level 改成属于节点类型差异（heading vs paragraph）的特殊行为时，要往 attrs 上堆，代码越来越脏 |

### 2.2 现在改 vs 未来改

**现在改的成本**：
- V2 无真实用户数据（按 N7 决议）
- 代码改动约 200-500 行，1-2 天工程量
- 数据迁移**零成本**

**未来改的成本**（推迟至积累用户数据后）：
- 数据迁移：text-block + level → paragraph / heading 的迁移脚本
- schema 版本号 / 兼容读取旧数据
- 用户数据丢失风险
- 已积累的依赖 text-block 的业务代码（每天都在增长）

→ **现在改是 1-2 天工程，推迟改是 N 周项目**。

### 2.3 为什么数据建模规范要 V2 改造对齐

数据建模规范（Phase 1/2a/2b）一直按"PM 标准 paragraph + heading 分离"假设展开。如果 V2 不改造：

- naming-conventions.md / decision 002 / mixins/text-flow.md 等文档**永远跟 V2 实际不对齐**
- 每写一份新文档都要标注"V2 当前 / 目标态"两套
- Phase 2c 23 份 block 子文档全要写双口径
- Audit 会不断指出文档与实现脱节

→ **改 V2 = 文档对齐 V2，单口径**。文档不动 = 永久双口径。

---

## 3. 节点 schema 目标态

### 3.1 paragraph 节点完整 spec

```ts
// 目标位置: src/drivers/text-editing-driver/blocks/paragraph/spec.ts

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const paragraphNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /**
     * 文档标题标识。
     * - true: 该 paragraph 是文档标题(doc 首块)
     *   - 由 title-guard plugin 维护(doc 必须以 isTitle=true paragraph 开头)
     *   - 渲染加大字号(对齐 V1 ~32px),用 <p data-is-title="true">,不用 h1
     *   - 不允许换行(粘贴时取第一行;Enter 跳到下一段)
     * - false: 普通段落(默认)
     *
     * 决议: D1 保留 noteTitle = paragraph 特殊形态(不是 heading level=1)
     */
    isTitle: { default: false },
  },
  defining: true,
  parseDOM: [
    {
      tag: 'p',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          isTitle: el.getAttribute('data-is-title') === 'true',
        };
      },
    },
  ],
  toDOM(node) {
    const isTitle = node.attrs.isTitle as boolean;
    if (isTitle) return ['p', { 'data-is-title': 'true', class: 'krig-note-title' }, 0];
    return ['p', 0];
  },
};

export const paragraphSpec: BlockSpec = {
  id: 'paragraph',
  displayName: 'Paragraph',
  spec: paragraphNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
```

### 3.2 heading 节点完整 spec

```ts
// 目标位置: src/drivers/text-editing-driver/blocks/heading/spec.ts

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const headingNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /**
     * 标题级别 1-6 (CommonMark 标准)
     *
     * 决议: D2 范围扩到 1-6 (V1 只支持 1-3,V2 schema 支持完整 1-6)
     * 默认: 1
     *
     * UI 渲染: capability.text-editing 当前可选择只样式化 1-3,
     *         schema 不限制(留扩展余地)
     */
    level: { default: 1 },
  },
  defining: true,
  parseDOM: [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
    { tag: 'h4', attrs: { level: 4 } },
    { tag: 'h5', attrs: { level: 5 } },
    { tag: 'h6', attrs: { level: 6 } },
  ],
  toDOM(node) {
    const level = node.attrs.level as number;
    return [`h${level}`, 0];
  },
};

export const headingSpec: BlockSpec = {
  id: 'heading',
  displayName: 'Heading',
  spec: headingNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
```

### 3.3 schema 兼容性约束

paragraph 和 heading 都属于 PM `block` group，可以共存于：

- `doc` content（顶层）
- `list_item` / `taskItem` content（列表项内）
- `blockquote` content（引用块内）
- `tableCell` / `tableHeader` content（表格单元格内）
- `callout` content（callout 内）
- 其他 content 含 `block` 的容器

**重要**：拆分后 doc content 表达式可能需要从隐含的 `text-block` 变为 `(paragraph | heading)`，按 schema-builder 实际拼装方式核实。

---

## 4. 受影响的代码清单

基于 grep 结果（2026-05-11 扫描），text-block 直接 / 间接影响范围：

### 4.1 核心 spec 改动（必改）

| 文件 | 改动 |
|---|---|
| `src/drivers/text-editing-driver/blocks/text-block/spec.ts` | **删除** |
| `src/drivers/text-editing-driver/blocks/paragraph/spec.ts` | **新建**（按 §3.1） |
| `src/drivers/text-editing-driver/blocks/heading/spec.ts` | **新建**（按 §3.2） |
| `src/drivers/text-editing-driver/index.ts` | 注册表移除 textBlockSpec，加 paragraphSpec / headingSpec |

### 4.2 驱动 plugin 改动（必改）

| 文件 | 改动 |
|---|---|
| `src/drivers/text-editing-driver/plugins/build-title-guard-plugin.ts` | `block.type.name === 'text-block'` 改为 `=== 'paragraph'` |
| `src/drivers/text-editing-driver/plugins/build-heading-keymap.ts` | 关键改动 —— 见 §5.7 详解 |
| `src/drivers/text-editing-driver/plugins/build-input-rules.ts` | input rules 中引用 text-block 的位置改 paragraph / heading |
| `src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts` | `'text-block'` 判断改 paragraph / heading；isTitle 检查仍在 paragraph |
| `src/drivers/text-editing-driver/plugins/build-note-link-command-plugin.ts` | text-block 引用改 paragraph（如果只针对段落） |
| `src/drivers/text-editing-driver/plugins/build-code-block-keymap.ts` | text-block 引用改对应节点 |
| `src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts` | 同上 |
| `src/drivers/text-editing-driver/plugins/build-paste-media-plugin.ts` | 同上 |

### 4.3 驱动 API 改动（必改）

| 文件 | 改动 |
|---|---|
| `src/drivers/text-editing-driver/api.ts` | `turnIntoAt` / `turnIntoSelection` 逻辑重写 —— 见 §5.8 |
| `src/drivers/text-editing-driver/blocks/image/spec.ts` | text-block 引用改 paragraph |
| `src/drivers/text-editing-driver/blocks/image/node-view.ts` | 同上 |
| `src/drivers/text-editing-driver/blocks/image/keymap.ts` | 同上 |
| `src/drivers/text-editing-driver/blocks/table/commands.ts` | 同上 |

### 4.4 跨 capability 改动（必改）

| 文件 | 改动 |
|---|---|
| `src/capabilities/canvas-text-node/atom-bridge.ts` | text-block 引用按上下文改 paragraph / heading |
| `src/capabilities/selection/index.ts` | 同上 |
| `src/capabilities/text-editing/converters/md-to-pm.ts` | Markdown → PM 时 `#` → heading{level} / 纯文本 → paragraph |
| `src/capabilities/text-editing/converters/sanitize-atoms.ts` | atom type 校验 `'paragraph'` / `'heading'` |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts` | atom → PM 节点映射 |

### 4.5 lib / slot / view 层（必改）

| 文件 | 改动 |
|---|---|
| `src/lib/atom-serializers/svg/index.ts` | atom 序列化 SVG 时 paragraph / heading 分别处理 |
| `src/lib/atom-serializers/svg/blocks/list.ts` | list 内嵌的 text-block 改 paragraph |
| `src/slot/interaction-registries/handle-registry/handle-types.ts` | text-block 类型引用改 |
| `src/views/note/link-panel/LinkPanel.tsx` | 如有 text-block 类型判断改 |

### 4.6 文档侧（必改）

| 文件 | 改动 |
|---|---|
| `src/drivers/COMMON-DRIVER-PROTOCOL.md` | text-block 描述改为 paragraph / heading 双节点 |
| `src/drivers/text-editing-driver/BLOCK-SPEC.md` | 同上，更新 §4.1 文本流类 block 描述 |
| `src/drivers/text-editing-driver/DESIGN.md` | 如有 text-block 提及，更新 |
| `src/views/note/DESIGN.md` | 同上 |

### 4.7 不动的文件

| 文件 | 为何不动 |
|---|---|
| `src/platform/renderer/dist/assets/index-zes_6ZZb.js` | 构建产物，自动重新生成 |
| 数据建模 docs/RefactorV2/data-model/ | 由本对话（设计师）在审计通过后反向更新（**实施者不动**） |
| V1 仓库任何文件 | 按 V2 工作纪律 |

---

## 5. 实施步骤（按顺序执行 + 每步 commit）

每完成一步**立刻 commit**，commit message 用 `feat(L6-block-decomposition step X.Y): <step name>` 格式。

### Step 5.1 — 创建分支 + 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout main
git pull   # 如有远程更新
git checkout -b feature/L6-block-decomposition main
git branch --show-current   # 确认在新分支
npm start   # 验证起点能跑（必须成功，否则不要开始改造）
# 看到 [L0]-[L5] alive 行 → 起点 OK，关闭进程，开始改造
```

**起点判据**：`npm start` 跑通 + console 出 `[L5] alive` 行。

### Step 5.2 — 创建 paragraph block 目录及文件

新建 `src/drivers/text-editing-driver/blocks/paragraph/spec.ts`，内容按 §3.1。

仅本步骤的改动 —— **不删 text-block，不改 index.ts，不改其他文件**。

**commit**: `feat(L6-block-decomposition step 5.2): 新建 paragraph block spec`

### Step 5.3 — 创建 heading block 目录及文件

新建 `src/drivers/text-editing-driver/blocks/heading/spec.ts`，内容按 §3.2。

仅本步骤的改动。

**commit**: `feat(L6-block-decomposition step 5.3): 新建 heading block spec`

### Step 5.4 — 更新 driver index.ts 注册表

在 `src/drivers/text-editing-driver/index.ts` 中：

1. import paragraphSpec / headingSpec。
2. 注册到 ENABLED_BLOCKS（替换 textBlockSpec）。
3. 移除 textBlockSpec 的 import / 注册。

**关键**：本步骤后 schema 编译可能失败（其他代码还在引用 'text-block'），但这是预期 —— Step 5.5+ 会清理。

**不 commit**（合并到 Step 5.5 commit）。

### Step 5.5 — 改 turnIntoAt / turnIntoSelection

文件：`src/drivers/text-editing-driver/api.ts`

V2 当前 `turnIntoAt` 处理 `'paragraph' | 'h1' | 'h2' | 'h3'` 是改 `text-block.attrs.level`：

```ts
// V2 当前实现 (api.ts:478-484)
if (target === 'paragraph' || target === 'h1' || target === 'h2' || target === 'h3') {
  if (node.type.name !== 'text-block') return;
  const level = target === 'paragraph' ? null : parseInt(target.slice(1), 10);
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
  view.dispatch(tr);
  view.focus();
  return;
}
```

改为按目标节点类型 setBlockType：

```ts
// 目标实现
if (target === 'paragraph') {
  // 任意 block(paragraph / heading / blockquote 等)→ paragraph
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return;
  // 保留 isTitle 仅当 node 已经是 paragraph 且 isTitle=true(不应该走到这,因为 title 不能 turnInto)
  // 默认 isTitle=false
  const tr = view.state.tr.setNodeMarkup(pos, paragraphType, { isTitle: false });
  view.dispatch(tr);
  view.focus();
  return;
}

if (target === 'h1' || target === 'h2' || target === 'h3') {
  // 任意 block → heading
  const headingType = schema.nodes.heading;
  if (!headingType) return;
  const level = parseInt(target.slice(1), 10);
  const tr = view.state.tr.setNodeMarkup(pos, headingType, { level });
  view.dispatch(tr);
  view.focus();
  return;
}
```

同时**更新 title 守门**（line 472-475）：

```ts
// V2 当前: node.type.name === 'text-block' && node.attrs.isTitle
// 改为:
if (node.type.name === 'paragraph' && node.attrs.isTitle) {
  console.warn('[text-editing-driver] turnIntoAt: 不能转换 note title 块');
  return;
}
```

同时**更新 list 包装逻辑**（line 488-505）—— text-block 引用改 paragraph：

```ts
// V2 当前:
if (!listType || !itemType || node.type.name !== 'text-block') return;

// 改为: paragraph 或 heading 都允许被包到 list 里（保留原节点类型作为 listItem 内容）
if (!listType || !itemType) return;
if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
```

类似处理 blockquote / callout / toggle 等包装逻辑。

**commit**: `feat(L6-block-decomposition step 5.4-5.5): 拆 text-block 注册 + 重写 turnIntoAt`

### Step 5.6 — 改 title-guard plugin

文件：`src/drivers/text-editing-driver/plugins/build-title-guard-plugin.ts`

V2 当前：
```ts
if (block.type.name !== 'text-block') return false;
if (!block.attrs.isTitle) return false;
```

改为：
```ts
if (block.type.name !== 'paragraph') return false;
if (!block.attrs.isTitle) return false;
```

同时 appendTransaction（补 title 时）的创建逻辑改为创建 paragraph 节点（不是 text-block）：

```ts
// 改前: schema.nodes['text-block'].create({ level: null, isTitle: true })
// 改后: schema.nodes.paragraph.create({ isTitle: true })
```

**commit**: `feat(L6-block-decomposition step 5.6): title-guard 改 paragraph 守门`

### Step 5.7 — 改 heading-keymap

文件：`src/drivers/text-editing-driver/plugins/build-heading-keymap.ts`

V2 当前：
```ts
const textBlock = schema.nodes['text-block'];
if (!textBlock) return keymap({});

const setLevel = (level: number | null): Command =>
  setBlockType(textBlock, { level });

return keymap({
  'Mod-Alt-0': setLevel(null),
  'Mod-Alt-1': setLevel(1),
  'Mod-Alt-2': setLevel(2),
  'Mod-Alt-3': setLevel(3),
});
```

改为：
```ts
const paragraph = schema.nodes.paragraph;
const heading = schema.nodes.heading;
if (!paragraph || !heading) return keymap({});

const setParagraph: Command = setBlockType(paragraph);
const setHeading = (level: number): Command => setBlockType(heading, { level });

return keymap({
  'Mod-Alt-0': setParagraph,           // 转回普通段落
  'Mod-Alt-1': setHeading(1),
  'Mod-Alt-2': setHeading(2),
  'Mod-Alt-3': setHeading(3),
});
```

D2 决议 heading.level 范围扩到 1-6，但 keymap 仅注册 1-3（与 V2 当前 UX 一致；4-6 由 schema 支持但不绑快捷键）。

**commit**: `feat(L6-block-decomposition step 5.7): heading-keymap 改 setBlockType(heading)`

### Step 5.8 — 改其他 plugin（input-rules / block-handle / 等）

按 §4.2 清单：

- `build-input-rules.ts`：Markdown 输入触发（如 `#` 转 heading）逻辑改为创建 `heading` 节点，`>` / 等触发改为对应处理。
- `build-block-handle-plugin.ts`：判断 isTitle 改 `paragraph`；其他 text-block 引用改 paragraph 或 heading（按上下文）。
- `build-note-link-command-plugin.ts`：如逻辑只关心段落，改 paragraph。
- `build-code-block-keymap.ts` / `build-link-click-plugin.ts` / `build-paste-media-plugin.ts`：text-block 引用按上下文改对应节点。

**commit**: `feat(L6-block-decomposition step 5.8): plugins 全部清理 text-block 引用`

### Step 5.9 — 改 image / table block 中的 text-block 引用

- `src/drivers/text-editing-driver/blocks/image/spec.ts` / `node-view.ts` / `keymap.ts`：caption 内嵌的 text-block 引用改 `paragraph`。
- `src/drivers/text-editing-driver/blocks/table/commands.ts`：cell 内创建 text-block 的逻辑改 paragraph。

**commit**: `feat(L6-block-decomposition step 5.9): image / table 内嵌引用清理`

### Step 5.10 — 改 capability / lib / slot 层

按 §4.4 + §4.5 清单：

- `src/capabilities/canvas-text-node/atom-bridge.ts`
- `src/capabilities/selection/index.ts`
- `src/capabilities/text-editing/converters/md-to-pm.ts`
- `src/capabilities/text-editing/converters/sanitize-atoms.ts`
- `src/capabilities/text-editing/converters/atoms-to-pm.ts`
- `src/lib/atom-serializers/svg/index.ts`
- `src/lib/atom-serializers/svg/blocks/list.ts`
- `src/slot/interaction-registries/handle-registry/handle-types.ts`
- `src/views/note/link-panel/LinkPanel.tsx`

每个文件按上下文改 text-block → paragraph / heading。

**commit**: `feat(L6-block-decomposition step 5.10): capability / lib / slot 层清理`

### Step 5.11 — 删除 text-block 目录

```bash
rm -r src/drivers/text-editing-driver/blocks/text-block
```

**commit**: `chore(L6-block-decomposition step 5.11): 删除 text-block 目录`

### Step 5.12 — 更新驱动文档

按 §4.6 清单：

- `src/drivers/COMMON-DRIVER-PROTOCOL.md`
- `src/drivers/text-editing-driver/BLOCK-SPEC.md`
- `src/drivers/text-editing-driver/DESIGN.md`
- `src/views/note/DESIGN.md`

更新所有 text-block 描述为 paragraph / heading 双节点。

**commit**: `docs(L6-block-decomposition step 5.12): driver 文档更新 paragraph + heading`

### Step 5.13 — typecheck + lint

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
npx tsc --noEmit
npx eslint src/
```

修复任何报错。

**commit**: `chore(L6-block-decomposition step 5.13): typecheck + lint pass`

### Step 5.14 — npm start 功能验证

```bash
npm start
```

按 §6 测试清单逐项验证。如有失败，定位修复后 commit `fix(L6-block-decomposition step 5.14): <issue>`。

全部通过后，发消息：
```
L6-block-decomposition 改造完成请审计
分支: feature/L6-block-decomposition
共 X commits（X 为实际数）
测试清单 §6 全部通过
```

**不要**：
- 不要合并到 main
- 不要继续做其他事（包括"顺便清理"或"顺便优化"）
- 不要写新功能
- 不要改数据建模文档（那是设计师的活）

---

## 6. 测试清单（实施完成判据）

每项必须**手动操作**验证 + 报告"通过 / 失败 + 失败原因"。**不允许靠 typecheck 通过判断功能正常**（按 [feedback_implementation_test_checklist](../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_implementation_test_checklist.md) 纪律）。

### 6.1 启动验证

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.1.1 | `npm start` | 进程跑起来，主窗口出现，console 无报错 |
| 6.1.2 | 看 console | `[L0]` `[L1]` `[L2]` `[L3]` `[L4]` `[L5]` alive 行全部出现 |
| 6.1.3 | NoteView 默认打开 | 显示一个空 NoteView，含一个 noteTitle paragraph（大字号）+ 一个空 paragraph |

### 6.2 段落操作

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.2.1 | 在 noteTitle 后回车 | 创建一个新的 paragraph（普通段落），光标进入新段落 |
| 6.2.2 | 在 paragraph 内输入文字 | 文字正常输入，段落保持 paragraph 类型 |
| 6.2.3 | 选中段落 → Slash → "Heading 1" | 段落变为 H1 大字号显示，节点类型变为 heading.level=1 |
| 6.2.4 | H1 → Slash → "Heading 2" | 节点类型保持 heading，level 变 2 |
| 6.2.5 | H2 → Slash → "Heading 3" | level 变 3 |
| 6.2.6 | H3 → Slash → "Paragraph" | 节点类型变为 paragraph，回归普通段落 |

### 6.3 noteTitle 守门

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.3.1 | 选中 noteTitle → Slash | "Turn into" 系命令对 noteTitle 无效（console.warn 提示） |
| 6.3.2 | 删除 noteTitle 内容 | 节点保留，仍是 noteTitle paragraph（不被替换） |
| 6.3.3 | 在 noteTitle 按 Enter | 不换行，光标跳到下一段（或当前末尾不变） |
| 6.3.4 | 多行文字粘贴到 noteTitle | 只保留第一行 |

### 6.4 快捷键

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.4.1 | 选中 paragraph 按 Mod-Alt-1 | 变 H1 |
| 6.4.2 | 选中 H1 按 Mod-Alt-2 | 变 H2 |
| 6.4.3 | 选中 H3 按 Mod-Alt-0 | 变回 paragraph |

### 6.5 嵌套容器

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.5.1 | 选中段落 → Slash → "Bullet List" | 段落被包成 bulletList > listItem > paragraph |
| 6.5.2 | 在 list item 内选段落 → Slash → "Heading 2" | 节点变成 heading（list item 内允许 heading） |
| 6.5.3 | 选中段落 → Slash → "Blockquote" | 段落被包成 blockquote > paragraph |
| 6.5.4 | 在 blockquote 内 → Slash → "Heading 3" | 节点变成 heading（blockquote 内允许 heading） |

### 6.6 撤销 / 重做

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.6.1 | paragraph → H1 → 撤销 | 回到 paragraph |
| 6.6.2 | 撤销 N 步 → 重做 N 步 | 状态正确恢复 |

### 6.7 Markdown 粘贴

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.7.1 | 粘贴 `# Title\n## Sub\n### Sub2\nNormal text` | 4 个独立 block：H1 / H2 / H3 / paragraph |
| 6.7.2 | 粘贴 `#### Sub3` | 创建 heading level=4（D2 决议扩到 1-6） |

### 6.8 持久化（重启不丢）

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.8.1 | 输入笔记后关闭应用，重新启动 | 笔记内容保留，paragraph / heading 节点正确 |
| 6.8.2 | 之前的 H1 / H2 / H3 重启后仍是 heading 节点（不会变成 text-block） | 状态正确 |

### 6.9 跨视图功能（如有）

| 序号 | 操作 | 期望结果 |
|---|---|---|
| 6.9.1 | 切到 canvas-text-node 编辑 | 文字编辑功能正常（canvas-text-node 复用 text-editing driver） |
| 6.9.2 | image caption 编辑 | image 内嵌 paragraph caption 可编辑 |
| 6.9.3 | table cell 编辑 | cell 内 paragraph / heading 可编辑 |

### 6.10 不准发生的事

| 序号 | 反向验证 | 期望 |
|---|---|---|
| 6.10.1 | grep `text-block` 在 src/ 内（不含 dist / node_modules / 注释） | 0 处残留 |
| 6.10.2 | console 无 `text-block` 相关报错 | 0 |
| 6.10.3 | typecheck / eslint 0 错误 0 warning | clean |

### 6.11 测试报告模板

实施完成后，按以下模板报告：

```
## L6-block-decomposition 测试报告

### 启动验证
- 6.1.1 npm start: ✓ / ✗ [失败原因]
- 6.1.2 [L0]-[L5] alive: ✓ / ✗
- 6.1.3 NoteView 默认打开: ✓ / ✗

### 段落操作
- 6.2.1 ~ 6.2.6: ✓ / ✗ [每项报告]

### noteTitle 守门
- 6.3.1 ~ 6.3.4: ✓ / ✗

### 快捷键
- 6.4.1 ~ 6.4.3: ✓ / ✗

### 嵌套容器
- 6.5.1 ~ 6.5.4: ✓ / ✗

### 撤销 / 重做
- 6.6.1 ~ 6.6.2: ✓ / ✗

### Markdown 粘贴
- 6.7.1 ~ 6.7.2: ✓ / ✗

### 持久化
- 6.8.1 ~ 6.8.2: ✓ / ✗

### 跨视图
- 6.9.1 ~ 6.9.3: ✓ / ✗

### 反向验证
- 6.10.1 grep text-block: 0 处 / 残留 N 处 [位置]
- 6.10.2 console: 干净 / 有报错 [报错]
- 6.10.3 typecheck / eslint: pass / 有 N 个错误 [详情]

### 总结
- 全部通过 / N 项失败
- 已完成 commit 数: M
- 分支: feature/L6-block-decomposition
```

---

## 7. 审计验收标准（审计师执行）

审计师（本对话）收到完成通知后执行：

### 7.1 代码合规审计

1. `git log --oneline feature/L6-block-decomposition` 查看 commit 序列，验证每步对应。
2. `grep -rn "text-block\|textBlock" src/ --include="*.ts" --include="*.tsx"` —— 应为 0（注释 / 文档 除外）。
3. `find src/drivers/text-editing-driver/blocks -name "text-block" -type d` —— 应不存在。
4. `find src/drivers/text-editing-driver/blocks -name "paragraph" -o -name "heading"` —— 两个目录都存在。

### 7.2 schema 实现审计

阅读：
- `blocks/paragraph/spec.ts` —— 与 §3.1 完全一致
- `blocks/heading/spec.ts` —— 与 §3.2 完全一致

允许的差异：注释 / 风格调整（不影响功能）。
不允许：attrs 字段差异、parseDOM / toDOM 行为差异。

### 7.3 行为审计

启动应用，手动跑 §6 测试清单中关键项（至少 6.1 / 6.2 / 6.3 / 6.5）。

### 7.4 不通过场景

如有任何 §6 测试失败 / §7.1 §7.2 §7.3 偏差：

- 写问题清单返回给实施者
- 实施者继续修 + 重新 commit
- 修完再审

如发现设计本身有问题（实施者无法按文档执行）：

- 设计师（本对话）改本文档
- 重新启动实施

### 7.5 通过后流程

审计通过 → 本对话执行：

1. `git checkout main && git merge feature/L6-block-decomposition --no-ff` （需用户授权后）
2. 切回 `feature/L6-data-modeling` 分支
3. **反向更新数据建模文档**（必改）：
    - `naming-conventions.md`: §2.4 / §5 改为 paragraph + heading 分离
    - `naming-conventions.md`: §6 N3（heading 1-6）改为已决议
    - `decisions/002-v1-fields-migration.md`: heading.level 1-3 → 1-6 改为已决议；paragraph.children → content 改为已实现
    - `mixins/text-flow.md`: 适用节点确认 paragraph / heading / blockquote 真实存在
4. commit "docs(L6-data-modeling): 反向更新对齐 L6-block-decomposition"
5. 继续 Phase 2c

---

## 8. Open Questions（实施期间可能遇到）

| 编号 | 问题 | 应对 |
|---|---|---|
| Q1 | doc content 表达式从 text-block 变 paragraph 后，schema 验证失败 | 检查 schema-builder.ts 是否硬编码 text-block；如有，改为 `paragraph | heading` |
| Q2 | atoms-to-pm 转换器 V1 atom type 是 'paragraph' / 'heading' 还是 'text-block'？ | 检查 converters/atoms-to-pm.ts 实际处理；按"atom type 字符串"原样保留（因为是数据契约） |
| Q3 | 持久化层 leveldb 已有数据怎么办？ | V2 当前无真实数据（按 N7 决议），可以清空：`rm -rf "$HOME/Library/Application Support/krig-note-v2/Local Storage"` 后重启 |
| Q4 | input-rules `# ` Markdown 风格触发 heading 时，level 怎么定？ | `# ` → level 1, `## ` → level 2, ..., `###### ` → level 6 |
| Q5 | typecheck 失败，发现某处类型联合包含 `'text-block'` 字面量 | 改为 `'paragraph' | 'heading'`；如该类型联合还有其他 block id 字面量，按上下文调整 |
| Q6 | Slash 命令显示项的 displayName | 'Paragraph' / 'Heading 1' / 'Heading 2' / 'Heading 3'（与 V2 当前一致） |

实施期间发现新问题 → 停下来等设计师补充。

---

## 9. 决议链（设计师写给审计师 + 实施者的备忘）

### 9.1 与数据建模规范的关系

本决议是 V2 代码改造任务，**为数据建模规范服务**（让 V2 实际实现对齐 Phase 1+2a+2b 文档的 PM 标准假设）。改造完成后：

- `naming-conventions.md` 不再需要"V2 当前 vs 目标态"双口径
- `mixins/text-flow.md` 适用节点 paragraph / heading / blockquote 真实存在
- Phase 2c 可以基于干净的 V2 schema 写 pm-note.md

### 9.2 已闭环的相关决议

- **decision 002 §"V1 → V2 字段判定"**: paragraph / heading children → content（PM 嵌套）已正式生效
- **decision 003 §1.1**: domain 命名按数据模型标签（pm domain 用 PM 标准节点 type）
- **decision 004 §3 N7**: V2 image caption 用 PM content 子节点（不是 attrs）—— 本改造保持一致
- **naming-conventions.md §1.2 阶梯 2 + §1.2.1 例外清单**: PM 优先规则适用于 paragraph / heading 节点命名

### 9.3 不在本决议范围

- ❌ 改其他节点的命名风格（bulletList / codeBlock / mathBlock 等仍 camelCase，不改 snake_case）
- ❌ Phase 2c 的 pm-note.md 主索引 + block 子文档（审计通过后才开始）
- ❌ src/semantic/ 目录创建（Phase 3 才做）
- ❌ V1 仓库任何改动

---

## 10. 完成后的反向更新清单（设计师审计通过后做）

本对话审计通过 + 合 main 后，**本对话**在 `feature/L6-data-modeling` 分支执行：

| 文件 | 改动 |
|---|---|
| `naming-conventions.md` | §2.4 (paragraph / heading 字段)、§5 (V1→V2 命名变更表)、§6 (N3 heading level 范围、N6 Mark 命名相关) |
| `atom/decisions/002-v1-fields-migration.md` | 标 paragraph / heading children → content 为已生效；标 heading.level 1-6 为已生效 |
| `mixins/text-flow.md` | §3 适用节点表确认 paragraph / heading / blockquote 都存在 |
| `mixins/media-resource.md` | §3 确认其他媒体节点状态（与本改造无关） |
| `README.md` | Phase 2bb 完成标记 |

新增 commit: `docs(L6-data-modeling): 反向更新对齐 L6-block-decomposition`。

---

## 11. 风险与回滚

### 11.1 风险

- 改造期间 V2 应用可能无法启动（半完成状态）
- 持久化数据可能不兼容（如有真实数据）—— 但 V2 当前无真实数据
- 跨 capability / lib / slot 引用可能漏改 —— 由 §6.10 反向验证 grep 兜底

### 11.2 回滚

如改造严重出问题：

```bash
git checkout main
git branch -D feature/L6-block-decomposition  # 删分支
```

main 不受影响。

### 11.3 不允许的回滚

- 不允许 `git push --force` main
- 不允许 `git reset --hard` 本分支以外的任何分支
- 不允许跳过 commit 直接改文件再 commit（要严格按 §5 步骤）

---

## 附录 A — 与设计师对话的关键节点

| 节点 | 实施者动作 |
|---|---|
| 实施开始 | 创建分支 + 起点验证，发"开始实施" |
| 实施期间发现文档遗漏 | 停下来发"设计师，§X.Y 有歧义：[问题]"，等设计师回复 |
| Step 5.14 完成 | 发"L6-block-decomposition 改造完成请审计" + §6.11 测试报告 |
| 审计不通过 | 收设计师问题清单 → 修复 → 再 commit → 再发 "重新请审计" |
| 审计通过 | 等设计师合并 main + 反向更新数据建模文档 |

---

*Decision 005 完整版结束。预估实施工程量 1-2 天。*
