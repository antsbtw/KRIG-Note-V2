import type { MarkSpec } from 'prosemirror-model';

/**
 * highlight — 背景高亮 mark(对齐 V1)
 *
 * attrs.color:CSS 色值字符串,默认 'yellow'(V1 同款)
 * 渲染:`<mark data-color="..." style="background-color: ...; color: #000">`
 * 反解:`<mark>` 标签 + data-color attr
 *
 * 文字色硬置 #000:V2 dark theme 下默认白字,叠浅色高亮底不可读;
 * 浅色背景上黑字最稳,对齐 ColorPicker BG_COLORS 鲜艳不透明色表
 */
export const highlightMark: MarkSpec = {
  attrs: { color: { default: 'yellow' } },
  parseDOM: [
    {
      tag: 'mark',
      getAttrs(node) {
        const el = node as HTMLElement;
        return { color: el.getAttribute('data-color') || 'yellow' };
      },
    },
  ],
  toDOM(mark) {
    const color = mark.attrs.color as string;
    return [
      'mark',
      { 'data-color': color, style: `background-color: ${color}; color: #000` },
      0,
    ];
  },
};
