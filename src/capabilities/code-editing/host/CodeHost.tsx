/**
 * CodeHost — code-editing capability 的 React Host
 *
 * 职责:
 * - mount 时 new CMView,doc = initialValue
 * - 按 language id 异步加载 LanguageItem.loader,resolve 后再创建 view
 *   (避免"先渲再换语言"造成的撕裂)
 * - onChange 用 ref 镜像避免每次新闭包重建 extension
 * - onMount 回调暴露 imperative handle(getValue / setValue / focus)
 *
 * 设计抽自 src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidEditor.tsx
 * (V1→V2 mermaid 全屏直迁版本),把"mermaid 专属"参数变成"通用 LanguageItem"。
 *
 * **CMView 不进 React state**(它自管 DOM,React 控会撞);useRef 保实例,
 * useEffect 仅 mount/unmount 构造/销毁。
 *
 * **子组件 cleanup 先于父执行**(见 memory feedback_react_unmount_child_cleanup_order):
 * 父组件如需 unmount 时取 SDK 当前状态写回,**不要走 imperative API**,
 * 改用父 onChange 时同步的 `lastValueRef`(本 Host 通过 onChange 推 + onMount
 * 暴露 getValue 仅供 imperative 命令式操作,持久化路径不可走它)。
 */

import { useEffect, useRef } from 'react';
import { EditorView as CMView, lineNumbers, keymap as cmKeymap } from '@codemirror/view';
import { EditorState as CMState, type Extension } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { cmDarkTheme, cmDarkHighlight } from './theme-dark';
import { getLanguage } from '../languages/registry';
import type { CodeEditingHostProps, CodeEditingHandle } from '../types';

export function CodeHost({
  initialValue,
  language,
  theme: _theme = 'dark', // Phase 1 仅 dark;light 等接口
  onChange,
  onMount,
  readOnly = false,
  features,
}: CodeEditingHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<CMView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  const showLineNumbers = features?.lineNumbers ?? true;
  const enableTabIndent = features?.tabIndent ?? true;
  const enableDefaultKeymap = features?.defaultKeymap ?? true;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    let cancelled = false;

    // language loader 异步:等 loader resolve 再 mount;cancelled 守门
    const loadLang = async (): Promise<unknown | null> => {
      if (!language) return null;
      const item = getLanguage(language);
      if (!item) {
        console.warn(`[code-editing] unknown language '${language}', falling back to plain`);
        return null;
      }
      try {
        return await item.loader();
      } catch (e) {
        console.warn(`[code-editing] language '${language}' loader failed:`, e);
        return null;
      }
    };

    void loadLang().then((langExt) => {
      if (cancelled || !containerRef.current) return;

      const extensions: Extension[] = [
        cmDarkTheme,
        syntaxHighlighting(cmDarkHighlight),
        CMView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
      ];
      if (showLineNumbers) extensions.push(lineNumbers());
      if (langExt) extensions.push(langExt as Extension);
      if (enableDefaultKeymap || enableTabIndent) {
        const keys = [];
        if (enableDefaultKeymap) keys.push(...defaultKeymap);
        if (enableTabIndent) keys.push(indentWithTab);
        extensions.push(cmKeymap.of(keys));
      }
      if (readOnly) extensions.push(CMState.readOnly.of(true));

      const state = CMState.create({ doc: initialValue, extensions });
      const view = new CMView({ state, parent: containerRef.current });
      viewRef.current = view;

      // mount 后 50ms 聚焦(对齐 V1 mermaid 体验,等 layout 稳)
      const focusTimer = window.setTimeout(() => view.focus(), 50);

      const handle: CodeEditingHandle = {
        getValue: () => viewRef.current?.state.doc.toString() ?? '',
        setValue: (text: string) => {
          const v = viewRef.current;
          if (!v) return;
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
        },
        focus: () => viewRef.current?.focus(),
      };
      onMountRef.current?.(handle);

      // focus timer cleanup 挂到 view 上,unmount 时一并 destroy
      (view as unknown as { __focusTimer: number }).__focusTimer = focusTimer;
    });

    return () => {
      cancelled = true;
      const v = viewRef.current;
      if (v) {
        const t = (v as unknown as { __focusTimer?: number }).__focusTimer;
        if (typeof t === 'number') window.clearTimeout(t);
        v.destroy();
      }
      viewRef.current = null;
    };
    // initialValue / language / features 都是初始种子;后续靠 setValue / 重 mount 改
    // (项目未装 react-hooks/exhaustive-deps lint,故无需 disable 注释)
  }, []);

  return <div ref={containerRef} className="krig-code-host" style={{ height: '100%' }} />;
}
