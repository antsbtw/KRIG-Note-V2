# Builder 启动自检：refactor/eslint-bootstrap（阶段 00-eslint-bootstrap，二次启动）

## 已读输入
- ✅ 总纲 v2.3（同会话已读）
- ✅ CLAUDE.md（同会话已读）
- ✅ 阶段目录 `docs/refactor/stages/00-eslint-bootstrap/`：
  - ✅ README.md
  - ✅ task-card.md（修订版，B2 解 → `.mjs`）
  - ✅ BUILDER-INSTRUCTION.md（修订版，5 处提及 `.mjs`）
  - ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 功能契约：N/A（基础设施类前置波次）
- ✅ 目标分支：`refactor/eslint-bootstrap`，HEAD = `0e25ca0b`，工作树干净
  - 注：task-card 标 HEAD `bd390c70`，但分支已 rebase 到 main 之后（`6f9d56e1` Merge fix/typecheck-baseline + `7534edcd` 立 task-card + `0e25ca0b` 修订 .mjs）。基线已含 00x schema 修复 + typecheck-baseline 历史债清理。

## 本次 task-card 完成判据复述

- **J0a**：`devDependencies.eslint` ≥ `^9.0.0`
- **J0b**：`devDependencies.typescript-eslint` ≥ `^8.0.0`
- **J0c**：`package-lock.json` 含 eslint v9 主版本树
- **J1a**：`scripts.lint === "eslint ."`
- **J1b**：`scripts.typecheck === "tsc --noEmit -p tsconfig.json"`
- **J1c**：原有 5 条 script（start/package/make/postinstall/build:fonts）保留不变
- **J2a**：根目录存在 `eslint.config.mjs`（**注意 .mjs 扩展名**）
- **J2b**：内容字节级匹配 task-card § J2 代码块
- **J2c**：不存在 `eslint.config.js` / `eslint.config.cjs`
- **J3**：`tsconfig.json.include === ["src/**/*", "tools/**/*"]`，其余字段不变
- **J4**：`.gitignore` 中 `docs/tmp/` 行后存在 `tmp/` 行
- **J5a**：`npm install` exit 0
- **J5b**：`npm run lint` exit 0 或 1，**不 crash**
- **J5c**：`npm run typecheck` exit 0
- **J6**：`git diff main...HEAD` 仅含 `package.json` / `package-lock.json` / `eslint.config.mjs` / `tsconfig.json` / `.gitignore`
- **J7**：commit message 符合 CLAUDE.md `feat/fix/refactor/docs(scope):` 格式

## 契约 § B 防御代码 grep 验证

本次为基础设施类前置波次，无功能契约，跳过。

## R1~R3 风险预探（task-card + BUILDER-INSTRUCTION 步骤 1 要求）

### R1：现有代码 `npx tsc --noEmit -p tsconfig.json` 是否通过

✅ **通过**。退出码 = 0，无任何 type error 输出。

`fix/typecheck-baseline` 已 merge 到 main（merge commit `6f9d56e1`），仓库历史 4 处 type 债（`view.webContents` ×1 + `WebkitAppRegion` ×3）已全清；schema-interop.ts 自身的 2 处也已由 00x merge 清掉。基线干净。

### R2：`package.json` 是否含 `"type": "module"`

❌ **不含**（`grep '"type"' package.json` 无输出）。

R2 在阶段 00 首次启动时已确认；task-card § J2 据此修订为 `.mjs` 扩展名，**已解 BLOCKING**。Builder 直接照新 task-card 执行。

### R3：TypeScript 主版本是否 ≥ 4.7

✅ **通过**。`package.json` 声明 `"typescript": "^5.7.0"`，远超 typescript-eslint 要求的 ≥ 4.7。

### 额外探查：是否存在历史 `eslint.config.*` 文件

✅ 不存在任何 `eslint.config.js` / `.cjs` / `.mjs`，本次纯新建，无 J2c "避免 ESLint 找错入口" 风险。

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

无（task-card 已在 4 处预期歧义中明确答案；R2 修订后所有路径均一意）。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分（按 BUILDER-INSTRUCTION § 三 步骤 3 建议）：
  - J0：`feat(refactor/eslint-bootstrap): 装 ESLint 9.x + typescript-eslint`（npm install 自动改 package.json/lock）
  - J1：`feat(refactor/eslint-bootstrap): 加 lint / typecheck script`
  - J2：`feat(refactor/eslint-bootstrap): 加最小可运行 eslint.config.mjs`
  - J3：`fix(refactor/eslint-bootstrap): tsconfig include 扩至 tools/**`
  - J4：`fix(refactor/eslint-bootstrap): .gitignore 加根目录 tmp/`
  - J5：验证(无 commit)
- 完成后写 `tmp/builder-report.md`
