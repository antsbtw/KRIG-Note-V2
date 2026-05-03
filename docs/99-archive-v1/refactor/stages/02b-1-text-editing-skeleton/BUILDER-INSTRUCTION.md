# Builder 派活指令 — 阶段 02b-1：text-editing 最小骨架

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J8 + 严禁顺手做 + 风险 R1~R6 + 预期歧义 4 条已答）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md（那是 Auditor 阶段的事）

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 1.3 / § 5.4 / § 5.9
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md) 含重构期硬规则段

4. **数据契约（阶段 01 已落，引用，不修改）**：
   - [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口

5. **现状参考（J3 修改对象）**：
   - [src/capabilities/README.md](../../../../src/capabilities/README.md) 含"## 当前状态(阶段 02a-platform-skeleton)"段

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 02b-1-text-editing-skeleton（波次 2 第二阶段第一步） |
| 目标分支 | `refactor/text-editing-skeleton`（**已切出**，HEAD=`5b478326` 来自 main） |
| 派活基线 SHA | `5b478326`（task-card § J4 强制使用此 SHA 做双点 diff 对账） |
| 功能契约 | **N/A**（基础设施类阶段，不动业务代码） |
| 完成判据 | task-card.md J1~J8（共 11 子项） |
| 严禁顺手做 | 任何 ProseMirror 业务代码（69 文件）+ 视图层 + ESLint/tsconfig + capability/README.md 其他段 |

## 三、执行流程（严格按序）

### 步骤 0：分支已切，无需重新 checkout

`refactor/text-editing-skeleton` 分支已由 Commander 创建（基于 main `5b478326`），4 个 stage docs 已 commit。Builder 启动后第一步：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/text-editing-skeleton
git log --oneline -3
mkdir -p tmp
```

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式输出：
- 已读文件清单
- J1~J8 完成判据逐条复述
- 契约 § B 防御代码 grep 验证：填"本次为基础设施类阶段，无功能契约，跳过"
- **基线确认**（task-card § R6 + § J4 + § J5）：
  ```bash
  npm run typecheck > /dev/null 2>&1; echo "tc: $?"           # 预期 0
  npm run lint > /dev/null 2>&1; echo "lint: $?"              # 预期 1
  npm run lint 2>&1 | grep "✖" | tail -1                      # 预期 780 (765e + 15w)
  npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"         # 预期 0
  ls src/capabilities/text-editing 2>&1 | head -1             # 预期 No such file（02b-1 创建对象）
  ```
- 识别到的歧义/冲突，分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J3

按 task-card 顺序逐项完成。建议 3 个 commit（task-card Q4 已答 Builder 自决）：

```
J1: feat(refactor/text-editing-skeleton): textEditingCapability 最小骨架
J2: feat(refactor/text-editing-skeleton): text-editing/README.md
J3: docs(refactor/text-editing-skeleton): capabilities/README.md 同步状态
```

每个 J 完成后立即跑：
```bash
npm run typecheck      # 应当 exit 0
```

避免后续 commit 累积 type 错误难以定位。

**关键约束（来自 task-card "严禁顺手做"）**：
- 仅创建 `src/capabilities/text-editing/index.ts` + `src/capabilities/text-editing/README.md` 2 个新文件
- 仅修改 `src/capabilities/README.md` "## 当前状态"段（其他段字节不变）
- 不创建任何 `text-editing/<其他>` 子目录或文件
- 不创建任何 `src/capabilities/<其他 capability>` 子目录
- 不动任何业务代码

### 步骤 4：J4/J5/J6/J7/J8 验证

```bash
# J4 范围对账(强制双点 diff + 显式基线 SHA)
git diff 5b478326..HEAD --stat
# 预期: 3 个文件(去除 4 个 docs/refactor/stages/02b-1-text-editing-skeleton/ Commander 派活 commit)

# J5 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 780(765e + 15w 不变)
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log 5b478326..HEAD --oneline

# J7/J8 capabilities 目录结构
find src/capabilities -type d   # 预期: src/capabilities + src/capabilities/text-editing
find src/capabilities -type f   # 预期: 3 个文件
```

### 步骤 5：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段全填。

特别提醒：
- A 段 J5b 必须列出 lint 输出 `✖ N problems (X errors, Y warnings)` —— 验证 errors 数仍 765,warnings 数仍 15
- D 段提交清单 SHA 完整列出
- G 段如有 NON-BLOCKING 歧义记录处理方式

### 步骤 6：结束

聊天里输出：
```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset。

## 四、特别提醒

### 提醒 1：J3 用精准 Edit 而非 Write

`src/capabilities/README.md` 当前内容含 4 个 markdown 段（`# Capabilities` 标题段、`## 当前状态`、`## 设计原则`、`## 不在本目录的实现`）。**仅修改"## 当前状态"段**——用 Edit 工具精准替换，**不许** Write 整文件（避免误改其他段）。

修改前先 Read 该文件全文，确认其他 3 段当前内容。

### 提醒 2：J3 子项要填具体 J1 commit SHA

task-card § J3 修改后的"## 当前状态"段中`<填 J1 commit SHA>` 占位符，Builder 在做 J3 时 **填入 J1 实际 commit SHA**（如 `3584a1b2...`，前 8 位即可）。

### 提醒 3：J1 / J2 字节级照抄

task-card § J1 + § J2 给的代码块**字节级照抄**——不允许任何"觉得更好的"调整：
- 不加额外 export
- 不加额外注释
- 不调整字段顺序
- 不改字符串字面量

Auditor 会做字节级对账。

### 提醒 4：J5b warnings 数应保持 15（吸收 02a 教训）

阶段 02a G1 教训：task-card 模板含 `eslint-disable-next-line no-console` 触发 +2 warnings。本阶段 task-card 已修订模板**不含**任何 `eslint-disable-...` 注释（task-card R5）。J5b 判据应当 errors=765 + warnings=15 完全等于 02a baseline。

如果 lint 输出 warnings 数 != 15，**升级 BLOCKING 让 Commander 排查**——不擅自修。

### 提醒 5：禁止顺手建 02b-2 范围内的目录或文件

task-card § J2 README 中预告了"02b-2 之后的目录结构"，那是**规范预告不是本阶段产出**。Builder 不创建：
- `src/capabilities/text-editing/schema.ts`
- `src/capabilities/text-editing/converters/`
- `src/capabilities/text-editing/commands/`
- `src/capabilities/text-editing/plugins/`
- `src/capabilities/text-editing/menu-contributions.ts`
- `src/capabilities/text-editing/instance.ts`

任何创建即范围越界。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/text-editing-skeleton
git log --oneline -3            # 含 Commander 派活 commit
mkdir -p tmp

# 基线确认
ls src/capabilities/text-editing 2>&1 | head -1   # 预期 "No such file"
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 780
```

之后按步骤 1 写 `tmp/builder-startup.md`，按步骤 2~6 推进。

---

**记住**：本阶段是波次 2 系列中**最简单**的一个（仅 3 文件改动，验证 Capability 契约可实例化）——但作为后续所有 capability 阶段的样板，质量必须严格。完成或停止后立即结束会话。
