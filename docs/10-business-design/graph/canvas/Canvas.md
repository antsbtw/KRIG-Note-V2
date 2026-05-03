# Canvas — 自由创作 view + Substance 创作服务

KRIG Graph 体系的**创作工具**。两个角色:
1. 作为**独立 view**:用户从 NavSide 打开 Canvas note,自由创作
2. 作为**系统级 Substance 创作服务**:其他 view 调用 Canvas API,在 right-slot 创作 substance

## 0. 核心定位

### 0.1 在 Graph 体系中

```
┌─────────────────────────────────────────────────────┐
│ Library(资源仓库)                                  │
│   Shape + Substance,全系统共享                      │
└─────────────────────────────────────────────────────┘
        ↑                            ↑
        │ 创建 Substance              │ 调用资源
        │                            │
┌──────────────────┐         ┌────────────────────────┐
│ Canvas(本 spec)  │         │ Variant 视图           │
│  独立 view       │         │  family-tree           │
│  + 创作服务      │         │  knowledge / mindmap   │
└──────────────────┘         └────────────────────────┘
```

### 0.2 Canvas 是什么

**Canvas 是一个 view + 一个服务**:

#### 角色 A:独立 view(用户主动打开)
- NavSide "+ 新建画板" → 创建一个 Canvas note → 打开 Canvas
- 用户在画板上**自由创作**:拖入 shape、移动、改属性、组合成 substance
- 画板内容存进 note(用户可以再次打开)

#### 角色 B:系统级 Substance 创作服务(其他 view 调用)
- variant view(如 family-tree)需要新 substance 时,调 Canvas API
- Canvas 在 right-slot 打开,用户创作完后回调结果给调用者
- 类似 macOS 的颜色选择器:任何 view 需要颜色就调用,不自己实现

### 0.3 Canvas 不创建 view 类型

Canvas 是 **Graph view 的 variant**(类比 family-tree 也是 Graph 的 variant):

```
KRIG views:
└── Graph
      ├── variant: canvas      ← 本 spec(自由创作)
      ├── variant: family-tree (族谱)
      ├── variant: knowledge   (后续)
      └── ...
```

Canvas variant 与 family-tree variant 平级,共享 Library 资源。

## 1. 设计原则

1. **Canvas 是创作工具,不是浏览工具** — 用户在 Canvas 里"创造内容",Library 是资源池
2. **可见 + 可操作 + 可编辑** — 用户能直接在 Canvas 上看到、操作、修改一切
3. **对齐 PowerPoint 操作模型** — 选中 / 拖动 / 编辑属性 / 组合等核心操作用户已熟悉
4. **Canvas 内容存为 note** — 不引入新存储类型,note 系统统一
5. **自洽**:Canvas 不依赖任何 variant,自己能完整运转(其他 variant 能用 Canvas)
6. **可被调用**:对外提供 API,让其他 view 把自己嵌入(创建 substance 等场景)

## 2. v1 范围

### 2.1 用户操作清单

v1 必备的 Canvas 操作(里程碑 1 验收清单):

| # | 操作 | 期望结果 |
|---|---|---|
| 1 | NavSide "+ 画板" | 创建 Canvas note,自动打开 |
| 2 | 浏览 Library Picker | 看到 22 个内置 shape(basic 11 / arrow 3 / flowchart 4 / line 3 / text 1)+ 5 个内置 substance(library 2 / family 3) |
| 3 | 点 toolbar `+ 添加` → Picker 选 shape → 画布点击 | 在点击位置实例化一个 shape 节点(中心对齐鼠标),自动选中 |
| 4 | 点 toolbar `+ 添加` → Picker 选 substance → 画布点击 | 实例化一个 substance(组合 shape) |
| 5 | 单击节点 | 节点显示**蓝色矩形选中边框 + 8 resize handles + 1 rotation handle**;**Inspector 不自动打开**(双击才打开,见 §3.4) |
| 6 | 双击节点 → Inspector 改 fill / line / size | 节点视觉立刻更新 |
| 7 | 拖动节点 | 节点跟随鼠标,光标变 grab/grabbing,所连接的 line 自动跟随 |
| 8 | 选中节点按 Delete | 节点删除(连接的 line 也删除) |
| 9 | 鼠标滚轮 | 画板缩放(以光标为中心 zoom-to-cursor) |
| 10 | 拖动空白区域 | 画板平移(zoom 不变) |
| 11 | 关闭 Canvas → 重新打开 | 内容完整恢复(view 也恢复 — schema_version=2 后) |
| 12 | **多选(Shift-click)** → toolbar inline `⊟ Combine` → 弹对话框 | 创建新 substance 存进 Library,原 shape 替换为新 substance 实例 |
| 13 | 选中 substance 实例 → 右键 / 工具 → "Edit Substance" | 调用 Canvas API 在 right-slot 打开,编辑该 substance 定义(M1.6) |
| 14 | shape 移动时,引用它的 line 端点跟随 magnet 自动吸附 | line 端点保持在 magnet 位置,跟随移动 |
| 15 | 从 Picker 选 line shape → 鼠标在某 magnet 内 mousedown → 拖到另一 shape 的 magnet → mouseup | 创建带 endpoints 的 line,两端绑 magnet;落空(没命中 magnet)则取消(不创建悬空 line) |
| 16 | 选中已有 line → 拖某一端的端点 handle → 拖到另一 magnet → mouseup | line 该端 endpoint 重新绑到新 magnet(rewire);落空则恢复原 magnet |
| 17 | 旋转两端任一 shape | line 端点跟随旋转后的 magnet 位置(M1.x.5 已实现) |

