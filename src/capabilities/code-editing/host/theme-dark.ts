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

// 对齐 VSCode Dark+ + inline syntax highlight CSS(pm-host.css 内 .krig-code-syntax-token--*)
// 12 类映射保持 inline / 全屏视觉一致。
export const cmDarkHighlight = HighlightStyle.define([
  // 控制 / 模块 keyword — 紫
  { tag: tags.definitionKeyword, color: '#c586c0' },
  { tag: tags.moduleKeyword, color: '#c586c0' },
  { tag: tags.modifier, color: '#c586c0' },
  // 普通 keyword — 蓝
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.controlKeyword, color: '#569cd6' },
  { tag: tags.operatorKeyword, color: '#569cd6' },
  { tag: tags.self, color: '#569cd6' },
  { tag: tags.null, color: '#569cd6' },
  // 类型 / 类名 — 青绿
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.className, color: '#4ec9b0' },
  { tag: tags.namespace, color: '#4ec9b0' },
  { tag: tags.constant(tags.name), color: '#4ec9b0' },
  // 函数 / 方法名 — 浅黄
  { tag: tags.function(tags.variableName), color: '#dcdcaa' },
  { tag: tags.function(tags.propertyName), color: '#dcdcaa' },
  { tag: tags.labelName, color: '#dcdcaa' },
  // 变量 / 参数 / 属性 — 浅蓝
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.propertyName, color: '#9cdcfe' },
  // 字符串 — 橙
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.special(tags.string), color: '#ce9178' },
  { tag: tags.regexp, color: '#ce9178' },
  // 数字 / 常量 — 浅绿
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.integer, color: '#b5cea8' },
  { tag: tags.float, color: '#b5cea8' },
  { tag: tags.bool, color: '#b5cea8' },
  // 注释 — 绿斜
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.docComment, color: '#6a9955', fontStyle: 'italic' },
  // 操作符 — 浅灰
  { tag: tags.operator, color: '#d4d4d4' },
  { tag: tags.arithmeticOperator, color: '#d4d4d4' },
  { tag: tags.logicOperator, color: '#d4d4d4' },
  { tag: tags.bitwiseOperator, color: '#d4d4d4' },
  { tag: tags.compareOperator, color: '#d4d4d4' },
  { tag: tags.updateOperator, color: '#d4d4d4' },
  // 属性名 — 淡蓝
  { tag: tags.attributeName, color: '#92c5f8' },
  // 标点 — 灰
  { tag: tags.punctuation, color: '#808080' },
  { tag: tags.bracket, color: '#808080' },
  { tag: tags.paren, color: '#808080' },
  { tag: tags.brace, color: '#808080' },
  { tag: tags.separator, color: '#808080' },
]);
