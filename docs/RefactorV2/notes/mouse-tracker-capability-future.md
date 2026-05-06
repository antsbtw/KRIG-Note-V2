# 框架级鼠标位置中心 — 未来架构引入候选

> 状态:**未实施**(L5-B3.1 阶段不做,记录在此)
> 提出日期:2026-05-06
> 提出上下文:L5-B3.1 实施 block-handle 时,讨论鼠标监听架构

---

## 1. 背景

L5-B3.1 实施 4 大交互(handle / slash / floating-toolbar / context-menu)期间,讨论"每个交互都自己监听鼠标会不会有问题"。

实际盘点后发现,**只有 block-handle 需要持续 mousemove 跟踪鼠标**,其他交互已有自己的触发机制:

| 交互 | 现有触发机制 | 是否需要 mousemove |
|---|---|---|
| floating-toolbar | 订阅 selection capability(选区变化触发) | ❌ |
| slash menu | PM Plugin 监听 dispatch(`/` 输入时触发) | ❌ |
| context menu | `contextmenu` 事件(右键触发) | ❌ |
| handle menu(点击 ⋮⋮ 后) | `click` 事件 | ❌ |
| 关菜单 | `mousedown` 全局(只为关闭,不为定位) | ❌ |
| **block-handle** | **mousemove 跟踪鼠标位置** | **✅** |

所以 L5-B3.1 决定:**只 block-handle 监听 mousemove**,不抽框架级鼠标中心。

---

## 2. 当前 block-handle 实施(L5-B3.1)

`src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts`:
- 监听 `editorView.dom` 的 mousemove + mouseleave
- 用 `posAtCoords` 解析悬停 block,定位 handle
- handle 用 opacity 控显隐 + isHovered 标志位 + 100/300ms 延迟 hide(对齐 V1)

**已知妥协**:
- 鼠标过渡到 handle 上的可靠性依赖 `mouseenter` 时序 + 延迟 hide,**边缘情况下可能 handle 被提前 hide**
- 鼠标必须在 view.dom 矩形内 mousemove 才触发,handle 视觉位置必须严格在 view.dom 内 padding 区(left padding ≥ handle 宽度)
- 多 EditorView 实例时,各自独立监听器,无协调

---

## 3. 未来候选方案 — `mouse-tracker` capability

### 3.1 触发条件

引入这个 capability 的触发条件(任意一条满足即应实施):

1. **第 2 个高频鼠标交互**出现 — 例如:
   - 行内 link mark 的 hover tooltip(显示 URL 预览 + 编辑/打开 按钮)
   - inline-math 渲染的 hover 编辑触发
   - block 边缘的 "+" 按钮(快速插入新 block)
   - 任何"鼠标靠近 X 时显出 Y"模式

2. **block-handle 可靠性问题反复**(用户报告 ≥3 次 handle 消失/不响应)

3. **用户体验诉求** — block-handle 改用"全局/SlotArea mousemove + 距离判定",不再依赖 view.dom 边界

### 3.2 设计草案

**目标**:框架级集中处理鼠标位置上下文,各交互订阅而非各自监听。

```ts
// src/capabilities/mouse-tracker/index.ts

export interface MouseContextPayload {
  /** 屏幕坐标 */
  x: number;
  y: number;
  /** 命中的 driver 实例 id(若鼠标在编辑区内)*/
  instanceId: string | null;
  /** 命中的 block 信息(若鼠标在编辑区内)*/
  block?: {
    pos: number;
    type: string;
    rect: DOMRect;
    distanceToBlockLeft: number;  // 给 block-handle 用 — 距 block 左侧多远
  };
  /** 命中的 view-id */
  viewId: string | null;
}

class MouseTrackerCapability {
  readonly id = 'mouse-tracker';
  emit(payload: MouseContextPayload): void;
  subscribe(listener: (p: MouseContextPayload) => void): () => void;
  api = {
    getCurrent(): MouseContextPayload | null;
  };
}
```

**rules**(类似 selection capability):
- driver 是 source — driver 监听自己 view.dom mousemove,emit 到 capability
- 各交互订阅 capability 的 channel
- 框架统一节流(rAF 60fps)
- block-handle 改成 capability subscriber

### 3.3 监听位置选项

讨论时列过的 3 种:

| 方案 | 监听 DOM | 性能 | 何时合适 |
|---|---|---|---|
| 当前 — view.dom | `editorView.dom` | 最低(只在编辑区跑) | 单一 block-handle 场景 |
| 中间 — SlotArea | `.krig-slot-area` | 中(鼠标在 SlotArea 内才跑;NavSide / Toolbar 不跑) | block-handle 不可靠时升级 |
| 最大 — document | `document` | 最高(全屏跑;但浏览器自身节流) | 真有跨 SlotArea 鼠标交互时 |

未来抽 capability 时,默认走 **SlotArea 监听**(性能/架构平衡)。

### 3.4 实施评估(未来真做时填)

- 工作量估算:~300 行(capability + driver source + 改 block-handle 订阅)
- 协议层级:capability/mouse-tracker — 跟 selection 平级
- 设计文档前置:本文档 → 写新 design.md → 拍板 → 实施

---

## 4. 不做的理由(L5-B3.1)

记录当时(2026-05-06)讨论结论:

1. **当前业务能跑** — block-handle 已对齐 V1 实施,验证可用
2. **抽框架是 capability 协议级改动**,L5-B3.1 范围超太多
3. **现状只有 1 个高频鼠标监听**(block-handle),不必为 1 个抽框架
4. **memory 不该堆"未来可能做"**,这种长期候选放独立文档

---

## 5. 修订记录

| 日期 | 内容 |
|---|---|
| 2026-05-06 | 初稿;L5-B3.1 实施时讨论后写下 |
