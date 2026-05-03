# Library — Shape + Substance 资源库

KRIG Graph 体系的**资源仓库**。系统级,所有用户、所有 view 共享。

## 0. 核心定位

### 0.1 在 Graph 体系中的位置

```
┌────────────────────────────────────────────────────────┐
│ Library(资源仓库)                                    │
│   - Shape:系统提供 / 不可变 / 通过 JSON 配置定义       │
│   - Substance:可创建 / 可组合(Shape 或 Substance) │
│   - 全系统共享,任何 view 都可调用                      │
└────────────────────────────────────────────────────────┘
        ↑                            ↑
        │ 创建                        │ 调用
        │                            │
┌──────────────────┐         ┌────────────────────────────┐
│ Canvas(创作 view)│         │ Variant 视图               │
│  - 自由创作       │         │  - family-tree(消费资源) │
│  - 创建 Substance│         │  - knowledge(消费资源)   │
│  - 浏览 Library  │         │  - mindmap(消费资源)     │
└──────────────────┘         └────────────────────────────┘
```

### 0.2 Library 不是 view

**Library 是数据仓库,不是 view**。它通过 API 被 Canvas / variant 等 view 访问。Library 没有自己的 UI(浏览 Library 的 UI 在 Canvas 里实现)。

### 0.3 资源类型

| 类型 | 谁创建 | 可变? | 谁能调用 |
|---|---|---|---|
| **Shape** | 系统 / 第三方插件 / 用户从 SVG 导入 | 不可变(每个 shape 是一份固定定义) | 全系统 |
| **Substance** | 用户在 Canvas 里组合 shape 创建 | 可创建 / 可命名 / 可分享 | 全系统 |

**关键区别**:
- **Shape 是"原子"**(rectangle / circle / line / 流程图判定菱形 等基础图元)
- **Substance 是"分子"**(由多个 shape 或别的 substance 组合而成,带语义,如 `family/person`)
- Substance 可以包含 Substance(递归组合)— **一生二二生三三生万物**

## 1. 设计原则

1. **资源全系统共享** — 一份 shape 或 substance 定义,被所有 view 调用
2. **JSON 是数据格式** — 资源用 JSON 描述,通用语言,跨 app 可读
3. **层次清晰** — Shape(原子,系统提供)/ Substance(分子,用户组合)严格区分
4. **对齐工业标准** — Shape 词汇表对齐 PowerPoint OOXML(ECMA-376),公式语言对齐 OOXML 17 个操作符
5. **可扩展性** — 系统 / 第三方插件 / 用户导入三种来源,通过统一 API 注册
6. **JSON + Renderer 分层** — 数据(JSON)与渲染逻辑(TypeScript renderer)分层,90% shape 纯 JSON 描述,10% 复杂 shape 用 custom TS 实现

## 2. Shape 定义(JSON 配置)

### 2.1 数据格式

参考 PowerPoint OOXML `<custGeom>` + draw.io 归一化坐标。完整 schema:

