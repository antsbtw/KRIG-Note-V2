/**
 * toggleList NodeView — 折叠箭头 + content
 *
 * 对齐 V1:open=true 显示 ▼ + 完整内容;open=false 显示 ▶ + 仅首个子节点
 */

import type { NodeViewConstructor } from 'prosemirror-view';

export const toggleListNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div');
  const setOpenClass = (open: boolean) => {
    dom.className = open ? 'krig-toggle-list' : 'krig-toggle-list closed';
    dom.setAttribute('data-open', String(open));
  };
  setOpenClass(node.attrs.open !== false);

  const arrow = document.createElement('span');
  arrow.classList.add('krig-toggle-list__arrow');
  arrow.contentEditable = 'false';
  arrow.textContent = node.attrs.open !== false ? '▼' : '▶';
  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    const newOpen = !cur.attrs.open;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, open: newOpen }));
  });

  const content = document.createElement('div');
  content.classList.add('krig-toggle-list__content');

  dom.appendChild(arrow);
  dom.appendChild(content);

  return {
    dom,
    contentDOM: content,
    update(updatedNode) {
      if (updatedNode.type.name !== 'toggleList') return false;
      const isOpen = updatedNode.attrs.open !== false;
      setOpenClass(isOpen);
      arrow.textContent = isOpen ? '▼' : '▶';
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === arrow || arrow.contains(mutation.target as Node);
    },
  };
};
