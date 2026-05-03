# 任务卡：refactor/eslint-bootstrap（阶段 00-eslint-bootstrap）

> **状态**：草稿
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 3 防线 2（ESLint 自动拦截）+ § 9 启动清单
- 前置依据：阶段 01 Builder 探查报告 [tmp/builder-startup.md](../../../../tmp/builder-startup.md) + [tmp/builder-blockers.md](../../../../tmp/builder-blockers.md)
- 三角架构定义：总纲 § 7

## 本次范围

**前置基础设施类波次：装 ESLint 工具链 + TypeScript 类型检查 + 配套环境**

只装工具、配置可运行的最小骨架，**不写任何项目规则**。规则定义是阶段 01 的工作。本阶段完成后，阶段 01 的 J5 系列判据（依赖 `npm run lint`）即可落地。

## 本分支只做

按以下顺序：

### J0：安装 ESLint 9.x（flat config 风格）+ 最少必要的 plugin

执行命令（Builder 自决具体版本号，按 npm 当前 stable，但主版本必须是 ESLint **9.x** flat config 风格——不允许装 8.x legacy）：

```bash
npm install --save-dev eslint typescript-eslint
```

**说明**：
- 只装 `eslint` + `typescript-eslint`（后者整合包，包含 parser + plugin）
- **不装** `eslint-plugin-import`、`eslint-plugin-react`、`eslint-config-prettier` 等 —— 这些是项目规则相关的，留给阶段 01 按需添加
- **不装** prettier 或其他格式化工具
- 装完检查 `package.json` `devDependencies` 中含 `eslint` 与 `typescript-eslint`
- 检查 `node_modules/eslint/package.json` 主版本号 ≥ 9

### J1：在 `package.json` `scripts` 字段添加两条 script

