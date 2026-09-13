/**
 * defBlock NodeView — `+++` 边框 + 折叠 + 摘要
 *
 * ⭐ `+++` 是**块的边框**,由 NodeView 画(contentEditable=false),**不在文本里** ——
 * 用户编辑的只有中间那几行词法。前一版把 `+++` 塞进 paragraph 文本,导致
 * 每次序列化都要重新猜边界;真块之后边界是结构性的。
 *
 * ⭐ 折叠(用户拍板**默认折叠**):
 * - open=false → 只显示一行摘要(`id: B · 2 项`),正文 DOM 仍在(PM 要求
 *   contentDOM 常驻),由 CSS `display:none` 隐藏。⚠️ 不能真的不渲染 contentDOM,
 *   否则 PM 位置映射错乱。
 * - 点 `+++` 头或摘要 → 切换。
 *
 * ⚠️ 摘要只做**字面统计**,不解释任何 key(词法归 lexicon,含义归调用方)。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { DEF_FENCE, parseDefText, defValue } from './lexicon';

/** 折叠态摘要:有 `id:` 就显示它,再缀上行数。⚠️ 纯字面,不解释含义。 */
function summarize(node: PMNode): string {
  const block = parseDefText(node.textContent);
  const alias = defValue(block, 'id');
  const n = block.lines.length;
  const head = alias ? `id: ${alias}` : 'def';
  return n > 0 ? `${head} · ${n} 项` : head;
}

export const defBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');

  // ── 头:`+++` 记号(点击折叠/展开)──
  const fenceTop = document.createElement('div');
  fenceTop.className = 'krig-def-block__fence';
  fenceTop.contentEditable = 'false';
  fenceTop.textContent = DEF_FENCE;

  // ── 折叠态摘要 ──
  const summary = document.createElement('div');
  summary.className = 'krig-def-block__summary';
  summary.contentEditable = 'false';

  // ── 正文(contentDOM,PM 接管)──
  const body = document.createElement('pre');
  body.className = 'krig-def-block__body';

  // ── 尾:`+++` ──
  const fenceBottom = document.createElement('div');
  fenceBottom.className = 'krig-def-block__fence';
  fenceBottom.contentEditable = 'false';
  fenceBottom.textContent = DEF_FENCE;

  dom.appendChild(fenceTop);
  dom.appendChild(summary);
  dom.appendChild(body);
  dom.appendChild(fenceBottom);

  function toggleOpen(): void {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, open: cur.attrs.open !== true }),
    );
  }

  for (const el of [fenceTop, summary]) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleOpen();
    });
  }

  function paint(n: PMNode): void {
    const open = n.attrs.open === true;
    dom.className = open ? 'krig-def-block' : 'krig-def-block closed';
    dom.setAttribute('data-open', String(open));
    if (n.attrs.for) dom.setAttribute('data-for', n.attrs.for as string);
    else dom.removeAttribute('data-for');
    summary.textContent = summarize(n);
  }

  paint(node);

  return {
    dom,
    contentDOM: body,
    update(updated) {
      if (updated.type.name !== 'defBlock') return false;
      node = updated;
      paint(node);
      return true;
    },
    ignoreMutation(mutation) {
      // 正文由 PM 管;`+++` / 摘要是我们自己画的,PM 不该为它们的变动重解析。
      return mutation.target !== body && !body.contains(mutation.target as Node);
    },
  };
};
