/**
 * Mermaid CodeMirror 6 StreamLanguage(V1 直迁)
 *
 * 仅供 fullscreen 内的 CodeMirror 编辑器消费;inline NodeView 不用 CodeMirror。
 *
 * 覆盖 Mermaid 常用关键字、连接线、字符串、数字 — 轻量实现,够用即可。
 */

import { StreamLanguage, type StringStream } from '@codemirror/language';

const DIAGRAM_TYPES = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'mindmap', 'timeline',
  'gitGraph', 'journey', 'quadrantChart', 'sankey', 'xychart-beta',
  'block-beta', 'packet-beta', 'kanban', 'architecture-beta',
]);

const KEYWORDS = new Set([
  'subgraph', 'end', 'direction', 'participant', 'actor', 'as',
  'note', 'over', 'of', 'loop', 'alt', 'else', 'opt', 'par', 'and',
  'critical', 'break', 'rect', 'activate', 'deactivate',
  'class', 'section', 'title', 'dateFormat', 'axisFormat',
  'click', 'callback', 'link', 'style', 'classDef', 'linkStyle',
  'TD', 'TB', 'LR', 'RL', 'BT',
  'left', 'right',
]);

const mermaidStreamParser = {
  startState() {
    return {};
  },
  token(stream: StringStream): string | null {
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/"[^"]*"/) || stream.match(/'[^']*'/)) return 'string';
    if (stream.match(/\[[^\]]*\]/)) return 'string';
    if (stream.match(/\{[^}]*\}/)) return 'string';
    if (stream.match(/\(\([^)]*\)\)/) || stream.match(/\([^)]*\)/)) return 'string';
    if (stream.match(/--+>|==+>|\.-+>|--+[^>]+-+>/)) return 'operator';
    if (stream.match(/---+|===+|\.-+\./)) return 'operator';
    if (stream.match(/\|[^|]*\|/)) return 'attribute';
    if (stream.match(/->>|-->>|-x|--x|-\)|--\)/)) return 'operator';
    if (stream.match(/\d+(\.\d+)?/)) return 'number';
    if (stream.match(/[\w-]+/)) {
      const word = stream.current();
      if (DIAGRAM_TYPES.has(word)) return 'keyword';
      if (KEYWORDS.has(word)) return 'keyword';
      return 'variableName';
    }
    if (stream.match(':')) return 'punctuation';
    if (stream.match(';')) return 'punctuation';
    stream.next();
    return null;
  },
};

export const mermaidLanguage = StreamLanguage.define(mermaidStreamParser);
