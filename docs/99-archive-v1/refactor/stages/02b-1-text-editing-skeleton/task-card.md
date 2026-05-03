# 任务卡：refactor/text-editing-skeleton（阶段 02b-1-text-editing-skeleton）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`5b478326`（main HEAD）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 1.3 抽象原则 / § 5.4 数据契约 / § 5.9 能力清单
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口（阶段 01 已落，引用，不修改）
- 现状参考：[src/capabilities/README.md](../../../../src/capabilities/README.md)（02a 落地，占位中——02b-1 J3 同步更新）
- COMMANDER-PROMPT § 六纪律 1~6（基线 SHA / 字节级实测 / J7 errors 语义 / 模板禁含 disable 注释）

## 本次范围

**波次 2 第二阶段第一步：实例化第一个 Capability 验证契约**

仅建 `capability.text-editing` **最小骨架**——只有 `id` 字段实例化，其他所有字段（5 大菜单 / schema / converters / createInstance / commands）**不填**。

**核心目的**：验证阶段 01 落的 Capability 类型契约**正确可实例化**，作为后续所有 capability 阶段的样板。

**非目标**：
- ❌ 不搬迁任何 ProseMirror 业务代码（69 文件归 02b-2）
- ❌ 不实现 createInstance / converters / schema 实质内容
- ❌ 不动任何插件代码

## 本分支只做

按以下顺序：

### J1：新建 `src/capabilities/text-editing/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability } from '@shared/ui-primitives';

