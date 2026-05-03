# 任务卡：refactor/text-editing-fields（阶段 02b-2a-text-editing-fields）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`252d8e69`（main HEAD）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 数据契约
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口（阶段 01 已落，引用）
- 02b-1 产物：[src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts) + [README.md](../../../../src/capabilities/text-editing/README.md)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第二步：升级 textEditingCapability 接口字段为占位形态**

将 02b-1 仅含 `id` 字段的 textEditingCapability 升级——增加 schema / converters / createInstance / commands 4 个字段（**全 `undefined` 占位 + 详细注释指明各子阶段填充时机**）。

**核心目的**：建立 capability 内部"字段占位待填"的形态契约，作为 02b-2b/c/d 对账标尺。

**非目标**：
- ❌ 不搬迁任何 ProseMirror 业务代码
- ❌ 不实现 createInstance / converters / schema 实质内容
- ❌ 不动 converters/ 任何文件
- ❌ 不动 components/NoteEditor.tsx 入口
- ❌ 不动任何插件代码

## 本分支只做

按以下顺序：

### J1：升级 `src/capabilities/text-editing/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability } from '@shared/ui-primitives';

/**
 * capability.text-editing — 富文本编辑能力
 *
 * 阶段 02b-2a 升级:从 02b-1 仅 id 字段升级到含字段占位形态。
 * 各字段填充时机:
 * - schema:02b-2b 搬迁 PM Schema(来自 note/registry.ts)后填实例
 * - converters:02b-2b 搬迁 converterRegistry 后填 ConverterPair 适配器
 * - createInstance:02b-2d 搬迁 NoteEditor 入口后填实例工厂
 * - commands:02b-2c 搬迁 commands/ 后填命令实现
 *
 * 详见总纲 § 5.4 数据契约 + § 5.9 能力清单。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - note.editor / note.thought
 * - graph.canvas 节点 label / graph.* 边 label
 * - 未来 timeline 描述
 */
export const textEditingCapability: Capability = {
  id: 'capability.text-editing',

  // schema:02b-2b 填(搬迁 note/registry.ts BlockRegistry 内的 PM Schema 实例)
  schema: undefined,

  // converters:02b-2b 填(搬迁 converterRegistry 单例 + 22 个 converter 后填 ConverterPair 适配器)
  converters: undefined,

  // createInstance:02b-2d 填(搬迁 NoteEditor.tsx 入口 + 9 个 PM runtime import 后填实例工厂)
  createInstance: undefined,

  // commands:02b-2c 填(搬迁 commands/ 7 文件 + plugins/ 17 文件后填命令实现)
  commands: undefined,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- 仅 1 个 type-only import(`Capability`)
- textEditingCapability 含 5 个字段(id + 4 个 undefined 占位)
- 不允许把 undefined 改为 `null` / 删除字段 / 添加额外字段
- 不允许调整字段顺序(必须按 id → schema → converters → createInstance → commands)
- **不允许添加任何 `// eslint-disable-...` 注释**(吸收 02a G1 教训)

### J2：更新 `src/capabilities/text-editing/README.md`

02b-1 落的 README "当前状态" 段含：

```markdown
## 当前状态(阶段 02b-1-text-editing-skeleton)

**仅最小骨架**:`textEditingCapability` 已实例化但仅含 `id` 字段。其他字段(5 大菜单 / schema / converters / createInstance / commands)**待 02b-2 填入**——届时搬迁 ProseMirror 69 文件(note 66 + graph 3)的核心代码进入本目录。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-2a-text-editing-fields)

**字段占位待填**:`textEditingCapability` 含 5 个字段(id + 4 个 `undefined` 占位)。各字段填充时机:
- `schema` / `converters` → 02b-2b 搬迁 converters/ + note/registry.ts 后填
- `commands` → 02b-2c 搬迁 commands/ + plugins/ 后填
- `createInstance` → 02b-2d 搬迁 NoteEditor.tsx 入口后填

注:5 大菜单注册项(contextMenu / toolbar / slash / handle / floatingToolbar) + keybindings 暂不声明(这些是视图层职责,由消费 view 自行注册)。
```

**关键约束**：
- **仅修改"## 当前状态"段**(标题 + 段内容)
- 其他段(`# capability.text-editing` 短介绍 / `## 设计原则` / `## 主要消费视图(预期)` / `## 02b-2 之后的目录结构(预期)`)**字节不变**
- 用 Edit 工具精准替换,**不许 Write 整文件**

### J3：更新 `src/capabilities/README.md`

02b-1 落的"## 当前状态"段含：

```markdown
## 当前状态(阶段 02b-1-text-editing-skeleton)

**已有 1 个 capability(仅最小骨架)**:
- `text-editing/`(commit `256ec984`)——`textEditingCapability` 实例化,仅 id 字段;实质内容由 02b-2 填入

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在 02b-2 起按需进入此目录。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-2a-text-editing-fields)

**已有 1 个 capability(字段占位待填)**:
- `text-editing/`(02b-1 commit `256ec984` + 02b-2a commit `<填 J1 commit SHA>`)——`textEditingCapability` 含 id + 4 个 `undefined` 占位字段(schema / converters / createInstance / commands);实质内容由 02b-2b/c/d 子阶段分批填入

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在 02b-3+ 按需进入此目录。
```

**关键约束**：
- **仅修改这一个段落**
- 其他段(`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`)字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)

