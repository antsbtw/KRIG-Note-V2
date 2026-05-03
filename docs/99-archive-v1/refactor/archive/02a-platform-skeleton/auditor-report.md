# 审计报告：refactor/platform-skeleton

**审计阶段**：阶段 02a-platform-skeleton（基础设施类阶段，波次 2 第一阶段）
**派活基线 SHA**：`fc943e46`（task-card 强制使用，双点 diff）
**功能契约**：N/A
**总纲版本**：v2.3

## 总评

**通过**

Builder 严格按 task-card J1~J8 完成 16 子项判据。Auditor 独立验证：
- **Builder 引入 10 文件**严格落在 task-card § J6 列出的 9 文件 + Q1 隐含的 plugin-types.ts；零业务代码改动
- **5 个 ui-primitives index.ts 字节级一致性**：5 文件结构完全相同（25 行 / 类不导出 + 1 type-only import + private itemsByViewId Map + register/unregister/getItems 三方法 + 单例 export），仅 ItemType / 单例名 / 注释名词替换
- **J2 共存策略**：6 个原有 ctx 字段全部保留 + 5 个 register*Plugin 调用未动 + plugin-types.ts 仅 +1 import +1 dispatch 字段（其他 6 个字段、注释、签名 0 改动）
- **J7 三件命令独立重跑全部对账**：typecheck exit 0 / lint exit 1 (780 problems, 765 errors / 15 warnings) / lint:dirs exit 0
- **G1 字面 vs 实质判定**：lint 780 vs baseline 778，**+2 warnings 完全是 task-card § J1 / § J3 字节级模板自带的 `eslint-disable-next-line no-console` 注释引入**；errors 765 不变，与"基线 errors 一致"实质完全对齐——Auditor 接受 Builder G1 的实质判定
- **G2/G3/G4 自决全部合规**：plugin-types.ts 由 task-card Q1 + R1 明示授权；app.ts 5 行 / plugin-types.ts 5 行均属最小侵入

四处 G 段自决经独立分析全部合规。无必修问题。

---

## A. 总纲合规性

> 对照 AUDITOR-PROMPT § 三 A 段（10 条）：

- A1 **N/A** 视图层（`src/plugins/**/views/**`）无任何改动 — `find src/plugins -type d -name views` 输出空
- A2 **✅** 无新增对布局特权 API 的调用 — Auditor `git diff fc943e46..HEAD -- 'src/plugins/**'` 输出空（业务侧零改动）；`app.ts` 中 `openCompanion: openRightSlot` 是**保留**的旧字段（task-card § J2c 明示），不是新增
- A3 **N/A** 无业务代码改动，无跨插件 import 新增
- A4 **✅** WorkspaceState 无新增业务字段 — schema-* / shared/types*.ts 全部未触
- A5 **✅** Atom 无新增 view-meta — schema-* 未触
- A6 **✅** 插件目录无新建 engine/runtime/lib（baseline lint:dirs 仍 exit 0，2 条历史白名单豁免不变）
- A7 **N/A** 无新建 ViewDefinition（仅类型骨架已在阶段 01 落地）
- A8 **N/A** 无新建 Capability 实现 — `src/capabilities/` 仅 README.md 占位
- A9 **N/A** 无菜单项新增；ContextMenuItem 等已在阶段 01 声明 `command: string`
- A10 **✅** `src/shared/**` 无新增 `import 'electron'` — Auditor read plugin-types.ts，`import { IntentEvent } from './intents'` 是相对路径 type-only import；既有 `import('electron').BaseWindow` 是行内 type-only 表达式（阶段 01 已存在），未增加

## B. 功能契约保留

**N/A 基础设施类阶段**（无 capability 抽离 / 视图迁移工作，无契约可对账）。

## C. Step A 纯度（按 AUDITOR-INSTRUCTION § 四借用语义）

- C1 **✅** "diff 仅含 task-card 列出的 9 文件 + Q1 隐含 plugin-types.ts" — 见下方 J6 段
- C2 **✅** 无顺手优化（命名 / 注释清理 / 抽象提取）— Auditor 独立 read 10 文件每处改动均限于 task-card 字面授权
- C3 **✅** useEffect / hook / event listener 数量未变 — 不涉及 .tsx
- C4 **✅** npm 包 import 列表（业务侧）无变化 — package.json 未触
- C5 **✅** 无新增/删除 useState / useRef — 不涉及 React

## D. Step B 合规

跳过（本阶段非 Step B）。

## E. 测试与验收（J1~J8 完成判据对账）

### J1：intent-dispatcher.ts 字节级对账

