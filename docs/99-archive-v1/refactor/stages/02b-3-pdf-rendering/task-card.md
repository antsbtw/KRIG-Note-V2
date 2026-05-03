# 任务卡：refactor/pdf-rendering（阶段 02b-3-pdf-rendering）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`c0d0851b`(main HEAD)

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口
- 现有 PDFRenderer 类(capability 引用对象，**不修改**)：[src/plugins/ebook/renderers/pdf/index.ts](../../../../src/plugins/ebook/renderers/pdf/index.ts)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第五步：新建 capability.pdf-rendering(实例工厂型,一阶段完成)**

新建第二个 capability `capability.pdf-rendering`，临时引用 `plugins/ebook/renderers/pdf/index.ts` 内现有 PDFRenderer 类作为 createInstance 工厂。**与 02b-text-editing 形态不同**——pdf-rendering 是"实例工厂型 capability"，仅 createInstance 一个实质字段，schema/converters/commands 全部 `undefined`。

**核心命题**：验证 Capability 接口的形态灵活性——能容纳实例工厂型 capability(纯 class 实现，零 React 耦合)。这是 02b 系列的扩展验证：
- 02b-text-editing 验证复合型 capability（schema+converters+commands）
- **02b-3 pdf-rendering 验证实例工厂型 capability**（仅 createInstance）

**非目标**：
- ❌ 不搬迁 PDFRenderer 类
- ❌ 不动 plugins/ebook/ 任何文件
- ❌ 不动 ebook 视图或调用方
- ❌ 不动 02b-text-editing 已完成的 capability（仅引用现有 capability/ 目录的 README.md）

## 本分支只做

按以下顺序：

### J1：新建 `src/capabilities/pdf-rendering/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives';
import { PDFRenderer } from '@plugins/ebook/renderers/pdf';

/**
 * capability.pdf-rendering — PDF 渲染能力
 *
 * **形态:实例工厂型 capability**(仅 createInstance 字段实质,其他 undefined)。
 * 与 capability.text-editing(复合型)形态不同——验证 Capability 接口灵活性。
 *
 * 临时引用模式(总纲 § 2 推进策略"新旧 API 共存"):
 * createInstance 工厂直接 new PDFRenderer 类,该类位于 plugins/ebook/renderers/pdf。
 * 真搬迁推到波次 3 ebook 整体迁移时做(届时 PDFRenderer 类整体搬入 capability)。
 *
 * **PDFRenderer 是纯 class 实现**(完全无 React 依赖),与 NoteEditor.tsx PM 创建
 * (与 React 深度耦合)形成对比——证明实例工厂型 capability 的临时引用模式
 * 能直接包装 createInstance(02b-text-editing 因 React 耦合无法做到)。
 *
 * 字段说明:
 * - schema:undefined(PDF 渲染无 schema 概念)
 * - converters:undefined(PDF 不需要 atom 转换)
 * - createInstance:✅ pdfRenderingCreateInstance 工厂(本阶段填)
 * - commands:undefined(PDF 仅渲染,无命令)
 *
 * 详见总纲 § 5.4 数据契约 + § 5.9 能力清单。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - ebook.pdf
 * - 未来:web 视图嵌入 PDF 预览缩略图等场景
 */

const pdfRenderingCreateInstance = (
  _host: HostElement,
  _options: CapabilityOptions,
): CapabilityInstance => {
  // 临时引用 plugin/ebook 内 PDFRenderer 类(波次 3 真搬迁)
  return new PDFRenderer() as CapabilityInstance;
};

