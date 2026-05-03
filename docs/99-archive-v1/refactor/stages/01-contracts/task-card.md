# 迁移任务卡：refactor/contracts（波次 1）

> **状态**：草稿
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 9 启动清单
- 评估依据：[docs/evaluation/2026-05-02-L0-L1-evaluation.md](../../../evaluation/2026-05-02-L0-L1-evaluation.md)、L2/L3/L4/L5 评估
- 三角架构定义：总纲 § 7

## 本次范围

**波次 1：契约定型（不动任何运行代码）**

为后续所有重构子波次建立"宪法层"基础设施：CLAUDE.md 红线段落 + 共享类型骨架 + eslint 拦截规则 + 纯工具白名单。本次工作完成后，任何后续 PR 一旦违反规则会被 eslint 自动拦截。

## 本分支只做

按总纲 § 9 启动清单的五件事，**严格按顺序**：

### J1：CLAUDE.md 追加"重构期硬规则"段落

在 [CLAUDE.md](../../../../CLAUDE.md) 文件末尾追加新章节 `## 重构期硬规则`，必须包含以下禁令清单（一字不漏）：

- L5 插件代码（`src/plugins/**`）禁止 import：`openCompanion` / `ensureCompanion` / `closeRightSlot` / `openRightSlot`
- L5 改变布局只能：`dispatch(IntentEvent)`
- L3 `WorkspaceState` 禁止新增业务字段（`activeXxxId` / `expandedXxx`），新状态走 `pluginStates`
- `src/shared/**` 禁止 import `'electron'`
- 五大交互（ContextMenu / Toolbar / Slash / Handle / FloatingToolbar）必须通过对应 Registry 注册
- ContextMenu / Toolbar / Slash / Handle / FloatingToolbar 五类交互禁止在组件内直接 `<Menu>` / `useState` 写菜单项
- **Atom 永远不携带视图特定字段**（不加 `meta.view` / `meta.canvas` / 任何 view-meta）
- 视图层（`src/plugins/**/views/**`）禁止直接 import 任何不在 `tools/lint/pure-utility-allowlist.ts` 的 npm 包
- `plugins/<X>/` 下禁建 `engine/` / `runtime/` / `lib/` 目录
- 跨插件禁止 import：`plugins/<X>/**` 不能 import `plugins/<Y>/**`

段落末尾追加："违反以上任一条 = PR 拒绝合入。详见 [docs/refactor/00-总纲.md](docs/refactor/00-总纲.md)"

### J2：创建 `src/shared/intents.ts`

创建文件 [src/shared/intents.ts](../../../../src/shared/intents.ts)（新文件），导出 IntentEvent 类型骨架：

```ts
/**
 * Intent 事件契约：L5 视图通过 dispatch(IntentEvent) 上抛意图，
 * 由 L3 IntentDispatcher 决定布局响应。视图禁止直接调 openCompanion 等特权 API。
 */

export type IntentEvent =
  | ContentOpenedIntent
  | AiAssistanceRequestedIntent
  | SplitScreenRequestedIntent
  | LayoutModeChangeRequestedIntent;

export interface ContentOpenedIntent {
  type: 'content:opened';
  payload: { viewId: string; resourceId: string };
}

export interface AiAssistanceRequestedIntent {
  type: 'intent:ai-assistance-requested';
  payload: { context?: unknown };
}

export interface SplitScreenRequestedIntent {
  type: 'intent:split-screen-requested';
  payload: { viewId: string };
}

export interface LayoutModeChangeRequestedIntent {
  type: 'intent:layout-mode-change-requested';
  payload: { mode: string };
}
```

**约束**：仅类型，无运行时代码。文件 `import` 列表必须为空。

### J3：创建 `src/shared/ui-primitives.ts`

创建文件 [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts)（新文件），导出五大类型契约：

