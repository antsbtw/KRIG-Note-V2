# Block 独立化 sub-phase 实施偏离日志

> **触发日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **决议依据**:[decision 026](../data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) + [实施计划](../stages/block-atomization-implementation-plan.md)
> **本日志性质**:实施期间发现的事实纠错 / 临时妥协 / 新 Open Question 登记(沿 decision 022 §0.2 模式)
> **同步条件**:每发现一项偏离 → 立即 commit;Stage 9 完成时由本日志汇总入完成报告 + 反向更新决议

---

## 偏离类型定义

| 类型 | 性质 | 处理 |
|---|---|---|
| **事实纠错** | 决议跟代码现状不符(如行号、路径、计数) | 登记,**不动决议**(决议作为时间点拍板,事实是后续 commit 推移导致);实施按代码现状走 |
| **临时妥协** | 实施层选择跟决议略不同,有合理理由 | 登记理由 + 影响范围;Stage 9 汇总,必要时反向更新决议 |
| **新发现 Open Question** | 决议未覆盖的语义级议题 | AskUserQuestion 拍板 + 登记;并入决议 §13 |

---

## D-01 — IPC handler 路径偏(事实纠错)

**决议**(decision 026 §10.1 / 实施计划 Stage 4 / Step 2.5 实施提示词 §2.5 grep 命令):

```bash
grep -rn "noteUpdate\|noteGet\|noteList" src/platform/preload/ src/shared/ipc/
```

**实际事实**(2026-05-21 grep):

- `src/platform/preload/` 不存在
- 实际位于 `src/platform/main/preload/main-window-preload.ts`(line 366-381 含 5 个 note IPC handler)

**影响**:Stage 4 实施时 grep 命令要改用正确路径,否则 0 命中(误以为无影响面)。

**处理**:实施期间用 `src/platform/main/preload/` 路径,**不修决议**(decision 026 是时间点拍板,路径细节不变更决议定位)。Stage 9 汇总入完成报告登记。

---

## D-02 — Thought NoteLocator 使用点偏少(事实纠错)

**决议**(decision 026 §10.1 / 实施计划 Stage 4):

> "约 10 处 NoteLocator 使用点(2026-05-21 grep,实施时复 grep 校准)"

**实际事实**(2026-05-21 grep `grep -rn "NoteLocator\|pmPos" src/`):

实际 **8 处实际使用点**(不含 `src/drivers/text-editing-driver/api.ts:1193` 的注释引用):

1. `src/capabilities/thought/types.ts:13` — 重导出
2. `src/capabilities/thought/types.ts:24` — 重导出
3. `src/capabilities/thought/index.ts:30` — 导出
4. `src/shared/ipc/thought-types.ts:57` — 类型定义本身
5. `src/views/thought/ThoughtPanel.tsx:23-24` — 读 pmPos
6. `src/views/thought/command-impl/scroll-to-source.ts` — 多处(import + 函数签名 + textEditing.api.scrollToThoughtAnchor 调用)
7. `src/views/thought/command-impl/add-from-note.ts` — 多处(import + 3 处 pmPos 返回)
8. `src/views/thought/command-impl/ask-ai.ts` — 2 处(pmPos 注释 + 调用)

**影响**:Stage 4 工作量略减,实际改动文件 8 处 < 决议预估 10 处。

**处理**:实施期间按实际 8 处推进。决议"约 10 处"措辞合理(用了"约"字 + 预留"实施时复 grep 校准"),**不修决议**。

---

## D-03 — scrollToBlockAnchor / URL 路由行号小偏(事实纠错)

**决议**(decision 026 §10.1):

> `[build-link-click-plugin.ts:73] scrollToBlockAnchor`
> `[build-link-click-plugin.ts:162] krig://block/{id}/{anchor} 路由`

**实际事实**(2026-05-21 grep):

- `scrollToBlockAnchor` 实际位于 [build-link-click-plugin.ts:70](../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L70)(决议 73 → 实际 70,小偏 3 行)
- `href.startsWith('krig://block/')` 实际位于 [build-link-click-plugin.ts:128-129](../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L128)(决议 162 → 实际 128,偏移 34 行)