Auditor 独立 read [src/main/workspace/intent-dispatcher.ts](src/main/workspace/intent-dispatcher.ts) 全 25 行，与 task-card § J1 第 32~57 行逐字符对照：
- 第 1 行 type-only import ✅
- 第 3~12 行 类注释 + 引用总纲 § 1.1 / § 5 ✅
- 第 13~22 行 IntentDispatcher 类 + dispatch 方法（含 `// eslint-disable-next-line no-console` 第 19 行 + console.log 第 20 行）✅
- 第 24~25 行 单例 export ✅
- 末尾 LF ✅

### J2：app.ts ctx 加 dispatch + plugin-types.ts 同步

Auditor `git diff fc943e46..HEAD -- src/main/app.ts` 实测（共 +5 行）：
- **J2a** [✅] line 50 含 `dispatch: (event: IntentEvent) => intentDispatcher.dispatch(event),`
- **J2b** [✅] 顶部 import 区 +2 行：`import { intentDispatcher } from './workspace/intent-dispatcher';` + `import type { IntentEvent } from '@shared/intents';`
- **J2c** [✅] 6 个原有 ctx 字段全保留：getMainWindow / openCompanion / ensureCompanion / getSlotBySenderId / getActiveViewWebContentsIds / runWithProgress
- **J2d** [✅] 5 个 register*Plugin 调用全保留：`registerNotePlugin(ctx)` / `registerEBookPlugin(ctx)` / `registerWebPlugin(ctx)` / `registerThoughtPlugin()` / `registerGraphPlugin(ctx)`（thought 不传 ctx 是历来如此，task-card R6 + Builder § C 已确认）

**plugin-types.ts 同步**（task-card Q1 答案的 J2 隐含变更）：
Auditor `git diff fc943e46..HEAD -- src/shared/plugin-types.ts` 实测仅 5 行新增：
- 第 9 行 `import type { IntentEvent } from './intents';`
- 第 37~38 行 `dispatch: (event: IntentEvent) => void;` 字段 + 一行注释
- 6 个原有字段（getMainWindow / openCompanion / ensureCompanion / getSlotBySenderId / getActiveViewWebContentsIds / runWithProgress）签名 + 注释完全未触
- 满足 AUDITOR-INSTRUCTION § 三 关注点 4 字面要求

### J3：command-registry.ts 字节级对账

Auditor 独立 read [src/renderer/ui-primitives/command-registry.ts](src/renderer/ui-primitives/command-registry.ts) 全 37 行，与 task-card § J3 第 101~138 行逐字符对照：
- 第 1 行 type-only import `CommandHandler` ✅
- 第 3~12 行 类注释 + 引用总纲 § 5.5 强约束第 2 条 ✅
- 第 13~35 行 `CommandRegistryImpl` 类不导出 + register/unregister/get/has 4 方法 + 重复注册 console.warn ✅
- 第 37 行 `export const commandRegistry = new CommandRegistryImpl();` ✅

### J4a/J4b：5 个 ui-primitives 子目录 index.ts 字节级一致性

Auditor 独立 read 5 文件全文（每文件 25 行），逐行对比框架结构：

| 文件 | 行数 | ItemType | 单例名 | 注释名词 |
|---|---|---|---|---|
| [context-menu/index.ts](src/renderer/ui-primitives/context-menu/index.ts) | 25 | `ContextMenuItem` | `contextMenuRegistry` | 右键菜单 |
| [toolbar/index.ts](src/renderer/ui-primitives/toolbar/index.ts) | 25 | `ToolbarItem` | `toolbarRegistry` | 工具栏 |
| [slash/index.ts](src/renderer/ui-primitives/slash/index.ts) | 25 | `SlashItem` | `slashRegistry` | Slash 命令 |
| [handle/index.ts](src/renderer/ui-primitives/handle/index.ts) | 25 | `HandleItem` | `handleRegistry` | 块手柄菜单 |
| [floating-toolbar/index.ts](src/renderer/ui-primitives/floating-toolbar/index.ts) | 25 | `FloatingToolbarItem` | `floatingToolbarRegistry` | 浮动工具栏 |

5 文件结构完全一致（每文件均为：1 type-only import + 类注释引用 § 5.4 + § 5.7 + class XxxRegistryImpl 不导出 + private itemsByViewId Map + register/unregister/getItems 三方法 + export const xxxRegistry 单例）。**仅 ItemType / 单例名 / 注释名词替换，无任何额外差异**（满足 AUDITOR-INSTRUCTION § 三 关注点 2）

### J5/J5b：src/capabilities/ 占位

