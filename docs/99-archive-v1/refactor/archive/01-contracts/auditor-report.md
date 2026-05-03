# 审计报告：refactor/contracts

**审计阶段**：阶段 01-contracts（Step A 等价 / 基础设施类子波次）
**功能契约**：N/A（基础设施类子波次）
**总纲版本**：v2.3
**task-card 版本**：v4（commit `929ac1f9`）

## 总评

**通过**

Builder 跨 3 次会话（v2/v3/v4 task-card 修订），最终在 v4 task-card 下完成 J1~J7 全部 7 项判据。Auditor 独立验证：
- **8 个文件清单**完全吻合 task-card § J6 字面（CLAUDE.md / intents.ts / ui-primitives.ts / pure-utility-allowlist.ts / eslint.config.mjs / tsconfig.json / check-plugin-dirs.sh / package.json）
- **5 条规则全部生效**：Auditor 独立创建 4 个临时违规文件 + 1 个测试目录，跑 `npx eslint` + `npm run lint:dirs`，J5.1/J5.2/J5.3 触发 error / J5.4 触发 warning / J5.5c 触发 exit 1，**J5.1 cascade 修复 commit `71f8bcda` 验证有效**（`src/plugins/note/auditor-test-j51.ts` 触发 J5.1 error）
- **三件 J7 命令全部对账**：typecheck exit 0 / lint exit 1 (778 problems 与基线一致) / lint:dirs exit 0
- **范围零越界**：业务代码 0 改动，schema-* 0 改动，所有测试残留已清理（验证后 `git status` 干净）
- **三处 G 段自决经独立分析全部合规**：J5.2 实施手段（picomatch 限制 + 9 config object 展开是合理工程选择）、J5.4 注释 fallback（task-card 明示授权）、J5.1 cascade 修复（结构性 bug 由 Builder 自行发现并修复，未越界扩展）

唯一遗留：**J5.4 cascade 在 `src/plugins/<X>/views/**` 域覆盖 J5.1 + J5.2** —— 当前无 `views/` 目录所以不构成现实影响，Builder G 段已诚实标注。Auditor 同意此问题归波次 3 起草 task-card 时处理（届时 views/ 才真正创建）。**不阻塞本阶段通过**。

---

## A. 总纲合规性

> 对照 AUDITOR-PROMPT § 三 A 段（10 条）：

- A1 **N/A** 视图层（`src/plugins/**/views/**`）无任何改动 — `find src/plugins -type d -name views` 输出空（views/ 目录尚未创建）
- A2 **N/A** 无业务代码改动
- A3 **N/A** 无业务代码改动
- A4 **✅** WorkspaceState / `shared/types*.ts` 完全未触
- A5 **✅** Atom / schema-* 完全未触
- A6 **✅** 插件目录无新建 engine/runtime/lib —— 反向，本阶段实施 J5.5 lint:dirs 主动**禁建**这些目录
- A7 **N/A** 无新建 ViewDefinition（仅类型骨架，未实例化）
- A8 **N/A** 无新建 Capability（仅类型骨架，未实例化）
- A9 **N/A** 无菜单项新增；ContextMenuItem 等 5 类菜单项类型已声明 `command: string` 字段（见 ui-primitives.ts:62~108）
- A10 **✅** `src/shared/**` 无新增 `import 'electron'` —— intents.ts / ui-primitives.ts grep 验证无任何 import 行；反向，J5.3 主动禁止 shared import electron

## B. 功能契约保留

**N/A 基础设施类子波次**（无 capability 抽离 / 视图迁移工作，无契约可对账）。

## C. Step A 纯度（按 AUDITOR-INSTRUCTION § 四借用语义）

- C1 **✅** "diff 仅含 task-card 列出的 8 文件" — 见下方 J6 解读段
- C2 **✅** 无顺手优化（命名 / 注释清理 / 抽象提取）— Auditor 独立 inspect 8 文件 diff，每处均限于 task-card 字面授权范围；既有 4 条 off 降噪未被触动
- C3 **✅** useEffect / hook / event listener 数量未变 — 不涉及 .tsx
- C4 **✅** npm 包 import 列表（业务侧）无变化 — package.json 仅追加 `lint:dirs` script，无 dependency 变化
- C5 **✅** 无新增/删除 useState / useRef — 不涉及 React

