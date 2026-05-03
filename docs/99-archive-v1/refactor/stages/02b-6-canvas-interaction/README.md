# 阶段 02b-6：canvas-interaction Capability 一阶段完成（混合型 capability 首次落地）

> **状态**：待执行
> **目标分支**：`refactor/canvas-interaction`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（capability 临时引用 plugin，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`48f649c8`(main HEAD，含阶段 02b-5 merge)

---

## 阶段目标

继 02b-1~02b-5 之后，**新建第五个 capability：`capability.canvas-interaction`**——KRIG 第四种 capability 形态"**混合型**"首次落地。一阶段完成（与 02b-3/4/5 同节奏），临时引用 `plugins/graph/canvas/` 内现有 SceneManager + InteractionController + NodeRenderer + HandlesOverlay 四个核心类。

> **核心命题**：发现并验证 capability 第四种形态——**混合型**（实例工厂型 + 资源访问型）。canvas-interaction 既需要 createInstance 工厂（每画板一个 SceneManager 实例），又需要 schema 暴露多个类构造函数（视图按需 new 辅助类如 NodeRenderer / HandlesOverlay）。

> **重要发现**：探查时发现 graph/canvas 不像 graph/library 是单例资源，也不像 ebook/renderers/pdf 是单类工厂——而是**多类协作架构**（SceneManager + InteractionController + 多个 Renderer），与已有三种形态都不同。

按总纲 § 5.4 数据契约 + § 5.9 能力清单 + § 2 推进策略"新旧 API 共存"。

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** 新建 `src/capabilities/canvas-interaction/index.ts`（canvasInteractionCapability 实例化 + schema 暴露 4 个类构造函数 + createInstance 工厂入口 SceneManager）
2. **J2** 新建 `src/capabilities/canvas-interaction/README.md`（capability 说明 + 混合型新形态解释）
3. **J3** 更新 `src/capabilities/README.md` "## 当前状态"段（从 4 个 capability 升级到 5 个 + 加入第四种形态）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `48f649c8`，含且仅含 3 文件）
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测（按 § 六纪律 1+2+4）

### 1. graph/canvas 架构探查（已读）

```
src/plugins/graph/canvas/
├─ CanvasView.tsx                  # 1147 行入口(消费方)
├─ scene/                          # Three.js 渲染核心
│  ├─ SceneManager.ts              # 入口主类(scene + camera + renderer + RAF)
│  ├─ NodeRenderer.ts              # 节点渲染
│  ├─ HandlesOverlay.ts            # 操作手柄
│  ├─ DotGrid.ts                   # 点阵网格(SceneManager 内部封装,不 export 给视图)
│  ├─ TextRenderer.ts              # 文字渲染(SceneManager 内部封装,不 export 给视图)
│  └─ LineRenderer.ts              # 线条渲染(纯函数,不是类)
└─ interaction/
   └─ InteractionController.ts     # 交互控制(依赖 SceneManager + NodeRenderer + HandlesOverlay)
```

### 2. 6 个 Three.js 类的视图使用频率（已 grep）

| 类 | CanvasView 引用次数 | new 次数 | 暴露给 capability schema? |
|---|---|---|---|
| SceneManager | 9 | 1 | ✅ 必须（入口）|
| InteractionController | 7 | 1 | ✅ 必须 |
| NodeRenderer | 5 | 1 | ✅ 必须 |
| HandlesOverlay | 8 | 1 | ✅ 必须 |
| **DotGrid** | **0** | 0 | ❌ 不暴露（被 SceneManager 内部封装）|
| **TextRenderer** | **0** | 0 | ❌ 不暴露（被 SceneManager 内部封装）|

→ schema 仅暴露**4 个核心类**（视图实际 new 的）。

### 3. InteractionController 构造函数签名（已读）

```ts
constructor(opts: {
  container: HTMLElement;
  sceneManager: SceneManager;       // 依赖 SceneManager 实例
  nodeRenderer: NodeRenderer;       // 依赖 NodeRenderer 实例
  handlesOverlay: HandlesOverlay;   // 依赖 HandlesOverlay 实例
  getInstance: (id: string) => Instance | undefined;
  // 5 个回调
})
```

→ InteractionController 不能"自动构造"——必须由调用方先 new SceneManager / NodeRenderer / HandlesOverlay 后传入。

### 4. 4 个核心类 React 依赖（已读）

**完全无 React 依赖**（grep 输出 0）。与 PDFRenderer / EPUBRenderer 同模式。

### 5. CanvasView 实际调用模式（已读）

