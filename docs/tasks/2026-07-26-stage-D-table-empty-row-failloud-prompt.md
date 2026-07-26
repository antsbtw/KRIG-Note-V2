# 阶段 D — 表格零单元格行改 fail-loud（留痕）

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**风险极低（~10 行，纯加日志）。**

## 任务

`markdownToProseMirror`（`src/capabilities/text-editing/converters/md-to-pm.ts`）解析 GFM 表格时，遇到**畸形零单元格行**（`cells.length === 0`，来自畸形 `||` 或 Word→md 退化行）会 `continue` **静默跳过**，无任何 warn 无留痕。用户侧表格行数对不上但完全无感——违反项目「fail-loud，不静默兜底」纲领（记忆 `[[feedback-fail-loud-no-fallback]]`）。

**跳过行为本身是对的**（防 `content:[]` 违反 PM schema `(tableCell|tableHeader)+` 致编辑器崩溃，2026-05-29 长 docx 导入崩溃根因）。**本任务只补留痕，不改跳过逻辑。**

## 目标

跳过畸形表格行时**留痕**：`console.warn` + （若低成本）把提示收进导入结果的 warnings，让长文档导入时能诊断「哪几行表格被丢了」。

## 仓库 / 分支

- CWD（每个 Bash 必 cd）：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- 从最新的 `feat/multi-window-step2` 分支拉新分支：`git checkout feat/multi-window-step2 && git pull && git checkout -b fix/table-empty-row-failloud`
- 设计依据：`docs/00-architecture/import-to-note-convergence.md` §「阶段 D」

## 实施步骤

1. 定位 `md-to-pm.ts` 里 `cells.length === 0` 的 `continue` 处（设计文档标注约在 `:400-407`，以实际为准 grep）。
2. **轻版（本任务范围）**：在跳过处加一行
   ```ts
   console.warn(`[md-to-pm] 跳过畸形空表格行 @行 ${i}（cells.length===0，防 schema 崩溃；数据行数会少一行）`);
   ```
   （行号变量用该处实际的行索引变量名。）
3. **不做重版**（不改 `markdownToProseMirror` 签名回传 warnings）——那个并入阶段 C 一起做（C 本就要动编排/结果归一）。本任务只做轻版一行 warn，保持改动最小。

## 验收标准（交给指挥核对）

- [ ] 只改了 `md-to-pm.ts` 一处，只加了 warn，**未改跳过逻辑本身**（`git diff` 应极小，就一行 + 可能的注释）。
- [ ] `npx tsc --noEmit -p tsconfig.json` 干净（除已知的无关 `XInboxView` 报错）。
- [ ] 未改函数签名、未动调用方。
- [ ] 提交信息规范（`fix(md-to-pm): 表格零单元格行跳过时 fail-loud 留痕`），带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- [ ] **不要 push**（指挥验收后统一 push）。

## 给指挥的验收自检点

- `git diff` 是否真的只有一行 warn（没顺手改跳过逻辑 / 没扩大范围）。
- warn 文案是否点明了「数据会少一行」（诊断有用）。
- 有没有误改 `md-to-pm.ts` 里别的表格逻辑。
