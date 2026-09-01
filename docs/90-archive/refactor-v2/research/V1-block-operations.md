# V1 笔记 Block 操作研究 — V2 接口规约设计输入

> **本文与 [V1-function-mapping.md](./V1-function-mapping.md) 的关系**:
> 后者是"V1 全部功能 → V2 capability 映射"的横向研究(§ 4 双轴矩阵覆盖到基础 block 层),
> 本文是"V1 特殊 block 操作 → V2 BlockSpec 接口规约"的纵深研究(从基础 block 层往下钻)。
>
> 两份文档互补:横向看用户能干什么 + 工程归到哪个 capability;纵向看每种特殊 block 在每个接口点的特化行为。
>
> **研究目的**:V1 的不稳定症状大量集中在 block 操作不一致 — 嵌套容器 + 节点位置计算是返工重灾区。本文把 V1 这层散落的特化逻辑提炼成 BlockSpec 接口,V2 每加新 block 走注册接口,不再改 text-editing capability 内部代码。
>
> **不是**:V1 block 代码搬迁清单 / V2 实施步骤 / API 规范。
>
> **是**:**抽象推演** — V1 病例诊断 + 8 接口点定义 + 5 示例 block 横切对比 + 嵌套位置计算专题 + V2 BlockSpec 接口设计输入。
>
> 文档版本:v0.2(填肉完成版)
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,L6+ 加特殊 block 之前必读
> 相关 V1 代码:`src/plugins/note/blocks/`(30+ block 定义)+ `src/plugins/note/registry.ts`(blockRegistry)+ `src/plugins/note/types.ts`(BlockDef)

---

## 0. 研究方法 + 为什么这是独立文档

### 0.1 V1 不稳定症状 — 集中在 block 操作的不一致

V1 用户反馈和 git commit 历史里反复出现的"奇怪行为",有 80% 集中在以下场景:

- 在 table cell 里粘贴一段笔记 → cell 被替换 / 整个 table 错位
- 数学块选中后按 Backspace → 有时删 block,有时跑到上一段
- toggle list 折叠状态下 Cmd+A 全选 → 选区行为飘忽
- 列表末尾空行 Enter → 有时新建 list item,有时退出列表(用户预期不一致)
- 代码块内拖动复制 → CodeMirror 编辑器把事件吃了,块手柄不响应
- 跨容器拖动 block 到 callout → 有时 callout 整体替换,有时正确插入
- 在 callout / blockquote 内多块选中 + 删除 → 容器被一起删了

这些症状的**共同根因**:每种特殊 block 在键盘 / 选区 / 粘贴 / 拖放 / 删除时**都有自己的特化行为**,但 V1 把这些特化散落在 30+ 块定义、若干 plugin、若干 commands 里,**没有统一接口**。一处改坏波及全局。

### 0.2 嵌套 + 节点位置计算 = 返工重灾区

V1 的 block 病例核心是"位置计算":

- PM 的 ResolvedPos 给的 depth / index / before / after,在嵌套容器里非常容易差 1
- `posAtCoords` 在容器边界给出错位置,V1 引入 `pickChildByY`(DOM 命中)兜底
- block-handle 找"手柄目标"要从光标向上找第一个 doc / container 的子(`findHandleTargetDepth`)
- block-selection 进入容器时要决定是穿透还是整体(`cascadeBoundary`)
- container-keyboard 处理 Enter / Backspace 时要分 column / taskItem / RenderBlock caption 多情况(就 `container-keyboard.ts` 一个文件 V1 写到 200+ 行)

这些都是"嵌套结构 + 位置计算"的复杂度爆炸。V2 必须在协议层面提供**安全的位置 helper**(由 text-editing capability 统一暴露),让 BlockSpec 不需要直接处理位置算术。

### 0.3 V1 的接口已有 BlockDef,但接口点不完整

V1 已经有 `BlockDef` 接口(`types.ts`):
```ts
interface BlockDef {
  name: string; group: 'block' | 'inline' | '';
  nodeSpec: NodeSpec;
  nodeView?: NodeViewFactory;
  capabilities: BlockCapabilities;  // 字典形式,有 cascadeBoundary / canDrag / canDelete 等
  customActions?: ActionDef[];      // HandleMenu 自定义操作
  slashMenu?: SlashMenuDef | null;  // 自动注册到 slashItems
  shortcuts?: Record<string, Command>;
  enterBehavior?: EnterBehavior;    // { action, exitCondition }
  onIndent? / onOutdent?;
  plugin?: () => Plugin | Plugin[];
  containerRule?: ContainerRule;    // 当前几乎为空 {}
  converter?: AtomConverter;
}
```

V2 BlockSpec 大体可以承袭这个形态,但要做这些调整:
- 把 `cascadeBoundary` 从 capabilities 字典提到顶层(它是结构性字段,影响 selection / drag / delete 行为)
- `containerRule` 当前形态太简陋(只有一个 `requiredFirstChildType`),要扩展或重新设计
- 加 `selectionBehavior` 显式声明(V1 默认推断,V2 显式更稳)
- 加 `pasteGuard` 显式接口(V1 通过 nodeSpec.isolating + 各种隐式约定实现)
- 加 `serializers / parsers` 显式接口(V1 序列化全 hardcode 在 selection-to-markdown.ts 里)
- L4 已有 slash-registry / handle-registry,BlockSpec 不再内嵌 slashMenu / customActions,改为 BlockSpec 提供"我要注册到这些 registry 的内容"

### 0.4 单立文档的理由

- 细节多:30+ block 类型 × 8 接口点,矩阵式信息
- 病例多:V1 不稳定症状 80% 集中在这层
- 接口设计需要专门验证:与 V2 通用 capability 协议(selection / clipboard / dnd / undo)的边界
- 实施分阶段(L5-A/B/C/L6+/L7+)节奏需要单独规划

V1-function-mapping § 4 矩阵作为"基础 block 层视图"继续使用,本文是它的纵深附录。

---

## 1. V1 病例诊断 — block 操作的典型不一致(7 类)

### 1.1 嵌套容器 selection 边界

**症状**:block-selection plugin 进入嵌套容器(callout / list / blockquote)时,选不选嵌套容器自身?用户的预期是:
- callout / blockquote / list:进入内部选具体子块(可拆解)
- table / columnList:作为整体不可拆,不递归进入

**V1 实现**:`plugins/block-selection.ts:isCascadeBoundaryType` 检查 `BlockDef.capabilities.cascadeBoundary`;若 true,容器作为单位置加入选区列表;若 false 且容器展开,递归收集子块。

**关键代码**(`block-selection.ts:49-67`):
```ts
function collectBlockPositions(parent, baseOffset, positions) {
  parent.forEach((node, offset) => {
    if (isContainerType(node.type.name)) {
      if (isCascadeBoundaryType(node.type.name)) {
        positions.push(absPos);  // table / columnList 整体加入
      } else if (node.attrs.open === false) {
        positions.push(absPos);  // 折叠的容器整体加入
      } else {
        collectBlockPositions(node, absPos + 1, positions);  // 展开的容器递归
      }
    } else {
      positions.push(absPos);
    }
  });
}
```

