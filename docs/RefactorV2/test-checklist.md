# V2 累积测试清单

> 用途:每完成一个 block / capability / 交互对照 V1 后,在此追加测试要求
> 用户按文档逐项验证,失败的测试条目记录现象 + 触发 bug 修复
> 通过的项标 ✅,问题项标 ❌ + 现象描述

---

## 维护规则

1. **新增功能后**:在对应章节追加测试条目(操作 + 期望 + 状态)
2. **回归测试**:每次大改后,跑历史所有 ✅ 项确认不回归
3. **状态标记**:
   - ✅ 已验证通过
   - ❌ 失败 + 现象
   - 🔄 修复中
   - ⏳ 未验证
4. **每条要求**包含:可执行操作步骤 + 视觉/状态期望 + 失败时的诊断方向

---

## 1. NoteView 基础

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 1.1 | 启动 npm start | 不白屏,默认/旧笔记内容显示 | ⏳ |
| 1.2 | 拉宽窗口 | NoteView 编辑区 max-width 900px 居中,两侧露暗灰底 | ⏳ |
| 1.3 | typecheck + lint | 全过 | ⏳ |

---

## 2. NavSide 文件夹树(L5-B1)

详见 [L5B1 完成报告](stages/L5B1-folder-tree-completion.md) 15 判据。

---

## 3. Marks 与 Headings(L5-B2)

详见 [L5B2 完成报告](stages/L5B2-marks-undo-completion.md) 15 判据。

---

## 4. 4 大交互(L5-B3.1)

详见 [L5B3.1 完成报告](stages/L5B3.1-interactions-completion.md) 15 判据。

---

## 5. 新 Block 类型(L5-B3.2,逐 block 对照 V1)

### 5.1 bulletList(无序列表) — 对齐 V1

#### 输入规则触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.1 | 在空段落行首,输 `- ` | 当前段变成 bullet list 第一项,**光标留在第一项内**(可继续输入) | ⏳ |
| 5.1.2 | 在空段落行首,输 `* ` | 同 5.1.1 | ⏳ |
| 5.1.3 | 在段落**中间**(非行首)输 `- ` | **不触发**(对齐 V1 严格行首)— 字符照常输入 | ⏳ |
| 5.1.4 | 在 bullet list 项内**段中**输 `- ` | 不触发(避免误触) | ⏳ |
| 5.1.5 | 在 bullet list 项内**行首**输 `- ` | 不触发(已经在 list 里,protectedBy 父类型检查) | ⏳ |

#### 视觉对齐 V1

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.6 | bullet list 项的标记(顶层) | **实心圆点 6×6px**,左 6px 处,跟文字基线垂直居中 | ⏳ |
| 5.1.7 | 嵌套 2 级标记 | **空心圆 5×5px**(1.5px 边框,无填充) | ⏳ |
| 5.1.8 | 嵌套 3 级标记 | **实心方块 5×5px**(微圆角 1px) | ⏳ |
| 5.1.9 | 顶层 list 缩进 | **不缩进**(顶层 padding-left: 0) | ⏳ |
| 5.1.10 | 嵌套层缩进 | 24px(对齐 V1) | ⏳ |
| 5.1.11 | list 项与项间距 | 1px margin(紧凑) | ⏳ |
| 5.1.12 | 标记颜色 | 跟随文字色(currentColor) | ⏳ |

#### 嵌套与跳出

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.13 | 在 bullet list 项内输内容,行末按 Enter | 新建第二个 bullet 项,光标移到新项 | ⏳ |
| 5.1.14 | 在第二项空状态按 Enter(空项 Enter) | **跳出列表**,变回 paragraph,光标在新 paragraph 内 | ⏳ |
| 5.1.15 | bullet 项内按 **Tab** | 该项嵌套到第二层(空心圆标记) | ⏳ |
| 5.1.16 | 嵌套项内再按 Tab | 第三层(方块标记) | ⏳ |
| 5.1.17 | 嵌套项内按 **Shift-Tab** | 反嵌套(回上一层) | ⏳ |
| 5.1.18 | 顶层 list 项按 Shift-Tab | 跳出列表变 paragraph | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.19 | 鼠标悬停 bullet list 第一项 | ⋮⋮ handle 显示在该项左侧 | ⏳ |
| 5.1.20 | 悬停第二项 | handle 移到第二项左侧 | ⏳ |
| 5.1.21 | 抓第二项 ⋮⋮ 拖到第一项之前释放 | 第二项移到第一项之前(顺序对调) | ⏳ |
| 5.1.22 | 抓 list 中的项,拖出 list 到普通段落区域 | (留 L5-B3.x — 当前未必生效)| ⏳ |

#### slash / Turn Into

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.23 | 行首输 `/`,菜单项含 "Bullet List" | 是 | ⏳ |
| 5.1.24 | 输 `/bullet` 然后 Enter | 当前段变 bullet list | ⏳ |
| 5.1.25 | 在普通段点 ⋮⋮ → "Turn into Bullet List" | 段变 bullet list | ⏳ |
| 5.1.26 | 在普通段右键 → "Turn into Bullet List" | 段变 bullet list | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.27 | bullet list 内 mark(Cmd+B) | 文字 bold,标记不变 | ⏳ |
| 5.1.28 | bullet list 内 heading(Cmd+Alt+1) | 该项 textBlock 变 H1,标记仍在 | ⏳ |
| 5.1.29 | bullet list 内 undo/redo | history 正常 | ⏳ |

#### A. PM 健全性补丁(对齐 PM 标准能力,V2 当前实现可能缺)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.1.30 | bullet 项**行首**按 Backspace | liftListItem — 该项跳出 list 变 paragraph(或与上一项合并) | ⏳ |
| 5.1.31 | 从浏览器/外部复制 `<ul><li>a</li><li>b</li></ul>` 粘贴到空段 | 解析成 bulletList 两项(spec 已声明 parseDOM: ul/li,需验证) | ⏳ |
| 5.1.32 | 两个 bulletList 之间用 ↑/↓ 方向键 | 能停在 list 间隙(GapCursor)且能输文字插新段落 | ⏳ |
| 5.1.33 | 在 bulletList 项内 → Turn Into "Ordered List" / "Task List" | 整个 list 类型互转,内容/嵌套保留 | ⏳ |
| 5.1.34 | 选中跨多个 listItem 的范围 → 按 Tab | 选中的所有项整体嵌套(整批 sinkListItem) | ⏳ |
| 5.1.35 | bulletList 内 Cmd+A | 选中**当前项内全部文字**(非整文档,PM 标准 list 行为) | ⏳ |
| 5.1.36 | 顶层项 Backspace 删空 | 该项删除,光标进上一项末尾(跨项合并) | ⏳ |