按总纲 § 5.4 数据契约草图实现：
- `ViewDefinition`（含 viewId / install / 五大交互独有项）
- `Capability`（含 id / 五大交互注册项 / keybindings / schema / converters / createInstance / commands）
- `ContextMenuItem` / `ToolbarItem` / `SlashItem` / `HandleItem` / `FloatingToolbarItem`（命令字段必须 `command: string` 不允许 function）
- `KeyBinding`、`CommandHandler`、`SchemaContribution`、`HostElement`、`CapabilityOptions`、`CapabilityInstance`（占位类型即可）
- `enabledWhen` 字段使用 `'always' | 'has-selection' | 'is-editable'` 字面量联合（有限枚举）

**约束**：仅类型，无运行时代码。`import` 列表为空。允许内部交叉引用（如 `ViewDefinition.contextMenu` 引用 `ContextMenuItem`）。

### J3-补：删 `tsconfig.json:15` 的 `"rootDir": "src",` 行

> **背景**：阶段 01 第三次 Builder 启动 J4 试做时触发 BLOCKING——主 `tsconfig.json` 中 `rootDir: "src"` 与 `include: ["src/**/*", "tools/**/*"]` 互斥，TS 报错 `TS6059: 'rootDir' is expected to contain all source files`。这是阶段 00 J3 的工程债（仅扩 include 未同步处理 rootDir）。
>
> **副作用评估**：仓库唯一的 `tsc` 调用是 `tsc --noEmit -p tsconfig.json`（package.json:14），`rootDir` 仅影响 `outDir` 路径计算，**noEmit 模式下完全无关**。Vite 自管打包不依赖 tsc emit。删除安全。

修改 `tsconfig.json` 删除以下一行（仅此一处改动，其他字段保留）：

```diff
   "outDir": ".vite/build",
-  "rootDir": "src",
   "baseUrl": ".",
```

**关键约束**：
- **仅删** `"rootDir": "src",` 这一行
- 不动 outDir / baseUrl / paths / target / module / 其他任何字段
- 不动 include（保留 `["src/**/*", "tools/**/*"]`）
- 不动 exclude

完成后 Builder 立即跑 `npm run typecheck` 验证 exit 0（应当与 J3 完成态一致——因为还没创建 J4 文件）。

### J4：创建 `tools/lint/pure-utility-allowlist.ts`

创建文件 [tools/lint/pure-utility-allowlist.ts](../../../../tools/lint/pure-utility-allowlist.ts)（新文件 + 新目录 `tools/lint/`），导出纯工具白名单：

```ts
/**
 * 纯函数工具白名单——视图层与插件层允许直接 import 的 npm 包。
 * 准入标准（见总纲 § 1.3 规则 B）：无状态 / 无生命周期 / 无 UI / 调用即返回。
 * 修订需独立 PR + 评审。
 */
export const PURE_UTILITY_ALLOWLIST = [
  // 时间
  'dayjs',
  'date-fns',
  // 函数式工具
  'lodash',
  'lodash-es',
  // class 拼接
  'clsx',
  'classnames',
  // ID 生成
  'nanoid',
  'uuid',
  // 类型校验
  'zod',
  // UI 框架本身（视图组件天然要 import React）
  'react',
  'react-dom',
  // 状态库（无副作用、无生命周期）
  'zustand',
  'jotai',
] as const;

export type PureUtility = typeof PURE_UTILITY_ALLOWLIST[number];
```

**约束**：仅常量 + 类型，无逻辑代码。

### J5：扩展现有 `eslint.config.mjs` 加入 5 条 KRIG 项目规则

> **基线确认**：阶段 00-eslint-bootstrap 已 merge 到 main（commit `20bf6414`）。当前仓库已有：
> - `eslint.config.mjs`（flat config 风格，39 行，含 4 条 `'off'` 降噪）
> - `npm run lint`（exit 1：仓库现有代码 lint 问题，允许）
> - `npm run typecheck`（exit 0：type-clean）
> - ESLint 10.3.0 + typescript-eslint 8.59.1 + @eslint/js 10.0.1
>
> 本 J5 在此基线上**修改 `eslint.config.mjs`**——不新建任何 config 文件、不切换 config 风格。

#### J5 拆分为 J5.1 ~ J5.5（每条规则独立判据）

