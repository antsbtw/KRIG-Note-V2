import type { MarkSpec } from 'prosemirror-model';

export const codeMark: MarkSpec = {
  /** code mark 排他:不与其他 inline mark 共存 */
  excludes: '_',
  parseDOM: [{ tag: 'code' }],
  toDOM() {
    return ['code', 0];
  },
};