#### B. Notion 对标(待评审,先记录,B 阶段统一决策)— ⏸️

| # | 操作 | 期望(Notion 行为) | 状态 |
|---|---|---|---|
| 5.1.37 | 拖一项到另一项**右侧**释放 | 成为目标的子项(dropcursor 应区分"上/下/嵌套"三档) | ⏸️ B 阶段 |
| 5.1.38 | bullet 项内嵌图片 / codeBlock(listItem content:block+ 已允许) | 项内允许任意 block,UI 入口能触达 | ⏸️ B 阶段 |
| 5.1.39 | Cmd+Shift+8 快捷键(Notion 是 Cmd+Shift+5)切换 bulletList | 当前段 toggle 为 bulletList | ⏸️ B 阶段 |
| 5.1.40 | 整段粘贴 markdown 文本 `- a\n- b\n- c` | 自动解析成 bulletList(非纯文本) | ⏸️ B 阶段 |
| 5.1.41 | 悬停项左侧出现 ⋮⋮ **+ ＋** 双按钮(＋ 在该项**之后**插新 block) | Notion 标志性 add-block 按钮 | ⏸️ B 阶段 |
| 5.1.42 | bullet 项前可挂 emoji/icon attr(自定义标记) | 替换默认圆点 | ⏸️ B 阶段 |

#### C. 已知不做(KRIG 范围外)— N/A

| # | 项 | 原因 |
|---|---|---|
| 5.1.C1 | toggle list(折叠 bullet) | 留 L6+ 复合 block |
| 5.1.C2 | bullet 项作 page 入口(@提及→转子页) | KRIG 无 page-tree 概念 |
| 5.1.C3 | Markdown 序列化/反序列化 | 不在 V2 范围 |

---

### 5.2 orderedList(有序列表) — 对齐 V1

> V1 vs V2 架构差异:
> - V1 `content: 'block+'` 无 listItem 节点 / 自定义 NodeView 注 counter-reset
> - V2 `content: 'listItem+'` 与 bulletList 共用 listItem / toDOM 出 HTML `<ol start>`,counter-reset 由 CSS 静态做
> - V2 已知风险:**自定义 start 视觉失效**(toDOM 输出 HTML start 但 CSS 用 counter-reset 默认从 0,需要把 start 也注入 inline style)

#### 输入规则触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.1 | 在空段行首,输 `1. ` | 当前段变 orderedList 第一项,计数 1.,光标留新项内 | ⏳ |
| 5.2.2 | 行首输 `5. ` | 触发 orderedList,**首项计数应是 5.**(attrs.start=5) | ⏳ |
| 5.2.3 | 段中输 `1. ` | 不触发(对齐严格行首) | ⏳ |
| 5.2.4 | 已在 list 内行首输 `1. ` | 不触发(父类型检查) | ⏳ |

#### 视觉对齐 V1

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.5 | 顶层 OL 标记 | `1.` `2.` `3.`(阿拉伯数字 + 点)右对齐宽 20px | ⏳ |
| 5.2.6 | 嵌套 2 级 | `a.` `b.` `c.`(lower-alpha) | ⏳ |
| 5.2.7 | 嵌套 3 级 | `i.` `ii.` `iii.`(lower-roman) | ⏳ |
| 5.2.8 | 顶层 OL 缩进 | 不缩进(顶层 padding-left: 0) | ⏳ |
| 5.2.9 | 嵌套层缩进 | 24px | ⏳ |
| 5.2.10 | 项与项间距 | 1px margin(对齐 bulletList) | ⏳ |
| 5.2.11 | 数字字体 | tabular-nums(等宽数字,多位数对齐) | ⏳ |
| 5.2.12 | 数字颜色 | 跟随文字色(currentColor) | ⏳ |

#### 嵌套与跳出(继承 list-keymap,共享 bulletList 验证)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.13 | OL 项内 Enter | 新建第二项,**计数自动到 2.** | ⏳ |
| 5.2.14 | 空项 Enter | 跳出 list 变 paragraph | ⏳ |
| 5.2.15 | OL 项 Tab | 嵌套到第二层(变 a.) | ⏳ |
| 5.2.16 | 嵌套项再 Tab | 第三层(变 i.) | ⏳ |
| 5.2.17 | 嵌套项 Shift-Tab | 反嵌套(回上一层) | ⏳ |
| 5.2.18 | 顶层项 Shift-Tab | 跳出变 paragraph | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.19 | 悬停 OL 第二项 | ⋮⋮ handle 显示在该项左侧(每项独立 handle) | ⏳ |
| 5.2.20 | 抓第二项拖到第一项之前 | 顺序对调,**计数自动重排为 1./2.** | ⏳ |

#### slash / Turn Into

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.21 | 行首输 `/`,菜单含 "Numbered List" | 是 | ⏳ |
| 5.2.22 | 输 `/numbered` Enter | 当前段变 OL | ⏳ |
| 5.2.23 | 普通段 ⋮⋮ → "Turn into Numbered List" | 段变 OL | ⏳ |
| 5.2.24 | 普通段右键 → "Turn into Numbered List" | 段变 OL | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.25 | OL 内 mark(Cmd+B) | bold 生效,数字标记不变 | ⏳ |
| 5.2.26 | OL 内 heading(Cmd+Alt+1) | 项 textBlock 变 H1,**计数仍正确**(CSS counter 继续) | ⏳ |
| 5.2.27 | OL 内 undo/redo | history 正常 | ⏳ |

#### A. PM 健全性(承袭 5.1.A,list 共性)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.2.28 | OL 项行首 Backspace | liftListItem(跳出/合并) | ⏳ |
| 5.2.29 | 粘贴 `<ol start="3"><li>a</li><li>b</li></ol>` | 解析成 OL,**首项计数 3.**(attrs.start=3 解析正确) | ⏳ |
| 5.2.30 | OL → bulletList Turn Into | 整 list 变 bullet,内容/嵌套保留 | ⏳ |
| 5.2.31 | OL → taskList Turn Into | 整 list 变 task,内容/嵌套保留 | ⏳ |
| 5.2.32 | OL 中间删一项后 | 后续项计数自动重排(2./3./...) | ⏳ |

