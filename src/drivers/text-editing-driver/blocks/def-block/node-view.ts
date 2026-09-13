/**
 * defBlock NodeView — 分隔线边框 + 折叠成双线
 *
 * ⭐ `+++` **画成一条通栏的线**(不是字面的三个加号),视觉与 `---` 产生的
 * horizontalRule 同族 —— 用户 2026-09-13:「`+++` 是否使用一条线覆盖整个页面宽度?
 * 类似 `---` 产生的效果」。线是 NodeView 画的边框,**不在文本里**。
 *
 * ⭐ 两态(用户拍板):
 * - **展开**:上下各一条线,中间是可编辑的逐行词法。
 * - **折叠**:塌成**一条双线**,⚠️ **不显示 def 里的任何内容**、不显示 handle、
 *   **完全不可交互** —— 只响应「点一下展开」这一个动作。
 *
 * ⚠️ 折叠态既然选不中,它的**删除入口**在别处:光标落到**它下面那段的行首**
 * 按 Backspace 优先删掉整个 def 块(backspace-decision 第 7.5 步)。
 *
 * ⚠️ 正文 contentDOM 必须常驻(PM 位置映射要求),折叠靠 CSS 隐藏,
 * 不能真的不渲染。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export const defBlockNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');

  // ── 上边框(展开态一条线;折叠态由 CSS 变成双线)──
  const ruleTop = document.createElement('div');
  ruleTop.className = 'krig-def-block__rule';
  ruleTop.contentEditable = 'false';

  // ── 正文(contentDOM,PM 接管)──
  const body = document.createElement('pre');
  body.className = 'krig-def-block__body';

  // ── 下边框 ──
  const ruleBottom = document.createElement('div');
  ruleBottom.className = 'krig-def-block__rule';
  ruleBottom.contentEditable = 'false';

  dom.appendChild(ruleTop);
  dom.appendChild(body);
  dom.appendChild(ruleBottom);

  function toggleOpen(): void {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, open: cur.attrs.open !== true }),
    );
  }

  // 两条线都可点:展开态点任一条收起,折叠态点双线展开。
  for (const el of [ruleTop, ruleBottom]) {
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
      // 正文由 PM 管;两条线是我们自己画的,PM 不该为它们的变动重解析。
      return mutation.target !== body && !body.contains(mutation.target as Node);
    },
  };
};