修改 `eslint.config.mjs`：保留现有 4 条 `'off'` 降噪不动，**追加** 5 个 config object（每条规则一个 object，便于以后独立维护与 grep）。

#### J5.1：禁止 import 布局特权 API

```js
{
  files: ['src/plugins/**'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['**/window/shell', '**/slot/*', '@main/window/*'],
        importNames: ['openCompanion', 'ensureCompanion', 'closeRightSlot', 'openRightSlot'],
        message: 'L5 插件禁止直接调布局特权 API。改用 dispatch(IntentEvent) — 见 docs/refactor/00-总纲.md § 1.1 分层原则',
      }],
    }],
  },
},
```

#### J5.2：禁止跨插件 import

跨插件 `plugins/<X>` 不能 import `plugins/<Y>`。**实施手段由 Builder 自决（NON-BLOCKING）**：
- 优先：`no-restricted-imports` 的 `patterns` + glob（如 `src/plugins/note/**` 的 `patterns: ['**/plugins/!(note)/**']`）
- 备选：每个插件目录单独配 `files` + `patterns` 多个 config object

**约束**：实现必须能让"`plugins/note/**` 的代码 import `plugins/web/**`"被 ESLint 报 error。Builder 在 J5.5 测试中验证。

#### J5.3：`src/shared/**` 禁止 import `electron`

```js
{
  files: ['src/shared/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: 'electron',
        message: 'shared 是跨进程契约层,禁止 import electron — 见总纲 § 6 数据模型四层',
      }],
    }],
  },
},
```

#### J5.4：视图层禁止 import 非白名单 npm 包（warn 级，波次 3 升 error）

```js
{
  files: ['src/plugins/**/views/**'],
  rules: {
    'no-restricted-imports': ['warn', {
      patterns: [{
        // 通用模式:禁止 import 任何不以 @shared/ @capabilities/ 或相对路径开头的包
        // 排除白名单(从 tools/lint/pure-utility-allowlist.ts 同步:dayjs/lodash/clsx/...)
        group: [
          // 拦截非白名单 npm 包(简化实现:列出禁止的高风险包,白名单包不出现在 group 中)
          'three', 'three/*',
          'prosemirror-*',
          'pdfjs-dist', 'pdfjs-dist/*',
          'epubjs',
          '@anthropic-ai/sdk',
          'openai',
          'elkjs',
        ],
        message: 'L5 视图层禁止直接 import 重型外部依赖,必须经 src/capabilities/ 封装 — 见总纲 § 1.3 抽象原则',
      }],
    }],
  },
},
```

> **简化策略说明**：完整"反向白名单"（"禁止任何不在 PURE_UTILITY_ALLOWLIST 的包"）需要写很复杂的 negative lookahead glob，ESLint `no-restricted-imports` 表达力受限。本次采用**正向黑名单**——列出已知重型外部依赖，未来发现新包时由独立 PR 添加。这与总纲 § 1.3 规则 A "外部依赖必须经 Capability 封装"语义等价，且可演进。
>
> Builder 须**直接 import** `tools/lint/pure-utility-allowlist.ts` 在 `eslint.config.mjs` 中（作为该决策的"白名单单一真值"引用，便于以后维护时同步）——但**不必**在 ESLint 规则中实际使用 PURE_UTILITY_ALLOWLIST 数组（受 ESLint 表达力限制）。引用形如 `import { PURE_UTILITY_ALLOWLIST } from './tools/lint/pure-utility-allowlist.ts';` 即可——若失败则改用注释 "白名单单一真值见 tools/lint/pure-utility-allowlist.ts"。

#### J5.5：禁建 `engine/` / `runtime/` / `lib/` 目录（含历史白名单）

ESLint 不擅长"目录是否存在"这类文件系统检查。**降级为脚本**：

> **历史 baseline 说明**：阶段 01 起草时仓库已存在 2 个违规目录（早于本阶段引入）：
> - `src/plugins/note/lib/`（commit `769b2bff`）
> - `src/plugins/browser-capability/runtime/`（commit `b1bb596a`）
>
> 按总纲 § 1.3 "过渡期处置"精神（已有违规先豁免、波次 3/4 各插件迁移时清），脚本对这 2 条**显式白名单豁免**。波次 3 Note 迁移时清第 1 条；波次 4 L0 收口或 web 迁移时清第 2 条。**未来新增**违规仍立即拦截。

