# NoteView 已实现功能盘点(2026-05-11)

> 用途:本次对话用,逐项测试 + 优化 NoteView。
> 来源:`docs/RefactorV2/stages/L5A*` ~ `L5B3.20*` 全部完成报告 + `src/views/note/` 当前代码扫描。
> 约定:每行格式 `- [tag] 功能 — 一句话说"用户在哪/怎么触发"`,后面括号是关键文件或阶段号。
>
> 测试流程建议:逐大类过 → 现象用 ✅ / ❌ / 🔄 标在行尾 → ❌ 项展开记现象 → 当场修或挂 TODO。

---

## A. 笔记 CRUD / 列表 / 文件夹树 / 切换 — 16 项

- [DataModel] 全局 noteStore — `krig.notes` localStorage,跨 Workspace 共享 (`note-store.ts`, L5A)
- [DataModel] 全局 folderStore — `krig.folders`,级联 getDescendants / isDescendantOf (`folder-store.ts`, L5B1)
- [DataModel] per-workspace activeNoteId — 各 Workspace 独立活跃笔记 (`data-model.ts`, L5A)
- [DataModel] 标题自动派生 — doc 首段文本 → note.title,列表实时刷 (`note-store.ts`, L5A)
- [NavSide] 笔记列表 — 左 NavSide "Note" tab,显本工作区全部笔记 (`nav-side-content.tsx`, L5A)
- [NavSide] +笔记按钮 — 触发 `note-view.create-note`,新建并激活 (`note-commands.ts`, L5A)
- [NavSide] 点选切换 — 单击 list item → `note-view.set-active` (`note-commands.ts`, L5A)
- [NavSide] 右键删除 — Delete 键或右键菜单 (`note-commands.ts`, L5A)
- [NavSide] 文件夹树 — 嵌套展开/折叠/拖拽/双击重命名,V1 同款 (`folder-store.ts`+`tree-builder.ts`, L5B1)
- [NavSide] +文件夹按钮 — 顶部按钮 + 文件夹内右键创建 (`note-commands.ts`, L5B1)
- [NavSide] 文件夹删除 — 级联清理子文件夹和笔记 (`tree-operations.ts`, L5B1)
- [NavSide] 移动到文件夹 — 拖笔记/子夹进文件夹,环路检测 (`tree-operations.ts`, L5B1)
- [NavSide] 复制/粘贴 — 右键复制 → 文件夹粘贴,标题加"副本"前缀 (`tree-operations.ts`, L5B1)
- [NavSide] 多选批删 — Cmd 单点 toggle / Shift 范围选 / Delete 批删 (`tree-operations.ts`, L5B1)
- [NavSide] 每文件夹独立排序 — 按标题↑↓ / 按日期,互不影响 (`note-commands.ts`, L5B1)
- [NavSide] 展开状态持久化 — per-workspace expandedFolders 重启保留 (`data-model.ts`, L5B1)

## B. PM 编辑区基础 — 25 项

- [TextBlock] 段落编辑 — 输入文字 / 回车换段 / Backspace 清段 (L5A)
- [Heading] 标题三级 — h1/h2/h3,markdown `#/##/###` input rule (L5B2)
- [Heading] keymap — Cmd+Alt+0/1/2/3 切段落/H1/H2/H3 (L5B2)
- [Marks] Bold — Cmd+B,`**text**` input rule,toolbar 高亮 (L5B2)
- [Marks] Italic — Cmd+I,`*text*` / `_text_` input rule (L5B2)
- [Marks] Strike — Cmd+Shift+X,`~~text~~` input rule (L5B2)
- [Marks] InlineCode — Cmd+E,`` `text` `` input rule,排他 (L5B2)
- [Marks] Underline — Cmd+U,toolbar 按钮 (L5B3.3)
- [Marks] TextColor — 6 色 cycle 命令 + 10×2 swatch popup (L5B3.3/3.4)
- [Marks] Highlight — 背景色 cycle + popup (L5B3.3)
- [Mark.Link] URL link — Cmd+K 弹 LinkPanel,inclusive:false (L5B3.4)
- [List] 无序列表 — `-/*/+` input rule,Tab/Shift-Tab 嵌套 (L5B3.2)
- [List] 有序列表 — `1.` input rule,二级 a. 三级 i. (L5B3.2)
- [List] 任务列表 — checkbox toggle,createdAt/completedAt/deadline (L5B3.2)
- [Block] Blockquote — `> ` input rule,灰色 italic (L5B3.2)
- [Block] CodeBlock — ``` ` input rule + language attr + Tab 缩进(SF Mono) (L5B3.2)
- [Block] HorizontalRule — `---` input rule,atom (L5B3.2)
- [Inline] HardBreak — Shift-Enter (L5B3.3)
- [Undo] 真 prosemirror-history — Cmd+Z/Cmd+Y,per-instance 栈 (L5B2)
- [Toolbar] 顶部工具栏 — Heading dropdown + B/I/S/U/Link + Color picker (L5B2/B3.4)
- [Selection] activeMarks/activeBlockType 订阅 — real-change emit (L5B2)
- [InputRules] 共 ~20 条 — heading/mark/list/block,行首/空格触发 (L5B2-B3)
- [Paste] base64 / 本地文件 → media:// — paste-media plugin (L5B3.13)
- [Clipboard] 多 envelope 协议 — pmDoc / HTML / plain (L5B3.3+)
- [Typography] 视觉对齐 V1 — max-width 900px / line-height 1.7 / SF Mono 代码 (L5B3.1)

