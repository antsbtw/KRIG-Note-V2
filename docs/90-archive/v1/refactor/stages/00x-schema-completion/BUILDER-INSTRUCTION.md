# Builder 派活指令 — 阶段 00x：Schema 骨架补全

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J6 + 严禁顺手做 + 风险 + 预期歧义答案）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.2 + § 6
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **现有 schema 骨架（必读以理解上下文）**：
   - [src/shared/types/schema-visualization.ts](../../../../src/shared/types/schema-visualization.ts) — 当前导出列表
   - [src/shared/types/schema-interop.ts](../../../../src/shared/types/schema-interop.ts) — 第 7 行的 import 与 第 72 行的 LicenseTier 使用

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 00x-schema-completion |
| 目标分支 | `refactor/schema-interop-completion`（**待你从 main 切出**） |
| 功能契约 | **N/A** |
| 完成判据 | task-card.md J1~J6 |
| 严禁顺手做 | task-card.md "严禁顺手做"段 |

## 三、执行流程

### 步骤 0：切分支

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git checkout main
git status   # 应当干净
git checkout -b refactor/schema-interop-completion
mkdir -p tmp
```

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式输出：
- 已读文件清单
- J1~J6 完成判据逐条复述
- 契约 § B 防御代码 grep 验证：填"本次为基础设施类波次，无功能契约，跳过"
- **基线确认**（task-card § J4b 要求）：
  ```bash
  npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
  # 预期 6（动手前的 baseline，包括 schema-interop.ts 2 处 + 历史 4 处）
  ```
- 识别到的歧义/冲突，分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J3

按 task-card 顺序：

**J1**：编辑 `src/shared/types/schema-visualization.ts`，在适当位置（建议在 `export type ViewInstanceId = string;` 之后）新增 `ViewType` 定义。

**J2**：紧接 `ViewType` 定义之后，新增 `LicenseTier` 定义。

**J3**：编辑 `src/shared/types/schema-interop.ts:7`，仅在 import 列表追加 `LicenseTier`。

每个 J 完成立即 git commit。建议三个 commit 拆为：

```
J1+J2:  fix(refactor): schema-visualization 新增 ViewType + LicenseTier 类型
J3:     fix(refactor): schema-interop 补 LicenseTier import
```

或合为一个 commit 也可（只要 message 涵盖三件事）。

### 步骤 4：验证 J4

```bash
# J4a: schema-interop.ts 错误清零
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "schema-interop.ts"
# 预期输出空

# J4b: 总错误数 ≤ 4（保留历史 4 处）
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l
# 预期输出 4
```

如果输出不符预期，**不擅自修**——记入 `tmp/builder-report.md` F 段并升级。

### 步骤 5：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~F 段全填。

特别提醒：
- A 段对账每个 J 必须有 `git diff` 摘要 + commit SHA
- C 段范围越界自检：是否动了 src/shared/types 之外任何文件？
- 列出 `npx tsc` 完整输出供 Auditor 对账

### 步骤 6：结束

聊天里输出：
```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push。

## 四、特别提醒

### 提醒 1：ViewType 必须是 `string` 别名，不是字面量联合

task-card R1 已答。如果你"觉得"更严格的字面量联合更好——**禁止**。理由：总纲 § 1.2 注册原则。

### 提醒 2：LicenseTier 仅 3 值

`'free' | 'pro' | 'enterprise'`——不要扩展。task-card R2 已答。

### 提醒 3：不修历史 type 错误

`WebkitAppRegion` / `view.webContents` 4 处错误是仓库历史债，由 [fix-tasks/typecheck-baseline.md](../../fix-tasks/typecheck-baseline.md) 处理。本 PR 不动它们。

### 提醒 4：J4b 总错误数应当是 4

如果你的修改让总错误数变成 5 或更多，说明你引入了新错误，必须回滚重做。

---

**记住**：本次任务非常小（约 ~15 行类型代码），但语义意义重大——它是阶段 01 之后所有 capability/view 注册类型的基石。严格按 task-card 字面执行。
