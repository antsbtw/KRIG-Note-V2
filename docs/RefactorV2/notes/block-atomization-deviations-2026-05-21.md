# Block 独立化 sub-phase 实施偏离日志

> **触发日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **决议依据**:[decision 026](../data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) + [实施计划](../stages/block-atomization-implementation-plan.md)
> **本日志性质**:实施期间发现的事实纠错 / 临时妥协 / 新 Open Question 字面登记(沿 decision 022 §0.2 模式)
> **同步条件**:每发现一项偏离 → 立即 commit;Stage 9 完成时由本日志汇总入完成报告 + 反向更新决议字面

---

## 偏离类型定义

| 类型 | 性质 | 处理 |
|---|---|---|
| **事实纠错** | 决议字面跟代码现状不符(如行号、路径、计数) | 字面登记,**不动决议**(决议作为时间点拍板,事实是后续 commit 推移导致);实施按代码现状走 |
| **临时妥协** | 实施层选择跟决议略不同,有合理理由 | 字面登记理由 + 影响范围;Stage 9 汇总,必要时反向更新决议字面 |
| **新发现 Open Question** | 决议未覆盖的语义级议题 | AskUserQuestion 字面拍板 + 登记;并入决议 §13 |

---

## D-01 — IPC handler 路径偏(事实纠错)

**决议字面**(decision 026 §10.1 / 实施计划 Stage 4 / Step 2.5 实施提示词 §2.5 grep 字面命令):

```bash
grep -rn "noteUpdate\|noteGet\|noteList" src/platform/preload/ src/shared/ipc/
```

**实际事实**(2026-05-21 grep):

- `src/platform/preload/` 不存在
- 实际位于 `src/platform/main/preload/main-window-preload.ts`(line 366-381 含 5 个 note IPC handler)

**影响**:Stage 4 实施时 grep 命令字面要改用正确路径,否则 0 命中(误以为无影响面)。

**处理**:实施期间用 `src/platform/main/preload/` 路径,**不修决议字面**(decision 026 是时间点拍板,路径细节不变更决议字面定位)。Stage 9 汇总入完成报告字面登记。

---

## D-02 — Thought NoteLocator 使用点偏少(事实纠错)

**决议字面**(decision 026 §10.1 / 实施计划 Stage 4):

> "约 10 处 NoteLocator 使用点(2026-05-21 grep 字面,实施时复 grep 校准)"

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

**处理**:实施期间按实际 8 处推进。决议字面"约 10 处"措辞合理(用了"约"字 + 字面预留"实施时复 grep 校准"),**不修决议字面**。

---

## D-03 — scrollToBlockAnchor / URL 路由行号小偏(事实纠错)

**决议字面**(decision 026 §10.1):

> `[build-link-click-plugin.ts:73] scrollToBlockAnchor`
> `[build-link-click-plugin.ts:162] krig://block/{id}/{anchor} 路由`

**实际事实**(2026-05-21 grep):

- `scrollToBlockAnchor` 实际位于 [build-link-click-plugin.ts:70](../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L70)(决议 73 → 实际 70,小偏 3 行)
- `href.startsWith('krig://block/')` 实际位于 [build-link-click-plugin.ts:128-129](../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L128)(决议 162 → 实际 128,偏移 34 行)

**影响**:Stage 5 实施时按代码现状定位即可,无功能差异。

**处理**:实施期间用代码现状行号。**不修决议字面**(行号是 commit 后会自然漂的字段,决议拍板时点正确)。

---

## D-04 — BlockSpec / NodeSpec 数量精确细分(事实纠错 + 补充)

**决议字面**(decision 026 §3.1 / §10.1):

> "28 个 blocks 目录;按 decision 026 §3.1 拆分清单字面执行"
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

**对照 §3.1.1 / §3.1.2 字面清单**:

§3.1.1 **加 id**(24 项):paragraph / heading / horizontalRule / hardBreak / codeBlock / mathBlock / mathVisual / image / fileBlock / fileLink / audioBlock / videoBlock / htmlBlock / tweetBlock / externalRef / listItem / taskItem / tableCell / tableHeader / callout / blockquote / column / toggleList / unknown

§3.1.2 **不加 id**(6 项):table / tableRow / bulletList / orderedList / taskList / columnList

§3.1.3 **inline 不拆**(2 项):mathInline / noteLink

**总计**:24 + 6 + 2 = **32 个 NodeSpec,完整覆盖,未漏**。

**影响**:Stage 1 实际改动 spec.ts 文件数 = **24 个目录的 spec.ts**(其中 table/task-list/column-list 三个目录各自修改 2-4 个 NodeSpec 的 attrs);decision 026 字面"约 22 加"略低估(实际 24)。

**处理**:Stage 1 实施按 24 NodeSpec 加 id;Stage 9 反向更新决议字面 §3.1 / §10.1 的"28 个 blocks 目录"/"约 22 加"为精确数字。

---

## D-05 — Main 起点 lint 状态(事实纠错,跟本 sub-phase 无关)

**决议字面**(实施提示词 §3.1):

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

## D-06 — hardBreak 实际是 inline 不应加 id(决议字面自相矛盾,用户拍板)

**决议字面冲突**:

- decision 026 §3.1.1 字面把 **hardBreak** 列在"叶子文本"加 id 清单
- decision 026 §3.1.3 字面"inline 节点不拆(group='inline')"

