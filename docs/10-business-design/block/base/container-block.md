# ContainerBlock — 嵌套容器基类

> **文档类型**：基类契约
> **状态**：草案 v1 | 创建日期：2026-04-04
> **约束力**：所有容器类 Block 必须遵循本文档定义
> **继承**：Block 抽象基类（见 `base-classes.md`）

---

## 一、定义

ContainerBlock 是 **嵌套容器**——包含其他 Block（包括 TextBlock、RenderBlock、甚至其他 ContainerBlock）。

```
ContainerBlock = 一组 Block 的组织者
它决定子 Block 的排列方式和视觉包裹
```

引用框、列表、提示框、折叠列表——都是 ContainerBlock 的实例。

与 TextBlock（用户直接打字）和 RenderBlock（注册 renderer）不同，ContainerBlock 自身不产生内容，它**包裹和组织**其他 Block 的内容。

---

## 二、继承体系

```
Block（抽象基类）
  ├── TextBlock       — inline 流（文字混排）
  ├── RenderBlock     — 运行容器（注册渲染器）
  └── ContainerBlock  — 嵌套容器（包裹子 Block）
        ├── bulletList     — 无序列表
        ├── orderedList    — 有序列表
        ├── taskList       — 任务列表
        ├── blockquote     — 引用
        ├── callout        — 提示框
        ├── toggleList     — 折叠列表
        ├── frameBlock     — 彩框
        └── table          — 表格（特殊 Container）
```

---

## 三、Schema 契约

所有 ContainerBlock 的 content 表达式必须包含 `block`：

```typescript
// 标准 Container：任意 block 子节点
content: 'block+'

// 特殊 Container：约束子节点类型
content: 'tableRow+'       // table 只接受 tableRow
content: 'column{2,3}'     // columnList 只接受 2-3 个 column
```

### 3.1 嵌套规则

`content: 'block+'` 意味着子节点可以是任何 `block` 组的节点：

```
callout（ContainerBlock）
  ├── textBlock "提示内容"         ← TextBlock
  ├── bulletList（ContainerBlock） ← Container 嵌套 Container
  │     ├── textBlock "要点 A"
  │     └── textBlock "要点 B"
  ├── mathBlock                    ← RenderBlock
  └── textBlock "继续提示"
```

**嵌套深度不限制**——ProseMirror Schema 天然支持递归 content 表达式。

### 3.2 必填首子

部分 Container 要求特定的首子节点：

```typescript
containerRule: {
  requiredFirstChildType: 'textBlock',  // toggleList 需要标题行
}
```

无必填首子的 Container（callout、blockquote、bulletList 等）允许任何 block 作为第一个子节点。

---

## 四、渲染：从内到外

ProseMirror 的渲染天然从内到外——子节点先渲染，Container 再包裹。

```
渲染顺序：
1. textBlock "要点 A"    → <p>要点 A</p>
2. bulletList 包裹       → <div class="list-bullet"><p>要点 A</p></div>
3. callout 包裹          → <div class="callout"><div class="list-bullet">...</div></div>
```

每层 Container 的视觉装饰（背景色、边框、竖线、标记符号）**自然延伸到所有子内容**。

### 4.1 NodeView 结构

所有 ContainerBlock 的 NodeView 必须提供 `contentDOM`：

```typescript
// Container NodeView 最小结构
return {
  dom,           // 外层容器（承载视觉装饰）
  contentDOM,    // 子内容区域（ProseMirror 管理子节点渲染）
};
```

`dom` 负责视觉装饰（背景、边框、标记），`contentDOM` 让 ProseMirror 在其中渲染子 Block。

### 4.2 子节点标记

列表类 Container（bulletList、orderedList、taskList）需要为每个**直接子 TextBlock** 添加标记：

| Container | 标记方式 | 说明 |
|-----------|---------|------|
| bulletList | CSS `::before` 或 Decoration widget | • ◦ ▪ 按嵌套层级循环 |
| orderedList | Decoration widget（动态编号） | 1. 2. 3. 自动递增 |
| taskList | Decoration widget（checkbox） | ☐/☑ 可点击切换 |
| blockquote | CSS `border-left` | 左侧竖线 |
| callout | NodeView emoji + CSS 背景 | 💡 首行 emoji |
| toggleList | NodeView 折叠箭头 | ▾/▸ 首行箭头 |
| frameBlock | CSS `border-left` 彩色 | 彩色左边框 |

标记通过 CSS 嵌套选择器或 NodeView 内部逻辑自动适应嵌套层级。

### 4.3 列表符号布局规范（不变量）

