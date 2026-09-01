# Auditor 审计指令 — 阶段 02b-1：text-editing 最小骨架

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入（按顺序）

1. **本目录文件**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8（共 11 子项）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 1.3 / § 5.4 / § 5.9
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff 5b478326..refactor/text-editing-skeleton --stat`（**双点 diff + 显式基线 SHA**）
   - `git log 5b478326..refactor/text-editing-skeleton --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/text-editing-skeleton` |
| 派活基线 SHA | `5b478326`（task-card 强制使用） |
| 审计阶段 | 基础设施类阶段（验证 Capability 契约可实例化） |
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 11 子项判据 + 范围越界（仅 3 文件）+ J3 精准修改 + lint warnings 数（吸收 02a G1 教训） |
| 基线状态 | typecheck=0 / lint=1 (780, 765e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 / J2 字节级对账

**逐项 Read 文件 + Read task-card 对应代码块逐字符对照**：

| J | 文件 | task-card 段 |
|---|---|---|
| J1 | `src/capabilities/text-editing/index.ts` | § J1 代码块（约 16 行，含注释 + textEditingCapability 实例 + 仅 id 字段） |
| J2 | `src/capabilities/text-editing/README.md` | § J2 markdown 块（约 30 行）|

**任何字符不一致 = ❌**——即便 Builder 解释"我改得更好"也不接受。

### 关注点 2：J3 精准修改 capabilities/README.md

`src/capabilities/README.md` 必须**仅**"## 当前状态"段被修改：

```bash
# Auditor 独立验证: diff 仅集中在该段
git diff 5b478326..refactor/text-editing-skeleton -- src/capabilities/README.md
```

**预期**：
- 标题改为 "## 当前状态(阶段 02b-1-text-editing-skeleton)"
- 段内容改为含 `text-editing/` 列表项 + 具体 J1 commit SHA + 简短描述
- 其他 3 段（`# Capabilities`、`## 设计原则`、`## 不在本目录的实现`）**字节不变**（diff 中不出现）

如果 diff 触及其他段（即便是空白调整）= ❌

### 关注点 3：范围越界（关键——仅 3 文件）

**Builder 引入的 diff 必须严格仅含以下 3 个文件**（task-card § J4 字面）：
- `src/capabilities/text-editing/index.ts`（新建）
- `src/capabilities/text-editing/README.md`（新建）
- `src/capabilities/README.md`（修改）

**任意其他文件出现在 diff 中 = ❌**：
- 任何 `src/plugins/**` 文件
- 任何 `src/main/**` / `src/renderer/**` 文件
- 任何 `src/shared/**` 文件（含 ui-primitives.ts / intents.ts / plugin-types.ts）
- ESLint config / tsconfig.json / package.json
- 任何 `src/capabilities/<其他 capability>/`
- 任何 `src/capabilities/text-editing/<其他>` 子目录或文件（如 schema.ts / converters/ 等都是 02b-2 范围）

### 关注点 4：lint warnings 数严格 ± 0（吸收 02a G1 教训）

**Auditor 独立重跑**：

```bash
git checkout refactor/text-editing-skeleton
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**：`✖ 780 problems (765 errors, 15 warnings)` —— **errors 765 + warnings 15 与 02a baseline 完全等于**。

**如果 warnings != 15** = ❌：
- 说明本阶段的 task-card 模板**含**了 ESLint disable 注释（与 02a G1 同型问题）
- COMMANDER-PROMPT § 六新纪律 5 已上锁此问题，本阶段 task-card 起草时已检查模板不含 disable 注释（task-card R5）——如真出现说明 Commander 起草疏漏

### 关注点 5：J7 / J8 capabilities 目录结构

```bash
git checkout refactor/text-editing-skeleton
find src/capabilities -type d
# 预期 2 行: src/capabilities + src/capabilities/text-editing

find src/capabilities -type f
# 预期 3 行:
# - src/capabilities/README.md
# - src/capabilities/text-editing/index.ts
# - src/capabilities/text-editing/README.md
```

任何额外目录 / 文件 = ❌（J3 范围内的 02b-2 预告子目录绝对不允许出现）

### 关注点 6：J5 三件命令独立重跑

```bash
git checkout refactor/text-editing-skeleton
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "780 problems (765 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 7：J6 双点 diff + 显式基线 SHA（吸收 § 六纪律 1）

**强制使用** `git diff 5b478326..refactor/text-editing-skeleton --stat`（双点 + 显式 SHA）。

**不允许**用 `main...HEAD` 三点 diff。

### 关注点 8：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 4 条预期歧义，Builder 自决空间极小（仅 3 文件改动）。任何 G 段标注的自决都需 Auditor 独立验证：
- 是否在 task-card 字面授权范围内？
- 是否引入未授权改动？

任何"超越 task-card 字面"的决断标 ⚠️ 待证明。

## 四、审计输出

按 AUDITOR-PROMPT § 四格式。要点：
- B 段（功能契约保留）填 "N/A 基础设施类阶段"
- D 段（Step B 合规）跳过
- 总评：通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——**只看代码 + task-card**
- ❌ 不写代码、不修复
- ✅ 字节级对账 J1 / J2（与阶段 00 J2b / 阶段 01 J5.5a / 阶段 02a J1/J3 同模式）
- ✅ J3 精准修改对账（diff 仅触及"## 当前状态"段）
- ✅ J5 命令自己跑——**重点 lint warnings 数 = 15**（02a baseline 锁定）
- ✅ J7/J8 find 命令自己跑

---

**记住**：本阶段是波次 2 系列中**最简单**的一个，但作为后续所有 capability 阶段的样板，审计必须严格——尤其 lint warnings 数严格 ± 0 用以验证 § 六新纪律 5 是否落实到位。审计完成立即结束会话。
