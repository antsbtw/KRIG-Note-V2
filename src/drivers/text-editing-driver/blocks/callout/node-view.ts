/**
 * callout NodeView — symbol 按钮(emoji 或 lucide icon) + content
 *
 * 点击 symbol 触发 capability 端注入的 emoji-picker popup(grid 选择)。
 * handler 未注入时 fallback 到 10 个 emoji 循环切换(防 capability 未装)。
 *
 * D023 §4.2 字面渲染单点判定:
 * - iconName != null → 调 setCalloutIconRenderer 注入的 renderer 渲 lucide `<svg>`
 * - iconName == null → 渲 emoji 字符(fallback 兜底)
 *
 * driver 层字面零 lucide-react / 零 React 依赖(B 路径,§10.2 偏离登记)。
 */

import type { NodeViewConstructor } from 'prosemirror-view';
import { getCalloutEmojiHandler } from './emoji-handler';
import { getCalloutIconRenderer } from './icon-handler';

const EMOJI_FALLBACK_CYCLE = ['💡', '⚠️', '❌', '✅', 'ℹ️', '🔥', '📌', '💬', '🎯', '⭐'];

export const calloutNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('krig-callout');
  dom.setAttribute('data-emoji', (node.attrs.emoji as string) || '💡');
  if (node.attrs.iconName) {
    dom.setAttribute('data-icon-name', node.attrs.iconName as string);
  }

  // symbol host: emoji 字符 或 lucide icon(由 capability 注入 renderer 填充)
  const symbolEl = document.createElement('span');
  symbolEl.classList.add('krig-callout__emoji');
  symbolEl.contentEditable = 'false';
  renderSymbol(symbolEl, node.attrs.iconName as string | null, node.attrs.emoji as string);

  symbolEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null) return;
    const handler = getCalloutEmojiHandler();
    if (handler) {
      handler.onOpen(view, pos, symbolEl);
      return;
    }
    // fallback:capability 未装(测试环境 / driver 单装场景)— 循环切换 emoji
    // 字面同步清 iconName(对齐 setCalloutEmoji 互斥副作用 §4.4)
    const cur = view.state.doc.nodeAt(pos);
    if (!cur) return;
    const idx = EMOJI_FALLBACK_CYCLE.indexOf((cur.attrs.emoji as string) || '💡');
    const next = EMOJI_FALLBACK_CYCLE[(idx + 1) % EMOJI_FALLBACK_CYCLE.length];
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, emoji: next, iconName: null }),
    );
  });

  const content = document.createElement('div');
  content.classList.add('krig-callout__content');

  dom.appendChild(symbolEl);
  dom.appendChild(content);

  return {
    dom,
    contentDOM: content,
    update(updatedNode) {
      if (updatedNode.type.name !== 'callout') return false;
      const emoji = (updatedNode.attrs.emoji as string) || '💡';
      const iconName = updatedNode.attrs.iconName as string | null;
      renderSymbol(symbolEl, iconName, emoji);
      dom.setAttribute('data-emoji', emoji);
      if (iconName) {
        dom.setAttribute('data-icon-name', iconName);
      } else {
        dom.removeAttribute('data-icon-name');
      }
      return true;
    },
    destroy() {
      // 字面通知 renderer 释放 React root 等资源(防内存泄漏)
      const renderer = getCalloutIconRenderer();
      if (renderer) renderer.unmount(symbolEl);
    },
    ignoreMutation(mutation) {
      return mutation.target === symbolEl || symbolEl.contains(mutation.target as Node);
    },
  };
};

/**
 * 字面单点判定 — iconName 非 null 优先,否则 emoji 兜底。
 *
 * iconName != null 但 renderer 字面未注入(capability 未装)→ fallback emoji 渲染
 * (字面零行为退化,与 emoji-handler null fallback 同语义)。
 */
function renderSymbol(hostEl: HTMLElement, iconName: string | null, emoji: string): void {
  const renderer = getCalloutIconRenderer();
  if (iconName && renderer) {
    renderer.render(hostEl, iconName);
    return;
  }
  // 清 renderer 可能残留的 React tree(切回 emoji 时)
  if (renderer) renderer.unmount(hostEl);
  hostEl.textContent = emoji || '💡';
}
