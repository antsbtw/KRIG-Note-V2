/**
 * callout NodeView — emoji 按钮 + content
 *
 * 点击 emoji 循环切换 10 个 emoji(对齐 V1)。
 */

import type { NodeViewConstructor } from 'prosemirror-view';

const EMOJI_LIST = ['💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐'];

export const calloutNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('krig-callout');
  dom.setAttribute('data-emoji', (node.attrs.emoji as string) || '💡');

  const emojiEl = document.createElement('span');
  emojiEl.classList.add('krig-callout__emoji');
  emojiEl.contentEditable = 'false';
  emojiEl.textContent = (node.attrs.emoji as string) || '💡';
  emojiEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    const idx = EMOJI_LIST.indexOf((cur.attrs.emoji as string) || '💡');
    const next = EMOJI_LIST[(idx + 1) % EMOJI_LIST.length];
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, emoji: next }));
  });

  const content = document.createElement('div');
  content.classList.add('krig-callout__content');

  dom.appendChild(emojiEl);
  dom.appendChild(content);

  return {
    dom,
    contentDOM: content,
    update(updatedNode) {
      if (updatedNode.type.name !== 'callout') return false;
      const emoji = (updatedNode.attrs.emoji as string) || '💡';
      emojiEl.textContent = emoji;
      dom.setAttribute('data-emoji', emoji);
      return true;
    },
    ignoreMutation(mutation) {
      return mutation.target === emojiEl || emojiEl.contains(mutation.target as Node);
    },
  };
};
