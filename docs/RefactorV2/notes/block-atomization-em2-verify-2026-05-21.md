# Stage 2 EM2 验收报告

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **commits**:`c4bb1520` D-10/D-11 偏离 / `f7f4fd49` assemble+dissect / `59bf92b7` diff / `7ba23467` cache / `a121c356` capability rewrite
> **验收依据**:实施计划 §3.4 EM2 4 条
> **状态**:✅ PASS(2026-05-21 19:03 用户字面拍板通过)
>   - 静态:typecheck 全绿 + lint 0 新增 warning
>   - 手动 EM2.3 / EM2.4 round-trip:用户**清旧 note 重新测**,console 0 throw → PASS
>   - dup-id bug fix(`dc74a4de`):PM split / paste 字面继承 attrs.id → plugin 一遍扫 seen Set 去重
>   - D-10 ebook reading-thought 路径 + Stage 7 T5 Cmd+C/V:字面**跳过**EM2 验,留 Stage 7 兑现

---

## 静态检查(claude 自验,PASS)

### EM2.1 ✅ npm run typecheck 全绿

```bash
$ npm run typecheck
> krig-note-v2@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json
(empty output = pass)
```

### EM2.2 ⚠ npm run lint = 3 个 main 起点遗留 warning(本 Stage 0 新增)

```
build-block-indent-keymap.ts:20:37 warning  'Transaction' is defined but never used
build-block-indent-keymap.ts:21:15 warning  'EditorView' is defined but never used
ThoughtCard.tsx:48:10 warning  'extractTitle' is defined but never used
```

字面 D-05 登记的起点遗留,本 sub-phase 不修。**本 Stage 0 新增 lint warning**。

---

## 手动测试(用户验,2 条)

### 验证准备

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout feature/L7-block-atomization
git log --oneline -5  # 顶应是 a121c356

# ⚠ D-11 字面用户拍板:Stage 2 改完 updateNote 走 diff 拆解后,既有 V2 storage
#   数据(整篇 doc 1 atom 形态)读不到。**清空本地旧数据**(用户已确认):
#
# rm -rf ~/Library/Application\ Support/krig-note-v2/krig-data
# (或在 app 设置内"清空数据库"按钮,如有)
#
# 重启即从空状态开始。