新建 `tools/lint/check-plugin-dirs.sh`（**字节级照抄**——不允许 Builder 自行扩展白名单）：

```bash
#!/usr/bin/env bash
# 验证 plugins/<X>/ 下不存在 engine/ runtime/ lib/ 目录(总纲 § 4.1 / § 5.8 规定)
# 失败时退出非 0,可接 npm run lint 或 CI

set -euo pipefail

# 历史 baseline 白名单——本阶段起草时已存在的违规,等波次 3/4 各插件
# 迁移时清。详见 task-card § J5.5。新增违规不允许进入此白名单——必须
# 走独立 PR 评审。
ALLOWLIST=(
  "src/plugins/note/lib"
  "src/plugins/browser-capability/runtime"
)

is_allowlisted() {
  local dir="$1"
  local entry
  for entry in "${ALLOWLIST[@]}"; do
    if [[ "$dir" == "$entry" ]]; then
      return 0
    fi
  done
  return 1
}

ALL_HITS=$(find src/plugins -mindepth 2 -maxdepth 2 -type d \( -name 'engine' -o -name 'runtime' -o -name 'lib' \) 2>/dev/null || true)

VIOLATIONS=""
while IFS= read -r dir; do
  [[ -z "$dir" ]] && continue
  if ! is_allowlisted "$dir"; then
    VIOLATIONS+="$dir"$'\n'
  fi
done <<< "$ALL_HITS"

if [[ -n "$VIOLATIONS" ]]; then
  echo "❌ 发现违规目录(总纲 § 4.1 规定):"
  printf '%s' "$VIOLATIONS"
  echo ""
  echo "  plugins/<X>/ 下禁建 engine/runtime/lib/——"
  echo "  外部依赖必须封装到 src/capabilities/<x>/ 内"
  echo "  详见 docs/refactor/00-总纲.md § 5.8"
  exit 1
fi

echo "✓ 插件目录结构合规(${#ALLOWLIST[@]} 条历史 baseline 白名单已豁免,详见脚本注释)"
```

并在 `package.json` `scripts` 中**追加**一条 script（不修改现有 lint/typecheck）：

```json
{
  "scripts": {
    "lint:dirs": "bash tools/lint/check-plugin-dirs.sh"
  }
}
```

Builder 须 `chmod +x tools/lint/check-plugin-dirs.sh`。

#### J5 验证测试（5 条规则同时）

在临时违规目录/文件中触发 5 类违规，分别确认 ESLint / 脚本报错。**验证完移除全部测试代码**（不留示例）：