```jsonc
{
  // ─── 必备字段 ───
  "id": "krig.basic.roundRect",         // 全局唯一(命名空间.类别.id)
  "category": "basic",                  // basic | arrow | flowchart | callout | star | math | misc
  "name": "Rounded Rectangle",          // 显示名
  "renderer": "parametric",             // parametric | static-svg | custom

  // ─── 几何 ───
  "viewBox": { "w": 100, "h": 100 },    // 默认坐标系(实际渲染时按节点 width/height 缩放)
  "aspect": "variable",                 // variable | fixed(锁定宽高比)

  // ─── 用户可调参数(对齐 OOXML avLst)───
  "params": {
    "r": {
      "type": "number",
      "default": 0.15,                  // 单位 ratio:与 ss(short side)的比例
      "min": 0,
      "max": 0.5,
      "label": "Corner radius",
      "unit": "ratio"                   // ratio(0..1)| px | deg
    }
  },

  // ─── 计算中间值(对齐 OOXML gdLst)───
  "guides": [
    { "name": "rad", "op": "*/", "args": ["ss", "r", 1] }
    // 对应 OOXML: <gd name="rad" fmla="*/ ss r 1"/>
    // 含义:rad = ss * r / 1 = ss * r
  ],

  // ─── 路径(对齐 OOXML pathLst)───
  "path": [
    { "cmd": "M", "x": "rad",         "y": 0 },
    { "cmd": "L", "x": "w - rad",     "y": 0 },
    { "cmd": "A", "rx": "rad", "ry": "rad",
                  "x": "w",           "y": "rad" },
    { "cmd": "L", "x": "w",           "y": "h - rad" },
    { "cmd": "A", "rx": "rad", "ry": "rad",
                  "x": "w - rad",     "y": "h" },
    { "cmd": "L", "x": "rad",         "y": "h" },
    { "cmd": "A", "rx": "rad", "ry": "rad",
                  "x": 0,             "y": "h - rad" },
    { "cmd": "L", "x": 0,             "y": "rad" },
    { "cmd": "A", "rx": "rad", "ry": "rad",
                  "x": "rad",         "y": 0 },
    { "cmd": "Z" }
  ],

  // ─── 连接点(对齐 mxGraph constraint,归一化 0..1)───
  "magnets": [
    { "id": "N", "x": 0.5, "y": 0   },
    { "id": "E", "x": 1,   "y": 0.5 },
    { "id": "S", "x": 0.5, "y": 1   },
    { "id": "W", "x": 0,   "y": 0.5 }
  ],

  // ─── 拖动 handle(对齐 OOXML ahLst)───
  "handles": [
    {
      "param": "r",
      "axis": "x",
      "from": "params.r * w",
      "min": 0,
      "max": "w/2"
    }
  ],

  // ─── 文本框(对齐 OOXML rect)───
  "textBox": { "l": "rad", "t": "rad", "r": "w - rad", "b": "h - rad" },

  // ─── 默认样式 ───
  "default_style": {
    "fill":   { "type": "solid", "color": "#4A90E2", "transparency": 0 },
    "line":   { "type": "solid", "color": "#2E5C8A", "width": 1.5, "dashType": "solid" },
    "arrow":  { "begin": "none", "end": "none" }
  },

  // ─── 来源标识(系统 / 插件 / 导入)───
  "source": "builtin"                    // builtin | plugin | imported
}
```

### 2.2 公式语言(对齐 OOXML 17 个操作符)

```
op       含义                  示例
─────────────────────────────────────────────
*/       (a*b)/c               { "op":"*/", "args":["w",1,4] }     // w/4
+-       (a+b)-c               { "op":"+-", "args":["w","h",10] }
+/       (a+b)/c               { "op":"+/", "args":["w","h",2] }   // (w+h)/2
abs      |a|                   { "op":"abs", "args":["x"] }
sqrt     √a                    { "op":"sqrt", "args":["x"] }
mod      √(a²+b²+c²)            { "op":"mod", "args":["dx","dy",0] }
pin      clamp(b, a, c)        { "op":"pin", "args":[0,"r",100] }
max      max(a,b)              { "op":"max", "args":["a","b"] }
min      min(a,b)              { "op":"min", "args":["a","b"] }
val      字面值                 { "op":"val", "args":[50000] }
sin      a*sin(b)              { "op":"sin", "args":[100, 30] }    // 100*sin(30°)
cos      a*cos(b)              { "op":"cos", "args":[100, 30] }
tan      a*tan(b)              { "op":"tan", "args":[100, 30] }
at2      arctan(b/a)           { "op":"at2", "args":["dx","dy"] }
cat2     a*cos(arctan(c/b))    { "op":"cat2", "args":["r","b","c"] }
sat2     a*sin(arctan(c/b))    { "op":"sat2", "args":["r","b","c"] }
?:       a>0 ? b : c           { "op":"?:", "args":["delta","x1","x2"] }
```

**内置标识符**(在公式中可直接引用):
- `w`, `h` — 节点宽高
- `ss` — short side(min(w, h))
- `wd2`, `wd4`, `wd6`, `wd8`, `wd10`, `wd16`, `wd32` — w/2, w/4, ..., w/32
- `hd2`, `hd4`, ..., `hd32` — h/2, h/4, ...
- `cd2`, `cd4`, `cd8` — 圆周分度
- `t`, `l`, `r`, `b`, `hc`, `vc` — top/left/right/bottom 边界,水平/垂直中心
- 用户定义的 `params` 和 `guides` 名称

### 2.3 路径命令(对齐 SVG + OOXML pathLst)

| cmd | 含义 | 参数 |
|---|---|---|
| `M` | moveTo | `x`, `y` |
| `L` | lineTo | `x`, `y` |
| `A` | arcTo | `rx`, `ry`, `x`, `y`, 可选 `large-arc-flag`, `sweep-flag` |
| `Q` | quadraticBezTo | `x1`, `y1`, `x`, `y` |
| `C` | cubicBezTo | `x1`, `y1`, `x2`, `y2`, `x`, `y` |
| `Z` | close | (无参) |

每个参数值都可以是数字或公式中的标识符。

### 2.4 三种 renderer