## C. 富 block — 12 项

- [Image] 三态 — placeholder/img/SVG,Upload/URL/base64,resize handle + caption (L5B3.5)
- [Image] SVG 安全注入 — 剥离 script/on*/javascript: (`image/svg-helpers.ts`, L5B3.5)
- [Math] KaTeX — block(slash `/math`)+ inline(浮条 `∑`),双击进编辑态 + live preview。**注:V2 当前无 `$$`/`$` input rule,实测走 slash + floating toolbar**(L5B3.6)
- [Table] 表格 — md table input rule,Tab 导航 / Enter 新行 (L5B3.7)
- [Callout] 标注块 — 10 emoji cycle,灰底 #252525 (L5B3.3)
- [ToggleList] 折叠列表 — ▼/▶ open attr,closed 隐藏非首行 (L5B3.3)
- [NoteLink] 双链 atom — `[[note-title]]`,失效红字 (L5B3.12)
- [Audio] 音频 — 三态 + media:// + caption + destroy 停播 (L5B3.16)
- [Video] 视频 — 三态 + 16:9 + YouTube iframe + caption (L5B3.16)
- [Tweet] 推文 block — Browse/Data/Download 三 Tab,scraping + yt-dlp 下载 (L5B3.18)
- [File] 文件 block — 媒体库引用 + 下载/删除按钮 (L5B3.14,**待复测**)
- [VideoSubtitle] 字幕渲染 — translate + memory mode 字幕联动 (L5B3.19a/b)

## D. 交互菜单 — 8 项

- [SlashMenu] `/` 触发 — 行首输 /,15 项候选,↑↓ Enter / Esc 关 (L5B3.1)
- [FloatingToolbar] 选区浮条 — B/I/S/U/Link,activeWhen 高亮,选区上方 GAP (L5B3.1)
- [HandleMenu] block 拖手柄 — 行左 ⋮⋮,hover 显示,9 项 Turn Into + Duplicate + Delete (L5B3.1)
- [ContextMenu] 编辑区右键 — Turn Into 4 + Delete + Cut/Copy/Paste,enabledWhen 动态 (L5B3.1)
- [ContextMenu] NavSide 右键 — 笔记/文件夹 14 项菜单,data-krig-context-menu-handled (L5B1)
- [Popup] LinkPanel — 笔记 Tab(搜索+二级 heading drill)+ 网页 Tab,Cmd+K (L5B3.4)
- [Popup] ColorPicker — 10 文字色 + 10 背景色 swatch,hover scale (L5B3.4)
- [Popup] NoteLinkSearch — `[[` 触发,搜索 ↑↓ Enter,Esc / `]]` 关 (L5B3.12)

## E. 链接与导航 — 7 项

