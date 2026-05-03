# 阶段 03-1-1：graph.canvas ViewDefinition 骨架（波次 3.1 第一子阶段）

> **状态**：待执行
> **目标分支**：`refactor/graph-view-definition-skeleton`(已由 Commander 从 main 切出)
> **类型**：基础设施类阶段(新建 ViewDefinition 声明文件,不动现有视图代码)
> **功能契约**：N/A
> **派活基线 SHA**：`7070566e`(main HEAD,含 02b-6 存档)

---

## 阶段目标

继 02b-1~02b-6 (5 个 capability 全部样板齐备)之后,**首次落地 ViewDefinition 文件**——KRIG 视图层契约首次写入 plugin。

**核心命题**:graph.canvas 视图首次以 ViewDefinition 形式声明 install 列表(`capability.canvas-interaction` + `capability.shape-library`),为后续 3.1.2 (CanvasView 移动) + 3.1.3 (Step B 真搬迁) 奠定基础。

> **重要范围限定**:本阶段是完整 Step A 的**第一个子阶段**(共 4 个),按"看到 X 不动 X"原则只新建 ViewDefinition 文件,不动现有 `plugins/graph/canvas/` 任何代码。

按总纲 § 5.4 数据契约 + § 5.8 视图是声明 + § 2.2 Step A 行为保持迁移。

## 阶段产出(按 task-card 完成判据 J1~J5 验证)

1. **J1** 新建 `src/plugins/graph/views/canvas/index.ts`(graphCanvasView ViewDefinition 声明,含 viewId + install 2 字段)
2. **J2** 新建 `src/plugins/graph/views/canvas/README.md`(说明 3.1.1 子阶段范围 + 为什么不含 contextMenu/toolbar)
3. **J3** 新建 `src/plugins/graph/views/README.md`(说明 plugins/<X>/views/ 新目录约定 + 后续子阶段路径图)
4. **J4** 范围对账(双点 diff + 显式基线 SHA `7070566e`,含且仅含 3 文件)
5. **J5** typecheck=0 / lint exit 1 errors=766 warnings=15 严格不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测(按 § 六纪律 1+2+4)

### 1. ViewDefinition 接口已存在(已读)

```ts
// src/shared/ui-primitives.ts:15-24
export interface ViewDefinition {
  viewId: string;                  // e.g. 'note.editor' / 'graph.family-tree'
  install?: CapabilityId[];        // 安装的能力列表
  contextMenu?: ContextMenuItem[];
  toolbar?: ToolbarItem[];
  slash?: SlashItem[];
  handle?: HandleItem[];
  floatingToolbar?: FloatingToolbarItem[];
}
```

→ 接口已落(波次 1 阶段 01-contracts),本阶段直接 import 使用。

### 2. graph 插件视图入口探查(已读)

```
src/plugins/graph/
├─ renderer.tsx               # graph view 入口(挂 #root)
├─ canvas/
│  ├─ CanvasView.tsx          # 1147 行,纯 React + 内部 import(无外部 npm 重依赖)
│  ├─ scene/                  # Three.js 重灾区(02b-6 临时引用对象)
│  ├─ interaction/            # 02b-6 临时引用对象
│  ├─ ui/                     # 6 文件,纯 React 组件(Toolbar/ContextMenu/Inspector 等)
│  ├─ edit/                   # ⚠️ GraphEditor.ts 直接 import prosemirror-* (Step B 处理)
│  └─ persist/                # serialize/deserialize 无外部依赖
├─ library/
│  ├─ shapes/                 # 02b-5 capability.shape-library 引用对象
│  └─ substances/             # 02b-5 capability.shape-library 引用对象
├─ navside/
└─ main/
```

### 3. CanvasView.tsx 视图层合规性(已 grep)

```bash
$ grep "^import" src/plugins/graph/canvas/CanvasView.tsx | grep -v "from '\.\." | grep -v "from '\./"
import { useEffect, useRef, useState, useCallback } from 'react';
```

→ **CanvasView.tsx 仅 import React,无 three / prosemirror 等外部依赖**(02b-6 已通过临时引用 capability.canvas-interaction 解耦)。

### 4. graph 视图 install 列表决策(已读 § 5.9 + 当前 capability 状态)

