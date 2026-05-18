/**
 * thought mark — inline anchor(thought-view-port.md v0.5 §4 + §5.5)
 *
 * 横切思考层 inline 锚点 mark。用户在 Note 内选中文字 ⌘⇧M 触发,
 * 在选区上挂 thoughtMark + 在 thought capability 建 thought atom + thoughtOf 边
 * (anchor.source='note',locator.anchorType='inline')。
 *
 * attrs:
 * - thoughtId:对应 thought atom id(主键)
 * - thoughtType:V1 6 种 + ebook 3 种(共 9 种,见 THOUGHT_TYPE_META);
 *               冗余存于 attrs 便于不读 atom 即按 type 着色。
 *
 * 渲染:`<span data-thought-id="..." data-thought-type="...">` + 下划线,
 *      CSS 控制颜色(见 driver 全局 css 或 NoteView css)。
 *
 * excludes: ''(不互斥任何 mark) — 允许 thought mark 与 bold/italic/color 等叠加。
 * inclusive: false — 光标在 mark 末端输入新字符不延长 mark(避免 unintentional drag)。
 */

import type { MarkSpec } from 'prosemirror-model';

export const thoughtMark: MarkSpec = {
  attrs: {
    thoughtId: {},
    thoughtType: { default: 'thought' },
  },
  inclusive: false,
  excludes: '',
  parseDOM: [
    {
      tag: 'span[data-thought-id]',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          thoughtId: el.getAttribute('data-thought-id'),
          thoughtType: el.getAttribute('data-thought-type') || 'thought',
        };
      },
    },
  ],
  toDOM(mark) {
    const thoughtId = mark.attrs.thoughtId as string;
    const thoughtType = mark.attrs.thoughtType as string;
    return [
      'span',
      {
        'data-thought-id': thoughtId,
        'data-thought-type': thoughtType,
        class: `krig-thought-mark krig-thought-mark--${thoughtType}`,
      },
      0,
    ];
  },
};
