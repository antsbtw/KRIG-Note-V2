# NoteView 双向同步架构 — 方案决策文档

> 2026-05-20。撰写背景:今天连续打了 3 个补丁(0ba6f74b / 692a82a7 / d982a921),用户反馈"延时不靠谱",于是从根因层重新设计。审计 v1 checklist 发现 P1#1 漏洞,审计 v2 (角度 A+C) 发现 NavSide title 失效。每次推一步都暴露下一个问题。本文把决策空间一次列清楚,**不下结论,留你选**。
>
> 关联:[cursor-jump-rootcause.md](cursor-jump-rootcause.md) 问题分析、[host-ref-based-checklist.md](host-ref-based-checklist.md) v2 实施清单。

---

## 1. 核心矛盾

KRIG 的 NOTE_LIST_CHANGED 广播服务**两个互斥需求**:

| 订阅者 | 收到 echo broadcast 时该不该刷新? |
|---|---|
| **NoteView Host**(编辑中的 PM 实例) | **不该** — 自己的编辑落 DB 又回来,view 早已更新,刷新会拉旧 doc 覆盖最新 selection 致光标跳 |
| **NavSide note 列表**(显示 title) | **该** — 用户改了首段 title 派生变,NavSide 列表上的 title 要立即看到 |
| **TOC**(显示 heading 列表) | **该** — 用户加了/删了 heading,TOC 要立即更新 |
| **note-link search panel** | **该** — 列表元数据需要新鲜 |

也就是说,**同一条广播**对**同一进程 / 同一 renderer / 同一 React tree** 里的不同组件,**预期不同行为**。

这不是"过滤错"的问题,是**频道设计错**:一个 channel 承担了两种语义(list metadata 变化 + doc 内容变化)。

---

## 2. P1#1 真实场景(grep 验证)

