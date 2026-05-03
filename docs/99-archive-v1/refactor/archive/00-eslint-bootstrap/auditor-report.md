# 审计报告：refactor/eslint-bootstrap

**审计阶段**：阶段 00-eslint-bootstrap（基础设施类前置波次）
**功能契约**：N/A（基础设施类前置波次）
**总纲版本**：v2.3

## 总评

**通过**

Builder 严格按 task-card J0~J7 装入 ESLint 工具链；diff 干净（仅 5 个允许文件，0 个 .ts/.tsx 业务代码改动）；`eslint.config.mjs` 字节级匹配 task-card § J2 全文；4 条 off 降噪规则未越界扩展为业务规则；J5 三命令由 Auditor 独立重跑全部对账成功（npm install exit 0 / npm run lint exit 1 无 crash markers / npm run typecheck exit 0）。三处 G 段自决（10.x vs 9.x 字面、补装 `@eslint/js`、J6 字面 vs 实质）经独立验证均属合规自决——每条都有可追溯的事实根因 + Builder 选择最小补救路径 + 不构成范围越界，Auditor 全部接受。

---

## A. 总纲合规性

> 对照 AUDITOR-PROMPT § 三 A 段（10 条）：

- A1 **N/A** 视图层（`src/plugins/**/views/**`）无任何改动
- A2 **N/A** 无业务代码改动
- A3 **N/A** 无业务代码改动
- A4 **N/A** WorkspaceState / `shared/types*.ts` 完全未动
- A5 **N/A** Atom / schema-* 完全未动
- A6 **N/A** 无插件目录改动
- A7 **N/A** 无新建 ViewDefinition
- A8 **N/A** 无新建 Capability
- A9 **N/A** 无菜单项改动
- A10 **✅** `src/shared/**` 无新增 `import 'electron'`——`shared/` 完全未触

## B. 功能契约保留

**N/A 基础设施类前置波次**（无 capability 抽离 / 视图迁移工作，无契约可对账）。

## C. Step A 纯度（按 AUDITOR-INSTRUCTION § 四借用语义）

- C1 **✅** "任何 .ts/.tsx 业务代码改动 = 0" — `git diff main...refactor/eslint-bootstrap --stat` 中 src/ 路径下 0 个文件
- C2 **✅** 无顺手优化（命名 / 注释清理 / 抽象提取）— Auditor 独立 inspect 5 个 Builder 改动文件，每处均限于 task-card 字面授权范围
- C3 **✅** useEffect / hook / event listener 数量未变 — 不涉及 .tsx
- C4 **✅** npm 包 import 列表无变化（指业务代码） — 业务文件未触；package.json devDependencies 新增 3 个属 task-card § J0 + § G 自决授权范围
- C5 **✅** 无新增/删除 useState / useRef — 不涉及 React

## D. Step B 合规

跳过（本阶段非 Step B）。

## E. 测试与验收（J0~J7 完成判据对账）

- **J0a** [✅] `package.json:74` `"eslint": "^10.3.0"` — `^10.3.0 ⊃ ≥ ^9.0.0`，数值判据满足；语义判据由 G1 自决处理
- **J0b** [✅] `package.json:78` `"typescript-eslint": "^8.59.1"` — `≥ ^8.0.0` 满足
- **J0c** [✅] `package-lock.json` 已更新（+1151/-80），实际安装 `node_modules/eslint/package.json` version = `10.3.0`（Auditor 独立读取），`typescript-eslint@8.59.1` peerDep 显式 `eslint ^8.57 || ^9 || ^10`，组合 OK
- **J1a** [✅] `package.json:13` `"lint": "eslint ."`
- **J1b** [✅] `package.json:14` `"typecheck": "tsc --noEmit -p tsconfig.json"`
- **J1c** [✅] 原有 5 条 script `start` / `package` / `make` / `postinstall` / `build:fonts` 全部保留在 lines 8~12，未删未改（Auditor 独立 read package.json diff）
- **J2a** [✅] 仓库根目录存在 `eslint.config.mjs`（39 行 + 末尾 LF）
- **J2b** [✅] **字节级匹配**——Auditor 独立 read 全 39 行后逐行对照 task-card.md 第 60~99 行：
  - 第 1 行 `// @ts-check` ✅
  - 第 2~3 行 两个 import ✅（`@eslint/js` 默认导入 + `typescript-eslint` 默认导入）
  - 第 4 行空行 ✅
  - 第 5 行 `export default tseslint.config(` ✅
  - 第 8~22 行 ignores 14 项（顺序与 task-card 完全一致：`node_modules/** out/** .webpack/** dist/** build/** tmp/** docs/tmp/** scripts/** .vscode/** .git/** *.config.js *.config.cjs *.config.mjs`） ✅
  - 第 24 行 `eslint.configs.recommended` ✅
  - 第 25 行 `...tseslint.configs.recommended` ✅
  - 第 27~30 行 `languageOptions: { ecmaVersion: 2022, sourceType: 'module' }` ✅
  - 第 31~37 行 4 条 off：`@typescript-eslint/no-unused-vars` / `@typescript-eslint/no-explicit-any` / `@typescript-eslint/no-empty-object-type` / `no-empty` ✅
  - 第 39 行 `);` ✅
  - 中文注释（"全局忽略：..." / "阶段 00 仅装工具链..."）保留 ✅
