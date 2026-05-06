import type { MarkSpec } from 'prosemirror-model';

export const boldMark: MarkSpec = {
  parseDOM: [
    { tag: 'strong' },
    {
      tag: 'b',
      getAttrs: (node) => {
        const fw = (node as HTMLElement).style.fontWeight;
        return fw !== 'normal' && null;
      },
    },
    {
      style: 'font-weight',
      getAttrs: (value) => {
        const v = value as string;
        return /^(bold(er)?|[5-9]\d{2,})$/.test(v) && null;
      },
    },
  ],
  toDOM() {
    return ['strong', 0];
  },
};
