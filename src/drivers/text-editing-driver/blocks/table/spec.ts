/**
 * table 系列 — 4 个 NodeSpec(L5-B3.7,B+ 路线)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/table.ts
 *
 * schema 关系:
 *   table          content='tableRow+'                  tableRole='table'      isolating
 *     └── tableRow    content='(tableCell|tableHeader)+'  tableRole='row'
 *           ├── tableCell    content='block+'   tableRole='cell'        isolating
 *           └── tableHeader  content='block+'   tableRole='header_cell' isolating
 *
 * 关键约束:
 * - tableRow content 引用驼峰 `tableCell` / `tableHeader`(短横线会触发 PM content
 *   表达式 SyntaxError → 白屏,见 memory feedback_pm_schema_naming)
 * - cell content='block+' 用 group 引用,允许嵌套任意 block(paragraph / heading / list / 等)
 *
 * attrs(cell / header 都有):
 *   colspan / rowspan(default 1)
 *   colwidth(默认 null,number[] 数组,prosemirror-tables columnResizing 写入)
 *   align('left' | 'center' | 'right' | 'justify' | null,继承默认)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { tableNodeView } from './node-view';
import { tableKeymapPlugin } from './keymap';
import { tableEditing, columnResizing } from 'prosemirror-tables';

// ── cell / header attrs 共用 ──

export type CellAlign = 'left' | 'center' | 'right' | 'justify';
const VALID_ALIGNS: readonly CellAlign[] = ['left', 'center', 'right', 'justify'];

function parseAlignAttr(dom: HTMLElement): CellAlign | null {
  const raw = dom.getAttribute('data-align');
  if (raw && (VALID_ALIGNS as readonly string[]).includes(raw)) {
    return raw as CellAlign;
  }
  return null;
}

function parseCellAttrs(dom: HTMLElement): Record<string, unknown> {
  const widthAttr = dom.getAttribute('data-colwidth');
  const colwidth = widthAttr
    ? widthAttr.split(',').map(Number).filter((n) => !Number.isNaN(n))
    : null;
  // 5A 拍板 + 5B §节 4 Stage 1 改动点 #2: rowIndex / colIndex 走 cell.attrs
  // (tableRow 不是 atom, row 边界信息字面落到 cell). dissect 期会重算覆盖
  // (5B Q2 选项 B), parseDOM 字面承担"复制粘贴 / DOM 入口"路径不丢字段.
  const rowIndexAttr = dom.getAttribute('data-row-index');
  const colIndexAttr = dom.getAttribute('data-col-index');
  return {
    colspan: Number(dom.getAttribute('colspan') || 1),
    rowspan: Number(dom.getAttribute('rowspan') || 1),
    colwidth: colwidth && colwidth.length > 0 ? colwidth : null,
    align: parseAlignAttr(dom),
    rowIndex: rowIndexAttr !== null ? Number(rowIndexAttr) : 0,
    colIndex: colIndexAttr !== null ? Number(colIndexAttr) : 0,
  };
}

function cellToDOM(node: import('prosemirror-model').Node, tag: 'td' | 'th'): import('prosemirror-model').DOMOutputSpec {
  const attrs: Record<string, string> = {};
  if ((node.attrs.colspan as number) > 1) attrs.colspan = String(node.attrs.colspan);
  if ((node.attrs.rowspan as number) > 1) attrs.rowspan = String(node.attrs.rowspan);
  const styleParts: string[] = [];
  const colwidth = node.attrs.colwidth as number[] | null;
  if (colwidth) {
    attrs['data-colwidth'] = colwidth.join(',');
    styleParts.push(`width: ${colwidth[0]}px`);
  }
  const align = node.attrs.align as string | null;
  if (align) {
    attrs['data-align'] = align;
    styleParts.push(`text-align: ${align}`);
  }
  // 5A 拍板 + 5B §节 4 Stage 1 改动点 #2: rowIndex / colIndex 字面序列化到
  // DOM data-* 以支持 copy/paste round-trip(否则跨 doc 粘贴丢 row/col 定位).
  const rowIndex = node.attrs.rowIndex as number | null | undefined;
  const colIndex = node.attrs.colIndex as number | null | undefined;
  if (typeof rowIndex === 'number') attrs['data-row-index'] = String(rowIndex);
  if (typeof colIndex === 'number') attrs['data-col-index'] = String(colIndex);
  if (styleParts.length) attrs.style = styleParts.join('; ');
  return [tag, attrs, 0];
}

// ── table ──

const tableNodeSpec: NodeSpec = {
  content: 'tableRow+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4 + 5A 拍板 table 是 atom):
    // table 字面拆 atom, attrs.id 与 atom.id 同步.
    // 由 buildAutoBlockIdPlugin appendTransaction 注入 ULID(plugin shouldHaveId
    // 字面看 spec.attrs 是否含 'id', 加完此字段后字面自动覆盖 table).
    // 5A §6.1 字面要求 table 是 atom; 5B §节 4 Stage 1 改动点 #1 字面登记.
    id: { default: null },
  },
  parseDOM: [{
    tag: 'table',
    getAttrs(dom) {
      const el = dom as HTMLElement;
      return { id: el.getAttribute('data-id') };
    },
  }],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-pm-table' };
    const id = node.attrs.id as string | null;
    if (id) attrs['data-id'] = id;
    return ['table', attrs, ['tbody', 0]];
  },
};

export const tableSpec: BlockSpec = {
  id: 'table',
  displayName: 'Table',
  spec: tableNodeSpec,
  nodeView: tableNodeView,
  // L5-B3.7 plugin 三件套:
  // - tableEditing()    库内置,处理 selection / keymap / 删除保护(必装)
  // - columnResizing()  库内置,拖 cell 边界改 colwidth + 同步 colgroup(必装)
  // - tableKeymapPlugin Tab / Shift-Tab 自定义(末 cell Tab 加新行)
  plugin: () => [tableEditing(), columnResizing(), tableKeymapPlugin()],
  containerRule: 'block+',
  cascadeBoundary: true,
};

// ── tableRow ──

const tableRowNodeSpec: NodeSpec = {
  content: '(tableCell | tableHeader)+',
  tableRole: 'row',
  parseDOM: [{ tag: 'tr' }],
  toDOM() {
    return ['tr', 0];
  },
};

export const tableRowSpec: BlockSpec = {
  id: 'tableRow',
  displayName: 'Table Row',
  spec: tableRowNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: true,
};

// ── tableCell ──

const tableCellNodeSpec: NodeSpec = {
  content: 'block+',
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
    align: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    // table 目录 4 NodeSpec 字面仅 tableCell 字面 receiver bookAnchor (字面最细粒度
    // 标注 receiver), table / tableRow / tableHeader 字面保持既有 attrs 0 变化
    // (table/row 字面容器, header 字面跟 cell 同型但实务无标注语义);
    // 字面登记 §10.D 偏离 - "24 种 block 按目录计数 = 24 处 bookAnchor" 字面落实方式
    bookAnchor: { default: null },
    // 5A 拍板 + 5B §节 4 Stage 1 改动点 #2 字面新增:
    // tableRow 不是 atom (5A 拍板), row 边界信息走 cell 自带的 rowIndex / colIndex
    // (0-based 整数). 5B Q2 拍板 dissect 期注入(选项 B); PM editor 内 attrs 字面
    // 陈旧不出 bug, dissect 时重算覆盖.
    rowIndex: { default: 0 },
    colIndex: { default: 0 },
  },
  tableRole: 'cell',
  isolating: true,
  parseDOM: [
    {
      tag: 'td',
      getAttrs(dom) {
        return parseCellAttrs(dom as HTMLElement);
      },
    },
  ],
  toDOM(node) {
    return cellToDOM(node, 'td');
  },
};

export const tableCellSpec: BlockSpec = {
  id: 'tableCell',
  displayName: 'Table Cell',
  spec: tableCellNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: true,
};

// ── tableHeader ──

const tableHeaderNodeSpec: NodeSpec = {
  content: 'block+',
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
    align: { default: null },
    // 5A 拍板: tableHeader 与 tableCell 同模式拆 atom + 同款 rowIndex/colIndex
    // (rowIndex=0 字面对应表头第 1 行; 5A §13.9 注 1 拍板).
    // 字面共用 parseCellAttrs / cellToDOM, 与 tableCell 同款.
    rowIndex: { default: 0 },
    colIndex: { default: 0 },
  },
  tableRole: 'header_cell',
  isolating: true,
  parseDOM: [
    {
      tag: 'th',
      getAttrs(dom) {
        return parseCellAttrs(dom as HTMLElement);
      },
    },
  ],
  toDOM(node) {
    return cellToDOM(node, 'th');
  },
};

export const tableHeaderSpec: BlockSpec = {
  id: 'tableHeader',
  displayName: 'Table Header',
  spec: tableHeaderNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: true,
};