- **J2c** [✅] `ls eslint.config.js eslint.config.cjs 2>&1` 均报 "No such file or directory"（Auditor 独立验证），无备选 config 入口
- **J3** [✅] `tsconfig.json` diff 仅 1 处：`"include": ["src/**/*"]` → `["src/**/*", "tools/**/*"]`，其他字段（`compilerOptions` / `exclude` 等）均未触
- **J4** [✅] `.gitignore:17` 在 `docs/tmp/` 之后追加 `tmp/`，单行 +1，其他无 churn
- **J5a** [✅] Auditor 独立 `npm install` 已成功（package-lock.json 在仓库内一致）
- **J5b** [✅] Auditor 独立 `npm run lint > /dev/null 2>&1; echo $?` 输出 `1`（exit 1，允许）；`grep -iE "configuration error|invalid syntax|cannot find package|oops|crash"` 输出空——**无任何 crash 标记**；ESLint 报告 778 problems（765 errors + 13 warnings），全部为仓库现有代码 lint 问题（`no-undef` 对 `setTimeout` / `document` / `Event` / `MutationObserver` 等 + `@typescript-eslint/ban-ts-comment` 等），与 Builder 报告数字完全一致
- **J5c** [✅] Auditor 独立 `npm run typecheck` 输出空 + exit 0
- **J6** [✅] 含解释通过 — 见 G3 字面解读段
- **J7** [✅] 6 条 Builder commit 全为 `feat(refactor/eslint-bootstrap): ⋯` 或 `fix(refactor/eslint-bootstrap): ⋯`，符合 CLAUDE.md 提交规范

### J6 字面解读（G3 自决的独立验证）

Auditor 重新核对：

| 命令 | 输出 | 解读 |
|---|---|---|
| `git log main..refactor/eslint-bootstrap --oneline` | 8 条 commit：2 条 docs（Commander）+ 6 条 src（Builder） | Builder 自身仅 6 commit |
| `git diff main...refactor/eslint-bootstrap --stat` | 9 个文件（4 docs + 5 文件） | 与 task-card J6 字面"5 文件"差 4 个 docs |
| `git diff 0e25ca0b..refactor/eslint-bootstrap --name-only` | 严格 5 文件：`.gitignore` / `eslint.config.mjs` / `package-lock.json` / `package.json` / `tsconfig.json` | Builder 实际改动严格吻合 task-card § J6 列表 |

**Auditor 判定**：与 00x、typecheck-baseline 完全同模式——Commander 派活 commit `7534edcd` + `0e25ca0b` 入 git 是总纲 § 7.4 信息载体原则要求；Builder 无权 reset Commander 的 commit。task-card J6 字面用 `git diff main...HEAD` 是 Commander 起草歧义，不是 Builder 越界。

## 关注点逐项对账（AUDITOR-INSTRUCTION § 三）

- **关注点 1（J2 字节级对账）** [✅] 见上方 J2b 逐行核对
- **关注点 2（范围只动 5 文件）** [✅] Builder 引入的 diff 严格 5 文件，0 个 src/ / CLAUDE.md / tools/ / docs/ 业务改动（4 个 docs/ 改动是 Commander 派活 commit 引入，非 Builder 改动）
- **关注点 3（禁顺手添加项目规则）** [✅] `eslint.config.mjs` Auditor 独立 read 全文，rules 字段仅 4 条 `'off'` 降噪，无 `no-restricted-imports` / `no-restricted-paths` / 任何 KRIG 业务规则
- **关注点 4（J0 版本号）** [⚠️→✅] `eslint` 是 `^10.3.0`（task-card 字面"9.x"），`typescript-eslint` 是 `^8.59.1` ≥ `^8`，`package-lock.json` 实际 eslint v10.3.0；G1 自决经独立分析合规——见下方 § 关注点 4 详解
- **关注点 5（J5 验证证据）** [✅] Auditor 自己重跑 `npm run lint` exit=1 + `npm run typecheck` exit=0，与 Builder 报告完全一致
- **关注点 6（原有 scripts 保留）** [✅] start / package / make / postinstall / build:fonts 5 条全部保留在 package.json:8~12，仅在 line 12 之后追加 lint + typecheck 两条
- **关注点 7（tsconfig 仅一处改动）** [✅] tsconfig.json diff 仅 `include` 字段 +`"tools/**/*"`，`compilerOptions` / `exclude` / `paths` 等字段全部未动

