# per-slot 资源抽象 — 实施交接

> 立项:2026-08-08
> 前置:分支 `feat/multi-window-step2`(note + eBook 已各自完成 per-slot)
> 状态:**设计已拍板,待实施**

---

## 0. 用户诉求(原话)

> 把 navSide+View 做成一个固定的结构层,其他任何 view 的具体实现都调用这个方法。
> 这样就提升了可靠性,而不是修补代码,最终还是各个 view 各自实现这个方法。

> 我不需要只做一半的改造,需要一个干净纯粹的抽象,不想遗留技术债。

> **确保未来不会各个 view 之间再单独绑定 navSide。**

最后一句是**验收核心**:不只要抽出层,还要**机制上堵死**绕过它的路。

---

## 1. 为什么现在抽(以及为什么之前不抽)

note(`4fda395b`)和 eBook(`3aabe642`)已各自完整走过一遍 per-slot。
**两份平行实现已经存在**,而且 eBook 那轮把 note 踩过的坑重踩了三个
(✕ 关错栏 / 删资源只清 left / 右键取错资源)—— 这就是用户担心的「各自实现」。

之前不抽是因为只有一个实现,照单一实现抽的接口大概率不合身。现在有两个,
共性可信了。**第三个(Web/Graph)不要再抄第二遍**,这是本次的意义。

---

## 2. 边界:抽什么、不抽什么(**最重要的一节**)

上一轮讨论中曾有一个**错误表述**需要在此纠正:说过「抽出的层管不住 eBook 的
出画面路径(它靠 IPC 广播)」。这个说法把两件事混为一谈了:

| 关注点 | 各 view 是否同构 | 本次处理 |
|---|---|---|
| **哪个槽持有哪个资源**(状态归属) | **完全同构** —— note/eBook 逐行对应 | ✅ **抽** |
| **资源变了怎么让画面动**(更新传播) | 天生不同(note 字段订阅 / eBook IPC 广播 / Web webview 导航) | ❌ **不抽** |

**它们本来就不该在同一层。** 把 IPC 广播塞进「资源管理器」会让抽象层知道 eBook 的
IPC 细节,那才是不纯粹。类比:React 管 state,不管你怎么发请求。

⇒ **「不抽更新传播」不是留技术债,是正确的边界。** 实施时不要试图统一它。

已同构、必须收进新层的(实测清单,`slot === 'right' ? … : …` 形态):

```
src/views/note/NoteView.tsx:75
src/views/note/link-click-integration.ts:88
src/views/note/nav-side-content.tsx:77
src/views/note/toolbar-content.tsx:48
src/views/note/note-commands.ts:211
src/views/note/data-model.ts:615,619,646
src/views/ebook/data-model.ts:179,198,233
```

`note-commands.ts:255` / `bookshelf-commands.ts:117`(`getActiveSlot() === 'right' ? 'left' : 'right'`
求对侧槽)也是重复,一并收进新层作 `otherSlot()`。

**不要动**:`active-slot.ts:139-140`(那是槽→viewId 解析,已是单一来源)、
`SlotArea.tsx:125`(payload 按位置取,属渲染布局非资源归属)。

---

## 3. 目标形态

新建 `src/workspace/workspace-state/slot-resource.ts`(位置可议,与 `active-slot.ts` 同级)。

view 只声明「我的资源是什么、存哪个 pluginStates key、字段怎么命名」,
**不再各自处理槽分发**。要点:

- 一个 view 一次声明,拿到一组读写 API(`get(ws, slot)` / `set(wsId, slot, value)`)
- left 字段名保持历史名(`activeNoteId` / `activeBookId`),right 用 `right*` ——
  **不做数据迁移**,历史数据天然落 left 槽
- 提供 `otherSlot(slot)` 工具,消灭各处的对侧三元表达式
- 与 `active-slot.ts` 的关系:activeSlot 回答「当前哪个槽」,slot-resource 回答
  「某个槽持有什么」。**两者不重叠**,后者不得自行判断当前槽

具体 API 形状由实施者设计 —— 上面是约束不是签名。**但必须满足 §5 的验收线**。

---

## 4. 必须一起做:守卫(用户诉求的「保证」所在)

抽象层只是「提供了正确的路」,守卫才是「堵死错误的路」。**用户明确要后者。**

**形态:vitest 测试**(进现有 625 那批,`npm test` 即跑,零新基建;
本项目无 custom eslint rule 先例,不新建该基建)。

至少两条断言:

1. **禁止绕过**:源码扫描,`slotBinding.left ===` / `slotBinding.right ===` 形态
   不得出现在 `src/views/**` 与命令 handler 中(反推自己在哪一栏 = 已踩两次的
   反模式,见 memory `project-dont-guess-own-slot`)。
   `active-slot.ts` / `SlotArea.tsx` 等框架层需显式白名单并注明理由。