Auditor 独立 read [src/capabilities/README.md](src/capabilities/README.md) 全 24 行，与 task-card § J5 第 209~234 行字节级对照一致 ✅
- 标题 "# Capabilities" ✅
- "## 当前状态(阶段 02a-platform-skeleton)" 段 ✅
- "## 设计原则" 含 § 1.3 / § 5.4 / § 5.5 / § 5.8 4 个引用 ✅
- "## 不在本目录的实现" 段 ✅

**J5b**：Auditor `find src/capabilities -type d` 仅输出 `src/capabilities` 自身 ✅；`find src/capabilities -type f` 仅输出 `src/capabilities/README.md` ✅。**无任何 `<x>/` 子目录、无任何 .ts/.js/.mjs 文件**。

### J6：双点 diff + 显式基线 SHA 范围核对

Auditor `git diff fc943e46..refactor/platform-skeleton --name-only` 实测：

```
docs/refactor/stages/02a-platform-skeleton/AUDITOR-INSTRUCTION.md   ← Commander 派活 commit 0f73f53e
docs/refactor/stages/02a-platform-skeleton/BUILDER-INSTRUCTION.md   ← 同上
docs/refactor/stages/02a-platform-skeleton/README.md                ← 同上
docs/refactor/stages/02a-platform-skeleton/task-card.md             ← 同上
src/capabilities/README.md                                          ← Builder J5
src/main/app.ts                                                     ← Builder J2a/J2b
src/main/workspace/intent-dispatcher.ts                             ← Builder J1
src/renderer/ui-primitives/command-registry.ts                      ← Builder J3
src/renderer/ui-primitives/context-menu/index.ts                    ← Builder J4
src/renderer/ui-primitives/floating-toolbar/index.ts                ← Builder J4
src/renderer/ui-primitives/handle/index.ts                          ← Builder J4
src/renderer/ui-primitives/slash/index.ts                           ← Builder J4
src/renderer/ui-primitives/toolbar/index.ts                         ← Builder J4
src/shared/plugin-types.ts                                          ← Builder J2 隐含(Q1)
```

去除 4 个 docs（属 Commander 派活 commit `0f73f53e`，不计 Builder 越界），**Builder 实际引入 10 文件**：
- 9 文件 = task-card § J6 字面清单
- 1 文件 = plugin-types.ts（task-card Q1 答案明示授权 + R1 提醒预批 + AUDITOR-INSTRUCTION 关注点 5 列入"加上 J2 隐含的 plugin-types.ts 是 10 个"）

[10 文件] 与 task-card 授权范围**完全吻合** ✅

**业务代码零改动**（独立 grep 验证）：
- `git diff fc943e46..HEAD -- 'src/plugins/**'` 输出空 ✅
- `git diff fc943e46..HEAD -- 'src/renderer/navside/**' 'src/main/menu/**' 'src/main/ipc/**' 'src/shared/types/schema-*.ts' 'src/shared/intents.ts' 'src/shared/ui-primitives.ts' 'eslint.config.mjs' 'tsconfig.json' 'package.json' 'CLAUDE.md'` 输出空 ✅

### J7：三件命令独立重跑

| 命令 | Builder 报告 | Auditor 独立实测 | 结果 |
|---|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 | ✅ |
| `npm run lint` | exit 1, 780 problems (765 errors, 15 warnings) | exit 1, 780 problems (765 errors, 15 warnings) | ⚠️ 见下方 G1 实质判定 |
| `npm run lint:dirs` | exit 0 | exit 0, "2 条历史 baseline 白名单已豁免" | ✅ |

### J8：commit message

5 条 Builder commit 全为 `feat(refactor/platform-skeleton): ⋯` 格式，符合 CLAUDE.md 提交规范 ✅

| # | SHA | Message |
|---|---|---|
| 1 | `3584482a` | `feat(refactor/platform-skeleton): 新建 main/workspace/intent-dispatcher` |
| 2 | `ccf13066` | `feat(refactor/platform-skeleton): app.ts ctx 加 dispatch + plugin-types 同步` |
| 3 | `46d1386f` | `feat(refactor/platform-skeleton): renderer/ui-primitives/command-registry` |
| 4 | `126462dc` | `feat(refactor/platform-skeleton): 5 个 ui-primitives 子目录骨架` |
| 5 | `1c9ea5d1` | `feat(refactor/platform-skeleton): src/capabilities/ 占位 README` |

## 关注点逐项对账（AUDITOR-INSTRUCTION § 三）