```ts
const sm = new SceneManager(containerRef.current);  // 入口
const nr = new NodeRenderer(sm);
const handles = new HandlesOverlay(sm);
const ic = new InteractionController({ container, sceneManager: sm, nodeRenderer: nr, handlesOverlay: handles, ... });
```

调用方先 new 入口（SceneManager），然后 new 辅助类（接收 SceneManager 引用），最后 new 控制器（接收所有引用）。

### 6. 决策：混合型 capability（schema + createInstance）

| 字段 | 选择 | 理由 |
|------|------|------|
| `schema` | ✅ 暴露 4 个类构造函数 | 调用方需要 new 辅助类（NodeRenderer / HandlesOverlay / InteractionController），通过 schema 拿到构造函数 |
| `createInstance` | ✅ 入口工厂（new SceneManager）| 提供"开机入口"——调用方先拿 SceneManager，再用 schema 中的辅助类构造函数 new 其他对象 |
| `converters` | undefined | canvas-interaction 不涉及 atom 转换 |
| `commands` | undefined | 当前阶段不引入命令（调用方直接调 SceneManager / InteractionController 方法）|

### 7. 实测验证（已做）

```ts
const canvasInteractionSchema = {
  SceneManager,
  InteractionController,
  NodeRenderer,
  HandlesOverlay,
};

const canvasInteractionCreateInstance = (
  host: HostElement,
  _options: CapabilityOptions,
): CapabilityInstance => {
  return new SceneManager(host as HTMLElement) as CapabilityInstance;
};
```

实测：typecheck exit 0 / lint 全仓 780 (765e+15w) 严格不变 ✅

## 与已有三种形态对比

完成本阶段后，KRIG capability **四种形态全部落地**：

| 形态 | schema | createInstance | 已落地 |
|---|---|---|---|
| 复合型 | ✅ schema(blockRegistry)| ❌ | text-editing |
| 实例工厂型 | ❌ | ✅ 单类工厂 | pdf-rendering / epub-rendering |
| 资源访问型 | ✅ 单例引用聚合 | ❌ | shape-library |
| **混合型** | **✅ 类构造函数聚合** | **✅ 入口工厂** | **canvas-interaction（本阶段）** |

### schema 内容差异

| 形态 | schema 内容 | 调用方使用 |
|---|---|---|
| 资源访问型（shape-library）| 单例引用 `{ shapes, substances }`（已 new 后的实例）| `schema.shapes.get('arrow-block')` |
| **混合型（canvas-interaction）** | **类构造函数 `{ SceneManager, NodeRenderer, ... }`**（class 本身）| `const nr = new schema.NodeRenderer(sm)` |

## 02b-6 之后的 capability 全貌

完成本阶段后：

| capability | 形态 | 来源 plugin |
|---|---|---|
| `text-editing` | 复合型（4/5 字段）| note |
| `pdf-rendering` | 实例工厂型 | ebook |
| `epub-rendering` | 实例工厂型 | ebook |
| `shape-library` | 资源访问型 | graph |
| **`canvas-interaction`** | **混合型** | **graph** |

graph 插件全部 capability 化（library + canvas 两块核心）。

## 02b 系列重要里程碑

完成本阶段后 02b 系列价值：
1. **KRIG capability 四种形态全部落地**——形态分类样板完整
2. **3 个 plugin capability 化**：ebook（全）+ graph（全）+ note（部分）
3. **临时引用模式连续验证 8 次零歧义**
4. **形态选择标准建立**——为波次 3 真搬迁 + 后续新 capability 起草提供完整指引

剩余可选阶段：web-rendering / elk-layout / ai-conversation（需深探查），或直接进波次 3 各插件迁移。

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
| [src/plugins/graph/canvas/scene/SceneManager.ts](../../../../src/plugins/graph/canvas/scene/SceneManager.ts) | capability 引用对象(**不修改**)|
| [src/plugins/graph/canvas/interaction/InteractionController.ts](../../../../src/plugins/graph/canvas/interaction/InteractionController.ts) | capability 引用对象(**不修改**)|
| [src/plugins/graph/canvas/scene/NodeRenderer.ts](../../../../src/plugins/graph/canvas/scene/NodeRenderer.ts) | capability 引用对象(**不修改**)|
| [src/plugins/graph/canvas/scene/HandlesOverlay.ts](../../../../src/plugins/graph/canvas/scene/HandlesOverlay.ts) | capability 引用对象(**不修改**)|
| [src/capabilities/README.md](../../../../src/capabilities/README.md) | J3 修改对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备(含现状探查 + 实测) | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
