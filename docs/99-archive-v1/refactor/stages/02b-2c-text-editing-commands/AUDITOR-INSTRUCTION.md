# Auditor 审计指令 — 阶段 02b-2c：text-editing commands 临时引用（02b 系列收尾）

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入

1. **本目录**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8（共 17 子项）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 2 + § 5.4 + § 5.5 + § 5.8
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff fe219294..refactor/text-editing-commands --stat`（**双点 diff + 显式基线 SHA**）
   - `git log fe219294..refactor/text-editing-commands --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/text-editing-commands` |
| 派活基线 SHA | `fe219294` |
| 审计阶段 | 基础设施类阶段（commands 临时引用，02b 系列收尾）|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 17 子项判据 + J1 字节级（含 6 段 import 顺序 + 8 命令顺序 + 命名空间 + as CommandHandler 断言）+ J2/J3 精准修改 + J3 4 SHA 嵌入 + lint warnings 严格=15 |
| 基线状态 | typecheck=0 / lint=1 (780, 765e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 字节级对账（含 6 段 import + 8 命令顺序）

Read `src/capabilities/text-editing/index.ts` + Read task-card § J1 代码块**逐字符对照**：

- ✅ **6 段 import 顺序严格**：
  1. `import type { Capability, ConverterPair, CommandHandler } from '@shared/ui-primitives'`
  2. `import type { Atom } from '@shared/types/atom-types'`
  3. `import type { Node as PMNode } from 'prosemirror-model'`
  4. `import { converterRegistry } from '@plugins/note/converters/registry'`
  5. `import { blockRegistry } from '@plugins/note/registry'`
  6. `import { toggleMarkCommand, applyLink, ... } from '@plugins/note/commands/editor-commands'`（8 个命令）

- ✅ **8 个命令引入顺序严格**：toggleMarkCommand → applyLink → removeLink → indentBlockAt → outdentBlockAt → setTextAlign → insertInlineMath → deleteCurrentBlock

- ✅ `textEditingCommands: Record<string, CommandHandler>` 模块级 const,8 个 entry,key 命名空间 `text-editing.<kebab-case>`：
  - `text-editing.toggle-mark`
  - `text-editing.apply-link`
  - `text-editing.remove-link`
  - `text-editing.indent-block`
  - `text-editing.outdent-block`
  - `text-editing.set-text-align`
  - `text-editing.insert-inline-math`
  - `text-editing.delete-current-block`

- ✅ 所有 8 个命令均用 `as CommandHandler` 断言

- ✅ textEditingCapability 5 字段顺序：id → schema → converters → createInstance → commands

- ✅ `createInstance: undefined`（**关键**：本阶段不实现 createInstance,task-card R7 + Q4 已答）

- ✅ `commands: textEditingCommands`

- ✅ **不含任何 `// eslint-disable-...` 注释**

- ✅ 中文注释字符与 task-card 字面一致（含"02b 系列收尾"/"createInstance 跳过原因"/"波次 3"等）

**任意字符不一致 = ❌**

### 关注点 2：J2/J3 精准修改对账

```bash
# J2 验证
git diff fe219294..refactor/text-editing-commands -- src/capabilities/text-editing/README.md
# 预期 diff 仅触及"## 当前状态"段（标题改为 02b-2c）
# 其他段（# 标题段 / ## 设计原则 / ## 主要消费视图(预期) / ## 02b-2 之后的目录结构(预期)）字节不变

# J3 验证
git diff fe219294..refactor/text-editing-commands -- src/capabilities/README.md
# 预期 diff 仅触及"## 当前状态"段
# 其他段（# Capabilities / ## 设计原则 / ## 不在本目录的实现）字节不变
```

任何 diff 触及其他段 = ❌

### 关注点 3：J3 4 SHA 嵌入验证

```bash
git checkout refactor/text-editing-commands
J1_SHA=$(git log --oneline fe219294..HEAD | grep "commands 临时引用" | awk '{print $1}')
echo "J1 SHA: $J1_SHA"

# 4 SHA 同时存在
grep "256ec984" src/capabilities/README.md   # 02b-1
grep "16ca2454" src/capabilities/README.md   # 02b-2a
grep "a315e7e0" src/capabilities/README.md   # 02b-2b
grep "$J1_SHA" src/capabilities/README.md    # 02b-2c (本次)
```

