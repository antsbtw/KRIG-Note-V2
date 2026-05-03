# Builder 完成报告：refactor/contracts（阶段 01-contracts，task-card v4 / 三次启动汇总）

**任务卡**：`docs/refactor/stages/01-contracts/task-card.md`（v4 修订版，commit `929ac1f9`）
**契约**：N/A（基础设施类子波次）
**HEAD**：`71f8bcda`
**整阶段派活基线**：`ca598c7a`（v3 修订之前 / J1 起点之前）
**v4 续做基线**：`929ac1f9`
**完成时间**：2026-05-02

---

## 阶段执行历史（三次 Builder 启动）

| 启动 | 触发 | 结果 | commit 范围 |
|---|---|---|---|
| 第 1 次 | task-card v2 | BLOCKING B1: J7c 与 `note/lib`/`browser-capability/runtime` 现状冲突 → 等 Commander 加白名单 | 0 commit（仅 startup + blockers） |
| 第 2 次 | task-card v3（J5.5 白名单） | BLOCKING B1: tsconfig `rootDir: "src"` 与 `include: tools/**/*` 互斥,J4 创建文件即让 typecheck 失败 | J1+J2+J3 合规 commit（`1b6cf66b` / `b923fdf4` / `9ea65adc`），J4 试做后回滚 |
| 第 3 次（本次） | task-card v4（J3-补 删 rootDir + J6 清单扩 8 文件） | ✅ 全部完成 | J3-补 / J4 / J5.1~J5.5 + 一个 cascade 修复 commit |

## A. 完成判据逐条核对

| 判据 | 状态 | 证据 |
|---|---|---|
| **J1**：CLAUDE.md 末尾 `## 重构期硬规则` 段含 10 条禁令 + 引总纲 | ✅ | commit `1b6cf66b`，CLAUDE.md 行 35~50（10 条 + 段尾引用） |
| **J2**：`src/shared/intents.ts` 字节级照抄 + 无 import + 仅类型 | ✅ | commit `b923fdf4` |
| **J3**：`src/shared/ui-primitives.ts` 含 ViewDefinition / Capability / 5 大菜单项 / KeyBinding / CommandHandler / 等占位类型 + 无 import | ✅ | commit `9ea65adc` |
| **J3-补**：`tsconfig.json` 删 `"rootDir": "src",` 行；其他字段保留；`npm run typecheck` exit 0 | ✅ | commit `1db64ebf`；删第 15 行；其他字段不变；实测 exit 0 |
| **J4**：`tools/lint/pure-utility-allowlist.ts` 字节级照抄 + 13 项 | ✅ | commit `308f793d`；PURE_UTILITY_ALLOWLIST 13 项 + PureUtility 类型 |
| **J5.1**：布局特权 API 禁令 config object | ✅ | commit `b3bbc50d`（独立 config）+ commit `71f8bcda`（cascade 修复，把 LAYOUT_PRIVILEGE_PATTERN 注入 J5.2 per-plugin config）；测试 `src/plugins/note/test-j51.ts` 触发 error；验证后已删除 |
| **J5.2**：跨插件 import 禁令（实施手段：逐插件 9 个 config + spread）| ✅ | commit `0bcf9222`；`src/plugins/note/test-j52.ts` 触发 error；验证后已删除 |
| **J5.3**：`src/shared/**` 禁 electron | ✅ | commit `adda5b93`；`src/shared/test-j53.ts` 触发 error；验证后已删除 |
| **J5.4**：视图层禁外部依赖 warn | ✅ | commit `76688f57`；`src/plugins/note/views/test/test-j54.ts` 触发 warning；验证后测试文件 + 测试目录全删 |
| **J5.5a**：`tools/lint/check-plugin-dirs.sh` 字节级照抄 + 可执行 | ✅ | commit `8c84ca07`；含 ALLOWLIST 2 条历史 baseline；`chmod +x` 已设；脚本字节级与 task-card § J5.5 完全一致 |
| **J5.5b**：`package.json scripts.lint:dirs = "bash tools/lint/check-plugin-dirs.sh"` | ✅ | commit `8c84ca07`；package.json 第 14 行 |
| **J5.5c**：测试目录 `src/plugins/note/engine/` 触发 `lint:dirs` exit 非 0 + 输出含该路径 | ✅ | 实测 DIRS_EXIT=1，dirs-test.log 含 `src/plugins/note/engine`；验证后测试目录已删 |
| **J5.5d**：白名单豁免有效（输出不含 `note/lib` / `browser-capability/runtime`） | ✅ | 实测 grep 两条均空；baseline `npm run lint:dirs` exit 0 |
| **J5b**：现有违规 J5.4 触发 warn 不阻塞（与基线一致） | ✅ | 当前仓库无 `src/plugins/<X>/views/**` 目录（波次 3 才创建），J5.4 此刻不增量触发；`npm run lint` 778 problems 与基线完全一致 |
| **J6**：Builder 引入的 diff 含且仅含 8 个文件 | ✅ | 见 § B Builder-only diff |
| **J7a**：`npm run typecheck` exit 0 | ✅ | 实测 EXIT=0（J3-补 删 rootDir 后 typecheck 通过） |
| **J7b**：`npm run lint` exit 1（与基线一致 778 problems） | ✅ | 实测 EXIT=1，778 problems（765 errors / 13 warnings），与基线完全一致 |
| **J7c**：baseline 状态 `npm run lint:dirs` exit 0 | ✅ | 实测 EXIT=0，输出"2 条历史 baseline 白名单已豁免" |