**给 V2 的协议警示**:
- BlockSpec 必须显式声明"是不是 cascadeBoundary"(整体不可拆)— 这是结构性字段,提到 BlockSpec 顶层
- BlockSpec 必须显式声明"是不是 container"(content 含 block+ 类)— V1 只有 `containerRule: {}` 占位,V2 应该精确
- 折叠状态(`open === false`)影响容器性 — V2 BlockSpec 的 containerRule 可能要支持函数形式 `(node) => 'leaf' | 'container'`

### 1.2 posAtCoords 在容器边界给错位置

**症状**:用户在容器(如 callout 边距)区域 hover,期望显示该容器某个子块的拖动手柄。但 PM 的 `view.posAtCoords` 在 margin / 行高外区域返回的是**容器层级**的 pos,而非具体子块的 pos。

**V1 实现**:`plugins/block-handle.ts:pickChildByY` 兜底 — 当 posAtCoords 给容器层级时,按鼠标 Y 坐标在容器子节点中找包含 Y 的那个,递归处理嵌套容器。

**关键代码**(`block-handle.ts:50-78`):
```ts
function pickChildByY(view, containerStart, containerNode, mouseY) {
  let offset = containerStart + 1;
  for (let i = 0; i < containerNode.childCount; i++) {
    const child = containerNode.child(i);
    const dom = view.nodeDOM(offset);
    const rect = dom?.getBoundingClientRect();
    if (mouseY >= rect.top && mouseY <= rect.bottom) {
      if (isContainerType(child.type.name)) {
        return pickChildByY(view, offset, child, mouseY);  // 递归
      }
      return { start: offset, node: child, dom };
    }
    offset += child.nodeSize;
  }
  return null;
}
```

**给 V2 的协议警示**:
- "鼠标位置 → 块落点"是通用计算,不应该让每个 block 自己实现 — 由 text-editing capability 统一暴露 `findBlockAtCoords(coords)` helper
- helper 内部要走 V1 同款的 posAtCoords + pickChildByY 二次兜底,以及处理 cascadeBoundary 的特殊情况
- BlockSpec 不直接处理 coords,只声明"我接什么 dropTarget" → drag-and-drop capability 调 helper

### 1.3 smart-paste 在 table cell 内冲突

**症状**:在 table cell 内粘贴一段含 table 的 HTML(从 Word / Excel 复制过来)时,行为不可预测 — 有时 cell 被替换,有时整个 table 错位。

**V1 根因**:`prosemirror-tables` 的 `tableEditing` plugin 内部有 `handlePaste`,在 table cell 内吃掉 paste 事件。如果 KRIG 的 `smartPastePlugin` 注册在 `tableEditing` 之后,smart-paste 永远不会被调到,KRIG 内部剪贴板通道(无损还原 mathInline 等 atom)在 table 内失效。

**V1 临时方案**:NoteEditor.tsx 第 233-238 行的长注释:
```
smart-paste 必须排在 blockPlugins 之前:prosemirror-tables 的 tableEditing.handlePaste
会在 table 内吃掉 paste 事件,若 smart-paste 在其后注册,KRIG 内部剪贴板通道
(无损还原 mathInline 等 atom 节点)在 table cell 内永远不会被调用。smart-paste
外部通道对"HTML 含 table"的情况会走 markdown 路径插入,可能和 tableEditing 的
cell 填充语义冲突——若后续观察到回归,再在 smart-paste 外部通道加"table 内让位"判断。
```

**给 V2 的协议警示**:
- plugin 优先级是 BlockSpec 必须声明的字段(粘贴接管点 / 让位点),不能靠"隔壁文件长注释"约定
- BlockSpec 应有 `pasteGuard?: { mode: 'accept' | 'reject' | 'delegate', filter? }` — accept/reject 是块内粘贴的过滤,delegate 让位通用 dispatcher
- clipboard capability 的 dispatcher 注册时要按 BlockSpec 优先级排序,不依赖 import 顺序

### 1.4 codeBlock 的 textarea-like content 与 PM 选区冲突

**症状**:代码块内是纯文本,但用户期望:
- Tab 缩进当前行(不是退出代码块)
- Enter 普通换行(不是 splitBlock)
- 语法高亮(20+ 语言)
- 拖动 / 复制按钮在 toolbar 而非依赖 PM 选区

**V1 实现**:`blocks/code-block.ts` 内 NodeView 嵌套了一个 **CodeMirror 编辑器**实例(`@codemirror/view`)。代码块的 contenteditable 区域被 CodeMirror 接管,PM 的事件不直达。同时挂 `plugins/code-block-keyboard.ts` 处理跨界的特殊键(如代码块外 Backspace 进入代码块)。

**关键代码**(`code-block.ts:97-100`):
```ts
const codeBlockNodeView: NodeViewFactory = (node, view, getPos) => {
  // 内部用 CodeMirror,PM contentDOM 不暴露 textContent
  // 通过 cmDarkTheme + cmDarkHighlight + lineNumbers + indentWithTab 装配 CM
};
```

**给 V2 的协议警示**:
- "块内有自己的 keyboard / selection 接管"是常见模式(代码块 / 数学块 / mermaid 块同),不是临时 plugin
- BlockSpec 应有 `editingMode: 'inline' | 'embedded' | 'popover'` 标准化:
  - inline:PM 默认(textBlock / list / blockquote)
  - embedded:NodeView 内嵌外部编辑器(codeBlock 用 CM,可能用 Monaco)
  - popover:点击进入弹窗编辑(mathBlock 用 LaTeX 编辑器)
- BlockSpec.selectionBehavior 跟 editingMode 配合:embedded / popover 时通常是 NodeSelection

### 1.5 mathBlock 是 leaf 但用户感知是"独立编辑器"

**症状**:数学块在 PM 是 leaf node(atom,无子节点),用户单击该 block 时进入 NodeSelection。但用户期望:
- 双击该 block 进入 LaTeX 编辑模式(弹出编辑面板)
- 编辑期间该 block 视觉上保持"被聚焦",其他 block 失焦
- 退出编辑(Esc / 点外面)→ 重新渲染 KaTeX

**V1 实现**:`blocks/math-block.ts` NodeView 内部维护 `editing: boolean` 状态,管理:
- 全局 mousedown 监听(`activeMathEditors` Set + 单一 `onGlobalMouseDown`)
- 共享 IntersectionObserver(lazy 渲染 KaTeX,所有 mathBlock 复用 1 个 observer)
- popover 编辑器(`showMathPanel` / `hideMathPanel` from `help-panel/latex`)

