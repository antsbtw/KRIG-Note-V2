# 阶段 B2 — 合并 table + callout 进 markdownCore

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**B2/B3/B4a/B4b 有严格依赖顺序，B2 先做。风险中。**

## 背景（必读）

- `docs/00-architecture/import-to-note-convergence.md`（阶段 B）
- `docs/00-architecture/krig-markdown-dialect-spec.md`（方言，table/callout 的语法契约）

B1 已建 `src/shared/markdown-core/`（heading/paragraph/hr/code/math/inline 已进核，①② 都改调核）。现在 B2 把 **table + callout** 也收进核。这两类选在一起因为：都**无 async、无①②设计冲突**，是纯合并/补齐（相对 B3/B4a 简单）。

**两套现状（调研确认）**：
- **table**：① `result-parser.ts:706-749` collectTable + `blocks-to-pm-doc.ts:261-277`（cell inline 用简化的 `parseInlineMarkdownString`，不支持递归嵌套/strike，**不支持 `<br>` 拆段**）；② `md-to-pm.ts:362-422`（cell inline 用**核 parseInline** 递归嵌套 + strike，**支持 `<br>` 拆段** `splitCellOnBr`，畸形零单元格行已 fail-loud warn）。→ ② 是更优实现。
- **callout**：① 有完整实现（`result-parser.ts:152-179` GitHub `> [!NOTE]` alert + `:930-937` emoji map + `:1020-1070` HTML blockquote callout → PM `callout{emoji}`）；② **完全没有**（把 `> [!NOTE]` 当普通 blockquote）。→ 纯从①移植。

## 目标

1. **table 进核**：markdownCore 新增 table 解析（`markdown-core/blocks.ts` 加 `buildTableNode` 或独立 table 解析器），**cell inline 统一走核 parseInline**（升级 ① 那套简化实现）、**支持 `<br>` 拆段**（采 ②）、**畸形零单元格行 fail-loud warn**（采 ②，对齐阶段 D）、colwidth 留 null。①② table 都改调核。
2. **callout 进核**：把 ① 的 GitHub alert 识别 + emoji map + HTML callout 移植进核，产 `callout{emoji}` 节点。①② callout 都改调核（② 从此认 callout，不再降级 blockquote）。

## 铁律边界（违反即验收不过）

1. **核纯 sync 无副作用无媒体 I/O**（B1 铁律不可破；table/callout 本就无 async，天然满足，别引入）。
2. **只碰 table + callout**。blockquote/list/image/video/audio/file 等**本任务一律不碰**（分属 B3/B4a）。
3. **table 输出结构对现有四路径消费方一致**：迁移后 table 的 PM 节点结构（tableRow/tableHeader/tableCell/paragraph 嵌套 + colwidth:null）不能变。cell inline 从①的简化升级成核 parseInline 是**改进**（① 旧的对嵌套 mark 本就弱），但要确保**不含嵌套 mark 的普通 cell 输出逐字段不变**（契约测试断言）。
4. **callout**：② 从「不认 callout→降级 blockquote」变成「认 callout→产 callout 节点」是**新增能力**（非回归），但 ① 的 callout 输出（emoji 映射结果）必须不变。

## 实施步骤

1. 在 `markdown-core/` 加 table + callout 的 canonical 解析（cell inline 调核 `parseInline`；callout emoji map 从 ① `result-parser.ts:930-937` 移植）。
2. ② `md-to-pm.ts`：table 改调核（保留 `<br>` 拆段与 fail-loud warn 语义）；blockquote 分支加 callout 识别改调核。
3. ① `result-parser.ts`/`blocks-to-pm-doc.ts`：table + callout 改调核 canonical 构造器（其余 block 不动，同 B1 做法）。
4. **契约测试** `tests/markdown-core.test.ts` 增 table + callout 组：table（含 `<br>` 拆段、畸形行 warn、cell 内嵌套 mark）、callout（各 alert 类型→emoji、HTML callout）。

## 验收标准（交给指挥核对）

- [ ] 核内新增 table + callout 解析，仍纯 sync（grep 核内无 `await`/`async`/`mediaPut`）。
- [ ] **只碰 table + callout**；blockquote/list/image/media 未动。
- [ ] ①② 的 table + callout 都改调核；② 现在认 callout（不再降级 blockquote）。
- [ ] table 普通 cell 输出逐字段不变（契约测试断言）；`<br>` 拆段、畸形行 fail-loud、colwidth:null 保留。
- [ ] callout emoji 映射结果与 ① 旧实现一致。
- [ ] 契约测试覆盖 table（<br>/畸形/嵌套 mark）+ callout（alert类型/HTML）全绿。
- [ ] tsc 干净（仅 XInboxView）；相关测试全绿。
- [ ] 分支从 `feat/multi-window-step2` 拉 `feat/markdown-core-b2`；提交信息规范 + Co-Authored-By；**不要 push**。
- [ ] 报告注明：e2e 落库测试若因 `proxy-node-store.ts` 的 `app.getPath` 崩，是预存在环境限制（非本次），列出需实机手验的路径。

## 给指挥的验收自检点

- 核是否仍纯 sync（table/callout 无 async 是天然的，但看有没有手滑引入）。
- 有没有越界碰 blockquote/list/image（B3/B4a 的范围）。
- table 普通 cell 是否真逐字段一致（别只测「能渲染」）；`<br>` 拆段和畸形行 warn 有没有在改调后丢。
- callout 的 ② 侧：以前当 blockquote 的 `> [!NOTE]`，现在是不是真变 callout 了（新增能力验证）。
- ① 侧 callout emoji 有没有变（回归）。
