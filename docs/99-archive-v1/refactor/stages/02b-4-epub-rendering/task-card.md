# 任务卡：refactor/epub-rendering（阶段 02b-4-epub-rendering）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`bad4d4ea`(main HEAD)

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口
- 现有 EPUBRenderer 类(capability 引用对象，**不修改**)：[src/plugins/ebook/renderers/epub/index.ts](../../../../src/plugins/ebook/renderers/epub/index.ts)
- 02b-3 样板：[src/capabilities/pdf-rendering/index.ts](../../../../src/capabilities/pdf-rendering/index.ts)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第六步：新建 capability.epub-rendering(实例工厂型,一阶段完成)**

新建第三个 capability `capability.epub-rendering`，临时引用 `plugins/ebook/renderers/epub/index.ts` 内现有 EPUBRenderer 类作为 createInstance 工厂。**与 02b-3 pdf-rendering 完全同模式**——巩固实例工厂型样板。

**核心命题**：连续两个实例工厂型 capability 验证样板稳定可复用，不只是一次成功。

**非目标**：
- ❌ 不搬迁 EPUBRenderer 类
- ❌ 不动 plugins/ebook/ 任何文件
- ❌ 不动 ebook 视图或调用方
- ❌ 不动 02b-text-editing / 02b-pdf-rendering 已完成的 capability（仅引用现有 capability/ 目录的 README.md）

## 本分支只做

按以下顺序：

### J1：新建 `src/capabilities/epub-rendering/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives';
import { EPUBRenderer } from '@plugins/ebook/renderers/epub';

/**
 * capability.epub-rendering — EPUB 渲染能力
 *
 * **形态:实例工厂型 capability**(仅 createInstance 字段实质,其他 undefined)。
 * 与 02b-3 pdf-rendering 完全同模式——巩固实例工厂型样板。
 *
 * 临时引用模式(总纲 § 2 推进策略"新旧 API 共存"):
 * createInstance 工厂直接 new EPUBRenderer 类,该类位于 plugins/ebook/renderers/epub。
 * 真搬迁推到波次 3 ebook 整体迁移时做(届时 EPUBRenderer 类整体搬入 capability)。
 *
 * **EPUBRenderer 是纯 class 实现**(完全无 React 依赖,与 PDFRenderer 同构),
 * 内部用动态 import('foliate-js/view.js') + customElements.define 注册
 * Web Component。这些实现细节封装在类内,capability 仅 new EPUBRenderer() 不感知。
 *
 * 字段说明:
 * - schema:undefined(EPUB 渲染无 schema 概念)
 * - converters:undefined(EPUB 不需要 atom 转换)
 * - createInstance:✅ epubRenderingCreateInstance 工厂(本阶段填)
 * - commands:undefined(EPUB 仅渲染,无命令)
 *
 * 详见总纲 § 5.4 数据契约 + § 5.9 能力清单。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - ebook.epub
 * - 未来:web 视图嵌入 EPUB 选段引用等场景
 */

const epubRenderingCreateInstance = (
  _host: HostElement,
  _options: CapabilityOptions,
): CapabilityInstance => {
  // 临时引用 plugin/ebook 内 EPUBRenderer 类(波次 3 真搬迁)
  return new EPUBRenderer() as CapabilityInstance;
};