```bash
# 测试 1: J5.1 布局特权
echo "import { openCompanion } from '@main/window/shell';" > src/plugins/note/test-j51.ts
# 测试 2: J5.2 跨插件
echo "import x from '@plugins/web/foo';" > src/plugins/note/test-j52.ts
# 测试 3: J5.3 shared 禁 electron
echo "import { app } from 'electron';" > src/shared/test-j53.ts
# 测试 4: J5.4 视图层禁外部依赖
mkdir -p src/plugins/note/views/test
echo "import * as THREE from 'three';" > src/plugins/note/views/test/test-j54.ts
# 测试 5a: J5.5 目录禁建(新增违规——预期被拦截)
mkdir -p src/plugins/note/engine

npm run lint > /tmp/lint-test.log 2>&1; LINT_EXIT=$?
npm run lint:dirs > /tmp/dirs-test.log 2>&1; DIRS_EXIT=$?

# 验证报错(预期 J5.1/2/3 是 error,J5.4 是 warn,J5.5 脚本 exit 1)
grep "test-j51" /tmp/lint-test.log    # 预期含 error
grep "test-j52" /tmp/lint-test.log    # 预期含 error
grep "test-j53" /tmp/lint-test.log    # 预期含 error
grep "test-j54" /tmp/lint-test.log    # 预期含 warning(注:可能要 grep "warning" 单独行)
[[ $DIRS_EXIT -ne 0 ]] || echo "❌ J5.5 脚本应对新增违规退出非 0"
grep "src/plugins/note/engine" /tmp/dirs-test.log     # 预期含新增违规
grep "src/plugins/note/lib" /tmp/dirs-test.log && \
  echo "❌ J5.5 白名单豁免失败" || echo "✓ note/lib 白名单豁免有效"
grep "src/plugins/browser-capability/runtime" /tmp/dirs-test.log && \
  echo "❌ J5.5 白名单豁免失败" || echo "✓ browser-capability/runtime 白名单豁免有效"

# 清理临时违规
rm -f src/plugins/note/test-j51.ts src/plugins/note/test-j52.ts src/shared/test-j53.ts src/plugins/note/views/test/test-j54.ts /tmp/lint-test.log /tmp/dirs-test.log
rmdir src/plugins/note/views/test src/plugins/note/views 2>/dev/null || true
rmdir src/plugins/note/engine 2>/dev/null || true

# 测试 5b: J5.5 baseline 状态(无新增违规——预期 exit 0,即白名单豁免后干净)
npm run lint:dirs > /tmp/dirs-baseline.log 2>&1; DIRS_BASELINE_EXIT=$?
[[ $DIRS_BASELINE_EXIT -eq 0 ]] || echo "❌ J5.5 baseline 应当通过(白名单豁免历史 2 条)"
grep "白名单已豁免" /tmp/dirs-baseline.log || echo "❌ 未输出白名单豁免摘要"
rm -f /tmp/dirs-baseline.log
```

验证完成后**测试代码与目录全部移除**，仓库回到无测试残留状态（仅 2 条历史白名单目录保留，那是仓库现状）。

## 严禁顺手做

- ❌ 不修改任何业务代码（`src/main/**`、`src/renderer/**`、`src/plugins/**`、`src/capabilities/**` 内既有文件）
- ❌ 不创建任何 `src/capabilities/*` 目录或文件（这是波次 2 的工作）
- ❌ 不创建任何 `plugins/*/views/*` 目录（这是波次 3 的工作）
- ❌ 不修改 `src/shared/types/schema-*.ts`（已存在的四份骨架，本次不动）
- ❌ 不修改任何 commit / merge / push 已有提交（仅在本分支新增 commit）
- ❌ 不优化已有代码、不重命名、不调整格式
- ❌ 不动 memory 文件
- ❌ 即便发现总纲拼写错误也不改（独立 PR 处理）

## 完成判据

每条 Builder 必须证明：