---

### 5.3 taskList(任务列表) — 对齐 V1

> V1 vs V2 关键差异:
> - V1 taskItem attrs:atomId / checked / createdAt / completedAt / deadline(5 项)
> - V2 taskItem attrs:仅 checked
> - V1 NodeView 含 deadline date-picker / 时间标签 / 超期红字 — V2 全无
> - V1 嵌套 task-list `padding-left: 0`(checkbox 已占 24px),V2 当前嵌套被通用 ul/ol 规则吃 24px(双倍缩进 bug)
> 本节既补审计清单,也触发 bug 修复(attrs 扩展 / 嵌套缩进 / NodeView 时间 UI)

#### 输入规则触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.1 | 空段行首输 `[] ` | 当前段变 taskList,首项 checkbox 未勾,光标在项内 | ⏳ |
| 5.3.2 | 空段行首输 `[ ] ` | 同 5.3.1 | ⏳ |
| 5.3.3 | 空段行首输 `[x] ` | 当前段变 taskList,首项 **checkbox 已勾** | ⏳ |
| 5.3.4 | `[X] `(大写)| 已勾(case-insensitive) | ⏳ |
| 5.3.5 | 段中输 `[] ` | 不触发(严格行首) | ⏳ |
| 5.3.6 | 已在 task list 内输 `[] ` | 不触发 | ⏳ |

#### 视觉对齐 V1

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.7 | 顶层 task-item | checkbox 16×16,左 2px,跟文字基线垂直居中 | ⏳ |
| 5.3.8 | checkbox 颜色 | accent-color #8ab4f8(对齐 V1) | ⏳ |
| 5.3.9 | content 缩进 | padding-left 24px(给 checkbox 留位) | ⏳ |
| 5.3.10 | **嵌套 task-list 不再额外缩进**(关键!) | task-list 内嵌 task-list `padding-left: 0`,checkbox 已自占 24px | ⏳ ⚠️ V2 当前可能双倍缩进 |
| 5.3.11 | task-list 嵌入 bulletList(混合) | 24px(走通用规则) | ⏳ |
| 5.3.12 | checked 项视觉 | content 划线 + 灰字 #9aa0a6 | ⏳ |

#### checkbox 交互

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.13 | 点击 checkbox | 切换 checked,触发 transaction(可 undo) | ⏳ |
| 5.3.14 | 点击 checkbox 时光标 | 不偏移到 checkbox 位置(mousedown preventDefault) | ⏳ |
| 5.3.15 | checked → unchecked | 划线/灰字消失 | ⏳ |
| 5.3.16 | checkbox 不可编辑 | contentEditable=false,不能 focus | ⏳ |

#### deadline / 时间戳(V1 特性)— ⚠️ V2 当前缺失,需补

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.17 | 新建 task-item | attrs.createdAt 自动写当前 ISO 时间 | ⏳ ⚠️ V2 缺 |
| 5.3.18 | 勾选 checked | attrs.completedAt 写当前 ISO,**未勾时清空** | ⏳ ⚠️ V2 缺 |
| 5.3.19 | hover task-item | 右侧出现时间标签(`MM-DD 创建` / `截止 MM-DD` / `MM-DD 完成`) | ⏳ ⚠️ V2 缺 |
| 5.3.20 | 点击时间标签 | 弹 date picker 设 deadline | ⏳ ⚠️ V2 缺 |
| 5.3.21 | 设 deadline 后 deadline < 今天 | 时间标签变红色 #f28b82(超期标记) | ⏳ ⚠️ V2 缺 |
| 5.3.22 | checked 项的时间标签 | 显示完成日期(覆盖 createdAt/deadline 显示) | ⏳ ⚠️ V2 缺 |

#### 嵌套与跳出(继承 list-keymap)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.23 | task-item 内 Enter | 新建第二项 | ⏳ |
| 5.3.24 | 空 task-item Enter | 跳出 task-list 变 paragraph | ⏳ |
| 5.3.25 | task-item Tab | 嵌套(走 sinkListItem(taskItem)) | ⏳ |
| 5.3.26 | 嵌套项 Shift-Tab | 反嵌套 | ⏳ |
| 5.3.27 | 顶层 task Shift-Tab | 跳出 list 变 paragraph | ⏳ |
| 5.3.28 | task-item 内嵌 task-list 后,新建子项 attrs.checked | 默认 false(独立 attr,不继承父) | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.29 | 悬停 task-item | ⋮⋮ handle 显示在该项左侧(每项独立) | ⏳ |
| 5.3.30 | 拖第二项到第一项之前 | 顺序对调,**checked / deadline 等 attrs 全部跟随** | ⏳ |

#### slash / Turn Into

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.31 | 行首输 `/`,菜单含 "Task List" | 是 | ⏳ |
| 5.3.32 | 输 `/task` Enter | 当前段变 taskList | ⏳ |
| 5.3.33 | 普通段 ⋮⋮ → "Turn into Task List" | 段变 taskList | ⏳ |
| 5.3.34 | 普通段右键 → "Turn into Task List" | 段变 taskList | ⏳ |
| 5.3.35 | task-list → bulletList Turn Into | checkbox 消失,变普通 bullet,**checked / deadline attrs 丢失**(预期行为) | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.3.36 | task-item 内 mark(Cmd+B) | bold 生效,checkbox 不变 | ⏳ |
| 5.3.37 | task-item 内 heading(Cmd+Alt+1) | textBlock 变 H1,checkbox 仍在 | ⏳ |
| 5.3.38 | task-item 内 undo/redo(含 checkbox 切换) | history 正常 | ⏳ |

---

### 5.4 blockquote — 对齐 V1

> V1 vs V2 视觉差异:
> - V1:左竖线 #555 灰 / 文字 #aaa 浅灰 italic / 嵌套二级竖线 #444(更深)
> - V2:左竖线 #4a90e2 **蓝** / 文字 #c8c8c8 italic / **无嵌套规则**
> - 决策点(待用户拍):基线对齐 V1 灰色还是保留 V2 蓝色?**当前默认对齐 V1 灰**(可一行 CSS 切回)