- [LinkClick] 5 协议分发 — krig://note / krig://block / https / file / mailto (L5B3.4)
- [BlockAnchor] 同文档锚滚动 — smooth + 2s 蓝底高亮 (`.krig-block-link-highlight`) (L5B3.4)
- [CrossNoteLink] 跨笔记跳转 — `setCurrentNoteId` + 进历史栈 (L5B3.4)
- [NavHistory] 前进/后退 — Cmd+[ / Cmd+] (`note-navigation-history.ts`, L5B3.4)
- [LinkPanel] heading drill — 选笔记 → extractHeadings → 生成 krig://block (L5B3.4)
- [NoteLink] 失效检测 — 目标删除后 noteLink 显红字"未找到" (L5B3.12)
- [PendingAnchor] 跨笔记锚 — 切笔记后 flush pendingAnchor,延迟 100ms 滚动 (`NoteView.tsx:72`)

## F. 学习相关 — 4 项

- [Learning] capability 集成 — view install 'learning',registry 注册 handler (L5B3.20a)
- [Dictionary] 词典面板 — `DictionaryPanel.tsx`,CN/EN 查询 (L5B3.20b)
- [VocabHighlight] 词汇高亮 — 选区/inline popup,触发查询 (L5B3.19d)
- [MemoryMode] 记忆模式 — 词汇自动 mark + 背诵验证(基建) (L5B3.19c)

## G. 横切 — 6 项

- [DnD] 块拖排序 — block-handle plugin 截 handleDrop,dropcursor 蓝线 (L5B3.1)
- [Clipboard] 模块级单例 handler — copy/cut/paste 走 capability 单例 (L5B3.3+)
- [Extraction] L5-C 抽取导入 — main 推 atom batch JSON → noteStore (`use-extraction-import.ts`, L5-C6)
- [Help] HelpPanel 注册 — registry 已建,Note 内容暂空(占位) (L5B3.1)
- [Keymap] view 全局 — Cmd+K popup-link / Cmd+[ go-back / Cmd+] go-forward (L5B3.4, `index.ts:43`)
- [Layout] 编辑区居中 — `.krig-pm-host` max-width 900 / padding 24 (L5B3.1)

---

## 已知薄弱点/债务(测试时重点关注)

1. **NavSide 搜索是 noop** — `searchPlaceholder` 已注册,`onSearch` 没接过滤 (L5B1 § 9.3)
2. **右栏 routing 缺失** — V2 `noteWsState` 只有 `activeNoteId`,跨笔记 link 当前覆盖左栏(L5B3.4 § 4.1)
3. **history 栈不完整** — 仅 link 跳转进栈;NavSide 切换不进栈,与 V1 行为不一致(L5B3.4 § 6.4)
4. **V1→V2 反序列化降级** — V1 doc 含 callout/toggle/image 等粘到 V2 → paragraph(命名空间隔离,L5B3.3 § 4.4)
5. **handle 隐藏延迟** — 鼠标移出后 100-300ms 才隐,mouse-tracker capability 候选(L5B3.1 § 9.1)
6. **slash vs popup 无级联关闭** — 两套 controller,堆叠时只能各自 Esc(L5B3.12 § 4.2)
7. **codeBlock 是简版** — 未上 CodeMirror,无 mermaid / 6 语言插件 / 全屏(L5B3.2 § 5.1)
8. **file-block 待复测** — L5B3.14 完成报告里标完成,实地未列在功能列表(C 类标"待复测")
9. **ContextMenuBinding render 有重复** — folderTree 和编辑区两套注册表,binding 层未统一
10. **PM_NODE_REGISTRY 标记散落** — md-to-pm 引入后 schema node 标记位置不集中
11. **popup-controller 是匿名契约** — 只管 anchor + id,不携带 context payload。
    handle/contextMenu 等"瞬时上下文"场景应让 binding 自构 ctx(如 HandleSubmenuContext),
    不要污染 popup-controller 加 payload(2026-05-15 教训:Color UI 第一版误走 popup-trigger 卡壳)
12. **handle 菜单子菜单已统一 hover ▸ 式样**(2026-05-15) — 撤掉 panel 栈式切换;复杂内容
    通过 `HandleItem.submenuRender(ctx) => ReactNode` 注册;**未实装的不注册**(永远不显示
    的 visibleWhen=false 项已删 Format)
