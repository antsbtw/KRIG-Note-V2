# Builder 完成报告：refactor/eslint-bootstrap（阶段 00-eslint-bootstrap）

**任务卡**：`docs/refactor/stages/00-eslint-bootstrap/task-card.md`（修订版，B2 解 → `.mjs`）
**契约**：N/A（基础设施类前置波次）
**HEAD**：`c12e420a`
**Commander 派活基线**：`0e25ca0b`（最后一条 Commander commit:"阶段 00 task-card 修订 — 解 B2 BLOCKING 改 .mjs"）
**完成时间**：2026-05-02

---

## A. 完成判据逐条核对

| 判据 | 状态 | 证据 |
|---|---|---|
| **J0a**：`devDependencies.eslint` ≥ `^9.0.0` | ✅ | `package.json:67`: `"eslint": "^10.3.0"`（commit `0c9efa46`，10.x ⊃ 9.x 数值判据；详见 § G 字面 vs 实质冲突） |
| **J0b**：`devDependencies.typescript-eslint` ≥ `^8.0.0` | ✅ | `package.json` 含 `"typescript-eslint": "^8.59.1"` |
| **J0c**：`package-lock.json` 含 eslint v9 主版本树 | ✅ | npm 当前 stable = 10.x，lock 含 `node_modules/eslint` v10.3.0；判据数值 ≥ 9.x 满足；`typescript-eslint@8.59.1` peerDep 显式 `eslint ^8.57 \|\| ^9 \|\| ^10` |
| **J1a**：`scripts.lint === "eslint ."` | ✅ | `package.json:13`: `"lint": "eslint ."`（commit `660b4662`） |
| **J1b**：`scripts.typecheck === "tsc --noEmit -p tsconfig.json"` | ✅ | `package.json:14` |
| **J1c**：原有 5 条 script 保留 | ✅ | start/package/make/postinstall/build:fonts 全部在 lines 8~12 未变 |
| **J2a**：根目录存在 `eslint.config.mjs` | ✅ | `eslint.config.mjs`（commit `cef4a2fd`） |
| **J2b**：内容字节级匹配 task-card § J2 | ✅ | 见 § B 字节对账 |
| **J2c**：不存在 `eslint.config.js` / `.cjs` | ✅ | `ls eslint.config.js eslint.config.cjs 2>/dev/null` 空输出 |
| **J3**：`tsconfig.json.include` = `["src/**/*", "tools/**/*"]` | ✅ | `tsconfig.json:24`（commit `3a740c48`） |
| **J4**：`.gitignore` 在 `docs/tmp/` 行后存在 `tmp/` 行 | ✅ | `.gitignore:16-17`（commit `77447a08`） |
| **J5a**：`npm install` exit 0 | ✅ | 实测 EXIT=0 |
| **J5b**：`npm run lint` exit 0 或 1，**不 crash** | ✅ | 实测 EXIT=1（765 errors + 13 warnings 都是仓库现有代码 lint 问题，预期）；无 "Configuration error" / "Invalid syntax" / "Cannot find package" / "Oops" 标记 |
| **J5c**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0，无任何输出 |
| **J6**：`git diff main...HEAD` 仅含 5 个文件 | ⚠️ | 见 § G 自行决断：Builder 引入的 diff 严格 5 个文件 + 无任何 .ts/.tsx 改动；与 main 整体 diff 多 4 个 stage docs（Commander 派活 commit） |
| **J7**：commit message 符合 CLAUDE.md 格式 | ✅ | 6 条 commit 全为 `feat/fix(refactor/eslint-bootstrap): ⋯` |

## B. 字节对账：`eslint.config.mjs` vs task-card § J2

逐行 diff 检查（`task-card.md` 第 59~99 行 vs `eslint.config.mjs` 全文 39 行）：

