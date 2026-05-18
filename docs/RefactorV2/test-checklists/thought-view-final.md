# Thought View 总测试清单(Phase 1-5 汇总,≥ 30 项)

**前提**:Phase 5 已完整 commit。`npm start` 跑起后逐项验证。

**汇总自**:
- Phase 1: thought-phase-1-smoke.md(6 项 IPC)
- Phase 3: thought-phase-3-smoke.md(8 项 anchor + 跨槽)
- Phase 4: thought-phase-4-smoke.md(8 项 ebook + AI + dangling)
- Phase 5 新增:体量审计 + Host 升级 + Phase 5 收尾验证

---

## A. 存储 / IPC(Phase 1,6 项)

1. devtools `electronAPI.thoughtCreate({type:'thought',resolved:false,pinned:false,doc:emptyDoc,folderId:null,anchor:null})` 返新 thought
2. `electronAPI.thoughtList()` 包含创建项
3. 重启 app,thought 仍在
4. `thoughtListBySource('note', noteId)` 返该 note 下 thought
5. `thoughtUpdateAnchor(id, null)` → 解依附 → listBySource 不返 / list 仍返
6. `thoughtDelete(id)` 后 list/listBySource 都不返

## B. NavSide Thought 主舞台(Phase 2,6 项)

7. NavSide 第 6 个 tab 💭 Thought 出现(顺序 Note < eBook < Web < Graph < Thought)
8. 点 "+ Thought" → 列表区出现新卡片,自动 focus
9. Host 输入文字 → 1s 后落库(重启验证)
10. 切 type 菜单(9 种全有)
11. resolve/pinned toggle 视觉正确(resolved 卡片透明 + 横线;pinned 置顶)
12. 拖到 folder 内 + folder 隔离(Note tab 看不见 Thought folder)

## C. Note source 3 态 anchor(Phase 3,8 项)

13. Note 选文字 ⌘⇧M → inline mark(下划线 + 蓝色虚线)+ 右槽开 Thought
14. 光标停段落 ⌘⇧M → block frame(蓝色外框) + 卡片(anchorType='block')
15. 光标在 image 节点 ⌘⇧M → image outline + 卡片(anchorType='node')
16. floating toolbar 💭 等价 ⌘⇧M
17. 点 Note 下划线 → Thought tab 滚到对应卡片并激活
18. 点 ThoughtCard anchor → NoteView 滚动 + flash 动画
19. Note 撤销 ⌘Z mark → mark 消失但 thought 仍在(charter §1.4 line 199 view 行为)
20. 切 thought type → Note mark 颜色变(resolveThoughtType callback 同步)

## D. eBook source(Phase 4,6 项)

21. EPUB 选文字 + 选色 → Thought tab 出现 highlight 卡片(type='highlight')
22. PDF 框选 + 选色 → rect-frame 卡片
23. PDF 划线 → underline 卡片
24. 重开书:新建标注重绘高亮
25. legacy reading-thought block 数据(若有)仍能读出来不丢
26. ThoughtCard 点 anchor → ebook view 自动切 + open(bookId) + 跳 page/CFI

## E. AI response(Phase 4,3 项)

27. Note 选文字 → 🤖 → 立即出 ai-response 卡片 + spinner(摇摆动画)
28. 2s 后 spinner 消失,doc 填上 mock 回复段落
29. ai-response 卡片右下 📋 复制 → 剪贴板含完整正文

## F. dangling-anchor + Workspace 隔离(Phase 4,3 项)

30. anchor 存在但 locator.text 空 → 卡片显 `⚠️ 锚点失效`(橙色斜体)
31. 两个 workspace 同时开 Thought tab → activeThoughtId 互不干扰
32. 切 workspace → expandedFolders / selectedIds 各自独立

## G. Phase 5 升级验证

33. ThoughtCard 内编辑用 Host(不再是 textarea):
    - 可输入富文本(粗体 ⌘B / 斜体 ⌘I)
    - block handle ⋮⋮ **不出现**(plugins.blockHandle:false)
    - `[[` 不触发 noteLink 搜索(plugins.noteLinkCommand:false)
34. 切换 thought:Host instance 重建(key=thoughtId),无 stale state
35. AI ai-response 卡片 Host 进入 readOnly 态(不能编辑)
36. thought-commands 命令注册 11 个(thought-view.create-thought / set-active /
    delete-active / delete-by-tree-id / create-folder / change-type / toggle-resolve /
    toggle-pinned / add-from-note / ask-ai-from-note / scroll-to-source)
37. charter §1.4 体量审计:thought-commands.ts 140 行 ≤ 200(从 468 减 70%)

## H. 全仓兼容

38. Note 现有功能全部不回归(slash / floating bar / 颜色 / 链接 / image)
39. eBook 现有功能不回归(书签 / 翻页 / 搜索 / 进度持久化)
40. Graph / Web view 不回归

---

**全部 PASS = thought-view feature 验收通过,可合 main。**
