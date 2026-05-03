# Auditor 审计指令 — 阶段 02b-3：pdf-rendering Capability 一阶段完成

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
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff c0d0851b..refactor/pdf-rendering --stat`（**双点 diff + 显式基线 SHA**）
   - `git log c0d0851b..refactor/pdf-rendering --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/pdf-rendering` |
| 派活基线 SHA | `c0d0851b` |
| 审计阶段 | 基础设施类阶段（实例工厂型 capability 首次落地）|
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 17 子项判据 + J1 字节级（含 2 行 import + 5 字段顺序 + 4 字段 undefined + createInstance 工厂 + as 断言）+ J3 5 SHA 嵌入 + lint warnings 严格=15 |
| 基线状态 | typecheck=0 / lint=1 (780, 765e + 15w) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 字节级对账（含 2 行 import + 5 字段 + createInstance 工厂）

Read `src/capabilities/pdf-rendering/index.ts` + Read task-card § J1 代码块**逐字符对照**：

- ✅ **2 行 import 顺序严格**：
  1. `import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives'`
  2. `import { PDFRenderer } from '@plugins/ebook/renderers/pdf'`

- ✅ `pdfRenderingCreateInstance` 模块级 const(不内联),签名:
  - 参数前缀 `_host` `_options`(必保留下划线前缀)
  - 返回 `new PDFRenderer() as CapabilityInstance`(as 断言必保留)

- ✅ pdfRenderingCapability 5 字段顺序：id → schema → converters → createInstance → commands

- ✅ schema/converters/commands **三个字段值严格 `undefined`**(不是删除字段，不是 null)

- ✅ createInstance = `pdfRenderingCreateInstance`(模块级 const 引用,不是内联函数)

- ✅ id = `'capability.pdf-rendering'`(命名空间合规)

- ✅ **不含任何 `// eslint-disable-...` 注释**

- ✅ 中文注释字符与 task-card 字面一致(含"形态:实例工厂型 capability" / "PDFRenderer 是纯 class 实现" 等)

**任意字符不一致 = ❌**

### 关注点 2：J2 字节级对账

Read `src/capabilities/pdf-rendering/README.md` + Read task-card § J2 代码块**逐字符对照**：

- ✅ 6 个段落顺序：`# capability.pdf-rendering` 标题 + `## 当前状态` + `## 形态对比` + `## 设计原则` + `## 主要消费视图` + `## 临时引用模式说明` + `## 与 02b-text-editing 的关键差异`

- ✅ 当前状态段含 5 字段状态（id ✅ / schema ⏸️ / converters ⏸️ / createInstance ✅ / commands ⏸️）

- ✅ 形态对比段含两种 capability 形态分类（复合型 vs 实例工厂型）

- ✅ 设计原则段含 4 条 § 引用（§ 1.3 / § 5.4 / § 5.5 / § 5.8）

**任何段落缺失 / 内容偏离 = ❌**

### 关注点 3：J3 精准修改 capabilities/README.md + 5 SHA 嵌入

```bash
# J3 验证 diff 仅触及当前状态段
git diff c0d0851b..refactor/pdf-rendering -- src/capabilities/README.md
# 预期：diff 仅触及"## 当前状态"段
# 其他段(`# Capabilities` / `## 设计原则` / `## 不在本目录的实现`)字节不变

# 5 SHA 嵌入验证
git checkout refactor/pdf-rendering
J1_SHA=$(git log --oneline c0d0851b..HEAD | grep "pdfRenderingCapability" | awk '{print $1}')
echo "J1 SHA: $J1_SHA"

