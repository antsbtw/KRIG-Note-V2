# 阶段 02b-3：pdf-rendering Capability 一阶段完成（临时引用 plugin）

> **状态**：待执行
> **目标分支**：`refactor/pdf-rendering`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（capability 临时引用 plugin，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`c0d0851b`(main HEAD，含阶段 02b-2c merge)

---

## 阶段目标

继 02b 系列（text-editing capability 收尾）之后，**新建第二个 capability：`capability.pdf-rendering`**。一阶段完成（不分子阶段），临时引用 `plugins/ebook/renderers/pdf` 内现有 PDFRenderer 类实现 createInstance 工厂。

> **核心命题**：与 02b-text-editing 不同——pdf-rendering 形态简单，**仅 createInstance 一个实质字段**（PDFRenderer 是独立 class，零 React 耦合，可直接包装）。schema/converters/commands 对 PDF 渲染不适用，全部 `undefined`。

> **重要发现**：探查时确认 PDFRenderer 类**完全无 React 依赖**——这与 NoteEditor.tsx PM 创建（与 React 深度耦合）形成鲜明对比，证明**临时引用模式对纯 class 实现的 capability 完全可行**（包括 createInstance 字段，弥补 02b 系列 createInstance 跳过的遗憾）。

按总纲 § 5.4 数据契约 + § 5.9 能力清单 + § 2 推进策略"新旧 API 共存"。

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** 新建 `src/capabilities/pdf-rendering/index.ts`（pdfRenderingCapability 实例化 + createInstance 工厂）
2. **J2** 新建 `src/capabilities/pdf-rendering/README.md`（capability 说明）
3. **J3** 更新 `src/capabilities/README.md` "## 当前状态"段（从 1 个 capability 升级到 2 个）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `c0d0851b`，含且仅含 3 文件）
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测（按 § 六纪律 1+2+4）

1. **候选 capability 规模对比**（已做）：
   - **pdfjs-dist**: 1 文件（`ebook/renderers/pdf/index.ts` 298 行）—— **最小**
   - epubjs: 0 文件（未直接 import）
   - openai/anthropic: 0 文件（无 SDK 依赖）
   - canvas-interaction (three): 8 文件
   - elkjs: 0 文件
   - WebContentsView: 在 main 进程,不在 plugins

2. **PDFRenderer 类形态**（已读）：
   - `export class PDFRenderer implements IFixedPageRenderer`
   - **完全无 React 依赖**（grep 0 ref/state/effect）
   - 注释明示："EBookView 不直接依赖 pdfjs-dist，只通过此类交互"——已经接近 capability 模式
   - 操作 HTMLCanvasElement（DOM 但非 React）

3. **PDFRenderer 公共 API**：
   - `class PDFRenderer implements IFixedPageRenderer`
   - 实例方法：`load(data) / destroy() / render() / ...`
   - **可作为 createInstance 的实例工厂返回值**

4. **实测验证**（Commander 已做）：
   ```ts
   import type { Capability, CapabilityInstance, CapabilityOptions, HostElement } from '@shared/ui-primitives';
   import { PDFRenderer } from '@plugins/ebook/renderers/pdf';

   const pdfRenderingCreateInstance = (
     _host: HostElement,
     _options: CapabilityOptions,
   ): CapabilityInstance => {
     return new PDFRenderer() as CapabilityInstance;
   };

   export const pdfRenderingCapability: Capability = {
     id: 'capability.pdf-rendering',
     schema: undefined,
     converters: undefined,
     createInstance: pdfRenderingCreateInstance,
     commands: undefined,
   };
   ```
   实测：typecheck exit 0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅

## 与 text-editing 形态对比

| 字段 | text-editing（02b-2c 完成态）| **pdf-rendering（本阶段）** |
|------|-----------------------------|----------------------------|
| `id` | `'capability.text-editing'` | **`'capability.pdf-rendering'`** |
| `schema` | blockRegistry（PM Schema）| **undefined**（PDF 无 schema 概念）|
| `converters` | ConverterPair 适配 | **undefined**（PDF 不需要 atom 转换）|
| `createInstance` | undefined（推到波次 3，React 耦合）| **✅ pdfRenderingCreateInstance 工厂**（PDFRenderer 纯 class）|
| `commands` | 8 个文本命令 | **undefined**（PDF 仅渲染，无命令）|

**这是 capability 接口灵活性的首次跨形态验证**——证明 Capability 接口能容纳"实例工厂型 capability"（如 PDF 渲染）和"复合型 capability"（如富文本编辑）两种形态。

## 02b-3+ 起草样板（重要——后续 capability 起草引用）

按现状探查 + 实测，未来 capability 形态分两类：

### 形态 A：复合型（schema + converters + commands 都有）
- 例：text-editing
- 拆 4 阶段（skeleton → fields → bridge → commands）
- 字段填法：临时引用 plugin 单例 + 适配器

### 形态 B：实例工厂型（仅 createInstance）
- 例：**pdf-rendering（本阶段）**
- 一阶段完成
- 字段填法：PDFRenderer-like class + 工厂函数包装

未来候选 capability 按此分类：
- 复合型：text-editing ✅(完成) / canvas-interaction(三种字段都有) / web-rendering(可能含 commands)
- 实例工厂型：**pdf-rendering**(本阶段) / epub-rendering(epubjs 未引入暂留) / shape-library(资源访问) / elk-layout(布局算法)

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
| [src/plugins/ebook/renderers/pdf/index.ts](../../../../src/plugins/ebook/renderers/pdf/index.ts) PDFRenderer 类 | capability 引用对象(**不修改**)|
| [src/capabilities/README.md](../../../../src/capabilities/README.md) | J3 修改对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备(含现状探查 + 实测) | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