13. **indent attr 仅 schema 定义未消费** — schema-builder.ts `indent: { default: 0 }` 注入
    所有 block,但 spec.toDOM / parseDOM 没读;V2 当前无 indent 视觉,Tab/Shift-Tab 只对
    list/codeBlock 起效(普通段落 Tab 落空)。Notion 同款"普通段落 Tab 缩进"待立项
    **feature/indent-attr** 独立分支做(横切 6 处:keymap/driver API/spec toDOM/parseDOM/
    atom serializer/md 转换)
14. **mathBlock attrs.color/bgColor 是唯一带 node-attr 着色的 block** — 其他 block 走
    inline marks(textStyle/highlight);driver `applyBlockTextColor/applyBlockBgColor`
    内部分流(mathBlock setNodeMarkup,其他 setMark over range)。新加 marks:'' block
    时(若有)同样需要此分流
15. **handle 命令体系 instanceId 取值不一致** — V2 现有 handle-turn-* 等命令统一用
    `workspaceManager.getActiveId()` 取 instanceId(`note-commands.ts getHandlePos`),
    在 canvas-text-node 这种"instanceId = `${workspaceId}::${nodeId}` 复合"的场景下
    会拿错(返回 workspaceId,driver `instanceRegistry.get` 取不到)。canvas-text-node
    当前 plugin preset `blockHandle: false` 暂时回避;handle 真要支持复合实例时整个
    handle 体系一起改(controller state 加 instanceId 字段,所有 handle 命令统一切换),
    勿单点修。ColorPickerPanel(浮条触发)已用 `getFocusedInstanceId()` 修复同类问题。

---

## 测试推进建议

按"能造反就先造反"顺序过(下游故障最先暴露 → 上游基础):

1. **A 类先做** — 笔记/文件夹的 CRUD/排序/拖动/持久化(基础不稳一切都飘)
2. **B 类骨架** — Heading + 4 mark + 3 list + undo,5 分钟扫平
3. **D 类穿插** — 每验一个 mark / block,顺手在 slash / floatingToolbar / handleMenu 三处都触发一遍
4. **C 类逐个 block** — image / math / table / callout / toggle / audio / video / tweet / file,每个独立一组
5. **E 类链接** — Cmd+K → 网页 / krig://note / krig://block 三路径都走一遍 + Cmd+[/] 回退
6. **F 类学习** — 词典 / vocab / memory(基建项,无明显 V1 对照,出 bug 先标 ❌ 留观察)
7. **G 类横切** — 最后过(很多在前面隐式覆盖)

每条做完就在本文档对应行尾打 ✅ / ❌(❌ 后补一行现象描述)。

---

## V1 ↔ V2 Block 对照矩阵(2026-05-11 截止)

> 用途:本文是 NoteView 后续增量开发的**单一入口**。
> 新增 block / mark / 富功能时,先在本表追加一行,再开 stage design doc。
> "状态" 一栏:✅ 已对齐 / 🟡 简版 / ❌ 缺失 / 🆕 V2 独有。

### Block 节点(PM schema node)