## B. Builder 引入的 diff 验证（§ J6 关键）

```
$ git diff ca598c7a..HEAD --stat | grep -v docs/refactor/stages/01-contracts
 CLAUDE.md                                          |  15 +++
 eslint.config.mjs                                  | 100 ++++
 package.json                                       |   1 +
 src/shared/intents.ts                              |  30 +++++
 src/shared/ui-primitives.ts                        | 145 ++++++
 tools/lint/check-plugin-dirs.sh                    |  46 ++++
 tools/lint/pure-utility-allowlist.ts               |  29 +++++
 tsconfig.json                                      |   1 -
```

**Builder 引入的 8 个文件**与 task-card § J6 字面清单**完全一致**：
- `CLAUDE.md`（J1）
- `src/shared/intents.ts`（J2）
- `src/shared/ui-primitives.ts`（J3）
- `tsconfig.json`（J3-补）
- `tools/lint/pure-utility-allowlist.ts`（J4）
- `eslint.config.mjs`（J5.1~J5.4 共 5 个 config object）
- `tools/lint/check-plugin-dirs.sh`（J5.5）
- `package.json`（J5.5 加 lint:dirs script）

**派活基线说明**：阶段经历 v2/v3/v4 三次 task-card 修订（commit `1e150710` / `ca598c7a` / `929ac1f9`），Builder commit 跨 3 次会话。J6 字面"派活基线"按整阶段视角解读为 v3 修订之前的 `ca598c7a`（即 J1 commit `1b6cf66b` 的父）。本会话 v4 重启基线 `929ac1f9` 仅含 5 个 src/工具/配置文件改动（本会话的 J3-补/J4/J5），加上前 2 次会话的 J1+J2+J3 合计 8 个文件,与 task-card 一致。

## C. 范围越界自检

- ✅ Builder 改动限于 8 个 task-card § J6 列出的文件
- ✅ 无任何 `src/main/**` / `src/renderer/**` / `src/plugins/**` / `src/capabilities/**` 内既有文件改动（J5 测试创建的 `src/plugins/note/test-j51.ts` 等已全删）
- ✅ 无 `src/shared/types/schema-*.ts` 改动
- ✅ 无 `src/capabilities/*` 创建
- ✅ 无 `plugins/*/views/*` 创建（测试 `src/plugins/note/views/test/` 已删）
- ✅ 无 commit 修改/merge/push 已有提交
- ✅ 无优化 / 重命名 / 格式调整既有代码
- ✅ 无 memory 改动
- ✅ 无总纲拼写改动
- ✅ ESLint 4 条 off 降噪未动（仍在 eslint.config.mjs 的第 5 个 arg 内，未触碰）

## D. 提交清单（11 条 commit）

按时间顺序，跨 3 次 Builder 会话：

| # | SHA | 会话 | Message |
|---|---|---|---|
| 1 | `1b6cf66b` | 第 2 次 | `feat(refactor/contracts): CLAUDE.md 加重构期硬规则段` |
| 2 | `b923fdf4` | 第 2 次 | `feat(refactor/contracts): shared/intents.ts IntentEvent 类型骨架` |
| 3 | `9ea65adc` | 第 2 次 | `feat(refactor/contracts): shared/ui-primitives.ts ViewDefinition + Capability 类型` |
| 4 | `1db64ebf` | 第 3 次 | `fix(refactor/contracts): tsconfig 删 rootDir(允许 tools/** 进 typecheck)` |
| 5 | `308f793d` | 第 3 次 | `feat(refactor/contracts): tools/lint/pure-utility-allowlist.ts 白名单` |
| 6 | `b3bbc50d` | 第 3 次 | `feat(refactor/contracts): eslint 禁布局特权 API` |
| 7 | `0bcf9222` | 第 3 次 | `feat(refactor/contracts): eslint 禁跨插件 import` |
| 8 | `adda5b93` | 第 3 次 | `feat(refactor/contracts): eslint shared 禁 electron` |
| 9 | `76688f57` | 第 3 次 | `feat(refactor/contracts): eslint 视图层禁外部依赖(warn)` |
| 10 | `8c84ca07` | 第 3 次 | `feat(refactor/contracts): tools/lint/check-plugin-dirs.sh + lint:dirs script` |
| 11 | `71f8bcda` | 第 3 次 | `fix(refactor/contracts): J5.1 布局特权规则被 J5.2 cascade 覆盖修复` |

