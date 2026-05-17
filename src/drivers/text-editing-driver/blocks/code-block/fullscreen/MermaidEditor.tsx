/**
 * MermaidEditor — CodeMirror 6 子组件
 *
 * 职责:
 * - mount 时 new CMView,doc = initialValue(由父组件读取 PM 现有内容)
 * - 用户输入时触发 onChange(防抖由父级控)
 * - 暴露 imperative ref:getValue / setValue / focus
 *
 * 关键设计:
 * - CMView 不进 React state(它自管 DOM,React 控会撞)
 * - useRef 保实例,useEffect 仅 mount/unmount 构造/销毁
 * - initialValue 是初始种子,挂载后变化不重建 CM(改 doc 走 setValue 命令)
 * - onChange 用 ref 镜像,避免每次新闭包让 cm extension 重建
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView as CMView, lineNumbers, keymap as cmKeymap } from '@codemirror/view';
import { EditorState as CMState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { mermaidLanguage } from './mermaid-lang';

const cmDarkTheme = CMView.theme(
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

const cmDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.operator, color: '#d4d4d4', fontWeight: 'bold' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.attributeName, color: '#dcdcaa' },
  { tag: tags.punctuation, color: '#808080' },
]);

export interface MermaidEditorHandle {
  getValue: () => string;
  setValue: (text: string) => void;
  focus: () => void;
}

interface MermaidEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
}

export const MermaidEditor = forwardRef<MermaidEditorHandle, MermaidEditorProps>(
  function MermaidEditor({ initialValue, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<CMView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      const parent = containerRef.current;
      if (!parent) return;

      const state = CMState.create({
        doc: initialValue,
        extensions: [
          lineNumbers(),
          cmDarkTheme,
          syntaxHighlighting(cmDarkHighlight),
          mermaidLanguage,
          cmKeymap.of([...defaultKeymap, indentWithTab]),
          CMView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      });
      const view = new CMView({ state, parent });
      viewRef.current = view;

      // mount 后 50ms 聚焦(对齐 V1 体验,等 layout 稳)
      const focusTimer = window.setTimeout(() => view.focus(), 50);

      return () => {
        window.clearTimeout(focusTimer);
        view.destroy();
        viewRef.current = null;
      };
      // initialValue 是初始种子;后续靠 setValue 显式改,不重建 CM
    }, []);

    useImperativeHandle(ref, () => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      setValue: (text: string) => {
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      },
      focus: () => viewRef.current?.focus(),
    }));

    return <div ref={containerRef} className="krig-mermaid-fs__cm" />;
  },
);
