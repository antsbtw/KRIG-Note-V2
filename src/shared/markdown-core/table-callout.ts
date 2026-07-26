/**
 * table + callout 的 canonical 构造器（阶段 B2）——①② 都调的唯一真源。
 *
 * **铁律**（同 [[markdown-core]] index.ts 头）：纯 sync、无副作用、无媒体 I/O。
 * table/callout 本就无 async，天然满足，别引入。
 *
 * 收编来源（调研见 B2 交接 prompt）：
 *  - table：② `md-to-pm.ts` 是更优实现（cell inline 走核 parseInline 递归嵌套 + strike、
 *    支持 `<br>` 拆段、畸形零单元格行 fail-loud warn），① `blocks-to-pm-doc.ts` 的
 *    `parseInlineMarkdownString` 是弱简化实现（不支持嵌套 mark/strike，无 `<br>`）。
 *    → 统一采 ②：cell inline 调核 `parseInline`，`<br>` 拆段，零单元格行 fail-loud warn。
 *  - callout：① `result-parser.ts` 有完整 GitHub `> [!NOTE]` alert + emoji map + HTML
 *    blockquote callout；② 完全没有（当普通 blockquote）。→ emoji map 从 ① 移植进核，
 *    ② 从此认 callout。
 */

import type { PMNode } from './types';
import { parseInline } from './inline';

/**
 * callout 类型 → emoji 映射（从 ① result-parser.ts CALLOUT_EMOJI_MAP 原样移植）。
 * GitHub alert（`> [!NOTE]`）与 HTML callout（`<blockquote data-callout>`）共用。
 */
export const CALLOUT_EMOJI_MAP: Record<string, string> = {
  note: '📝', info: 'ℹ️', tip: '💡', hint: '💡',
  warning: '⚠️', caution: '⚠️', danger: '🔴', error: '❌',
  success: '✅', check: '✅', example: '📋', quote: '💬',
  bug: '🐛', abstract: '📄', summary: '📄', tldr: '📄',
  question: '❓', faq: '❓', failure: '❌', fail: '❌',
  important: '🔥',
};

/**
 * callout 类型 → emoji（未知类型兜底 '💡'，与 ① 旧实现一致）。
 * 传入类型大小写不敏感（① 各处 collect 时都 toLowerCase 后查表，这里再兜一层）。
 */
export function calloutEmojiFor(calloutType: string): string {
  return CALLOUT_EMOJI_MAP[calloutType.toLowerCase()] || '💡';
}

/**
 * callout canonical 节点：`callout{emoji}` 包一个 paragraph，段内容走核 parseInline。
 *
 * 与 ① blocks-to-pm-doc.ts 旧 callout 输出对齐（emoji + 单 paragraph），但 body inline
 * 升级为核 parseInline（递归嵌套 + strike）—— ① 旧的 emoji 映射结果不变（回归护栏）。
 */
export function buildCalloutNode(emoji: string, bodyText: string): PMNode {
  return {
    type: 'callout',
    attrs: { emoji },
    content: [
      {
        type: 'paragraph',
        content: parseInline(bodyText),
      },
    ],
  };
}

/**
 * 拆 table cell 文本中的 `<br>` 为多段（采 ② splitCellOnBr，2026-05-28 反馈）。
 *
 * 容忍：<br> / <br/> / <br /> / <BR> / 大小写混合，跨多 br 视为一次切断。
 * 不命中任何 br → 返单段（保持原行为）。
 */
export function splitCellOnBr(cell: string): string[] {
  const parts = cell.split(/<br\s*\/?\s*>/i).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [cell];
}

/**
 * table cell → tableCell/tableHeader canonical 节点。
 * cell 内允许 `<br>` 拆多段，每段走核 parseInline（递归嵌套 + strike）。
 */
function buildTableCellNode(cellType: 'tableHeader' | 'tableCell', cellText: string): PMNode {
  return {
    type: cellType,
    // cell 内允许 <br> 拆多段（Word 导入硬件规格表 cell 多段被压一行的历史反馈）。
    // GFM 表格语法本身 cell 只能单行，<br> 是 V2 双方约定。
    content: splitCellOnBr(cellText).map((seg) => ({
      type: 'paragraph',
      content: parseInline(seg),
    })),
  };
}

/**
 * table canonical 节点：`table > tableRow > (tableHeader|tableCell) > paragraph`。
 *
 * 入参：rows 已切好的二维 cell 文本（① collectTable / ② 行级 split 各自定位后交进来），
 * hasHeader 决定第 0 行是否 tableHeader。
 *
 * 契约（对齐阶段 D + ② 现行为）：
 *  - cell inline 统一走核 parseInline（升级 ① 弱简化实现；不含嵌套 mark 的普通 cell 输出不变）。
 *  - `<br>` 拆段（采 ②）。
 *  - **畸形零单元格行 fail-loud warn 后字面跳过**（采 ②，防 `content:[]` 违反 schema
 *    `(tableCell|tableHeader)+` 致落库后 setNodeMarkup 重校验崩溃；不能静默 —— 长文档
 *    导入需能诊断哪几行被丢）。
 *  - colwidth 不预设（留 null）—— 与 PDF/JSON 导入统一「纯导入态」，由 NodeView 挂载时
 *    按编辑区宽度均分（此处不写 attrs，保持与 ①② 迁移前逐字段一致）。
 *
 * 返回 null：过滤后无任何有效行（全零单元格）—— caller 决定降级（不产 content:[] 空 table）。
 */
export function buildTableNode(rows: string[][], hasHeader: boolean): PMNode | null {
  const tableRows: PMNode[] = [];
  let isFirst = true;
  rows.forEach((cells, rowIdx) => {
    if (cells.length === 0) {
      // fail-loud 留痕：跳过本身是对的（防 schema 崩溃），但不能静默 ——
      // 长文档导入时表格行数对不上需能诊断「哪几行被丢了」。
      console.warn(
        `[markdown-core] 跳过畸形空表格行 @行 ${rowIdx}（cells.length===0，防 schema 崩溃；数据行数会少一行）`,
      );
      return;
    }
    const cellType = hasHeader && isFirst ? 'tableHeader' : 'tableCell';
    tableRows.push({
      type: 'tableRow',
      content: cells.map((cell) => buildTableCellNode(cellType, cell)),
    });
    isFirst = false;
  });

  if (tableRows.length === 0) return null;
  return { type: 'table', content: tableRows };
}