总 diff（仅 Builder 改动，相对整阶段派活基线 `ca598c7a`）：+401 / -6

## E. 待 Commander 安排的事

1. 调度 Auditor 审计本分支（task-card v4 + 3 次 Builder 会话循环 → 整体合规审视）
2. Auditor 完成后用户拍板 merge：
   ```bash
   git checkout main
   git merge refactor/contracts --no-ff -m "Merge refactor/contracts — 阶段 01 契约定型(波次 1)"
   ```
3. 阶段 02-... 由 Commander 起草（建中间层 IntentDispatcher + 五大 Registry + CommandRegistry + 首批 Capability 骨架）

## F. 我没做但 task-card 要求的事

无。J1~J7c 全完成。

## G. 自行决断的边界（NON-BLOCKING 歧义 + 实施细节）

### 歧义 1：J5.2 实施手段（task-card 明示自决）

**采用方案**：逐插件 9 个 config object（`PLUGIN_DIRS.map(...)` 展开）+ 顶部抽 `LAYOUT_PRIVILEGE_PATTERN` 常量。

**理由**：
- task-card § J5.2 给的"优先方案 `patterns: ['**/plugins/!(note)/**']`"实测在 ESLint 10.x picomatch 中 `!(...)` negation 不被支持
- 备选"逐插件单独配 `files` + `patterns` 多个 config object"更稳妥
- 用 `.map` 展开避免 9 份重复代码
- `PLUGIN_DIRS` 常量来自 `ls src/plugins/`：ai-note-bridge / browser-capability / demo / ebook / graph / note / thought / web / web-bridge

### 歧义 2：J5.4 `import { PURE_UTILITY_ALLOWLIST }` 在 .mjs 中的 import 引用

**采用方案**：注释引用（task-card 明示的 fallback）。

**理由**：
- `.ts` 文件无法在 ESM `.mjs` 中直接 `import`（Node 不识别 `.ts`，需 ts-node/tsx 等 loader，未在仓库装入）
- 实测尝试 import 会让 ESLint 启动 crash
- task-card § J5.4 末段："`import { PURE_UTILITY_ALLOWLIST } from './tools/lint/pure-utility-allowlist.ts';` 即可——若失败则改用注释 '白名单单一真值见 tools/lint/pure-utility-allowlist.ts'"
- `eslint.config.mjs` J5.4 块上方注释明确写出"白名单单一真值见 tools/lint/pure-utility-allowlist.ts"

### 实施 1：J5.1 布局特权规则被 J5.2 cascade 覆盖修复（commit `71f8bcda`）

**问题**：ESLint flat config 同名规则 cascade — 当 `files` 重叠时，后面 config 的 `'no-restricted-imports'` **整体替换**前面的（不合并 patterns）。J5.2 的 9 个 per-plugin config（`files: src/plugins/<X>/**`）与 J5.1（`files: src/plugins/**`）重叠，J5.2 整体覆盖了 J5.1 的 patterns，导致 J5.1 在 9 个已知插件目录失效（实测 test-j51 不被拦）。

**修复**：抽 `LAYOUT_PRIVILEGE_PATTERN` 常量，把它注入 `crossPluginImportConfigs` 的每个 patterns 数组。J5.1 独立 config 保留满足 task-card 字面要求 + 作未来新增插件（未列入 PLUGIN_DIRS）的兜底。

**实测**：修复后 J5.1（test-j51）+ J5.2（test-j52）均触发 error。

### 已知遗留（待波次 3 处理）：J5.4 cascade 在 views/ 内覆盖 J5.1 + J5.2

J5.4 `files: src/plugins/**/views/**` 与 J5.2 `files: src/plugins/<X>/**` 重叠。在 `src/plugins/<X>/views/**` 域，J5.4 的 warn 级 `'no-restricted-imports'` 整体覆盖 J5.2 的 error 级规则 → views/ 内布局特权 + 跨插件 import 失效。

**当前影响**：
- 仓库无 `src/plugins/<X>/views/**` 目录（波次 3 才创建），不影响真实代码
- J5 测试 j51/j52/j53 的违规文件均在 views/ 之外，不受影响
- J5.4 测试 j54 在 views/ 内验证 warn 触发正确