完成所有 17 项才算 v1 通过。

### 2.2 v1 不做(留 v1.5+)

| 功能 | 留待 |
|---|---|
| 框选(drag-select) | v1.1 |
| 复制粘贴(Cmd+C/V) | v1.1 |
| line 选中视觉高亮(line 自身加粗 / 变色) | v1.1 |
| line 路径中段编辑(elbow 中段拖动 / curved 控制点编辑) | v1.1 |
| 对齐辅助线 / 吸附网格 | v1.2 |
| 分组 / 解组(超过单层 substance 嵌套) | v1.2 |
| 层级管理(置顶 / 置底 / 上一层 / 下一层) | v1.2 |
| 自由路径(钢笔工具 / 自由墨迹) | v1.3 |
| Shape gradient / pattern fill | v1.3 |
| Line sketched style / compound type | v1.3 |
| 格式刷(复制格式) | v1.4 |
| Change Shape(右键替换) | v1.4 |
| 协同 / 多人编辑(Yjs CRDT) | v2+ |

## 3. UI 设计

### 3.1 总体布局

风格参考 **macOS Freeform**,与 NoteView toolbar 一致:**顶部一条横向窄工具栏 + 主画布(全屏铺底) + 浮动 Inspector 面板(浮在画布右上,可拖动/可关闭)**。**不**采用左右固定侧栏。

```
┌──────────────────────────────────────────────────────────────────┐
│ ‹ ›  画板标题      [□][○][△] [↗][⤴] | [🔍][↔] [+ 新建] [×]      │ ← Toolbar(36px)
├──────────────────────────────────────────────────────────────────┤
│                                                  ┌─────────────┐ │
│                                                  │ Inspector   │ │
│                                                  │ (浮动浮层)  │ │
│                                                  │ ─────────── │ │
│                Canvas (Three.js,全屏)           │ Position    │ │
│                                                  │ Fill        │ │
│                                                  │ Line        │ │
│                                                  │ ...         │ │
│                                                  └─────────────┘ │
│                                                                  │
│  ┌──────────────────┐                                            │
│  │ Shape/Substance  │  ← 浮动 Library Picker                     │
│  │ Picker(浮层,可  │     (从 toolbar "+" 触发,选完即收)         │
│  │ 折叠)           │                                             │
│  └──────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
```

- **顶部 Toolbar**:横向窄条(高 36px,与 NoteView toolbar 对齐),放高频动作按钮
- **主 Canvas**:Three.js 画布,全屏铺底(无侧栏挤压)
- **Inspector**:浮动浮层,选中节点时浮在画布右上;可拖动 / 可关闭(再点选中节点重开)
- **Library Picker**:浮动浮层,从 toolbar "+" 按钮触发,选完即收(不常驻占位)

### 3.2 Toolbar(顶部)

横向窄条,字段对齐 NoteView toolbar 的视觉规范(36px 高 / 12px padding / 4px gap / `#252525` 背景 / 1px `#333` 下边框)。

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹  ›   画板标题       [+ Shape] [◇ Substance] | [↶][↷] | [🔍 100%] [↔] │
│                                                       [+ 新建] [Open] [×]│
└──────────────────────────────────────────────────────────────────────────┘
   后退/   标题            创作工具          历史    缩放/适配  通用
   前进                   (浮 Picker)