#### 输入规则触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.1 | 空段行首输 `> ` | 当前段变 blockquote,光标在引用内 | ⏳ |
| 5.4.2 | 段中输 `> ` | 不触发(严格行首) | ⏳ |
| 5.4.3 | 已在 blockquote 内段首输 `> ` | 不触发 / 或允许嵌套(对齐 V1 — 待验证 V1 行为) | ⏳ |

#### 视觉对齐 V1

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.4 | 顶层 blockquote | 左竖线 3px #555 灰(对齐 V1) | ⏳ |
| 5.4.5 | 文字色 | #aaa 浅灰 italic(对齐 V1) | ⏳ |
| 5.4.6 | 嵌套二级 blockquote | 竖线 #444 更深灰(对齐 V1) | ⏳ |
| 5.4.7 | padding-left | 16px | ⏳ |
| 5.4.8 | margin | 0.3em 0(紧凑) | ⏳ |

#### 内嵌内容(content: block+)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.9 | blockquote 内多段 paragraph | 竖线连续覆盖所有段(单一 quote 块) | ⏳ |
| 5.4.10 | blockquote 内 H1/H2/H3 | heading 字号生效,仍 italic + 灰字色 | ⏳ |
| 5.4.11 | blockquote 内嵌 bulletList | bullet 工作正常,竖线在 list 左外侧 | ⏳ |
| 5.4.12 | blockquote 内嵌 blockquote(2 级) | 内层有自己竖线,颜色更深 | ⏳ |

#### 跳出(blockquote 没有 list-keymap;靠 split + Backspace)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.13 | blockquote 末尾按 Enter 两次(空段 Enter)| **跳出 blockquote** 变普通段(对齐 V1 — 需验证 V2 是否同) | ⏳ ⚠️ V2 可能未实现 |
| 5.4.14 | blockquote 行首按 Backspace | 跳出 / 与上一段合并 | ⏳ ⚠️ 需验证 |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.15 | 悬停 blockquote 第一行 | ⋮⋮ handle 显示 | ⏳ |
| 5.4.16 | 拖整个 blockquote | 整块移动 | ⏳ |

#### slash / Turn Into

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.17 | 行首输 `/`,菜单含 "Quote" | 是 | ⏳ |
| 5.4.18 | 输 `/quote` Enter | 当前段变 blockquote | ⏳ |
| 5.4.19 | 普通段 ⋮⋮ → "Turn into Quote" | 段变 blockquote | ⏳ |
| 5.4.20 | 普通段右键 → "Turn into Quote" | 段变 blockquote | ⏳ |
| 5.4.21 | blockquote → paragraph Turn Into | 拆出 quote 内的所有段为顶层 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.4.22 | blockquote 内 mark(Cmd+B) | bold 生效,italic 共存 | ⏳ |
| 5.4.23 | blockquote 内 undo/redo | history 正常 | ⏳ |

---

### 5.5 codeBlock — 对齐 V1 基线(高级特性留 L6)

> V1 vs V2 巨大差异(决策点):
> - V1 NodeView ~600 行,含:语言下拉(25 种)/ Mermaid 三模式渲染 / 复制按钮 / 下载 PNG / 全屏 / 6 个语言插件(html/js/markdown/mermaid 等)
> - V2 当前:仅 PM 标准 codeBlock(toDOM `<pre><code>`),无 NodeView / 无下拉 / 无 Mermaid / **无 keyboard plugin**
> - **决策(已落)**:Plan B + C 组合 — 本节只做 PM 标准基线 + 关键 keymap;
>   语言下拉 / Mermaid / 6 插件留 **L6+** 作独立阶段
> - 已补:`buildCodeBlockKeymap`(Enter 换行 / 双 Enter 跳出 / Tab 缩进 / Shift-Tab 反缩进 / Backspace 空块清退)

#### 输入规则触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.5.1 | 行首输 ` ``` ` 后回车 | 当前段变 codeBlock,光标在内 | ⏳ |
| 5.5.2 | 段中输 ` ``` ` | 不触发 | ⏳ |

#### 视觉

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.5.3 | codeBlock 渲染 | 深背景 #2a2a2a / 边框 #3a3a3a / 圆角 4px / 内 padding 12px 16px | ⏳ |
| 5.5.4 | 字体 | SF Mono / Fira Code 等宽,14px / line-height 1.5 | ⏳ |
| 5.5.5 | 多行代码 | white-space: pre,横向超出滚动条 | ⏳ |

#### 编辑行为(本节关键 — 关键 keymap 已补)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.5.6 | 在 codeBlock 内按 **Enter** | 插换行 \n,**不出 codeBlock** | ⏳ |
| 5.5.7 | 末行末尾按 Enter(已经是 \n 结尾再按)| **跳出 codeBlock** 变下一段 paragraph(double-enter 退出) | ⏳ |
| 5.5.8 | 按 **Tab** | 插 2 个空格 | ⏳ |
| 5.5.9 | 按 **Shift-Tab** | 删行首 2 空格(反缩进) | ⏳ |
| 5.5.10 | 空 codeBlock 按 Backspace | 整块替换为空 paragraph | ⏳ |
| 5.5.11 | codeBlock 内文字 mark | **不生效**(spec marks: '') | ⏳ |
| 5.5.12 | codeBlock 内 inputRule(`# ` 等) | 不生效(code: true 屏蔽) | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.5.13 | 悬停 codeBlock | ⋮⋮ handle 显示 | ⏳ |
| 5.5.14 | 拖 codeBlock 到其他位置 | 整块移动 | ⏳ |

#### slash / Turn Into

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.5.15 | 行首输 `/`,菜单含 "Code" | 是 | ⏳ |
| 5.5.16 | 输 `/code` Enter | 当前段变 codeBlock | ⏳ |
| 5.5.17 | codeBlock ⋮⋮ → "Turn into Paragraph" | 还原 paragraph | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.5.18 | codeBlock 内连续按 Tab | 多次缩进 | ⏳ |
| 5.5.19 | undo/redo codeBlock 创建 + 编辑 | history 正常 | ⏳ |
| 5.5.20 | 复制粘贴 codeBlock 内容到外部 | 纯文本(不带高亮) | ⏳ |
| 5.5.21 | 粘贴外部 `<pre><code>` HTML | 解析成 codeBlock | ⏳ |

