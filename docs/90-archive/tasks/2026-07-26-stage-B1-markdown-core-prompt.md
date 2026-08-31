# 阶段 B1 — 抽共享 markdownCore 地基（只收敛已一致的 block）

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**风险中，是整个导入收敛的第一块基石。严格按边界做，不许扩大范围。**

## 背景（必读设计文档）

先完整读这三份，理解全局再动手：
- `docs/00-architecture/import-to-note-convergence.md`（**重点第 6 节函数级流水线 + 阶段 B**）
- `docs/00-architecture/krig-markdown-dialect-spec.md`（方言规范，markdownCore 的语法契约）

**核心事实（已调研确认）**：现在有**两套** markdown→PMNode[] 解析器，平行独立、各自有坑（同一 fence bug 在两处各修过一次）：
- ① `ResultParser`（`src/shared/ai-markdown-parser/result-parser.ts`）+ `extractedBlocksToPmDoc`（`blocks-to-pm-doc.ts`）—— AI 提取用，多一层 `ExtractedBlock` 中间态。
- ② `markdownToProseMirror`（`src/capabilities/text-editing/converters/md-to-pm.ts`）—— 文件/剪藏/Word 导入用。

**根治方向**：抽出**唯一**的 `markdownCore(md): PMNode[]` 纯解析核，让 ①② 都调它。**但这是渐进的（B1→B4），本任务只做 B1 地基。**

## 目标（B1 范围，严格）

新建 `src/shared/markdown-core/` 模块，实现 `markdownCore(md: string): PMNode[]`，**先只覆盖两套已经一致的 block**：
- heading（1-6→note 实际 1-3，按现有 PM schema）
- paragraph
- horizontalRule
- **codeBlock**（含**按 fence 长度配对**——两套都已修过，把正确实现固化进核，见方言规范档2）
- mathBlock / mathInline（`$$` / `$`）
- 基础 inline marks：bold / italic / code / link（+ 删除线 strike，②已有）

然后让 ①② 的**这几类 block** 改调 markdownCore（其它 block 仍走各自旧实现，B2–B4 再逐类迁）。

## 铁律边界（违反即验收不过）

1. **markdownCore 必须 sync、无副作用、无媒体 I/O**。base64→media:// 本地化（②的 `resolvePMImageSrc` async）**不进核**，留在 ② 外壳做后处理。核只产带原始 src 的节点。（依据：设计文档 6.0 铁律 + 阶段 B「异步分层」硬骨头。）
2. **不碰 ExtractedBlock 中间态**（指挥已拍板）。① 这几类 block 改调核后，把核产出的 PMNode[] 适配回 ① 现有下游即可；**不要重构 ① 的整体架构、不要废 ExtractedBlock**。那是 B2–B4 的事。
3. **只迁「已一致」的 block**。callout / list 内嵌 / table / image 富属性 / video / audio 等**差异 block 本任务一律不碰**（它们两套输出结构不同，合并是 B2–B4，贸然动会回归）。
4. **输出结构必须与现有消费方期望完全一致**——迁移的 block 在 AI 提取、文件导入、剪藏、Word 四条路径下产出的 PM 节点结构/attrs 不能变。这是回归红线。

## 实施步骤

1. 建 `src/shared/markdown-core/`：`index.ts`（`markdownCore` 入口）+ `blocks/`（分 block 解析）+ `inline.ts`（mark，含递归嵌套，参考 ②的 `parseInline` 更强的实现）+ `fence.ts`（代码块 fence 长度配对，参考已修的两份实现）。
2. `markdownCore` 先只解析上述 B1 block；遇到未覆盖的 block 类型，**留一个明确的「未覆盖」出口**（如产 `unknown` 占位或原样透传给 caller 处理），不要静默吞。
3. 让 ① `ResultParser`/`blocks-to-pm-doc` 的这几类 block 改调 markdownCore（其余不动）。
4. 让 ② `markdownToProseMirror` 的这几类 block 改调 markdownCore（其余不动）；媒体本地化仍在 ② 外壳。
5. **契约测试**：新建 `tests/markdown-core.test.ts`，每类 B1 block 一组，覆盖：解析正确性、fence 长度配对（嵌套 fence + 闭栏带残留两个已知坑，必测）、mark 递归嵌套。把现有 `tests/ai-markdown-fenced-code.test.ts` / `tests/md-to-pm-fenced-code.test.ts` 的用例并入或复用。

## 验收标准（交给指挥核对）

- [ ] `src/shared/markdown-core/` 新模块存在，`markdownCore` sync、无 async、无 IPC/media 调用（grep 确认核内无 `await` / `mediaPut` / `resolvePM`）。
- [ ] ①② 的 B1 block 已改调核；**未碰** callout/list/table/image富属性/video/audio 等差异 block。
- [ ] **未废 ExtractedBlock**、未重构 ① 整体架构。
- [ ] `tests/markdown-core.test.ts` 覆盖每类 B1 block + 两个 fence 坑 + mark 嵌套，全绿。
- [ ] **五条路径回归**：AI 整页提取 / AI 单条提取 / Markdown 文件导入 / 网页剪藏 / Word 导入，这几类 block 产出不变（跑现有相关测试 + 说明如何手验）。
- [ ] `npx tsc --noEmit` 干净（除已知 XInboxView）；`npx vitest run tests/markdown-core.test.ts tests/ai-markdown-fenced-code.test.ts tests/md-to-pm-fenced-code.test.ts` 全绿。
- [ ] 提交信息规范 + Co-Authored-By；分支从 `feat/multi-window-step2` 拉 `feat/markdown-core-b1`；**不要 push**。

## 给指挥的验收自检点

- 核是否真 sync 无副作用（B1 最容易犯的错就是把媒体本地化塞进核）。
- 是否偷偷动了差异 block（callout/list/table…）——那会引入回归，超出 B1 范围。
- 迁移的 block 输出结构和旧实现**逐字段一致**吗（用契约测试断言，别只看「能跑」）。
- ExtractedBlock 有没有被误废。
- 契约测试是否真覆盖了两个 fence 坑（嵌套 + 闭栏带残留），别只测 happy path。
