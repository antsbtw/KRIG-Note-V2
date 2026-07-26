# 阶段 B4b — 废掉 ExtractedBlock 中间态（收敛终点）

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**必须最后做：依赖 B2+B3+B4a 全部合并（所有 block 都进核后才能安全废）。风险低——纯内部重构，消费方仅 3 处（已调研确认）。**

## 背景（必读）

- `docs/00-architecture/import-to-note-convergence.md`

这是「两套解析器」收敛的**最后一步**。经 B1–B4a，所有 block 都已进 markdownCore。此时 ① 的 `ExtractedBlock` 中间态（`ResultParser.parse → ExtractedBlock[] → extractedBlocksToPmDoc → PMNode[]`）已无独有逻辑，可废——让 ① 直接产 PMNode[]（调核），砍掉中间态。

**调研已确认（可安全废）**：ExtractedBlock 是纯栈内一次性中间值——无 IPC、无落库、无缓存、无外部 capability 依赖。消费方仅 **3 处** + 1 处 re-export：
1. `src/shared/ai-markdown-parser/index.ts:27-36` — `aiMarkdownToNoteDoc`：`parse()→extractedBlocksToPmDoc()`
2. `src/views/note/ai-sync-blocks.ts:36-90` — `buildAITurnPmNodes`：`parse()→extractedBlocksToPmDoc()`
3. `tests/ai-markdown-fenced-code.test.ts:20-21` — 测试断言消费 parse 结果
4. `src/shared/ai-markdown-parser/index.ts:14-18` — re-export ExtractedBlock 类型（**删**）

`wrapAITurnsInToggle` **不依赖 ExtractedBlock**（已吃 PMNode），废中间态不波及它——这是安全边界（AI 整页/单条提取的重组逻辑不受影响）。

## 目标

让 ① 的 `ResultParser.parse` **直接产 PMNode[]**（内部调 markdownCore，不再产 ExtractedBlock），删掉 `blocks-to-pm-doc.ts` + `extraction-types.ts`（若确认无残留消费），迁 3 处消费方。

**方向红线**：① 直接产 PMNode[] 要走 **markdownCore（唯一真源）**，**不是**把 blocks-to-pm-doc 的逻辑塞回 result-parser 自成一套。经 B1–B4a，markdownCore 已覆盖所有 block，① 应是「markdownCore 的一个薄 caller」，而非又一套实现。

## 实施步骤

1. 改 `ResultParser.parse`（或 `aiMarkdownToNoteDoc`）直接调 markdownCore 产 PMNode[]。确认 markdownCore 已覆盖 ① 需要的全部 block（B1–B4a 的成果）；若有遗漏 block（UNCOVERED 哨兵命中），说明哪类没进核、暂如何兜底。
2. 迁 3 处消费方：
   - `aiMarkdownToNoteDoc`：直接用 PMNode[]，删中间态。
   - `buildAITurnPmNodes`（ai-sync-blocks.ts）：同上。
   - `tests/ai-markdown-fenced-code.test.ts`：断言从「ExtractedBlock.type==='code'」改为「PMNode.type==='codeBlock'」等。
3. 删 `index.ts:14-18` 的 ExtractedBlock re-export。
4. 删 `blocks-to-pm-doc.ts` + `extraction-types.ts`（grep 全仓确认零残留 import 后再删；有残留先迁）。

## 铁律边界

1. ① 走 markdownCore，**不重建独立实现**（否则收敛白做）。
2. **AI 提取输出不变**：整页/单条提取、ai-sync 的最终 PMNode[] 产物迁移前后一致（这是回归红线；wrapAITurnsInToggle 不受影响但要验端到端产物没变）。
3. 删文件前 **grep 全仓确认零消费**（`ExtractedBlock`/`ExtractedInline`/`ExtractedListItem`/`extractedBlocksToPmDoc`/`blocks-to-pm-doc` 全清），采信 git diff 逐个核，别漏。

## 验收标准（交给指挥核对）

- [ ] `ResultParser.parse`/`aiMarkdownToNoteDoc` 直接产 PMNode[]，内部走 markdownCore（非自建实现）。
- [ ] 3 处消费方迁完；ExtractedBlock re-export 删除。
- [ ] `blocks-to-pm-doc.ts` + `extraction-types.ts` 删除（或说明为何保留），全仓 grep 零残留 import。
- [ ] **AI 提取端到端产物不变**：整页提取、单条提取、ai-sync 的 PMNode[] 迁移前后一致（契约测试 + 实机验一次 AI 整页提取）。
- [ ] `tests/ai-markdown-fenced-code.test.ts` 断言已适配 PMNode，全绿。
- [ ] tsc 干净；全量测试绿。
- [ ] 分支 `feat/markdown-core-b4b`（B4a 合并后拉）；提交规范 + Co-Authored-By；**不要 push**。

## 给指挥的验收自检点

- ① 是不是真调 markdownCore 了（grep 确认，别又搞一套 result-parser 内联实现）。
- 删文件前 grep 全仓——`ExtractedBlock` 等符号是否真零残留（漏一个就编译崩或死代码）。
- AI 整页/单条/ai-sync 的产物有没有变（这是收敛终点，最怕悄悄改了 AI 输出）。
- `wrapAITurnsInToggle` 有没有被误动（它不该动，吃的是 PMNode）。

---

## 收官意义

B4b 合并后，「两套 markdown→PMNode[] 解析器」彻底根治：唯一真源 = markdownCore，① 和 ② 都只是它的 caller，ExtractedBlock 中间态消失。此后任何 block 解析 bug 只在一处修。导入收敛（A/B/C/D）告一段落。
