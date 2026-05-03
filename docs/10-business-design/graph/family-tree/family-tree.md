# Family Tree — Graph view 的族谱 variant

KRIG Graph view 的 **family-tree variant**,把含人物关系的 note 渲染为族谱图。

## 0. 架构定位

### 0.1 在 KRIG 体系中

```
KRIG views (顶层视图):
├── NoteView   (笔记)
├── EBookView  (电子书)
├── WebView    (网页)
└── Graph      (图谱)
      ├── variant: canvas          (自由创作画板)
      ├── variant: family-tree     ← 本 spec
      ├── variant: knowledge       (后续)
      ├── variant: mindmap         (后续)
      └── ...
                ↑
                │ 调用资源
                │
      ┌─────────────────────────────┐
      │ Library(资源仓库)           │
      │   Shape + Substance         │
      │   全系统共享                 │
      └─────────────────────────────┘
```

family-tree 是 Graph 的**第二个 variant**(第一个是 canvas)。两者平级,共享 Library。

### 0.2 v1 在体系中的位置

family-tree variant 是**第二个里程碑**:
- 里程碑 1:Library + Canvas(详见 [Library.md](../library/Library.md) 和 [Canvas.md](../canvas/Canvas.md))
- **里程碑 2:family-tree variant**(本 spec)

里程碑 1 完成 + 验证通过,才进入里程碑 2。

### 0.3 family-tree 的输入输出

**输入**:一篇含人物关系的 note(markdown 格式)
**输出**:一张专业族谱图(对齐 GenoPro / GRAMPS 视觉)

family-tree 不创建数据,只**消费 note + 调用 Library**。

## 1. 设计原则

1. **数据通用,视图专属** — 数据用 KRIG 通用 note,视觉用 family-tree 专属
2. **算法读结构,视觉读属性** — 布局只看节点关系,视觉只看属性 → Library shape 映射
3. **还原历史真实** — 嫡庶 / 已故 / 占位等历史信息忠实呈现,不抹平文化差异
4. **对标专业工具**(GenoPro / GRAMPS / MyHeritage / Family Tree Maker)
5. **属性名对齐工业标准**(schema.org / GEDCOM)
6. **复用 Library 资源** — 不自建 shape / substance,从 Library 拿
7. **note 是真理之源,view 只读** — view 永远不改写 note 内容

## 2. 数据契约(note 的内容格式)

### 2.1 一篇族谱 note 的总体结构

```markdown
---
title: 红楼梦人物族谱
view: graph
variant: family-tree
derived_from: [[note-honglou-text]]   # 可选,衍生关系
---

(可选:序言、说明文字...)

# 贾政 [[jia-zheng]]

- gender :: M
- birth :: 1700

# 王夫人 [[wang-furen]]

- gender :: F

# 赵姨娘 [[zhao-yiniang]]

- gender :: F

# 贾宝玉 [[jia-baoyu]]

- gender :: M
- birth :: 1716

# 贾环 [[jia-huan]]

- gender :: M
- birth :: 1720
- legitimate :: false

## 关系

- [[jia-zheng]] spouse [[wang-furen]] {marriage_order: 1, rank: principal}
- [[jia-zheng]] spouse [[zhao-yiniang]] {rank: secondary, concurrent_with: [[jia-zheng-wang]]}
- [[jia-zheng]] parent [[jia-baoyu]] {pedigree: birth}
- [[zhao-yiniang]] parent [[jia-huan]] {pedigree: birth}
```

### 2.2 frontmatter

```yaml
---
title: 显示名
view: graph                  # 必填:Graph view
variant: family-tree         # 必填:family-tree variant
derived_from: [[note-id]]    # 可选:衍生自哪篇 note(类似 git parent)
---
```

`view: graph` + `variant: family-tree` 必填。

### 2.3 人物(Node)

每个一级标题(`# 姓名 [[id]]`)是一个人物。

| 属性 | 取值 | 说明 | 视觉影响 |
|---|---|---|---|
| `gender` | `M` / `F` / `O` / `U` | 性别 | 节点填充色 |
| `birth` | `'YYYY'` 或 `'YYYY-MM-DD'` | 出生 | 节点第二行 b. YYYY |
| `death` | `'YYYY'` 或 `'YYYY-MM-DD'` | 死亡 | 节点斜线 + 颜色降饱和度 + 第二行 d. YYYY |
| `legitimate` | `true` / `false` | 嫡 / 庶(默认 true) | 庶子节点尺寸缩小 + 虚线边框 |
| `placeholder` | `true` | 占位人物 | 虚线框 + `?` 文字 |