**给 V2 的协议警示**:
- BlockSpec.editingMode = 'popover' 是标准化点 — 不让每个块各自实现"全局点外退出"逻辑
- text-editing capability 内置"popover 编辑生命周期管理"(谁在编辑 / 自动退出 / 与 NodeSelection 切换)
- BlockSpec 提供 `renderRendered(node)` / `renderEditor(node)` 两个钩子,capability 负责切换显示

### 1.6 列表 Enter 末尾的特殊行为

**症状**:用户在 list item 末尾 Enter 的预期:
- 当前 list item 有内容 → 新建空 list item
- 当前 list item 为空(Enter 第二次) → 退出列表回到段落

V1 默认 PM 行为是 splitBlock,只新建 item,不会退出列表。如果不特化,空 item Enter 会一直新建空 item 永远退不出来。

**V1 实现**:`plugins/container-keyboard.ts`(200+ 行)统一处理所有 ContainerBlock 的 Enter / Backspace:
```ts
// container-keyboard.ts:62-160(摘录)
if (event.key === 'Enter') {
  const isEmpty = childNode.content.size === 0;
  if (isEmpty && isColumn && columnListDepth >= 0) { /* column 退出特化 */ }
  else if (isContainer) {
    if (isEmpty) {
      // 空行 + Enter → 退出 Container
      const containerEnd = $from.after(containerDepth);
      // 在 Container 后方插入新 textBlock
    } else {
      // 有内容 + Enter → 在 Container 内 splitBlock
    }
  }
}
```

**给 V2 的协议警示**:
- BlockSpec 已有 `enterBehavior: { action, exitCondition }`(V1 接口)— V2 应该保留这个形态
- 但 V1 的 container-keyboard plugin 是**集中处理所有容器**的形式,不是每个 BlockSpec 自己处理 — V2 应该:
  - BlockSpec 声明 `enterBehavior` (action / exitCondition)
  - text-editing capability 内置一个"统一容器键盘 plugin",读所有 BlockSpec 的 enterBehavior 综合处理
  - column / taskItem / RenderBlock caption 等特殊容器的特化逻辑通过 BlockSpec.enterBehavior 的细粒度参数(如 `exitTarget: 'parent' | 'grandparent'`)解决

### 1.7 toggle list 折叠态下的多块操作

**症状**:toggle list 折叠 (`open=false`) 时,内部子块**视觉上不可见**,但**数据上仍存在**。用户期望:
- 折叠 toggle 在 selection 中作为单 block(不递归选内部子块)
- 折叠 toggle 在 ↑/↓ 导航中作为单 block(光标不进入内部)
- 删除折叠 toggle = 删除整个 toggle 含其子块

**V1 实现**:`block-selection.ts:53-66` 在递归 `collectBlockPositions` 时检查 `node.attrs.open === false`,如是则不递归进内部。block-handle 同样处理。

**给 V2 的协议警示**:
- "block 状态影响它是不是容器"是个**真实存在的需求**(toggle 折叠 / heading 折叠都是)
- BlockSpec.containerRule 不是静态字段,可能需要 `containerRule(node) => 'leaf' | 'container'` 函数形式
- 或者:BlockSpec 提供 `effectiveContainer(node)` helper,默认返回 containerRule 静态值,toggle / heading 重写

---

## 2. block 接口规约 — 8 接口点 × 5 示例 block 横切表

5 个示例 block 覆盖 5 种典型模式:
- **textBlock**:基础(段落 / 标题,所有列填 default)
- **mathBlock**:leaf + popover 编辑(NodeSelection + 自管全局监听)
- **codeBlock**:embedded 编辑器(NodeView 内嵌 CodeMirror)
- **table**:嵌套容器 + cascadeBoundary + tableEditing 全局 plugin
- **bulletList**:同族列表(与 orderedList / taskList / toggleList 共享 enterBehavior 模式)

### 2.1 横切表(每格简述,详细规则在 § 3)