## D. Step B 合规

跳过（本阶段非 Step B）。

## E. 测试与验收（J1~J7 完成判据对账）

### J1：CLAUDE.md 重构期硬规则段（10 条禁令 + 引用总纲）

Auditor 独立读 contracts 分支 CLAUDE.md，在第 35~50 行新增章节，含 10 条禁令逐字对照 task-card § J1：

- ✅ L5 插件禁 import openCompanion / ensureCompanion / closeRightSlot / openRightSlot
- ✅ L5 改变布局只能 dispatch(IntentEvent)
- ✅ L3 WorkspaceState 禁新增业务字段（activeXxxId / expandedXxx），新状态走 pluginStates
- ✅ src/shared/** 禁 import 'electron'
- ✅ 五大交互必须通过对应 Registry 注册
- ✅ 五大交互禁组件内直接 `<Menu>` / `useState` 写菜单项
- ✅ Atom 永远不携带视图特定字段（不加 meta.view / meta.canvas / 任何 view-meta）
- ✅ 视图层禁直接 import 不在 pure-utility-allowlist 的 npm 包
- ✅ plugins/<X>/ 禁建 engine/runtime/lib 目录
- ✅ 跨插件禁 import：plugins/<X>/** 不能 import plugins/<Y>/**

段尾："违反以上任一条 = PR 拒绝合入。详见 [docs/refactor/00-总纲.md](docs/refactor/00-总纲.md)" ✅

10 条禁令逐字与 task-card § J1 的 list 一致，无遗漏、无改动既有内容。

### J2：src/shared/intents.ts

`git show refactor/contracts:src/shared/intents.ts | grep -E "^import"` 输出空 ✅
- 文件含 IntentEvent 联合类型 + 4 个 Intent 接口（ContentOpened / AiAssistanceRequested / SplitScreenRequested / LayoutModeChangeRequested）
- 字面与 task-card § J2 字节级对照一致
- 无运行时代码（grep `^const|^let|^var|^function` 输出空）

### J3：src/shared/ui-primitives.ts

`git show refactor/contracts:src/shared/ui-primitives.ts | grep -E "^import"` 输出空 ✅
- 含 task-card § J3 要求的全部 13 个类型/接口：
  - ✅ ViewDefinition / Capability / CapabilityId
  - ✅ ContextMenuItem / ToolbarItem / SlashItem / HandleItem / FloatingToolbarItem（5 类菜单项）
  - ✅ KeyBinding / CommandHandler / SchemaContribution / HostElement / CapabilityOptions / CapabilityInstance / ConverterPair
  - ✅ EnabledWhen 字面量联合 `'always' | 'has-selection' | 'is-editable'`
- 5 类菜单项与 KeyBinding 的 `command` 字段均为 `string`（不是函数），符合 task-card § J3 字面要求

### J3-补：tsconfig.json 删 rootDir

`git diff main...refactor/contracts -- tsconfig.json` 仅一处改动：删除 `"rootDir": "src",` 行。其他字段（compilerOptions 全部 / paths / include / exclude）保持不变 ✅

`include` 字段值为 `["src/**/*", "tools/**/*"]`（来自阶段 00 已合入），符合阶段 00 + J3-补的累加结果

### J4：tools/lint/pure-utility-allowlist.ts

`git show refactor/contracts:tools/lint/pure-utility-allowlist.ts` 与 task-card § J4 字节级对照：
- ✅ 文件头注释一致
- ✅ 13 项白名单（dayjs / date-fns / lodash / lodash-es / clsx / classnames / nanoid / uuid / zod / react / react-dom / zustand / jotai）顺序与 task-card 一致
- ✅ `as const` + `PureUtility` 类型导出
- ✅ 无逻辑代码

### J5：5 条 ESLint 规则（独立验证）

Auditor 创建 4 个临时违规文件 + 1 个测试目录，独立跑 `npx eslint` + `npm run lint:dirs`：