| 场景代号 | 描述 | 是否实施 | 优先级 |
|---|---|---|---|
| 1a | 同进程跨 view 写 thought:ebook handler 调 `appendReadingThoughtBlock(bookId)` → `updateNote(thoughtId)` | ✅ ([src/platform/main/ebook/capability-impl.ts:694, 723](../../src/platform/main/ebook/capability-impl.ts#L694)) | 高 |
| 1b | 同 renderer 多 NoteView 实例(分屏) | ❌ 当前不支持([[active-resource-id-arch-debt]]) | 0 |
| 1c | 跨进程协作 | ❌ KRIG 是单用户本地 | 0 |
| 1d | 导入路径:新建 note 而非修改 | ✅(extraction-import) | 不属于 P1#1(创建 note 不冲突 useEffect[doc]) |
| 1e | AI 后台批改 note | ❌ 未实施 | 0 |

**结论:P1#1 真实有效的场景只有 1a**。"用户在 NoteView 打开了一个 thought,同时切回 ebook 加了一条 highlight,NoteView 应该看到那一条新增的 thought block"。

---

## 3. 方案空间(8 个候选)

按"层次 / 是否解决 P1#1 / 风险点"列。✅ = 解决,❌ = 不解决,⚠️ = 部分/有条件。

| # | 名 | 改动层 | 修跳末尾 | P1#1 | 关键风险 / 备注 |
|---|---|---|---|---|---|
| 1 | 200ms 时间窗 | view | ⚠️ 多数情况 | ❌ | **已废**:靠延时碰运气,慢机器/卡顿就漏。今天已合 main 但用户明确否决 |
| 2 | JSON 字面指纹 | view | ⚠️ 极少情况 | ❌ | **已废**:IPC 序列化 key 重排,字面指纹永远失配 |
| 3 | 角度 A 单 channel 排除 sender | main IPC | ✅ | ⚠️ | NavSide / TOC / note-link 等同 renderer 订阅者**全部失效** |
| 4 | 角度 A 双 channel(LIST_CHANGED / DOC_CONTENT_CHANGED) | main IPC | ✅ | ✅ | IPC 协议改动中等,2 个 channel 同步语义清晰 |
| 5 | 角度 C 单走 + 完全屏蔽同 noteId broadcast | view | ✅ | ❌ | 简单粗暴,1a 用户体验受损 |
| 6 | 角度 C + view 层 PM toJSON sig | view | ✅ | ⚠️ | sig byte-stable 不保证(PM attrs 顺序依赖 schema build,跨 view 算 sig 一致性需测试) |
| 7 | 角度 C + visibility/focus 切回刷新 | view | ✅ | ⚠️ | 切回 NoteView 时才看到 1a 更新,体感"切窗口才更新"略慢但可接受 |
| 8 | 角度 C + 角度 A 双 channel | main+view | ✅ | ✅ | 最干净;改动面较大但语义最清晰 |

### 3.1 已废方案(#1, #2)

不再考虑。

### 3.2 角度 A 单走(#3) — 已否决

```
NOTE_UPDATE handler 给 broadcastNoteListChanged 传 sender.id
broadcast 时排除该 renderer
```

**问题**:同 renderer 内 NavSide / TOC / note-link 等正常订阅者也收不到广播,title/heading/list 都不刷新。**用户审计反馈中已确认**。

### 3.3 角度 A 双 channel(#4)

```
- NOTE_LIST_CHANGED(原):所有写都广播给所有 renderer,只携 metadata(id/title/folderId/updatedAt)
- NOTE_DOC_CONTENT_CHANGED(新):带 noteId+doc payload,**写时若有 sender 则排除 sender**
- NavSide / TOC / note-link 订阅前者
- Host 订阅后者(通过 view 层 hook)
```

**优点**:
- 语义清晰:metadata 一条 channel,内容一条 channel
- 不靠时序、不靠指纹
- 外部更新(无 sender)自然推给所有 Host 包括发起 ebook view

**缺点**:
- IPC 协议加 1 个 channel,需要改:
  - `channel-names.ts` 加常量
  - main handlers.ts NOTE_UPDATE 同时发两个广播,DOC_CONTENT_CHANGED 带 sender 排除
  - main ebook capability-impl 内的 `updateNote` 调用要确保也发 DOC_CONTENT_CHANGED(无 sender)
  - preload 暴露新 channel listener
  - view 层加 hook 订阅 DOC_CONTENT_CHANGED 喂给 Host
- 整体 +60 行,影响 4-5 个 main/preload/types 文件

**风险**:
- 两个 channel 不能完全独立 — DB 提交后**先发哪个**有时序意义?(metadata 先到,内容晚到 → NavSide title 已变但 Host 内容未变可能造成短暂不一致)
- 实际:metadata 派生自 doc,**先发 metadata 后发 doc** 是反序;**先发 doc 后发 metadata** 比较自然。Main 用 await 串行即可

### 3.4 角度 C 单走 + 完全屏蔽(#5)

```
Host 改 ref-based + 删 doc prop
NoteView useEffect 只跟 [activeNoteId],不跟 [activeNote.doc]
同 noteId 下任何 doc 变化都被忽略
```

**优点**:实施最简(checklist v1 即此方案,~60 行净改)
**缺点**:1a 场景下用户在 NoteView 打开 thought,ebook 加 highlight 后 NoteView 不刷新 — 用户必须手动切笔记往返才能看到

### 3.5 角度 C + view 层 PM toJSON sig(#6)

```
Host 维护 emittedSignatures: Set<string>(LRU 100)
emit 时:sig = JSON.stringify(view.state.doc.toJSON());emittedSignatures.add(sig)
swapDoc 收到外部 doc 时:先 deserialize → Node.toJSON → JSON.stringify
  if (emittedSignatures.has(sig)) return; // echo,跳过
  else replaceWith; // 真外部更新
```

**优点**:不改 IPC 协议,语义清晰("我自己 emit 过的不再 apply")
**缺点**:
- sig byte-stable **不保证** — PM Node.toJSON 中 attrs 用 `obj.attrs = this.attrs` 直接赋整个对象,key 顺序取决于 PM Schema build 时的 attrs 声明顺序;**两端用同一 schema build,理论一致,但跨 IPC 序列化后是否仍 byte-equal 需测试**
- 性能:每次 broadcast 算一次 sig(700KB doc ~15ms),5 keystrokes/s 下 75ms/s 开销,用户感受不到
- LRU 大小决定能"记得多远":连击 100 字以内 OK,>100 字 echo 会被当外部 swap → 跳末尾再现

**致命弱点**:如果 sig 实际**不 byte-stable**,会把所有 echo 当外部更新,**比当前问题还糟糕**(每次都跳)

### 3.6 角度 C + visibility/focus 切回刷新(#7)

```
Host 改 ref-based + 删 doc prop
NoteView useEffect 只跟 [activeNoteId]
NoteView 加 visibility/focus listener:窗口/view 重新聚焦时 hostRef.swapDoc(activeNote.doc, { reason:'refocus-refresh' })
```

**优点**:实施简单,落地 1a 场景刷新("切回 NoteView 时刷新")
**缺点**:体验略弱 — 用户必须切窗口/失焦才看到外部更新,不是实时

**实际场景代入**:用户在 ebook 加 highlight,**他已经不在看 NoteView**,体感上"切回去时看到"完全可接受。用户体验上 #7 ≈ #5,差别在"切回时是否要手动 reload"

### 3.7 角度 C + 角度 A 双 channel(#8)

#4 + #6 思路结合:main 用双 channel,view 层 Host ref-based。最严谨,改动最大。

---

## 4. 方案对比矩阵

按 4 个维度评分(★ = 满分):

| 维度 | #4 双 channel | #5 屏蔽同 noteId | #6 view sig | #7 切回刷新 | #8 双 channel+C |
|---|---|---|---|---|---|
| 修跳末尾 | ★★★ | ★★★ | ★★(看 sig 稳定) | ★★★ | ★★★ |
| P1#1 满足度 | ★★★ | ☆☆☆ | ★★(看 sig 稳定) | ★★(切回触发) | ★★★ |
| 实施成本 | ★★(+60 行 main/preload) | ★★★(+50 行 view) | ★★(+30 行 Host) | ★★★(+30 行 view) | ★(+100 行) |
| 架构干净度 | ★★★ | ★★(单一性丢) | ★(隐式假设) | ★★(看似 hack) | ★★★ |
| 风险 | 中:channel 时序 | 低 | 高:sig 不稳就崩 | 低 | 中 |

**推荐组合**:

- **快速落地** → #5 + 文档标"P1#1 临时受限,待 #4 或 #8 实施":1 个 PR 修跳末尾,P1#1 留 followup
- **一步到位** → #8:今天投入大,但日后不需要再回头

注:#4 单独走也能满足两个目标,不一定要叠加 C。但 C 提供"架构级防御"——即使未来某天 main 漏排除 sender(回归 bug),Host 也不会自动回灌。叠加做的价值是**未来的可维护性**。

---

## 5. 实施面对比(代码量估算)

### 方案 #5(角度 C 单走 + 屏蔽同 noteId)

详见 [host-ref-based-checklist.md](host-ref-based-checklist.md) v2 角度 C 部分。
- 净改:**~80 行**(types ×2 + Host + 3 个使用者)
- 文件数:**6**
- 风险:已知 P1#1 受限,需 followup

### 方案 #7(角度 C + visibility 刷新)

在 #5 基础上 NoteView 加 ~15 行 visibility listener。
- 净改:**~95 行**
- 文件数:**6**(同 #5)
- 风险:无新增

### 方案 #4(角度 A 双 channel,不含 C)

- main:`channel-names.ts`(+1) / `broadcast.ts`(+30) / `handlers.ts`(+5) / `ebook/capability-impl.ts`(+5)
- preload:`preload.ts`(+15)
- view:`use-notes-folders.ts` 或新 hook `use-active-note-doc.ts`(+30) / `NoteView.tsx`(+10)
- types:`note/types.ts`(+5)
- 净改:**~100 行**
- 文件数:**7-8**
- 风险:channel 时序、ebook capability 内调用 updateNote 时怎么显式不带 sender 需小心

### 方案 #8(角度 A 双 channel + 角度 C)

#4 + #5/#7 的 view 端改动叠加,但 view 端逻辑可简化(Host 已 ref-based,view 订阅 DOC_CONTENT_CHANGED 直接 swapDoc).
- 净改:**~150-180 行**
- 文件数:**10-12**
- 风险:最大但单次解决最多问题

---

## 6. 未尽风险(任一方案都要考虑)

1. **NoteView 之外的 view 不在本文范围**:ThoughtView、AI View 等可能也有类似双向同步问题。本文聚焦 NoteView,其他 view 同款 bug 未排查 — 建议任一方案落地后 **followup 全仓 grep `useEffect.*\[.*\.doc.*\]`** 看还有几个类似模式
2. **selection 保留**:任一方案下 swapDoc 都是 `Selection.atStart`,1a 场景下用户 NoteView 阅读时 ebook 加了一条标注,NoteView 突然刷新 → 光标/scroll 复位到 atStart — **用户体验上可能反而比"跳末尾"更突兀**。备选:
   - swapDoc 内 try preserve selection by position mapping(但跨 doc 内容差异大时 PM 自身就保不准)
   - 或者 1a 场景下用 `incremental patch`(只在 doc 末尾追加新 block 而不整篇 replaceWith)— 需要 ebook 端报告"我加了什么"而不是"全 doc"
3. **首段 title 派生回归**:目前 title 派生在 main `getNote` 时计算。若 NavSide 用 useAllNotes 拿 title,而方案排除了发起者的 broadcast → NavSide title 不会自动刷新发起者自己改的 title — 多数方案下需要单独处理

---

## 7. 我的(claude)推荐

**优先级 1(若今天/本周内要彻底解决)**:**#4(双 channel)**
- 不引入 view 层 sig 推算的不确定性
- IPC 协议改动适中,语义最清晰
- 可以**先不做角度 C**(保留现有 useEffect[doc] 自动同步,只换喂的数据源)→ 改动面比 #8 小

**优先级 2(若今天就要修跳末尾,P1#1 接受临时受限)**:**#7(C + 切回刷新)**
- 落地最快
- 切回刷新对 1a 场景体验"接近实时"
- 后续仍可升 #8

**不推荐**:
- **#6(view sig)** — sig byte-stable 不保证,实测才能验证,失败回滚成本高
- **#5(屏蔽同 noteId)** — 用户已审计反对,P1#1 完全不工作
- **#8 一步到位** — 今天投入产出比不高,可在 #7 跑稳后单独升级

---

## 8. 用户决策点

请明确:

1. **目标时间**:今天就修跳末尾,还是这周内做对?
2. **P1#1 容忍度**:能不能接受"切回 NoteView 时才刷新外部更新"(#7)?还是要"实时刷新"(#4/#8)?
3. **IPC 协议改动接受度**:能不能动 channel(新增 channel)?

我会按你的答案出最终单选方案的实施清单。

---

*v1 撰写于 2026-05-20。本文不下结论,留待用户选择*