# text-editing 4 SHA
grep "256ec984" src/capabilities/README.md
grep "16ca2454" src/capabilities/README.md
grep "a315e7e0" src/capabilities/README.md
grep "237c6cd0" src/capabilities/README.md
# pdf-rendering 1 SHA(本次)
grep "$J1_SHA" src/capabilities/README.md
```

**任意 SHA 缺失 = ❌**
**diff 触及其他段 = ❌**

### 关注点 4：lint warnings 严格 = 15（吸收 02a G1 教训）

**Auditor 独立重跑**：

```bash
git checkout refactor/pdf-rendering
npm run lint > /tmp/audit-lint.log 2>&1; echo "exit: $?"
grep "✖" /tmp/audit-lint.log | tail -1
```

**预期**：`✖ 780 problems (765 errors, 15 warnings)` —— **errors 765 + warnings 15 与 02b-2c baseline 完全等于**

**如果 warnings != 15** = ❌

### 关注点 5：plugin/ebook 必须未触

```bash
git diff c0d0851b..refactor/pdf-rendering -- 'src/plugins/ebook/**'
# 预期: 输出空（zero diff，临时引用模式硬约束）
```

如果 plugin/ebook 任何文件被改 = ❌

### 关注点 6：02b-text-editing 已落 capability 必须未触

```bash
git diff c0d0851b..refactor/pdf-rendering -- src/capabilities/text-editing/
# 预期: 输出空(本阶段只动 capabilities/README.md + 新建 pdf-rendering/)
```

任何 text-editing/ 文件被改 = ❌

### 关注点 7：范围越界（仅 3 文件）

**Builder 引入的 diff 必须严格仅含以下 3 文件**：
- `src/capabilities/pdf-rendering/index.ts`（新建）
- `src/capabilities/pdf-rendering/README.md`（新建）
- `src/capabilities/README.md`（修改）

**任意其他文件出现 = ❌**：
- 任何业务代码（src/main / src/renderer / src/plugins）
- 阶段 01/02a/02b-* 已落文件除上述 3 个之外
- ESLint config / tsconfig.json / package.json / schema-* / memory
- 任何 capability 内新建子目录(pdf-rendering/<其他>)/ 新文件除 index.ts/README.md

### 关注点 8：J7/J8 capabilities 目录结构（02b-2c → 02b-3 增量）

```bash
find src/capabilities -type d   # 预期 3 行: src/capabilities + text-editing + pdf-rendering
find src/capabilities -type f   # 预期 5 行: 根 README + 2 个 capability 各 2 文件
```

任何额外目录 / 文件 = ❌

### 关注点 9：J5 三件命令独立重跑

```bash
git checkout refactor/pdf-rendering
npm run typecheck > /dev/null 2>&1; echo "tc: $?"      # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"          # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1                  # 预期 "780 problems (765 errors, 15 warnings)"
npm run lint:dirs > /dev/null 2>&1; echo "dirs: $?"     # 预期 0
```

任意不符 = ❌

### 关注点 10：J4 双点 diff + 显式基线 SHA（§ 六纪律 1）

强制使用 `git diff c0d0851b..refactor/pdf-rendering --stat`。**不允许**用 `main...HEAD` 三点 diff。

### 关注点 11：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 5 条预期歧义，Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证。

特别警惕：
- Builder 是否擅自去掉参数下划线前缀（task-card R6 + Q1 已答必须保留）？
- Builder 是否把 createInstance 工厂内联到对象字面量（task-card Q2 已答必须模块级 const）？
- Builder 是否删除字段（task-card Q3 已答必须显式 undefined）？
- Builder 是否省略 `as CapabilityInstance` 断言（task-card Q4 已答不能省略）？

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
- ✅ 字节级对账 J1（含 2 行 import + 5 字段顺序 + 4 字段 undefined + createInstance 工厂 const + as 断言 + 中文注释）
- ✅ 字节级对账 J2（6 个段落齐全）
- ✅ 精准修改对账 J3
- ✅ J3 5 SHA 全嵌入验证
- ✅ J5 自己跑命令——**重点 lint warnings 数 = 15**（连续第五次验证 § 六纪律 5/6）
- ✅ J7/J8 find 命令自己跑（02b-2c → 02b-3 增量）
- ✅ plugin/ebook 零改动验证（关注点 5）
- ✅ text-editing 已落 capability 零改动验证（关注点 6）

---

**记住**：本阶段是**实例工厂型 capability 首次落地**——为后续 02b-4+ 起草建立形态分类样板,质量验证决定后续 capability 起草信心。审计完成立即结束会话。
