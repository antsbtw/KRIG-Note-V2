/**
 * noteLink NodeView — 渲染 + 点击路由(L5-B3.12)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/note-link.ts(NodeView 部分)
 *
 * 行为:
 * - 渲染 `📄 <label>`,contenteditable=false
 * - mount 时一次性查 handler.resolveNoteTitle:存在 → 同步 title 到 attrs.label;不存在 → 红色"未找到"
 * - 点击 → 走 link-click 协议路由,view 注入 onOpenNote 处理(对齐 krig://note 行为)
 * - 失效态(noteId 为空 / handler 查不到)显 .krig-note-link--missing 红字
 *
 * 解耦:driver 不依赖具体上层 capability,view 端注入 resolveNoteTitle 同步契约
 *      (V2 实施时 view 端用本地缓存的 NoteInfo 列表实现,IPC 查询不在 render 路径上)
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { getLinkClickHandler } from '../../plugins/build-link-click-plugin';

export const noteLinkNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;
  const dom = document.createElement('span');
  dom.classList.add('krig-note-link');
  dom.setAttribute('contenteditable', 'false');

  let currentNoteId = (node.attrs.noteId as string | null) ?? null;
  let currentLabel = (node.attrs.label as string) || '';

  function render(label: string, exists: boolean): void {
    dom.textContent = exists
      ? `📄 ${label || 'Untitled'}`
      : `📄 ${label || currentNoteId || '?'} (未找到)`;
    dom.classList.toggle('krig-note-link--missing', !exists);
  }

  /** mount / update 时通过 handler.resolveNoteTitle 同步 title;失效则切红色态 */
  function syncFromStore(): void {
    if (!currentNoteId) {
      render(currentLabel, false);
      return;
    }
    const handler = getLinkClickHandler();
    const liveTitle = handler?.resolveNoteTitle?.(currentNoteId) ?? null;
    if (liveTitle === null) {
      render(currentLabel, false);
      return;
    }
    const trimmed = liveTitle.trim();
    render(trimmed, true);
    if (trimmed && trimmed !== currentLabel) {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos != null) {
        const tr = view.state.tr.setNodeAttribute(pos, 'label', trimmed);
        tr.setMeta('addToHistory', false);
        // skipOnChange:true — NodeView 内部回写不应触发 onChange → IPC;否则切笔记
        // 加载多 noteLink 时 N 次 dispatch → N 次 IPC → OCC 风暴
        // (feedback_pm_internal_attr_write_must_mark_no_history 字面规则)
        tr.setMeta('skipOnChange', true);
        view.dispatch(tr);
        currentLabel = trimmed;
      }
    }
  }

  // 初始渲染 — 先用本地 label 占位,然后 store 同步覆盖
  render(currentLabel, true);
  syncFromStore();

  // 点击 → 走 link-click handler(同 krig://note 路径)
  dom.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentNoteId) return;
    const handler = getLinkClickHandler();
    handler?.onOpenNote(currentNoteId);
  });

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type.name !== 'noteLink') return false;
      node = updatedNode;
      const newId = (node.attrs.noteId as string | null) ?? null;
      const newLabel = (node.attrs.label as string) || '';
      if (newId !== currentNoteId || newLabel !== currentLabel) {
        currentNoteId = newId;
        currentLabel = newLabel;
        syncFromStore();
      }
      return true;
    },
    stopEvent() {
      return true;
    },
    ignoreMutation() {
      return true;
    },
  };
};
