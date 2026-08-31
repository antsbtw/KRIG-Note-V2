# Builder 派活指令 — 阶段 02a：平台骨架

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J8 + 严禁顺手做 + 风险 R1~R6 + 预期歧义 5 条已答）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md（那是 Auditor 阶段的事）

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 2 推进节奏 / § 5 / § 7
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md) 含重构期硬规则段

4. **数据契约（阶段 01 已落，不动，仅引用）**：
   - [src/shared/intents.ts](../../../../src/shared/intents.ts) — IntentEvent 类型
   - [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) — ContextMenuItem / ToolbarItem 等

5. **现状参考（不读不修，仅了解）**：
   - [src/main/app.ts](../../../../src/main/app.ts) — ctx 派发现状（J2 修改对象）
   - [src/shared/plugin-types.ts](../../../../src/shared/plugin-types.ts) — PluginContext 接口（J2 可能需追加 `dispatch` 字段，详见 task-card 预期歧义 Q1）

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 02a-platform-skeleton（波次 2 第一阶段） |
| 目标分支 | `refactor/platform-skeleton`（**待你从 main 切出**，HEAD=`fc943e46`） |
| 派活基线 SHA | `fc943e46`（task-card § J6 强制使用此 SHA 做双点 diff 对账） |
| 功能契约 | **N/A**（基础设施类阶段，不动业务代码） |
| 完成判据 | task-card.md J1~J8（共 16 子项） |
| 严禁顺手做 | 18 个含特权 API 文件 + 69 ProseMirror + 8 Three.js + 任何 capability 子目录 |

## 三、执行流程（严格按序）

### 步骤 0：切分支

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git checkout main
git status   # 应当干净 + HEAD=fc943e46
git checkout -b refactor/platform-skeleton
mkdir -p tmp
```

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式输出：
- 已读文件清单
- J1~J8 完成判据逐条复述
- 契约 § B 防御代码 grep 验证：填"本次为基础设施类阶段，无功能契约，跳过"
- **风险预探**：
  - R1 实测：`npm run typecheck` 当前 exit 0（基线确认；J2 改 ctx 后再跑确认仍 0）
  - R3 已实测（Commander 已做，确认 path alias 工作）
  - 现有 `src/main/app.ts` 的 ctx 是否真有 6 个原有字段（task-card § J2c 列表）
  - PluginContext 接口（`src/shared/plugin-types.ts`）是否含 `dispatch` 字段（预期无，需追加）
- 识别到的歧义/冲突，分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J5

**严格按 task-card 顺序**逐项完成。每个 J 完成后立即 git commit，建议拆分：

```
J1:    feat(refactor/platform-skeleton): 新建 main/workspace/intent-dispatcher
J2:    feat(refactor/platform-skeleton): app.ts ctx 加 dispatch + plugin-types 同步
J3:    feat(refactor/platform-skeleton): renderer/ui-primitives/command-registry
J4:    feat(refactor/platform-skeleton): 5 个 ui-primitives 子目录骨架
J5:    feat(refactor/platform-skeleton): src/capabilities/ 占位 README
```

> J2 包含 `src/shared/plugin-types.ts` 的 PluginContext 接口追加 `dispatch` 字段（task-card 预期歧义 Q1 已答）——这是 J2 的隐含变更。如不追加,5 个 register*Plugin(ctx) 调用会因 ctx 多了字段而 typecheck 失败。

**每个 J 完成后立即跑 `npm run typecheck` 确认 exit 0**——避免后续 commit 累积 type 错误难以定位。

### 步骤 4：J6/J7/J8 验证

```bash
# J6 范围对账(强制双点 diff + 显式基线 SHA)
git diff fc943e46..HEAD --stat
# 预期:9 个文件(注:J2 隐含的 plugin-types.ts 改动让总数变 10,
# 这是 task-card 预期歧义 Q1 答案的自然结果——record 在 G 段)

# J7 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint:dirs     # 预期 exit 0,白名单摘要

# J8 commit message 符合规范
git log fc943e46..HEAD --oneline
```

### 步骤 5：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段全填。

特别提醒：
- D 段提交清单 SHA 完整列出
- G 段说明 plugin-types.ts 改动是 J2 隐含变更（task-card Q1 已答）

### 步骤 6：结束

聊天里输出：
```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset。

## 四、特别提醒

### 提醒 1：PluginContext 改动范围严格（Q1 答的实施）

`src/shared/plugin-types.ts` **仅追加** `dispatch: (event: IntentEvent) => void` 字段 + import IntentEvent。**绝不**：
- 修改其他 PluginContext 字段
- 修改其他类型定义
- 修改注释（除追加 dispatch 字段时的简短说明）

如果追加 `dispatch` 字段后 typecheck 失败（说明 PluginContext 在 plugins 内有强类型契约依赖），按 task-card R1 升级 BLOCKING——**不擅自修业务代码**。

### 提醒 2：5 个 ui-primitives 子目录字节级一致

5 个 index.ts 必须**结构完全相同**（仅 ItemType + 单例名 + 注释名词替换）。Auditor 会做字节级对账。**不允许**：
- 5 个文件之间的实现差异
- 自加调用方示例
- 自加注释（除 task-card 模板要求的）

### 提醒 3：旧 API 共存绝对不动

ctx 中的 `openCompanion` / `ensureCompanion` / `getMainWindow` / `getSlotBySenderId` / `getActiveViewWebContentsIds` / `runWithProgress` 6 个原有字段全部保留。J2c 是硬判据。Auditor 会逐字段对账。

### 提醒 4：J6 用双点 diff（吸收 COMMANDER-PROMPT § 六新纪律）

```bash
git diff fc943e46..HEAD --stat   # ✅ 双点 diff,显式基线 SHA
```
**绝不**：
```bash
git diff main...HEAD --stat       # ❌ 三点 diff(本阶段虽然分支头无 Commander 派活 commit,但按总规则统一)
```

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git checkout main
git status                           # 应当 nothing to commit + HEAD=fc943e46
git checkout -b refactor/platform-skeleton
mkdir -p tmp
git log --oneline -3                 # 确认基线
ls src/capabilities src/renderer/ui-primitives src/main/workspace/intent-dispatcher.ts 2>&1 | head -3
# 预期 3 个 "No such file" —— 这正是 02a 要创建的
npm run typecheck                    # 确认基线 exit 0
```

之后按步骤 1 写 `tmp/builder-startup.md`，按步骤 2~6 推进。

---

**记住**：你的价值在于"严格按 task-card 执行 + 完整自检 + 不越界"。本阶段比阶段 01 简单——只做"通道建好"，不动旧代码。完成或停止后立即结束会话。