| 接口点 \ Block | textBlock | mathBlock | codeBlock | table | bulletList |
|---|---|---|---|---|---|
| **1. schema spec** | `content: 'inline*'` group=block,defining=true,attrs(level/isTitle/indent/textIndent/align)| `atom: true`(leaf),attrs(latex/color/bgColor) | `content: 'text*'`,code: true,marks: '_'(禁所有 mark),isolating | `content: 'tableRow+'`,isolating,tableRole='table' | `content: 'block+'`,defining=true |
| **2. NodeView** | 仅 noteTitle 有(普通 textBlock 走 toDOM)| KaTeX 渲染 + popover 编辑 + 全局 mousedown 退出 | NodeView 内嵌 CodeMirror,toolbar(语言选择 / 复制 / 下载 / 全屏)| tableNodeView(prosemirror-tables 提供) | div.bullet-list,contentDOM 直透 |
| **3. keymap / 块内键盘** | 走 baseKeymap + container-keyboard 统一处理 | 无(leaf 不接管)| code-block-keyboard plugin + CM 自带 keymap(Tab 缩进 / Enter 普通换行)| tableKeymap(Tab 跳 cell / Enter cell 内换行)+ tableEditing | container-keyboard 统一(Enter 末尾空行退出)|
| **4. 选区行为** | TextSelection | NodeSelection(selectNode 加视觉反馈)| NodeSelection(选 block)+ CM 内部自管字符级选区 | CellSelection(prosemirror-tables 自定义 Selection 类型)+ block 级整体选 | TextSelection(光标在子 textBlock 里)|
| **5. 粘贴守卫** | 接受 inline + block(default)| 不接受任何粘贴(leaf 无 contentDOM)| 只接 plain text(走 CM 自己的粘贴 / PM smart-paste 让位)| tableEditing 接管 cell 内粘贴(智能 cell-aware)| 接受 list item / 平铺 paragraph / 自动包成 list item |
| **6. 序列化** | toMarkdown:行首 `#` × level / inline 内容 | toMarkdown:`$$\nlatex\n$$` | toMarkdown:```` ```lang\ncode\n``` ```` | toMarkdown:`\| ... \|` Markdown 表 + 分隔行 | toMarkdown:`- item` 嵌套缩进 |
| **7. input-rules** | `# / ## / ### / # 后空格` → heading;`> ` → blockquote(其他 block)| `$$ ` → mathBlock(行首)| ` ```lang ` → codeBlock | 无 input-rule(从 / menu 创建)| `- ` / `* ` / `+ ` → bulletList |
| **8. 容器规则** | leaf-of-block(不是容器)| leaf(无子节点)| leaf-text(内含 text 但不可拆,isolating)| **container + cascadeBoundary**(整体不递归)| container(允许递归嵌套)|

### 2.2 表格读法

每行一个接口点,每列一种 block 的特化。读法举例:

- **看 textBlock 列**:这是基础块,大部分接口点都是 default,V1 实现就是 PM 默认 + 一些 mark / heading level 扩展
- **看 mathBlock 列 vs codeBlock 列**:都是"块内有特殊编辑模式",但 mathBlock 是 popover(leaf + 弹窗),codeBlock 是 embedded(NodeView 嵌入 CM)— 两种 editingMode 标准化点
- **看 table 列**:几乎每行都不一样 — table 是 V1 最特殊的 block,引入了 prosemirror-tables 全套(独立 plugin / Selection 类型 / NodeView)
- **横向看接口点 4(选区行为)**:5 种模式各不同(TextSelection / NodeSelection / NodeSelection+CM / CellSelection / TextSelection)— 这正是 selection capability discriminated union by `kind` 的输入材料

---

## 3. 接口点核心机制详解(8 节)

每节定义接口点 + 默认实现 + 何时特化 + 与通用 capability 边界。

### 3.1 schema spec(nodeSpec)

**接口点**:每个 block 通过 PM NodeSpec 声明节点形状。

**核心字段**:
- `content`:子节点表达式(如 `inline*` / `block+` / `tableRow+` / `text*`)
- `group`:`'block' | 'inline' | ''`(空字符串 = 仅作为子组件,如 tableRow / column)
- `attrs`:节点属性(level / isTitle / language / latex / 等)
- `defining`:删除时是否保留为独立块(`true` 让该 block 在退格时保护边界)
- `isolating`:粘贴时是否阻断 slice 跨界(table / table cell 用,防止粘贴破坏结构)
- `atom`:无子节点的 leaf(mathBlock / horizontalRule)
- `code`:内容是纯代码(禁 mark)
- `marks`:允许的 mark(空字符串 `''` 禁所有)
- `parseDOM` / `toDOM`:HTML 双向转换
- `tableRole`(prosemirror-tables 用):`'table' | 'row' | 'cell' | 'header_cell'`

**何时特化**:大部分 block 都需要;复杂的特化在 attrs(table 的 colspan / colwidth / align)和 isolating(防止结构破坏)。

**V2 协议**:BlockSpec.schema 直接把 NodeSpec 包过来。框架级在 buildSchema 时**自动注入通用 attrs**(V1 已有,见 registry.ts:69-79):
```ts
// 框架强制注入 block group 的通用 attrs
indent: { default: 0 },
fromPage: { default: null },
frameColor / frameStyle / frameGroupId / frameThoughtId
```
V2 应该保留这种机制,但**显式化**为 BlockSpec.commonAttrs?(让 BlockSpec 知道哪些是框架强制 + 选择性 opt out)。

### 3.2 NodeView 渲染

**接口点**:NodeView 工厂,接 (node, view, getPos) → { dom, contentDOM?, update?, selectNode?, deselectNode?, stopEvent?, ignoreMutation?, destroy? }。

**默认实现**:不提供 NodeView → PM 走 toDOM。

**何时特化**:
- 渲染需要 DOM 之外的逻辑(KaTeX / CodeMirror / Mermaid)
- 需要交互按钮 / toolbar(image 的上传 / video 的全屏)
- 需要 contenteditable=false 边界(非编辑区不接受光标)
- 需要 selection 视觉反馈(selectNode / deselectNode)
- 需要外部状态同步(全局 mousedown / IntersectionObserver)

**V1 模式**:render-block-base.ts 提供 `createRenderBlockView(renderer, blockType)` 工厂,统一骨架(toolbar + content + 复制按钮 + selectNode 视觉)。image / audio 用基类,video / tweet / mathBlock / codeBlock 自定义。

**V2 协议**:
- BlockSpec.nodeView 直接是 NodeViewFactory(承袭 V1)
- 提供 createRenderBlockView 类似的 helper(在 text-editing capability 暴露,不是每个 block 重复造)
- update 方法在 schema 跨版本兼容时关键(见 § 8.7)

### 3.3 keymap(块内特殊键盘)

**接口点**:块内特殊键盘行为,通常在父级 plugin 或独立 plugin 中处理。

**两种实现路径**:

**路径 A:plugin 拦截**(V1 主要方式)
- container-keyboard plugin 集中处理所有 container 的 Enter / Backspace
- code-block-keyboard plugin 单独处理 codeBlock 内外光标
- 优点:统一处理,易维护
- 缺点:plugin 内部 if-else 容易膨胀(container-keyboard 200+ 行)

**路径 B:BlockSpec.keymap 字段**(V1 部分用 + V2 推荐)
- BlockSpec 声明自己的键盘绑定
- text-editing capability 在 buildPlugins 时聚合所有 BlockSpec.keymap
- 优点:每个 block 自治
- 缺点:多 block 同绑定时优先级问题

**V1 enterBehavior 接口**(types.ts:61-65):
```ts
interface EnterBehavior {
  action: 'split' | 'newline' | 'exit';
  exitCondition: 'empty-enter' | 'double-enter' | 'always';
}
```

**V2 协议建议**:
- BlockSpec 声明 `enterBehavior`(承袭 V1) + `keymap?: Record<string, Command>`(扩展)
- text-editing capability 内置一个 "block-keyboard plugin" 读所有 BlockSpec 综合处理(替代 V1 container-keyboard)
- 复杂特化(column / taskItem 退出目标不同)通过 enterBehavior.exitTarget 之类细粒度参数

### 3.4 选区行为(TextSelection / NodeSelection / 自定义)

**接口点**:用户操作该 block 时,选区是哪种类型?

**PM 三种 Selection**:
- `TextSelection`:字符级选区,光标 / 选中范围在 inline 节点之间
- `NodeSelection`:整块选中(leaf node 必为此)
- `AllSelection`:整个文档(罕用)

**V1 用到的"第四种"**:
- `CellSelection`(prosemirror-tables):table 内 cell 范围选区
- `block-selection plugin 状态`(V1 自创):多 block 选中,不是真 PM Selection 而是 plugin 内部状态

**与 selection capability 的边界**(对照 [V1-function-mapping § 5.1](./V1-function-mapping.md)):
- selection capability 暴露统一 channel `selection.changed { kind: 'text' | 'block' | 'multi-block' | ... }`
- 每种 block 把自己内部的"选区状态" emit 到 channel,UI 层(FloatingToolbar / ContextMenu / AskAIPanel)只订阅 channel 不知道底下哪种模式

**V2 协议**:
- BlockSpec 声明 `selectionBehavior: 'text' | 'node' | 'cell' | 'custom'`
- selection capability 接收 BlockSpec 注册时,知道该 block 会发什么 kind 的 selection event
- 'custom' 时 BlockSpec 提供 `getSelectionState(view) => SelectionPayload` 自定义包装

### 3.5 粘贴守卫(块内只接受什么)

**接口点**:粘贴落在该 block 内时,接受什么内容?

**V1 模式**(隐式):
- nodeSpec.isolating = true:阻断 slice 跨界(table 用)
- nodeSpec.code = true:禁所有 mark(codeBlock 用)
- atom = true:无 contentDOM,完全不接粘贴(mathBlock 用)
- smart-paste-plugin.ts:pasteIsSafe 守卫(检查粘贴后祖先链不破坏)
- 各 source handler(chatgpt / claude / etc.)在 dispatcher 里处理特定源

**V2 协议**:
- BlockSpec 显式声明 `pasteGuard?: { mode: 'accept' | 'reject' | 'delegate', filter? }`
  - accept:接受粘贴 + 调用 filter(slice) 过滤
  - reject:不接受任何粘贴(mathBlock)
  - delegate:让位给 clipboard capability 的 dispatcher(table 委托给 tableEditing)
- clipboard capability 在粘贴前先看落点 block 的 pasteGuard

### 3.6 序列化(toMarkdown / toHTML / toAtom)

**接口点**:把该 block 序列化成各种格式。

**V1 现状**(反例):
- `commands/selection-to-markdown.ts` 一个文件 hardcode 30+ block 的 toMarkdown(437 行)
- `internal-clipboard.ts` 用 PM 默认 DOMSerializer 生成 HTML
- `converters/` 提供 atom ↔ PM doc 双向(每个 block 一个 converter 文件)

**问题**:
- 加新 block 要改 selection-to-markdown.ts(中央集权,违反 OCP)
- 三种格式分散在三处(markdown 在 commands/,HTML 走 PM 默认,atom 在 converters/)

**V2 协议**:
- BlockSpec 提供 `serializers: { toMarkdown?, toHTML?, toAtom? }`
- 缺省时 capability 提供"通用降级"实现(toMarkdown 从 textContent / toHTML 从 PM toDOM / toAtom 从 attrs)
- `parsers: { fromMarkdown?, fromHTML?, fromAtom? }` 是反向(给 paste handler 用)

### 3.7 input-rules(自动转换语法 → 节点)

**接口点**:用户输入特定模式时自动转换为节点(如行首 `# ` → heading)。

