# Builder 派活指令 — 阶段 02b-2a：text-editing 字段占位

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J8 + 预期歧义 5 条已答）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **数据契约（阶段 01 已落，引用，不修改）**：
   - [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口

5. **修改对象（02b-1 已落，本阶段升级）**：
   - [src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts) (J1)
   - [src/capabilities/text-editing/README.md](../../../../src/capabilities/text-editing/README.md) (J2)
   - [src/capabilities/README.md](../../../../src/capabilities/README.md) (J3)

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 02b-2a-text-editing-fields（波次 2 第二阶段第二步）|
| 目标分支 | `refactor/text-editing-fields`（**已切出**，HEAD 来自 main `252d8e69`）|
| 派活基线 SHA | `252d8e69`（task-card § J4 强制使用此 SHA 做双点 diff 对账）|
| 功能契约 | **N/A**（基础设施类阶段，不动业务代码）|
| 完成判据 | task-card.md J1~J8（共 14 子项）|
| 严禁顺手做 | 任何业务代码 + capability 内额外子目录/文件 + 业务文件 |

## 三、执行流程（严格按序）

### 步骤 0：分支已切，无需 checkout

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/text-editing-fields
git log --oneline -3
mkdir -p tmp
```

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式：
- 已读文件清单
- J1~J8 完成判据复述
- 契约 § B 防御代码 grep 验证：填"基础设施类阶段，无功能契约"
- **基线确认**：
  ```bash
  npm run typecheck > /dev/null 2>&1; echo "tc: $?"           # 预期 0
  npm run lint > /dev/null 2>&1; echo "lint: $?"              # 预期 1
  npm run lint 2>&1 | grep "✖" | tail -1                      # 预期 780 (765e+15w)
  npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"         # 预期 0
  cat src/capabilities/text-editing/index.ts | wc -l           # 预期 19(02b-1 落地)
  ```
- 识别歧义/冲突分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J3

按 task-card 顺序 + 建议 3 个 commit：

```
J1: feat(refactor/text-editing-fields): textEditingCapability 加字段占位
J2: docs(refactor/text-editing-fields): text-editing/README.md 同步状态
J3: docs(refactor/text-editing-fields): capabilities/README.md 同步状态
```

每个 J 完成后立即跑 `npm run typecheck` 确认 exit 0。

**关键约束**：
- J1 字节级照抄 task-card § J1 代码块（含中文注释字符）
- J2/J3 用 **Edit** 工具精准替换"## 当前状态"段——**不许 Write 整文件**
- J3 嵌入 J1 commit SHA（前 8 位即可）

### 步骤 4：J4~J8 验证

```bash
# J4 范围(强制双点 diff + 显式基线 SHA)
git diff 252d8e69..HEAD --stat
# 预期: Builder 改动 3 文件 + Commander 派活 4 docs

# J5 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 "780 problems (765 errors, 15 warnings)" 严格 = 02b-1 baseline
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log 252d8e69..HEAD --oneline

# J7/J8 capabilities 目录(应与 02b-1 一致)
find src/capabilities -type d   # 预期 2 dirs
find src/capabilities -type f   # 预期 3 files
```

### 步骤 5：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段。

特别提醒：
- A 段 J5b 必须列出 lint 输出 `✖ N problems (X errors, Y warnings)` —— **必须严格 765e + 15w**
- D 段 commit SHA 完整列出
- G 段如有 NON-BLOCKING 歧义记录处理

### 步骤 6：结束

```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset。

## 四、特别提醒

### 提醒 1：J1 字节级照抄含中文注释字符

task-card § J1 代码块含中文注释（如"02b-2b 填(...)"），Builder 字节级照抄时**不允许**：
- 把中文标点改为英文（如"，"改"," / "。"改".")
- 删除注释中的"02b-2b/c/d"等子阶段引用
- 调整字段顺序

### 提醒 2：禁止顺手添加 ESLint disable 注释（吸收 02a G1）

阶段 02a G1 教训：模板含 `// eslint-disable-next-line no-console` 触发 +2 unused-disable warnings。本阶段 task-card § J1 模板**不含**任何 disable 注释。Builder 字节级照抄即可,**不许添加任何 disable 注释**——即便 Builder 觉得"将来需要"。

### 提醒 3：J5b warnings 严格 = 15

阶段 02b-1 baseline 是 errors=765 + warnings=15。本阶段不引入任何业务代码,**warnings 必须 = 15**:
- 如 lint 输出 warnings > 15 → 说明本阶段引入了字节级模板副作用 → BLOCKING
- 如 lint 输出 warnings < 15 → 说明本阶段意外修复了某个 warning → BLOCKING（可能误改其他文件）

### 提醒 4：J2/J3 用 Edit 精准修改

`src/capabilities/text-editing/README.md` 含 5 个段（标题 + 当前状态 + 设计原则 + 主要消费视图 + 02b-2 之后的目录结构）。**仅修改"## 当前状态"段**——用 Edit 工具精准替换。

`src/capabilities/README.md` 含 4 个段（标题段 + 当前状态 + 设计原则 + 不在本目录的实现）。同样仅修改"## 当前状态"段。

修改前先 Read 全文,确认其他段当前内容。

### 提醒 5：J3 嵌入 J1 commit SHA

task-card § J3 修改后段含 `<填 J1 commit SHA>` 占位符。Builder 在 J3 时**填入 J1 实际 commit SHA 前 8 位**。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/text-editing-fields
git log --oneline -3
mkdir -p tmp

# 基线确认
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 780 (765e+15w)
cat src/capabilities/text-editing/index.ts | wc -l           # 预期 19
```

之后按步骤 1 写 `tmp/builder-startup.md`,按步骤 2~6 推进。

---

**记住**：本阶段是 02b-1 之后的轻量升级（接口字段占位）,作为 02b-2b/c/d 实质搬迁的对账标尺。质量必须严格——尤其字节级 J1 + warnings 严格=15。完成或停止后立即结束会话。