export const epubRenderingCapability: Capability = {
  id: 'capability.epub-rendering',

  // schema:undefined(EPUB 渲染无 schema 概念)
  schema: undefined,

  // converters:undefined(EPUB 不需要 atom 转换)
  converters: undefined,

  // createInstance:✅ 临时引用 EPUBRenderer 类(本阶段填)
  createInstance: epubRenderingCreateInstance,

  // commands:undefined(EPUB 仅渲染,无命令)
  commands: undefined,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 2 行(按上述顺序：Capability+CapabilityInstance+CapabilityOptions+HostElement / EPUBRenderer)
- `epubRenderingCreateInstance` 是模块级 const(便于将来扩展);参数前缀 `_host` `_options` 表明本阶段未使用
- epubRenderingCapability 5 字段顺序严格：id → schema → converters → createInstance → commands
- 4 个字段（schema/converters/commands）值严格为 `undefined`(不允许 null / 删除字段)
- createInstance = `epubRenderingCreateInstance`(模块级 const,不内联)
- **不允许添加任何 `// eslint-disable-...` 注释**(吸收 02a G1 教训)
- `as CapabilityInstance` 断言因 CapabilityInstance = unknown 兜底类型必需

### J2：新建 `src/capabilities/epub-rendering/README.md`

**字节级照抄**：

```markdown
# capability.epub-rendering

EPUB 渲染能力(基于 foliate-js)。详见总纲 § 5.9 能力清单 + § 5.4 数据契约。

## 当前状态(阶段 02b-4-epub-rendering)

**实例工厂型 capability,一阶段完成**:`epubRenderingCapability` 5 字段:
- ✅ `id` = `'capability.epub-rendering'`
- ⏸️ `schema` = `undefined`(EPUB 无 schema 概念)
- ⏸️ `converters` = `undefined`(EPUB 不需要 atom 转换)
- ✅ `createInstance` = `epubRenderingCreateInstance` 工厂(临时引用 EPUBRenderer 类)
- ⏸️ `commands` = `undefined`(EPUB 仅渲染,无命令)

## 形态分类:实例工厂型(连续第二次)

本 capability 与 02b-3 pdf-rendering 完全同模式——**实例工厂型样板巩固**。

未来实例工厂型 capability 可直接套此样板:
- 已落地:pdf-rendering ✅ / **epub-rendering ✅(本阶段)**
- 后续候选:shape-library / elk-layout 等

## 设计原则(总纲引用)

- § 1.3 规则 A:外部依赖必须经 Capability 封装,视图禁止直接 import
- § 5.4 数据契约:Capability 接口含 schema / converters / createInstance / commands 等字段(全 optional,实例工厂型仅填 createInstance)
- § 5.5 强约束:命名空间 `capability.epub-rendering`、禁套娃、颗粒度按"未来可扩展"
- § 5.8 视图是声明,实现都在 Capability 里——foliate-js 是外部依赖,封装在 EPUBRenderer 类内(plugin 已实现)

## 主要消费视图(预期)

- `ebook.epub`(当前主消费方)
- 未来:web 视图嵌入 EPUB 选段引用等场景

## 临时引用模式说明(总纲 § 2"新旧 API 共存")

本阶段 capability 通过 import `@plugins/ebook/renderers/epub` 内 EPUBRenderer 类**声明意图**,实际代码留在 plugin 内运行。**真搬迁推到波次 3 ebook 整体迁移时做**——届时 EPUBRenderer 类整体搬入 `src/capabilities/epub-rendering/renderer.ts`,本目录形成自包含 capability。

## EPUBRenderer 实现差异(与 PDFRenderer 对比,仅供参考)

EPUBRenderer 与 PDFRenderer 同为实例工厂型,但内部实现有差异(对 capability 临时引用无影响):

| 维度 | PDFRenderer | EPUBRenderer |
|------|-------------|--------------|
| 类签名 | `implements IFixedPageRenderer` | `implements IReflowableRenderer` |
| 行数 | 298 | 365 |
| import 方式 | 顶部静态 `import * as pdfjsLib from 'pdfjs-dist'` | 内部动态 `await import('foliate-js/view.js')` |
| 类型声明 | (无独立 .d.ts) | `foliate-js.d.ts`(11 行 ambient module) |
| Web Component | (无) | `customElements.define('foliate-view', View)` |

这些差异封装在 EPUBRenderer 类内部, capability 仅 `new EPUBRenderer()` 不感知,这正是临时引用模式的隔离价值。
```

**关键约束**:
- **字节级照抄**
- 路径 `src/capabilities/epub-rendering/README.md` 严格匹配
- 不创建任何 `epub-rendering/` 子目录或其他文件

### J3：更新 `src/capabilities/README.md`

02b-3 落的"## 当前状态"段含:

```markdown
## 当前状态(阶段 02b-3-pdf-rendering)

**已有 2 个 capability**:

1. **`text-editing/`**(复合型,02b 系列收尾)
   - 02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c `237c6cd0`
   - `textEditingCapability` 4/5 字段已填(id/schema/converters/commands);createInstance 留波次 3(NoteEditor PM 创建与 React 深度耦合)

2. **`pdf-rendering/`**(实例工厂型,02b-3 一阶段完成)
   - 02b-3 commit `add19d46`
   - `pdfRenderingCapability` 仅 createInstance 实质(临时引用 PDFRenderer 类);schema/converters/commands 对 PDF 不适用(全 undefined)

**两种 capability 形态**(为后续起草分类):
- **复合型**(schema+converters+commands 都有):text-editing ✅ / canvas-interaction / web-rendering 等
- **实例工厂型**(仅 createInstance):**pdf-rendering ✅** / epub-rendering / shape-library 等

**临时引用模式说明**:本阶段及前序阶段所有 capability 字段引用 `plugins/<X>/`
内现有导出,不搬业务代码。真搬迁推到波次 3 各插件整体迁移时做。

其他 capability(canvas-interaction / web-rendering / shape-library / 等)将在
02b-4+ 按需进入此目录。
```

**修改为**：

```markdown
## 当前状态(阶段 02b-4-epub-rendering)

**已有 3 个 capability**:

1. **`text-editing/`**(复合型,02b 系列收尾)
   - 02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c `237c6cd0`
   - `textEditingCapability` 4/5 字段已填(id/schema/converters/commands);createInstance 留波次 3(NoteEditor PM 创建与 React 深度耦合)

2. **`pdf-rendering/`**(实例工厂型,02b-3 一阶段完成)
   - 02b-3 commit `add19d46`
   - `pdfRenderingCapability` 仅 createInstance 实质(临时引用 PDFRenderer 类);schema/converters/commands 对 PDF 不适用(全 undefined)

3. **`epub-rendering/`**(实例工厂型,02b-4 一阶段完成)
   - 02b-4 commit `<填 J1 commit SHA>`
   - `epubRenderingCapability` 仅 createInstance 实质(临时引用 EPUBRenderer 类,基于 foliate-js);schema/converters/commands 对 EPUB 不适用(全 undefined)

**两种 capability 形态**(实例工厂型样板已巩固——连续两次):
- **复合型**(schema+converters+commands 都有):text-editing ✅ / canvas-interaction / web-rendering 等
- **实例工厂型**(仅 createInstance):**pdf-rendering ✅** / **epub-rendering ✅(本阶段)** / shape-library / elk-layout 等

**ebook 插件全部 capability 化**:pdf + epub 两个渲染器都有对应 capability(仍是临时引用,真搬迁推到波次 3)。

**临时引用模式说明**:本阶段及前序阶段所有 capability 字段引用 `plugins/<X>/`
内现有导出,不搬业务代码。真搬迁推到波次 3 各插件整体迁移时做。

其他 capability(canvas-interaction / web-rendering / shape-library / 等)将在
02b-5+ 按需进入此目录。
```

**关键约束**：
- **仅修改"## 当前状态"段**
- 其他段(`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`)字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)
- 6 SHA(text-editing 4 + pdf 1 + epub 1)全部嵌入