export const pdfRenderingCapability: Capability = {
  id: 'capability.pdf-rendering',

  // schema:undefined(PDF 渲染无 schema 概念)
  schema: undefined,

  // converters:undefined(PDF 不需要 atom 转换)
  converters: undefined,

  // createInstance:✅ 临时引用 PDFRenderer 类(本阶段填)
  createInstance: pdfRenderingCreateInstance,

  // commands:undefined(PDF 仅渲染,无命令)
  commands: undefined,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 2 行(按上述顺序：Capability+CapabilityInstance+CapabilityOptions+HostElement / PDFRenderer)
- `pdfRenderingCreateInstance` 是模块级 const(便于将来扩展);参数前缀 `_host` `_options` 表明本阶段未使用(以后扩展时去掉下划线)
- pdfRenderingCapability 5 字段顺序严格：id → schema → converters → createInstance → commands
- 4 个字段（schema/converters/commands）值严格为 `undefined`(不允许 null / 删除字段)
- createInstance = `pdfRenderingCreateInstance`(模块级 const,不内联)
- **不允许添加任何 `// eslint-disable-...` 注释**(吸收 02a G1 教训)
- `as CapabilityInstance` 断言因 CapabilityInstance = unknown 兜底类型必需

### J2：新建 `src/capabilities/pdf-rendering/README.md`

**字节级照抄**：

```markdown
# capability.pdf-rendering

PDF 渲染能力(基于 pdfjs-dist)。详见总纲 § 5.9 能力清单 + § 5.4 数据契约。

## 当前状态(阶段 02b-3-pdf-rendering)

**实例工厂型 capability,一阶段完成**:`pdfRenderingCapability` 5 字段:
- ✅ `id` = `'capability.pdf-rendering'`
- ⏸️ `schema` = `undefined`(PDF 无 schema 概念)
- ⏸️ `converters` = `undefined`(PDF 不需要 atom 转换)
- ✅ `createInstance` = `pdfRenderingCreateInstance` 工厂(临时引用 PDFRenderer 类)
- ⏸️ `commands` = `undefined`(PDF 仅渲染,无命令)

## 形态对比:实例工厂型 vs 复合型

本 capability 是**首个实例工厂型 capability**(仅 createInstance 实质,其他 undefined)。
与 capability.text-editing(复合型,schema/converters/commands 都有)形态不同。

未来 capability 按此分类:
- 复合型:text-editing(已完成) / canvas-interaction / web-rendering 等
- 实例工厂型:**pdf-rendering(本阶段)** / epub-rendering / shape-library 等

## 设计原则(总纲引用)

- § 1.3 规则 A:外部依赖必须经 Capability 封装,视图禁止直接 import
- § 5.4 数据契约:Capability 接口含 schema / converters / createInstance / commands 等字段(全 optional,实例工厂型仅填 createInstance)
- § 5.5 强约束:命名空间 `capability.pdf-rendering`、禁套娃、颗粒度按"未来可扩展"
- § 5.8 视图是声明,实现都在 Capability 里——pdfjs-dist 是外部依赖,封装在 PDFRenderer 类内(plugin 已实现)

## 主要消费视图(预期)

- `ebook.pdf`(当前主消费方)
- 未来:web 视图嵌入 PDF 预览缩略图、PDF 选段引用等场景

## 临时引用模式说明(总纲 § 2"新旧 API 共存")

本阶段 capability 通过 import `@plugins/ebook/renderers/pdf` 内 PDFRenderer 类**声明意图**,实际代码留在 plugin 内运行。**真搬迁推到波次 3 ebook 整体迁移时做**——届时 PDFRenderer 类整体搬入 `src/capabilities/pdf-rendering/renderer.ts`,本目录形成自包含 capability。

## 与 02b-text-editing 的关键差异(为什么 createInstance 这次能填)

text-editing 的 createInstance 推到波次 3,因为 NoteEditor.tsx 内 PM 实例创建与 React 生命周期深度耦合:5 个 React ref + 3 个回调链 + dispatchTransaction 副作用 + createTocIndicator——临时引用模式失效。

**PDFRenderer 不同**:
- 是独立 class 实现 IFixedPageRenderer 接口
- **完全无 React 依赖**(grep 0 ref/state/effect)
- 操作 HTMLCanvasElement(DOM 但非 React)
- 异步 API(load / render 等)——纯 class,可直接包装为 createInstance 工厂

这一对比验证了"临时引用模式"的边界:**纯 class 实现可临时引用 createInstance,React 深度耦合的实例创建不可**。
```

**关键约束**:
- **字节级照抄**
- 路径 `src/capabilities/pdf-rendering/README.md` 严格匹配
- 不创建任何 `pdf-rendering/` 子目录或其他文件

### J3：更新 `src/capabilities/README.md`

02b-2c 落的 README 含:

```markdown
## 当前状态(阶段 02b-2c-text-editing-commands,02b 系列收尾)

**已有 1 个 capability(4/5 字段已填,02b 系列收尾)**:
- `text-editing/`(02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c commit `237c6cd0`)——`textEditingCapability` 4 字段已填(id/schema/converters/commands),createInstance 留波次 3

**createInstance 跳过原因**:NoteEditor.tsx PM 实例创建与 React 生命周期深度
耦合,临时引用模式失效。波次 3 note 整体迁移时一并抽工厂。

**临时引用模式说明**:本阶段及前序阶段填的 schema/converters/commands 引用
`plugins/note/` 内现有导出,不搬业务代码。真搬迁推到波次 3 note 整体迁移
时做。

其他 capability(canvas-interaction / web-rendering / pdf-rendering 等)将在
02b-3+ 按需进入此目录。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-3-pdf-rendering)

**已有 2 个 capability**:

1. **`text-editing/`**(复合型,02b 系列收尾)
   - 02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c `237c6cd0`
   - `textEditingCapability` 4/5 字段已填(id/schema/converters/commands);createInstance 留波次 3(NoteEditor PM 创建与 React 深度耦合)

2. **`pdf-rendering/`**(实例工厂型,02b-3 一阶段完成)
   - 02b-3 commit `<填 J1 commit SHA>`
   - `pdfRenderingCapability` 仅 createInstance 实质(临时引用 PDFRenderer 类);schema/converters/commands 对 PDF 不适用(全 undefined)

**两种 capability 形态**(为后续起草分类):
- **复合型**(schema+converters+commands 都有):text-editing ✅ / canvas-interaction / web-rendering 等
- **实例工厂型**(仅 createInstance):**pdf-rendering ✅** / epub-rendering / shape-library 等

**临时引用模式说明**:本阶段及前序阶段所有 capability 字段引用 `plugins/<X>/`
内现有导出,不搬业务代码。真搬迁推到波次 3 各插件整体迁移时做。

其他 capability(canvas-interaction / web-rendering / shape-library / 等)将在
02b-4+ 按需进入此目录。
```

**关键约束**：
- **仅修改"## 当前状态"段**
- 其他段(`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`)字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)
- 4 SHA(text-editing)+ 1 SHA(pdf-rendering)= 5 SHA 全部嵌入

