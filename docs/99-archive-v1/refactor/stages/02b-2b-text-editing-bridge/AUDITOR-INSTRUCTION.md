# Auditor 审计指令 — 阶段 02b-2b：text-editing schema/converters 临时引用

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入

1. **本目录**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8（共 16 子项）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 2 + § 5.4 + § 5.8
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff eab6a95a..refactor/text-editing-bridge --stat`（**双点 diff + 显式基线 SHA**）
   - `git log eab6a95a..refactor/text-editing-bridge --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/text-editing-bridge` |
| 派活基线 SHA | `eab6a95a` |
| 审计阶段 | 基础设施类阶段（schema/converters 临时引用 plugin）|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 16 子项判据 + J1 字节级（含 import 顺序 + 字段顺序 + ConverterPair 适配器形态）+ J2/J3 精准修改 + lint warnings 严格=15 |
| 基线状态 | typecheck=0 / lint=1 (780, 765e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 字节级对账（含 import 顺序 + 适配器形态）

Read `src/capabilities/text-editing/index.ts` + Read task-card § J1 代码块**逐字符对照**：

- ✅ 5 行 import 顺序严格：
  1. `import type { Capability, ConverterPair } from '@shared/ui-primitives'`
  2. `import type { Atom } from '@shared/types/atom-types'`
  3. `import type { Node as PMNode } from 'prosemirror-model'`
  4. `import { converterRegistry } from '@plugins/note/converters/registry'`
  5. `import { blockRegistry } from '@plugins/note/registry'`
- ✅ `textEditingConverters: ConverterPair` 模块级 const（不内联到对象字面量）
- ✅ `toAtom: (data) => converterRegistry.docToAtoms(data as PMNode) as Atom[]` 双向类型断言
- ✅ `fromAtom: (atoms) => converterRegistry.atomsToDoc(atoms as Atom[])` 单向类型断言
- ✅ textEditingCapability 5 字段顺序：id → schema → converters → createInstance → commands
- ✅ schema = blockRegistry / converters = textEditingConverters / createInstance = undefined / commands = undefined
- ✅ **不含任何 `// eslint-disable-...` 注释**
- ✅ 中文注释字符与 task-card 字面一致（含"02b-2c 填(...)"等子阶段引用）

**任意字符不一致 = ❌**

### 关注点 2：J2/J3 精准修改对账

```bash
# J2 验证
git diff eab6a95a..refactor/text-editing-bridge -- src/capabilities/text-editing/README.md
# 预期 diff 仅触及"## 当前状态"段
# 其他段（# 标题段 / ## 设计原则 / ## 主要消费视图(预期) / ## 02b-2 之后的目录结构(预期)）字节不变

# J3 验证
git diff eab6a95a..refactor/text-editing-bridge -- src/capabilities/README.md
# 预期 diff 仅触及"## 当前状态"段
# 其他段（# Capabilities / ## 设计原则 / ## 不在本目录的实现）字节不变
```

任何 diff 触及其他段 = ❌

### 关注点 3：J3 三 SHA 嵌入验证

```bash
git checkout refactor/text-editing-bridge
J1_SHA=$(git log --oneline eab6a95a..HEAD | grep "schema/converters 临时引用" | awk '{print $1}')
echo "J1 SHA: $J1_SHA"
# 三 SHA 同时存在(02b-1 256ec984 + 02b-2a 16ca2454 + 02b-2b $J1_SHA)
grep "256ec984" src/capabilities/README.md
grep "16ca2454" src/capabilities/README.md
grep "$J1_SHA" src/capabilities/README.md
```

任意一个 SHA 缺失 = ❌

### 关注点 4：lint warnings 严格 = 15（吸收 02a G1 教训）

**Auditor 独立重跑**：

```bash
git checkout refactor/text-editing-bridge
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**：`✖ 780 problems (765 errors, 15 warnings)` —— **errors 765 + warnings 15 与 02b-2a baseline 完全等于**

**如果 warnings != 15** = ❌

### 关注点 5：plugin/note 必须未触

```bash
git diff eab6a95a..refactor/text-editing-bridge -- 'src/plugins/note/**'
# 预期: 输出空(zero diff)
```

如果 plugin/note 任何文件被改 = ❌（违反"临时引用模式不动 plugin"）

### 关注点 6：5 处外部调用方未触

```bash
git diff eab6a95a..refactor/text-editing-bridge -- \
  src/plugins/note/types.ts \
  src/plugins/note/registry.ts \
  src/plugins/note/components/NoteEditor.tsx \
  src/plugins/note/ai-workflow/sync-note-receiver.ts \
  src/plugins/graph/canvas/edit/atom-bridge.ts
# 预期: 输出空
```

任何调用方被改 = ❌

### 关注点 7：范围越界（仅 3 文件）

**Builder 引入的 diff 必须严格仅含以下 3 文件**：
- `src/capabilities/text-editing/index.ts`（修改）
- `src/capabilities/text-editing/README.md`（修改）
- `src/capabilities/README.md`（修改）

**任意其他文件出现 = ❌**：
- 任何业务代码（src/main / src/renderer / src/plugins）
- 阶段 01/02a/02b-1/02b-2a 已落文件除上述 3 个之外
- ESLint config / tsconfig.json / package.json / schema-* / memory
- 任何 capability 内新建子目录 / 新文件

### 关注点 8：J7/J8 capabilities 目录结构（与 02b-2a 一致）

```bash
find src/capabilities -type d   # 预期 2 行: src/capabilities + src/capabilities/text-editing
find src/capabilities -type f   # 预期 3 行: 3 个文件
```

任何额外目录 / 文件 = ❌

### 关注点 9：J5 三件命令独立重跑

```bash
git checkout refactor/text-editing-bridge
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "780 problems (765 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 10：J4 双点 diff + 显式基线 SHA（§ 六纪律 1）

强制使用 `git diff eab6a95a..refactor/text-editing-bridge --stat`。**不允许**用 `main...HEAD` 三点 diff。

### 关注点 11：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 5 条预期歧义，Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证。

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
- ✅ 字节级对账 J1（含 5 行 import 顺序 + 5 字段顺序 + 适配器双向断言 + 中文注释）
- ✅ 精准修改对账 J2/J3
- ✅ J5 自己跑命令——**重点 lint warnings 数 = 15**（连续第三次验证 § 六纪律 5/6）
- ✅ J7/J8 find 命令自己跑
- ✅ plugin/note 零改动验证（关注点 5+6）

---

**记住**：本阶段是 02b 系列首个"capability 填入实质字段（虽是临时引用 plugin）"的阶段——这是临时引用模式的首次落地，作为 02b-2c/d 的样板。审计完成立即结束会话。
