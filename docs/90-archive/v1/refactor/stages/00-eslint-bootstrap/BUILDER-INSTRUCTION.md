# Builder 派活指令 — 阶段 00：ESLint Bootstrap

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无需向 Commander 请示（无 BLOCKING 时）。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J0~J7 完成判据 + 严禁顺手做 + 风险 R1~R3 + 预期歧义答案）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md（那是 Auditor 阶段的事）

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 00-eslint-bootstrap（ESLint 工具链 bootstrap） |
| 目标分支 | `refactor/eslint-bootstrap`（已切出，HEAD=`bd390c70`） |
| 功能契约 | **N/A**（基础设施类前置波次） |
| 完成判据 | task-card.md J0~J7 |
| 严禁顺手做 | task-card.md "严禁顺手做"段（**不写项目规则、不动业务代码**） |

## 三、执行流程（严格按序）

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式输出：
- 已读文件清单
- 完成判据 J0~J7 逐条复述
- 契约 § B 防御代码 grep 验证：**填"本次为基础设施类前置波次，无功能契约，跳过"**
- **R1~R3 风险预探**（task-card 已要求）：
  - R1：先跑 `npx tsc --noEmit -p tsconfig.json` 确认现有代码 typecheck 是否通过（用 `npx tsc` 因为 J1 还没加 script）
  - R2：grep `package.json` 是否有 `"type": "module"`
  - R3：grep `package.json` 中 `typescript` 版本号是否 ≥ 4.7
- 识别到的歧义/冲突，分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 直接进入步骤 3，不等任何人确认
- **有 BLOCKING**（如 R1 失败、R2 显示非 ESM、R3 版本太低）→ 写 `tmp/builder-blockers.md` 列具体阻塞项，**会话结束**，输出"BLOCKING 已停"

### 步骤 3：执行 J0~J5

按 task-card 顺序逐项完成。每个 J 完成后立即 git commit（commit message 按 CLAUDE.md 规范），建议拆为：

```
J0:  feat(refactor/eslint-bootstrap): 装 ESLint 9.x + typescript-eslint
J1:  feat(refactor/eslint-bootstrap): 加 lint / typecheck script
J2:  feat(refactor/eslint-bootstrap): 加最小可运行 eslint.config.mjs
J3:  fix(refactor/eslint-bootstrap): tsconfig include 扩至 tools/**
J4:  fix(refactor/eslint-bootstrap): .gitignore 加根目录 tmp/
J5:  test(refactor/eslint-bootstrap): 验证 lint / typecheck / install 全通过
```

**关键约束**（来自 task-card "严禁顺手做"）：
- 只动 task-card § J0~J5 明确列出的 5 个文件：`package.json` / `package-lock.json`（npm install 自动） / `eslint.config.mjs` / `tsconfig.json` / `.gitignore`
- 不修改任何 .ts/.tsx 业务代码
- 不修复已有的 lint warning 或 type 错误
- 不创建 `tools/lint/` 目录或下面任何文件
- 不创建 `src/shared/intents.ts` 等阶段 01 文件
- 不修改 CLAUDE.md
- **不写项目业务规则**（不在 eslint.config.mjs 中加任何 "no-restricted-imports"、"no-restricted-paths" 等针对 KRIG 业务的规则）—— 阶段 01 才做

### 步骤 4：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~F 段填全。

特别提醒：
- A 段对账每个 J 必须有具体证据（文件:行号 / commit SHA / 命令输出）
- C 段 "范围越界自检" 必须诚实：是否动了 .ts/.tsx？是否加了项目规则？
- F 段填"无"如果什么都没漏

### 步骤 5：结束

聊天里输出一句话：
```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset 等破坏性 git 操作。

## 四、特别提醒

### 提醒 1：R1 现有 type 错误绝对不修

`npx tsc --noEmit` 如果在仓库现有代码上炸出红字——这是仓库**本来就有的** type 问题。**Builder 必须 BLOCKING 停下**，让 Commander 决定如何处理。**绝对不修**任何业务代码，即便错误"看起来很简单"。

### 提醒 2：J2 文件内容要字节级匹配 task-card

`eslint.config.mjs` 内容**必须照抄 task-card § J2 代码块**——这是 Auditor 审计点 J2b 的对账标准。不允许"看起来更优雅地"重写。

### 提醒 3：J5 验证退出码

J5b（`npm run lint`）退出码 0 或 1 都行（lint 错误允许），但**不能 crash**——如果输出 "Configuration error" 或 "Invalid syntax in eslint.config.mjs" 等，说明 J2 配置写错了，必须排查修正。

J5c（`npm run typecheck`）退出码必须 0。如果非 0，回到提醒 1（R1 BLOCKING）。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git checkout refactor/eslint-bootstrap
git status
git log --oneline -3
mkdir -p tmp   # 准备报告输出目录
# 然后开始 R1/R2/R3 风险预探...
```

---

**记住**：你的价值在于"严格按 task-card 执行 + 完整自检 + 不越界"。完成或停止后立即结束会话，不要在执行中向用户/Commander 请示——所有决策已在 task-card + 顶层规则中明确。