属性对齐 schema.org Person + GEDCOM。详见 [Library.md `library.family.person` substance](../library/Library.md#3.3-v1-内置-substance)。

### 2.4 关系(Edge)

写在 `## 关系` 段落,每条一行:

```
- [[源]] type [[目标]] {属性...}
```

| type | 来源 | 渲染 |
|---|---|---|
| `parent` | schema.org Person.parent | drop+sibling-bar+stub 三段直角 |
| `spouse` | schema.org Person.spouse | 配偶横线 |
| `sibling`(可选,可省) | schema.org Person.sibling | 由 parent 推导 |

#### parent 边属性

| 属性 | 值 | 来源 | 视觉 |
|---|---|---|---|
| `pedigree` | `birth` / `adopted` / `foster` / `step` / `unknown` | GEDCOM 7 PEDI | 实线 vs 虚线 stub |

#### spouse 边属性

| 属性 | 值 | 来源 | 视觉 |
|---|---|---|---|
| `marriage_order` | `1` / `2` / `3` ... | Wikidata seriesOrdinal | 多婚姻视觉左右排序 |
| `rank` | `principal` / `secondary` / `unknown` | KRIG 扩展 | 主妻 1.5px / 妾 1px |
| `marriage_status` | `married` / `civil_union` / `unmarried` / `divorced` / `separated` / `unknown` | schema.org / Wikidata | 实线 / 虚线 / 斜线标记 |
| `concurrent_with` | 其他 spouse 边引用 | KRIG 扩展 | 区分"再婚"vs"同时多妻" |

详见 [§3.3 多配偶视觉规则](#3.3-多配偶视觉)。

## 3. 视觉规范

照搬 GenoPro / GRAMPS 共识。**全部规则都是"属性 → Library 资源 + 样式覆盖"映射,无算法分支**。

### 3.1 节点视觉(Person)

family-tree 复用 Library 的 `library.family.person` substance,通过 visual_rules 实现属性映射:

| 属性 | 默认 | 视觉效果 | 实现方式 |
|---|---|---|---|
| `gender=M` | — | 填充浅蓝 `#a8c7e8` | substance visual_rules |
| `gender=F` | — | 填充浅粉 `#e8a8c0` | substance visual_rules |
| `gender=O` | — | 填充浅灰 `#c0c0c0` | substance visual_rules |
| `gender=U` 或缺失 | ✓ | 填充深灰 `#888` | substance visual_rules |
| `legitimate=false` | — | 尺寸 140×50,边框虚线 | family-tree projection 覆盖 |
| `placeholder=true` | — | 虚线框 + `?` 替代姓名 | family-tree projection 覆盖 |
| `death` 存在 | — | 左上角对角斜线 + 饱和度 50% | family-tree projection 加装饰 |
| `birth/death` | — | 节点第二行 `b. YYYY – d. YYYY` | substance label 双行 |

### 3.2 边视觉

#### parent 边

复用 Library 的 `library.family.parent-link` substance(line 类型)。

drop + sibling bar + stub 三段直角:

```
        父母对中点(婚姻线中点 / 单亲节点正下方)
              |        ← drop line
              |
       ┌──────┴──────┐ ← sibling bar(横向跨同父母兄弟)
       |             |
     [child]       [child]   ← stub
```

`pedigree` 决定 stub 线型:
- `birth`(默认):实线
- `adopted` / `step`:虚线 9-4
- `foster`:点线 2-3
- `unknown`:虚线 9-4

#### spouse 边

复用 Library 的 `library.family.spouse-line` substance。

| `rank` | 婚姻线粗细 |
|---|---|
| `principal`(默认) | 1.5px |
| `secondary` | 1px |

`marriage_status` 决定线型:
- `married` / `civil_union`(默认):实线
- `unmarried`:虚线 4-2
- `divorced`:实线 + 中点 `//` 双斜线
- `separated`:实线 + 中点 `/` 单斜线
- `unknown`:实线半透明 50%

### 3.3 多配偶视觉

#### 顺序多次婚姻(serial,concurrent_with 空)

```
[ex-spouse]──[A]──[current-spouse]
     ╲          │            ╱
   (drop)   (drop)
     │          │
[children]   [children]
```

A 居中,配偶按 `marriage_order` 升序向同一方向扩展(GenoPro 规则)。

#### 同时多妻 / 多夫(concurrent,concurrent_with 互链)

```
            [A 夫]
       ╱      ║      ╲       ╲
   [正妻]══[A]──[妾 1]────[妾 2]
   ┃        ┃        ┃            ┃
 (drop)  (drop)   (drop)       (drop)
   ┃        ┃        ┃            ┃
 [嫡子] [嫡女]   [庶子]         [庶子]
```

- 算法不读 spouse_rank,视觉差异由节点 / 婚姻线属性自动呈现
- 看红楼梦:王夫人(rank=principal)+ 赵姨娘(rank=secondary)同代并排 → 视觉自动呈现"嫡庶有别"

## 4. 布局算法

### 4.1 算法选择

参考 [entitree-flex](https://github.com/codeledge/entitree-flex)(Walker tidy tree + couple-as-side-node)。算法**只读结构**(parent / spouse 边),**不读文化语义**(rank / legitimate / placeholder)。

### 4.2 算法步骤

#### 第 1 步:建索引

```
parents(person)  = 该 person 作为 child 所有 source 节点
children(person) = 该 person 作为 source 所有 target 节点
spouses(person)  = 与该 person 之间存在 spouse 边的所有节点
```

`parent` 边方向:source=parent, target=child(markdown 解析时归一)。

#### 第 2 步:代际分配

- 主人公 generation = 0
- BFS 向下:主人公及其配偶的所有 children → generation = 1,递归
- 配偶 generation 同主人公(同代)
- v1 不画祖先(主人公是树根)

#### 第 3 步:同代 x 排布

1. 按代从底向上算
2. 叶子按 `birth` 升序排,缺失则按 markdown 出现顺序
3. 父代节点 x = `(leftmostChild.x + rightmostChild.x) / 2`
4. 配偶节点排在主人公左右(同 y),按 `marriage_order` 升序
5. 婚姻锚点(虚拟)= 两 spouse 中点
6. Walker apportion 处理同代不重叠

#### 第 4 步:y 坐标

- 节点 y = `-generation * layerGap`(KRIG y-up)
- `layerGap = 120`(默认)

### 4.3 默认参数

| 参数 | 默认 |
|---|---|
| `layout.spacing.sibling` | 30 |
| `layout.spacing.couple` | 10 |
| `layout.spacing.layer` | 120 |

## 5. 实现架构

### 5.1 模块结构

```
src/plugins/graph/variants/family-tree/
├── parser/
│   ├── parse-note.ts            # markdown → { nodes, edges }
│   └── types.ts
├── layout/
│   └── walker-tidy.ts           # Walker tidy tree + couple-as-side-node
├── projection/
│   ├── visual-rules.ts          # 节点属性 → Library shape/style 覆盖
│   ├── spouse-line.ts           # 婚姻线生成
│   └── parent-edge.ts           # drop+sibling-bar+stub 三段路径
├── FamilyTreeView.tsx           # 集成 parser + layout + projection
├── register.ts                  # 注册为 Graph 的 family-tree variant
└── index.ts
```

### 5.2 数据流

```
用户在 NavSide 选 family-tree note
   ↓
Graph view 创建 family-tree variant 实例
   ↓
view 加载 note(noteAPI.load(noteId))
   ↓
parser → { nodes, edges }
   ↓
layout/walker-tidy → positions Map<nodeId, {x,y}>
   ↓
projection/visual-rules → 决定每个节点用哪个 Library substance + 样式覆盖
   ↓
projection/spouse-line + parent-edge → 生成边几何
   ↓
渲染:复用 Library 的渲染管线(同 Canvas)
   ↓
用户看到族谱
```

**全程不入库**(除了原 note 本身)。

### 5.3 view 注册

```ts
// src/plugins/graph/variants/family-tree/register.ts
import { graphVariantRegistry } from '../../core/registry';

graphVariantRegistry.register({
  id: 'family-tree',
  label: '族谱',
  icon: '👨‍👩‍👧',
  matcher: (note) =>
    note.frontmatter?.view === 'graph' &&
    note.frontmatter?.variant === 'family-tree',
  Component: FamilyTreeView,
});
```

## 6. 入口集成

### 6.1 NavSide

NavSide 显示族谱 note 时,用专属图标(👨‍👩‍👧)。复用现有 NavSide note 树渲染。

### 6.2 创建族谱 note

复用现有"+ 新建笔记"流程,提供"族谱"模板:
- 用户点 NavSide "+ 笔记"
- 选"族谱"模板 → 创建一篇带 `view: graph` + `variant: family-tree` frontmatter 的 note

v1 简化:用户手动加 frontmatter,或从 markdown 导入。

### 6.3 markdown 导入

复用现有 markdown 导入路径,加 frontmatter 校验。

## 7. v1 实施分阶段(里程碑 2)

里程碑 1(Library + Canvas)完成 + 验证通过后才进入。

### M2.1 family-tree parser(0.5 天)

- 写 `parser/parse-note.ts`:输入 markdown,输出 `{ nodes, edges }`
- 单元测试:红楼梦小子集(贾政 + 王夫人 + 贾宝玉 + 贾环 等 5-6 人)

### M2.2 family-tree 布局算法(1 天)

- 写 `layout/walker-tidy.ts`:Walker tidy tree + couple-as-side-node
- 处理:多代分层 + 配偶并排 + sibling bar 共享 + 多配偶 + apportion
- 单元测试:同上小子集

### M2.3 family-tree projection + 视觉(1 天)

- 写 `projection/visual-rules.ts`:节点属性 → Library 资源映射
- 写 `projection/spouse-line.ts`:婚姻线生成(粗细 / 线型 / 斜线标记)
- 写 `projection/parent-edge.ts`:drop+sibling-bar+stub 三段直角
- 写 `FamilyTreeView.tsx`:集成 parser + layout + projection,通过 Library 渲染

### M2.4 红楼梦验收(0.5 天)

- 写一次性转换脚本:`docs/test-data/honglou/relation_refined.csv` → markdown
- 关系类型归一(父亲/儿子等 → parent;夫人/丈夫 → spouse;丫环/朋友等 → 略)
- 嫡庶 + 已故清单(参考红楼梦原著手工补)
- 完整渲染按 §8 验收清单测试

### 合计

| 阶段 | 时间 |
|---|---|
| M2.1 parser | 0.5 天 |
| M2.2 layout | 1 天 |
| M2.3 projection + 视觉 | 1 天 |
| M2.4 红楼梦验收 | 0.5 天 |
| **里程碑 2 合计** | **~3 天** |
| 用户验证 | 0.5 天 |

## 8. 验收标准

### 红楼梦核心(主验收)

数据来源:`docs/test-data/honglou/relation_refined.csv` 转换 + 嫡庶/已故人工标注。

- [ ] markdown 导入成功,识别为 family-tree variant
- [ ] family-tree view 渲染:
  - [ ] 5 代结构清晰(贾演 → 贾代化/贾代善 → 贾敬/贾政 → 贾珠/贾宝玉 → 贾兰)
  - [ ] 配偶横线正确(贾政—王夫人 / 贾赦—邢夫人 / 林如海—贾敏 ...)
  - [ ] 多子女共享 drop + sibling bar(贾政→元春/珠/宝玉/探春/环 5 个子女共享)
  - [ ] 跨家族婚姻不出错(林家通过贾敏与贾家相连,5 大家族图谱整体连通)
  - [ ] 性别色正确(男蓝 / 女粉)
  - [ ] 已故斜线 + 颜色降饱和度(贾代善 / 贾敏 / 林如海 / 贾珠)
- [ ] **嫡庶视觉**(还原历史真实):
  - [ ] 王夫人(rank=principal)与赵姨娘(rank=secondary)同代并存,均连贾政
  - [ ] 王夫人婚姻线 1.5px(粗);赵姨娘婚姻线 1px(细)
  - [ ] 贾环(legitimate=false)节点 140×50 + 虚线;贾宝玉(默认 true)160×60 + 实线 — **明显视觉不同**
- [ ] **同时多妻**(贾珍家):尤氏 + 佩凤 + 偕鸾同代并排 — 不重叠不混乱

### 通用回归

- [ ] 切换其他 variant(canvas / 普通 note)不受影响
- [ ] family-tree note 与普通 note 数据互通(同一 note 系统)
- [ ] typecheck 0 错误
- [ ] 与 Canvas variant 共享同一 Library(看到同样的 substance)

## 9. v1 不做(留 v1.5+)

| 功能 | 留待 |
|---|---|
| 祖先视图(向上展开) | v1.5 |
| 沙漏视图 / 扇形图 | v2 |
| 用户拖动节点 + 持久化位置 | v1.5 |
| 双胞胎 / 三胞胎符号 | v1.5 |
| 照片缩略图 | v1.5 |
| GEDCOM .ged 文件导入 / 导出 | v1.5 |
| 显式 sibling 边渲染 | v1.5 |
| 时间轴模式(y = birth_year) | v2 |

## 10. 参考资料

- [GEDCOM 5.5.1 spec](https://en.wikipedia.org/wiki/GEDCOM)
- [GRAMPS 源码 — pedigreeview.py](https://github.com/gramps-project/gramps/blob/main/gramps/plugins/view/pedigreeview.py)
- [entitree-flex](https://github.com/codeledge/entitree-flex)
- [GenoPro genogram rules](https://genopro.com/genogram/rules/)
- van der Ploeg, A.J., *"Drawing Non-Layered Tidy Trees in Linear Time"*, 2013
- [Library.md](../library/Library.md) — 资源库
- [Canvas.md](../canvas/Canvas.md) — 创作工具
