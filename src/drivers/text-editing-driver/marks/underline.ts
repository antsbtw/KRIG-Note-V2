import type { MarkSpec } from 'prosemirror-model';

export const underlineMark: MarkSpec = {
  parseDOM: [
    { tag: 'u' },
    { style: 'text-decoration=underline' },
  ],
  toDOM() {
    return ['u', 0];
  },
};