| 规则 | 测试位置 | 期望 | 实测 | 结果 |
|---|---|---|---|---|
| **J5.1**（布局特权） | `src/plugins/note/auditor-test-j51.ts` import `openCompanion` | error | `openCompanion import ⋯ restricted` no-restricted-imports error | ✅ |
| **J5.2**（跨插件） | `src/plugins/note/auditor-test-j52.ts` import `@plugins/web/foo` | error | `@plugins/web/foo import ⋯ 跨插件 import 禁止` no-restricted-imports error | ✅ |
| **J5.3**（shared 禁 electron） | `src/shared/auditor-test-j53.ts` import `electron` | error | `electron import ⋯ shared 是跨进程契约层` no-restricted-imports error | ✅ |
| **J5.4**（视图层禁外部依赖） | `src/plugins/note/views/auditor-test-j54.ts` import `three` | warning | `three import ⋯ L5 视图层禁止直接 import 重型外部依赖` no-restricted-imports **warning** | ✅ |
| **J5.5c**（lint:dirs 拦违规） | `src/plugins/note/engine/`（空目录） | exit 1 | `❌ 发现违规目录: src/plugins/note/engine` exit 1 | ✅ |

**J5.1 cascade 修复 `71f8bcda` 重点验证**：`src/plugins/note/auditor-test-j51.ts` 位于 `src/plugins/note/`（与 J5.2 `files: src/plugins/note/**` 重叠）。如果 cascade 修复未生效，J5.2 整体覆盖 J5.1 的 patterns 后，`openCompanion` 不会被拦。实测 J5.1 仍触发 error → cascade 修复（注入 `LAYOUT_PRIVILEGE_PATTERN` 到 `crossPluginImportConfigs.patterns`）**结构性有效** ✅

测试残留清理：`rm` 4 个测试文件 + `rmdir` 2 个目录（`engine/` + `views/`）后 `git status` 干净 ✅

### J5b：现有 778 problems 基线

Auditor 独立 `npm run lint > /dev/null 2>&1; echo $?` 输出 1，stderr 末尾 `✖ 778 problems (765 errors, 13 warnings)` —— **与阶段 00 基线 778 完全一致**，本阶段未引入新增 lint problem ✅

### J5.5：tools/lint/check-plugin-dirs.sh + lint:dirs script

`git show refactor/contracts:tools/lint/check-plugin-dirs.sh` 字节级对照 task-card § J5.5：
- ✅ shebang `#!/usr/bin/env bash`
- ✅ `set -euo pipefail`
- ✅ ALLOWLIST 含 2 条历史 baseline：`src/plugins/note/lib` + `src/plugins/browser-capability/runtime`
- ✅ `find src/plugins -mindepth 2 -maxdepth 2` 三类目录检测逻辑
- ✅ 段尾正面输出 "✓ 插件目录结构合规(${#ALLOWLIST[@]} 条历史 baseline 白名单已豁免...)"

`package.json:14` `"lint:dirs": "bash tools/lint/check-plugin-dirs.sh"` ✅

Auditor 独立 baseline 跑 `npm run lint:dirs` 输出 "✓ 插件目录结构合规(2 条历史 baseline 白名单已豁免)" exit 0 ✅

### J6：8 文件清单（含解释通过）

`git diff ca598c7a..refactor/contracts --stat` 输出（去除 docs/refactor/stages/01-contracts/）：

```
CLAUDE.md                              | 15 +++
eslint.config.mjs                      | 100 ++++
package.json                           |   1 +
src/shared/intents.ts                  |  30 +++++
src/shared/ui-primitives.ts            | 145 ++++++
tools/lint/check-plugin-dirs.sh        |  46 ++++
tools/lint/pure-utility-allowlist.ts   |  29 +++++
tsconfig.json                          |   1 -
```

8 文件，与 task-card § J6 字面清单逐项吻合 ✅

**派活基线解读**：与阶段 00 / 00x / typecheck-baseline 同模式——阶段经历 v2/v3/v4 三次 task-card 修订（commit `1e150710` / `ca598c7a` / `929ac1f9`），Builder commit 跨 3 次会话。Auditor 独立解读：

