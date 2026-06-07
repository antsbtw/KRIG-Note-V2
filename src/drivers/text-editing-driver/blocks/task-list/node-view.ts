/**
 * taskItem NodeView — checkbox + content + 时间标签 + deadline picker
 *
 * 对齐 V1:
 * - checkbox 切换写 completedAt(勾)/ 清空(未勾)
 * - hover 显示时间标签:`MM-DD 创建` / `截止 MM-DD` / `MM-DD 完成`
 * - 点时间标签弹 date picker 设 deadline
 * - deadline < 今天且未完成 → overdue 红字
 */

import type { NodeViewConstructor } from 'prosemirror-view';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildTimeLabel(attrs: Record<string, unknown>): string {
  const parts: string[] = [];
  if (attrs.checked && attrs.completedAt) {
    parts.push(`${formatDate(attrs.completedAt as string)} 完成`);
  } else {
    if (attrs.createdAt) parts.push(`${formatDate(attrs.createdAt as string)} 创建`);
    if (attrs.deadline) parts.push(`截止 ${formatDate(attrs.deadline as string)}`);
  }
  return parts.join(' · ');
}

function isOverdue(attrs: Record<string, unknown>): boolean {
  return !attrs.checked && !!attrs.deadline && new Date(attrs.deadline as string) < new Date();
}

export const taskItemNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('li');
  dom.setAttribute('data-type', 'task-item');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'krig-task-item__checkbox';
  checkbox.contentEditable = 'false';
  checkbox.checked = !!node.attrs.checked;
  checkbox.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    const nowISO = new Date().toISOString();
    const nextChecked = !cur.attrs.checked;
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, {
        ...cur.attrs,
        checked: nextChecked,
        completedAt: nextChecked ? nowISO : null,
      }),
    );
  });

  const content = document.createElement('div');
  content.className = 'krig-task-item__content';

  const timeLabel = document.createElement('span');
  timeLabel.className = 'krig-task-item__time';
  timeLabel.contentEditable = 'false';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'krig-task-item__date-input';

  timeLabel.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    dateInput.value = cur?.attrs.deadline ? (cur.attrs.deadline as string).slice(0, 10) : '';
    dateInput.showPicker?.();
  });

  dateInput.addEventListener('change', () => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    const deadline = dateInput.value
      ? new Date(`${dateInput.value}T23:59:59`).toISOString()
      : null;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, deadline }));
  });

  function syncDom(attrs: Record<string, unknown>) {
    dom.setAttribute('data-checked', String(attrs.checked));
    const cls = ['krig-task-item'];
    if (attrs.checked) cls.push('checked');
    if (isOverdue(attrs)) cls.push('overdue');
    dom.className = cls.join(' ');
    checkbox.checked = !!attrs.checked;
    timeLabel.textContent = buildTimeLabel(attrs);
    // 视觉缩进(Tab 整项右移,2026-06-07):indent attr → margin-left
    const indent = (attrs.indent as number | undefined) ?? 0;
    dom.style.marginLeft = indent > 0 ? `${indent * 24}px` : '';
  }

  syncDom(node.attrs);

  dom.appendChild(checkbox);
  dom.appendChild(content);
  dom.appendChild(timeLabel);
  dom.appendChild(dateInput);

  // 新建项首次挂载若无 createdAt,补一个(与 V1 行为对齐)
  // skipOnChange:true — NodeView 内部回写不应触发 onChange → IPC;否则 markdown 导入
  // 多 taskItem 同 noteId mount 时 N 次 dispatch → N 次 IPC → SurrealDB OCC 风暴
  // (feedback_pm_internal_attr_write_must_mark_no_history 字面规则)
  if (!node.attrs.createdAt) {
    queueMicrotask(() => {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos == null) return;
      const cur = view.state.doc.nodeAt(pos);
      if (!cur || cur.type.name !== 'taskItem' || cur.attrs.createdAt) return;
      view.dispatch(
        view.state.tr
          .setNodeMarkup(pos, undefined, { ...cur.attrs, createdAt: new Date().toISOString() })
          .setMeta('addToHistory', false)
          .setMeta('skipOnChange', true),
      );
    });
  }

  return {
    dom,
    contentDOM: content,
    update(updatedNode) {
      if (updatedNode.type.name !== 'taskItem') return false;
      syncDom(updatedNode.attrs);
      return true;
    },
  };
};