### 关注点 4 详解（独立验证 G1）

AUDITOR-INSTRUCTION 关注点 4 字面要求：
> `package.json` `devDependencies.eslint` 必须以 `^9` 或 `~9` 开头（不允许 `^8.x`）

实际：`^10.3.0`，**不**以 `^9`/`~9` 开头。

但同条 task-card § J0a 完成判据写的是 `≥ ^9.0.0`（数值判据）。两条字面要求互相不一致——task-card § J0 句子内同时写"主版本必须是 ESLint 9.x"（语义）和"按 npm 当前 stable"（操作要求）。

**Auditor 独立判定**：
1. **数值判据 J0a**：`^10.3.0 ≥ ^9.0.0` 满足
2. **语义判据"flat config 风格 vs 8.x legacy"**：ESLint 10.x 仍是 flat config（10.x 没退回 legacy），满足"flat 风格"语义意图
3. **操作判据"按 npm 当前 stable"**：npm 当前 stable 即 10.x，`npm install --save-dev eslint` 默认装 10.x，Builder 行为符合 task-card 操作字面
4. **AUDITOR-INSTRUCTION 关注点 4 与 task-card 完成判据 J0a 的字面冲突**：AUDITOR-INSTRUCTION 是基于 task-card 起草时假设"npm stable = 9.x"写的字面提示；J0a 数值判据 `≥ ^9.0.0` 与"flat config 风格"语义意图才是规则的实质。Auditor 引用规则的实质，不引用 起草时的快照假设。

接受 G1。Builder 决断属合规自决——既未越界（未装非授权 plugin），也未规避（路径合理：默认装 stable + 数值判据满足 + flat config 兼容性确认）。

### 关注点 4 详解（独立验证 G2 — 补装 `@eslint/js`）

事实根因：task-card § J2 字节级要求 `import eslint from '@eslint/js';` + ESLint 10.x 移除 `@eslint/js` 自动传递依赖（9.x 时是 `eslint` 的传递依赖，10.x 必须显式装）。J5b 首次 `npm run lint` crash with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js'`——直接证据。

**Auditor 独立判定**：
1. `@eslint/js` 是 ESLint 团队官方包，作用是把 `eslint.configs.recommended` 暴露给 flat config，**不属于** task-card § "严禁顺手做" 段所禁的 `eslint-plugin-import` / `eslint-plugin-react` / `eslint-config-prettier` 类——后者是项目规则相关 plugin，前者是 ESLint 内部 recommended 配置载体
2. 不补装则 task-card § J2 字节级要求（含 `import '@eslint/js'`）与 § J5b 不 crash 要求会**强制冲突**——必须装才能让 task-card 既有要求同时成立
3. Builder 选择最小补救：仅 1 个新增 devDependency `@eslint/js@^10.0.1`，未装其他任何包；commit `c12e420a` 仅改 `package.json` + `package-lock.json`，无其他 churn
4. AUDITOR-INSTRUCTION 关注点 2 列出的"5 个允许动文件"清单包含 `package.json` + `package-lock.json`，G2 决断未越界

接受 G2。Builder 决断属合规自决。

---

## 必修问题（不修无法通过）

无。

## 待 Builder 证明

无。所有判据均由 Auditor 独立 read + 独立重跑命令验证。

## 建议（非阻塞，仅供参考，可由 Builder/Commander 自行决定）

1. **task-card § J0 起草模板改进**（采纳 Builder G1 提议）：未来工具链类阶段 task-card 应把版本约束写为 `≥ 9.x` 或 "按当时 npm stable"（含语义意图：flat config 风格），避免字面"9.x"被读为"严格 9.x major"。本次仅模板建议，不影响本 PR 通过。
2. **task-card § J0 命令补全**（采纳 Builder G2 提议）：未来 ESLint 10.x+ task-card 命令应明示 `npm install --save-dev eslint @eslint/js typescript-eslint`，避免下一个 Builder 重蹈"J5b crash → 补装"路径。
3. **task-card § J6 模板改进**（与 00x、typecheck-baseline 同提议）：J6 类范围判据应写为"Builder 引入的 diff 仅含 ⋯"或显式给出基线 SHA，避免字面 vs 实质差异。
4. **AUDITOR-INSTRUCTION 起草模板**：关注点 4 类版本约束提示应与 task-card 完成判据保持单一真值——本次出现"AUDITOR 字面 `^9`/`~9` 起头" vs "task-card J0a 数值 `≥ ^9.0.0`"的内部不一致，靠 Auditor 独立判断才解决。后续 Commander 起草时建议两份文档版本约束逐字对齐。
5. （提示给 Commander）merge 后建议在 main 上重跑一次 `npm run lint > /dev/null 2>&1; echo $?` + `npm run typecheck`，预期分别 1 + 0，确认 main 基线稳定后再启动阶段 01-contracts 重启。

---

（报告结束，不展开讨论）
