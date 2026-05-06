# V1 → V2 Block / Mark 迁移清单

> 用途:V1 31 个 block + 8 个 mark 的迁移进度跟踪。每完成一个勾一个。
> 跟 test-checklist.md 区别:本表是"是否已迁",test-checklist 是"迁后是否对齐 V1 行为"。
> 维护规则:迁移完成且 typecheck/lint 全过 → 勾 ✅;阻塞 → ⏸️ + 原因;不迁 → ❌ + 原因。

---

## 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 已迁完成(typecheck + lint 全过) |
| 🔄 | 迁移中(当前阶段) |
| ⏳ | 待迁 |
| ⏸️ | 阻塞(外部依赖,记录阻塞原因) |
| ❌ | 不迁(V2 不需要) |
| 🔧 | 内部基类 / 工具,按需 |

---

## 1. Blocks(V1 共 28 个 block,2 个非 block 文件)

### 1.1 已迁 ✅(6 个 + textBlock = 7 个)

| # | V1 block | V2 状态 | 阶段 | 备注 |
|---|---|---|---|---|
| 1 | text-block | ✅ | L5-A | textBlock + heading 1/2/3 |
| 2 | bullet-list | ✅ | L5-B3.2 | 三级嵌套标记(实心圆/空心圆/方块) |
| 3 | ordered-list | ✅ | L5-B3.2 | 1./a./i. 三级 + start attr 修复 |
| 4 | task-list | ✅ | L5-B3.2 | 含 deadline / createdAt / 超期红字 |
| 5 | blockquote | ✅ | L5-B3.2 | 灰色基线对齐 V1 |
| 6 | horizontal-rule | ✅ | L5-B3.2 | atom: true + 选中高亮 |

### 1.2 待迁 ⏳ 简单 block(本批 A 方案先做 3 个)

| # | V1 block | 工作量 | 优先级 | 备注 |
|---|---|---|---|---|
| 7 | hard-break | 极小 | ✅ L5-B3.3 | `<br>` inline node + Shift-Enter keymap |
| 8 | callout | 小 | ✅ L5-B3.3 | content: block+ + emoji 循环 + 灰底 + Turn Into 三处注册 |
| 9 | toggle-list | 中 | **A 方案** | open/closed attr + 折叠交互 |
| 10 | page-anchor | 小 | 后续 | PDF 页码锚点(KRIG 业务) |
| 11 | file-link | 小 | 后续 | 本地文件链接 |
| 12 | tweet-block | 小 | 后续 | 嵌入 Twitter |
| 13 | html-block | 小 | 后续 | 原生 HTML 嵌入 |
| 14 | frame-block | 小-中 | 后续 | iframe |

### 1.3 待迁 ⏳ 中等 block

| # | V1 block | 工作量 | 优先级 | 备注 |
|---|---|---|---|---|
| 15 | image | 中 | 后续 | NodeView + 上传 + 拖拽,本地需 viewAPI |
| 16 | column-list | 中 | 后续 | 多列布局 |
| 17 | external-ref | 中 | 后续 | URL ref(网页引用 atom) |
| 18 | file-block | 中 | 后续 | 附件块 |
| 19 | note-link | 中 | 后续 | KRIG 笔记互链 atom 引用 |

### 1.4 阻塞 ⏸️

| # | V1 block | 阻塞原因 | 解锁条件 |
|---|---|---|---|
| 20 | code-block | 用户 CodeMirror 6 直接做编辑器的计划 | 等用户 CM6 方案落地 |
| 21 | audio-block | 依赖 viewAPI(下载/导入) | V2 main/preload 补 fileSaveDialog |
| 22 | video-block | 依赖 viewAPI | 同上 |

### 1.5 复杂 / 大工程 ⏸️(需要独立大阶段)

