# Builder 派活指令 — 阶段 02b-4：epub-rendering Capability 一阶段完成

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无 BLOCKING 时无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J8 + 预期歧义 6 条已答）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不读 AUDITOR-INSTRUCTION.md

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **数据契约（阶段 01 已落，引用，不修改）**：
   - [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口

5. **02b-3 样板参考（同模式实现）**：
   - [src/capabilities/pdf-rendering/index.ts](../../../../src/capabilities/pdf-rendering/index.ts) PDF 实例工厂型 capability

6. **修改对象（02b-3 已落，本阶段更新一段）**：
   - [src/capabilities/README.md](../../../../src/capabilities/README.md) (J3)

7. **新建对象（本阶段创建）**：
   - `src/capabilities/epub-rendering/index.ts` (J1)
   - `src/capabilities/epub-rendering/README.md` (J2)

8. **引用对象（plugin 内现有 EPUBRenderer 类，本阶段不修改）**：
   - [src/plugins/ebook/renderers/epub/index.ts](../../../../src/plugins/ebook/renderers/epub/index.ts) EPUBRenderer 类

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 02b-4-epub-rendering（实例工厂型样板巩固）|
| 目标分支 | `refactor/epub-rendering`（**已切出**，HEAD 来自 main `bad4d4ea`）|
| 派活基线 SHA | `bad4d4ea`（task-card § J4 强制使用此 SHA）|
| 功能契约 | **N/A** |
| 完成判据 | task-card.md J1~J8（共 17 子项）|
| 模式 | **capability 临时引用 plugin**（不搬业务代码）|
| 形态 | **实例工厂型 capability**（仅 createInstance 实质，schema/converters/commands 全 undefined）|
| 与 02b-3 关系 | **完美同模式**——直接套 02b-3 模板，仅字面替换 |

## 三、执行流程（严格按序）

### 步骤 0：分支已切，无需 checkout

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git status
git branch --show-current      # 应当 refactor/epub-rendering
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
  ls src/capabilities/epub-rendering 2>&1 | head -1           # 预期 No such file(本阶段创建)
  grep "EPUBRenderer" src/plugins/ebook/renderers/epub/index.ts | head -2   # 预期含 export class EPUBRenderer
  ```
- 识别歧义/冲突分级 BLOCKING / NON-BLOCKING

### 步骤 2：决定走向

- **无 BLOCKING** → 进入步骤 3
- **有 BLOCKING** → 写 `tmp/builder-blockers.md`，会话结束

### 步骤 3：执行 J1~J3

按 task-card 顺序 + 建议 3 个 commit：

```
J1: feat(refactor/epub-rendering): epubRenderingCapability 实例工厂型 capability 一阶段完成
J2: docs(refactor/epub-rendering): epub-rendering/README.md
J3: docs(refactor/epub-rendering): capabilities/README.md 同步状态(实例工厂型样板巩固)
```

每个 J 完成后立即跑 `npm run typecheck` 确认 exit 0。

**关键约束**：
- J1 字节级照抄 task-card § J1 代码块（含 2 行 import + epubRenderingCreateInstance const + epubRenderingCapability 5 字段）
- J2 字节级照抄 task-card § J2 代码块（含 7 个段：标题 + 当前状态 + 形态分类 + 设计原则 + 主要消费视图 + 临时引用模式说明 + EPUBRenderer 实现差异表）
- J3 用 **Edit** 工具精准替换"## 当前状态"段——**不许 Write 整文件**
- J3 嵌入 J1 commit SHA 前 8 位（6 SHA 全部存在）

### 步骤 4：J4~J8 验证

```bash
# J4 范围(强制双点 diff + 显式基线 SHA)
git diff bad4d4ea..HEAD --stat

# J5 三件
npm run typecheck     # 预期 exit 0
npm run lint > /dev/null 2>&1; echo $?    # 预期 1
npm run lint 2>&1 | grep "✖" | tail -1    # 预期 "780 problems (765 errors, 15 warnings)" 严格 = 02b-3 baseline
npm run lint:dirs     # 预期 exit 0

# J6 commit message
git log bad4d4ea..HEAD --oneline

# J7/J8 capabilities 目录(应当增 1 dir + 2 files vs 02b-3)
find src/capabilities -type d   # 预期 4 dirs(根 + text-editing + pdf-rendering + epub-rendering)
find src/capabilities -type f   # 预期 7 files(根 README + 3 个 capability 各 2 文件)
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

### 提醒 1：J1 字节级照抄含中文注释字符 + 2 行 import

task-card § J1 代码块含中文注释（"形态:实例工厂型 capability" / "EPUBRenderer 是纯 class 实现" 等）。Builder 字节级照抄时**不允许**：
- 把中文标点改为英文
- 删除/调整注释中的"波次 3" / "02b-3 pdf-rendering" 等引用
- 调整字段顺序
- **调整 2 行 import 顺序**（必须按：Capability+CapabilityInstance+CapabilityOptions+HostElement / EPUBRenderer）

### 提醒 2：禁止顺手添加 ESLint disable 注释（吸收 02a G1）

task-card § J1/J2 模板**不含**任何 `eslint-disable-...` 注释。Builder 字节级照抄即可。J5b warnings 严格 = 15 是验证此提醒落实的关键判据。

### 提醒 3：参数前缀 `_` 必须保留（与 02b-3 同模式）

`epubRenderingCreateInstance` 工厂参数 `_host` `_options` 前缀不能去掉。

### 提醒 4：4 个字段显式 undefined（不是删除字段）

schema / converters / commands 三个字段值严格 `undefined`。与 02b-3 一致。

### 提醒 5：`as CapabilityInstance` 断言不能省略

CapabilityInstance = unknown，必须 `as CapabilityInstance` 断言。

### 提醒 6：J5b warnings 严格 = 15

阶段 02b-3 baseline 是 errors=765 + warnings=15。本阶段**warnings 必须 = 15**:
- 如 lint 输出 warnings > 15 → BLOCKING
- 如 lint 输出 warnings < 15 → BLOCKING（可能误改其他文件）

### 提醒 7：J3 用 Edit 精准修改 + 6 SHA 嵌入

`src/capabilities/README.md` 含 4 个段。**仅修改"## 当前状态"段**——用 Edit 工具精准替换。

修改后段必须含 6 SHA 引用：
- text-editing 4 SHA: `256ec984` + `16ca2454` + `a315e7e0` + `237c6cd0`
- pdf-rendering 1 SHA: `add19d46`
- epub-rendering 1 SHA: `<J1 commit SHA>`(本次)

### 提醒 8：临时引用模式不动 plugin/ebook

本阶段 capability 通过 `import { EPUBRenderer } from '@plugins/ebook/renderers/epub'` **引用** plugin 内现有 EPUBRenderer 类。**不允许**:
- 修改 `plugins/ebook/renderers/epub/index.ts` 任何字符
- 修改 `plugins/ebook/renderers/epub/foliate-js.d.ts` 类型声明
- 修改 `plugins/ebook/components/EBookView.tsx` 等 ebook 视图
- 修改 `plugins/ebook/renderers/index.ts`(createRenderer 工厂)

### 提醒 9：EPUBRenderer 内部实现差异不影响 capability（task-card R8）

EPUBRenderer 用动态 `await import('foliate-js/view.js')` + `customElements.define('foliate-view', ...)`，与 PDFRenderer 不同。但这些差异封装在 EPUBRenderer 类内部,**capability 仅 `new EPUBRenderer()` 不感知**——这正是临时引用模式的隔离价值。Builder 不在 capability 代码中处理这些 foliate-js / customElements 细节。

## 五、最简起步命令

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git branch --show-current      # 应当 refactor/epub-rendering
git log --oneline -3
mkdir -p tmp

# 基线确认
npm run typecheck > /dev/null 2>&1; echo "tc baseline: $?"   # 预期 0
npm run lint 2>&1 | grep "✖" | tail -1                       # 预期 780 (765e+15w)
ls src/capabilities/epub-rendering 2>&1 | head -1            # 预期 No such file
grep "export class EPUBRenderer" src/plugins/ebook/renderers/epub/index.ts | head -1   # 预期含输出

# 02b-3 样板对照(参考)
cat src/capabilities/pdf-rendering/index.ts | head -10
```

之后按步骤 1 写 `tmp/builder-startup.md`,按步骤 2~6 推进。

---

**记住**：本阶段是 02b-3 的**完美姊妹**——实例工厂型样板巩固。质量必须严格——尤其字节级 J1 + warnings 严格=15 + 6 SHA 嵌入。完成或停止后立即结束会话。
