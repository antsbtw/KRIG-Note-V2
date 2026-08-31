# Thought Phase 3 — Note source 三态 anchor + 跨槽通信 手测清单

**前提**:`npm start` 跑起,Phase 1 + 2 smoke 已 PASS。

**Phase 3 验收范围**:Note source 三种 anchor(inline mark / block frame / image attr)
+ ⌘⇧M / 💭 floating 触发 + Note ↔ Thought 双向跨槽通信。

---

## A. inline mark anchor

**步骤**:
1. 在 Note tab 选择一段笔记,光标进入编辑器
2. 选中一段文字(如"机器学习")— 必须在单 paragraph 内、不能覆盖整段
3. 点 floating toolbar 💭 按钮(或按 ⌘⇧M)

**期望**:
- ✅ 选中的"机器学习"加上 **下划线 + 蓝色虚线** 装饰
- ✅ 右槽自动开 ThoughtView,出现新卡片,自动激活
- ✅ 卡片 anchor 区域显示"📝 Note · 机器学习"
- ✅ 卡片类型默认 `💭 思考`

## B. block frame anchor

**步骤**:
1. 光标停在某段落里(不选文字,或选中覆盖整段)
2. ⌘⇧M

**期望**:
- ✅ 该段落整块加 **蓝色边框 outline**(`.krig-thought-block-frame`)
- ✅ 右槽出现新卡片,anchor 区域显示"📝 Note · {段首 100 字}"

## C. image node attr anchor

**步骤**:
1. 笔记里插入一张图片(slash `/image` 或粘贴)
2. 点击图片让光标进入图片区域
3. ⌘⇧M

**期望**:
- ✅ 图片外圈加 **蓝色 outline**(`.krig-image-block[data-thought-id]`)
- ✅ 右槽出现新卡片,anchor 区域显示"📝 Note · [图片] {alt}"

## D. Note → Thought 跨槽激活

**步骤**:
1. 接 A,先关闭右槽 ThoughtView(或切到 Note tab 单栏)
2. 点击 Note 文档里之前加的下划线"机器学习"

**期望**:
- ✅ 右槽自动开 ThoughtView
- ✅ 该 thought 卡片自动激活(列表里高亮)

类似地测 B(点 block frame 区域)和 C(点 image)。

## E. Thought → Note 跨槽跳转

**步骤**:
1. 在 ThoughtView 列表里选中一个有 anchor 的卡片(任意 A/B/C)
2. 点击卡片顶部 anchor 区域(显示"📝 Note ...")

**期望**:
- ✅ NoteView 滚动到该 anchor 位置
- ✅ 对应 mark/block/image **闪一下高亮**(`.krig-thought-anchor-flash` 1.5s 动画)
- ✅ 若该 thought 挂在不同 note 上,先切 activeNote 再滚动

## F. type 切换同步色

**步骤**:
1. 接 A,在 ThoughtCard 顶部 type 下拉里改成 `❓ 疑问`

**期望**:
- ✅ Note 内对应的下划线 mark **马上变红色**(thoughtMark--question)
- (若是 block frame 场景,外框颜色变红 — 通过 resolveThoughtType callback 同步)

## G. 撤销 mark(dangling-anchor 态)

**步骤**:
1. 接 A,在 Note 内按 ⌘Z(标准 PM undo) 撤销刚加的 mark
2. 看 ThoughtView 卡片

**期望**:
- ✅ Note 内下划线消失
- ✅ ThoughtCard **仍存在**(thought atom 不会自动删)
- 🟡 但 anchor.locator.pmPos 现在指向"找不到 mark"的位置 → 状态为 **dangling-anchor**(Phase 3 暂不显 ⚠️ 角标,Phase 4 加)
- ✅ 点击卡片 anchor 跳转 — 走 scrollToThoughtAnchor 仍能滚到 pmPos(若文档无变化)或滚到 0(若文档结构已变)

## H. 全仓兼容

**步骤**:
1. 跑 Phase 1 smoke 6 项 — 应仍 100% PASS
2. 切到 NoteView,做普通编辑 — 不应有任何回归(thoughtMark `excludes:''` 不互斥其他 mark,bold/italic/color/link 同位置叠加正常)
3. 切到 graph-canvas/ebook view — 不应有任何回归(thought capability install 是 view-scoped)

---

**全部 PASS = Phase 3 验收通过。**