## 严禁顺手做

- ❌ **不修改** `src/plugins/ebook/` 任何文件(capability 仅引用)
- ❌ **不动** `plugins/ebook/renderers/epub/index.ts` EPUBRenderer 类(临时引用对象)
- ❌ **不动** `plugins/ebook/renderers/epub/foliate-js.d.ts`(ambient module 声明)
- ❌ **不动** `plugins/ebook/components/EBookView.tsx` 等 ebook 视图入口
- ❌ **不修改** 02b-text-editing / 02b-pdf-rendering 已落 capability 文件(只更新 capabilities/README.md)
- ❌ **不创建** `epub-rendering/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `src/capabilities/<其他 capability>` 子目录
- ❌ **不修改** 任何业务代码(src/main / src/renderer / src/plugins/<其他>)
- ❌ **不动** 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ❌ **不动** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/epub-rendering/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: 2 行 import(Capability+CapabilityInstance+CapabilityOptions+HostElement / EPUBRenderer)
- [ ] **J1 子项**: `epubRenderingCreateInstance` 模块级 const(不内联),参数前缀 `_host`/`_options`
- [ ] **J1 子项**: 5 字段顺序 id → schema → converters → createInstance → commands
- [ ] **J1 子项**: 4 个字段值严格 `undefined`(schema/converters/commands)
- [ ] **J1 子项**: createInstance = epubRenderingCreateInstance(模块级 const)
- [ ] **J1 子项**: `as CapabilityInstance` 断言保留
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J2**: `epub-rendering/README.md` 字节级匹配 task-card § J2
- [ ] **J3**: `src/capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 标题 = "## 当前状态(阶段 02b-4-epub-rendering)"
- [ ] **J3 子项**: 6 SHA 全嵌入(text-editing 4 SHA + pdf 1 SHA + epub 1 SHA)
- [ ] **J3 子项**: 含三个 capability 列表(text-editing + pdf-rendering + epub-rendering)
- [ ] **J4**: `git diff bad4d4ea..HEAD --stat`(**强制双点 diff + 显式基线 SHA `bad4d4ea`**)含且仅含以下 3 个文件:
      - `src/capabilities/epub-rendering/index.ts`(新建)
      - `src/capabilities/epub-rendering/README.md`(新建)
      - `src/capabilities/README.md`(修改)
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1，**errors=765 / warnings=15** 与 02b-3 baseline 完全一致(吸收 § 六纪律 5+6)
- [ ] **J5c**: `npm run lint:dirs` exit 0(白名单豁免有效)
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/epub-rendering): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 输出 4 行(`src/capabilities` + 3 个 capability)
- [ ] **J8**: `find src/capabilities -type f` 输出 7 行(根 README + 3 个 capability 各 2 文件)

