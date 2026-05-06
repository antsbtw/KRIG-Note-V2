/**
 * taskItem NodeView — 渲染可点击 checkbox + 内容
 */

import type { NodeViewConstructor } from 'prosemirror-view';

export const taskItemNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('li');
  dom.setAttribute('data-type', 'task-item');
  dom.setAttribute('data-checked', String(node.attrs.checked));
  dom.className = `krig-task-item${node.attrs.checked ? ' checked' : ''}`;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'krig-task-item__checkbox';
  checkbox.contentEditable = 'false';
  checkbox.checked = !!node.attrs.checked;
  // 点击切换 checked 属性
  checkbox.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: !node.attrs.checked,
    });
    view.dispatch(tr);
  });

  const content = document.createElement('div');
  content.className = 'krig-task-item__content';

  dom.appendChild(checkbox);
  dom.appendChild(content);

  return {
    dom,
    contentDOM: content,
    update(updatedNode) {
      if (updatedNode.type.name !== 'taskItem') return false;
      checkbox.checked = !!updatedNode.attrs.checked;
      dom.setAttribute('data-checked', String(updatedNode.attrs.checked));
      dom.className = `krig-task-item${updatedNode.attrs.checked ? ' checked' : ''}`;
      return true;
    },
  };
};