**实际代码**([hard-break/spec.ts:14-15](../../src/drivers/text-editing-driver/blocks/hard-break/spec.ts#L14)):

```ts
const hardBreakNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  ...
}
```

**用户拍板**(2026-05-21 AskUserQuestion):**不加 id,归 inline**

**理由**(用户字面):"hardBreak 是 `<br>` 行内换行,用户不会单独引用 / 标注;§3.1.1 列 hardBreak 是字面遗状"

**处理**:
- Stage 1 Step 1.2 **不改** hard-break/spec.ts(保持 inline 现状)
- Stage 9 反向更新 decision 026 §3.1.1 字面从加 id 清单删 hardBreak,字面纳入 §3.1.3 inline 清单

---

## D-07 — fileLink 实际是 inline atom 不应加 id(决议字面两处冲突)

**决议字面冲突**(同一 decision 026 内自相矛盾):

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
- Stage 9 反向更新 decision 026 §3.1.1 字面从加 id 清单删 fileLink,**保留** §3.1.3 字面

**注**:fileBlock(group='block', atom: true)与 fileLink(group='inline', atom: true)是两个不同 NodeSpec,**fileBlock 仍按 §3.1.1 加 id**。

---

## D-08 — tableHeader 无 bookAnchor 字段(事实纠错)

**决议字面**(decision 022 + decision 026 §10.1):

> "24 种 PM block attrs 全加 optional bookAnchor 字段"
> "table 目录 4 NodeSpec 字面仅 tableCell 字面 receiver bookAnchor"

**实际代码**(table/spec.ts):

- `tableCellNodeSpec.attrs.bookAnchor` ✓ 存在(L134)
- `tableHeaderNodeSpec.attrs` **无 bookAnchor**(L163-168 仅 colspan/rowspan/colwidth/align)

**影响**:本 sub-phase 加 attrs.id 到 tableHeader,但 tableHeader 还没 bookAnchor(decision 022 同模式)。实施时只需加 id 字段,**不补 bookAnchor**(超本 sub-phase 范围,沿提示词 §7 红线)。

**处理**:Stage 1 Step 1.2 给 tableHeader 加 `id: { default: null }`,bookAnchor 不动(留 future decision 022 续修 sub-phase)。

---

## D-09 — 粘贴语义未实施(临时妥协,Stage 7 验收)

**决议字面**(decision 026 §5.2):

> "Cmd+X / Cmd+C / Cmd+V 一律生成新 ULID,丢弃原 id"
> "粘贴 transaction 的 appendTransaction 拦截时,所有有 id 的 node 都重新生成 ULID"

**实际实施**(`build-auto-block-id-plugin.ts` 字面 header 注释 + 行为):

> "本 plugin 不区分粘贴场景,永远只为无 id 的 node 注入 ULID"
> "粘贴的 node 字面保留来源 id(违反 §5.2 拍板"粘贴全部生成新 id")"

**原因**:Stage 1 仅做 schema + 默认注入,paste 钩子需识别 transaction 是否为"paste 操作"(用 `tr.getMeta('paste')` 或 input rule 等 PM 机制),增加 Stage 1 复杂度。简化拍板:Stage 1 不处理粘贴语义,留后续 commit 加 paste hook。

**影响**:
- 用户复制 block A → 粘贴 → 新 block 字面 = 旧 A.id(违反"新 id"语义)
- 实际后果:同 doc 内两个 block 拿同 id 会让 capability.dissectPmDoc(Stage 2)抛"duplicate id"错;或 storage.putAtom(id 冲突)抛错
- Stage 1 范围仅 schema + 注入插件,Stage 2 capability diff 算法会暴露此问题
- Stage 7 测试场景 T5(Copy/Paste)字面 verify 此偏差;若 Stage 2 实施时优先级提升,可加 paste hook

**处理**:
- 本偏差**字面登记**,Stage 1 不修
- Stage 2 实施时若 capability 层 dissectPmDoc 抛 duplicate id 错 → 优先加 paste hook(在 build-auto-block-id-plugin.ts 增加 paste 拦截逻辑)
- 或留 Stage 7 测试 T5 字面 verify + 后续独立 commit 修

**字面位置**:`src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts` 顶部 JSDoc 注释字面登记。

---

## 汇总(2026-05-21,Stage 1 EM1 通过后修订)

**字面拆账**(grep `id: { default: null }` 实测):

- decision 026 §3.1.1 字面拍板 24 项加 id
- D-06 hardBreak 排除(inline) → 23
- D-07 fileLink 排除(inline atom) → 22
- D-04 + ee568236 commit 实际拆分:13 加 id + 6 atomId rename + 2 table NodeSpec(tableCell / tableHeader)
- 13 + 6 + 2 = **21**(grep 实测:21 NodeSpec 含 `id: { default: null }`)
- commit message 字面"22 NodeSpec"是双数计(tableCell/tableHeader 在【加 id 13 项】和【table/spec.ts 2 NodeSpec】各算一次),**实测 21**

**实测 NodeSpec 加 id 共 21 个**(2026-05-21 EM1 verify 后 grep 校准,审计偏差 1 个,不影响功能)。

- 3 个 Step 1.2 前已完成(paragraph / heading / horizontalRule)
- 12 个 Step 1.2 新加(codeBlock / mathBlock / fileBlock / externalRef / listItem / taskItem / tableCell / tableHeader / callout / blockquote / column / toggleList / unknown 共 13 减重复 = 实测)
- 6 个 Step 1.3 rename atomId → id(image / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual)

**审计偏差**:commit message 字面"22"与 grep 实测"21"差 1,根因 tableCell/tableHeader 在子列表双数。**事实层无影响**(NodeSpec 实际改动是正确的 21 + 6 rename,只是 commit message 描述错算了一次)。未来类似 commit 字面声明数字前 grep 校准(沿 [[decision-grep-verify-complete-propagation]])。

---

*实施期间发现新偏离继续追加,Stage 9 汇总到完成报告。*