## 严禁顺手做

- ❌ **不修改** `src/plugins/ebook/` 任何文件(capability 仅引用)
- ❌ **不动** `plugins/ebook/renderers/pdf/index.ts` PDFRenderer 类(临时引用对象)
- ❌ **不动** `plugins/ebook/components/EBookView.tsx` 等 ebook 视图入口
- ❌ **不修改** 02b-text-editing 已落 capability 文件(只更新 capabilities/README.md)
- ❌ **不创建** `pdf-rendering/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `src/capabilities/<其他 capability>` 子目录
- ❌ **不修改** 任何业务代码(src/main / src/renderer / src/plugins/<其他>)
- ❌ **不动** 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ❌ **不动** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/pdf-rendering/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: 2 行 import(Capability+CapabilityInstance+CapabilityOptions+HostElement / PDFRenderer)
- [ ] **J1 子项**: `pdfRenderingCreateInstance` 模块级 const(不内联),参数前缀 `_host`/`_options`
- [ ] **J1 子项**: 5 字段顺序 id → schema → converters → createInstance → commands
- [ ] **J1 子项**: 4 个字段值严格 `undefined`(schema/converters/commands)
- [ ] **J1 子项**: createInstance = pdfRenderingCreateInstance(模块级 const)
- [ ] **J1 子项**: `as CapabilityInstance` 断言保留
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J2**: `pdf-rendering/README.md` 字节级匹配 task-card § J2
- [ ] **J3**: `src/capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 标题 = "## 当前状态(阶段 02b-3-pdf-rendering)"
- [ ] **J3 子项**: 5 SHA 全嵌入(text-editing 4 SHA + pdf-rendering 1 SHA)
- [ ] **J3 子项**: 含两种 capability 形态分类说明(复合型 / 实例工厂型)
- [ ] **J4**: `git diff c0d0851b..HEAD --stat`(**强制双点 diff + 显式基线 SHA `c0d0851b`**)含且仅含以下 3 个文件:
      - `src/capabilities/pdf-rendering/index.ts`(新建)
      - `src/capabilities/pdf-rendering/README.md`(新建)
      - `src/capabilities/README.md`(修改)
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1，**errors=765 / warnings=15** 与 02b-2c baseline 完全一致(吸收 § 六纪律 5+6)
- [ ] **J5c**: `npm run lint:dirs` exit 0(白名单豁免有效)
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/pdf-rendering): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 输出 3 行(`src/capabilities` + `text-editing` + `pdf-rendering`)
- [ ] **J8**: `find src/capabilities -type f` 输出 5 行(根 README + 2 个 capability 各 README + index.ts)