| renderer | 用法 | 适合 |
|---|---|---|
| **`parametric`** | 解释 JSON 的 path + params + guides,生成几何 | 90% shape(矩形 / 圆 / 多边形 / 流程图基础形状) |
| **`static-svg`** | 直接读 `svg_string` 字段(嵌入 SVG 字符串) | 极简静态图标(无参数) |
| **`custom`** | 调用 TS 模块(`implementation` 字段指向) | 复杂智能 shape(箭头自适应长度 / 与 label 联动等) |

custom shape 例子:
```jsonc
{
  "id": "krig.arrow.smart-end-arrow",
  "renderer": "custom",
  "implementation": "src/plugins/graph/library/shapes/impl/smart-end-arrow.ts",
  "params": { "headSize": { "type": "number", "default": 10 } }
}
```

## 3. Substance 定义(用户在 Canvas 创建)

### 3.1 数据格式

```jsonc
{
  "id": "user.family.person",          // 用户创建时分配的 id
  "category": "family",                 // 用户定义的类别(可选)
  "name": "Family Person",
  "description": "A person in a family tree",

  // ─── Substance 由 shape 或别的 substance 组合而成 ───
  "components": [
    {
      "type": "shape",                  // shape | substance
      "ref": "krig.basic.roundRect",    // shape 的 id
      "transform": { "x": 0, "y": 0, "w": 160, "h": 60 },
      "style_overrides": {              // 覆盖 shape 默认样式
        "fill": { "color": "#a8c7e8" }   // gender=M 默认浅蓝
      },
      "binding": "frame"                // 节点的"主框",决定 substance 的 size
    },
    {
      "type": "shape",
      "ref": "krig.basic.text-label",
      "transform": { "x": 80, "y": 30, "anchor": "center" },
      "style_overrides": {
        "fontSize": 14
      },
      "binding": "label"                // 主 label
    }
  ],

  // ─── 默认属性(用户在 Canvas 实例化后可改)───
  "default_props": {
    "label": "未命名",
    "gender": "U",
    "birth": null,
    "death": null
  },

  // ─── 属性影响 shape 的视觉规则(可选)───
  "visual_rules": [
    { "if": "gender === 'M'", "apply": { "frame.fill.color": "#a8c7e8" } },
    { "if": "gender === 'F'", "apply": { "frame.fill.color": "#e8a8c0" } },
    { "if": "death !== null", "apply": { "frame.fill.saturation": 0.5 } }
  ],

  // ─── 来源 ───
  "source": "user",                     // builtin | user
  "created_at": 1714000000000,
  "created_by": "user@example.com"      // 未来共享时记录
}
```

### 3.2 关键设计

- **components 字段递归**:component 可以是 shape,也可以是另一个 substance
- **transform 字段定位**:每个 component 在 substance 内的位置(x/y/w/h/rotation)
- **binding 字段**:命名 component 的"角色"(frame / label / icon 等),供 visual_rules 和 variant 引用
- **visual_rules 字段**:属性 → 视觉的映射(可选),让 substance 自适应数据

### 3.3 v1 内置 substance

| Substance id | 用途 | 组成 |
|---|---|---|
| `library.text-card` | 通用文字卡片 | rounded-rect + text-label(InsideCenter) |
| `library.sticky-note` | sticky 笔记 | rect(浅黄) + text-label |
| `library.family.person` | family-tree 人物 | rounded-rect + text-label(姓名 + 日期 2 行) |
| `library.family.spouse-line` | 婚姻线 | line(可控粗细) |
| `library.family.parent-link` | 父子边 | line(三段直角,通过 magnet 连接) |

family-tree variant 用后 3 个,前 2 个是 Canvas 自由创作时的通用素材。

## 4. v1 内置 Shape 列表(18 个)

从 PowerPoint OOXML 187 个预设中精选,覆盖 family-tree + 通用画板需求:

### 4.1 Basic(11 个)
| id | OOXML name | 备注 |
|---|---|---|
| `krig.basic.rect` | `rect` | 矩形 |
| `krig.basic.roundRect` | `roundRect` | 圆角矩形(family-tree 用) |
| `krig.basic.ellipse` | `ellipse` | 椭圆 / 圆 |
| `krig.basic.diamond` | `diamond` | 菱形 |
| `krig.basic.triangle` | `triangle` | 三角形 |
| `krig.basic.parallelogram` | `parallelogram` | 平行四边形 |
| `krig.basic.trapezoid` | `trapezoid` | 梯形 |
| `krig.basic.pentagon` | `pentagon` | 五边形 |
| `krig.basic.hexagon` | `hexagon` | 六边形 |
| `krig.basic.octagon` | `octagon` | 八边形 |
| `krig.basic.cylinder` | `can` | 圆柱体 |