**列表符号必须在正文内容空间内，文字缩进到符号后面。** 这是所有列表类 Container 的布局约束：

```
正文 textBlock:
│← padding-left: 72px →│
                        文字从这里开始

列表子 block:
│← padding-left: 72px →│
                        │←24px→│
                        符号    文字从这里开始（缩进 24px）
```

实现方式：
1. **Container 自身不加 `padding-left`**——避免改变子 block 的 `getBoundingClientRect().left`，确保手柄对齐不受影响
2. **子 block 自身加 `padding-left: 24px`**——文字缩进，符号在 padding 空间内
3. **符号用 `position: absolute` + `left: 0~24px`**——定位在子 block 的 padding 区域内

```css
/* 示例：所有列表子 block 统一缩进 */
.bullet-list > .bullet-list__content > p { padding-left: 24px; }
.ordered-list > .ordered-list__content > p { padding-left: 24px; }
.task-item__content { padding-left: 24px; }

/* 符号在 padding 空间内（left 值 0~24px） */
.bullet-list > ... > p::before { position: absolute; left: 6px; }
.ordered-list > ... > p::before { position: absolute; left: 0; }
.task-item__checkbox { position: absolute; left: 2px; }
```

**为什么不用 Container 级 `padding-left`**：Container 的 `padding-left` 会右移所有子 block 的 DOM 左边缘，导致手柄定位（基于 `blockRect.left`）偏移，手柄不再和普通 textBlock 对齐。子 block 自身的 `padding-left` 只影响内容渲染，不影响 `getBoundingClientRect().left`。

---

## 五、共享操作

所有 ContainerBlock 继承 Block 基类操作，并增加：

| 操作 | 说明 |
|------|------|
| **整体拖动** | 拖动 Container 时，容器 + 全部子节点一起移动 |
| **溶解（unwrap）** | turnInto paragraph → 子 Block 提取到 Container 外部，Container 删除 |
| **折叠/展开** | 可选能力，toggleList 等支持 |

### 5.1 整体移动不变量

> Container 移动时必须整体移动（容器 + 全部子节点），不可拆解
> —— CLAUDE.md §二.3

拖动 Handle 移动 Container 时，所有子 Block 跟随移动。

### 5.2 溶解（unwrap）

HandleMenu "转换成 → 文本" 时，Container 溶解：

```
溶解前：                    溶解后：
callout                    textBlock "提示"
  ├── textBlock "提示"     textBlock "内容"
  └── textBlock "内容"
```

嵌套 Container 递归溶解或保留（取决于具体类型）。

---

## 六、键盘交互

### 6.1 Enter

| 场景 | 行为 |
|------|------|
| 子 TextBlock 有内容 | 在 Container 内分裂 TextBlock |
| 子 TextBlock 空行 | 退出 Container（TextBlock 移到 Container 之后） |
| 嵌套 Container 内空行 | 先退出内层 Container，再空行退出外层 |

```
callout
  ├── textBlock "提示"
  ├── bulletList
  │     ├── textBlock "要点"
  │     └── textBlock ""     ← 空行 Enter
  ├── textBlock ""           ← 退出 bulletList，回到 callout 内
  │                          ← 再次空行 Enter
textBlock ""                 ← 退出 callout
```

### 6.2 Tab / Shift+Tab

| 操作 | 行为 |
|------|------|
| Tab（在 Container 内） | 将当前 TextBlock 包裹进新的子 Container（嵌套一级） |
| Shift+Tab（在嵌套 Container 内） | 将当前 TextBlock 提升到父 Container |
| Shift+Tab（在顶层 Container 内） | 退出 Container |

### 6.3 Backspace（行首）

| 场景 | 行为 |
|------|------|
| Container 第一个子节点行首 | 退出 Container（unwrap 当前 TextBlock） |
| Container 非首子节点行首 | 与上一个子节点合并 |

### 6.4 SlashMenu

在 Container 内输入 SlashMenu 创建新 Container → 嵌套：

```
orderedList
  ├── textBlock "步骤一"
  ├── textBlock "/bullet"   ← SlashMenu
  │
  ├── bulletList             ← 创建嵌套 Container
  │     └── textBlock ""     ← 光标在这里
  └── textBlock "步骤二"
```

---

## 七、与 TextBlock、RenderBlock 的关系

