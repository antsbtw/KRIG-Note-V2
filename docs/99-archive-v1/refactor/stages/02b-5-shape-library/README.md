# 阶段 02b-5：shape-library Capability 一阶段完成（资源访问型首次落地）

> **状态**：待执行
> **目标分支**：`refactor/shape-library`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（capability 临时引用 plugin，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`9e9c7a9a`(main HEAD，含阶段 02b-4 merge)

---

## 阶段目标

继 02b-1~02b-4 之后，**新建第四个 capability：`capability.shape-library`**——KRIG 第三种 capability 形态"**资源访问型**"首次落地。一阶段完成（与 02b-3/02b-4 同节奏），临时引用 `plugins/graph/library/` 内现有 `ShapeRegistry` + `SubstanceRegistry` 全局单例。

> **核心命题**：发现并验证 capability 第三种形态——**资源访问型**。前两种形态是工厂语义（每次实例化），但资源仓库（shape/substance/library）是**全局共享语义**——通过 schema 字段暴露聚合的单例引用，无 createInstance。

> **重要发现**：shape-library 是 graph 插件首个 capability。02b 系列从 ebook 系列扩展到 graph 系列。

按总纲 § 5.4 数据契约 + § 5.9 能力清单 + § 2 推进策略"新旧 API 共存"。

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** 新建 `src/capabilities/shape-library/index.ts`（shapeLibraryCapability 实例化 + schema 字段聚合 ShapeRegistry+SubstanceRegistry）
2. **J2** 新建 `src/capabilities/shape-library/README.md`（capability 说明 + 资源访问型新形态解释）
3. **J3** 更新 `src/capabilities/README.md` "## 当前状态"段（从 3 个 capability 升级到 4 个 + 加入第三种形态）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `9e9c7a9a`，含且仅含 3 文件）
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测（按 § 六纪律 1+2+4）

### 1. graph/library 目录结构（已读）

```
src/plugins/graph/library/
├─ index.ts                       # 公开 API:export ShapeRegistry / SubstanceRegistry
├─ types.ts                       # ShapeDef / SubstanceDef 等类型
├─ shapes/
│  ├─ registry.ts                 # ShapeRegistry 单例(class ShapeRegistryImpl + export const)
│  ├─ index.ts
│  └─ renderers/                  # parametric / static-svg / formula-eval
└─ substances/
   ├─ registry.ts                 # SubstanceRegistry 单例
   └─ index.ts
```

### 2. ShapeRegistry / SubstanceRegistry 单例形态（已读）

两者**完全同构**：
- `class ShapeRegistryImpl / SubstanceRegistryImpl`（私有，不导出）
- `export const ShapeRegistry = new ShapeRegistryImpl()` / `export const SubstanceRegistry = new SubstanceRegistryImpl()`
- 公共方法：`register / registerPack / get / list / listByCategory / bootstrap`
- **完全无 React 依赖**

### 3. 调用方使用方式（已读）

`src/plugins/graph/canvas/CanvasView.tsx:218-219`：
```ts
ShapeRegistry.bootstrap();
SubstanceRegistry.bootstrap();
```

调用方期望**全局共享一份资源**——所有视图、所有插件都访问同一个 ShapeRegistry / SubstanceRegistry。

### 4. ⚠️ 与 PDFRenderer/EPUBRenderer 的根本架构差异

| 维度 | PDFRenderer / EPUBRenderer | **ShapeRegistry / SubstanceRegistry** |
|------|---------------------------|------|
| 模式 | **class 工厂**（每文件 new 一个） | **全局单例**（所有视图共享） |
| 调用方 | `new PDFRenderer().load(data)` | `ShapeRegistry.get('arrow-block')` |
| 适配 createInstance 工厂 | ✅ `() => new PDFRenderer()` 自然 | ❌ **不应该 new**（每次 new 重置） |
| 形态 | **实例工厂型** | **资源访问型** |

### 5. 决策：B1 方案（schema 字段承载聚合对象）

shape-library 不适合实例工厂型——但又有**两个**单例（ShapeRegistry + SubstanceRegistry）。

**B1 方案**：schema 字段承载聚合对象 `{ shapes: ShapeRegistry, substances: SubstanceRegistry }`：

理由：
- **不改 Capability 接口**（阶段 01 已落，不动）
- **schema = unknown 类型宽松**，可承载任何引用（已被 text-editing 的 blockRegistry 验证）
- **业界惯例**：library 资源仓库通常聚合（shape + substance 都属于"图谱资源"）
- **紧耦合**：CanvasView 调用方两个单例一起 bootstrap

**实测验证**（Commander 已做）：
```ts
import type { Capability } from '@shared/ui-primitives';
import { ShapeRegistry } from '@plugins/graph/library/shapes';
import { SubstanceRegistry } from '@plugins/graph/library/substances';

const shapeLibrarySchema = {
  shapes: ShapeRegistry,
  substances: SubstanceRegistry,
};

export const shapeLibraryCapability: Capability = {
  id: 'capability.shape-library',
  schema: shapeLibrarySchema,
  converters: undefined,
  createInstance: undefined,
  commands: undefined,
};
```
typecheck exit 0 / lint 全仓 780 不变 / 单文件 lint 干净 ✅

## 三种 capability 形态对比（02b 系列总结）

| 形态 | 字段填充 | 已落地 capability |
|---|---|---|
| **复合型** | schema + converters + commands | text-editing（02b-1~2c）|
| **实例工厂型** | 仅 createInstance（每次 new）| pdf-rendering（02b-3） / epub-rendering（02b-4） |
| **资源访问型** | 仅 schema（聚合单例引用，无 createInstance）| **shape-library（02b-5，本阶段）** |

资源访问型适用场景：全局共享的资源仓库（如 shape / substance / theme / palette）。

## 02b-5 之后的 capability 全貌

完成本阶段后：

| capability | 形态 | 来源 plugin |
|---|---|---|
| `text-editing` | 复合型（4/5 字段） | note |
| `pdf-rendering` | 实例工厂型 | ebook |
| `epub-rendering` | 实例工厂型 | ebook |
| **`shape-library`** | **资源访问型** | **graph（首次）** |

graph 插件首个 capability 落地。

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
| [src/plugins/graph/library/shapes/registry.ts](../../../../src/plugins/graph/library/shapes/registry.ts) ShapeRegistry 单例 | capability 引用对象(**不修改**)|
| [src/plugins/graph/library/substances/registry.ts](../../../../src/plugins/graph/library/substances/registry.ts) SubstanceRegistry 单例 | capability 引用对象(**不修改**)|
| [src/capabilities/README.md](../../../../src/capabilities/README.md) | J3 修改对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备(含现状探查 + 实测) | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