2. **禁止重复实现**:`slot === 'right' ? … : …` 形态不得出现在 `src/views/**`
   —— 该判断只允许存在于 slot-resource 层内部。

测试失败信息要**能指导修复**(告诉开发者该改用哪个 API),不能只报 "found 3 matches"。

---

## 5. 验收线(可检验,不靠自述)

- `grep -rn "slot === 'right' ?" src/views/` → **零命中**
- `grep -rn "slotBinding.right ===\|slotBinding.left ===" src/views/` → **零命中**
- note 和 eBook 的 data-model **不再各自实现按槽取字段**,全部委托新层
- **两份平行实现被删除,不是加一层留着旧的**(用户:不做一半改造)
- 守卫测试存在且**能真的失败**:实施完请故意加一行违规代码验证它报错,然后删掉
  (不验证的守卫等于没有守卫)

---

## 6. `readingState` 死字段 —— ⚠️ 有陷阱,先读完再动

用户要求不留技术债,此字段需清理。**但有一个同名陷阱,删错会破坏阅读位置恢复:**

| | 位置 | 状态 | 处置 |
|---|---|---|---|
| **renderer 副本** | `views/ebook/data-model.ts` 的 `readingState` / `rightReadingState`(pluginStates) | 只写不读 —— 唯一写入点 `use-ebook-progress.ts:56,75`,**无任何读取点** | ✅ 可删 |
| **主进程 reading-state atom** | `platform/main/ebook/capability-impl.ts` 的 `getReadingStateForBook` | **被读 8 处**,是真正的阅读位置来源(恢复走 `entry.lastPosition`) | ❌ **绝不能动** |

两者名字相似但完全无关。**只删 renderer 那份 pluginStates 副本。**

删前**必须再 grep 自证**(用户铁律,memory `feedback-grep-shared-edge-before-delete`):
若发现任何隐藏消费点 → **保留并报告**,不硬删。

同时删掉 `use-ebook-progress.ts` 里对应的写入调用(只写不读 = 每翻页一次无用的
pluginStates 写入 + 持久化 IPC,删掉是净收益)。

---

## 7. 硬约束

1. **不抽更新传播**(§2)—— 只抽状态归属,IPC/订阅留各 view
2. **不做数据迁移** —— left 沿用历史字段名,历史数据天然落 left
3. **不新建 eslint 基建** —— 守卫走 vitest
4. **不碰 `active-slot.ts` 的单一来源地位** —— slot-resource 不得自行判断当前槽,
   需要时调 `getActiveSlot()`
5. **删字段先 grep 自证**,有疑点则保留并报告
6. **fail loud** —— 非法槽值 / 未声明的资源类型要 `console.error`,不静默兜底
7. **两份旧实现必须删除**,不允许"新层 + 旧代码并存"

---

## 8. 质量门槛

- `npx tsc --noEmit -p tsconfig.json` —— 基线仅 1 条
  `src/views/x-inbox/XInboxView.tsx(714,48) WebkitAppRegion`,不得新增,**不要修它**
- `npx vitest run` —— 基线 `625 passed`,**只能增(新守卫测试)不能减**;
  6 个 suite 因 Electron `app.getPath` 在 vitest 下不可用而 import 失败,属正常
- 纯重构 + 新测试,GUI 行为**不应有任何变化** —— 若发现行为变了,说明抽错了

---

## 9. 真机验证

本次是重构,理论上零行为变化。但 note/eBook 双开是核心路径,请**如实报告**能验到哪一步。
若无 GUI 驱动手段,明确说"未验",并给出代码落点供人工对照(前两轮的做法,可沿用)。

最低要求:构建通过 + Electron 拉起无错。

---

## 10. 参考

- `src/slot/workspace-bus/PROTOCOL.md` §1.5 —— Slot 对称性原则(本次宪法)
- `src/workspace/workspace-state/active-slot.ts` —— 单一来源的既有样板,
  其文档头写了"为什么必须单一来源",新层可沿用同样的自我约束写法
- `docs/90-archive/refactor-v2/stages/slot-navside-follow-active-design.md` —— 上一轮交接
- 前序 commit:`4fda395b`(note per-slot)、`3aabe642`(eBook per-slot)——
  两份待合并的平行实现

## 11. 交付

- 建议 2-3 个 commit(抽层 / 改造两个 view / 守卫+清理)
- commit message 中文,写**根因与取舍**,不只列改动
- 完成后回报:§5 五条验收线的实际 grep 输出、tsc/vitest 实际输出、
  守卫测试的"故意违规→报错"验证结果、§6 grep 自证结果
- **如实报告**:哪条没做到、哪里偏离设计,直说