| Capability | 来源 | 是否 install |
|---|---|---|
| `capability.canvas-interaction` | 02b-6 已落 | ✅ 必须(Three.js 渲染) |
| `capability.shape-library` | 02b-5 已落 | ✅ 必须(Shape + Substance 资源) |
| `capability.text-editing` | 02b-1~2c 已落 | ❌ 暂不(节点 label 编辑现由 edit/GraphEditor 直接 import prosemirror,Step B 才搬入) |
| `capability.elk-layout` | 未落地(02b-7 探查证伪) | ❌ 不 install |

→ **本阶段 install 仅 2 个 capability**(canvas-interaction + shape-library)。

### 5. ContextMenu/Toolbar 静态声明可行性探查(已读)

```ts
// CanvasView.tsx:680-687 现状
function buildSelectionContextMenu(
  ids: string[],
  onCombine: () => void,
  onDelete: () => void,
  // ... 5 个回调
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  // 动态 push 项,带 render: (close) => <ShapeFillMenuItem .../> React 组件注入
}
```

→ 现有 contextMenu/toolbar **是动态生成 + render 注入 React 组件** ≠ § 5.4 静态声明 + `command: string`。

→ **本阶段 ViewDefinition 不声明 contextMenu/toolbar**(留 Step B 做命令分离重构)。

### 6. ViewDefinitionRegistry runtime 现状(已 grep)

```bash
$ grep -rn "ViewDefinition\|install" src/main/ src/renderer/ src/shared/ --include="*.ts" | grep -v "interface\|type "
src/shared/ui-primitives.ts:17:  install?: CapabilityId[];
```

→ **runtime 无 ViewDefinitionRegistry**——本阶段 ViewDefinition 是"声明孤岛"(no consumer)。

→ 这是预期状态,§ 5.3 注册时机要等 02b-7+ 平台基建落地才能"通电"。

### 7. 实测验证(已做)

```ts
// 实测内容(已删除测试文件,工作树干净):
// src/plugins/graph/views/canvas/index.ts
import type { ViewDefinition } from '@shared/ui-primitives';

export const graphCanvasView: ViewDefinition = {
  viewId: 'graph.canvas',
  install: [
    'capability.canvas-interaction',
    'capability.shape-library',
  ],
};
```

实测结果:
- ✅ typecheck exit 0
- ✅ lint:dirs exit 0
- ✅ lint errors 数不变(766,与 main baseline 严格相等)
- ✅ lint warnings 数不变(15)

## 与已有阶段对比

| 阶段类型 | 阶段 | 产出 | 风险 |
|---|---|---|---|
| Capability 骨架 | 02b-1~02b-6 | `src/capabilities/<x>/` | 低(临时引用 plugin) |
| **ViewDefinition 骨架** | **03-1-1(本阶段)** | **`src/plugins/graph/views/canvas/index.ts`** | **极低(纯新建,不动现有视图)** |
| 视图代码搬移 | 03-1-2(下一子阶段) | `plugins/graph/canvas/CanvasView.tsx` → `plugins/graph/views/canvas/` | 中(大量 import 路径调整) |
| Step B 真搬迁 | 03-1-3+(后续) | scene/ + interaction/ → `src/capabilities/canvas-interaction/` 内 | 高 |

## 03-1 全貌(完整 Step A 4 子阶段路径图)

| 子阶段 | 任务 | 状态 |
|---|---|---|
| **03-1-1** | **ViewDefinition 骨架(本阶段)** | **⏳ 待执行** |
| 03-1-2 | CanvasView + ui/ 移动到 views/canvas/ | ⏸️ 后续 |
| 03-1-3 | edit/GraphEditor.ts 违规处理(决策合并 vs 子 capability) | ⏸️ 后续 |
| 03-1-4 | 探查 scene/interaction/persist 是否已被 capability 化 | ⏸️ 后续 |

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览(本文件) | 全员参考 |
| [task-card.md](task-card.md) | 任务卡:J1~J5 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令 | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令 | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 + § 5.8 + § 2.2 | 全员必读 |
| [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) ViewDefinition 接口 | 引用 |
| [src/plugins/graph/canvas/CanvasView.tsx](../../../../src/plugins/graph/canvas/CanvasView.tsx) | **不修改**(本阶段不动现有视图) |
| [src/capabilities/canvas-interaction/](../../../../src/capabilities/canvas-interaction/) | install 引用对象(02b-6 已落) |
| [src/capabilities/shape-library/](../../../../src/capabilities/shape-library/) | install 引用对象(02b-5 已落) |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备(含现状探查 + 实测) | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