**影响**:Stage 5 实施时按代码现状定位即可,无功能差异。

**处理**:实施期间用代码现状行号。**不修决议**(行号是 commit 后会自然漂的字段,决议拍板时点正确)。

---

## D-04 — BlockSpec / NodeSpec 数量精确细分(事实纠错 + 补充)

**决议**(decision 026 §3.1 / §10.1):

> "28 个 blocks 目录;按 decision 026 §3.1 拆分清单执行"
> "§3.1.1 加 id(叶子 + 叶子级容器):23 项"
> "§3.1.2 不加 id(结构性容器):6 项"
> "(共 28 blocks 评估,约 22 加 / 6 不加)"

**实际事实**(2026-05-21 `ls + grep BlockSpec`):

- `src/drivers/text-editing-driver/blocks/` 目录:**27 个 block 目录 + 1 个 `_shared` 工具目录 = 28 entries**
  - `_shared` 不是 block,是工具子目录(本 sub-phase 不动)
- 实际 PM `BlockSpec` 总数:**32 个 NodeSpec**(因 table / task-list / column-list 各自 spec.ts 内定义多个 NodeSpec):
  - `table/spec.ts` 定义 4 个:tableSpec / tableRowSpec / tableCellSpec / tableHeaderSpec
  - `task-list/spec.ts` 定义 2 个:taskListSpec / taskItemSpec
  - `column-list/spec.ts` 定义 2 个:columnListSpec / columnSpec
  - 其余 24 目录各 1 个 = 24
  - 合计 4 + 2 + 2 + 24 = **32 个 NodeSpec**

**对照 §3.1.1 / §3.1.2 清单**:

§3.1.1 **加 id**(24 项):paragraph / heading / horizontalRule / hardBreak / codeBlock / mathBlock / mathVisual / image / fileBlock / fileLink / audioBlock / videoBlock / htmlBlock / tweetBlock / externalRef / listItem / taskItem / tableCell / tableHeader / callout / blockquote / column / toggleList / unknown

§3.1.2 **不加 id**(6 项):table / tableRow / bulletList / orderedList / taskList / columnList

§3.1.3 **inline 不拆**(2 项):mathInline / noteLink

**总计**:24 + 6 + 2 = **32 个 NodeSpec,完整覆盖,未漏**。

**影响**:Stage 1 实际改动 spec.ts 文件数 = **24 个目录的 spec.ts**(其中 table/task-list/column-list 三个目录各自修改 2-4 个 NodeSpec 的 attrs);decision 026 "约 22 加"略低估(实际 24)。

**处理**:Stage 1 实施按 24 NodeSpec 加 id;Stage 9 反向更新决议 §3.1 / §10.1 的"28 个 blocks 目录"/"约 22 加"为精确数字。

---

## D-05 — Main 起点 lint 状态(事实纠错,跟本 sub-phase 无关)

**决议**(实施提示词 §3.1):

> "typecheck + lint 全绿"

**实际事实**(2026-05-21 main HEAD = 947c9961):

- `npm run typecheck` ✅ 全绿
- `npm run lint` ❌ 3 个 warning(`--max-warnings 0` 视为失败):
  1. `src/drivers/text-editing-driver/plugins/build-block-indent-keymap.ts:20-21` — 未用 `Transaction` / `EditorView` type import
  2. `src/views/thought/ThoughtCard.tsx:48` — 未用 `extractTitle` 函数

**影响**:这 3 个 warning 是 main 上预先存在的历史遗留,跟 block atomization 完全无关。**本 sub-phase 不修这些 warning**(沿提示词 §7 红线"不要写 src/ 之外的'顺手优化'代码")。

**处理**:用户拍板"从带 warning 的 main 起步"(2026-05-21 AskUserQuestion)。本 sub-phase commit 后跑 lint 时仍会有这 3 个 warning,若 lint 输出**严格只有这 3 个**则视为通过,**新增的 warning** 必须修。

---

---

## D-06 — hardBreak 实际是 inline 不应加 id(决议自相矛盾,用户拍板)