```

按钮分组(从左到右):
- **导航**:`‹` 后退 / `›` 前进(沿用 NoteView 规范,⌘[ / ⌘])
- **标题**:当前画板名(点击可改名)
- **创作**:**`+ 添加`** 单一图标按钮(SVG 矩形 + 圆形叠加,语义"形状",
  对齐 Apple Pages 工具栏视觉),点击弹出浮动 Picker(见 §3.3)
  - **UX 决策**:不向用户暴露 Shape vs Substance 内部架构区分(那是工程
    内部"原子 vs 分子"概念,用户不需要理解)。Picker 内左栏分类列表
    Shape / Substance 类目平铺,用户当作"分类"消费即可。
  - 内部 PickerItem.section 仍保留 'shape' | 'substance',决定 onPick 时
    spec.kind(NodeRenderer 渲染分支需要)
- **撤销/重做**:M1 不做,**toolbar 不显示占位按钮**(灰色按钮反而困惑
  用户)— v1.x 真做时再加回来
- **视图**:`🔍 100%` 缩放滑块 / `↔` Fit to content
- **通用**:`+ 新建` / `Open`(打开其他画板)/ `🔄` SlotToggle / `×` 关闭面板

> 多选状态下,在 toolbar 右侧 inline 出现 `[⊟ Combine to Substance]` 临时按钮(仅多选时显示,取消选中即消失),不占常驻位置。

### 3.3 Library Picker(浮动浮层)

参考 **macOS Freeform shape picker**:**双栏 popover**(左侧分类列表 + 右侧 shape 网格),顶部搜索框 + 自定义入口。从 toolbar `+ 添加` 按钮下方弹出,选完即收(不常驻)。

```
                   ▲ (anchor 三角指向 toolbar 按钮)
┌────────────────────────────────────────────────────┐
│ ┌──────────────────────────┐  ┌─────────────────┐ │
│ │ 🔍 Search                │  │ ✎ (自定义画笔)  │ │
│ └──────────────────────────┘  └─────────────────┘ │
├──────────────┬─────────────────────────────────────┤
│ ▸ Basic      │   ╱      ↗      ⌒                  │  ← 分类高亮:基础 shape
│   Arrow      │                                     │
│   Flowchart  │   □     ▢     ●                    │  ← 网格,每行 3
│   Line       │                                     │
│   Text       │   △     ◣     ➜                    │
│ ─────────    │                                     │
│   Library    │   ↔     ◆     💬                    │
│   Family     │                                     │
│   User       │   ▢     ⬠     ★                    │
│              │                                     │
└──────────────┴─────────────────────────────────────┘
   左:分类             右:该分类下的所有 shape / substance(点击即放置)
```

布局规范:
- **整体**:popover 浮层,圆角 + 半透模糊背景(对齐 macOS 视觉),顶端 anchor 三角指向触发按钮
- **顶部条**:全宽搜索框(`🔍 Search`)+ 右上角自定义入口(`✎`,v1.5+,跳到 Canvas 创作新 shape)
- **左栏**(~160px):分类垂直列表,当前分类高亮(对齐 Freeform 的青色高亮)
  - Shape 区:Basic / Arrow / Flowchart / Line / Text
  - 分隔线
  - Substance 区:Library / Family / User(用户自创)
- **右栏**:当前选中分类下的 shape / substance 网格,**每行 3 个**,纯色 icon(`#4A90E2` 蓝)+ shape 缩略
- **入口**:toolbar `+ 添加` 单一按钮触发 popover,默认高亮 Basic 分类(用户在
  左栏自由切到任何分类)

操作:
- 点击 toolbar `+ 添加` → popover 弹出
- 左栏切分类 → 右栏立即更新
- 顶部 Search → 跨所有分类模糊搜索
- 点击右栏的具体 shape / substance → popover 关闭,光标进入"添加模式"
- 在画布点击位置 → 实例化
- ESC / 点击 popover 外区域 → 关闭(若已选 shape 仍处于添加模式,再 ESC 才取消)

### 3.4 Inspector(浮动浮层)

参考 PowerPoint 的 Format Shape 面板,**以浮动浮层形式呈现**(不是固定右侧栏),v1 简化字段。

**触发规则(M1.x UX 决策)**:
- **默认隐藏** — Inspector 是"高级编辑"工具,不是"选中即弹"的弹窗。单击节点
  只显示选中边框(见 §3.5),不打开 Inspector(避免遮挡画板)
- **双击节点** → 打开 Inspector 浮层
- 一旦打开,Inspector 跟随当前选中节点切换显示属性;点击 Inspector header 上
  的 `×` 按钮关闭 Inspector
