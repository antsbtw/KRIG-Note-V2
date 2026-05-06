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

## 修订记录

| 日期 | 改动 |
|---|---|
| 2026-05-06 | 初稿;5.1 bulletList 对照 V1 审计 + 29 测试条目 |
| 2026-05-06 | 5.1 追加 A/B/C 三块:A(5.1.30-36 PM 健全性补丁,⏳ 待验证)+ B(5.1.37-42 Notion 对标,⏸️ B 阶段)+ C(5.1.C1-C3 KRIG 范围外,N/A) |
| 2026-05-06 | § 6 新章节 L5-B3.3 marks 扩展 + 简单 block;6.1 underline mark 15 条审计 |