| | TextBlock | RenderBlock | ContainerBlock |
|---|---|---|---|
| **内容** | inline 流 | renderer 决定 | 子 Block 组织 |
| **用户输入** | 直接打字 | 专属 UI | 在子 Block 中操作 |
| **content** | `inline*` | 由 renderer 决定 | `block+` |
| **嵌套** | 不嵌套 | 不嵌套（可有 contentDOM） | ✅ 可嵌套任何 Block |
| **视觉装饰** | marks（bold/italic） | toolbar + 渲染区 | 背景/边框/标记符号 |
| **扩展方式** | 新增 inline/mark | 注册 renderer | 创建新 ContainerBlock |

共享的：Handle、拖拽、删除、Block Selection、indent。

---

## 八、groupType 的废弃

### 8.1 为什么废弃

groupType 是 TextBlock 的 attrs 变体，用于模拟容器行为。但它有根本缺陷：

- **无法视觉包裹**：callout 背景不能延伸到嵌套的 bullet
- **扁平结构**：没有物理上的父子关系，嵌套靠 indent 模拟
- **两套系统**：Container 节点 + groupType 变体并存，概念混乱

### 8.2 迁移对照

| groupType 变体 | 迁移为 |
|---------------|--------|
| `groupType: 'bullet'` | `bulletList > textBlock` |
| `groupType: 'ordered'` | `orderedList > textBlock` |
| `groupType: 'task'` | `taskList > textBlock` |
| `groupType: 'quote'` | `blockquote > textBlock` |
| `groupType: 'callout'` | `callout > textBlock`（已是 Container） |
| `groupType: 'toggle'` | `toggleList > textBlock`（已是 Container） |
| `groupType: 'frame'` | `frameBlock > textBlock`（已是 Container） |

### 8.3 TextBlock 瘦身

废弃 groupType 后，TextBlock 的 attrs 简化为：

```typescript
interface TextBlockAttrs {
  level: 1 | 2 | 3 | null;       // 标题级别
  isTitle: boolean;                // 文档标题
  open: boolean;                   // heading 折叠

  indent: number;                  // 缩进（仅普通段落使用）
  textIndent: boolean;             // 首行缩进
  align: 'left' | 'center' | 'right' | 'justify';
}
```

不再需要 `groupType`、`groupAttrs`。TextBlock 回归本职——纯文字流。

### 8.4 基类共享 Attrs 更新

Block 基类的共享 attrs 也简化：

```typescript
interface BlockBaseAttrs {
  indent: number;
  textIndent: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  // groupType 和 groupAttrs 移除
}
```

---

## 九、各 ContainerBlock 简要定义

### 9.1 bulletList

```typescript
{
  name: 'bulletList',
  content: 'block+',
  // 子 textBlock 标记：• ◦ ▪（按嵌套层级循环）
  // NodeView：列表外壳 + contentDOM
}
```

### 9.2 orderedList

```typescript
{
  name: 'orderedList',
  content: 'block+',
  attrs: { start: { default: 1 } },
  // 子 textBlock 标记：1. 2. 3.（自动递增）
  // 嵌套层级：数字 → 字母 → 罗马
}
```

### 9.3 taskList

```typescript
{
  name: 'taskList',
  content: 'block+',
  // 子 textBlock 标记：☐/☑（可点击切换）
  // checked 状态存储在子 textBlock 的 attrs 或 Container 的 decoration
}
```

### 9.4 blockquote

```typescript
{
  name: 'blockquote',
  content: 'block+',
  // 视觉：左侧竖线 + 灰色文字 + 斜体
  // 竖线自然延伸到所有子内容
}
```

### 9.5 callout（已实现）

```typescript
{
  name: 'callout',
  content: 'block+',
  attrs: { emoji: { default: '💡' } },
  // 视觉：emoji + 背景色，包裹所有子内容
}
```

### 9.6 toggleList（已实现）

```typescript
{
  name: 'toggleList',
  content: 'block+',
  // 首行折叠箭头，子内容可折叠
  containerRule: { requiredFirstChildType: 'textBlock' },
}
```

### 9.7 frameBlock（已实现）

```typescript
{
  name: 'frameBlock',
  content: 'block+',
  attrs: { color: { default: '#8ab4f8' } },
  // 彩色左边框
}
```

---

## 十、Tab 升级能力

### 10.1 原则

任何 ContainerBlock 都天然支持升级为多 Tab 形态。这是 Container 基类的**内建能力**，不需要各 Container 独立实现。

```
单一视图：                    升级为多 Tab：
blockquote                    blockquote
  └── textBlock "引用"          Tab栏: [原文] [翻译]
                                ├── tabPane[原文]
                                │     └── textBlock "引用"
                                └── tabPane[翻译]
                                      └── textBlock "翻译内容"
```

### 10.2 TabContainer 基础设施

Tab 能力由三个共享模块提供：

