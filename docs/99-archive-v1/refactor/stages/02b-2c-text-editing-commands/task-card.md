# 任务卡：refactor/text-editing-commands（阶段 02b-2c-text-editing-commands）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`fe219294`（main HEAD）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2 推进策略 / § 5.4 数据契约 / § 5.5 强约束 / § 5.8 视图是声明实现都在 Capability 里
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability + CommandHandler
- 现有命令（capability 引用对象，**不修改**）：[src/plugins/note/commands/editor-commands.ts](../../../../src/plugins/note/commands/editor-commands.ts)
- 02b-2b 产物：[src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第四步（02b 系列收尾）：textEditingCapability commands 字段填入**

将 02b-2b 已含 schema/converters 的 textEditingCapability **填入 commands 字段**——临时引用 `plugins/note/commands/editor-commands.ts` 内 8 个核心文本编辑命令。

**重要决策记录**：原计划 02b-2c 是 createInstance 临时引用，但 Commander 探查发现 NoteEditor.tsx PM 实例创建与 React 生命周期深度耦合（5 ref + 回调链 + dispatchTransaction 副作用），临时引用模式失效。**跳过**——createInstance 推到波次 3 note 整体迁移时一并抽工厂。

本阶段（重命名后的 02b-2c）做 commands 临时引用——是 02b-2 系列收尾。

**核心命题**：与 02b-2b 同模式——capability 通过 import plugin 内导出的命令函数**声明意图**，不搬业务代码、不动 plugin 文件。

**非目标**：
- ❌ 不实现 createInstance 字段（推到波次 3）
- ❌ 不搬迁 commands/ 任何文件
- ❌ 不动 plugins/note/commands/editor-commands.ts 任何字符
- ❌ 不引入 AI / Thought / Markdown / Frame 等领域命令（避免 capability.text-editing 跨域，留后续阶段）

## 本分支只做

按以下顺序：

### J1：升级 `src/capabilities/text-editing/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability, ConverterPair, CommandHandler } from '@shared/ui-primitives';
import type { Atom } from '@shared/types/atom-types';
import type { Node as PMNode } from 'prosemirror-model';
import { converterRegistry } from '@plugins/note/converters/registry';
import { blockRegistry } from '@plugins/note/registry';
import {
  toggleMarkCommand,
  applyLink,
  removeLink,
  indentBlockAt,
  outdentBlockAt,
  setTextAlign,
  insertInlineMath,
  deleteCurrentBlock,
} from '@plugins/note/commands/editor-commands';

/**
 * capability.text-editing — 富文本编辑能力
 *
 * 阶段 02b-2c 升级(02b 系列收尾):commands 字段填入(临时引用 8 个核心
 * 文本编辑命令)。textEditingCapability 5 字段最终态:
 * - ✅ id(02b-1 落)
 * - ✅ schema = blockRegistry(02b-2b 临时引用)
 * - ✅ converters = textEditingConverters(02b-2b 临时引用)
 * - ✅ commands = textEditingCommands(本阶段临时引用)
 * - ⏳ createInstance:undefined(推到波次 3)
 *
 * **createInstance 跳过原因**:NoteEditor.tsx PM 实例创建与 React 生命周期
 * 深度耦合(5 ref + 回调链 + dispatchTransaction 副作用),临时引用模式失效。
 * 波次 3 note 整体迁移时一并抽工厂函数。
 *
 * **临时引用模式**(总纲 § 2 推进策略"新旧 API 共存"):
 * 本阶段不搬业务代码,而是引用 plugins/note/ 内现有命令导出。真搬迁推到
 * 波次 3 note 整体迁移时做。
 *
 * 详见总纲 § 5.4 数据契约 + § 5.5 强约束 + § 5.8 视图是声明实现都在
 * Capability 里。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - note.editor / note.thought
 * - graph.canvas 节点 label / graph.* 边 label
 * - 未来 timeline 描述
 */

const textEditingConverters: ConverterPair = {
  toAtom: (data) => converterRegistry.docToAtoms(data as PMNode) as Atom[],
  fromAtom: (atoms) => converterRegistry.atomsToDoc(atoms as Atom[]),
};

const textEditingCommands: Record<string, CommandHandler> = {
  // 文本格式化
  'text-editing.toggle-mark': toggleMarkCommand as CommandHandler,
  // 链接
  'text-editing.apply-link': applyLink as CommandHandler,
  'text-editing.remove-link': removeLink as CommandHandler,
  // 缩进
  'text-editing.indent-block': indentBlockAt as CommandHandler,
  'text-editing.outdent-block': outdentBlockAt as CommandHandler,
  // 对齐
  'text-editing.set-text-align': setTextAlign as CommandHandler,
  // 数学
  'text-editing.insert-inline-math': insertInlineMath as CommandHandler,
  // 删除
  'text-editing.delete-current-block': deleteCurrentBlock as CommandHandler,
};

export const textEditingCapability: Capability = {
  id: 'capability.text-editing',

  // schema:临时引用 plugins/note BlockRegistry 单例(02b-2b 落)
  schema: blockRegistry,

  // converters:临时引用 plugins/note converterRegistry + ConverterPair 适配(02b-2b 落)
  converters: textEditingConverters,

  // createInstance:推到波次 3(NoteEditor.tsx PM 创建与 React 深度耦合,
  // 临时引用模式失效——见 README "重要决策记录")
  createInstance: undefined,

  // commands:临时引用 plugins/note/commands/editor-commands(本阶段填,02b 系列收尾)
  commands: textEditingCommands,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 6 行（按上述顺序：Capability+ConverterPair+CommandHandler / Atom / PMNode / converterRegistry / blockRegistry / 8 个命令）
- 8 个命令引入顺序严格（toggleMarkCommand → applyLink → removeLink → indentBlockAt → outdentBlockAt → setTextAlign → insertInlineMath → deleteCurrentBlock）
- `textEditingCommands` 是模块级 const，命令 key 命名空间为 `text-editing.<kebab-case-name>`
- 8 个命令断言为 `as CommandHandler`（因 CommandHandler 用 `unknown[]` 宽松参数）
- textEditingCapability 5 字段顺序严格：id → schema → converters → createInstance → commands
- **不允许添加任何 `// eslint-disable-...` 注释**（吸收 02a G1 教训）

### J2：更新 `src/capabilities/text-editing/README.md`

02b-2b 落的 README "## 当前状态" 段含：

```markdown
## 当前状态(阶段 02b-2b-text-editing-bridge)

**schema + converters 已填(临时引用 plugin)**:`textEditingCapability` 5 字段中:
- ✅ `id` = `'capability.text-editing'`(02b-1 落)
- ✅ `schema` = `plugins/note/registry.ts` 的 `blockRegistry`(本阶段填)
- ✅ `converters` = ConverterPair 适配 `plugins/note/converters/registry.ts` 的 `converterRegistry`(本阶段填)
- ⏳ `createInstance` = 02b-2c 填(临时引用 NoteEditor PM 实例创建逻辑)
- ⏳ `commands` = 02b-2d 填(临时引用 plugins/note/commands/)

注:5 大菜单注册项 + keybindings 暂不声明(视图层职责)。

**临时引用模式说明**(总纲 § 2"新旧 API 共存"):capability 通过 import plugin
单例**声明意图**,实际代码留在 plugin 内运行。真搬迁推到波次 3 note 整体迁移
时做。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)

**4/5 字段已填,02b 系列收尾**:`textEditingCapability` 最终形态:
- ✅ `id` = `'capability.text-editing'`(02b-1 落)
- ✅ `schema` = `plugins/note/registry.ts` 的 `blockRegistry`(02b-2b 临时引用)
- ✅ `converters` = ConverterPair 适配 `plugins/note/converters/registry.ts` 的 `converterRegistry`(02b-2b 临时引用)
- ✅ `commands` = 8 个核心命令临时引用 `plugins/note/commands/editor-commands.ts`(本阶段填)
- ⏳ `createInstance` = **跳过本阶段,推到波次 3**(NoteEditor.tsx PM 创建与 React 深度耦合,临时引用模式失效)

注:5 大菜单注册项 + keybindings 暂不声明(视图层职责)。

**8 个 commands**(命名空间 `text-editing.<name>`):
- `toggle-mark` / `apply-link` / `remove-link` / `indent-block` / `outdent-block` / `set-text-align` / `insert-inline-math` / `delete-current-block`
- 不含 AI / Thought / Markdown / Frame 等领域命令(避免 capability.text-editing 跨域)

**临时引用模式说明**(总纲 § 2"新旧 API 共存"):capability 通过 import plugin 内
现有导出**声明意图**,实际代码留在 plugin 内运行。真搬迁推到波次 3 note 整体
迁移时做。
```

**关键约束**：
- **仅修改"## 当前状态"段**
- 其他段（`# capability.text-editing` 标题段 / `## 设计原则` / `## 主要消费视图(预期)` / `## 02b-2 之后的目录结构(预期)`）字节不变
- 用 Edit 工具精准替换，**不许 Write 整文件**

### J3：更新 `src/capabilities/README.md`

02b-2b 落的"## 当前状态"段含：

```markdown
## 当前状态(阶段 02b-2b-text-editing-bridge)

**已有 1 个 capability(schema/converters 字段已填,临时引用 plugin)**:
- `text-editing/`(02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b commit `a315e7e0`)——`textEditingCapability` 5 字段中 id/schema/converters 已填;createInstance/commands 留 02b-2c/d

**临时引用模式说明**:本阶段填的 schema/converters 引用 `plugins/note/` 内现有
单例(blockRegistry / converterRegistry),不搬业务代码。真搬迁推到波次 3
note 整体迁移时做。

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在
02b-3+ 按需进入此目录。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)

**已有 1 个 capability(4/5 字段已填,02b 系列收尾)**:
- `text-editing/`(02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c commit `<填 J1 commit SHA>`)——`textEditingCapability` 4 字段已填(id/schema/converters/commands),createInstance 留波次 3

**createInstance 跳过原因**:NoteEditor.tsx PM 实例创建与 React 生命周期深度
耦合,临时引用模式失效。波次 3 note 整体迁移时一并抽工厂。

**临时引用模式说明**:本阶段及前序阶段填的 schema/converters/commands 引用
`plugins/note/` 内现有导出,不搬业务代码。真搬迁推到波次 3 note 整体迁移
时做。

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在
02b-3+ 按需进入此目录。
```

**关键约束**：
- **仅修改这一个段落**
- 其他段（`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`）字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)
- 4 SHA 引用全部嵌入（02b-1 256ec984 + 02b-2a 16ca2454 + 02b-2b a315e7e0 + 02b-2c <J1>）

## 严禁顺手做

- ❌ **不修改** `src/plugins/note/` 任何文件（capability 仅引用，不动 plugin）
- ❌ **不修改** 5 处外部调用方（保持 02b-2b 约束）
- ❌ **不修改** graph atom-bridge.ts 跨插件违规（留波次 3）
- ❌ **不实现** createInstance 字段（推到波次 3）
- ❌ **不搬迁** 任何 commands/ 文件
- ❌ **不引入** AI / Thought / Markdown / Frame 等领域命令（避免跨域）
- ❌ **不创建** `text-editing/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `src/capabilities/<其他>/` 子目录
- ❌ **不修改** 任何业务代码（src/main / src/renderer / src/plugins/<其他>）
- ❌ **不修改** 阶段 01/02a/02b-1/02b-2a/02b-2b 已落核心文件除 capability 内的 index.ts/README.md 外
- ❌ **不动** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/text-editing/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: 6 行/段 import 顺序严格（Capability+ConverterPair+CommandHandler / Atom / PMNode / converterRegistry / blockRegistry / 8 命令）
- [ ] **J1 子项**: 8 个命令引入顺序严格（toggleMarkCommand → applyLink → removeLink → indentBlockAt → outdentBlockAt → setTextAlign → insertInlineMath → deleteCurrentBlock）
- [ ] **J1 子项**: `textEditingCommands` 模块级 const，含 8 个 entry，key 命名空间 `text-editing.<kebab-case>`
- [ ] **J1 子项**: 8 个命令均用 `as CommandHandler` 断言
- [ ] **J1 子项**: 5 字段顺序严格（id → schema → converters → createInstance → commands），createInstance = undefined
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J2**: `text-editing/README.md` 仅"## 当前状态"段被修改
- [ ] **J2 子项**: 标题 = "## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)"
- [ ] **J2 子项**: 其他 4 段字节不变
- [ ] **J3**: `capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 标题 = "## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)"
- [ ] **J3 子项**: 4 SHA 引用全部嵌入（256ec984 + 16ca2454 + a315e7e0 + <J1>）
- [ ] **J4**: `git diff fe219294..HEAD --stat`（**强制双点 diff + 显式基线 SHA `fe219294`**）含且仅含以下 3 个文件：
      - `src/capabilities/text-editing/index.ts`（修改）
      - `src/capabilities/text-editing/README.md`（修改）
      - `src/capabilities/README.md`（修改）
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1，**errors=765 / warnings=15** 与 02b-2b baseline 完全一致（吸收 § 六纪律 5+6）
- [ ] **J5c**: `npm run lint:dirs` exit 0（白名单豁免有效）
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/text-editing-commands): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 仅 2 个目录（无新增）
- [ ] **J8**: `find src/capabilities -type f` 仅 3 个文件（无新增）