- **整阶段视角**（`ca598c7a..HEAD`）：Builder 实际改动 8 文件，与 task-card 字面要求完全吻合 → ✅
- **本会话视角**（`929ac1f9..HEAD`）：仅 5 文件（J3-补/J4/J5），属本会话续做范围
- 选取整阶段视角合理：task-card § J6 写"Builder 引入的 diff"，整阶段所有 commit 都是 Builder 改动的累加（v2 commit 已被 v3/v4 修订认可保留），Commander 派活 commit `1e150710` / `ca598c7a` / `929ac1f9` 不在 Builder 改动统计内

### J7：三件最终命令

| 命令 | Builder 报告 | Auditor 独立实测 | 结果 |
|---|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 | ✅ |
| `npm run lint` | exit 1, 778 problems | exit 1, 778 problems | ✅ |
| `npm run lint:dirs` | exit 0 (baseline) | exit 0 (baseline) | ✅ |

## 关注点逐项对账（AUDITOR-INSTRUCTION § 三）

- **关注点 1（CLAUDE.md 10 条禁令无遗漏）** [✅] 见 § E J1 段
- **关注点 2（纯类型文件无 import / 无运行时）** [✅] grep `^import` / `^const|^let|^var|^function` 双向验证 intents.ts + ui-primitives.ts 均输出空
- **关注点 3（ESLint 规则真生效 + 测试残留删除）** [✅] 5 条规则 Auditor 独立验证全部生效；`ls src/plugins/note/test-j*.ts src/plugins/note/views/test src/shared/test-j*.ts src/plugins/note/engine` 全部 "no matches"——Builder 测试文件已删，Auditor 自己的临时验证文件也已清
- **关注点 4（范围越界）** [✅] Builder 引入 diff 严格限于 task-card § J6 列出的 8 个文件 + docs/refactor/stages/01-contracts/* 修订（属 Commander 派活范围，不计 Builder 越界）；零业务代码改动；无 memory 改动；无 schema-* 改动
- **关注点 5（NON-BLOCKING 自决检查）** [✅] G 段三处自决经 Auditor 独立分析全部合规——见下方"G 段自决独立分析"

## G 段自决独立分析

### G1（J5.2 实施手段：9 个 per-plugin config + spread）

事实根因：task-card § J5.2 给的"优先方案 `patterns: ['**/plugins/!(note)/**']`"在 ESLint 10.x 内置 picomatch 中 negation `!(...)` 不被原生支持。Builder 实测验证后采用 task-card 明示的"备选方案"——逐插件单独配 `files` + `patterns` 多个 config object。

**Auditor 判定**：✅ 接受。
1. task-card § J5.2 明示了"优先方案 + 备选方案"两种实施手段，Builder 在优先方案不可行后采用备选，属于 task-card 字面授权范围内的自决
2. 用 `PLUGIN_DIRS.map(...)` 展开避免 9 份重复代码，是合理工程优化（无业务规则添加）
3. `PLUGIN_DIRS` 9 项与 `ls src/plugins/` 当前 9 个目录逐项一致（Auditor 独立 `ls src/plugins/` 验证：ai-note-bridge / browser-capability / demo / ebook / graph / note / thought / web / web-bridge）

### G2（J5.4 注释 fallback：.ts 文件无法在 .mjs 中 import）

事实根因：`.ts` 文件无法在 ESM `.mjs` 中直接 `import`（Node 不识别 `.ts`，需 ts-node/tsx loader，未在仓库装入）。task-card § J5.4 末段明示 fallback："`import { PURE_UTILITY_ALLOWLIST } from './tools/lint/pure-utility-allowlist.ts';` 即可——若失败则改用注释 '白名单单一真值见 tools/lint/pure-utility-allowlist.ts'"。

**Auditor 判定**：✅ 接受。
1. task-card 明示 fallback 路径
2. eslint.config.mjs J5.4 块上方注释 "白名单单一真值见 tools/lint/pure-utility-allowlist.ts" 实施 fallback
3. 实际拦截规则用正向黑名单实现（`three`、`prosemirror-*`、`pdfjs-dist`、`epubjs`、`@anthropic-ai/sdk`、`openai`、`elkjs`），覆盖了 task-card § J5.4 提及的 7 类高风险包

**轻微遗憾**（非阻塞）：黑名单实现意味着白名单与 ESLint 规则之间无强一致性约束（pure-utility-allowlist.ts 增删项不会自动反映到 ESLint 规则）。这是 .mjs vs .ts 工程限制下的合理折衷，记录给 Commander 关注。

### G3（J5.1 cascade 修复 commit `71f8bcda`）

事实根因：ESLint flat config 同名规则 cascade —— 当 `files` 重叠时，后面 config 的 `'no-restricted-imports'` **整体替换**前面的（不是合并 patterns）。J5.2 的 9 个 per-plugin config（`files: src/plugins/<X>/**`）与 J5.1（`files: src/plugins/**`）重叠，J5.2 整体覆盖了 J5.1 的 patterns，导致 J5.1 在 9 个已知插件目录失效。

**Builder 修复**：抽 `LAYOUT_PRIVILEGE_PATTERN` 常量，注入 `crossPluginImportConfigs` 的每个 patterns 数组。J5.1 独立 config 保留作未来新增插件（未列入 PLUGIN_DIRS）的兜底。

**Auditor 独立判定**：✅ 接受。
1. **静态分析合规**：Auditor 读 eslint.config.mjs 第 26~29 + 35~38 行结构，`LAYOUT_PRIVILEGE_PATTERN` 作为 const 抽出，`crossPluginImportConfigs.map` 把它放在每个 per-plugin patterns 数组首位 + 同时含 cross-plugin 模式 → 结构正确
2. **运行时验证**：Auditor 独立创建 `src/plugins/note/auditor-test-j51.ts` import `openCompanion`，跑 `npx eslint` 触发 J5.1 error（`L5 插件禁止直接调布局特权 API ⋯`）→ cascade 修复**实测有效**
3. **范围未越界**：cascade 修复仅改 eslint.config.mjs（task-card § J6 已列入），无新增文件 / 无新增 npm 规则 / 无业务代码改动
4. **修复属"自有缺陷自纠"**：Builder 在 J5.2 验证测试时发现自己上一个 commit 的 cascade bug 并自行修复，属于 BUILDER-PROMPT 鼓励的"实施过程发现技术缺陷立即纠正"行为，非范围扩张

### J5.4 cascade 遗留独立分析（用户特别关注）

**Builder 在 G 段诚实标注**：J5.4 `files: src/plugins/**/views/**` 与 J5.2 `files: src/plugins/<X>/**` 重叠。在 `src/plugins/<X>/views/**` 域，J5.4 的 warn 级 `'no-restricted-imports'` 整体覆盖 J5.2 的 error 级规则 → views/ 内布局特权 + 跨插件 import 失效。

**Auditor 独立分析是否需要本阶段处理**：

| 维度 | 现状 | 分析 |
|---|---|---|
| 现实影响 | 0 | `find src/plugins -type d -name views` 输出空，**当前仓库无任何 views/ 目录** |
| 何时创建 views/ | 波次 3 | 总纲 § 4.1 目标目录结构示意，views/ 由波次 3 各插件迁移时创建 |
| Builder 测试覆盖 | 完整 | J5.4 测试 `src/plugins/note/views/test/test-j54.ts` 在 views/ 内验证 warn 触发；J5.1/J5.2/J5.3 测试均在 views/ 之外，未踩遗留 |
| 长期解 | 波次 3 task-card 起草 | 届时 views/ 才真正创建，可考虑把 LAYOUT_PRIVILEGE_PATTERN + cross-plugin patterns 注入 J5.4，或重组为单一 'no-restricted-imports' 规则统一管理 |
| 阻塞本阶段？ | 否 | Builder 已在 G 段诚实标注；cascade 修复 commit message 也已记录此遗留；不增量影响真实代码 |

**Auditor 判定**：本阶段**不需要**处理 J5.4 cascade 遗留。理由：
1. 当前仓库无 views/ 目录，遗留对真实代码零影响
2. 强行在本阶段处理需要改 J5.4 规则结构（如把 LAYOUT_PRIVILEGE_PATTERN + 跨插件模式合并到 J5.4），属于规则结构性重组，超出 task-card v4 字面授权
3. 波次 3 起草 task-card 时一并审视 cascade 处理是更合理的时机——届时已有 views/ 真实路径 + 各插件迁移上下文 + 明确 warn → error 升级时机

**记录给波次 3 Commander 关注**：起草 task-card 时务必显式包含"重审 J5.4 cascade 遗留 + 把跨插件 + 布局特权模式注入 views/ 域"。

## 11 个 commit 跨 3 次会话的范围一致性

| 维度 | 检查项 | 结果 |
|---|---|---|
| 路径一致 | 所有 commit 都在 `refactor/contracts` 单一分支 | ✅ |
| 范围一致 | 11 commit 改动文件均在 task-card § J6 列出的 8 文件 + docs/refactor/stages/01-contracts/* | ✅ |
| 提交规范 | 11 commit 全为 `feat(refactor/contracts): ⋯` 或 `fix(refactor/contracts): ⋯` 格式 | ✅ |
| BLOCKING 解决 | v2 → B1 (J7c 现状冲突) → v3 加 J5.5 白名单解；v3 → B1 (rootDir/include 互斥) → v4 删 rootDir 解 | ✅ task-card 修订是 Commander 范围，Builder 在 BLOCKING 时正确停下 |
| 累加结果 | v2/v3 已 commit 的 J1+J2+J3 在 v4 续做时**未被覆盖、未被回滚**；最终 8 文件清单无重复无遗漏 | ✅ |

跨会话续做未引入范围漂移、未引入未授权改动。

---

## 必修问题（不修无法通过）

无。

## 待 Builder 证明

无。所有判据均由 Auditor 独立 read + 独立重跑命令 + 独立创建临时测试文件验证。

## 建议（非阻塞，仅供参考）

1. **波次 3 起草 task-card 时务必处理 J5.4 cascade 遗留**：当前仓库无 views/ 不构成现实影响，但波次 3 各插件迁移时会创建 `src/plugins/<X>/views/**`，届时 J5.4 warn 级会整体覆盖 J5.1 + J5.2 的 error 级。建议届时把 LAYOUT_PRIVILEGE_PATTERN + 跨插件 patterns 注入 J5.4 patterns，或重组为单一 `no-restricted-imports` 规则统一管理（含 warn → error 升级讨论）。
2. **白名单与 ESLint 规则的强一致性**（采纳 G2 隐含建议）：当前 J5.4 规则用正向黑名单实现，与 `pure-utility-allowlist.ts` 之间无强一致约束。未来可考虑写一个 build-step 脚本（`tools/lint/sync-allowlist.cjs`）把 .ts 白名单同步生成为 .mjs 中可 import 的 .json/.cjs 副本，实现单一真值到 ESLint 规则的传播。非阻塞。
3. **task-card § J6 模板改进**（与 00 / 00x / typecheck-baseline 同提议、再次重申）：跨多会话 / 含 Commander 派活 commit 的 stage，task-card § J6 应显式说明"派活基线"指**最初派活点**（修订前的最后非 Builder commit），或在 J6 里直接写出预期基线 SHA。本次跨 3 次会话后该问题再次出现。
4. **TS6059 IDE 噪声（J3-补 副作用）**：`tsconfig.json` 删 `rootDir: "src"` 后 IDE 对 `outDir` 报 TS6059 提示。`tsc --noEmit` 实测通过（typecheck exit 0），不影响 CI。Commander 可在波次 6 design-token 或独立 PR 清理 outDir / baseUrl 等过时字段（TS 7.0 baseUrl 停用）。
5. （提示给 Commander）merge 后建议在 main 上重跑 `npm run typecheck` / `npm run lint` / `npm run lint:dirs`，预期分别 0 / 1(778) / 0，确认基线稳定后再启动波次 2。

---

（报告结束，不展开讨论）