- **关注点 1（J1/J3/J4/J5 字节级对账）** [✅] 见 § E 各对应判据
- **关注点 2（J4 5 个 index.ts 内部一致性）** [✅] 5 文件 25 行结构完全相同，仅 task-card 授权的 3 处替换
- **关注点 3（J2 共存策略 7 字段 + 5 register 调用）** [✅] grep `register(Note|EBook|Web|Thought|Graph)Plugin` 5 个调用全在；6 个原有 ctx 字段 + 1 个新 dispatch = 7 字段全在
- **关注点 4（J2 PluginContext 接口同步）** [✅] plugin-types.ts diff 仅 +5 行：1 import + 4 行 dispatch 字段（含注释 + 空行）；其他 6 字段 / 类型 / 注释零改动
- **关注点 5（范围越界）** [✅] 业务代码零改动；schema-* / intents.ts / ui-primitives.ts / ESLint config / tsconfig.json / package.json / CLAUDE.md 全部未触
- **关注点 6（src/capabilities/ 仅占位）** [✅] `find src/capabilities` 仅 1 目录 + 1 README.md
- **关注点 7（J7 三件命令独立重跑）** [✅] typecheck=0 / lint=1 (780) / lint:dirs=0；780 vs baseline 778 字面差 +2 但实质合规——见下方 G1
- **关注点 8（J6 双点 diff + 显式基线 SHA）** [✅] 全程使用 `git diff fc943e46..refactor/platform-skeleton`，未用 `main...HEAD` 三点
- **关注点 9（Builder G 段自决检查）** [✅] 4 处自决独立分析见下方"G 段自决独立分析"

## G 段自决独立分析（4 处）

### G1（J7b lint 778 → 780，+2 unused-disable warnings）

**字面 vs 实质判定**：

| 维度 | 字面要求 | 实测 | 判定 |
|---|---|---|---|
| exit code | exit 1 | exit 1 | ✅ 字面通过 |
| 总 problems | "778 与基线一致" | 780 (+2) | ⚠️ 字面**不**通过 |
| errors 数 | 隐含字面（baseline 含 765 errors） | 765 不变 | ✅ 实质通过 |
| 新增 problem 来源 | task-card 隐含期待 = 0 | +2 warnings 来自 task-card § J1 / § J3 **字节级模板自带**的 `eslint-disable-next-line no-console` | task-card 自纪元矛盾 |

**Auditor 独立验证 +2 warnings 的精确来源**：
```
src/main/workspace/intent-dispatcher.ts:19:5  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
src/renderer/ui-primitives/command-registry.ts:18:7  warning  Unused eslint-disable directive (no problems were reported from 'no-console')
```

这 2 行精确对应 task-card § J1 第 22 行 + § J3 第 119 行字节级模板自带的 `// eslint-disable-next-line no-console`。

**Auditor 独立判定**：✅ 接受。
1. **task-card 自纪元矛盾**：J1 / J3 关键约束 "**字节级照抄上述代码**" 与 J7b "**778 problems 与基线一致**" 在当前 ESLint config（无 `no-console` 规则）下**强制冲突**——Builder 必须二选一
2. Builder 选择保留字节级（满足 task-card § J1 / § J3 关键约束 + AUDITOR-INSTRUCTION 关注点 1 字节级对账）+ 牺牲 J7b 字面（接受 +2 warnings）→ 这是 task-card 矛盾下的最优工程选择
3. **errors 765 不变**——本阶段新增的 9 文件未引入任何 lint **error**（J7b 隐含的"基线一致"实质语义满足）
4. **+2 warnings 是 task-card 模板自身的副作用**，非 Builder 引入的违规——任何后续 Builder 字节级照抄同样模板都会复现这 2 条 warning
5. AUDITOR-INSTRUCTION 关注点 7 字面要求 "778 problems"，但同条说明"本阶段创建的 9 个新文件不应引入新 lint problem（如有，说明新文件违规或 ESLint 配置漂移）"——Auditor 独立分析判定 **+2 warnings 既不是新文件违规、也不是 ESLint 配置漂移**，而是 task-card 模板与 ESLint config 之间的不对齐，因此符合该条说明的实质意图

**记录给 Commander 关注**：task-card 模板与 ESLint config 之间的对齐问题。Commander 可在 02b 起草时考虑：
- A. 在 `eslint.config.mjs` 启用 `no-console: 'warn'`（让模板的 disable 注释变有用）
- B. 修订 task-card 模板删除 `eslint-disable-next-line no-console`（让模板与现状一致）
- C. 接受这 2 条 unused-disable warning 作为模板已知小副作用

### G2（J6 9 文件 vs 实际 10 文件 — plugin-types.ts 隐含）

事实根因：task-card § J6 列字面 9 文件，Builder 引入 10 文件（plugin-types.ts 多 1）。