### 4.2 Arrow(3 个)
| id | OOXML name | 备注 |
|---|---|---|
| `krig.arrow.right` | `rightArrow` | 右箭头 |
| `krig.arrow.left-right` | `leftRightArrow` | 双向箭头 |
| `krig.arrow.bent` | `bentArrow` | 弯折箭头 |

### 4.3 Flowchart(4 个)
| id | OOXML name | 备注 |
|---|---|---|
| `krig.flowchart.process` | `flowChartProcess` | 流程框 |
| `krig.flowchart.decision` | `flowChartDecision` | 决策菱形 |
| `krig.flowchart.terminator` | `flowChartTerminator` | 起止框(圆角矩形) |
| `krig.flowchart.document` | `flowChartDocument` | 文档框 |

### 4.4 v1 不内置但 v1.5+ 必加

- **完整 arrows 集**(12 个):up/down/left/leftRight/upDown/quadArrow/...
- **Stars and banners**(8 个):star4/5/6/8/ribbon/scroll/bevel
- **Callouts**(8 个):wedgeRectCallout/cloudCallout/...
- **完整 flowchart**(剩 25 个):inputOutput/predefinedProcess/internalStorage/...
- **Math symbols**(8 个):mathPlus/Minus/Multiply/Divide/Equal/heart/lightningBolt
- **Brackets/braces**(4 个):leftBracket/rightBracket/leftBrace/rightBrace

目标:v2 完整覆盖 OOXML 187 个预设(等于 PowerPoint 等级)。

### 4.5 Line(独立类别)

`line` 不算 "shape",归到独立的 line 类型,但参数化方式相同:
| id | 备注 |
|---|---|
| `krig.line.straight` | 直线 |
| `krig.line.elbow` | 直角折线(family-tree 父子边用) |
| `krig.line.curved` | 平滑曲线 |

### 4.6 Text label(独立类别)

| id | 备注 |
|---|---|
| `krig.text.label` | 文字标签(SVG 渲染,KRIG 已有方案) |

## 5. 模块结构

```
src/plugins/graph/library/
├── shapes/
│   ├── definitions/             # JSON 文件,每个 shape 一个
│   │   ├── basic/
│   │   │   ├── rect.json
│   │   │   ├── roundRect.json
│   │   │   ├── ellipse.json
│   │   │   └── ... (11 个)
│   │   ├── arrow/
│   │   │   ├── right.json
│   │   │   └── ... (3 个)
│   │   ├── flowchart/
│   │   │   └── ... (4 个)
│   │   ├── line/
│   │   │   └── ... (3 个)
│   │   └── text/
│   │       └── label.json
│   ├── renderers/               # TS 实现
│   │   ├── parametric.ts        # 通用参数化 renderer(支持 90% shape)
│   │   ├── static-svg.ts        # 静态 SVG renderer
│   │   ├── custom/              # 复杂 shape 自定义实现
│   │   │   └── ... (v1 暂无,v1.5+ 按需加)
│   │   ├── formula-eval.ts      # OOXML 17 操作符的求值器
│   │   └── path-to-three.ts     # SVG path → THREE.Shape → Mesh
│   ├── registry.ts              # ShapeRegistry 实现
│   └── index.ts                 # 公开 API
│
├── substances/
│   ├── definitions/             # v1 内置 substance JSON
│   │   ├── library/
│   │   │   ├── text-card.json
│   │   │   └── sticky-note.json
│   │   └── family/
│   │       ├── person.json
│   │       ├── spouse-line.json
│   │       └── parent-link.json
│   ├── composer.ts              # substance 组合渲染逻辑
│   ├── visual-rules.ts          # visual_rules 求值器
│   ├── registry.ts              # SubstanceRegistry
│   └── index.ts
│
└── index.ts                     # Library 公开 API
```

## 6. 公开 API

```ts
// src/plugins/graph/library/index.ts

import type { ShapeDef, SubstanceDef } from './types';

export interface Library {
  // ── Shape ──
  shapes: {
    register(def: ShapeDef): void;
    get(id: string): ShapeDef | null;
    list(): ShapeDef[];
    listByCategory(category: string): ShapeDef[];

    // 渲染:输入 shape id + props,输出 SVG path / Three.js mesh
    render(id: string, props: Record<string, unknown>, ctx: RenderContext): RenderOutput;
  };

  // ── Substance ──
  substances: {
    register(def: SubstanceDef): void;
    create(def: SubstanceDef): Promise<string>;       // 返回 substance id
    update(id: string, def: Partial<SubstanceDef>): Promise<void>;
    delete(id: string): Promise<void>;
    get(id: string): SubstanceDef | null;
    list(): SubstanceDef[];
    listByCategory(category: string): SubstanceDef[];

    // 渲染:输入 substance id + props,输出多个 shape 的组合
    render(id: string, props: Record<string, unknown>, ctx: RenderContext): RenderOutput[];
  };

  // ── 第三方扩展 API ──
  registerShapePack(pack: ShapePack): void;            // 批量注册
  registerSubstancePack(pack: SubstancePack): void;
}
```

