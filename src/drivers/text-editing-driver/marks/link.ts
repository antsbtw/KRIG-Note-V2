/**
 * link — 行内链接 mark(L5-B3.4)
 *
 * 对齐 V1 schema:
 * - attrs:href(必填,string)/ title(可选,string|null)
 * - inclusive: false(光标在链接末尾输入新字符不延长链接,V1 同款)
 * - parseDOM:`<a href="...">` + 反解 title attr
 *
 * 5 协议(配 link-click plugin):
 * - krig://note/{id}             — 跳到 right slot note
 * - krig://block/{id}/{anchor}   — 同文档当场滚 / 跨文档 right slot + 滚动
 * - https://... | http://...     — Electron shell.openExternal
 * - file://...                   — Electron shell.openPath
 * - media://...                  — 留 viewAPI 阶段
 */

import type { MarkSpec } from 'prosemirror-model';

export const linkMark: MarkSpec = {
  attrs: {
    href: {},
    title: { default: null },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          href: el.getAttribute('href'),
          title: el.getAttribute('title'),
        };
      },
    },
  ],
  toDOM(mark) {
    const href = mark.attrs.href as string;
    const title = mark.attrs.title as string | null;
    const attrs: Record<string, string> = { href };
    if (title) attrs.title = title;
    return ['a', attrs, 0];
  },
};
