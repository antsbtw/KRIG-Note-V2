# Builder 启动自检（续做）：refactor/contracts（阶段 01-contracts，task-card v4）

## 续做状态

本会话从 **J3-补** 续做。J1+J2+J3 已在前一会话 commit：

| J | commit SHA | 状态 |
|---|---|---|
| J1 | `1b6cf66b` | ✅ CLAUDE.md 加重构期硬规则段 |
| J2 | `b923fdf4` | ✅ shared/intents.ts |
| J3 | `9ea65adc` | ✅ shared/ui-primitives.ts |

剩余：J3-补 / J4 / J5.1 / J5.2 / J5.3 / J5.4 / J5.5 / 验证。

## 已读输入
- ✅ task-card v4（commit `929ac1f9`，加 J3-补 + J6 清单扩 8 文件）
- ✅ BUILDER-INSTRUCTION.md（同会话已读，未变）
- ✅ README.md（同会话已读）
- ⛔️ AUDITOR-INSTRUCTION.md（按指令不读）
- ✅ BUILDER-PROMPT（同会话已读）
- ✅ 总纲 v2.3 / CLAUDE.md（同会话已读）

## 当前分支状态

- 分支：`refactor/contracts`，HEAD = `929ac1f9`，工作树干净
- `npm run typecheck`：EXIT 0
- `npm run lint`：EXIT 1（778 problems / 765 errors / 13 warnings — 与基线一致）
- `tsconfig.json:15` 仍含 `"rootDir": "src",`（待 J3-补 删）
- `find src/plugins -mindepth 2 -maxdepth 2 -type d \( -name engine -o -name runtime -o -name lib \)` 命中 2 条历史 baseline（与 J5.5 白名单一致）

## v4 task-card 余下完成判据

- **J3-补**：`tsconfig.json` 删 `"rootDir": "src",` 一行；其他字段保留；`npm run typecheck` exit 0
- **J4**：`tools/lint/pure-utility-allowlist.ts` 字节级照抄（PURE_UTILITY_ALLOWLIST 13 项 + PureUtility 类型）
- **J5.1**：`eslint.config.mjs` 追加布局特权 API 禁令 config object（字节级照抄）
- **J5.2**：跨插件 import 禁令（实施手段自决；倾向逐插件 files+patterns 多 config object）
- **J5.3**：shared 禁 electron 规则（字节级照抄）
- **J5.4**：视图层禁外部依赖 warn（字节级照抄；尝试 import PURE_UTILITY_ALLOWLIST，失败回退注释）
- **J5.5a/b/c/d**：check-plugin-dirs.sh 字节级照抄（含历史白名单 2 条）+ chmod +x + lint:dirs script + 测试新增违规拦截 + 白名单豁免有效
- **J5b**：现有违规 J5.4 触发 warn 不阻塞
- **J6**：Builder 引入的 diff 含且仅含 8 个文件（含 `tsconfig.json`）
- **J7a/b/c**：typecheck=0 / lint=1 / lint:dirs=0

## 契约 § B 防御代码 grep 验证

本次为基础设施类子波次，无功能契约，跳过。

## 识别到的歧义/冲突

### BLOCKING

无。

### NON-BLOCKING

1. **J5.2 跨插件 import 实施手段**（task-card 明示自决）：实测 ESLint `no-restricted-imports` 的 `patterns` 接受 minimatch glob 但不支持 `!(...)` negation；逐插件分别配 `files: ['src/plugins/<X>/**']` + `patterns: ['@plugins/<其他 8 个插件>/**']` 是稳妥方案。`ls src/plugins/` = 9 个插件（ai-note-bridge / browser-capability / demo / ebook / graph / note / thought / web / web-bridge）→ 9 个 config object。
2. **J5.4 `import { PURE_UTILITY_ALLOWLIST } from './tools/lint/...'` 在 .mjs 中是否有效**：`.ts` 文件不能在 ESM `.mjs` 中直接 import（Node 不识别 `.ts`，需 ts-node/tsx 等 loader）。task-card 已预警"若失败则改用注释"——按"注释引用 + import 不实际生效"二选一,我会按字面"先尝试 import,失败则改注释"。事先判断 99% 会失败(无 ts loader 配置),所以会落地为注释引用。

## 我的下一步
- [x] 无 BLOCKING：进入执行阶段
- 计划 commit 拆分：
  - J3-补：`fix(refactor/contracts): tsconfig 删 rootDir(允许 tools/** 进 typecheck)`
  - J4: `feat(refactor/contracts): tools/lint/pure-utility-allowlist.ts 白名单`
  - J5.1: `feat(refactor/contracts): eslint 禁布局特权 API`
  - J5.2: `feat(refactor/contracts): eslint 禁跨插件 import`
  - J5.3: `feat(refactor/contracts): eslint shared 禁 electron`
  - J5.4: `feat(refactor/contracts): eslint 视图层禁外部依赖(warn)`
  - J5.5: `feat(refactor/contracts): tools/lint/check-plugin-dirs.sh + lint:dirs script`
- 完成后写 `tmp/builder-report.md`