| 模块 | 职责 |
|------|------|
| **Tab 栏**（tab-bar） | Tab 按钮 + Action 按钮 + 切换回调 |
| **内容区域**（tab-content） | 渲染型面板 + 编辑型面板 + 显示/隐藏 |
| **tabPane NodeView** | 编辑型面板的 ProseMirror 子容器 |

### 10.3 两种面板类型

| 类型 | 说明 | 数据 |
|------|------|------|
| **渲染型**（Rendered） | 纯 DOM，不参与文档模型 | NodeView 内部管理 |
| **编辑型**（Editable） | ProseMirror tabPane 子节点 | 存储在文档树中 |

### 10.4 布局

```
┌─ Container ────────────────────────────┐
│  [Tab A] [Tab B] [Tab C]   [按钮...]  │  ← Tab 栏
│  ┌─────────────────────────────────┐   │
│  │  Tab A 面板 (可见)               │   │  ← 内容区域
│  │  Tab B 面板 (隐藏)               │   │    所有面板共享同一空间
│  └─────────────────────────────────┘   │
│  caption (始终可见)                     │  ← 底部 caption
└────────────────────────────────────────┘
```

### 10.5 升级时机

- 用户显式操作（不自动升级）
- 例：blockquote 添加"翻译" Tab、callout 添加"备注" Tab
- Container 的 content 表达式从 `block+` 扩展为 `tabPane+ block*` 或按需定义

### 10.6 各 Container 的 Tab 升级示例

| Container | 单一视图 | 多 Tab |
|-----------|---------|--------|
| blockquote | 引用内容 | [原文] [翻译] |
| callout | 提示内容 | [提示] [详情] |
| bulletList | 列表内容 | [列表] [大纲] |
| codeBlock* | 代码 | [代码] [运行结果] |

*codeBlock 是 RenderBlock，Tab 升级逻辑相同但通过 RenderBlock 基类提供。

---

## 十一、实施路径

### Phase 1：补全 Container 节点

1. 新建 `bulletList` BlockDef（NodeView + content: 'block+'）
2. 新建 `orderedList` BlockDef（同上 + 编号逻辑）
3. 新建 `taskList` BlockDef（同上 + checkbox）
4. 确认现有 Container（callout、blockquote、toggleList、frameBlock）schema 兼容

### Phase 2：修改创建入口

1. SlashMenu：`/bullet` 创建 `bulletList > textBlock`
2. Markdown 快捷：`- ` 创建 bulletList，`1. ` 创建 orderedList
3. HandleMenu 转换：用 Container 包裹

### Phase 3：键盘交互

1. Enter 分裂/退出 Container
2. Tab 嵌套 / Shift+Tab 提升
3. Backspace 行首退出

### Phase 4：废弃 groupType

1. 移除 `groupType`、`groupAttrs` 从 TextBlock attrs
2. 移除 `group-decoration.ts`、`group-keyboard.ts`
3. 移除 `format-inherit.ts` 中的 groupType 继承
4. 数据迁移：旧文档 `textBlock { groupType }` → Container 包裹
5. 更新 `base-classes.md` 三基类定义

---

## 十二、开发新 ContainerBlock 的检查清单

- [ ] 实现 BlockDef（name + nodeSpec + capabilities + containerRule）
- [ ] nodeSpec `content` 包含 `block`
- [ ] NodeView 提供 `dom`（视觉装饰）+ `contentDOM`（子内容区域）
- [ ] 子节点标记渲染（CSS / Decoration / NodeView 内部逻辑）
- [ ] Enter 退出逻辑（空行 → 退出到父级）
- [ ] Backspace 行首退出
- [ ] Tab 嵌套 / Shift+Tab 提升
- [ ] turnInto paragraph（溶解）
- [ ] HandleMenu / SlashMenu 注册
- [ ] CSS 暗色主题
- [ ] 嵌套测试：Container 内放 Container、TextBlock、RenderBlock

---

## 十三、设计原则

1. **Container 只管组织**——它包裹子 Block，不产生自己的内容
2. **渲染从内到外**——子节点先渲染，Container 再包裹，视觉装饰自然延伸
3. **content: 'block+' 即嵌套**——任何 block 都可以是子节点，包括其他 Container
4. **整体移动不可拆解**——Container + 所有子节点一起移动/复制/删除
5. **空行退出**——在 Container 内空行 Enter 退出到父级，最直觉的交互
6. **不修改基类行为**——Handle、拖拽、选中等由 Block 基类统一处理

---

*本文档为 ContainerBlock 基类契约。修改需全体评审。*
*新增 Container 只需遵循检查清单，不需要修改本文档。*
