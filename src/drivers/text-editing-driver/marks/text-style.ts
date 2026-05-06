import type { MarkSpec } from 'prosemirror-model';

/**
 * textStyle — 文字颜色 mark(对齐 V1)
 *
 * attrs.color:CSS 色值字符串,null 时降级为无样式(等价于不应用 mark)
 * 渲染:`<span style="color: <color>">...</span>`
 * 反解:`style="color: ..."` 的任意元素
 */
export const textStyleMark: MarkSpec = {
  attrs: { color: { default: null } },
  parseDOM: [
    {
      style: 'color',
      getAttrs: (value) => ({ color: typeof value === 'string' ? value : null }),
    },
  ],
  toDOM(mark) {
    const color = mark.attrs.color as string | null;
    return color ? ['span', { style: `color: ${color}` }, 0] : ['span', 0];
  },
};