#### ⏸️ 高级特性留 L6+(本节不做,记录决策)

| # | V1 已有特性 | V2 状态 |
|---|---|---|
| 5.5.L6.1 | 语言下拉选择(25+ 语言 + 搜索) | L6 阶段补 |
| 5.5.L6.2 | Mermaid 渲染(三模式 split/preview/code-only) | L6 阶段补 |
| 5.5.L6.3 | 6 个语言插件(html/js/markdown/mermaid 内置)| L6 阶段补 |
| 5.5.L6.4 | 复制按钮(顶部工具栏) | L6 阶段补 |
| 5.5.L6.5 | 下载 PNG(SVG → Canvas → PNG 2x retina) | L6 阶段补(仅 Mermaid 用) |
| 5.5.L6.6 | 全屏 / 拖拽平移 / 滚轮缩放 | L6 阶段补 |
| 5.5.L6.7 | 语法高亮(CodeMirror 装饰器 / Lezer)| L6 阶段补(V1 cmDarkTheme 也未真用) |
| 5.5.L6.8 | title attr(Canvas 场景) | L6 阶段补 |

---

### 5.6 horizontalRule — 对齐 V1

> V1 vs V2 关键差异(已修):
> - V2 spec **缺 atom: true** — 叶子节点不声明 atom 会让光标陷入 / 异常 ⚠️ 已补
> - V2 颜色 #3a3a3a 太深 → 改 V1 #444 / margin 16px → 1.5em ⚠️ 已修
> - V2 缺选中视觉 → 加 ProseMirror-selectednode 高亮 ⚠️ 已补

#### 输入规则触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.6.1 | 空段行首输 `---` | 当前段变 hr,**光标移到 hr 之后的新空段**(对齐 V1) | ⏳ |
| 5.6.2 | 段中输 `---` | 不触发(严格行首) | ⏳ |
| 5.6.3 | 输 `--`(2 个) | 不触发 | ⏳ |

#### 视觉

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.6.4 | hr 默认渲染 | 1px 灰线 #444,上下 margin 1.5em | ⏳ |
| 5.6.5 | hr 全宽 | 横跨编辑区(maxWidth 900px 内) | ⏳ |

#### 选中 / atom 行为

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.6.6 | 点击 hr | 整 node 选中(NodeSelection),线变蓝 + 虚线外框 | ⏳ |
| 5.6.7 | 选中 hr 后按 Backspace / Delete | hr 删除 | ⏳ |
| 5.6.8 | 方向键 ↑/↓ 经过 hr | 跳过 hr(光标不能进 hr 内,因 atom: true) | ⏳ |
| 5.6.9 | hr 上下两段都为空时,光标在下段 Backspace | 删 hr,光标到上段末尾 | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.6.10 | 悬停 hr | ⋮⋮ handle 显示 | ⏳ |
| 5.6.11 | 拖 hr 到其他段之前 | hr 整体移动 | ⏳ |

#### slash / Turn Into

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.6.12 | 行首输 `/`,菜单含 "Divider" | 是 | ⏳ |
| 5.6.13 | 输 `/divider` Enter | 当前段插 hr | ⏳ |
| 5.6.14 | hr 右键 → "Delete" | hr 删除 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 5.6.15 | hr 之后输入文字 | 在 hr 之后的段落正常输入 | ⏳ |
| 5.6.16 | 复制粘贴含 hr 的内容 | hr 保留 | ⏳ |
| 5.6.17 | undo/redo hr 创建 | history 正常 | ⏳ |

---

## 6. Marks 扩展 + 简单 block(L5-B3.3,逐项对照 V1)

> 阶段:替代被阻塞的 codeBlock 全量迁移
> 分支:`feature/L5B3.3-marks-and-simple-blocks`
> 跟踪文档:[v1-block-migration-checklist.md](./v1-block-migration-checklist.md)

### 6.1 underline mark — 对齐 V1

> V1 spec:`<u>` 标签 + `text-decoration=underline` style 反解。无 markdown input rule。
> V2 落地:marks/underline.ts + Mod-u keymap + 顶部 toolbar U 按钮 + floating-toolbar U 按钮

#### Schema / 渲染

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.1.1 | 选中文字按 Cmd+U | 文字加下划线(`<u>` 渲染) | ⏳ |
| 6.1.2 | 已下划线文字按 Cmd+U | 取消下划线(toggle) | ⏳ |
| 6.1.3 | 粘贴含 `<u>foo</u>` 的 HTML | 解析为 underline mark | ⏳ |
| 6.1.4 | 粘贴含 `style="text-decoration: underline"` 的 span | 解析为 underline mark | ⏳ |

#### 顶部 toolbar

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.1.5 | 顶部 toolbar 显示 "U" 按钮(B/I 之间)| 是,顺序 B → I → **U** → S → `<>` | ⏳ |
| 6.1.6 | 选中下划线文字时,toolbar U 按钮高亮 | 蓝色 active 态 | ⏳ |
| 6.1.7 | 点 toolbar U | 选区 toggle underline | ⏳ |

#### floating-toolbar(选中文字浮起)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.1.8 | 选中文字 → 浮条出现 | 含 5 按钮:B / I / **U** / S / `<>` | ⏳ |
| 6.1.9 | 选区在 underline 内时,浮条 U 按钮高亮 | 是 | ⏳ |
| 6.1.10 | 点浮条 U | toggle underline | ⏳ |

#### 跟其他 mark 共存

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.1.11 | 同一段文字加 bold + underline | 渲染 `<u><strong>...</strong></u>` 或 `<strong><u>...</u></strong>`(顺序由 schema 装载次序定) | ⏳ |
| 6.1.12 | 选中 bold + underline 文字按 Cmd+B | 仅取消 bold,保留 underline | ⏳ |
| 6.1.13 | underline 内 italic | italic 生效,下划线保留 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.1.14 | underline + undo/redo | history 正常 | ⏳ |
| 6.1.15 | underline 在 bullet list / heading 内 | 都生效 | ⏳ |

---

### 6.2 textStyle mark(文字色) — 对齐 V1 (Plan C-1 缩水)

