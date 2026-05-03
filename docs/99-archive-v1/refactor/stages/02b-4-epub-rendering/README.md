# 阶段 02b-4：epub-rendering Capability 一阶段完成（实例工厂型样板巩固）

> **状态**：待执行
> **目标分支**：`refactor/epub-rendering`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（capability 临时引用 plugin，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`bad4d4ea`(main HEAD，含阶段 02b-3 merge)

---

## 阶段目标

继 02b-3 pdf-rendering 之后，**新建第三个 capability：`capability.epub-rendering`**（实例工厂型）。一阶段完成（与 02b-3 同模式），临时引用 `plugins/ebook/renderers/epub` 内现有 EPUBRenderer 类作为 createInstance 工厂。

> **核心命题**：连续两个实例工厂型 capability 验证样板稳定——证明 capability 形态分类样板可稳定复用，不只是一次成功。

> **与 02b-3 完美对标**：EPUBRenderer 与 PDFRenderer 同构（都是 ebook 插件 createRenderer 工厂内的纯 class 实现，零 React 依赖）。

按总纲 § 5.4 数据契约 + § 5.9 能力清单 + § 2 推进策略"新旧 API 共存"。

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** 新建 `src/capabilities/epub-rendering/index.ts`（epubRenderingCapability 实例化 + createInstance 工厂）
2. **J2** 新建 `src/capabilities/epub-rendering/README.md`（capability 说明）
3. **J3** 更新 `src/capabilities/README.md` "## 当前状态"段（从 2 个 capability 升级到 3 个）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `bad4d4ea`，含且仅含 3 文件）
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测（按 § 六纪律 1+2+4）

1. **EPUBRenderer 类与 PDFRenderer 对标**（已读）：

| 维度 | PDFRenderer | EPUBRenderer |
|------|-------------|-----------|
| 类签名 | `implements IFixedPageRenderer` | `implements IReflowableRenderer` |
| 行数 | 298 | 365 |
| 唯一公共导出 | `export class PDFRenderer` | `export class EPUBRenderer` |
| **React 依赖** | 0 | **0** |
| 引用 npm 包 | pdfjs-dist | foliate-js (^1.0.1) |
| 调用方 | `renderers/index.ts` createRenderer 工厂 | 同一处 createRenderer 工厂 |

2. **EPUBRenderer 实现差异**（仅供参考，对 capability 临时引用无影响）：
   - 内部用**动态 import**（`await import('foliate-js/view.js')`）—— 与 PDFRenderer 顶部 `import` 不同
   - 多一个 `foliate-js.d.ts`（11 行 ambient module 声明）—— capability 引用时不需要
   - `customElements.define('foliate-view', View)` —— 全局副作用（首次调用注册 Web Component）
   - 这些差异都在 EPUBRenderer 类内部封装，capability 仅 `new EPUBRenderer()` 不感知

3. **实测验证**（Commander 已做）：
   ```ts
   import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives';
   import { EPUBRenderer } from '@plugins/ebook/renderers/epub';

   const epubRenderingCreateInstance = (
     _host: HostElement,
     _options: CapabilityOptions,
   ): CapabilityInstance => {
     return new EPUBRenderer() as CapabilityInstance;
   };

   export const epubRenderingCapability: Capability = {
     id: 'capability.epub-rendering',
     schema: undefined,
     converters: undefined,
     createInstance: epubRenderingCreateInstance,
     commands: undefined,
   };
   ```
   实测：typecheck exit 0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅

4. **完成 ebook 插件全部 capability**：pdf + epub 两个渲染器都已 capability 化（仍是临时引用，真搬迁推到波次 3）

## 与 02b-3 的关系：实例工厂型样板巩固

本阶段是 02b-3 的**完美姊妹**——

| 项 | 02b-3 pdf-rendering | **02b-4 epub-rendering** |
|---|---|---|
| 形态 | 实例工厂型（首次） | **实例工厂型（巩固）** |
| 字段 | id + createInstance + 3 undefined | **同 02b-3** |
| 复杂度 | 一阶段完成 3 文件 | **同 02b-3** |
| task-card 起草 | 从零起草 | **直接套 02b-3 模板** |

**主要字面差异**（task-card 与 02b-3 几乎相同，只换字面）：
- `pdf-rendering` → `epub-rendering`
- `pdfRenderingCapability` → `epubRenderingCapability`
- `PDFRenderer` → `EPUBRenderer`
- `pdfjs-dist` → `foliate-js`
- `IFixedPageRenderer` → `IReflowableRenderer`
- 5 SHA → **6 SHA**（text-editing 4 + pdf 1 + epub 1）

**架构决策完全沿用 02b-3**：参数前缀 `_` / 模块级 const / `as` 断言 / 4 字段 `undefined` / 临时引用模式。

## 02b-4 之后的 capability 全貌

完成本阶段后，capabilities 目录形态：

| capability | 形态 | 状态 |
|---|---|---|
| `text-editing` | 复合型 | ✅ 4/5 字段（02b 系列收尾）|
| `pdf-rendering` | 实例工厂型 | ✅ 1 阶段完成（02b-3）|
| **`epub-rendering`** | **实例工厂型** | ✅ **1 阶段完成（本阶段）** |

**ebook 插件全部 capability 化**——pdf + epub 两个渲染器都有对应 capability。

## 02b-5+ 起草样板（实例工厂型样板已稳定）

按本阶段 + 02b-3 巩固，未来实例工厂型 capability 起草可直接套样板：

| 候选实例工厂型 capability | 引用对象 | 复杂度 |
|---|---|---|
| `shape-library` | graph/library 内现有类（待探查） | 中等 |
| `elk-layout` | elkjs（如已装） | 待探查 |

**复合型** capability（canvas-interaction / web-rendering 等）需要探查后按 02b-text-editing 模式（4 阶段）起草。

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览(本文件) | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J1~J5 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令 | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令 | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.9 + § 2 | 全员必读 |
| [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口 | 引用 |
| [src/plugins/ebook/renderers/epub/index.ts](../../../../src/plugins/ebook/renderers/epub/index.ts) EPUBRenderer 类 | capability 引用对象(**不修改**)|
| [src/capabilities/README.md](../../../../src/capabilities/README.md) | J3 修改对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备(含现状探查 + 实测) | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