npm start
```

### EM2.3 创建 note → getNote 字面相等(round-trip)

**操作**:
1. App 启动后 NavSide ➕ 新建 note
2. 输入 "hello" / Enter / 输入 "world" / Enter / 输入 "code line"
3. DevTools Console:
   ```js
   // 拿当前 note 的 PM doc
   const docFromView = __INSTANCE_REGISTRY__?.get('note-view')?.view.state.doc.toJSON()
   console.log('view doc:', docFromView)

   // 拿 note id(从 NavSide URL 或 wsState):
   const noteId = /* 从应用拿到当前 noteId */

   // 拿 capability 拼装的 doc(经过 storage round-trip)
   const noteInfo = await window.electronAPI.noteGet(noteId)
   console.log('capability doc:', noteInfo.doc.payload)
   ```
4. 比对:`docFromView.content` 应**字面等价于** `noteInfo.doc.payload.content`(顺序 / type / attrs.id 全部对齐)

**预期**:
- 每段 paragraph attrs.id 字面非 null(ULID 26 字符)
- view 端 doc 和 capability 拼装 doc **字面相等**(同样 3 paragraph,id 字面一致)
- 关闭重开 note → 再次 getNote 字面相等(cold cache 走 assemblePmDoc 字面拼装相同结果)

### EM2.4 updateNote round-trip + diff 算法 verify

**操作**:
1. 新建 note + 输入 3 paragraph(A / B / C),记录 storage atom 数量
2. DevTools Console:
   ```js
   const noteId = /* 当前 noteId */

   // 拉 storage 内本 note 相关 atom + edge 统计
   const allAtoms = await window.electronAPI.storage_listAtoms({ domain: 'pm' })
   const blockEdges = await window.electronAPI.storage_listEdges({ predicate: 'user:krig:belongsToNote', objectAtomId: noteId })
   console.log('block atoms:', blockEdges.length)
   // 预期:3(三个 paragraph,每个独立 atom)

   const nextEdges = await window.electronAPI.storage_listEdges({ predicate: 'user:krig:nextSibling' })
   const nextForThis = nextEdges.filter(e => /* subject 在 blockEdges 内 */)
   console.log('nextSibling within note:', nextForThis.length)
   // 预期:2(N-1 链)
   ```
3. 在 note 中间插入新段 D(变成 A / B / D / C),记录新 atom 数量 + diff:
4. 预期:
   - block atom 数 = 4(增 1)
   - nextSibling 边数 = 3(链:A→B→D→C)
   - D 的 attrs.id 字面是新 ULID

注:`storage_listAtoms` / `storage_listEdges` IPC 字面可能未暴露给 renderer
(decision 008 §4 字面禁止 view 层 import @storage),此场景可在 main 进程
DevTools 或新建临时 IPC 暴露 listAtoms 给 debug 用。**或者**用户字面观察:
- 创 note → 输入 N paragraph → 关闭重开 → 字面文本 / id 完整保留 = 隐含 round-trip OK

**预期**:
- updateNote 走 diff 后,storage 内 atom 数量 = doc 内 block 数量(1:1)
- nextSibling 边数 = block 数 - 1
- 关闭重开 / 切走再切回 → assemblePmDoc 字面拼出相同 PM doc

---

## 已知遗留 / 偏离

### D-10 reading-thought 通过 updateNote 走拆 atom 路径

**字面**:ebook capability addReadingThoughtBlock / removeReadingThoughtBlock 字面
调 note.updateNote(thought.id, ...)。本 Stage 2 实施字面**不查 hasNoteView**,所以
reading-thought atom 字面也走 dissect → block atom → 重写。

**测试场景**:
- 打开一本 PDF → 划高亮(addReadingThoughtBlock 触发)
- 字面观察 reading-thought 对应的 pm atom 被拆为多 block atom + 边(同 note 模型)
- 重开 → reading-thought 字面 assemble 回原样

**风险**:reading-thought atom 字面没有 hasNoteView 边但有 hasReadingThought 边,storage
listAtoms({domain:'pm'}) 字面会返回它(连同 block atoms),listNotes 字面 hasNoteView
filter 字面已剔除 — 字面安全。

### D-11 旧数据不兼容

**字面**:Stage 6 migration 前的旧 V2 数据(整篇 doc 1 atom)在 Stage 2 之后字面
getNote 字面会 `assemblePmDoc` 返 null(无 belongsToNote 边 → blockIds=[] → doc.content=[])。
**用户拍板清空本地数据**(2026-05-21)。

### 暂行简化(Stage 9 反向更新登记)

1. **listItem 用 _assemblyHints.listType 保 bullet/ordered 区分**:dissect 写入,assemble
   重建容器时读;非 PM schema 字段,字面 PM nodeFromJSON 字面会再 strip(无 side-effect)
2. **orderedList.start 字段丢失**:重建容器 default `start: 1`,字面字面登记 Stage 9
   反向更新决议字面接受此简化(高阶 list 配置项暂不保留)
3. **tableCell 字面单行 tableRow 重建**:wrapTableCells 字面 v1 把所有 cells 塞到单个
   tableRow,字面登记 Open Question(决议 026 §13 待扩 — 真实 row × col 信息字面丢)。
   字面影响:单元格内容 / id 保留,但表格"形状"丢失。Stage 7 测试 T7 字面 verify。

---

## 后续步骤

✅ **EM2 字面通过(2026-05-21 19:03)**,推进 Stage 3。

字面已兑现:
- EM2.1 typecheck 全绿
- EM2.2 lint 0 新增 warning
- EM2.3 创 note + 3 paragraph + 关闭重开 → 字面相等(用户清旧 note 重测,console 0 throw)
- EM2.4 split / 编辑 → 字面不再 dup-id throw

字面**留 Stage 7 兑现**(用户拍板跳过 EM2 验):
- D-10 ebook reading-thought 走 updateNote 路径 → T8 字面验收
- Stage 7 T5 Cmd+C/V → 字面 verify "原段 id 不变 / 副本各自新 id"

中途 1 个 followup fix:
- `dc74a4de` PM split/paste 字面继承 attrs.id 触发 dup-id throw → plugin seen Set 一遍去重

---

*EM2 verify · 2026-05-21(用户字面通过)*