> V1 spec:textStyle attrs.color(默认 null)+ `<span style="color:..."`>渲染
> V2 落地:mark spec 完全对齐 V1,**UI 缩水**为 6 色循环按钮(完整 10 色 ColorPicker 留 L5-B3.4)
> 6 色循环顺序:default(无)→ gray → yellow → blue → red → green → 回 default

#### Schema / 渲染

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.2.1 | 选中文字点 toolbar A 按钮 1 次 | 文字变 gray #9aa0a6 | ⏳ |
| 6.2.2 | 同选区点 A 第 2 次 | 变 yellow #f5c518 | ⏳ |
| 6.2.3 | 连点 6 次 | gray → yellow → blue → red → green → default(无色) | ⏳ |
| 6.2.4 | 选区已有 textStyle 时 A 按钮高亮 | 是 | ⏳ |
| 6.2.5 | 粘贴 `<span style="color: #ea4335">red</span>` | 解析为 textStyle mark + color attr 保留 | ⏳ |

#### floating-toolbar

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.2.6 | 选中文字浮条出现 | 含 A 按钮(顺序:B/I/U/S/`<>`/A/A̲) | ⏳ |
| 6.2.7 | 浮条 A 按钮点击 | 走 cycle 同上 | ⏳ |

#### 共存

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.2.8 | bold + textStyle 共存 | 可同时存在(两个 mark 独立) | ⏳ |
| 6.2.9 | 取消 textStyle(循环回 default)| 移除 mark,文字回默认色 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.2.10 | textStyle + undo/redo | history 正常 | ⏳ |

---

### 6.3 highlight mark(背景高亮) — 对齐 V1 (Plan C-1 缩水)

> V1 spec:highlight attrs.color(默认 'yellow')+ `<mark data-color="...">` 渲染
> V2 落地:mark spec 完全对齐 V1,UI 缩水同 6.2(6 色 rgba 半透明循环)
> 6 色循环:default → gray → yellow → blue → red → green → 回 default

#### Schema / 渲染

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.3.1 | 选中文字点 toolbar A̲ 按钮 1 次 | 背景 gray rgba(154,160,166,0.2) | ⏳ |
| 6.3.2 | 连点 6 次 | gray → yellow → blue → red → green → default | ⏳ |
| 6.3.3 | 已有 highlight 时按钮高亮 | 是 | ⏳ |
| 6.3.4 | 粘贴 `<mark data-color="yellow">` | 解析为 highlight mark + color attr | ⏳ |

#### floating-toolbar

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.3.5 | 浮条 A̲ 按钮 | 顺序最末(B/I/U/S/`<>`/A/A̲) | ⏳ |
| 6.3.6 | 点浮条 A̲ | cycle highlight | ⏳ |

#### 跟 textStyle 同时

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.3.7 | 同段文字加 textStyle red + highlight yellow | 红字黄底,两个 mark 独立 | ⏳ |
| 6.3.8 | cycle textStyle 不影响 highlight | 是 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.3.9 | highlight + undo/redo | history 正常 | ⏳ |

---

### 6.4 hardBreak block(行内软换行) — 对齐 V1

> V1 spec:inline node + selectable: false + `<br>` 渲染
> V2 落地:1:1(inline group / parseDOM br / toDOM br)+ Shift-Enter keymap

#### 触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.4.1 | 段落中按 Shift-Enter | 当前位置插入 `<br>` 软换行,光标在换行后 | ⏳ |
| 6.4.2 | 段落末尾按 Shift-Enter | 同上(不出段) | ⏳ |
| 6.4.3 | 普通 Enter(不 Shift) | 仍正常分段(走 PM 默认),不触发 hardBreak | ⏳ |
| 6.4.4 | heading 内 Shift-Enter | 同段插换行(标题不分裂) | ⏳ |
| 6.4.5 | bullet/ordered list 项内 Shift-Enter | 项内换行(不新建项) | ⏳ |

#### 渲染

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.4.6 | DOM 输出 | 同段内出现 `<br>` 标签 | ⏳ |
| 6.4.7 | hardBreak 不可选中 | 鼠标点 br 位置不进入选中态 | ⏳ |
| 6.4.8 | 粘贴 `<p>a<br>b</p>` HTML | 解析成 paragraph 含 hardBreak | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.4.9 | hardBreak + undo/redo | history 正常 | ⏳ |
| 6.4.10 | hardBreak 后输入文字带 mark | mark 正常生效 | ⏳ |

---

### 6.5 callout block(提示框) — 对齐 V1

> V1 spec:content: 'block+' + attrs.emoji 默认 💡,点 emoji 循环 10 个表情
> V2 落地:1:1(spec + node-view + emoji 循环 + 灰底)
> emoji 列表(对齐 V1):💡 ⚠️ ❌ ✅ ℹ️ 🔥 📌 💬 🎯 ⭐

#### 创建

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.5.1 | slash menu 输 `/callout` Enter | 当前段变 callout(💡 emoji + 灰底,光标在内容区) | ⏳ |
| 6.5.2 | 普通段点 ⋮⋮ → "Turn into Callout" | 段变 callout | ⏳ |
| 6.5.3 | 普通段右键 → "Turn into Callout" | 段变 callout | ⏳ |
| 6.5.4 | callout → paragraph Turn Into | 内容拆出为顶层段 | ⏳ |

#### 视觉对齐 V1

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.5.5 | callout 默认渲染 | 灰底 #252525 + 边框 #333 + 圆角 6px + padding 12/16 | ⏳ |
| 6.5.6 | emoji 字号 + flex 布局 | 20px,左侧固定不缩,跟内容并列 | ⏳ |
| 6.5.7 | hover emoji | 透明度 0.7 + cursor pointer | ⏳ |

#### emoji 循环

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.5.8 | 点 callout emoji 1 次 | 切到下一个表情(💡→⚠️) | ⏳ |
| 6.5.9 | 连点 10 次 | 循环回 💡 | ⏳ |
| 6.5.10 | 点击 emoji 时不污染 selection | 光标不偏(mousedown preventDefault) | ⏳ |
| 6.5.11 | emoji 不可编辑 | contentEditable=false 不能 focus | ⏳ |