**长期解**：波次 3 创建 views/ 时，task-card 起草需重新审视 cascade 处理——可考虑把 LAYOUT_PRIVILEGE_PATTERN + cross-plugin patterns 也注入 J5.4 的 patterns，或重组为单一 'no-restricted-imports' 规则统一管理（届时讨论 warn 级是否拉到 error）。

cascade 修复 commit `71f8bcda` message 已记录此遗留。

### 实施 2：J3-补 后 IDE 显示 TS6059 提示

**现象**：`tsconfig.json` 删 `rootDir: "src"` 后，IDE 语言服务对第 14 行 `outDir` 报 TS6059 错误：
> "The common source directory of 'tsconfig.json' is './src'. The 'rootDir' setting must be explicitly set to this or another path to adjust your output's file layout."

**评估**：
- 这是 IDE 语言服务对 `outDir` 存在时的强烈建议（避免编译产物路径混乱）
- 对 `tsc --noEmit` **不是错误**（实测 EXIT=0）—— task-card § J3-补 副作用评估明示："`rootDir` 仅影响 `outDir` 路径计算，noEmit 模式下完全无关"
- task-card R10 已 grep 验证仓库无其他 `tsc -p tsconfig.json` 非 noEmit 调用

**处理**：commit `1db64ebf` 的 message 明示此为预期诊断噪声。Commander 决定波次 6 design-token 或后续可独立 PR 清理 outDir / baseUrl 等过时字段（baseUrl 也有 deprecation 警告，TS 7.0 停用）。

### 派活基线解读（同 阶段 00x / typecheck-baseline / 阶段 00 G 段建议）

task-card § J6 用"派活基线"表述。本阶段经历 v2/v3/v4 三次 task-card 修订 + 3 次 Builder 会话，Builder commit 跨多次会话。J6 字面"含且仅含 8 个文件"按**整阶段视角**才能 PASS（`ca598c7a..HEAD`）；按**本会话视角**（`929ac1f9..HEAD`）只含 5 个文件（J3-补/J4/J5）。Builder 选取整阶段视角解读，与 task-card 字面 8 文件清单完全一致。

记录给 Commander 关注：未来跨多会话续做的 stage 应在 task-card § J6 显式说明"派活基线"指最初派活点（修订前的最后非 Builder commit），而非每次重启的最新 commit。

---

## J5 完整测试输出（Auditor 对账用）

### J5.1 / J5.2 / J5.3 / J5.4 触发明细

```
src/plugins/note/test-j51.ts
  1:10  error  'openCompanion' import from '@main/window/shell' is restricted from being used by a pattern. ...

src/plugins/note/test-j52.ts
  1:1  error  '@plugins/web/foo' import is restricted from being used by a pattern. 跨插件 import 禁止 ...

src/shared/test-j53.ts
  1:1  error  'electron' import is restricted from being used. shared 是跨进程契约层 ...

src/plugins/note/views/test/test-j54.ts
  1:1  warning  'three' import is restricted from being used by a pattern. L5 视图层禁止直接 import 重型外部依赖 ...
```

J5.1/J5.2/J5.3 = error ✅；J5.4 = warning ✅。

### J5.5 测试

```
# 测试 5a (新增违规 src/plugins/note/engine):
$ npm run lint:dirs
EXIT=1
❌ 发现违规目录(总纲 § 4.1 规定):
src/plugins/note/engine
  plugins/<X>/ 下禁建 engine/runtime/lib/——
  ⋯

# 测试 5b (baseline):
$ npm run lint:dirs
EXIT=0
✓ 插件目录结构合规(2 条历史 baseline 白名单已豁免,详见脚本注释)
```

### 验证后清理

```
$ ls src/plugins/note/test-j*.ts src/shared/test-j*.ts 2>/dev/null
(no matches)
$ ls -la src/plugins/note/views src/plugins/note/engine 2>/dev/null
(no such directories)
```

### J7 三件最终验证

```
$ npm run typecheck   ; echo $?
EXIT=0   (J7a ✅)

$ npm run lint        ; echo $?
EXIT=1
✖ 778 problems (765 errors, 13 warnings)   (J7b ✅ 与基线 778 完全一致)

$ npm run lint:dirs   ; echo $?
EXIT=0
✓ 插件目录结构合规(2 条历史 baseline 白名单已豁免)   (J7c ✅)
```

---

## Commander merge 命令清单（Builder 不擅自执行）

```bash
git checkout main
git status                  # 应当干净
git merge refactor/contracts --no-ff -m "Merge refactor/contracts — 阶段 01 契约定型(波次 1)"

# 验证 merge 后
npm run typecheck    # 预期 EXIT=0
npm run lint         # 预期 EXIT=1, 778 problems
npm run lint:dirs    # 预期 EXIT=0, 白名单豁免

# 不立即 push,等用户拍板
```