| # | V1 block | 复杂度 | 备注 |
|---|---|---|---|
| 23 | math-block | 大 | KaTeX + popover-editor,独立阶段 |
| 24 | math-inline | 大 | inline atom + popover |
| 25 | math-visual | 大 | math 可视化面板 |
| 26 | table | 大 | tableRow/tableCell + 编辑器 |

### 1.6 不迁 ❌ / 内部 🔧

| # | V1 文件 | 决策 | 原因 |
|---|---|---|---|
| 27 | render-block-base.ts | ❌ 不迁 | V2 走 BLOCK-SPEC.md 自治路径,不需要基类 |
| 28 | claude-theme.ts | 🔧 待评估 | 主题文件,看 V2 主题策略再定 |

---

## 2. Marks(V1 共 8 个)

### 2.1 已迁 ✅(4 个)

| # | V1 mark | V2 状态 | 阶段 |
|---|---|---|---|
| 1 | bold | ✅ | L5-B2 |
| 2 | italic | ✅ | L5-B2 |
| 3 | code | ✅ | L5-B2 |
| 4 | strike | ✅ | L5-B2 |

### 2.2 待迁 ⏳(A 方案本批做完)

| # | V1 mark | 工作量 | 状态 | 备注 |
|---|---|---|---|---|
| 5 | underline | 极小 | ✅ L5-B3.3 | `<u>` + Cmd+U + 顶部 toolbar U + floating-toolbar U |
| 6 | link | 大 | ⏸️ L5-B3.4 | linkMark spec 简单,但联动 LinkPanel 三 Tab(笔记/文件/网页)+ link-click 5 协议路由 + 历史栈 + viewAPI IPC,实质是大工程,升格独立阶段 |
| 7 | textStyle | 小 | ✅ L5-B3.3 (Plan C-1 缩水) | mark spec 全量 + cycle 命令(6 色循环);完整 ColorPicker UI 留 L5-B3.4 |
| 8 | highlight | 小 | ✅ L5-B3.3 (Plan C-1 缩水) | mark spec 全量 + cycle 命令(6 半透明色);完整 ColorPicker UI 留 L5-B3.4 |

---

## 3. A 方案本批工作单元(7 项)

> 当前阶段:**marks 扩展 + 简单 block**(替代被阻塞的 codeBlock 迁移)
> 分支:`feature/L5B3.3-marks-and-simple-blocks`
> 起始日期:2026-05-06
>
> 注:`feature/L5B3.3-code-block-migration` 分支保留(空),作 codeBlock 全量迁移占位,
>    等用户 CodeMirror 6 计划落地时复用此分支名。

### 3.1 顺序

| 顺序 | 项 | 类型 | 状态 | commit |
|---|---|---|---|---|
| 1 | underline mark | mark | ✅ | f33314a |
| 2 | ~~link mark + URL 编辑 popup~~ | mark | ⏸️ **升格 L5-B3.4** | 跨 view 路由系统 + viewAPI 大工程 |
| 3 | textStyle mark(color) | mark | ✅ Plan C-1 | (本批 commit) |
| 4 | highlight mark(背景色) | mark | ✅ Plan C-1 | (合并 #3 同 commit) |
| 5 | hard-break block | block(inline)| ✅ | (本批 commit) |
| 6 | callout block | block | ✅ | (本批 commit) |
| 7 | toggle-list block | block | ⏳ | — |

### 3.2 完成判据(对齐 charter § 6.3)

- [ ] 7 项全部 typecheck + lint 全过
- [ ] 每项追加 test-checklist.md 对应章节
- [ ] floating-toolbar 加 underline / link / color / highlight 4 按钮
- [ ] slash menu 加 callout / toggle 2 项
- [ ] handle/context menu Turn Into 加 callout / toggle 2 项
- [ ] 用户验证 ⏳ 全部条目通过

---

## 4. 修订记录

| 日期 | 改动 |
|---|---|
| 2026-05-06 | 初稿;V1 28 block + 8 mark 全量盘点;A 方案 7 项工作单元定义 |
