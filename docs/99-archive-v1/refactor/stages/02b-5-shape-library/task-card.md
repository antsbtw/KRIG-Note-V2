# 任务卡：refactor/shape-library（阶段 02b-5-shape-library）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`9e9c7a9a`(main HEAD)

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2
- 数据契约：[src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口
- 现有 ShapeRegistry / SubstanceRegistry 单例(capability 引用对象，**不修改**)：
  - [src/plugins/graph/library/shapes/registry.ts](../../../../src/plugins/graph/library/shapes/registry.ts)
  - [src/plugins/graph/library/substances/registry.ts](../../../../src/plugins/graph/library/substances/registry.ts)
- COMMANDER-PROMPT § 六纪律 1~6

## 本次范围

**波次 2 第二阶段第七步:新建 capability.shape-library(资源访问型,首次,一阶段完成)**

新建第四个 capability `capability.shape-library`，临时引用 `plugins/graph/library/` 内现有 `ShapeRegistry` + `SubstanceRegistry` 全局单例,通过 schema 字段承载聚合对象。**首次落地资源访问型 capability**——KRIG capability 第三种形态。

**核心命题**:发现并验证 capability 第三种形态。前两种形态是工厂语义（每次实例化），但资源仓库（shape/substance/library）是**全局共享语义**——通过 schema 字段暴露聚合的单例引用,无 createInstance。

**非目标**:
- ❌ 不搬迁 ShapeRegistry / SubstanceRegistry
- ❌ 不动 plugins/graph/ 任何文件
- ❌ 不动 CanvasView / 其他调用方
- ❌ 不实现 createInstance（资源访问型 capability 不需要工厂）
- ❌ 不动 02b-text-editing / 02b-pdf-rendering / 02b-epub-rendering 已完成的 capability（仅引用现有 capability/ 目录的 README.md）

## 本分支只做

按以下顺序：

### J1：新建 `src/capabilities/shape-library/index.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { Capability } from '@shared/ui-primitives';
import { ShapeRegistry } from '@plugins/graph/library/shapes';
import { SubstanceRegistry } from '@plugins/graph/library/substances';

/**
 * capability.shape-library — 图谱资源仓库能力
 *
 * **形态:资源访问型 capability**(KRIG capability 第三种形态首次落地)。
 * 与 02b-3/02b-4(实例工厂型) + 02b-text-editing(复合型) 形态都不同——
 * 资源访问型 capability 通过 schema 字段暴露**全局单例引用**而非工厂。
 *
 * 临时引用模式(总纲 § 2 推进策略"新旧 API 共存"):
 * schema 字段承载聚合对象 { shapes, substances },引用 plugins/graph/library/
 * 内现有的 ShapeRegistry + SubstanceRegistry 全局单例。真搬迁推到波次 3
 * graph 整体迁移时做(届时 library 整体搬入 capability)。
 *
 * **资源访问型 capability 设计原理**:
 * - 与实例工厂型(每个视图 new 一个 PDFRenderer)不同
 * - shape / substance 是**全系统共享**的资源(所有视图、所有插件访问同一份)
 * - 适合用 schema 字段承载单例引用,而非 createInstance 工厂
 * - createInstance / converters / commands 对资源访问型 capability 不适用
 *
 * **聚合对象设计**(B1 方案):
 * shape-library 同时管理 ShapeRegistry + SubstanceRegistry 两个单例。
 * schema = { shapes, substances } 聚合两者——业界惯例 + 紧耦合(CanvasView
 * 两个一起 bootstrap)。
 *
 * 字段说明:
 * - schema:✅ shapeLibrarySchema(临时引用聚合对象)
 * - converters:undefined(资源访问型不需要 atom 转换)
 * - createInstance:undefined(全局共享语义,无工厂)
 * - commands:undefined(资源仓库不暴露命令)
 *
 * 详见总纲 § 5.4 数据契约 + § 5.9 能力清单。
 *
 * 主要消费视图(详见总纲 § 5.9):
 * - graph.canvas / graph.family-tree(及未来所有 graph 变种视图)
 * - 未来:web 视图嵌入图谱预览等场景
 */

const shapeLibrarySchema = {
  shapes: ShapeRegistry,
  substances: SubstanceRegistry,
};

export const shapeLibraryCapability: Capability = {
  id: 'capability.shape-library',

  // schema:✅ 临时引用聚合对象(本阶段填,资源访问型)
  schema: shapeLibrarySchema,

  // converters:undefined(资源访问型不需要 atom 转换)
  converters: undefined,

  // createInstance:undefined(全局共享语义,无工厂)
  createInstance: undefined,

  // commands:undefined(资源仓库不暴露命令)
  commands: undefined,
};
```

**关键约束**：
- **字节级照抄上述代码**(含中文注释字符)
- import 严格 3 行(按上述顺序：Capability / ShapeRegistry / SubstanceRegistry)
- `shapeLibrarySchema` 是模块级 const,聚合对象 `{ shapes, substances }`(便于将来扩展)
- shapeLibraryCapability 5 字段顺序严格：id → schema → converters → createInstance → commands
- 3 个字段（converters/createInstance/commands）值严格为 `undefined`(不允许 null / 删除字段)
- schema = `shapeLibrarySchema`(模块级 const,不内联)
- **不允许添加任何 `// eslint-disable-...` 注释**(吸收 02a G1 教训)
- **shapeLibrarySchema 不需要 as 断言**(SchemaContribution = unknown 接受任何对象,直接赋值即可——已实测)

### J2：新建 `src/capabilities/shape-library/README.md`

**字节级照抄**：

```markdown
# capability.shape-library

图谱资源仓库能力(基于 ShapeRegistry + SubstanceRegistry 聚合单例)。详见总纲 § 5.9 能力清单 + § 5.4 数据契约。

## 当前状态(阶段 02b-5-shape-library)

**资源访问型 capability,一阶段完成**:`shapeLibraryCapability` 5 字段:
- ✅ `id` = `'capability.shape-library'`
- ✅ `schema` = `shapeLibrarySchema`(聚合对象 { shapes: ShapeRegistry, substances: SubstanceRegistry })
- ⏸️ `converters` = `undefined`(资源访问型不需要 atom 转换)
- ⏸️ `createInstance` = `undefined`(全局共享语义,无工厂)
- ⏸️ `commands` = `undefined`(资源仓库不暴露命令)

## 形态分类:资源访问型(首次落地)

本 capability 是 KRIG capability **第三种形态**——资源访问型 capability。

| 形态 | 字段填充 | 已落地 capability |
|------|---------|-----------------|
| 复合型 | schema + converters + commands | text-editing(02b-1~2c)|
| 实例工厂型 | 仅 createInstance(每次 new)| pdf-rendering(02b-3) / epub-rendering(02b-4) |
| **资源访问型** | **仅 schema(聚合单例引用,无 createInstance)** | **shape-library(02b-5,本阶段)** |

未来资源访问型 capability 可直接套此样板:theme / palette / icon-library 等全局共享资源。

## 资源访问型 vs 实例工厂型的设计差异

**关键差异**:

| 维度 | 实例工厂型(pdf/epub) | 资源访问型(shape-library) |
|------|---------------------|------------------------|
| 模式 | class 工厂 | 全局单例 |
| 调用方使用 | `new PDFRenderer().load(data)` | `ShapeRegistry.get('arrow-block')` |
| 字段载体 | createInstance | schema |
| 实例化 | 每个视图 new 一个 | 全系统共享一份 |
| 资源生命周期 | 跟随视图 | 全程持久 |

**为什么资源访问型用 schema 字段**:
- Capability 接口的 schema 字段类型为 `SchemaContribution = unknown`(阶段 01 故意留宽)
- 接受任何对象——可承载单例引用
- 语义合理:schema 是"该 capability 的数据结构定义",资源仓库正是 graph 域的数据结构

## 设计原则(总纲引用)

- § 1.3 规则 A:外部依赖必须经 Capability 封装,视图禁止直接 import
- § 5.4 数据契约:Capability 接口含 schema / converters / createInstance / commands 等字段(全 optional,资源访问型仅填 schema)
- § 5.5 强约束:命名空间 `capability.shape-library`、禁套娃、颗粒度按"未来可扩展"
- § 5.8 视图是声明,实现都在 Capability 里——shape/substance 资源库封装在 ShapeRegistry/SubstanceRegistry 内(plugin 已实现)

## 主要消费视图(预期)

- `graph.canvas`(当前主消费方,bootstrap 两个 registry)
- `graph.family-tree` 及未来所有 graph 变种视图
- 未来:web 视图嵌入图谱预览等场景

## 临时引用模式说明(总纲 § 2"新旧 API 共存")

本阶段 capability 通过 import `@plugins/graph/library/shapes` + `@plugins/graph/library/substances` 内 ShapeRegistry / SubstanceRegistry **声明意图**,实际代码留在 plugin 内运行。**真搬迁推到波次 3 graph 整体迁移时做**——届时 library 整体搬入 `src/capabilities/shape-library/`,本目录形成自包含 capability。

## 聚合对象设计(B1 方案)

shape-library 同时管理两个单例(ShapeRegistry + SubstanceRegistry),通过 schema 字段聚合:

```ts
const shapeLibrarySchema = {
  shapes: ShapeRegistry,
  substances: SubstanceRegistry,
};
```

**理由**:
1. 业界惯例:library 资源仓库通常聚合(shape + substance 都属于"图谱资源")
2. 紧耦合:CanvasView 两个一起 `bootstrap()`,语义同步
3. 维护简便:一个 capability 管两个相关单例,优于拆为两个独立 capability(B2 方案,复杂度翻倍)

**未来扩展**:如需添加更多 graph 资源仓库(如 theme / palette),可加入 `shapeLibrarySchema` 同对象。
```

**关键约束**:
- **字节级照抄**
- 路径 `src/capabilities/shape-library/README.md` 严格匹配
- 不创建任何 `shape-library/` 子目录或其他文件

### J3：更新 `src/capabilities/README.md`

02b-4 落的"## 当前状态"段含:

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
   - 02b-4 commit `7f8a9a2b`
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

**修改为**：

```markdown
## 当前状态(阶段 02b-5-shape-library)

**已有 4 个 capability**:

1. **`text-editing/`**(复合型,02b 系列收尾)
   - 02b-1 `256ec984` + 02b-2a `16ca2454` + 02b-2b `a315e7e0` + 02b-2c `237c6cd0`
   - `textEditingCapability` 4/5 字段已填(id/schema/converters/commands);createInstance 留波次 3(NoteEditor PM 创建与 React 深度耦合)

2. **`pdf-rendering/`**(实例工厂型,02b-3 一阶段完成)
   - 02b-3 commit `add19d46`
   - `pdfRenderingCapability` 仅 createInstance 实质(临时引用 PDFRenderer 类)

3. **`epub-rendering/`**(实例工厂型,02b-4 一阶段完成)
   - 02b-4 commit `7f8a9a2b`
   - `epubRenderingCapability` 仅 createInstance 实质(临时引用 EPUBRenderer 类,基于 foliate-js)

4. **`shape-library/`**(资源访问型,02b-5 一阶段完成,**首次落地**)
   - 02b-5 commit `<填 J1 commit SHA>`
   - `shapeLibraryCapability` 仅 schema 实质(聚合对象 { shapes, substances },临时引用 ShapeRegistry + SubstanceRegistry 全局单例);converters/createInstance/commands 对资源访问型不适用

**三种 capability 形态**(02b-5 后样板完整):
- **复合型**(schema + converters + commands):text-editing ✅ / canvas-interaction / web-rendering 等
- **实例工厂型**(仅 createInstance,每次 new):pdf-rendering ✅ / epub-rendering ✅ / 未来 elk-layout 等
- **资源访问型**(仅 schema,聚合单例引用)**首次落地**:**shape-library ✅** / 未来 theme / palette / icon-library 等

**插件 capability 化进度**:
- ebook 插件:全部 capability 化(pdf + epub)
- **graph 插件:首个 capability 落地**(shape-library)
- note 插件:1 个 capability(text-editing,createInstance 留波次 3)

**临时引用模式说明**:本阶段及前序阶段所有 capability 字段引用 `plugins/<X>/`
内现有导出,不搬业务代码。真搬迁推到波次 3 各插件整体迁移时做。

其他 capability(canvas-interaction / web-rendering / elk-layout 等)将在
02b-6+ 按需进入此目录。
```

**关键约束**：
- **仅修改"## 当前状态"段**
- 其他段(`# Capabilities` 标题段 / `## 设计原则` / `## 不在本目录的实现`)字节不变
- `<填 J1 commit SHA>` Builder 在 J3 时填具体 J1 commit SHA(8 位即可)
- 7 SHA(text-editing 4 + pdf 1 + epub 1 + shape 1)全部嵌入

## 严禁顺手做

- ❌ **不修改** `src/plugins/graph/` 任何文件(capability 仅引用)
- ❌ **不动** ShapeRegistry / SubstanceRegistry 单例
- ❌ **不动** `plugins/graph/canvas/CanvasView.tsx` 等 graph 视图入口
- ❌ **不动** `plugins/graph/library/index.ts` / `types.ts` / `renderers/`
- ❌ **不修改** 02b-text-editing / 02b-pdf-rendering / 02b-epub-rendering 已落 capability 文件(只更新 capabilities/README.md)
- ❌ **不创建** `shape-library/` 下除 index.ts + README.md 外任何文件
- ❌ **不创建** 任何 `src/capabilities/<其他 capability>` 子目录
- ❌ **不实现** createInstance / converters / commands 字段(资源访问型仅 schema 实质)
- ❌ **不修改** 任何业务代码(src/main / src/renderer / src/plugins/<其他>)
- ❌ **不动** 阶段 01/02a/02b-* 已落核心文件除 capabilities/README.md 外
- ❌ **不动** ESLint / tsconfig.json / package.json / schema-* / memory
- ❌ **不擅自做** merge / push

## 完成判据

- [ ] **J1**: `src/capabilities/shape-library/index.ts` 字节级匹配 task-card § J1
- [ ] **J1 子项**: 3 行 import(Capability / ShapeRegistry / SubstanceRegistry)
- [ ] **J1 子项**: `shapeLibrarySchema` 模块级 const,聚合对象 { shapes, substances }
- [ ] **J1 子项**: 5 字段顺序 id → schema → converters → createInstance → commands
- [ ] **J1 子项**: schema = shapeLibrarySchema(模块级 const 引用,不内联)
- [ ] **J1 子项**: 3 字段值严格 `undefined`(converters/createInstance/commands)
- [ ] **J1 子项**: 文件无任何 `// eslint-disable-...` 注释
- [ ] **J1 子项**: shapeLibrarySchema 不需要 as 断言(SchemaContribution=unknown 接受任何对象)
- [ ] **J2**: `shape-library/README.md` 字节级匹配 task-card § J2
- [ ] **J2 子项**: 含资源访问型 vs 实例工厂型的设计差异表
- [ ] **J3**: `src/capabilities/README.md` 仅"## 当前状态"段被修改;其他段字节不变
- [ ] **J3 子项**: 标题 = "## 当前状态(阶段 02b-5-shape-library)"
- [ ] **J3 子项**: 7 SHA 全嵌入(text-editing 4 SHA + pdf 1 + epub 1 + shape 1)
- [ ] **J3 子项**: 含三种 capability 形态分类说明(复合型 / 实例工厂型 / **资源访问型(首次落地)**)
- [ ] **J3 子项**: 含插件 capability 化进度(ebook 全 + graph 首个 + note 1 个)
- [ ] **J4**: `git diff 9e9c7a9a..HEAD --stat`(**强制双点 diff + 显式基线 SHA `9e9c7a9a`**)含且仅含以下 3 个文件:
      - `src/capabilities/shape-library/index.ts`(新建)
      - `src/capabilities/shape-library/README.md`(新建)
      - `src/capabilities/README.md`(修改)
- [ ] **J5a**: `npm run typecheck` exit 0
- [ ] **J5b**: `npm run lint` exit 1，**errors=765 / warnings=15** 与 02b-4 baseline 完全一致(吸收 § 六纪律 5+6)
- [ ] **J5c**: `npm run lint:dirs` exit 0(白名单豁免有效)
- [ ] **J6**: 所有 commit message 符合 CLAUDE.md `feat/docs(refactor/shape-library): ...` 格式
- [ ] **J7**: `find src/capabilities -type d` 输出 5 行(`src/capabilities` + 4 个 capability)
- [ ] **J8**: `find src/capabilities -type f` 输出 9 行(根 README + 4 个 capability 各 2 文件)

## 已知风险

- **R1(已实测)**: Commander 已模拟 J1 字节级 + 跑 typecheck=0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅
- **R2(资源访问型形态首次)**: 本阶段是 capability 第三种形态首次落地——README 必须清楚说明设计理由(资源访问型 vs 实例工厂型差异表)
- **R3(吸收 02a G1 教训)**: task-card § J1/J2 字节级模板**不含**任何 `eslint-disable-...` 注释。J5b warnings=15 严格成立
- **R4**: shape-library/ 目录下不允许除 index.ts + README.md 外任何文件
- **R5(基线锁定)**: 派活基线 `9e9c7a9a` = main 当前 HEAD(含阶段 02b-4 merge `a4197f86` + 02b-4 存档 `9e9c7a9a`)
- **R6(B1 聚合方案)**: shape-library 同时引用 ShapeRegistry + SubstanceRegistry 两个单例,通过聚合对象 `{ shapes, substances }` 承载于 schema 字段。**不允许**Builder 拆为两个 capability(B2 方案,复杂度翻倍)
- **R7(资源访问型设计原理硬约束)**: 资源访问型 capability **不应有 createInstance**——若 Builder 觉得"加一个工厂返回单例也无妨"是设计错误(违反全局共享语义)。task-card R2 + Q4 已答严禁
- **R8(graph 插件首个 capability)**: 完成本阶段后 graph 插件首个 capability 落地。02b-6+ canvas-interaction(复合型,Three.js 8 文件)将是 graph 第二个 capability,复杂度高得多

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **shapeLibrarySchema 是模块级 const 还是内联?** —— **Commander 答**:模块级 const(task-card § J1 字面)。理由:与 02b-2b textEditingConverters / 02b-3 pdfRenderingCreateInstance 一致——便于将来重命名/扩展
2. **schema 字段是否需要 as 断言?** —— **Commander 答**:**不需要**(SchemaContribution = unknown 接受任何对象,直接赋值即可,实测 typecheck 通过)。这与 text-editing schema = blockRegistry 同模式
3. **converters/createInstance/commands 不写字段还是显式 undefined?** —— **Commander 答**:显式 `undefined`(与 02b-2a/2b/3/4 一致,更明确表达"对此 capability 不适用"语义)
4. **是否考虑给资源访问型加一个工厂返回单例(`createInstance: () => ShapeRegistry`)?** —— **Commander 答**:**不**,这是设计错误。资源访问型 capability 全局共享语义——createInstance 工厂模式假设每次 new 实例化,违反此语义。task-card R7 + 严禁顺手做明示
5. **shape + substance 是否拆为两个 capability?** —— **Commander 答**:**不拆**(B1 聚合方案,task-card R6)。理由:业界惯例 + 紧耦合 + 维护简便
6. **3 个 commit 还是 1 个?** —— **Commander 答**:Builder 自决,建议 3 个(J1/J2/J3)

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪：tmp/builder-report.md"
- **不做** merge / push

## 备注:本次为基础设施类阶段(资源访问型 capability 首次落地)

本次为波次 2 第二阶段第七步(shape-library capability 一阶段完成),**采用临时引用 plugin 模式**——不搬业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。

本阶段简单(预期仅 3 文件改动,与 02b-3/02b-4 同节奏)——**资源访问型形态首次落地**,KRIG capability 三种形态样板齐备。
