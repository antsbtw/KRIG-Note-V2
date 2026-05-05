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
> 文档版本:v0.1 骨架(本次只列结构,等用户认可后填肉)
> 编写日期:2026-05-05
> 上下文:L5-A 阶段,L6+ 加特殊 block 之前必读
> 相关 V1 代码:`src/plugins/note/blocks/`(30+ block 定义)+ `src/plugins/note/registry.ts`(blockRegistry)+ `src/plugins/note/types.ts`(BlockDef)

---

## 0. 研究方法 + 为什么这是独立文档

> **(填肉时写)** 解释:
> - V1 的不稳定症状就在 block 操作的不一致 — 用户视角具体表现(table 内 paste 把 cell 拆了 / mathBlock 选中后 Backspace 行为飘忽 / list 末尾 Enter 退出/不退出 / 折叠 toggle 内的多块拷贝 / 等)
> - 嵌套 + 节点位置计算 = 返工重灾区(V1 commit 历史里反复修这层)
> - 基础动作(选/拖/粘/undo)在每种特殊 block 都有特化,V1 散落 30+ 块定义难统管
> - 单立文档的理由:细节多 + 病例多 + 接口设计需要专门验证;V1-function-mapping § 4 矩阵继续作为"基础 block 层视图"使用,本文是它的纵深附录

---

## 1. V1 病例诊断 — block 操作的典型不一致(7 类)

> **(填肉时写)** 每类一段,带 V1 代码引用 + 给 V2 的协议警示。挑 V1 真实出现过的不稳定模式,作用域全部在"特殊 block 内部" 或 "嵌套容器边界"。

### 1.1 嵌套容器 selection 边界
- **症状**(预填):block-selection 进入 callout / list / blockquote 内时,选不选嵌套容器自身?V1 引入 `cascadeBoundary` capability 才解决 — table / columnList 作为整体不可拆,blockquote / callout / list 进入内部
- **V1 实现**:`plugins/block-selection.ts:isCascadeBoundaryType` + `blocks/*.ts` 各自声明 capabilities.cascadeBoundary
- **V2 警示**:每种 block 必须显式声明"进入选择时是整体还是穿透",不能默认 — 这是 BlockSpec 的强制字段

### 1.2 posAtCoords 在容器边界给错位置
- **症状**(预填):鼠标在容器 margin / 行高外时,PM 的 posAtCoords 给的是容器层级 pos 而非具体子 block;block-handle 用 DOM 命中(pickChildByY)递归兜底
- **V1 实现**:`plugins/block-handle.ts:pickChildByY`
- **V2 警示**:"鼠标位置 → block 落点"是通用 capability(drag-and-drop)的事,不是每个 block 各自实现 — 但需要 BlockSpec 声明"我的 DOM 边界规则"

### 1.3 smart-paste 在 table cell 内冲突
- **症状**(预填):prosemirror-tables 的 tableEditing.handlePaste 在 table cell 内吃掉 paste 事件,smart-paste-plugin 注册在它后面会失效;反之注册在前会破坏 cell 内 table 粘贴语义
- **V1 实现**:NoteEditor.tsx plugin 顺序长注释(L233-238)
- **V2 警示**:plugin 优先级是 BlockSpec 必须声明的(粘贴接管点 / 让位点),不能靠注释约定

### 1.4 codeBlock 的 textarea-like content 与 PM 选区冲突
- **症状**(预填):代码块内是纯文本但需要 Tab 缩进 / 换行不退出 / 语法高亮 — V1 用独立 keyboard plugin
- **V1 实现**:`blocks/code-plugins/` 整个子目录 + `plugins/code-block-keyboard.ts`
- **V2 警示**:"块内有自己的 keyboard 接管"是 BlockSpec 的标准接口位,不是临时 plugin

### 1.5 mathBlock 是 leaf 但用户感知是"独立编辑器"
- **症状**(预填):数学块在 PM 是 leaf node(atom),但点进去后用户期望可以编辑 LaTeX;V1 让 NodeView 内部弹一个 LaTeX 编辑器 popover
- **V1 实现**:`blocks/math-block.ts` + `blocks/math-visual/`
- **V2 警示**:NodeSelection vs 内部编辑模式切换是常见模式(image caption / mermaid 编辑同),需要 BlockSpec 标准化"editingMode"

