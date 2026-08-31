# Thought Phase 4 — ebook source + AI response + dangling UI 手测清单

**前提**:`npm start` 跑起,Phase 1/2/3 smoke 已 PASS。

**Phase 4 验收范围**:
- ebook EPUB/PDF 标注双轨切到新 thought capability
- AI response 状态机(NoteView 选区 → 🤖 mock 2s 回复)
- dangling-anchor 角标(anchor.text 空时)
- Thought → eBook 跨槽 scroll

---

## A. EPUB highlight 走新 thought capability

**前置**:导一本 EPUB(若书架空,从 NavSide + 导入)。

**步骤**:
1. 切到 eBook tab,打开 EPUB
2. 在书内选中一段文字,弹色 picker,选黄色
3. 切到 Thought tab

**期望**:
- ✅ Thought 列表出现新卡片:`🖍️ 高亮` 类型,anchor 区显示 `📚 Book · {选中文字前 40 字}`
- ✅ EPUB 内该选区仍黄底高亮(host.addHighlight 同时调用)
- ✅ devtools 调 `electronAPI.thoughtListBySource('book', '<bookId>')` 返回该 thought

## B. EPUB legacy 数据兼容

**步骤**:若有之前 sub-phase 022 留的 reading-thought block 数据(老 highlight),重开 EPUB,看 hook 是否同时画出来

**期望**:
- ✅ 新 + 老高亮都画出来(按 cfi 去重,新数据优先)
- ✅ 点击老高亮 → 走 `lib.removeReadingThoughtBlock` 删
- ✅ 点击新高亮 → 走 `thoughtCapability.deleteThought` 删

## C. PDF rect 框选 → rect-frame thought

**前置**:导一本 PDF。

**步骤**:
1. 切 eBook tab,打开 PDF
2. toolbar 点 rect 模式
3. 在页面框选一块区域,选红色
4. 切 Thought tab

**期望**:
- ✅ 新卡片:`🔲 框选` 类型,anchor `📚 Book · {空}`(rect 无 text)
- ✅ PDF 页面上仍画红框

## D. PDF underline 划线 → underline thought

**步骤**:
1. PDF 模式切 underline
2. 横划一段文字,选蓝色
3. 切 Thought

**期望**:
- ✅ 新卡片:`〰️ 划线` 类型
- ✅ PDF 页面上仍蓝色划线

## E. AI response 状态机(mock)

**步骤**:
1. 切到 Note,选中一段文字(如"机器学习是什么")
2. floating toolbar 点 🤖 按钮

**期望**:
- ✅ 立即:Note 文字加紫色虚线下划线(thoughtMark--ai-response)
- ✅ 立即:右槽开 ThoughtView,出现新卡片 type=`🤖 AI 回复`
- ✅ 卡片中央显 `🤖 AI 正在思考...` spinner(摇摆动画 1.5s 循环)
- ✅ 2 秒后:spinner 消失,doc 填上 mock 回复正文(段落形式)
- ✅ 卡片右下出现 `📋 复制` 按钮,点击复制全部正文到剪贴板
- ✅ textarea 在 ai-response 类型下为 readOnly(不能编辑)

## F. dangling-anchor 角标

**步骤**:
1. 在 NavSide Thought 主舞台用 "+ Thought" 建一条独立 thought
2. devtools 手动 patch:`electronAPI.thoughtUpdateAnchor('<id>', { source:'note', resourceId:'fake-note', locator:{pmPos:0, anchorType:'inline', text:''} })`(anchor 文本为空)
3. 看卡片

**期望**:
- ✅ 卡片 anchor 区显 `⚠️ 锚点失效`(橙色斜体)代替正常文本

## G. Thought → eBook 跨槽 scroll

**步骤**:
1. 接 A(EPUB 高亮场景),在 Thought tab 切到别的 thought
2. 然后点击该 highlight thought 卡片 anchor 区(`📚 Book ·`)
3. 看 left slot 变化

**期望**:
- ✅ left slot 自动切到 eBook view
- ✅ EPUB 自动打开 + 跳到该 highlight 的 cfi 位置(若 ebook 当前在别的书,先 open(bookId))
- 类似 PDF rect/underline 跳到该页

## H. 全仓兼容

**步骤**:
1. 跑 Phase 1 / Phase 3 smoke 清单 — 应 100% PASS
2. eBook 现有功能(书签 / 翻页 / 搜索 / 进度持久化)— 不应回归
3. Note 现有功能(slash / floating bar / 颜色 / 链接)— 不应回归

---

**全部 PASS = Phase 4 验收通过。**