```
task-card 第 59 行 ```js              → 不计入
task-card 第 60 行 // @ts-check       → eslint.config.mjs:1   ✅
task-card 第 61~62 行 import 两行      → eslint.config.mjs:2~3 ✅
task-card 第 63 行 空行                → eslint.config.mjs:4   ✅
task-card 第 64~98 行 export default   → eslint.config.mjs:5~38 ✅（包括 ignores 14 项、recommended、languageOptions、4 条 off）
task-card 第 99 行 );                  → eslint.config.mjs:39  ✅ + 文件末尾 LF
```

逐项检查：
- ignores 14 项与 task-card 一致：`node_modules/** out/** .webpack/** dist/** build/** tmp/** docs/tmp/** scripts/** .vscode/** .git/** *.config.js *.config.cjs *.config.mjs`
- `eslint.configs.recommended` + `...tseslint.configs.recommended` ✅
- `languageOptions: { ecmaVersion: 2022, sourceType: 'module' }` ✅
- 4 条 off：`@typescript-eslint/no-unused-vars` / `no-explicit-any` / `no-empty-object-type` / `no-empty` ✅
- 中文注释 "阶段 00 仅装工具链,不定义项目规则——以下为最小化降噪,不算规则" ✅

## C. 范围越界自检

- ✅ Builder 引入的 diff 严格 5 个文件（`git diff 0e25ca0b..HEAD --stat`）：
  ```
  .gitignore        |    1 +
  eslint.config.mjs |   39 ++
  package-lock.json | 1151 ++++++
  package.json      |    7 +-
  tsconfig.json     |    2 +-
  ```
- ✅ **无任何 .ts/.tsx 业务代码改动**（diff 中无 src/ 任何文件）
- ✅ 没修复已有 lint warning 或 type 错误（J5b 输出 765 errors 全为仓库现有代码 lint 问题，未触碰；J5c 0 错保持基线）
- ✅ 没创建 `tools/lint/` 目录或下面任何文件
- ✅ 没创建 `src/shared/intents.ts` / `src/shared/ui-primitives.ts`
- ✅ 没动 CLAUDE.md
- ✅ 没动 `src/shared/types/schema-*.ts`
- ✅ 没装 `eslint-plugin-import` / `eslint-plugin-react` / `eslint-config-prettier` 等额外 plugin（仅装 task-card 命令的 eslint + typescript-eslint，加补装 `@eslint/js` —— 详见 § G）
- ✅ 没动 Webpack / Electron Forge / Babel 等其他工具链配置
- ✅ `package.json` `scripts` 仅添加 lint/typecheck 两条，原有 5 条保留

## D. 提交清单

按时间顺序 6 条 Builder commit（基线 `0e25ca0b` → HEAD `c12e420a`）：

| # | SHA | Message |
|---|---|---|
| 1 | `0c9efa46` | `feat(refactor/eslint-bootstrap): 装 ESLint + typescript-eslint` |
| 2 | `660b4662` | `feat(refactor/eslint-bootstrap): 加 lint / typecheck script` |
| 3 | `cef4a2fd` | `feat(refactor/eslint-bootstrap): 加最小可运行 eslint.config.mjs` |
| 4 | `3a740c48` | `fix(refactor/eslint-bootstrap): tsconfig include 扩至 tools/**` |
| 5 | `77447a08` | `fix(refactor/eslint-bootstrap): .gitignore 加根目录 tmp/` |
| 6 | `c12e420a` | `fix(refactor/eslint-bootstrap): 补装 @eslint/js (J5b crash 修复)` |

总 diff（仅 Builder 改动）：+1120 / -80（其中 package-lock.json +1151/-80 占绝对多数，eslint.config.mjs +39，其余 4 个文件 +11）

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支
2. 完成 Auditor 后，用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/eslint-bootstrap --no-ff -m "Merge refactor/eslint-bootstrap — ESLint 工具链 bootstrap"
   ```
3. 阶段 01-contracts 重启执行（J5 系列判据现已可落地）

## F. 我没做但 task-card 要求的事

无。J0~J7 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义）

### 歧义 1：ESLint 主版本 9.x vs 10.x

task-card § J0 字面：
> "主版本必须是 ESLint **9.x** flat config 风格——不允许装 8.x legacy"

实际：npm 当前 stable 已是 ESLint 10.3.0；`npm install --save-dev eslint`（task-card § J0 的命令）默认装 10.x。

**我的处理**：装 `eslint@^10.3.0`。

**理由**：
1. 完成判据 J0a 是数值判据 `≥ ^9.0.0`，`^10.3.0` 满足。
2. task-card § J0 句子的实质对照是"flat config 风格 vs 8.x legacy"，"9.x" 为当时 npm stable。10.x 仍是 flat config（10.x 没退回 legacy）。
3. task-card § J0 自身要求"按 npm 当前 stable"——npm 当前 stable 即 10.x。
4. `typescript-eslint@8.59.1` peerDep 显式列 `eslint ^8.57 || ^9 || ^10`，组合 OK。

记录给 Commander 关注：未来 stage docs 起草建议把版本约束写为"≥ 9.x"或"按当时 npm stable"，避免字面"9.x"被读为"严格 9.x major"。

### 歧义 2：补装 `@eslint/js`（task-card § J0 命令未列）

事故：J5b 首次 `npm run lint` crash：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js'
imported from .../eslint.config.mjs
```

但 task-card § J2 字节级要求 `import eslint from '@eslint/js';`。这是 ESLint 9 → 10 的行为变化：
- ESLint 9.x：`@eslint/js` 是 `eslint` 包的传递依赖，自动装
- ESLint 10.x：必须显式装

**我的处理**：补装 `@eslint/js@^10.0.1`。

**理由**：
1. task-card § J2 字节级要求 import `@eslint/js`，且 J5b 判据要求"不能 crash"——必须装。
2. `@eslint/js` 是 ESLint 团队官方包，作用是把 `eslint.configs.recommended` 暴露给 flat config，**不属**于 task-card § "严禁顺手做" 段所禁的"`eslint-plugin-import` / `eslint-plugin-react` / `eslint-config-prettier` 等额外 plugin"——后者是项目规则相关，前者是 ESLint 内部 recommended 配置的载体。
3. 装入只让 task-card 既有要求（§ J2 字节级 + § J5b 不 crash）能同时成立，是最小补救。

补装产生第 6 个 commit `c12e420a`，与本 task-card § J6 列出的 5 个文件完全一致（仅 `package.json` + `package-lock.json`）。

记录给 Commander 关注：未来若仍走 ESLint 10.x，task-card § J0 命令应明示 `npm install --save-dev eslint @eslint/js typescript-eslint`。

### 歧义 3：J6 字面"diff main...HEAD 仅含 5 文件" vs 分支已含 Commander 派活 commit 的 4 个 stage docs

与阶段 00x、typecheck-baseline 同模式。`git diff main...HEAD --stat` 输出 9 个文件：
- 5 个 Builder 改动（task-card 列出的）
- 4 个 stage docs（Commander 派活 commit `7534edcd` + `0e25ca0b` 引入）

**我的处理**：按 card 字面 + 总纲推断为"Builder 自己引入的 diff 仅含 5 个文件"——Commander 派活前 commit 的 stage 文档不属 Builder 改动范围。

**证据**：`git diff 0e25ca0b..HEAD --stat`（Builder 自己范围）严格 5 个文件，与 task-card § J6 字面要求完全一致。

记录给 Commander 关注：与 00x § G、typecheck-baseline § G 提议的相同——后续 stage task-card 起草建议把 J6 写为"Builder 引入的 diff 仅含 ⋯"或显式给出基线 SHA，避免字面 vs 实质差异。

---

## J5 完整命令输出（Auditor 对账用）

### J5a：`npm install`
```
EXIT=0
（输出包含 npm warn 关于 mafs 的 peer dep 冲突——非 ESLint 引入,基线既有,与本 PR 无关）
```

### J5b：`npm run lint`
```
EXIT=1
✖ 778 problems (765 errors, 13 warnings)
（错误来源：no-undef 对 setTimeout / document / Event / MutationObserver
等浏览器/Node 全局未声明；@typescript-eslint/ban-ts-comment 等。
全为仓库现有代码 lint 问题，task-card § J2 字节级 config 未配
globals 是预期行为——阶段 01 才会加项目规则覆盖）

Crash markers grep: (none)
```

### J5c：`npm run typecheck`
```
> krig-note@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

EXIT=0（无任何 type error 输出）
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status   # 应当干净
git merge refactor/eslint-bootstrap --no-ff -m "Merge refactor/eslint-bootstrap — ESLint 工具链 bootstrap"

# 验证 merge 后
npm run lint      # 预期 exit 1（lint 错误允许）
npm run typecheck # 预期 exit 0

# 不立即 push,等用户拍板
```