| V1 block | V2 路径 | 状态 | 缺口/备注 |
|---|---|---|---|
| `textBlock` (段落) | `text-block/` | ✅ | — |
| `heading` (h1/h2/h3) | 内嵌 `text-block` | ✅ | — |
| `blockquote` | `blockquote/` | ✅ | — |
| `bulletList` | `bullet-list/` | ✅ | — |
| `orderedList` | `ordered-list/` | ✅ | — |
| `listItem` | `list-item/` | ✅ | — |
| `taskList` / `taskItem` | `task-list/` | ✅ | — |
| `horizontalRule` | `horizontal-rule/` | ✅ | — |
| `hardBreak` | `hard-break/` | ✅ | — |
| `image` | `image/` | ✅ | — |
| `codeBlock` | `code-block/` | 🟡 | **V1 609 行(4 语言插件 + Mermaid 全屏 + registry);V2 42 行只有 PM 标准 + language attr。CodeMirror 6 + Mermaid 留 L5B3.2 § 5.1 后续** |
| `mathBlock` | `math-block/` | 🟡 | KaTeX 渲染对齐;**V1 `math-visual/`(LaTeX→mathjs 可视化编辑器)未迁** |
| `mathInline` | `math-inline/` | 🟡 | 同上 |
| `callout` | `callout/` | ✅ | — |
| `toggleList` | `toggle-list/` | ✅ | — |
| `table`/`tableRow`/`tableHeader`/`tableCell` | `table/` | ✅ | — |
| `audioBlock` | `audio-block/` | ✅ | — |
| `videoBlock` | `video-block/` | ✅ | — |
| `tweetBlock` | `tweet-block/` | ✅ | — |
| `fileBlock` | `file-block/` | ✅ | 待用户复测 |
| `fileLink` (inline atom) | `file-link/` | ✅ | — |
| `externalRef` | `external-ref/` | ✅ | — |
| `noteLink` (inline atom) | `note-link/` | ✅ | — |
| `columnList` + `column` | — | ❌ | **多列布局容器**(`block+`),+/− 按钮 / 垂直对齐 / 列宽 resize handle。V1 [column-list.ts](../../../../KRIG-Note/src/plugins/note/blocks/column-list.ts) ~300 行。优先级**高** — 老笔记常用,V2 当前降级为 `unknown` |
| `frameBlock` | — | ❌ | **彩框容器**(`block+`),左边框 6 色循环,点边框换色。V1 [frame-block.ts](../../../../KRIG-Note/src/plugins/note/blocks/frame-block.ts) ~80 行。优先级**中** |
| `htmlBlock` | — | ❌ | **sandbox iframe HTML 预览**(AI artifact:D3/Chart.js/UI 原型),`allow-scripts` 无 `same-origin`。V1 [html-block.ts](../../../../KRIG-Note/src/plugins/note/blocks/html-block.ts)。优先级**中** — 视 AI workflow 路线 |
| `pageAnchor` | — | ❌ | **PDF 页面锚点 atom**(`data-pdf-page`),PDF↔Note 双向滚动同步。V1 [page-anchor.ts](../../../../KRIG-Note/src/plugins/note/blocks/page-anchor.ts)。优先级**取决于 L5C5** — ebook PDF spatial annotation 若依赖必做 |
| — | `unknown/` | 🆕 | V2 独有降级 fallback,V1 没有(V1 遇未知节点报错/丢弃) |

**缺口合计:4 个 V1 block 未迁。**

### Mark(PM mark)

V1 / V2 各自的 mark 清单从代码扫描下来基本对齐(bold/italic/strike/code/underline/link/textStyle+color/highlight)。**待补充对照**(此条留待第一次发现差异时填)。

### NodeView 富交互(同 block 名,但 UX 完整度)

| 主题 | V1 | V2 | 缺口 |
|---|---|---|---|
| codeBlock 全屏 + 6 语言 + Mermaid | ✅ | ❌ | 见上表 codeBlock 🟡 |
| mathBlock LaTeX→mathjs visual | ✅ | ❌ | 见上表 mathBlock 🟡 |
| image resize handle + caption | ✅ | ✅ | — |
| table 行列右键菜单 | ✅ | 待复测 | L5B3.7 |
| video YouTube embed + 字幕 | ✅ | ✅(B3.19 系列) | — |

### 未来增量开发原则(对照本文档)

1. **每次新加 block / 重要 mark / 重大交互**,先在本对照矩阵追加一行(状态先标 ⏳),再开 `stages/L<n>-*-design.md`
2. **每次完成阶段**,把对照矩阵对应行从 ⏳ 改成 ✅ / 🟡 / ❌(无法对齐时),并在备注里链 `*-completion.md`
3. **每次修复 bug**,如果暴露了对照矩阵漏标的债务,顺手把"状态"从 ✅ 改成 🟡 + 说明
4. **本表是 NoteView 业务"应该有什么"的唯一权威**,与 V1 的差距一目了然
5. **不在本表里的 V1 老功能**(toolbar / 阅读位置 / AI sync 等业务横切),归 docs/RefactorV2/v1-note-migration-audit.md 管,不混进来

### 缺口实施顺序建议(若用户决定补齐)

1. **`columnList + column`** — 直迁,~300 行 NodeView,影响面最大(老笔记排版)
2. **`frameBlock`** — 顺手,~80 行
3. **`pageAnchor`** — 等 L5C5 ebook PDF spatial 启动时一并做
4. **`htmlBlock`** — 需要先确认 AI artifact 工作流路线
5. **`codeBlock` 升级 CodeMirror 6** — 单独立 stage,工作量最大
6. **`math-visual`** — 当前 KaTeX 够用,延后