## 严禁顺手做

- ❌ **不动** `src/capabilities/text-editing/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `text-editing/` 子目录(schema.ts / converters/ / commands/ / plugins/ 等都是 02b-2b/c/d 范围)
- ❌ **不创建** 任何 `src/capabilities/<其他>/` 子目录
- ❌ **不修改** 任何业务代码(`src/main/**` / `src/renderer/**` / `src/plugins/**` 内既有文件)
- ❌ **不修改** 阶段 01/02a/02b-1 已落文件(intents.ts / ui-primitives.ts / plugin-types.ts / intent-dispatcher.ts / app.ts / ui-primitives/* / capabilities/text-editing 已存在文件除 index.ts/README.md 外)
- ❌ **不动** ESLint 规则 / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/text-editing/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: textEditingCapability 含 5 个字段(id + 4 个 undefined),顺序 id → schema → converters → createInstance → commands
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J2**: `src/capabilities/text-editing/README.md` 仅"## 当前状态"段被修改
- [ ] **J2 子项**: 修改后段标题为"## 当前状态(阶段 02b-2a-text-editing-fields)"
- [ ] **J2 子项**: 其他段(`# capability.text-editing` 短介绍 / `## 设计原则` / `## 主要消费视图(预期)` / `## 02b-2 之后的目录结构(预期)`)字节不变
- [ ] **J3**: `src/capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 修改后段标题为"## 当前状态(阶段 02b-2a-text-editing-fields)"
- [ ] **J3 子项**: 修改后段含 02b-1 + 02b-2a 双 commit SHA 引用
- [ ] **J4**: `git diff 252d8e69..HEAD --stat`(**强制双点 diff + 显式基线 SHA `252d8e69`**)含且仅含以下 3 个文件:
      - `src/capabilities/text-editing/index.ts`(修改)
      - `src/capabilities/text-editing/README.md`(修改)
      - `src/capabilities/README.md`(修改)
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1,**errors=765 / warnings=15** 与 02b-1 baseline 完全一致(吸收 § 六纪律 5+6)
- [ ] **J5c**: `npm run lint:dirs` exit 0(白名单豁免有效)
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/text-editing-fields): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 仅 2 个目录(无新增)
- [ ] **J8**: `find src/capabilities -type f` 仅 3 个文件(无新增,与 02b-1 一致)

## 已知风险

- **R1（已实测）**: Commander 已模拟升级 textEditingCapability 含 4 个 undefined 字段后跑 typecheck exit 0,lint 全仓 780 (765e+15w) 不变。Capability 接口接受所有 optional 字段为 undefined ✅
- **R2**: J2/J3 修改 README 时仅动一个段落,Builder 须用 Edit 不允许 Write
- **R3（吸收 02a G1 教训）**: task-card § J1 字节级模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄不会触发 unused-disable warning,J5b warnings=15 严格成立
- **R4**: text-editing 目录下不允许除 index.ts + README.md 外任何文件——若 Builder 觉得"先建 schema.ts 占位也无妨"是越界,**禁止**
- **R5（基线锁定）**: 派活基线 `252d8e69` = main HEAD(含阶段 02b-1 merge `ebaa44ff` + 02b-1 存档 `252d8e69`)
- **R6（02b-2b/c/d 范围预告）**: 本阶段 task-card § J1 注释中明示了各字段在 02b-2b/c/d 的填充时机——这是规范预告,Builder 不在本阶段任何形式实现这些字段(`undefined` 占位是唯一允许形态)

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **`undefined` 占位 vs 删除字段(完全不写)?** —— **Commander 答**:用 `undefined` 占位(更明确表达"占位待填"设计意图),不允许删除
2. **textEditingCapability 字段顺序?** —— **Commander 答**:按 id → schema → converters → createInstance → commands(task-card § J1 字节级要求)
3. **是否需要在 J1 中声明 5 大菜单 / keybindings 字段?** —— **Commander 答**:不(README 已说明:5 大菜单 + keybindings 是视图层职责,由 view 自行注册)
4. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3 各一个)便于追溯
5. **如发现 Capability 接口某字段不兼容 undefined?** —— **Commander 答**:升级 BLOCKING(Commander 已实测 typecheck 通过——若 Builder 实测不通过说明环境差异,需 Commander 排查)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪:tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段

本次为波次 2 第二阶段第二步(textEditingCapability 字段占位),只升级接口形态,不动业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动,与 02b-1 同模式)——是 02b-2b/c/d 实质搬迁前的最后一道接口准备。
