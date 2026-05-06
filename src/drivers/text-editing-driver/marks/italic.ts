import type { MarkSpec } from 'prosemirror-model';

export const italicMark: MarkSpec = {
  parseDOM: [
    { tag: 'em' },
    { tag: 'i' },
    { style: 'font-style=italic' },
  ],
  toDOM() {
    return ['em', 0];
  },
};
