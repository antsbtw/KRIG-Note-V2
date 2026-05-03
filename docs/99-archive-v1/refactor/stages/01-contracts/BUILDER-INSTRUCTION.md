# Builder 派活指令 — 阶段 01：契约定型

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J5 + 完成判据 + 严禁顺手做 + 风险 + 预期歧义答案）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不要读 AUDITOR-INSTRUCTION.md（那是 Auditor 阶段的事）

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 01-contracts（波次 1：契约定型） |
| 目标分支 | `refactor/contracts`（已 rebase 到最新 main，含 ESLint 工具链 + tsc=0 基线） |
| 功能契约 | **N/A**（基础设施类子波次） |
| 完成判据 | task-card.md **J1~J5.5 + J5b + J6 + J7a~J7c**（共 12 条） |
| 严禁顺手做 | task-card.md "严禁顺手做"段 |
| 基线状态 | `npm run lint` exit 1（允许）/ `npm run typecheck` exit 0（type-clean）/ `eslint.config.mjs` 已存在 39 行 |

## 三、执行流程（严格按序）

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式输出：
- 已读文件清单
- 完成判据 J1~J7 逐条复述
- 契约 § B 防御代码 grep 验证：**填"本次为基础设施类子波次，无功能契约，跳过"**
- 识别到的歧义/冲突，分级：
  - **BLOCKING**：无法继续的（如 task-card 自相矛盾、引用文件不存在等）
  - **NON-BLOCKING**：按 task-card 字面 + 总纲推断后可继续的

### 步骤 2：决定走向

- **无 BLOCKING** → 直接进入步骤 3，不等任何人确认
- **有 BLOCKING** → 写 `tmp/builder-blockers.md` 列具体阻塞项，然后**会话结束**，输出一句"BLOCKING 已停"

### 步骤 3：执行 J1~J5.5

按 task-card 顺序逐项完成。每项完成立即 git commit（commit message 按 CLAUDE.md 规范）。建议拆分：

```
J1:    feat(refactor/contracts): CLAUDE.md 加重构期硬规则段
J2:    feat(refactor/contracts): shared/intents.ts IntentEvent 类型骨架
J3:    feat(refactor/contracts): shared/ui-primitives.ts ViewDefinition + Capability 类型
J3-补: fix(refactor/contracts): 删 tsconfig rootDir 解 include/rootDir 互斥
J4:    feat(refactor/contracts): tools/lint/pure-utility-allowlist.ts 白名单
J5.1:  feat(refactor/contracts): eslint 禁布局特权 API
J5.2:  feat(refactor/contracts): eslint 禁跨插件 import
J5.3:  feat(refactor/contracts): eslint shared 禁 electron
J5.4:  feat(refactor/contracts): eslint 视图层禁外部依赖(warn)
J5.5:  feat(refactor/contracts): tools/lint/check-plugin-dirs.sh + lint:dirs script
J5 验证: test(refactor/contracts): J5.1~J5.5 违规测试通过(测试代码已删)
```

> **续做提示**：当前分支 `refactor/contracts` 已含 J1/J2/J3 三个 commit（来自第三次 Builder 启动）：`1b6cf66b` / `b923fdf4` / `9ea65adc`。本次 Builder 启动**从 J3-补 续做**，不重做 J1~J3。启动自检读 git log 时会看到这三个 commit 已存在,确认它们合规即可继续。

**关键约束（来自 task-card "严禁顺手做"）**：
- 只动 task-card 明确列出的 8 个文件（含 tsconfig.json，仅 J3-补 删 rootDir 一处）
- 不修改任何业务代码（`src/main/**`、`src/renderer/**`、`src/plugins/**`、`src/capabilities/**`）
- 不修改已存在的 `src/shared/types/schema-*.ts`
- 不修改已存在的 `eslint.config.mjs` 中的 4 条 off 降噪（仅追加 5 个新 config object）
- 不优化、不重命名、不调整格式
- 不动 memory 文件
- **测试代码完成验证后必须全部删除**（含临时违规文件 + 临时违规目录）

### 步骤 4：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段全填。任何 NON-BLOCKING 歧义的处理记录在 G 段。

### 步骤 5：结束

聊天里输出一句话：
```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset 等破坏性 git 操作（列命令交回 Commander）。

## 四、特别提醒（已知风险）

详见 task-card.md 的 R1~R7，重点：

- **R1 已答**：仓库已有 `eslint.config.mjs`（flat config），直接修改它（追加 config object），**不切换风格**
- **R3 已答**：阶段 00 已扩 tsconfig include 至 `tools/**/*`，新建 `.ts` 文件自动 typecheck
- **R5**：J5.4 用正向黑名单实现（列禁止包），不是反向白名单——是 ESLint 表达力受限下的妥协
- **R6**：J6 用 `git diff <派活基线>..HEAD`（双点）口径，不用 `main...HEAD`（三点）—— 这是吸收阶段 00 Auditor 建议的修订
- **R7**：派活基线为 main 当前 HEAD（含阶段 00 / 00x / typecheck-baseline 三个 merge）。rebase 后基线即 main 头部

## 五、最简起步命令（参考）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git checkout refactor/contracts
git status
git log --oneline -3

# 验证阶段 00 工具链已就绪
ls eslint.config.mjs && grep "lint" package.json | head -3
npm run typecheck     # 应当 exit 0(基线 type-clean)

mkdir -p tmp   # 准备报告输出目录
```

之后按步骤 1 写 `tmp/builder-startup.md`，按步骤 2~5 推进。

---

**记住**：你的价值在于"严格按 task-card 执行 + 完整自检 + 不越界"。完成或停止后立即结束会话，**不要在执行中向用户/Commander 请示**——所有决策已在 task-card + 顶层规则中明确。