**Auditor 独立判定**：✅ 接受。
1. task-card "待 Builder 反问的预期问题" Q1 明示授权："**追加**(在 src/shared/plugin-types.ts 同步加 dispatch: (event: IntentEvent) => void + import IntentEvent)。J2 应隐含此变更"
2. task-card § R1 已 grep 验证："各 plugin 类型应已自动接受(plugin-types.ts PluginContext 接口需确认是否影响)——Builder 启动后第一步实测 npm run typecheck 是否通过(预期通过——dispatch 字段在 PluginContext 接口中可能需要追加)"
3. AUDITOR-INSTRUCTION § 三 关注点 5 自身列出："Builder 引入的 diff 必须严格仅含以下 9 个文件（task-card § J6 列表，**加上 J2 隐含的 plugin-types.ts 是 10 个**）"——Auditor 指令字面已认可这是 10 个
4. plugin-types.ts diff 严格限于 PluginContext 接口字段追加 + import IntentEvent，不动其他类型 / 注释 / 字段（关注点 4 实测验证）

### G3（app.ts 5 行最小侵入）

Auditor `git diff fc943e46..HEAD -- src/main/app.ts` 实测仅 +5 行（无 - 行）：
- +2 行 import（line 7-8）
- +2 行 ctx 内注释（line 41-42）
- +1 行 dispatch 字段（line 50）

**Auditor 独立判定**：✅ 接受。task-card § J2 字面要求 "**追加**两行" + "顶部 import 区追加" + "**不删除**任何现有 ctx 字段" + "**不修改**任何 register*Plugin 调用"。Builder 5 行改动严格符合每条字面，无任何额外字符变动。

### G4（plugin-types.ts 5 行最小侵入）

Auditor `git diff fc943e46..HEAD -- src/shared/plugin-types.ts` 实测仅 +5 行（无 - 行）：
- +1 行 import（line 9）
- +3 行 dispatch 字段块（line 37 注释 + line 38 类型 + 1 空行）
- +1 行 顶部 import 段后空行（line 10）

**Auditor 独立判定**：✅ 接受。task-card 提醒 1 字面要求："**仅追加** dispatch 字段 + import IntentEvent；**绝不**修改其他 PluginContext 字段 / 类型定义 / 注释"。Builder 5 行改动严格符合，6 个原有字段（getMainWindow / openCompanion / ensureCompanion / getSlotBySenderId / getActiveViewWebContentsIds / runWithProgress）签名、注释、JSDoc 完全 0 改动（Auditor 独立 read 验证）。

---

## 必修问题（不修无法通过）

无。

## 待 Builder 证明

无。所有判据均由 Auditor 独立 read + 独立重跑命令 + 独立 grep 验证。

## 建议（非阻塞，仅供参考）

1. **task-card 模板 vs ESLint config 对齐**（采纳 G1 隐含建议）：当前 task-card § J1 / § J3 模板自带 `eslint-disable-next-line no-console`，但 ESLint config 未启用 `no-console`，导致字节级照抄触发 unused-disable warning。Commander 可在 02b 起草时三选一处置：
   - A. ESLint config 启用 `no-console: 'warn'`（让模板的 disable 注释变有用）
   - B. 修订 task-card 模板删除 disable 注释（让模板与现状一致）
   - C. 接受为已知模板小副作用（J7b 判据未来允许 errors 一致 + warnings 容忍 ±2）
2. **task-card § J7b 表述改进**：当前 J7b 字面写"778 problems 与基线一致"，建议将"基线一致"语义化为"errors 数与基线一致 + 新文件不引入 errors"——避免 warnings 字面差异成为审计阻塞点。本阶段 G1 矛盾的根源就在 J7b 字面要求过严。
3. **task-card § J6 模板改进**（与阶段 00 / 00x / typecheck-baseline / 01 同提议）：跨多会话 / 含 Commander 派活 commit 的 stage，task-card § J6 已通过显式基线 SHA `fc943e46` + 双点 diff 解决——本阶段是 Commander 已完整应用 § 六新纪律的首例，**实测有效**。后续阶段沿用此模板即可（不再是建议，已成既定规则）。
4. （提示给 Commander）merge 后建议在 main 上重跑 `npm run typecheck` / `npm run lint` / `npm run lint:dirs`，预期分别 0 / 1 (780, 765e + 15w) / 0，确认 main 基线稳定后再启动阶段 02b。02b 起草需考虑 ProseMirror 69 文件 + Three.js 8 文件的 capability 拆分粒度（按 capability 维度可能拆为多个独立 PR）。

---

（报告结束，不展开讨论）