#### 内嵌内容(content: block+)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.5.12 | callout 内多段 paragraph | 都在灰底内,emoji 仍在最左 | ⏳ |
| 6.5.13 | callout 内 H1/H2/H3 | heading 字号生效 | ⏳ |
| 6.5.14 | callout 内嵌 bulletList | bullet 工作正常 | ⏳ |
| 6.5.15 | callout 内 mark(Cmd+B / Cmd+U / 颜色) | 都生效 | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.5.16 | 悬停 callout | ⋮⋮ handle 显示在 callout 行(顶层 block) | ⏳ |
| 6.5.17 | 拖 callout 整体 | 整块移动 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.5.18 | callout + undo/redo(含 emoji 切换)| history 正常 | ⏳ |
| 6.5.19 | 粘贴 V1 callout HTML(`<div class="callout">`)| 仍解析(parseDOM data-emoji)| ⏳ ⚠️ V1 用 div.callout,V2 改 div.krig-callout — V1→V2 文档兼容性留 L5-B3.4 验证 |

---

### 6.6 toggleList block(折叠列表) — 对齐 V1

> V1 spec:content: 'block+',attrs.open 默认 true
> 行为:open=true 显 ▼ + 完整内容;open=false 显 ▶ + 仅首行(folded)
> V2 落地:1:1(spec + node-view + arrow + CSS `:not(:first-child) { display: none; }`)

#### 创建

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.6.1 | slash menu 输 `/toggle` Enter | 当前段变 toggleList(▼ 箭头 + 当前段为首行,光标在内) | ⏳ |
| 6.6.2 | 普通段点 ⋮⋮ → "Turn into Toggle List" | 段变 toggleList | ⏳ |
| 6.6.3 | 普通段右键 → "Turn into Toggle List" | 段变 toggleList | ⏳ |

#### 折叠行为(关键)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.6.4 | toggleList 内首行末尾按 Enter | 新建第二行(在 toggleList 内,展开态时可见)| ⏳ |
| 6.6.5 | 点 ▼ 箭头 | 切到 ▶,**首行之后所有子节点 display: none(视觉隐藏)** | ⏳ |
| 6.6.6 | 已折叠状态再点 ▶ | 切回 ▼,所有内容重现 | ⏳ |
| 6.6.7 | 折叠时 PM doc 内容不变 | open attr 切换,子节点仍在 doc 中 | ⏳ |
| 6.6.8 | 折叠态点击隐藏区域 | 不可见所以点不到(预期)| ⏳ |

#### 视觉对齐 V1

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.6.9 | 箭头宽 20px | 是,vertical-align: top + margin-top: 4px 跟首行对齐 | ⏳ |
| 6.6.10 | hover 箭头 | 浅色 hover 背景 rgba(255,255,255,0.1) | ⏳ |
| 6.6.11 | content 占用宽度 | calc(100% - 24px) 给箭头让位 | ⏳ |
| 6.6.12 | toggleList margin | 0.2em 上下 | ⏳ |

#### 内嵌内容(content: block+)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.6.13 | toggleList 内 H2 作首行 | 折叠时仅显 H2 首行 | ⏳ |
| 6.6.14 | toggleList 内嵌 bulletList | 展开正常,折叠时整个 list 隐藏 | ⏳ |
| 6.6.15 | toggleList 内嵌 callout | 嵌套合理 | ⏳ |
| 6.6.16 | toggleList 内 mark / heading 都可用 | 是 | ⏳ |

#### handle / 拖拽

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.6.17 | 悬停 toggleList | ⋮⋮ handle 显示 | ⏳ |
| 6.6.18 | 折叠态拖整个 toggleList | 整块移动,open attr 保留 | ⏳ |

#### 不回归

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 6.6.19 | toggleList + undo/redo(含折叠切换)| history 正常 | ⏳ |
| 6.6.20 | 粘贴 V1 toggle-list HTML | parseDOM div.krig-toggle-list 不接受 V1 div.toggle-list 命名 — 兼容性留 L5-B3.4 | ⏳ ⚠️ |

---

## 7. L5-B3.4 link mark + popup 基础设施 + ColorPicker 升级

> 阶段:link 全栈 + popup 基础设施 + ColorPicker 完整 UI 升级
> 跟踪:[stages/L5B3.4-link-and-popup-design.md](stages/L5B3.4-link-and-popup-design.md)

### 7.1 popup 基础设施(slot 维度,跨 view 复用)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.1.1 | popup-controller / registry 模块加载 | 启动 console 不报错 | ⏳ |
| 7.1.2 | floating-toolbar popup-trigger 类型按钮 click | 走 popupController.toggle 弹 popup | ⏳ |
| 7.1.3 | 同一时刻只允许一个 popup 可见 | 打开第二个 popup 时,前一个自动关 | ⏳ |
| 7.1.4 | 点 popup 外部 | 自动关闭 | ⏳ |
| 7.1.5 | 按 Esc | 关 popup | ⏳ |
| 7.1.6 | 再点同一 anchor 按钮 | toggle 关闭 popup | ⏳ |
| 7.1.7 | popup 位置 | anchor 下方水平居中,viewport 溢出时夹紧/翻边 | ⏳ |

### 7.2 link mark schema / 渲染

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.2.1 | LinkPanel 网页 Tab 输入 URL Enter | 选区文字变蓝 + 下划线(`<a href>`) | ⏳ |
| 7.2.2 | 链接末尾光标输新字符 | **不延长链接**(inclusive: false 生效) | ⏳ |
| 7.2.3 | 粘贴含 `<a href="...">x</a>` 的 HTML | 解析为 link mark + href 保留 | ⏳ |
| 7.2.4 | link 视觉 | #8ab4f8 蓝色 + 下划线,hover 变浅 | ⏳ |

### 7.3 LinkPanel 笔记 Tab

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.3.1 | 选中文字 → floating-toolbar 🔗 → 弹 LinkPanel | 默认在笔记 Tab,搜索框聚焦 | ⏳ |
| 7.3.2 | 输关键词 | filter 笔记列表(top 8 命中) | ⏳ |
| 7.3.3 | ↑↓ 键导航笔记列表 | 蓝色高亮跟随,Enter 应用 | ⏳ |
| 7.3.4 | 点笔记标题 | 选区文字变 link,href = krig://note/{id} | ⏳ |
| 7.3.5 | 点笔记右侧 ▶ | 进入 drill 视图,显示该笔记的标题列表 | ⏳ |
| 7.3.6 | drill 内 ↑↓ + Enter | 应用 krig://block/{id}/{anchor 编码标题} | ⏳ |
| 7.3.7 | drill 内 Esc | 返回一级笔记列表 | ⏳ |
| 7.3.8 | 输入 `krig://note/abc` 直接 Enter | 直接 apply(粘贴的完整链接) | ⏳ |