## 已知风险

- **R1(已实测)**: Commander 已模拟 J1 字节级 + 跑 typecheck=0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅
- **R2(EPUBRenderer 零 React 依赖确认)**: Commander 已 grep 验证 EPUBRenderer 类**完全无 React 依赖**(0 个 ref/state/effect)。这与 PDFRenderer 同构,实例工厂型 capability 模式可直接套用
- **R3(吸收 02a G1 教训)**: task-card § J1/J2 字节级模板**不含**任何 `eslint-disable-...` 注释。J5b warnings=15 严格成立
- **R4**: epub-rendering/ 目录下不允许除 index.ts + README.md 外任何文件(波次 3 真搬迁时才创建 renderer.ts 等)
- **R5(基线锁定)**: 派活基线 `bad4d4ea` = main 当前 HEAD(含阶段 02b-3 merge `c724c800` + 02b-3 存档 `bad4d4ea`)
- **R6(参数前缀 _ 表明未使用)**: createInstance 工厂参数前缀 `_host` `_options` 必保留(与 02b-3 一致)
- **R7(实例工厂型样板巩固)**: 本阶段是 02b-3 的姊妹阶段,验证形态分类样板可稳定复用。task-card 字面与 02b-3 高度同构(差异仅在字面替换,架构决策完全沿用)
- **R8(EPUBRenderer 内部实现差异不影响 capability)**: EPUBRenderer 用动态 import + customElements.define 等技术,与 PDFRenderer 静态 import 不同。但这些差异封装在类内,capability 仅 `new EPUBRenderer()` 不感知——这正是临时引用模式的隔离价值

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **createInstance 工厂参数前缀 `_` 还是无前缀?** —— **Commander 答**:**带 `_` 前缀**(与 02b-3 一致,task-card § J1 字面)
2. **createInstance 工厂是模块级 const 还是内联?** —— **Commander 答**:模块级 const(与 02b-3 一致)
3. **schema/converters/commands 不写字段还是显式 undefined?** —— **Commander 答**:显式 `undefined`(与 02b-3 一致)
4. **`as CapabilityInstance` 断言能否省略?** —— **Commander 答**:不能省略(CapabilityInstance = unknown 兜底类型必需)
5. **EPUBRenderer 的 foliate-js 动态 import / customElements.define 是否需要在 capability 中处理?** —— **Commander 答**:**不需要**,这些封装在 EPUBRenderer 类内部,capability 仅 `new EPUBRenderer()` 不感知(R8)
6. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段(实例工厂型样板巩固)

本次为波次 2 第二阶段第六步(epub-rendering capability 一阶段完成),**采用临时引用 plugin 模式**——不搬业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动,与 02b-3 完全同模式)——**实例工厂型样板巩固**,验证形态分类样板可稳定复用。