### 1.6 列表 Enter 在末尾的特殊行为
- **症状**(预填):空 list item 时 Enter 退出列表回到段落(用户预期),非空 Enter 新建 list item;若不特化,PM 默认在 list item 里换行
- **V1 实现**:`plugins/container-keyboard.ts` + 各 list block 的 keymap
- **V2 警示**:keymap 是 BlockSpec 的核心字段,**还要支持"退出条件"语义**(块内末尾 + 空 + Enter → 退出到父容器)

### 1.7 toggle list 折叠态下的多块操作
- **症状**(预填):toggle list 折叠 (open=false) 时,内部子块是否参与父级 doc 的 selection / cursor 导航?V1 把折叠 toggle 整体作为单 block 处理
- **V1 实现**:`plugins/block-selection.ts` 检测 `node.attrs.open === false` 时不递归
- **V2 警示**:block 状态可以影响"它是不是容器" — BlockSpec.containerRule 不是静态字段,可能需要 `containerRule(node) → boolean` 函数形式

---

## 2. block 接口规约 — 8 接口点 × 5 示例 block 横切表

> **(填肉时写)** 主表格,行=接口点,列=5 个示例 block。每格描述该 block 在该接口点的特化行为(简短,详细规则在 § 3 各节)。
>
> 5 个示例 block(Q-S3=A):
> - **textBlock**:基础(段落 / 标题,所有列填 default)
> - **mathBlock**:inline atom 风格的 leaf,但放在 block 层
> - **codeBlock**:块内含 textarea-like content
> - **table**:容器嵌套(table > row > cell)
> - **bulletList**:同族列表(与 orderedList / taskList / toggleList 共享接口模式)

### 2.1 横切表(初稿,填肉时把每格写完整)