**V1 实现**:`plugins/input-rules.ts` 集中收集,BlockSpec 不直接声明 input-rule(查 V1 代码,V1 buildInputRules 是 hardcode 在 plugin 内,不读 BlockDef)。

**V2 协议**:
- BlockSpec 提供 `inputRules?: InputRule[]`
- text-editing capability 在装配时聚合所有 BlockSpec.inputRules

### 3.8 容器规则(containerRule / cascadeBoundary)

**接口点**:这个 block 是不是容器?是不是整体不可拆?

**V1 字段**:
- `BlockDef.containerRule?: { requiredFirstChildType?: string }`(几乎为空 `{}`)
- `BlockDef.capabilities.cascadeBoundary?: boolean`(table / tableRow / tableCell / column / columnList 用)

**V1 隐式判断**:
- 是不是容器:看 `containerRule` 是否定义(即 `blockDef.containerRule !== undefined`)
- 是不是 cascadeBoundary:看 `capabilities.cascadeBoundary === true`
- 折叠状态:看 `node.attrs.open === false`(toggle / heading 折叠)

**V2 协议**:
- BlockSpec.containerRule 提升为顶层 `'leaf' | 'inline-only' | 'block+' | ((node) => ...)` 区分
  - `'leaf'`:无子节点(mathBlock / horizontalRule / pageAnchor)
  - `'inline-only'`:子节点是 inline(textBlock / paragraph / heading)
  - `'block+'`:子节点是 block(blockquote / callout / list / column)
  - 函数形式:动态(toggle 折叠 / heading 折叠)
- BlockSpec.cascadeBoundary 提升为顶层 boolean(table / table cell / columnList)— V1 在 capabilities 字典里,V2 提到顶层因为它影响 selection / drag / delete

---

## 4. block 嵌套与位置计算专题(返工重灾区)

### 4.1 PM 的 ResolvedPos 三种深度概念

`$pos = doc.resolve(pos)` 给一个**位置在文档树中的解析结果**。常用字段:

- `$pos.depth`:光标在嵌套第几层(doc=0,doc 直接子=1,再嵌套=2,...)
- `$pos.node(d)`:第 d 层的节点
- `$pos.parent`:`$pos.node($pos.depth)`(光标直接父节点)
- `$pos.before(d)` / `$pos.after(d)`:第 d 层节点的前 / 后位置(用于在该层级前后插入内容)
- `$pos.start(d)` / `$pos.end(d)`:第 d 层节点内部的起 / 终位置
- `$pos.index(d)`:光标在第 d 层节点的第几个子节点

**实际场景**:
- 光标在普通段落里:depth=1(doc → textBlock),`$pos.parent` = textBlock,`$pos.before(1)` = textBlock 前的位置
- 光标在 list item 里:depth=3(doc → bulletList → listItem → textBlock),`$pos.before(2)` = listItem 前
- 光标在 table cell 里:depth=4(doc → table → tableRow → tableCell → textBlock),`$pos.before(3)` = tableCell 前

### 4.2 容器嵌套时光标定位的常见错位

**错位 1:depth 差 1**
列表项内嵌段落 vs 列表项直接含 textBlock,depth 不同(差 1)。container-keyboard 处理时要用 $from.depth,不是 hardcode 数字。

**错位 2:cascadeBoundary 跳层**
table cell 内的 depth 是 4(doc → table → tableRow → tableCell → textBlock),但用户感知的"块"是 table 整体。block-handle 找手柄目标时要从 depth 向上找到第一个 doc / container 的子(`findHandleTargetDepth`),跳过 tableRow / tableCell 等中间层。

**错位 3:column 是中间容器**
columnList → column → block+。空行 Enter 在 column 内不应退出到 column 之后(那会破坏 columnList content),要跳到 columnList 之后。container-keyboard.ts:113-130 专门处理。

**错位 4:RenderBlock caption**
image / video / audio 有 caption(textBlock 子节点),但 image 本身不是 container。container-keyboard 引入 RENDER_BLOCK_TYPES Set 单独处理。

### 4.3 V1 已有的容错模式

V1 在反复返工中演化出 4 种容错模式:

| 模式 | 解决什么 | V1 代码 |
|---|---|---|
| `pickChildByY` | posAtCoords 在容器边界给容器层级 pos 时,DOM 命中递归找子块 | `block-handle.ts:50-78` |
| `cascadeBoundary` | 选区进入容器时是穿透还是整体 | `block-selection.ts:isCascadeBoundaryType` |
| `containerRule` 声明 | 标识"这是容器"(影响选区 / 键盘行为) | `BlockDef.containerRule` |
| `findHandleTargetDepth` | 从光标向上找第一个手柄目标(跳过中间 tableRow / tableCell) | `block-handle.ts:32-42` |

每个模式都是"位置算术错了一遍才加上的兜底"。V2 应该把这些模式**形式化为 helper**,而不是每次需要时重写。

### 4.4 V2 应该在协议里强制的"安全位置计算" helper

text-editing capability 内置 helper API:

```ts
// 由 text-editing capability 暴露,所有 block / capability 调用
interface PositionHelpers {
  /** 给定鼠标坐标,找该位置对应的"块"目标(自动处理 cascadeBoundary + DOM 命中兜底)*/
  findBlockAtCoords(view: EditorView, x: number, y: number): { pos: number; node: PMNode; depth: number } | null;
  
  /** 从 ResolvedPos 向上找第一个"手柄目标"(doc / container 的直接子) */
  findHandleTarget($pos: ResolvedPos): { pos: number; depth: number };
  
  /** 给定节点,判断它在当前文档树中是不是容器(考虑动态 containerRule)*/
  isEffectiveContainer(node: PMNode): boolean;
  
  /** 给定节点,判断它是不是 cascadeBoundary */
  isCascadeBoundary(node: PMNode): boolean;
  
  /** 给定容器节点,递归收集所有"可选择子块"位置(展开 vs 折叠不同行为)*/
  collectBlockPositions(parent: PMNode, baseOffset: number): number[];
  
  /** 给定 ResolvedPos,找"应该 splitBlock 到哪一层"(列表 vs 段落不同)*/
  findSplitTarget($pos: ResolvedPos): { depth: number; isContainerExit: boolean };
}
```

**作用**:
- BlockSpec 实现复杂行为时调 helper 而非自己算位置
- 通用 capability(selection / drag-and-drop)调 helper 而非读 BlockSpec.containerRule 等字段
- 单一来源,helper 修一次全局生效

### 4.5 测试用例清单(V2 实施时必跑)

V1 历史 bug 提炼出的回归测试用例(L5-A 实施 BlockSpec 接口时第一批就要跑):

| # | 用例 | 期望行为 |
|---|---|---|
| 1 | 列表项内 Enter 末尾空行 | 退出列表回到段落 |
| 2 | 列表项内 Backspace 行首空块 | 退出列表(unwrap) |
| 3 | 列表项嵌套段落,Enter 末尾 | 在列表项内创建新 list item(不退出)|
| 4 | column 内 Enter 末尾空行 | 退出 columnList(不破坏 column 容器)|
| 5 | RenderBlock caption(image)Enter 末尾空 | 退出到 image 之后新建 textBlock |
| 6 | RenderBlock caption Enter 双回车 | 退出 |
| 7 | RenderBlock caption Enter 普通(有内容)| 插入 hardBreak 软换行 |
| 8 | table cell 内粘贴含 table 的 HTML | tableEditing 接管 cell-aware paste |
| 9 | mathBlock 选中后 Backspace | 删除整个 mathBlock |
| 10 | mathBlock 双击进入编辑 | popover 编辑器打开 |
| 11 | toggle list 折叠态 ↑/↓ 导航 | 跳过整个 toggle(不进入子块) |
| 12 | toggle list 折叠态 Cmd+A | 选区不进入折叠内部 |
| 13 | block-selection 进入 callout | 递归选 callout 子块 |
| 14 | block-selection 进入 table | 选 table 整体(不递归)|
| 15 | 拖动 block 到 callout 边距 | pickChildByY 找正确落点(不替换 callout)|
| 16 | 多块选中删除 | 不级联删空容器(cascadeBoundary 守住)|

---

## 5. block 注册接口(V2 BlockSpec 落地形态)

### 5.1 BlockSpec 接口定义(草案)

```ts
import type { NodeSpec } from 'prosemirror-model';
import type { Plugin, Command } from 'prosemirror-state';
import type { InputRule } from 'prosemirror-inputrules';
import type { Node as PMNode } from 'prosemirror-model';
import type { Slice } from 'prosemirror-model';
import type { Atom } from '@shared/types/atom-types';
import type { NodeViewFactory } from '@capabilities/text-editing/types';

export interface BlockSpec {
  // ── 元数据 ──
  id: string;
  displayName: string;
  category: 'text' | 'media' | 'data' | 'embed' | 'special';
  group: 'block' | 'inline' | '';  // PM group(空 = 仅作为子组件,如 tableRow)
  
  // ── schema(接口点 1)──
  schema: NodeSpec;
  
  // ── NodeView(接口点 2)──
  nodeView?: NodeViewFactory;
  editingMode?: 'inline' | 'embedded' | 'popover';  // 渲染模式提示
  
  // ── 键盘(接口点 3)──
  keymap?: Record<string, Command>;
  enterBehavior?: {
    action: 'split' | 'newline' | 'exit';
    exitCondition: 'empty-enter' | 'double-enter' | 'always' | 'never';
    exitTarget?: 'parent' | 'grandparent';  // column / taskItem 用
  };
  
  // ── 选区行为(接口点 4)──
  selectionBehavior?: 'text' | 'node' | 'cell' | 'custom';
  getSelectionState?: (view: EditorView, node: PMNode) => SelectionPayload;
  // ↑ selectionBehavior='custom' 时必填,emit 到 selection capability channel
  
  // ── 粘贴守卫(接口点 5)──
  pasteGuard?: {
    mode: 'accept' | 'reject' | 'delegate';
    filter?: (slice: Slice) => Slice | null;  // accept 时过滤
  };
  
  // ── 序列化(接口点 6)──
  serializers?: {
    toMarkdown?: (node: PMNode, helpers: SerializerHelpers) => string;
    toHTML?: (node: PMNode) => string;
    toAtom?: (node: PMNode) => Atom;
  };
  parsers?: {
    fromMarkdown?: (text: string, schema: Schema) => PMNode | null;
    fromHTML?: (dom: HTMLElement, schema: Schema) => PMNode | null;
    fromAtom?: (atom: Atom, schema: Schema) => PMNode | null;
  };
  
  // ── input-rules(接口点 7)──
  inputRules?: InputRule[];
  
  // ── 容器规则(接口点 8)──
  containerRule?: 'leaf' | 'inline-only' | 'block+' | ((node: PMNode) => 'leaf' | 'block+');
  cascadeBoundary?: boolean;
  
  // ── 与通用 capability 的注册 ──
  
  /** 注册到 L4 slash-registry 的菜单项(L4 已有,BlockSpec 不再内嵌)*/
  slashItem?: { label: string; icon: string; group: string; keywords: string[]; order: number; attrs?: Record<string, unknown> };
  
  /** 注册到 L4 handle-registry 的额外动作 */
  handleActions?: { id: string; label: string; icon: string; handler: Command }[];
  
  /** 注册到 drag-and-drop capability 的 dropTarget(v1 留位,L5-B 用)*/
  dropAccepts?: ('block' | 'inline' | 'image-only' | string)[];
  
  /** 依赖的其他 BlockSpec(table 依赖 tableRow / tableCell)*/
  requires?: string[];
  
  // ── plugin(已有 plugin 不能拆解时)──
  plugin?: () => Plugin | Plugin[];
}
```

### 5.2 字段语义详解