任意 1 个 SHA 缺失 = ❌

### 关注点 4：lint warnings 严格 = 15（吸收 02a G1 教训）

**Auditor 独立重跑**：

```bash
git checkout refactor/text-editing-commands
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**：`✖ 780 problems (765 errors, 15 warnings)` —— **errors 765 + warnings 15 与 02b-2b baseline 完全等于**

**如果 warnings != 15** = ❌

### 关注点 5：plugin/note 必须未触

```bash
git diff fe219294..refactor/text-editing-commands -- 'src/plugins/**'
# 预期: 输出空（zero diff，临时引用模式硬约束）
```

如果 plugin 任何文件被改 = ❌

### 关注点 6：createInstance 字段必须保持 undefined

**关键审计点**——本阶段 task-card R7 + Q4 + README "重要决策记录"明示 createInstance 不在本阶段范围。

```bash
grep "createInstance" src/capabilities/text-editing/index.ts
# 预期: createInstance: undefined,
# 任何其他形态 = ❌（特别是 createInstance: () => {...} 之类的尝试实现）
```

如果 Builder 尝试实现 createInstance（即便看起来"很合理"）= ❌

### 关注点 7：8 个命令清单严格

`textEditingCommands` 必须**仅含 8 个 entry,无增无减**：

```bash
grep -E "'text-editing\." src/capabilities/text-editing/index.ts | wc -l
# 预期: 8
```

任何额外 entry（如 Builder 自决加入 askAI / addThought / selectionToMarkdown 等）= ❌
任何缺失 = ❌（task-card R6 硬约束）

### 关注点 8：范围越界（仅 3 文件）

**Builder 引入的 diff 必须严格仅含以下 3 文件**：
- `src/capabilities/text-editing/index.ts`（修改）
- `src/capabilities/text-editing/README.md`（修改）
- `src/capabilities/README.md`（修改）

**任意其他文件出现 = ❌**：
- 任何业务代码（src/main / src/renderer / src/plugins）
- 阶段 01/02a/02b-1/02b-2a/02b-2b 已落文件除上述 3 个之外
- ESLint config / tsconfig.json / package.json / schema-* / memory
- 任何 capability 内新建子目录 / 新文件

### 关注点 9：J7/J8 capabilities 目录结构（与 02b-2b 一致）

```bash
find src/capabilities -type d   # 预期 2 行
find src/capabilities -type f   # 预期 3 行
```

任何额外目录 / 文件 = ❌

### 关注点 10：J5 三件命令独立重跑

```bash
git checkout refactor/text-editing-commands
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "780 problems (765 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 11：J4 双点 diff + 显式基线 SHA（§ 六纪律 1）

强制使用 `git diff fe219294..refactor/text-editing-commands --stat`。**不允许**用 `main...HEAD` 三点 diff。

### 关注点 12：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 5 条预期歧义 + 8 条 R 风险，Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证。

特别警惕：
- Builder 是否擅自在命名空间加 `capability.` 前缀？（task-card Q3 已答否）
- Builder 是否自决增加/减少命令？（task-card R6 + 关注点 7 硬约束 = 8）
- Builder 是否尝试实现 createInstance？（task-card R7 + 关注点 6 严禁）

任何"超越 task-card 字面"的决断标 ⚠️ 待证明。

## 四、审计输出

按 AUDITOR-PROMPT § 四格式。要点：
- B 段填 "N/A 基础设施类阶段"
- D 段跳过
- 总评：通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——只看代码 + task-card
- ❌ 不写代码、不修复
- ✅ 字节级对账 J1（含 6 段 import 顺序 + 8 命令顺序 + 命名空间 + as CommandHandler + 中文注释 + createInstance 仍 undefined）
- ✅ 精准修改对账 J2/J3
- ✅ J5 自己跑命令——**重点 lint warnings 数 = 15**（连续第四次验证 § 六纪律 5/6）
- ✅ J7/J8 find 命令自己跑
- ✅ plugin 零改动验证（关注点 5）
- ✅ createInstance 严守 undefined 验证（关注点 6）
- ✅ 8 命令清单严格验证（关注点 7）

---

**记住**：本阶段是 **02b 系列收尾**——质量验证决定 02b 系列整体质量。审计完成立即结束会话。