```json
{
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

**说明**：
- 维持现有 scripts（`start` / `package` / `make` / `postinstall` / `build:fonts`）不动
- `lint` 命令简单到 `eslint .`，无任何额外参数
- `typecheck` 用 `-p tsconfig.json` 显式指定，便于将来兼容多 tsconfig

### J2：创建最小可运行 `eslint.config.mjs`（flat 风格，仓库根目录）

> **B2 BLOCKING 解：文件名为 `.mjs` 后缀**（仓库 `package.json` 无 `"type": "module"`，Node 默认按 CommonJS 解析 `.js`，会让 ESM `import` 语法 SyntaxError）。`.mjs` 强制 ESM 解析，不影响仓库其他 `.js` 文件解析路径。ESLint 9 flat config 对 `.mjs` 是一等公民。

文件内容（**完全照抄**——不允许 Builder 自行扩展）：

```js
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 全局忽略：构建产物 / 依赖 / 本仓库特殊产物
    ignores: [
      'node_modules/**',
      'out/**',
      '.webpack/**',
      'dist/**',
      'build/**',
      'tmp/**',
      'docs/tmp/**',
      'scripts/**',
      '.vscode/**',
      '.git/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // 阶段 00 仅装工具链,不定义项目规则——以下为最小化降噪,不算规则
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': 'off',
    },
  },
);
```

**关键约束**：
- **必须**用 `.mjs` 扩展名（`eslint.config.mjs`），**不允许**用 `.js`（仓库非 ESM）或 `.cjs`（语法不兼容）
- **不允许** Builder 添加任何项目业务规则——规则禁令清单是阶段 01 的工作
- **不允许** Builder 自行加 `files: [...]` 限定范围 —— 让默认全仓扫描
- 上面 4 条 `'off'` 是为了让 J5 验证时 `npm run lint` 不在已有代码上炸出红墙——这不是项目规则，是降噪。阶段 01 时 Commander 起草的 5 条规则是**新增**到这个 config 里的

### J3：扩展 `tsconfig.json` 的 `include`

当前 `tsconfig.json:24` 形如：
```json
"include": ["src/**/*"]
```

修改为：
```json
"include": ["src/**/*", "tools/**/*"]
```

理由：阶段 01 会在 `tools/lint/pure-utility-allowlist.ts` 创建文件，必须在 typecheck 范围内才能被 J7 验证。

**仅此一处改动**，不动 `tsconfig.json` 其他字段。

### J4：将根目录 `tmp/` 加入 `.gitignore`

当前 `.gitignore:15-16` 含：
```
# Local scratch / tmp drafts
docs/tmp/
```

在 `docs/tmp/` 之后追加一行 `tmp/`：
```
# Local scratch / tmp drafts
docs/tmp/
tmp/
```

理由：三角架构使用根目录 `tmp/` 存放 builder/auditor 报告（COMMANDER-PROMPT § 七），不应入 git。

### J5：验证三件事可运行

按顺序执行并记录每条命令的退出码 + 摘要：

```bash
npm install                          # 装依赖,应成功(exit 0)
npm run lint                         # 应不报错运行(可能有 warn,允许)
npm run typecheck                    # 应不报错运行(已存在的 ts 文件不应因本次改动炸出新错误)
```

**判定标准**：
- `npm install` exit 0
- `npm run lint` exit 0 或 exit 1（lint 错误允许，本次只验证工具链可跑）—— **关键**：不能因 ESLint 配置语法错误导致 ESLint 自身崩溃
- `npm run typecheck` exit 0 —— 仓库已有代码必须保持类型检查通过（注：本次 tsconfig include 扩展后，`tools/` 目录还为空，不影响）

如果 `npm run typecheck` 已有报错（仓库本来就有的 type 错误），按 BUILDER-PROMPT § 六升级——这是 BLOCKING：阶段 01 的 J7 判据会失效。Builder 应写入 `tmp/builder-blockers.md` 停下，**不擅自修复**任何 type 错误。

## 严禁顺手做

- ❌ **不写任何项目业务规则**（如禁止 `closeRightSlot` 等）—— 那是阶段 01 的工作
- ❌ **不装** `eslint-plugin-import` / `eslint-plugin-react` / `eslint-config-prettier` 等额外 plugin
- ❌ **不修改任何 .ts/.tsx 业务代码**
- ❌ **不修复**已有的 lint warning 或 type 错误（保留现状）
- ❌ **不修改** Webpack / Electron Forge / Babel 等其他工具链配置
- ❌ **不动** `package.json` 已有的 `scripts`（仅添加 lint / typecheck 两条新 script，其他保留）
- ❌ **不创建** `tools/lint/` 目录或下面任何文件 —— 那是阶段 01 的工作
- ❌ **不创建** `src/shared/intents.ts` / `src/shared/ui-primitives.ts` —— 那是阶段 01 的工作
- ❌ **不修改** CLAUDE.md —— 那是阶段 01 的工作
- ❌ **不动** `src/shared/types/schema-*.ts`
- ❌ **不擅自做** merge / push（列命令交回 Commander）

## 完成判据

- [ ] **J0a**: `package.json` `devDependencies` 含 `eslint` ≥ `^9.0.0`
- [ ] **J0b**: `package.json` `devDependencies` 含 `typescript-eslint` ≥ `^8.0.0`
- [ ] **J0c**: `package-lock.json` 已更新（含 eslint v9 主版本树）
- [ ] **J1a**: `package.json` `scripts.lint` 等于 `"eslint ."`
- [ ] **J1b**: `package.json` `scripts.typecheck` 等于 `"tsc --noEmit -p tsconfig.json"`
- [ ] **J1c**: 原有 5 条 script（start/package/make/postinstall/build:fonts）保留不变
- [ ] **J2a**: 仓库根目录存在 `eslint.config.mjs` 文件（**注意 .mjs 扩展名**）
- [ ] **J2b**: 文件内容**字节级匹配** task-card § J2 给出的代码块（除尾行换行外）
- [ ] **J2c**: 不存在 `eslint.config.js` 或 `eslint.config.cjs`（避免 ESLint 找错入口）
- [ ] **J3**: `tsconfig.json` `include` 字段为 `["src/**/*", "tools/**/*"]`
- [ ] **J4**: `.gitignore` 中 `docs/tmp/` 行之后存在 `tmp/` 行
- [ ] **J5a**: `npm install` 已运行成功（package-lock.json 已更新且无 npm 错误）
- [ ] **J5b**: `npm run lint` 退出码为 0 或 1（**不能** crash），输出无 "Configuration error" 等致命提示
- [ ] **J5c**: `npm run typecheck` 退出码为 0（仓库现有代码 typecheck 通过）
- [ ] **J6**: `git diff main...HEAD` 仅含以下文件：`package.json` / `package-lock.json` / `eslint.config.mjs` / `tsconfig.json` / `.gitignore`，**绝无**任何 .ts/.tsx 业务代码改动
- [ ] **J7**: 所有 commit 通过 CLAUDE.md 提交规范（feat/fix/refactor/docs scope 格式）

## 已知风险

- **R1**：`npm run typecheck` 可能在仓库现有代码上炸 type 错误（本次 tsconfig 改动只是扩 include，本质不引入新错误）。如果炸了，是仓库**本来就有的** type 错误。Builder **不能修**——升级到 BLOCKING 让 Commander 决定（修 / 接受 / 临时降级 strict）
- **R2 已解**：仓库 `package.json` 无 `"type": "module"`（确认于阶段 00 第一次 Builder 启动 BLOCKING B2）。**故 task-card § J2 已修订为 `eslint.config.mjs`**，强制 ESM 解析，不影响其他 `.js` 文件。Builder 不需重新探查此项
- **R3**：`typescript-eslint` 整合包要求 TS 主版本 ≥ 4.7。Builder 启动后第一步检查仓库 TS 版本，如果 < 4.7 写入 BLOCKING

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认（已在 R1~R3 答）

1. **如果 `npm run typecheck` 在已有代码上失败怎么办？** —— 见 R1。Builder 不修，写 BLOCKING
2. **如果项目不是 ESM 怎么办？** —— 见 R2，**已解**。task-card § J2 已修订为 `.mjs`
3. **如果 TS 版本太低？** —— 见 R3
4. **`eslint.config.mjs` 中的"4 条 off 降噪"会不会留在阶段 01 中？** —— **Commander 答**：不会。阶段 01 的 task-card 会明确把这 4 条 off 替换为有意义的项目规则。本阶段保留它们仅为让 J5b 不炸已有代码

## Builder 完成后

- 写报告到 `tmp/builder-report.md`（按 BUILDER-PROMPT § 五格式）
- 在聊天中输出："builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push（列命令给 Commander）

## 备注：本次为基础设施类前置波次

本次任务**不动业务代码、也不写项目规则**，因此 BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检中的"契约 § B 防御代码 grep 验证"也跳过。