### 7.4 LinkPanel 网页 Tab

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.4.1 | 切到网页 Tab | 输入框聚焦,placeholder "输入网页地址..." | ⏳ |
| 7.4.2 | 输 example.com Enter | 自动补 https://,链接生效 | ⏳ |
| 7.4.3 | 输 https://krig.dev Enter | 直接 apply(已有协议不重复补) | ⏳ |
| 7.4.4 | 已有 link 时打开 LinkPanel | 自动选中匹配的 Tab(http → 网页 / krig:// → 笔记) | ⏳ |
| 7.4.5 | 已有 link 时显"移除链接"按钮 | 是 | ⏳ |
| 7.4.6 | 点"移除链接" | 取消选区 link mark | ⏳ |

### 7.5 link 点击路由(5 协议)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.5.1 | 点击编辑器内 https:// 链接 | 系统默认浏览器打开 | ⏳ |
| 7.5.2 | 点击 file:// 链接 | 系统默认应用打开文件 | ⏳ |
| 7.5.3 | 点击 javascript: 链接 | shell 拒绝(allowed schemes 检查),console.warn | ⏳ |
| 7.5.4 | 点 krig://note/{id} | 切当前 ws 左栏 activeNoteId 到目标(降级路径)| ⏳ |
| 7.5.5 | 点 krig://block/{id}/{anchor}(同文档) | 当场 PM 滚动到 heading + 蓝色高亮 2 秒 | ⏳ |
| 7.5.6 | 点 krig://block/{id}/{anchor}(跨文档) | 切笔记 + 加载完成后滚动 anchor | ⏳ |
| 7.5.7 | 点 media:// 链接 | console.warn(本阶段不支持) | ⏳ |

### 7.6 笔记导航历史栈

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.6.1 | NavSide 选 A → 选 B → 按 Cmd+[ | 切回 A | ⏳ |
| 7.6.2 | 切回 A 后按 Cmd+] | 前进到 B | ⏳ |
| 7.6.3 | A → B → C → 后退 → 选 D | forward 栈被清空(C 不可前进到) | ⏳ |
| 7.6.4 | 历史栈空时按 Cmd+[ | 静默(canGoBack 为 false) | ⏳ |
| 7.6.5 | 点击 link 跳转 | 推 back 栈,清 forward | ⏳ |

### 7.7 Cmd+K 触发

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.7.1 | 选中文字按 Cmd+K | 弹 LinkPanel(anchor 在 floating-toolbar 🔗 / 选区下方) | ⏳ |
| 7.7.2 | 光标态(空选区)按 Cmd+K | **不弹**(对齐 Q7=A 必须有选区) | ⏳ |
| 7.7.3 | 已弹 LinkPanel 按 Cmd+K | 不重复弹(Esc 关闭 / 点外关闭) | ⏳ |

### 7.8 ColorPickerPanel 完整 UI

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.8.1 | floating-toolbar A 按钮 click | 弹 ColorPickerPanel | ⏳ |
| 7.8.2 | floating-toolbar A̲ 按钮 click | 弹同一个 ColorPickerPanel(共享 popup)| ⏳ |
| 7.8.3 | 顶部 toolbar A / A̲ click | 同上 | ⏳ |
| 7.8.4 | popup 显示 10 文字色 + 10 背景色 swatch | 5×2 grid 布局 | ⏳ |
| 7.8.5 | 当前选区已有 textStyle 红色 | 红色 swatch 高亮(蓝边框 + ring) | ⏳ |
| 7.8.6 | 点击红色 swatch | 选区变红,popup 关闭 | ⏳ |
| 7.8.7 | 点 default(灰底)swatch | 移除 textStyle / highlight mark | ⏳ |
| 7.8.8 | hover swatch | scale 1.1 + 蓝边框 transition | ⏳ |

### 7.9 不回归(已有功能)

| # | 操作 | 期望 | 状态 |
|---|---|---|---|
| 7.9.1 | 现有 8 floating-toolbar 按钮(B/I/U/S/`<>`)| 全部仍工作 | ⏳ |
| 7.9.2 | 顶部 toolbar 现有按钮 | 全部仍工作 | ⏳ |
| 7.9.3 | undo/redo link 添加/移除 | history 正常 | ⏳ |
| 7.9.4 | undo/redo 颜色应用 | history 正常 | ⏳ |
| 7.9.5 | bold/italic/underline + link 共存 | 链接文字可同时加 mark | ⏳ |
| 7.9.6 | typecheck + lint 全过 | 实施末验证 | ⏳ |

---

## 修订记录

| 日期 | 改动 |
|---|---|
| 2026-05-06 | 初稿;5.1 bulletList 对照 V1 审计 + 29 测试条目 |
| 2026-05-06 | 5.1 追加 A/B/C 三块:A(5.1.30-36 PM 健全性补丁,⏳ 待验证)+ B(5.1.37-42 Notion 对标,⏸️ B 阶段)+ C(5.1.C1-C3 KRIG 范围外,N/A) |
| 2026-05-06 | § 6 新章节 L5-B3.3 marks 扩展 + 简单 block;6.1 underline mark 15 条审计 |
| 2026-05-06 | § 6.2 textStyle(10 条)+ § 6.3 highlight(9 条)审计;Plan C-1 缩水(完整 ColorPicker UI 留 L5-B3.4) |
| 2026-05-06 | § 6.4 hardBreak(10 条)审计 |
| 2026-05-06 | § 6.5 callout(19 条)审计 |
| 2026-05-06 | § 6.6 toggleList(20 条)审计 |
| 2026-05-06 | § 7 新章节 L5-B3.4(7.1-7.9 共 ~50 条)审计:popup 基础设施 / link mark / LinkPanel 笔记+网页 Tab / 5 协议路由 / 历史栈 / Cmd+K / ColorPickerPanel 升级 / 不回归 |