- **Inspector 关闭状态对其他选中操作无影响**(选中边框始终显示)

字段:

```
┌──────────────────────┐
│ Format Shape         │
├──────────────────────┤
│ Tab: Shape | Text    │   (v1 只 Shape tab)
├──────────────────────┤
│ ▼ Position           │
│   X: [120]           │
│   Y: [80]            │
│   W: [160]           │
│   H: [60]            │
├──────────────────────┤
│ ▼ Fill               │
│   ○ No fill          │
│   ● Solid            │
│   Color: [■ #4A90E2] │
│   Transparency: [0%] │
├──────────────────────┤
│ ▼ Line               │
│   ○ No line          │
│   ● Solid            │
│   Color: [■ #2E5C8A] │
│   Width: [1.5 pt]    │
│   Dash: [───────  ▾] │
├──────────────────────┤
│ ▼ Arrow (line only)  │
│   Begin: [None  ▾]   │
│   End:   [Arrow ▾]   │
├──────────────────────┤
│ ▼ Substance Override │
│   (只在 substance     │
│    实例上显示)       │
│   label: [...]       │
│   gender: [M ▾]      │
│   ...                │
└──────────────────────┘
```

字段对齐 PowerPoint Format Shape(详见 [Library.md §2.1 default_style](../library/Library.md#2.1-数据格式))。

### 3.5 选中态(选中边框 / Resize handles / Rotation)

对齐 **macOS Freeform** 选中态视觉。M1.x 系列已完整实现。

**视觉**:

```
   ╭─────● (rotate handle,绿色)
   │
○──○──○──○   ← 8 个 resize handle(白色圆点,边框蓝)
│           │
○           ○
│           │
○──○──○──○
```

**M1.x.2 / M1.x.3 实现**:
- 单击节点 → 显示**蓝色矩形选中边框**(LineLoop,1px)+ **8 个 resize handle** +
  **1 个 rotation handle**(顶部上方绿色圆点)
- 4 角 handle(NW/NE/SE/SW)→ 等比缩放(沿对角线方向投影,自动锁定纵横比)
- 4 边中点 handle(N/S/E/W)→ 单边缩放(只改 W 或 H)
- rotation handle → 拖动旋转节点;Shift 按住 → 吸附到 15° 倍数
- handle 像素恒定:HandlesOverlay 用 group.scale = (1/zoom, 1/zoom, 1) 实现
- handle hit-test 优先级高于 shape 本体(避免抢"拖动 shape"的命中)
- handle / cursor 跟随节点 rotation 自动选最合适方位(ew-resize / nwse-resize 等)

**M1.x.4 OBB hit-test**:
- 旋转节点的 hit-test 走 OBB(world 点逆变换到节点本地坐标系再 AABB),
  而非简单 AABB,旋转后能精确选中

**M1.x.1 旋转模型**:
- Instance 加 `rotation` 字段(度数,顺时针)
- NodeRenderer 用 outer/inner 嵌套实现 bbox 中心旋转:outer.position = bbox 中心,
  outer.rotation.z = degrees;inner = 原 mesh group,offset 到 -size/2

**多选**:
- Shift-click 多选 → 每个选中节点显示边框,但**不显**统一的 resize / rotation handle
  (M1 范围限制,v1.2 加多选变换)

**Line 选中**(M1.x.7):
- line 实例只有 endpoints,没有 size / rotation,所以选中时**不显** 8 resize 和
  rotation handle,改显示**两个端点 handle**(深蓝色小圆,半径 6)
- 拖端点 handle = rewire(改连接;详见 §3.5b)
- line 的 selection border 也不显矩形(它的 bbox 是端点 AABB,框矩形没意义)

### 3.5b Line 交互(创建 / rewire)

line 实例与 shape / substance 不同,**没有 size / rotation 语义**,
只有 endpoints(两端各绑一个 magnet)。所以选中态视觉、交互都不一样。

#### 创建 line(M1.x.7,已实现)

press-drag-release 风格:

1. 用户在 Picker 选 line 类 shape(`krig.line.straight` / `.elbow` / `.curved`)
   → 进入 addMode(光标变 crosshair)
2. **mousedown 必须在某 shape 的 magnet 16px 半径内才起手**;
   未命中则取消 addMode(不创建悬空 line)
3. mousemove:预览 line 跟随鼠标,终点会吸附到附近 magnet
4. mouseup:
   - 落点在 magnet 内 → 创建带 `endpoints: [{instance, magnet}, ...]` 的 Instance
   - 落空 → 取消(不创建)

视觉辅助:
- addMode 起手前,hover 命中 shape 显示该 shape 的 magnet 蓝点
- 画线中,所有候选 shape(除起点 instance 外)都显示 magnet 蓝点

#### Rewire(改连端点,M1.x.7 待补)

选中一条已有 line 时,显示 2 个端点 handle(line 起点 / 终点处的小蓝圆),
**不显**常规 8 resize handle 和 rotation handle(line 没有这些语义)。

- mousedown 在某端点 handle → 进入 rewiring 状态
  - 起点固定为 line 另一端的 magnet 世界坐标
  - 拖动鼠标:更新 line 几何,跟随鼠标 / 吸附附近 magnet
- mouseup:
  - 落点在 magnet 内(且不是 line 自身的另一端 instance)→ 改写 `endpoints[i]`
  - 落空 → 还原原 magnet(不允许 rewire 出悬空 line)
- ESC 取消 rewire(还原原状态)

实现要点:
- rewire 复用 magnet hint overlay(画线中的视觉)
- rewire 不创建预览 line,**直接改原 line 的几何**(updateLineGeometry);
  失败时 mouseup 还原(用 startEndpoints 快照恢复)
- selection border 不显矩形(line 的 bbox 是端点 AABB,框矩形没意义)

### 3.6 多选 + Combine to Substance 流程

```
1. 用户 Shift-click 选中 3 个 shape(rect + line + label)
   ↓
2. Toolbar 右侧 inline 出现 "[⊟ Combine to Substance]" 临时按钮
   ↓
3. 用户点击,弹出对话框:
   ┌─────────────────────────────────┐
   │ Create Substance                │
   ├─────────────────────────────────┤
   │ Name:        [Family Person   ] │
   │ Category:    [family          ] │
   │ Description: [Person in family] │
   │                                 │
   │       [Cancel]   [Create]       │
   └─────────────────────────────────┘
   ↓
4. 点 Create → 系统:
   a. 创建 SubstanceDef JSON(详见 Library §3.1)
   b. 计算 components 的相对位置(以选中 shape 的 bounding box 中心为锚)
   c. 写入 Library(存为 ~/Library/Substances/{id} 这篇 note)
   d. 在 Library Picker 的 Substances → User 分类下显示
   e. 画布上原 3 个 shape 替换为一个 substance 实例
```

### 3.7 Edit Substance 流程

```
1. 用户选中 substance 实例,右键 → "Edit Substance"
   ↓
2. Canvas 调用自身 API 在 right-slot 打开新 Canvas
   ↓
3. right-slot Canvas 加载该 substance 的 components 作为画布内容
   (substance 的 JSON 反序列化为画布上的 shape)
   ↓
4. 用户编辑 → 保存
   ↓
5. 系统:
   a. 重新生成 SubstanceDef JSON
   b. 写入 Library(覆盖原 note)
   c. 通知所有引用该 substance 的实例自动重渲染
```

## 4. Canvas 数据模型

### 4.1 Canvas note 内容

一篇 Canvas note 的 block 内容是一段 JSON,描述画板状态:

```jsonc
{
  "schema_version": 1,
  "viewBox": { "x": 0, "y": 0, "w": 1920, "h": 1080 },   // 画布缩放/平移状态
  "instances": [                                          // 节点实例
    {
      "id": "i-001",
      "type": "shape",                  // shape | substance
      "ref": "krig.basic.roundRect",    // 引用 Library 资源
      "position": { "x": 120, "y": 80 },
      "size": { "w": 160, "h": 60 },
      "params": { "r": 0.15 },          // 用户调整的参数
      "style_overrides": {              // 覆盖默认样式
        "fill": { "color": "#a8c7e8" }
      },
      "props": {                        // substance 实例的业务属性
        "label": "贾宝玉",
        "gender": "M"
      }
    },
    {
      "id": "i-002",
      "type": "shape",
      "ref": "krig.line.elbow",
      "endpoints": [                    // line 类型有 endpoints 而非 position
        { "instance": "i-001", "magnet": "S" },     // 连到 i-001 的 South magnet
        { "instance": "i-003", "magnet": "N" }
      ],
      "style_overrides": { ... }
    }
  ]
}
```

### 4.2 frontmatter 标识

```yaml
---
title: 我的画板
view: graph
variant: canvas
---
```

NavSide 通过 `variant: canvas` 识别,用画板图标显示。

## 5. Canvas 调用 API(被其他 view 使用)

### 5.1 用例:family-tree 创建新 substance

```ts
// 在 family-tree variant 中
import { canvasAPI } from '@/plugins/graph/canvas/api';

async function createNewPersonSubstance() {
  const result = await canvasAPI.openInRightSlotForSubstanceCreation({
    title: '创建新人物 Substance',
    suggestedCategory: 'family',
    initialShapes: [],   // 可选:预填 shape
    onComplete: (substanceId) => {
      // 用户创作完成,新 substance 已存进 Library
      console.log('新 substance 创建:', substanceId);
    },
    onCancel: () => {
      console.log('用户取消');
    },
  });
}
```

### 5.2 用例:family-tree 编辑现有 substance

```ts
async function editExistingSubstance(substanceId: string) {
  await canvasAPI.openInRightSlotForSubstanceEdit({
    substanceId,
    onSave: (updatedDef) => { /* 更新已生效 */ },
    onCancel: () => { /* 用户取消 */ },
  });
}
```

### 5.3 API 设计原则

- **非阻塞**:Canvas 在 right-slot 打开,调用方不等待(用户可同时看 family-tree 和 Canvas)
- **回调通知**:通过 callback / Promise 通知调用方结果
- **状态隔离**:right-slot 的 Canvas 与主 Canvas 完全独立,不互相影响

## 6. 模块结构

对齐 §3 的 Freeform UI:**顶部 Toolbar 横条 + 全屏 Canvas + 浮动 LibraryPicker + 浮动 Inspector**。

```
src/plugins/graph/canvas/
├── CanvasView.tsx               # 主组件:Toolbar 条 + 全屏 Canvas + 浮动 LibraryPicker + 浮动 Inspector
├── scene/
│   ├── SceneManager.ts          # Three.js scene + camera + RAF + 坐标系
│   ├── pan-zoom.ts              # 画布平移 / 缩放
│   └── render.ts                # 节点 / line 渲染管线
├── interaction/
│   ├── InteractionController.ts # 鼠标事件 / 选中 / 拖动 / 删除
│   ├── magnet-snap.ts           # line 端点吸附 magnet
│   └── add-mode.ts              # "添加模式"逻辑(点击工具后再点画布)
├── ui/
│   ├── Toolbar/
│   │   └── Toolbar.tsx          # 顶部 36px 横条(导航/标题/+Shape/◇Substance/历史/缩放/通用)
│   ├── LibraryPicker/           # 从 toolbar 弹出的浮层(Freeform 风格双栏 popover)
│   │   ├── LibraryPicker.tsx    # popover 容器 + anchor 三角 + 关闭逻辑
│   │   ├── CategoryList.tsx     # 左栏分类列表(Shape 区 + 分隔 + Substance 区)
│   │   ├── ItemGrid.tsx         # 右栏 3-col 网格(shape/substance 缩略)
│   │   └── SearchBox.tsx        # 顶部全宽搜索(跨分类模糊匹配)
│   ├── Inspector/
│   │   ├── FloatingInspector.tsx   # 浮动浮层容器(可拖动 / 可关闭 / 默认右上)
│   │   ├── PositionPanel.tsx    # X/Y/W/H 编辑
│   │   ├── FillPanel.tsx        # Fill 编辑
│   │   ├── LinePanel.tsx        # Line 编辑
│   │   ├── ArrowPanel.tsx       # Arrow 编辑
│   │   └── SubstancePropsPanel.tsx  # substance 实例的 props 编辑
│   └── dialogs/
│       └── CreateSubstanceDialog.tsx  # 命名对话框
├── persist/
│   ├── serialize.ts             # 画布状态 → JSON
│   ├── deserialize.ts           # JSON → 画布状态
│   └── note-binding.ts          # Canvas note 加载 / 保存
├── api/
│   ├── canvas-api.ts            # 公开 API(被其他 view 调用)
│   └── right-slot-mount.ts      # right-slot 挂载逻辑
├── register.ts                  # 注册为 Graph variant
└── index.ts
```

## 7. v1 实施分阶段(里程碑 1)

### 7.0 总体策略

- **分支**:`feature/graph-canvas-m1`(从 main 切出)。按 CLAUDE.md "分支按模块切" 原则,M1.1~M1.6 子任务在分支内连续 commit,**不中途合 main**,M1 全验收后统一合并
- **依赖链**:M1.1 → M1.2 → M1.3 → M1.4 → M1.5 → M1.6,M1.1 必须先完(Canvas 才能消费 Library)
- **路径**:`src/plugins/graph/library/`(共享资源)+ `src/plugins/graph/canvas/`(本模块)
- **节奏**:每个 Mx.y 子任务完成即 commit;每个 Mx 完成跑一次相关验收项手测;M1.6 完成后跑 §2.1 全 17 项,**全过才合 main**

### M1.1 Library 基础(1.5-2 天)

**前置依赖**:Library 必须先建,Canvas 才能消费。详见 [Library.md §5 模块结构](../library/Library.md#5-模块结构)。

- M1.1a: ShapeRegistry + 18 个 shape JSON 定义文件 — **0.5-0.75 天**
- M1.1b: parametric renderer + formula evaluator(17 个操作符)— **0.5 天**
- M1.1c: SubstanceRegistry + 5 个内置 substance JSON — **0.25 天**
- M1.1d: SVG path → Three.js mesh 转换器 — **0.25-0.5 天**

### M1.2 Canvas 渲染管线(1-1.5 天)

- M1.2a: SceneManager(Three.js 底座) — **0.5 天**
  - ⚠️ **Retina setSize**:`renderer.setSize(w, h, true)` 第三参数必须 `true`,否则 Retina canvas DOM 撑成 2 倍 CSS 像素超出容器
  - ⚠️ **容器始终 mount**:canvas 容器 div 不按状态切换 empty/canvas,empty state 用 overlay,否则 ref 时机错过 mount 永远不跑
- M1.2b: 节点渲染管线(instance JSON → mesh) — **0.5-0.75 天**
  - ⚠️ **fitToContent NaN 防御**:setFromObject 含退化几何时返回 NaN box,4 分量 `Number.isFinite` 检查不 finite 跳过
  - ⚠️ **加几何体后必须主动 fit**,不能依赖硬编码尺寸碰巧合适
- M1.2c: Magnet 吸附(line 端点跟随 shape) — **0.25 天**

### M1.3 Canvas 交互(1 天)

- M1.3a: 单选 / 多选 / 拖动 / 删除 — **0.5 天**
- M1.3b: pan / zoom — **0.25 天**
- M1.3c: 添加模式(点击工具 → 点击画布实例化) — **0.25 天**

### M1.4 Canvas UI(1.75-2.25 天)

按 §3 Freeform 风格 4 件 UI 拆分:

- M1.4a: **Toolbar 顶部条** — **0.25 天**
  - 36px 高横条,字段对齐 NoteView toolbar 视觉(`#252525` 背景、`#333` 下边框、4px gap)
  - 按钮:`‹ ›` 导航 / 标题 / `+ 添加`(合并 Shape + Substance) / `🔍 100%` / `↔` Fit / `+ 新建` / `Open` / `🔄` SlotToggle / `×`
  - 撤销/重做用 Cmd+Z / Cmd+Shift+Z 快捷键(M1.x.6),不在 toolbar 占位
- M1.4b: **LibraryPicker 浮层** — **0.5-0.75 天**
  - 双栏 popover(左 ~160px 分类 + 右 3-col 网格)+ 顶部搜索 + anchor 三角
  - `+ Shape` / `◇ Substance` 共用同一 popover,初始高亮分类不同
  - 关闭逻辑:点选项 → 关闭并进入添加模式;ESC / 点外部 → 关闭(已进入添加模式时 ESC 优先取消添加模式)
- M1.4c: **FloatingInspector 浮层** — **0.75-1 天**
  - 浮层(可拖动 / 可关闭 / 默认右上)+ 选中节点时显示,空选时隐藏
  - 子面板:Position / Fill / Line / Arrow / SubstanceProps
  - 拖动后位置记忆(localStorage,key 按 noteId 区分)
- M1.4d: **CreateSubstanceDialog + 多选 Combine inline 按钮** — **0.25 天**
  - 多选状态时 Toolbar 右侧 inline 出现 `[⊟ Combine to Substance]`,取消选中即消失

### M1.5 序列化 + Canvas note(0.5 天)

- M1.5a: 画板 → JSON 序列化 / 反序列化 — **0.25 天**
- M1.5b: NavSide "+ 新建画板"入口 + frontmatter 校验 — **0.25 天**

### M1.6 调用 API(0.5 天)

- M1.6a: `canvasAPI.openInRightSlotForSubstanceCreation` — **0.25 天**
- M1.6b: `canvasAPI.openInRightSlotForSubstanceEdit` — **0.25 天**

### M1.x 体验补丁(M1.5 之后,M1.6 之前/期间穿插)

M1 spec 14 项验收过程中暴露的体验缺口,作为补丁推进:

- M1.x.1: Instance.rotation 字段 + outer/inner 嵌套实现 bbox 中心旋转 — **0.25 天**
- M1.x.2: ResizeHandlesOverlay 渲染(8 resize + 1 rotation) — **0.25 天**
- M1.x.3: handles 拖动逻辑(resize 8 方向 + rotate,Shift 吸附 15°) — **0.5 天**
- M1.x.4: hit-test OBB(旋转后选中)+ selection border OBB + corner 等比缩放 +
  历史脏数据防御(deserialize sanitize) — **0.5 天**
- M1.x.5: magnet 旋转跟随(line 端点接入点跟随节点 rotation) — **0.1 天**
- M1.x.6: Cmd+Z / Cmd+Shift+Z 撤销/重做(50 步全量快照) — **0.25 天**
- M1.x.7: line 创建 press-drag-release(从 magnet 拖出连线 + 吸附) — **0.5 天**
- M1.x.7b: line rewire(拖端点改连接)+ 距离曲线 hit-test + line hover 高亮 — **0.5 天**

体验补丁让 §2.1 验收清单从 14 项扩展到 17 项(见 §2.1)。

### 合计

| 阶段 | 时间 |
|---|---|
| M1.1 Library 基础 | 1.5-2 天 |
| M1.2 Canvas 渲染管线 | 1-1.5 天 |
| M1.3 Canvas 交互 | 1 天 |
| M1.4 Canvas UI(Toolbar + LibraryPicker + FloatingInspector + Dialog) | 1.75-2.25 天 |
| M1.5 序列化 | 0.5 天 |
| M1.6 调用 API | 0.5 天 |
| M1.x 体验补丁 | ~3 天 |
| **里程碑 1 合计** | **~9-11 天** |
| 用户验证(§2.1 17 项) | 0.5 天 |

里程碑 1 通过验证后,才进入 family-tree variant(里程碑 2,详见 [family-tree.md](../family-tree/family-tree.md))。

## 8. v1 验收标准

详见 §2.1 的 17 项操作清单(原 14 项 + M1.x 系列补的 line 创建/rewire/旋转跟随)。
**全部通过才进入里程碑 2**。

特别强调:
- 第 12 项(Combine to Substance)是 Canvas 创作能力的核心验证
- 第 13 项(Edit Substance via API)是被其他 view 调用能力的核心验证(M1.6)
- 第 14-17 项(Magnet 吸附 + line 创建 + rewire + 旋转跟随)是 line 与 shape
  联动的核心闭环

## 9. 与现有 KRIG 模块关系

- **Note 系统**:Canvas 内容存为 note(`view: graph` + `variant: canvas`)
- **Library**:Canvas 是 Library 的主要消费者(浏览 + 实例化 + 创建 substance)
- **NoteView**:用户能像浏览 note 一样浏览 Canvas note(切换 view 模式)
- **NavSide**:"+ 新建画板"入口,Canvas note 用专属图标
- **right-slot 协议**:被 family-tree 等 view 调用时,Canvas 在 right-slot 打开

## 10. 参考资料

### 工业参考
- [PowerPoint Format Shape Pane](https://support.microsoft.com/en-us/office/format-a-shape-or-other-graphic-effects-cf1bb2d3-cdc0-4d50-a14f-9e83fbcadb45)
- [tldraw](https://github.com/tldraw/tldraw) — 组件化 shape + 创作 UI
- [Excalidraw](https://github.com/excalidraw/excalidraw) — 极简画板交互
- [draw.io / mxGraph](https://github.com/jgraph/drawio) — Stencil + 创作工具
- [macOS Freeform](https://www.apple.com/newsroom/2022/12/apple-launches-freeform-a-powerful-new-app-designed-for-creative-collaboration/) — 现代 freeform 画板参考

### 相关 spec
- [Library.md](../library/Library.md) — Shape + Substance 资源库
- [family-tree.md](../family-tree/family-tree.md) — 第一个消费 Library 的 variant

### KRIG memory
- [feedback_threejs_retina_setsize.md](memory/feedback_threejs_retina_setsize.md) — Three.js Retina setSize 第三参数
- [feedback_canvas_must_show_all_content.md](memory/feedback_canvas_must_show_all_content.md) — fitToContent 是底线
- [feedback_canvas_container_must_always_render.md](memory/feedback_canvas_container_must_always_render.md) — canvas 容器始终渲染
- [feedback_fitcontent_nan_defense.md](memory/feedback_fitcontent_nan_defense.md) — NaN 防御