| 字段 | 何时填 | 何时省略 | V1 对照 |
|---|---|---|---|
| id | 必填 | — | name |
| displayName | 必填 | — | slashMenu.label |
| category | 必填 | — | (V1 无,V2 加) |
| group | 必填 | — | group |
| schema | 必填 | — | nodeSpec |
| nodeView | 默认渲染不够时 | toDOM 够 | nodeView |
| editingMode | NodeView 涉及编辑模式 | 普通 NodeView | (V1 无) |
| keymap | 块内特殊键 | 用 baseKeymap | shortcuts |
| enterBehavior | 容器 / RenderBlock caption | leaf / textBlock 走默认 | enterBehavior |
| selectionBehavior | 非 'text' 都要填 | textBlock / list 等 inline 选区 | (V1 隐式推断)|
| pasteGuard | 块内有特殊接受规则 | 接受所有(textBlock 默认)| (V1 通过 isolating / code 隐式) |
| serializers | 自定义格式 | 用通用降级 | (V1 散落) |
| parsers | paste handler 需要解析回该 block | — | (V1 散落) |
| inputRules | 有自动转换 | 无 | (V1 不是 BlockDef 字段)|
| containerRule | 容器 / 动态 | leaf 类填 'leaf' | containerRule(简陋) |
| cascadeBoundary | table / column 类 | 普通容器 false | capabilities.cascadeBoundary |
| slashItem | 在 / 菜单出现 | 不需要(从其他途径创建)| slashMenu |
| handleActions | 块手柄菜单加自定义项 | 默认菜单够 | customActions |
| requires | 复合块(table) | 独立块 | (V1 注册顺序隐式)|
| plugin | 必须有独立 PM plugin(table)| BlockSpec 字段够 | plugin |

### 5.3 注册机制

```ts
// text-editing capability 暴露
interface TextEditingAPI {
  registerBlock(spec: BlockSpec): Result<void>;
  unregisterBlock(id: string): void;
  getBlockSpec(id: string): BlockSpec | undefined;
  listBlocks(): BlockSpec[];
  buildSchema(): Schema;  // 由所有 registered block 拼装
  // ...
}
```

注册顺序:
1. `requires` 依赖先注册(table 注册前 tableRow / tableCell 已注册)
2. 同 id 冲突 → fail (除非 force overwrite)
3. 注册时把 slashItem 提交到 L4 slash-registry / handleActions 提交到 L4 handle-registry
4. 注册时把 selectionBehavior + getSelectionState 提交到 selection capability(让 channel emit)

### 5.4 与 V1 BlockDef 的对照

| V1 字段 | V2 字段 | 变化 |
|---|---|---|
| name | id | 改名 |
| group | group | 不变 |
| nodeSpec | schema | 改名 |
| nodeView | nodeView | 不变 |
| capabilities.cascadeBoundary | cascadeBoundary | 提到顶层 |
| capabilities.canDrag/canDelete/canDuplicate | (废弃) | V2 通过 drag-and-drop / commands 默认行为隐式 |
| capabilities.turnInto | (废弃) | 走 commandRegistry 注册"转换命令" |
| customActions | handleActions | 改名 + 直接注册到 L4 handle-registry |
| slashMenu | slashItem | 改名 + 直接注册到 L4 slash-registry |
| shortcuts | keymap | 改名 |
| enterBehavior | enterBehavior | 加 exitTarget 字段 |
| onIndent/onOutdent | (走 keymap 的 Tab/Shift+Tab) | 简化 |
| plugin | plugin | 不变 |
| containerRule | containerRule | 重新设计(动态字符串 / 函数) |
| converter | serializers / parsers | 拆分 + 显式格式分离 |
| (V1 无) | category | 新加(分类便于 UI 分组) |
| (V1 无) | editingMode | 新加(标准化"块内编辑模式") |
| (V1 无) | selectionBehavior | 新加(显式选区类型) |
| (V1 无) | pasteGuard | 新加(显式粘贴守卫) |
| (V1 无) | dropAccepts | 新加(drag-drop 注册) |
| (V1 无) | requires | 新加(依赖声明) |

---

## 6. text-editing capability 如何承载这套接口

### 6.1 暴露的 block 注册接口

```ts
// src/capabilities/text-editing/index.ts
export interface TextEditingAPI {
  registerBlock(spec: BlockSpec): Result<void>;
  unregisterBlock(id: string): void;
  getBlockSpec(id: string): BlockSpec | undefined;
  listBlocks(): BlockSpec[];
  
  // schema 构建(动态由所有 registered block)
  buildSchema(): Schema;
  
  // 位置 helpers(§ 4.4)
  position: PositionHelpers;
  
  // 渲染入口(view 直接用)
  ProseMirrorHost: React.FC<ProseMirrorHostProps>;
}
```

### 6.2 schema 由所有 registered block 拼装

text-editing 在所有 BlockSpec 注册完成后调 `buildSchema()`:

1. 收集所有 BlockSpec.schema(NodeSpec)
2. 处理 `requires`(确保依赖先到)
3. 注入框架强制 attrs(indent / fromPage / frame*)到 group='block' 节点
4. 加入 doc(`content: 'block+'`)+ text 节点 + marks
5. `new Schema({ nodes, marks })`

### 6.3 capability 自身实施的扩展点

不在 BlockSpec 里、必须 capability 自己实施的:

- 全局 commands(粗体 / 斜体 / 下划线 toggleMark)— 不属任何 block
- baseKeymap(普通字符输入 / 光标移动)
- input-rules plugin(收集所有 BlockSpec.inputRules)
- container-keyboard plugin(读所有 BlockSpec.enterBehavior 综合处理)
- block-handle plugin(读 BlockSpec.cascadeBoundary 决定手柄行为)
- block-selection plugin(读 BlockSpec.containerRule 决定选区收集)
- 位置 helpers(§ 4.4 PositionHelpers)
- ProseMirrorHost React 组件
- history plugin → 注册到 undo-redo capability
- mouse selection tracker → 注册到 selection capability
- drop indicator → 注册到 drag-and-drop capability
- internal-clipboard 通道 → 注册到 clipboard capability

### 6.4 与通用 capability 的协调

BlockSpec 注册时,text-editing 自动把它的能力上交通用 capability:

| BlockSpec 字段 | 上交给 |
|---|---|
| selectionBehavior + getSelectionState | selection capability |
| pasteGuard + parsers.fromX | clipboard capability(作为 PasteHandler 注册数据) |
| serializers.toX | clipboard capability(作为 Serializer 注册数据) |
| dropAccepts | drag-and-drop capability(作为 DropTarget 注册数据)|
| (history 是 capability 层管,不在 BlockSpec) | undo-redo capability |
| slashItem | L4 slash-registry |
| handleActions | L4 handle-registry |

这样**单一注册入口**(BlockSpec)→ **多通用 capability 自动收编**,每加一个 block 不需要改通用 capability 内部代码。

---

## 7. 实施分阶段(对齐 L5 投放计划)

### 7.1 L5-A:textBlock(基础)

