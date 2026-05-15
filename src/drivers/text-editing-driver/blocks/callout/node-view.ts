/**
 * callout NodeView — emoji 按钮 + content
 *
 * 点击 emoji 触发 capability 端注入的 emoji-picker popup(grid 选择)。
 * handler 未注入时 fallback 到 10 个 emoji 循环切换(防 capability 未装)。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { getCalloutEmojiHandler } from './emoji-handler';

const EMOJI_FALLBACK_CYCLE = ['💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐'];

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
    const handler = getCalloutEmojiHandler();
    if (handler) {
      handler.onOpen(view, pos, emojiEl);
      return;
    }
    // fallback:capability 未装(测试环境 / driver 单装场景)— 循环切换
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    const idx = EMOJI_FALLBACK_CYCLE.indexOf((cur.attrs.emoji as string) || '💡');
    const next = EMOJI_FALLBACK_CYCLE[(idx + 1) % EMOJI_FALLBACK_CYCLE.length];
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