- [ ] **J1**: CLAUDE.md 末尾存在 `## 重构期硬规则` 段落，包含 10 条禁令；段落最后引用总纲路径
- [ ] **J2**: `src/shared/intents.ts` 存在，可被 `import type { IntentEvent } from '@shared/intents'`（或等价路径）；文件无 `import` 语句；无运行时代码
- [ ] **J3**: `src/shared/ui-primitives.ts` 存在，导出至少 `ViewDefinition`、`Capability`、`ContextMenuItem`、`ToolbarItem`、`SlashItem`、`HandleItem`、`FloatingToolbarItem`、`KeyBinding`、`CommandHandler` 类型；文件无 `import` 语句；无运行时代码
- [ ] **J3-补**: `tsconfig.json` `compilerOptions.rootDir` 字段已删除（其他字段保留）；`npm run typecheck` exit 0
- [ ] **J4**: `tools/lint/pure-utility-allowlist.ts` 存在，`PURE_UTILITY_ALLOWLIST` 数组含至少 13 项
- [ ] **J5.1**: `eslint.config.mjs` 含布局特权 API 禁令 config object；测试文件 `src/plugins/note/test-j51.ts` 触发 `npm run lint` error；验证后测试文件已删除
- [ ] **J5.2**: 跨插件 import 禁令生效（实施手段 Builder 自决）；测试文件 `src/plugins/note/test-j52.ts` 触发 error；验证后已删除
- [ ] **J5.3**: `eslint.config.mjs` 含 shared 禁 electron 规则；测试文件 `src/shared/test-j53.ts` 触发 error；验证后已删除
- [ ] **J5.4**: 视图层禁外部依赖规则生效（warn 级）；测试文件 `src/plugins/note/views/test/test-j54.ts` 触发 warning；验证后测试文件 + 测试目录已全部删除
- [ ] **J5.5a**: `tools/lint/check-plugin-dirs.sh` 存在 + 可执行（`chmod +x`），内容**字节级匹配** task-card § J5.5 给出的 bash 脚本（含白名单 2 条）
- [ ] **J5.5b**: `package.json scripts.lint:dirs` 已添加为 `"bash tools/lint/check-plugin-dirs.sh"`
- [ ] **J5.5c**: 测试目录 `src/plugins/note/engine/`（新增违规）触发 `npm run lint:dirs` exit 非 0 + 输出含该路径；验证后测试目录已删除
- [ ] **J5.5d**: 白名单豁免有效：测试 5b 验证输出**不含** `src/plugins/note/lib` 与 `src/plugins/browser-capability/runtime`
- [ ] **J5b**: 现有代码中已存在的违规（如 web 插件 `import openai`、ebook 插件 `import pdfjs-dist` 等若存在）跑 `npm run lint` 输出 **warn**，**不阻塞**（lint exit 1 仍允许，与基线一致）
- [ ] **J6**: `git diff <派活基线>..HEAD --stat`（**Builder 引入的 diff**，吸收 Auditor 阶段 00 建议条目 3）含且仅含以下 8 个文件：`CLAUDE.md` / `src/shared/intents.ts` / `src/shared/ui-primitives.ts` / `tools/lint/pure-utility-allowlist.ts` / `tools/lint/check-plugin-dirs.sh` / `eslint.config.mjs` / `package.json` / `tsconfig.json`（J3-补 删 rootDir）
- [ ] **J7a**: `npm run typecheck` exit 0（仓库 baseline 已 type-clean，本次新增 .ts 文件不应引入 type 错误）
- [ ] **J7b**: `npm run lint` exit 1（允许；现有代码 lint 错误数与基线相同 ± 仅本次 J5 规则触发的现有违规数）
- [ ] **J7c**: 在 baseline 状态下（无测试残留）`npm run lint:dirs` exit 0（白名单豁免 2 条历史违规后输出无新增违规）

## 已知风险

来自总纲 + memory 的相关注意点：

- **R1（已答）**: 仓库 ESLint config 风格已由阶段 00-eslint-bootstrap 装入为 `eslint.config.mjs`（flat config）。Builder **直接修改** `eslint.config.mjs` 即可，不需探查、不需切换风格
- **R2**: TypeScript 路径别名（`@shared/`、`@capabilities/` 等）是否已配置在 tsconfig.json 的 `paths` 字段——Builder 要确认现有 path 配置，新文件采用与现有 `src/shared/types/schema-*.ts` 一致的 import 写法
- **R3（部分已答 + 工程债 J3-补）**: 阶段 00 已扩展 `tsconfig.json` `include` 至 `["src/**/*", "tools/**/*"]`，**但同时遗漏了 `rootDir: "src"` 与 include 的互斥**。阶段 01 第三次 Builder 启动 J4 时触发 TS6059。本 task-card v4 加 **J3-补**（删 `rootDir` 行）补救。Builder 必须先执行 J3-补 再做 J4，否则 J4 创建文件即让 typecheck 失败
- **R4**: Builder **不读 memory**，但要知道存在 memory `feedback_merge_requires_explicit_ok`——本任务卡也遵守：commit 由 Builder 自己做，merge/push 不做（列命令给 Commander）
- **R5**: J5.4 用"正向黑名单"而非"反向白名单"实现，是 ESLint `no-restricted-imports` 表达力受限下的妥协（详见 J5.4 说明）。未来发现新重型外部依赖时由独立 PR 添加到 `eslint.config.mjs` 的禁令列表
- **R6（吸收阶段 00 Auditor 建议条目 3）**: J6 完成判据使用 **Builder 引入的 diff**（自派活基线起的双点 diff `git diff <基线>..HEAD`），不是 `main...HEAD` 三点 diff。这避免"分支已含 Commander 派活 commit"造成的字面 vs 实质差异
- **R7（基线锁定）**: 派活基线为 main 当前 HEAD（包含阶段 00、00x、typecheck-baseline 三个 merge）。Builder 启动后 `git rebase main` 已由 Commander 列出指令，rebase 后基线即为 main 头部
- **R8（J5.5 白名单债，追踪项）**: J5.5 脚本豁免 2 条历史 baseline 违规（`note/lib` + `browser-capability/runtime`）。这是**待清理债**，应在以下波次中清掉对应白名单条目：
  - **波次 3.3 Note 迁移** 时清 `src/plugins/note/lib`（迁移其内容到合适位置）
  - **波次 3.4 Web 迁移 / 波次 4 L0 收口** 时清 `src/plugins/browser-capability/runtime`
  - 清理动作 = 删脚本 ALLOWLIST 数组中对应字符串 + 实际迁/删该目录

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认