只 textBlock(段落 / 标题 level=null/1/2/3),验证 BlockSpec 接口最小集跑得通。
- schema:doc / paragraph / text(无 mark)
- nodeView:仅 noteTitle 用(NoteView 自己提供 schemaExtension)
- enterBehavior:default(走 PM splitBlock)
- 不实施:selectionBehavior(默认 'text')/ pasteGuard(默认 'accept')/ serializers(降级 textContent)/ inputRules / containerRule(默认 'inline-only')
- 验证:用户能输入 / 删除 / 选择字符 / 拷贝粘贴 / undo

### 7.2 L5-B:文本基础族

- heading(textBlock 的 level 变体)
- bullet-list / ordered-list + listItem
- blockquote
- code-block(简化版,不嵌 CodeMirror,先用 PM 默认 textBlock content + monospace 样式)
- 基础 marks:bold / italic / strike / code(注册到 schema.marks)
- enterBehavior:list 加 exit-on-empty,blockquote 同
- containerRule:list = 'block+',blockquote = 'block+'
- inputRules:`# `→heading,`> `→blockquote,`- `→bulletList

### 7.3 L5-C:笔记互动相关

- noteLink(inline atom,由 NoteView 提供 BlockSpec 注入 text-editing)
- image(简单 RenderBlock,带 caption)
- horizontalRule(leaf)
- 注册到 clipboard capability:笔记的 paste handler dispatcher 上线

### 7.4 L6:富节点

- table + tableRow + tableCell(requires 链)+ cascadeBoundary
- math-block + math-inline(KaTeX)+ editingMode='popover'
- code-block 升级版(嵌 CodeMirror,editingMode='embedded')
- callout / toggle-list / column-list
- file-block / external-ref
- audio / video / tweet
- mermaid / html-block
- page-anchor(eBook 锚点)
- task-list(checked mark)

### 7.5 L7+:高级

- 用户自定义 BlockSpec 注册(动态 / 插件市场)
- block 转换命令(turnInto:list ↔ paragraph,heading ↔ paragraph)
- block 复制 / 删除 / 拖动手柄 UI 完善
- frame-block(块边框)
- 跨内容形态拖放(graph 节点拖到笔记当 block)

---

## 8. 风险 + 开放问题

每个开放问题给推荐答案。

### 8.1 BlockSpec.containerRule 是静态值还是函数?

toggle list 折叠态 / heading 折叠态影响"是不是容器"。

**推荐**:**双形态**:`containerRule?: 'leaf' | 'inline-only' | 'block+' | ((node: PMNode) => 'leaf' | 'block+')`。
- 静态字段满足 95% 块(textBlock=inline-only,list=block+,mathBlock=leaf)
- 函数形态用于动态(toggle 折叠 → 'leaf',展开 → 'block+')
- text-editing 内部 `isEffectiveContainer(node)` helper 调 containerRule(若是函数)否则用静态值

### 8.2 NodeView 内嵌"独立编辑器"模式如何标准化?

mathBlock(popover)/ codeBlock(embedded CM)/ mermaid(popover with preview)— 都是"块内有独立编辑器"。

**推荐**:**editingMode 字段** + **生命周期 hooks**:
```ts
editingMode?: 'inline' | 'embedded' | 'popover';
onEnterEditing?: (view, node) => void;
onExitEditing?: (view, node) => void;
```
- inline:PM 默认(textBlock / list / blockquote)
- embedded:NodeView 内嵌外部编辑器(codeBlock CM / 未来 monaco)
- popover:点击进入弹窗(mathBlock / mermaid)

text-editing capability 内置"全局点外退出"机制(单一 mousedown 监听管所有处于编辑模式的 block,V1 mathBlock 已有此模式),BlockSpec 不需要自管。

### 8.3 一个 block 能否依赖另一个 block?

table 必须 tableRow + tableCell + tableHeader。

**推荐**:`requires: string[]`。注册时 ensure 全部依赖已注册,否则 fail。注册顺序自动拓扑排序。

### 8.4 drag-drop dropAccepts 的粒度?

**推荐**:**字符串数组,采用'类型 namespace'命名**:
- `'block'`:任何 block 都能 drop
- `'inline'`:任何 inline 都能 drop
- `'image-only'`:只接图片
- `'note-link'`:只接 noteLink 节点
- `'graph-node'`(L6+):只接 graph 节点

drag-and-drop capability 检查 source.type 是否在 dropAccepts 里。

### 8.5 块内 keymap 优先级如何确定?

V1 是声明顺序,容易冲突。

**推荐**:**显式优先级**:
```ts
keymap?: Record<string, { command: Command; priority?: number }>;
```
- 默认 priority = 0
- text-editing capability 装配时按 priority 降序 keymap
- 同 priority 同绑定 → console.warn(给开发者提示冲突)

### 8.6 V1 capabilities 字典在 V2 是字段还是接口?

V1 把 cascadeBoundary / canDrag / canDelete / canDuplicate / turnInto 都塞 `capabilities` 字典。

**推荐**:**核心字段提到顶层,非核心走默认行为**:
- cascadeBoundary 提到顶层(它影响 selection / drag / delete)
- canDrag / canDelete / canDuplicate 废弃(V2 默认所有 block 都可以,通过 commands 注册的 enabledWhen 限制)
- turnInto 废弃(走 commandRegistry 注册"块转换命令")

### 8.7 如何处理 BlockSpec 升级(已存的 doc 用旧 schema)?

**推荐**:**schema 只加不删 + attrs migration**:
- 加新 BlockSpec → 不破已有 doc(schema 拼装时新节点不影响旧节点解析)
- 改 attrs default → 不破(PM 自动用 default 填充缺失 attr)
- 改 content 表达式 → 风险高,走 migration:BlockSpec 提供 `migrateNode?: (oldNode) => newNode`,buildSchema 时遍历已存 doc 升级
- 删 BlockSpec → 走废弃流程:旧 doc 中的实例 fallback 到 textBlock(`fallbackTo: 'textBlock'` 字段)

L7+ 真有 schema 大改时再细化此机制,L5/L6 阶段只加不删。

### 8.8 BlockSpec 注册时机?

**推荐**:**v1 启动时一次性注册,接口预留动态**。
- L5-A 渲染入口 import 顺序触发所有 BlockSpec 自注册
- 启动后无新注册,但 unregister API 已暴露(便于测试 + 未来插件)
- L7+ 用户扩展 BlockSpec 时改成 lazy(用户加载插件时注册)

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 骨架 | 列出 9 章结构 + 每章 1-2 句说明 |
| 2026-05-05 | v0.2 填肉完成 | § 0 研究方法 + § 1 V1 病例 7 类完整诊断 + § 2 8 接口点 × 5 示例 block 横切表 + § 3 8 节核心机制详解 + § 4 嵌套与位置计算专题(含 V1 容错 4 模式 + V2 PositionHelpers helper API + 16 条回归测试用例) + § 5 BlockSpec 接口 TypeScript 完整定义 + § 5.4 V1 BlockDef → V2 BlockSpec 字段对照 + § 6 text-editing 承载机制 + § 7 L5-A/B/C/L6/L7+ 投放计划 + § 8 8 个开放问题带推荐答案 |