## 7. 存储

### 7.1 Shape

**v1 不入库**,直接以 JSON 文件形式打包进 app(`src/plugins/graph/library/shapes/definitions/*.json`)。

理由:
- Shape 是系统不可变资源,版本随 app 一起更新
- 直接文件加载快,免去数据库查询
- 启动时一次性 import 所有 JSON,注册到 ShapeRegistry

### 7.2 Substance

**v1 入库**(用户可创建,需持久化)。

存储方案:
- 系统内置 substance:JSON 文件预置,启动时注册到 SubstanceRegistry
- 用户创建 substance:**每个一篇 note**,在系统 folder `~/Library/Substances/` 下
  - 这篇 note 的内容就是 substance 的 JSON 定义
  - 利用现有 note-store 不新建表
  - 用户能在 NavSide 里看到所有自定义 substance(在系统 folder 里)
  - 用户能 derived_from 一个 substance 衍生出新的 substance(类似 git fork)

这呼应你的"note 衍生关系"理念 — substance 之间用 note 链接表达派生关系。

## 8. 与现有 KRIG 模块关系

- **Note 系统**:Substance 用 note 存储(每个一篇)
- **NoteView**:用户能像看普通 note 一样浏览 substance 定义(JSON 内容)
- **Atom 体系**:Shape / Substance 的 JSON 定义本身可以是 NoteView 里的 atom 数据
- **NavSide**:系统 folder `~/Library/Substances/` 显示所有 substance,可分类
- **协同(v2+)**:用户能把自己的 substance 分享给其他用户(发送 note)

## 9. v1 不做(留 v1.5+)

| 功能 | 留待 |
|---|---|
| 完整 PowerPoint 187 shape | v1.5+ 持续扩展 |
| custom renderer 复杂 shape | v1.5+ 按需加 |
| Shape 用户从 SVG / .pptx 导入 | v1.5+ |
| Substance 跨用户 / 团队分享 | v2+ |
| Substance 版本控制 / 回退 | v2+ |
| Substance 类别 UI 管理 | v1.5+ |
| Shape pack 第三方插件市场 | v2+ |

## 10. 实施

详见 [Canvas.md](../canvas/Canvas.md) 和 [family-tree.md](../family-tree/family-tree.md)。Library 与 Canvas / family-tree 一起实施(Library 是底座,Canvas 是创作工具,family-tree 是消费者)。

## 11. 参考资料

### OOXML 标准
- [ECMA-376 Annex D presetShapeDefinitions](https://learn.microsoft.com/en-us/archive/blogs/openspecification/how-to-use-the-presetshapedefinitions-xml-file-and-fun-with-drawingml)
- [ST_ShapeType (187 presets) — Liquid Tech](https://schemas.liquid-technologies.com/OfficeOpenXML/2006/st_shapetype.html)
- [PresetGeometry (Microsoft Learn)](https://learn.microsoft.com/en-us/previous-versions/office/developer/office-2010/cc797920(v=office.14))

### draw.io 参考
- [drawio stencils](https://github.com/jgraph/drawio/tree/dev/src/main/webapp/stencils)
- [drawio mxBasic.js](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/shapes/mxBasic.js)

### tldraw 参考
- [tldraw shapes docs](https://tldraw.dev/docs/shapes)
- [@tldraw/tlschema](https://tldraw.dev/reference/tlschema)

### LibreOffice 参考(开源 OOXML 实现)
- [LibreOffice oox module](https://docs.libreoffice.org/oox.html)
- LibreOffice `EnhancedCustomShape2d.cxx` — 完整 OOXML 公式求值器(C++)

### KRIG 相关 memory
- [project_substance_is_class.md](memory/project_substance_is_class.md) — Substance 是"类"用户操作"实例"
- [project_substance_three_layers.md](memory/project_substance_three_layers.md) — Substance 三层架构
- [feedback_variants_inherit_basic.md](memory/feedback_variants_inherit_basic.md) — variants 必须继承 basic 视图元素
