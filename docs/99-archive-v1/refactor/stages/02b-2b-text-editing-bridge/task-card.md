# 任务卡：refactor/text-editing-bridge（阶段 02b-2b-text-editing-bridge）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`eab6a95a`（main HEAD）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2 推进策略 / § 5.4 数据契约 / § 5.8 视图是声明实现都在 Capability 里
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability + ConverterPair（阶段 01 已落，引用）
- 现有单例（capability 引用对象，**不修改**）：[src/plugins/note/converters/registry.ts](../../../../src/plugins/note/converters/registry.ts) + [src/plugins/note/registry.ts](../../../../src/plugins/note/registry.ts)
- 02b-2a 产物：[src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第三步：textEditingCapability schema/converters 字段填入（临时引用 plugin）**

将 02b-2a 仅 `id` + 4 个 `undefined` 占位的 textEditingCapability **填入两个字段**：
- `schema` 字段：引用 `plugins/note/registry.ts` 的 `blockRegistry` 单例
- `converters` 字段：引用 `plugins/note/converters/registry.ts` 的 `converterRegistry` 单例并适配为 `ConverterPair` 形状

**核心命题**：02b-2 子阶段全部采用"capability 临时引用 plugin"模式。本阶段不搬业务代码、不动 plugin 文件、不改 5 处外部调用方。真搬迁推到波次 3 note 整体迁移时做。

**非目标**：
- ❌ 不搬 9 个 converter 文件
- ❌ 不动 ConverterRegistry 类内部
- ❌ 不动 5 处外部调用方（types.ts / registry.ts / NoteEditor.tsx / ai-workflow / graph atom-bridge）
- ❌ 不修 graph atom-bridge.ts 跨插件违规（留波次 3）
- ❌ 不实现 createInstance / commands 字段（02b-2c/d 才填）

## 本分支只做

按以下顺序：

### J1：升级 `src/capabilities/text-editing/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability, ConverterPair } from '@shared/ui-primitives';
import type { Atom } from '@shared/types/atom-types';
import type { Node as PMNode } from 'prosemirror-model';
import { converterRegistry } from '@plugins/note/converters/registry';
import { blockRegistry } from '@plugins/note/registry';

/**
 * capability.text-editing — 富文本编辑能力
 *
 * 阶段 02b-2b 升级:从 02b-2a 4 个 undefined 占位升级到 schema + converters
 * 字段填入(临时引用 plugin/note 单例)。
 *
 * **临时引用模式**(总纲 § 2 推进策略"新旧 API 共存"):
 * 本阶段不搬业务代码,而是引用 plugins/note/ 内现有 converterRegistry +
 * blockRegistry 单例。真搬迁推到波次 3 note 整体迁移时做(届时插件级
 * 重构自然带走 converters)。
 *
 * 各字段填充时机:
 * - schema:本阶段填(blockRegistry 引用)
 * - converters:本阶段填(converterRegistry 引用 + ConverterPair 适配)
 * - createInstance:02b-2c 填(临时引用 NoteEditor 的 PM 实例创建逻辑)
 * - commands:02b-2d 填(临时引用 plugins/note/commands/ 命令函数)
 *
 * 详见总纲 § 5.4 数据契约 + § 5.8 视图是声明实现都在 Capability 里。
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

export const textEditingCapability: Capability = {
  id: 'capability.text-editing',

  // schema:临时引用 plugins/note BlockRegistry 单例
  // (本阶段 02b-2b 填;真搬迁推到波次 3 note 整体迁移)
  schema: blockRegistry,

  // converters:临时引用 plugins/note converterRegistry 单例 + ConverterPair 适配
  // (本阶段 02b-2b 填;真搬迁推到波次 3 note 整体迁移)
  converters: textEditingConverters,

  // createInstance:02b-2c 填(临时引用 NoteEditor PM 实例创建)
  createInstance: undefined,

  // commands:02b-2d 填(临时引用 plugins/note/commands/)
  commands: undefined,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 5 行（按上述顺序：Capability+ConverterPair / Atom / PMNode / converterRegistry / blockRegistry）
- 不允许调整字段顺序（必须按 id → schema → converters → createInstance → commands）
- **不允许添加任何 `// eslint-disable-...` 注释**（吸收 02a G1 教训）
- ConverterPair 适配函数必须用 `as PMNode` / `as Atom[]` 双向类型断言（因 ConverterPair 接口参数是 unknown）
- `textEditingConverters` 是模块级 const，不内联到对象字面量（便于将来重命名/扩展）

### J2：更新 `src/capabilities/text-editing/README.md`

02b-2a 落的 README "## 当前状态" 段含：

```markdown
## 当前状态(阶段 02b-2a-text-editing-fields)

**字段占位待填**:`textEditingCapability` 含 5 个字段(id + 4 个 `undefined` 占位)。各字段填充时机:
- `schema` / `converters` → 02b-2b 搬迁 converters/ + note/registry.ts 后填
- `commands` → 02b-2c 搬迁 commands/ + plugins/ 后填
- `createInstance` → 02b-2d 搬迁 NoteEditor.tsx 入口后填

注:5 大菜单注册项(contextMenu / toolbar / slash / handle / floatingToolbar) + keybindings 暂不声明(这些是视图层职责,由消费 view 自行注册)。
```

**修改为**：

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

**关键约束**：
- **仅修改"## 当前状态"段**（标题 + 段内容）
- 其他段（`# capability.text-editing` 标题段 / `## 设计原则` / `## 主要消费视图(预期)` / `## 02b-2 之后的目录结构(预期)`）字节不变
- 用 Edit 工具精准替换，**不许 Write 整文件**

### J3：更新 `src/capabilities/README.md`

02b-2a 落的"## 当前状态"段含：

```markdown
## 当前状态(阶段 02b-2a-text-editing-fields)

**已有 1 个 capability(字段占位待填)**:
- `text-editing/`(02b-1 commit `256ec984` + 02b-2a commit `<填 J1 commit SHA>`)——`textEditingCapability` 含 id + 4 个 `undefined` 占位字段(schema / converters / createInstance / commands);实质内容由 02b-2b/c/d 子阶段分批填入

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在 02b-3+ 按需进入此目录。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-2b-text-editing-bridge)

**已有 1 个 capability(schema/converters 字段已填,临时引用 plugin)**:
- `text-editing/`(02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b commit `<填 J1 commit SHA>`)——`textEditingCapability` 5 字段中 id/schema/converters 已填;createInstance/commands 留 02b-2c/d

**临时引用模式说明**:本阶段填的 schema/converters 引用 `plugins/note/` 内现有
单例(blockRegistry / converterRegistry),不搬业务代码。真搬迁推到波次 3
note 整体迁移时做。

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在
02b-3+ 按需进入此目录。
```

**关键约束**：
- **仅修改这一个段落**
- 其他段（`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`）字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)

## 严禁顺手做

- ❌ **不修改** `src/plugins/note/` 任何文件（capability 仅引用，不动 plugin）
- ❌ **不修改** 5 处外部调用方（types.ts / registry.ts / NoteEditor.tsx / ai-workflow / graph atom-bridge）
- ❌ **不修改** graph atom-bridge.ts 跨插件违规（留波次 3）
- ❌ **不搬迁** 任何 converter 文件
- ❌ **不创建** `text-editing/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `src/capabilities/<其他>/` 子目录
- ❌ **不修改** 任何业务代码（src/main / src/renderer / src/plugins/<其他>）
- ❌ **不修改** 阶段 01/02a/02b-1/02b-2a 已落核心文件除 capability 内的 index.ts/README.md 外
- ❌ **不动** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/text-editing/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: 5 行 import 顺序严格（Capability+ConverterPair / Atom / PMNode / converterRegistry / blockRegistry）
- [ ] **J1 子项**: 5 字段顺序严格 id → schema → converters → createInstance → commands
- [ ] **J1 子项**: schema = blockRegistry / converters = textEditingConverters / createInstance = undefined / commands = undefined
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J2**: `text-editing/README.md` 仅"## 当前状态"段被修改
- [ ] **J2 子项**: 标题 = "## 当前状态(阶段 02b-2b-text-editing-bridge)"
- [ ] **J2 子项**: 其他 4 段字节不变
- [ ] **J3**: `capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 标题 = "## 当前状态(阶段 02b-2b-text-editing-bridge)"
- [ ] **J3 子项**: 三 SHA 引用：`02b-1 256ec984 + 02b-2a 16ca2454 + 02b-2b <J1>`
- [ ] **J4**: `git diff eab6a95a..HEAD --stat`（**强制双点 diff + 显式基线 SHA `eab6a95a`**）含且仅含以下 3 个文件：
      - `src/capabilities/text-editing/index.ts`（修改）
      - `src/capabilities/text-editing/README.md`（修改）
      - `src/capabilities/README.md`（修改）
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1，**errors=765 / warnings=15** 与 02b-2a baseline 完全一致（吸收 § 六纪律 5+6）
- [ ] **J5c**: `npm run lint:dirs` exit 0（白名单豁免有效）
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/text-editing-bridge): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 仅 2 个目录（无新增）
- [ ] **J8**: `find src/capabilities -type f` 仅 3 个文件（无新增）

## 已知风险

- **R1（已实测）**: Commander 已模拟实施 J1（字节级照抄）+ 跑 typecheck=0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净。capability 通过 `@plugins/note/...` import 单例工作正常 ✅
- **R2**: J2/J3 修改 README 时仅动一个段落，Builder 须用 Edit 不允许 Write
- **R3（吸收 02a G1 教训）**: task-card § J1 字节级模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄不会触发 unused-disable warning，J5b warnings=15 严格成立
- **R4**: text-editing 目录下不允许除 index.ts + README.md 外任何文件（schema.ts / converters/ / commands/ / plugins/ / instance.ts 全留波次 3 创建）
- **R5（基线锁定）**: 派活基线 `eab6a95a` = main 当前 HEAD（含阶段 02b-2a merge `41c69d30` + 02b-2a 存档 `eab6a95a`）
- **R6（capability 引用 plugin 是临时反向）**: 总纲 § 5.8 长期目标是"capability 自包含、不依赖 plugin"。本阶段为节奏轻快采取"临时引用"——README 已明示，真搬迁推到波次 3。任何对此模式的反对意见应升级 BLOCKING 让 Commander 重审

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认（已答）

1. **`textEditingConverters` 是模块级 const 还是内联到对象字面量?** —— **Commander 答**:模块级 const(task-card § J1 字面)。理由:便于将来重命名/扩展;独立位置便于 Auditor 字节级对账
2. **schema 字段直接赋 blockRegistry 不需要适配?** —— **Commander 答**:不需要(SchemaContribution 是 unknown 类型,接受任何值)。这正是阶段 01 故意留宽的设计意图(总纲 § 5.4)
3. **如果 plugin/note 内 converterRegistry 单例签名将来变?** —— **Commander 答**:本阶段是"临时引用",未来 plugin/note 改了 capability 也要跟着改——这是临时引用模式的固有代价。波次 3 真搬迁后此问题消失
4. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)
5. **如果发现 Capability 接口某字段不接受 blockRegistry 这种宽类型?** —— **Commander 答**:升级 BLOCKING(Commander 已实测通过——若 Builder 实测不通过说明环境差异)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`（按 BUILDER-PROMPT § 五格式）
- 输出"builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段

本次为波次 2 第二阶段第三步（schema/converters 字段填入），**采用"临时引用 plugin"模式**——不搬业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单（预期仅 3 文件改动，与 02b-1/02b-2a 同模式）——继续验证 § 六新纪律 5/6 + 临时引用模式可行性。
