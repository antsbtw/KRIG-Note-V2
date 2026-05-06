import type { MarkSpec } from 'prosemirror-model';

export const strikeMark: MarkSpec = {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { tag: 'strike' },
    { style: 'text-decoration=line-through' },
  ],
  toDOM() {
    return ['s', 0];
  },
};