## 已知风险

- **R1（已实测）**: Commander 已模拟实施 J1（含 8 个命令引入 + textEditingCommands const + capability 5 字段含 commands）+ 跑 typecheck=0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅
- **R2**: J2/J3 修改 README 时仅动一个段落，Builder 须用 Edit 不允许 Write
- **R3（吸收 02a G1 教训）**: task-card § J1 字节级模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄不会触发 unused-disable warning，J5b warnings=15 严格成立
- **R4**: text-editing 目录下不允许除 index.ts + README.md 外任何文件（schema.ts / commands/ / 等留波次 3 创建）
- **R5（基线锁定）**: 派活基线 `fe219294` = main 当前 HEAD（含阶段 02b-2b merge `3968297e` + 02b-2b 存档 `fe219294`）
- **R6（命令选择硬约束）**: 8 个核心命令固定（toggleMark / link / indent / setTextAlign / insertInlineMath / deleteCurrentBlock）。**不允许**Builder 自决增减——避免范围扩张
- **R7（createInstance 留 undefined 是设计）**: createInstance 不是"忘记填"——是 Commander 探查后明确决定推到波次 3。Builder 不在 task-card 范围外尝试实现 createInstance
- **R8（02b 系列收尾）**: 本阶段是 02b-2 子系列最后一阶段。完成后 02b-3+ 起草下一个 capability（如 canvas-interaction）

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认（已答）

1. **8 个命令是否需要全部引入,部分留白?** —— **Commander 答**:全部 8 个引入(R6 硬约束)
2. **命令断言为 `as CommandHandler` 是否会触发 ESLint warning?** —— **Commander 答**:不会(已实测,lint 全仓 780 不变)
3. **`textEditingCommands` 命令 key 命名空间是否要包含 `capability.` 前缀?** —— **Commander 答**:不需要(`text-editing.` 已足够命名空间化,符合总纲 § 5.5 强约束第 4 条)
4. **createInstance 字段是否需要加注释解释为什么 undefined?** —— **Commander 答**:**需要**(task-card § J1 字面已含 `// createInstance:推到波次 3...` 注释)
5. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`（按 BUILDER-PROMPT § 五格式）
- 输出"builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段（02b 系列收尾）

本次为波次 2 第二阶段第四步（commands 字段填入），**采用"临时引用 plugin"模式**——不搬业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单（预期仅 3 文件改动，与 02b-1/02b-2a/02b-2b 同模式）——**02b 系列收尾**。完成后 02b-3+ 起草下一个 capability。