**决议冲突**:

- decision 026 §3.1.1 把 **hardBreak** 列在"叶子文本"加 id 清单
- decision 026 §3.1.3 "inline 节点不拆(group='inline')"

**实际代码**([hard-break/spec.ts:14-15](../../src/drivers/text-editing-driver/blocks/hard-break/spec.ts#L14)):

```ts
const hardBreakNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  ...
}
```

**用户拍板**(2026-05-21 AskUserQuestion):**不加 id,归 inline**

**理由**(用户原话):"hardBreak 是 `<br>` 行内换行,用户不会单独引用 / 标注;§3.1.1 列 hardBreak 是历史遗状"

**处理**:
- Stage 1 Step 1.2 **不改** hard-break/spec.ts(保持 inline 现状)
- Stage 9 反向更新 decision 026 §3.1.1 从加 id 清单删 hardBreak,纳入 §3.1.3 inline 清单

---

## D-07 — fileLink 实际是 inline atom 不应加 id(决议两处冲突)

**决议冲突**(同一 decision 026 内自相矛盾):

- §3.1.1 把 **fileLink** 列在"叶子媒体"加 id 清单
- §3.1.3 同时把 **fileLink(inline 形态)** 列在 inline 不拆清单

**实际代码**([file-link/spec.ts:19-22](../../src/drivers/text-editing-driver/blocks/file-link/spec.ts#L19)):

```ts
const fileLinkNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  ...
}
```

**处理**(沿 D-06 同模式,**不再单独 AskUserQuestion** — 用户对 hardBreak 拍板的逻辑直接适用):
- Stage 1 Step 1.2 **不改** file-link/spec.ts(保持 inline 现状)
- Stage 9 反向更新 decision 026 §3.1.1 从加 id 清单删 fileLink,**保留** §3.1.3

**注**:fileBlock(group='block', atom: true)与 fileLink(group='inline', atom: true)是两个不同 NodeSpec,**fileBlock 仍按 §3.1.1 加 id**。

---

## D-08 — tableHeader 无 bookAnchor 字段(事实纠错)

**决议**(decision 022 + decision 026 §10.1):

> "24 种 PM block attrs 全加 optional bookAnchor 字段"
> "table 目录 4 NodeSpec 仅 tableCell receiver bookAnchor"

**实际代码**(table/spec.ts):

- `tableCellNodeSpec.attrs.bookAnchor` ✓ 存在(L134)
- `tableHeaderNodeSpec.attrs` **无 bookAnchor**(L163-168 仅 colspan/rowspan/colwidth/align)

**影响**:本 sub-phase 加 attrs.id 到 tableHeader,但 tableHeader 还没 bookAnchor(decision 022 同模式)。实施时只需加 id 字段,**不补 bookAnchor**(超本 sub-phase 范围,沿提示词 §7 红线)。

**处理**:Stage 1 Step 1.2 给 tableHeader 加 `id: { default: null }`,bookAnchor 不动(留 future decision 022 续修 sub-phase)。

---

## D-09 — 粘贴语义未实施(临时妥协,Stage 7 验收)

**决议**(decision 026 §5.2):

> "Cmd+X / Cmd+C / Cmd+V 一律生成新 ULID,丢弃原 id"
> "粘贴 transaction 的 appendTransaction 拦截时,所有有 id 的 node 都重新生成 ULID"

**实际实施**(`build-auto-block-id-plugin.ts` header 注释 + 行为):

> "本 plugin 不区分粘贴场景,永远只为无 id 的 node 注入 ULID"
> "粘贴的 node 保留来源 id(违反 §5.2 拍板"粘贴全部生成新 id")"

**原因**:Stage 1 仅做 schema + 默认注入,paste 钩子需识别 transaction 是否为"paste 操作"(用 `tr.getMeta('paste')` 或 input rule 等 PM 机制),增加 Stage 1 复杂度。简化拍板:Stage 1 不处理粘贴语义,留后续 commit 加 paste hook。

**影响**:
- 用户复制 block A → 粘贴 → 新 block 字面值 = 旧 A.id(违反"新 id"语义)
- 实际后果:同 doc 内两个 block 拿同 id 会让 capability.dissectPmDoc(Stage 2)抛"duplicate id"错;或 storage.putAtom(id 冲突)抛错
- Stage 1 范围仅 schema + 注入插件,Stage 2 capability diff 算法会暴露此问题
- Stage 7 测试场景 T5(Copy/Paste)verify 此偏差;若 Stage 2 实施时优先级提升,可加 paste hook

**处理**:
- 本偏差**登记**,Stage 1 不修
- Stage 2 实施时若 capability 层 dissectPmDoc 抛 duplicate id 错 → 优先加 paste hook(在 build-auto-block-id-plugin.ts 增加 paste 拦截逻辑)
- 或留 Stage 7 测试 T5 verify + 后续独立 commit 修

**登记位置**:`src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts` 顶部 JSDoc 注释登记。

---

---

## D-10 — reading-thought pm atom 不带 hasNoteView 但走 updateNote(事实纠错)

**决议**(decision 026 §6.3 / §8.1):

> "block 拆 atom 后:note 仍然是带 `hasNoteView` 边的 pm atom"
> "读 note 内容 = listAtoms(belongsToNote.object = noteId) + 拓扑排序 + 嵌套展开"

隐含假设:updateNote / getNote 的 input id 一定是带 hasNoteView 边的 note container。

**实际事实**(2026-05-21 grep `src/platform/main/ebook/capability-impl.ts`):

- ebook capability addReadingThoughtBlock / removeReadingThoughtBlock(L697 / L739) 直接 import 同进程 `updateNote` 函数,传入的是 reading-thought atom 的 id(pm domain,**但不带 hasNoteView 边**,而是带 `hasReadingThought` 边)
- getReadingThought(L552-573)绕开 `note.getNote` 的 hasNoteView 防御 filter,直接 `storage.getAtom + wrapPmDoc` 自己构造 NoteInfo

**影响**:

Stage 2 重写 updateNote 必须**支持两种 container atom**:
1. 有 hasNoteView 边的 note container(常规笔记)
2. 没有 hasNoteView 边的 pm atom container(reading-thought)

容器识别**不能**靠 hasNoteView 边过滤(否则 reading-thought 走不通)。

**处理(Stage 2 实施)**:

- assemble / dissect / diff 算法**对 container 身份不敏感**:输入一个 atom id + 一份 newDoc/oldDoc,输出 atom set + edge set
- updateNote 内部不查 hasNoteView 边(getNote 的 hasNoteView 防御 filter 保留,但 updateNote 不查 — 因 reading-thought 也要工作)
- getNote 保留 hasNoteView marker 防御(decision 016 §3.4),但**容器 atom 自身**可以**没有** hasNoteView 边(reading-thought 走自己的 getReadingThought 不走 getNote)
- pm-doc-cache 缓存所有 container atom(以 atom id 为 key,不区分 note/reading-thought)

**登记**:决议 026 §6.3 假设需在 Stage 9 反向更新,增补 "pm container atom 不限于 hasNoteView marker;hasReadingThought 也是 container marker"。

---

## D-11 — 用户拍板:Stage 2 不引入旧数据兼容路径(临时妥协 → 转决议)

**决议**(decision 026 §0.2 / §8.1):

> "PM ↔ atom 转换时机:读时拼装/写时拆解 + capability 层 in-memory PM-doc 缓存"
> "迁移策略:一次性 migration script"

决议拍板"读时拼装 / 写时拆解"是唯一路径,Stage 6 一次性 migration 之前的旧数据(整篇 doc 1 atom 形态)**不在 Stage 2 兼容**。

**实施期 AskUserQuestion**(2026-05-21):

Stage 2 改完后,既有 V2 storage 数据(整篇 doc 1 atom)在 Stage 6 migration 跑前打开会读空。问用户处理方式,**用户拍板**:**"完全可以清空本地旧数据"**

**影响**:

- Stage 2 实施按决议走,**不写**任何"识别旧模式 → 走整篇路径"的 fallback 分支
- 用户开发期接受清空本地 V2 数据快照
- Stage 6 migration 仍按决议落地,**未来生产数据**仍走一次性 migration(本期清数据仅针对开发期 V2)

**登记位置**:Stage 2 assemble-pm-doc.ts 注释登记"假设 storage 已是拆 atom 形态(decision 026 §3);旧整篇 1 atom 数据不兼容(Stage 6 migration 前清数据,本拍板 D-11)"。

---

---

## D-12 — Stage 5 旧 URL 错误提示仅 console.warn(临时妥协)

**决议**(decision 026 §7.3 + 实施计划 §6.3 EM5):

> "点击旧 URL → 弹 UI 提示'链接已失效,请重新复制'"
> "EM5 ✅ 点击旧 URL → Toast '链接已失效'"

**实际事实**(2026-05-21 grep V2):

V2 **没有**现成的 toast capability — grep `toast / Toast` 无命中(仅 emoji 图标列表)。
要实施 toast UI 需新建 capability:Notification / Toast 组件 + 跨 view 调用入口。

**处理(妥协)**:

- driver `console.warn` 已暴露(用户开 DevTools 能看见错误)
- LinkClickHandler **已加** `onLegacyBlockAnchor?` 回调接口(预留 hook)
- view 端 `link-click-integration.ts` **不注册** `onLegacyBlockAnchor`(无 toast 可调)
- **留 future commit / sub-phase** 引入 toast capability 后 wire 此 callback

**影响**:
- 用户点旧 URL 静默(driver console.warn 走;无视觉反馈)
- Stage 7 verify 时用 DevTools 看 console 输出确认旧格式被识别
- 登记 Stage 9 反向更新 EM5 第 3 条 "toast"→"console.warn"

---

---

## D-13 — Stage 6 跳过(用户拍板,开发期数据已是新形态)

**决议**(decision 026 §11.2 / 实施计划 §7):
> "Stage 6:一次性 migration script + 备份 round-trip 测试"
> "硬门槛:备份数据跑 migration 成功 + 文本等价"

**实际事实**(2026-05-21 用户拍板):

- D-11 用户已拍板"清空本地旧数据"
- 开发期 V2 SurrealDB 已清,所有数据是 Stage 2 之后新创建的 block atom 形态
- **无 migration 消费者**(旧整篇 1 atom 形态数据 0 条)

**拍板**(2026-05-21 Stage 5 完成后 AskUserQuestion):

> "跳过 (开发期已清数据, EM6 marked 'N/A')"

**影响**:

- ✅ Stage 7 / 8 / 9 直接推进,Stage 6 **不实施 code**
- ⚠ future 生产部署**必须**先实施 migration script 才能跑当前 L7 代码
  - 留 future commit / sub-phase 兑现
  - README / Release Note 需明示"生产部署需 migration"
- EM6 报告 marked 'N/A',[block-atomization-em6-verify-2026-05-21.md](./block-atomization-em6-verify-2026-05-21.md) 登记

**留 Stage 9 反向更新**:
- decision 026 §11.2 拆"Stage 6"为"开发期 N/A + 生产 future sub-phase"
- 实施计划 §7 同步

---

---

## D-14 — Stage 7 跳过(用户拍板,8 场景留运行中发现)

**决议**(decision 026 §11.2 / 实施计划 §8):
> "Stage 7:典型场景测试(8 场景 T1-T8)"
> "硬门槛:8 场景全通过 + 测试报告记录"

**实际事实**(2026-05-21 用户拍板):

Stage 5/6 完成后 AskUserQuestion:

> "跳过 Stage 7 手动测,直推进 Stage 8/9 + 合 main"

用户有意识接受"静态检查已足"赌注。

**影响**:

- 11 场景**无 manual verify**(8 决议 + 3 L7 新加 T9/T10/T11)
- **高风险未验项**(沿 EM7 verify 报告 ⚠ 标记):
  - **T7** callout + 内部 paragraph(嵌套 childOf 边 + 跨层 wrapper 重建无实测)
  - **T8** thought 锚点跨编辑稳定(blockId **根治性**无实测)
  - **T10** ebook reading-thought 走 updateNote(D-10 路径**最高风险**)
- bug 留运行中发现 + future commit 修

**建议**(合 main 后):
- 优先验上述 3 高风险项
- 任一失败 → revert merge / hotfix

**登记**:[block-atomization-em7-verify-2026-05-21.md](./block-atomization-em7-verify-2026-05-21.md)

---

## D-15 — Stage 8 跳过 + listNotes 性能退化已知

**决议**(decision 026 §9 / 实施计划 §9):
> "Stage 8:性能压测(5 指标 P95)"
> "不达标留独立 sub-phase"

**实际事实**(2026-05-21 用户拍板):

D-14 拍板 implicitly 也跳过 Stage 8(性能压测需用户提供 1000 block 测试数据;D-11 加成开发期数据已清)。

**已知性能退化**(无 benchmark 但静态分析命中):

`listNotes` 退化 — Stage 2 改为**每 note 调 assemblePmDoc**(各自 3 query):

```ts
// src/platform/main/note/capability-impl.ts:248-269
const results = await Promise.all(
  noteAtoms.map(async (atom) => {
    const cached = pmDocCache.get(atom.id);
    const assembled = cached ?? (await assemblePmDoc(atom.id));
    ...
  }),
);
```

100 notes × 3 query each = **300 query / listNotes 调用**(Promise.all 并发 cover 部分)。
cold start(cache 空)可能卡顿;warm cache 命中后 cover。

**已知 stableStringify O(N²)**(diff-block-tree.ts:60-77):
1000 block updateNote(single char edit)diff 算法要把 oldDoc / newDoc 全 dissect + stableStringify 比对 → O(N²) 可能慢。

**缓解 / future 优化**:
1. listNotes 只返**轻量 NoteInfo**(title 持久化在 container atom 新字段;doc 不拼)
2. diff 算法用 hash 缓存(不每次 stableStringify)
3. listAtoms 批量查询接口(decision 026 §9.3 已登记 future sub-phase)

**影响**:
- 留 future commit / 性能优化 sub-phase 兑现
- 合 main 后观察实际用户场景(笔记数 < 20 无明显感知)

**登记**:[block-atomization-em8-verify-2026-05-21.md](./block-atomization-em8-verify-2026-05-21.md)

---

## 汇总(2026-05-21,Stage 1 EM1 通过后修订)

**拆账**(grep `id: { default: null }` 实测):

- decision 026 §3.1.1 拍板 24 项加 id
- D-06 hardBreak 排除(inline) → 23
- D-07 fileLink 排除(inline atom) → 22
- D-04 + ee568236 commit 实际拆分:13 加 id + 6 atomId rename + 2 table NodeSpec(tableCell / tableHeader)
- 13 + 6 + 2 = **21**(grep 实测:21 NodeSpec 含 `id: { default: null }`)
- commit message "22 NodeSpec"是双数计(tableCell/tableHeader 在【加 id 13 项】和【table/spec.ts 2 NodeSpec】各算一次),**实测 21**

**实测 NodeSpec 加 id 共 21 个**(2026-05-21 EM1 verify 后 grep 校准,审计偏差 1 个,不影响功能)。

- 3 个 Step 1.2 前已完成(paragraph / heading / horizontalRule)
- 12 个 Step 1.2 新加(codeBlock / mathBlock / fileBlock / externalRef / listItem / taskItem / tableCell / tableHeader / callout / blockquote / column / toggleList / unknown 共 13 减重复 = 实测)
- 6 个 Step 1.3 rename atomId → id(image / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual)

**审计偏差**:commit message "22"与 grep 实测"21"差 1,根因 tableCell/tableHeader 在子列表双数。**事实层无影响**(NodeSpec 实际改动是正确的 21 + 6 rename,只是 commit message 描述错算了一次)。未来类似 commit 声明数字前 grep 校准(沿 [[decision-grep-verify-complete-propagation]])。

---

*实施期间发现新偏离继续追加,Stage 9 汇总到完成报告。*