/**
 * capability.text-editing — 富文本编辑能力
 *
 * 本阶段(02b-1)仅最小骨架,验证 Capability 类型契约可实例化。
 * 实质内容(schema/converters/createInstance/commands/5 大菜单注册项)
 * 由 02b-2 搬迁 ProseMirror 业务代码时填入。
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
};
```

**关键约束**：
- **字节级照抄上述代码**
- 仅 1 个 type-only import（`Capability`）
- 仅导出 `textEditingCapability` 1 个 const
- 字段仅 `id`,其他字段全部不填(undefined)——属 Capability 接口可选字段,02b-2 才填

### J2：新建 `src/capabilities/text-editing/README.md`

**字节级照抄**：

```markdown
# capability.text-editing

富文本编辑能力(基于 ProseMirror)。详见总纲 § 5.9 能力清单 + § 5.4 数据契约。

## 当前状态(阶段 02b-1-text-editing-skeleton)

**仅最小骨架**:`textEditingCapability` 已实例化但仅含 `id` 字段。其他字段(5 大菜单 / schema / converters / createInstance / commands)**待 02b-2 填入**——届时搬迁 ProseMirror 69 文件(note 66 + graph 3)的核心代码进入本目录。

## 设计原则(总纲引用)

- § 1.3 规则 A:外部依赖必须经 Capability 封装,视图禁止直接 import
- § 5.4 数据契约:Capability 接口含 schema / converters / createInstance / commands 等字段
- § 5.5 强约束:命名空间 `capability.<name>`、禁套娃、颗粒度按"未来可扩展"
- § 5.8 视图是声明,实现都在 Capability 里——ProseMirror 是外部依赖,封装在本目录内

## 主要消费视图(预期)

- `note.editor`(完整笔记编辑器)
- `note.thought`(思考片段编辑器)
- `graph.canvas` 节点 label / `graph.*` 边 label
- 未来 `timeline.*` 描述等

## 02b-2 之后的目录结构(预期)

```
src/capabilities/text-editing/
├─ index.ts                     # textEditingCapability 完整定义
├─ README.md                    # 本文件
├─ schema.ts                    # PM block/mark 定义
├─ converters/                  # atom ↔ pm doc 双向转换
├─ commands/                    # bold/italic/link/... 命令实现
├─ plugins/                     # PM plugin 集合
├─ menu-contributions.ts        # ContextMenu/FloatingToolbar/Slash 项
└─ instance.ts                  # createInstance(host, options) 工厂
```

本阶段(02b-1)**不创建**任何上述子目录或文件——02b-2 才搬迁。
```

**关键约束**：
- **字节级照抄**
- 路径 `src/capabilities/text-editing/README.md` 严格匹配
- 不创建上述"02b-2 之后的目录结构"中预告的任何子目录或 .ts 文件

### J3：更新 `src/capabilities/README.md`

阶段 02a 落的 [src/capabilities/README.md](../../../../src/capabilities/README.md) 含一段：

```markdown
## 当前状态(阶段 02a-platform-skeleton)

**目录占位中**——尚无任何 capability 实质内容。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-1-text-editing-skeleton)

**已有 1 个 capability(仅最小骨架)**：
- `text-editing/`(commit `<填 J1 commit SHA>`)——`textEditingCapability` 实例化,仅 id 字段;实质内容由 02b-2 填入

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在 02b-2 起按需进入此目录。
```

**关键约束**：
- **仅修改这一个段落**(从"## 当前状态(阶段 02a-..." 行到下一个 `## ` 标题之前)
- 标题从"## 当前状态(阶段 02a-platform-skeleton)"改为"## 当前状态(阶段 02b-1-text-editing-skeleton)"
- 不动其他任何段落(`# Capabilities` 标题段、`## 设计原则` 段、`## 不在本目录的实现` 段全部保留)
- 列表项中的 `<填 J1 commit SHA>` Builder 在做 J3 时填具体 J1 commit SHA(如 `3584...`)

## 严禁顺手做

- ❌ **不创建** `src/capabilities/text-editing/` 下除 index.ts + README.md 外的任何文件或子目录
- ❌ **不修改** `src/capabilities/README.md` 除"## 当前状态"段以外的任何内容
- ❌ **不修改** 任何业务代码(`src/main/**` / `src/renderer/**` / `src/plugins/**` 内既有文件)
- ❌ **不修改** 阶段 01 已落的 `src/shared/intents.ts` / `src/shared/ui-primitives.ts` / `src/shared/plugin-types.ts`
- ❌ **不修改** 阶段 02a 已落的 `src/main/workspace/intent-dispatcher.ts` / `src/main/app.ts` / `src/renderer/ui-primitives/**`
- ❌ **不创建** 任何 `src/capabilities/<其他>/` 子目录(text-editing 之外的 capability 归 02b-2/3+ 起草)
- ❌ **不动** ESLint 规则 / tsconfig.json / package.json
- ❌ **不动** schema-*.ts
- ❌ **不动** memory 文件
- ❌ **不擅自做** merge / push(列命令交回 Commander)

## 完成判据

每条 Builder 必须证明:

- [ ] **J1**: `src/capabilities/text-editing/index.ts` 字节级匹配 task-card § J1
- [ ] **J2**: `src/capabilities/text-editing/README.md` 字节级匹配 task-card § J2
- [ ] **J3**: `src/capabilities/README.md` 仅"## 当前状态"段被修改;其他所有段(`# Capabilities`、`## 设计原则`、`## 不在本目录的实现`)字节不变
- [ ] **J3 子项**: 修改后的"## 当前状态"段含 `text-editing/` 列表项 + J1 commit SHA(具体 SHA Builder 在 J3 时填)
- [ ] **J4**: `git diff 5b478326..HEAD --stat`(**强制双点 diff + 显式基线 SHA `5b478326`**)含且仅含以下 3 个文件:
      - `src/capabilities/text-editing/index.ts`(新建)
      - `src/capabilities/text-editing/README.md`(新建)
      - `src/capabilities/README.md`(修改)
      - **绝不允许**用 `main...HEAD` 三点 diff
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1,**errors 数 765 不变**(本阶段不引入新 errors)、warnings 数与 02a baseline (15) 相同 ± 0(本阶段无字节级模板含 disable 注释)
- [ ] **J5c**: `npm run lint:dirs` exit 0(白名单豁免有效;不得新增违规目录)
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat(refactor/text-editing-skeleton): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 仅输出 `src/capabilities` + `src/capabilities/text-editing`(无任何额外子目录)
- [ ] **J8**: `find src/capabilities -type f` 仅输出 3 个文件(README.md + text-editing/index.ts + text-editing/README.md)

## 已知风险

- **R1(已实测)**: Commander 已模拟创建 `textEditingCapability` 实例后跑 typecheck → exit 0,lint 全仓 780 不变,新文件 lint 干净。Capability 接口可实例化,**path alias `@shared/ui-primitives` 工作正常**
- **R2**: J3 修改 `src/capabilities/README.md` 时只动一个段落,Builder 须用精准 Edit(不允许 Write 整文件——避免误改其他段落)
- **R3**: text-editing 目录下不允许创建除 index.ts + README.md 外的任何文件——若 Builder 觉得"先建 schema.ts 占位也无妨"是越界,**禁止**(02b-2 才建)
- **R4**: 视图层禁外部依赖 J5.4 规则不影响本阶段——本阶段在 `src/capabilities/` 创建,不在 `src/plugins/<X>/views/` 创建
- **R5(吸收 02a G1 教训)**: task-card § J1 / § J2 字节级模板**不含**任何 `// eslint-disable-next-line ...` 注释(对照 ESLint config 规则确认)。Builder 字节级照抄不会触发 unused-disable warning。J5b 判据"warnings ± 0"实测能通过(02a 是 ± 2,本阶段无该副作用)
- **R6(基线锁定)**: 派活基线 `5b478326` = main 当前 HEAD(已含 02a merge `0e38eb7a` + 02a 存档 `5b478326`)。Builder rebase 不必要——分支已基于此

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **textEditingCapability 是否需要在某处被 import 验证导出有效?** —— **Commander 答**:**不需要**。本阶段仅验证类型契约可实例化(typecheck 通过即可),实际调用方在 02b-2/3 由视图驱动
2. **README.md 中"02b-2 之后的目录结构"是规范预告吗?** —— **Commander 答**:**不是规范,仅参考**。02b-2 起草时由 Commander 重新决定具体子目录结构,本阶段 README 中的预告仅作沟通辅助
3. **如果发现 Capability 接口有缺陷需要修阶段 01?** —— **Commander 答**:升级 BLOCKING,不擅自修。Capability 接口在 src/shared/ui-primitives.ts 是阶段 01 落的,本阶段是"严禁顺手做"明示禁动的范围。如有缺陷需 Commander 起草前置修复任务
4. **3 个 commit 还是 1 个 commit?** —— **Commander 答**:Builder 自决。建议 3 个(J1 / J2 / J3 各一个),便于后续 git log 追溯;但 1 个含完整 message 也可

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪:tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段

本次为波次 2 第二阶段第一步(text-editing 最小骨架),只验证 Capability 接口可实例化,不动业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动,无 BLOCKING 风险)——是 02b 系列(实质 capability 封装)的样板验证。
