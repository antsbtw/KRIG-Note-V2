# Block / Atom 序列化能力地图

> 创建：2026-06-12
> 缘起：X 截图功能找"block→图"能力时，发现它在 `lib/atom-serializers/svg`，但常被误以为在 graph 目录 ——
> 同类职责("把 block 转成另一种表示")散落在 driver / lib / platform / shared 四层，**难发现**。
> 本文件是索引（先治"找不到"），不做重构。归属梳理/抽象待 X 截图落地后单独立项（先复用后抽象）。

## 一、note 文档模型两种形态

- **PM 节点**（ProseMirror Node / doc）：编辑器运行时形态，schema 见 `src/drivers/text-editing-driver/blocks/*/spec.ts`。
- **Atom**：存储/传输形态（`payload.domain='pm'`）。PM ↔ Atom 转换见下"反向/存储"。

## 二、block / atom → 各种产物（正向序列化）

| 目标产物 | 入口函数 | 位置 | 谁在用 |
|---|---|---|---|
| **Markdown** | `sliceToMarkdown(slice)` / `docNodeToMarkdown(doc)` → `{markdown, images}` | `src/drivers/text-editing-driver/serializers/pm-to-markdown.ts:33,70` | note 导出、**X 发推**(getSelectionMarkdown)、剪贴板 |
| **SVG（视觉图）** ⭐ | `atomsToSvg(atoms, opts)` / `atomsToSvgWithLinks` → SVG 字符串（字体转 path、自包含、LRU 缓存） | `src/lib/atom-serializers/svg/index.ts:112,63` | **Graph 画板**（canvas-rendering / canvas-text-node / graph-canvas-view）；**X 截图（新，2026-06）** |
| ↳ 公式子渲染 | `renderMathBlock` / `renderMathInline` / `renderTeX(tex,size,display)` | `src/lib/atom-serializers/svg/blocks/mathBlock.ts`、`mathInline.ts`、`mathjax-svg.ts:59` | atomsToSvg 内部 |
| ↳ 支持的 block | textBlock / list / mathBlock / mathInline（**无 codeBlock**） | `src/lib/atom-serializers/svg/blocks/` | — |
| **纯文本** | `extractPlainText(atoms)` | `src/lib/atom-serializers/extract.ts:11` | 标签/预览 |
| **PNG** | ❌ 全仓暂无 svg→png（X 截图期将新增一个公共 `svgToPng`） | — | — |
| **Mermaid PNG/SVG** | `ExportFormat` 导出 + `mermaid-renderer` | `src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidPreviewPane.tsx`、同目录 `mermaid-renderer` | 代码块全屏面板；X 截图（代码/Mermaid 走这条） |

## 三、反向 / 存储（markdown / atom → block）

| 转换 | 入口 | 位置 |
|---|---|---|
| Markdown → Atom | `markdownToAtoms` | `src/capabilities/content-ingest/internal/markdown-to-atoms.ts` |
| Markdown → PM | md-to-pm（`markdownToProseMirror`） | `src/capabilities/text-editing/converters/md-to-pm.ts` |
| PM nodes → Atom drafts | `pm-nodes-to-drafts` | `src/capabilities/content-ingest/internal/pm-nodes-to-drafts.ts` |
| Atom → PmAtomInfo（存储读） | `atomToPmAtomInfo` | `src/platform/main/pm-content/capability-impl.ts:26` |
| AI markdown → PM doc | `blocks-to-pm-doc` | `src/shared/ai-markdown-parser/blocks-to-pm-doc.ts` |

## 四、已知的分层张力（待将来抽象立项时处理，勿现在动）

- `atom-serializers`（svg）放 `src/lib/`（像通用库）、命名是 "serializer"（像数据转换）、实际职责是"渲染成视觉图像"且事实消费者集中在 graph/canvas —— **名/位/实三者不一致 → 难发现**。
- 同类职责（block→产物）跨 4 层：driver(markdown) / lib(svg) / platform(atom存储) / shared(ai)。
- **不要为"可复用"预先抽象**：等 X 截图成为 `atomsToSvg` 的第二类真实消费者后，基于两个真实用例的共性再决定归位/抽象（先复用后抽象，总指挥 2026-06-12 拍板）。