1. **R1 已答**：仓库 ESLint config 是 flat config（阶段 00 装入 `eslint.config.mjs`）。Builder 直接修改该文件
2. **J5.5 目录禁建用脚本而非 ESLint** —— **Commander 答**：是。脚本为 `tools/lint/check-plugin-dirs.sh`，新增 `npm run lint:dirs` script。详见 J5.5
3. **J5 测试代码保留还是删除** —— **Commander 答**：不保留，验证完即删（含测试目录），仓库不留示例
4. **CLAUDE.md 是追加章节还是修改** —— **Commander 答**：仅在文件末尾追加 `## 重构期硬规则` 章节，不修改既有内容
5. **J5.4 视图层禁外部依赖采用什么实现策略** —— **Commander 答**：正向黑名单（列出已知重型外部依赖）。理由见 J5.4 说明 + R5
6. **`tools/lint/pure-utility-allowlist.ts` 是否要在 ESLint 中实际使用** —— **Commander 答**：仅作为"白名单单一真值"被 `eslint.config.mjs` import（或注释引用）。ESLint `no-restricted-imports` 表达力受限,实际拦截规则用 J5.4 黑名单实现
7. **J6 用什么 diff 口径** —— **Commander 答**：`git diff <派活基线>..HEAD`（Builder 引入的 diff），不用 `main...HEAD` 三点 diff。详见 R6
8. **J5.5 脚本是否需要支持白名单** —— **Commander 答**：是。仓库已存在 2 条历史 baseline 违规（`note/lib` + `browser-capability/runtime`），按总纲 § 1.3 过渡期处置精神显式豁免。脚本字节级写死 ALLOWLIST 数组（不外置文件，仅 2 条用硬编码足够）。Builder 字节级照抄即可，不允许扩展或修改白名单内容。详见 J5.5 + R8
9. **白名单未来增长怎么办** —— **Commander 答**：本阶段不增长，仅本次 BLOCKING 暴露的 2 条。如未来发现新的不可立即清的违规需要豁免，走独立 PR 评审，不允许 Builder 自决
10. **删 `rootDir` 是否影响打包/CI** —— **Commander 答**：不影响。仓库唯一 `tsc` 调用是 `tsc --noEmit`（package.json:14），rootDir 仅影响 `outDir` 路径计算，noEmit 模式下完全无关。Vite 自管打包不依赖 tsc emit。Commander 已 grep 验证：仓库无任何其他 `tsc -p tsconfig.json`（非 noEmit）调用

## Builder 完成后

- 写报告到 `tmp/builder-report.md`（按 BUILDER-PROMPT § 五格式）
- 在聊天中告知 Commander："builder-report 就绪"
- **不做** merge / push（列命令给 Commander，由用户拍板执行）

## 备注：本次为基础设施类子波次

本次任务**不动业务代码**，因此 BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动确认中的"契约 § B 防御代码 grep 验证"也跳过（无契约可对照）。

后续 L5 插件迁移子波次（波次 3.x）的 refactor-card 必须引用对应 `migration-contracts/<plugin>.md`，本豁免不适用。