## 已知风险

- **R1(已实测)**: Commander 已模拟 J1 字节级 + 跑 typecheck=0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅
- **R2(PDFRenderer 零 React 依赖确认)**: Commander 已 grep 验证 PDFRenderer 类**完全无 React 依赖**(0 个 ref/state/effect)。这与 NoteEditor 形成对比——证明实例工厂型 capability 临时引用模式可包装 createInstance
- **R3(吸收 02a G1 教训)**: task-card § J1/J2 字节级模板**不含**任何 `eslint-disable-...` 注释。J5b warnings=15 严格成立
- **R4**: pdf-rendering/ 目录下不允许除 index.ts + README.md 外任何文件(波次 3 真搬迁时才创建 renderer.ts 等)
- **R5(基线锁定)**: 派活基线 `c0d0851b` = main 当前 HEAD(含阶段 02b-2c merge `fd1add2a` + 02b-2c 存档 `c0d0851b`)
- **R6(参数前缀 _ 表明未使用)**: createInstance 工厂参数前缀 `_host` `_options` 是 TypeScript/ESLint 惯例,表明本阶段未使用——避免 unused-vars warning。这与 task-card 字面要求一致
- **R7(实例工厂型形态首次落地)**: 本阶段验证 Capability 接口对实例工厂型 capability 的支持。目录结构(2 个 capability 并存)和 README 形态分类是首次出现——为后续 02b-4+ canvas-interaction / shape-library 等建立样板

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **createInstance 工厂参数前缀 `_` 还是无前缀?** —— **Commander 答**:**带 `_` 前缀**(task-card § J1 字面)。理由:本阶段未使用参数,前缀避免 unused-vars warning;以后扩展时去掉前缀
2. **createInstance 工厂是模块级 const 还是内联?** —— **Commander 答**:模块级 const(task-card § J1 字面)。理由:与 02b-text-editing 的 textEditingConverters / textEditingCommands 一致——便于将来重命名/扩展
3. **schema/converters/commands 不写字段还是显式 undefined?** —— **Commander 答**:显式 `undefined`(task-card § J1 字面)。理由:与 02b-2a 一致,更明确表达"不适用"语义
4. **`as CapabilityInstance` 断言能否省略?** —— **Commander 答**:不能省略(CapabilityInstance = unknown,无断言时 PDFRenderer 实例不能赋给 unknown 类型)。task-card R6 实测验证
5. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段(实例工厂型 capability 首次落地)

本次为波次 2 第二阶段第五步(pdf-rendering capability 一阶段完成),**采用临时引用 plugin 模式**——不搬业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动,与 02b-1/2a/2b/2c 同模式)——**实例工厂型 capability 首次落地,为后续起草建立形态分类样板**。
