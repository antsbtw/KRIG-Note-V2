/**
 * code-editing dark theme(从 fullscreen/MermaidEditor.tsx 抽出)
 *
 * 选色对齐 VS Code Dark+ 风格,字体走 monospace 系列。
 */

import { EditorView as CMView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const cmDarkTheme = CMView.theme(
  {
    '&': { backgroundColor: '#1e1e1e', color: '#d4d4d4', height: '100%' },
    '.cm-scroller': { fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace" },
    '.cm-content': {
      caretColor: '#e8eaed',
      fontSize: '14px',
      lineHeight: '1.6',
      padding: '12px 0',
    },
    '.cm-cursor': { borderLeftColor: '#e8eaed' },
    '.cm-gutters': {
      backgroundColor: '#1a1a1a',
      color: '#555',
      borderRight: '1px solid #2a2a2a',
    },
    '.cm-activeLineGutter': { backgroundColor: '#252525', color: '#888' },
    '.cm-activeLine': { backgroundColor: '#252525' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#264f78 !important',
    },
    '.cm-matchingBracket': { backgroundColor: '#3a3a3a', outline: '1px solid #555' },
  },
  { dark: true },
);

export const cmDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.operator, color: '#d4d4d4', fontWeight: 'bold' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.attributeName, color: '#dcdcaa' },
  { tag: tags.punctuation, color: '#808080' },
]);