| 接口点 \ Block | textBlock | mathBlock | codeBlock | table | bulletList |
|---|---|---|---|---|---|
| 1. schema spec | (待填)content: 'inline*' | (待填)leaf, atom | (待填)content: 'text*', code: true | (待填)content: 'tableRow+', isolating | (待填)content: 'listItem+' |
| 2. NodeView | (待填)default | (待填)KaTeX 渲染 + popover 编辑 | (待填)语法高亮渲染 | (待填)tableNodeView | (待填)default |
| 3. keymap | (待填)default | (待填)无(leaf,不接管)| (待填)Tab 缩进 / Enter 换行 | (待填)tab 跳 cell | (待填)Enter 末尾退出 |
| 4. 选区行为 | (待填)TextSelection | (待填)NodeSelection | (待填)TextSelection 但限制在块内 | (待填)CellSelection (TableSelection) | (待填)TextSelection |
| 5. 粘贴守卫 | (待填)接受 inline + block | (待填)只接 LaTeX | (待填)只接 plain text | (待填)cell-aware paste | (待填)接受 list item / 平铺 paragraph |
| 6. 序列化 | (待填)toMarkdown: 行首 #/inline | (待填)$$\nLaTeX\n$$ | (待填)```lang\ncode\n``` | (待填)\| ... \| Markdown 表 | (待填)- item / nested |
| 7. input-rules | (待填)`# `→heading, `> `→blockquote | (待填)`$$ `→ mathBlock | (待填)```lang→codeBlock | (待填)无 | (待填)`- `→bulletList |
| 8. 容器规则 | (待填)leaf-of-block | (待填)leaf, no children | (待填)leaf-text(内含 text 但不可拆)| (待填)container + cascadeBoundary | (待填)container, allow recursive |

> **填肉细则**:每格 ≤ 30 字简述;详细机制在 § 3 各节深入。

---

## 3. 接口点核心机制详解(8 节)

> **(填肉时每节)** 定义 + 默认实现 + 特化信号 + 跨 block 协调 + 与通用 capability 的边界。

### 3.1 schema spec(nodeSpec)
> **(填肉)** PM nodeSpec 字段含义 / inline vs block / leaf / atom / content 表达式 / attrs / parseDOM / toDOM / 与 V2 BlockSpec 的关系

### 3.2 NodeView 渲染
> **(填肉)** NodeView 接口 / 何时需要(PM 默认渲染不够时)/ contenteditable=false 边界 / popover 编辑模式 / update / stopEvent / ignoreMutation / V1 的 noteLinkNodeView 模式

### 3.3 keymap(块内特殊键盘)
> **(填肉)** PM keymap plugin 优先级 / handleKeyDown / 块内 vs 全局 / "退出条件"语义(空 item + Enter → 退出到父)/ V1 的 container-keyboard / code-block-keyboard 模式

### 3.4 选区行为(TextSelection / NodeSelection / 自定义)
> **(填肉)** PM 的三种 Selection 类型 / leaf 必为 NodeSelection / table 的 CellSelection / V1 block-selection 的"块级选区"是第四种模式 / V2 selection capability 如何统一这四种

### 3.5 粘贴守卫(块内只接受什么)
> **(填肉)** smart-paste-plugin 的 dispatcher / 块内粘贴的"过滤" / V1 pasteIsSafe 的祖先链守卫 / V2 BlockSpec.pasteGuard 接口形态

### 3.6 序列化(toMarkdown / toHTML / toAtom)
> **(填肉)** V1 selection-to-markdown 30+ case 是反例 / V2 让每个 block 注册自己的 serializer / 默认实现 + 自定义 / atom 序列化与 PM doc 序列化的双向转换

### 3.7 input-rules(自动转换语法 → 节点)
> **(填肉)** PM input-rules 机制 / 块内 vs 全局 / 触发时机(空块开头 / 行首)/ V1 buildInputRules 模式 / V2 BlockSpec.inputRules 注册

### 3.8 容器规则(containerRule / cascadeBoundary)
> **(填肉)** V1 的 containerRule(content: 'block+' 风格)+ cascadeBoundary(整体不可拆)+ open=false 折叠态的动态容器性 / V2 BlockSpec 的容器规则字段是静态值还是函数

---

## 4. block 嵌套与位置计算专题(独立章节,返工重灾区)

> **(填肉时)** 这是用户特别强调的"V1 返工最多" 的专题,单独深入。

### 4.1 PM 的 ResolvedPos 三种深度概念
> **(填肉)** $from.depth(光标在嵌套第几层)/ $from.before(d) / $from.after(d) / $from.start(d) / $from.end(d) / $from.node(d) / $from.index(d) — 何时用哪个 / V1 实际用例

### 4.2 容器嵌套时光标定位的常见错位
> **(填肉)** 列表项内嵌段落时光标 depth 容易差 1 / table cell 内 depth 多两层 / V1 多次返工的典型 case

### 4.3 V1 已有的容错模式
> **(填肉)** `pickChildByY`(DOM 命中兜底)/ `cascadeBoundary`(整体不递归)/ `containerRule`(声明式分类) / `findHandleTargetDepth`(从光标向上找手柄目标)— 每个模式的语义 + 何时用

### 4.4 V2 应该在协议里强制的"安全位置计算" helper
> **(填肉)** text-editing capability 内置 helper:`resolveBlockAt(pos)` / `findHandleTarget(coords)` / `findContainerScope(node)` 等;BlockSpec 不直接处理位置,通过 helper 统一访问

### 4.5 测试用例清单(V2 实施时必跑)
> **(填肉)** V1 历史 bug 的回归测试用例 — 列表内嵌段落选区 / table cell 内粘贴 / 折叠 toggle 内删除 / mathBlock 选中后 Backspace / etc.

---

## 5. block 注册接口(V2 BlockSpec 落地形态)

> **(填肉时)** 把 V1 BlockDef 改写为 V2 BlockSpec,讨论每字段语义 + 示例。

### 5.1 BlockSpec 接口定义(草案)
> **(填肉)** TypeScript 接口完整定义,涵盖 8 接口点 + 元数据(id / displayName / category / icon)

```ts
// 草案(填肉时完善)
interface BlockSpec {
  id: string;
  displayName: string;
  category: 'text' | 'media' | 'data' | 'embed';
  // schema
  schema: NodeSpec;
  // 渲染
  nodeView?: NodeViewFactory;
  // 键盘
  keymap?: Keymap;
  exitOnEmpty?: boolean;  // 空块 + Enter → 退出到父容器
  // 选区
  selectionBehavior?: 'text' | 'node' | 'custom';
  // 粘贴
  pasteGuard?: (slice: Slice) => boolean;
  // 序列化
  serializers?: {
    toMarkdown?: (node: PMNode) => string;
    toHTML?: (node: PMNode) => string;
    toAtom?: (node: PMNode) => Atom;
  };
  parsers?: {
    fromMarkdown?: (text: string) => PMNode | null;
    fromHTML?: (dom: HTMLElement) => PMNode | null;
    fromAtom?: (atom: Atom) => PMNode | null;
  };
  // input-rules
  inputRules?: InputRule[];
  // 容器规则
  containerRule?: 'leaf' | 'inline-only' | 'block+' | ((node: PMNode) => 'leaf' | 'block+');
  cascadeBoundary?: boolean;
  // drag-drop
  dropAccepts?: SourceType[];
}
```

### 5.2 字段语义详解
> **(填肉)** 每个字段的细节、默认值、何时省略、何时必填

### 5.3 注册机制
> **(填肉)** text-editing capability 暴露的 `registerBlock(spec)` API / 注册顺序 / 同 id 冲突处理 / 动态注册(L6+ 用户扩展)

### 5.4 与 V1 BlockDef 的对照
> **(填肉)** V1 BlockDef 字段 → V2 BlockSpec 字段映射表 / 哪些 V1 字段废弃 / 哪些 V2 字段是新加

---

## 6. text-editing capability 如何承载这套接口

> **(填肉时)** 把 BlockSpec 接口和 § 5 V1-function-mapping 文档的 text-editing capability 边界连起来。

### 6.1 text-editing 暴露的 block 注册接口
> **(填肉)** registerBlock / unregisterBlock / getBlockSpec / listBlocks API

### 6.2 schema 由所有 registered block 拼装
> **(填肉)** 由 BlockSpec 的 schema 字段动态构建 PM Schema / dependency 解析(table 依赖 tableRow / tableCell)

### 6.3 capability 实施时需要的扩展点
> **(填肉)** 哪些扩展点必须在 capability 层实施(不在 BlockSpec):commands(粗体 / 标题切换)/ baseKeymap / drop indicator / etc.

### 6.4 与通用 capability 的协调
> **(填肉)** BlockSpec 注册时如何把自己的能力上交通用 capability:
> - selection 行为 → 注册到 selection capability
> - 粘贴守卫 → 注册到 clipboard capability
> - 拖放接受 → 注册到 drag-and-drop capability
> - undo 范围 → 通过 text-editing 间接走 undo-redo capability

---

## 7. 实施分阶段(对齐 L5-A/B/C/L6+ 的 block 投放计划)

> **(填肉时)** 每阶段做哪些 block + 为什么 + 验证什么。

### 7.1 L5-A:textBlock(基础)
> **(填肉)** 只 textBlock,验证 BlockSpec 接口跑得通

### 7.2 L5-B:文本基础族
> **(填肉)** heading 变体 + bullet/orderedList + blockquote + code-block + 基础 marks

### 7.3 L5-C:笔记互动相关
> **(填肉)** noteLink (inline atom) + image + horizontalRule

### 7.4 L6:富节点
> **(填肉)** table + math-block + math-inline + callout + toggle-list

### 7.5 L7+:媒体 + 高级
> **(填肉)** audio / video / file / external-ref / mermaid / html-block / page-anchor / etc.

---

## 8. 风险 + 开放问题

> **(填肉时)** 类比 V1-function-mapping § 8,每个开放问题给推荐答案。

### 8.1 BlockSpec.containerRule 是静态值还是函数?
> **(填肉)** toggle list 折叠态影响容器性 — 推荐 `containerRule: 'block+' | ((node) => ...)` 双形态

### 8.2 NodeView 内嵌"独立编辑器"模式如何标准化?
> **(填肉)** mathBlock / mermaid / image-caption — 推荐 BlockSpec.editingMode = 'inline' | 'popover' | 'modal'

### 8.3 一个 block 能否依赖另一个 block?(table 必须 tableRow + tableCell)
> **(填肉)** 推荐 BlockSpec.requires: string[],注册时 ensure

### 8.4 drag-drop dropAccepts 的粒度?
> **(填肉)** 是 'block' / 'inline' / 'image-only' 这种 type 还是 viewId 级?

### 8.5 块内 keymap 优先级如何确定?
> **(填肉)** 内层优先 vs 外层优先?V1 是声明顺序,容易冲突

### 8.6 V1 的 capabilities 字典(如 cascadeBoundary / containerRule 都在里面)在 V2 是字段还是接口?
> **(填肉)** 推荐:核心字段(containerRule / cascadeBoundary)显式提升;扩展字段保留 capabilities 字典

### 8.7 如何处理 BlockSpec 升级(已存的 doc 用旧 schema)?
> **(填肉)** schema 添加节点不破已有 doc;改 attrs 需要 migration

### 8.8 BlockSpec 注册时机?
> **(填肉)** 启动时一次性注册 vs 动态注册(L6+ 用户加自定义 block)— 推荐 v1 一次性,接口预留动态

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 骨架 | 列出 9 章结构 + 每章 1-2 句说明,等用户认可后填肉 |
| (待填) | v0.2 | 填肉:§ 1 V1 病例 7 类 + § 2 横切表完整 + § 3-§ 8 完整内容 |
