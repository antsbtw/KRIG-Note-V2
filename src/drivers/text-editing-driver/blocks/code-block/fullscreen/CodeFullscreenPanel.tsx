/**
 * CodeFullscreenPanel — 通用代码全屏面板(Phase 3 抽出)
 *
 * 取代原 MermaidFullscreenPanel 作为 L2 fullscreen-overlay 的入口 Component,所有
 * codeBlock(含 mermaid + plain text + JS/TS/Py/JSON/MD + 未来注册的语言)都走它。
 *
 * 布局:
 *   .krig-code-fs(flex column)
 *   ├─ 通用 toolbar(language select + 通用 Copy + × 关闭)
 *   └─ split:
 *       ├─ editor pane(CodeHost,language=当前)
 *       └─ 条件:language === 'mermaid' → divider + <MermaidPreviewPane>
 *
 * 关闭路径(× 按钮 / Esc / 业务方主动 controller.hide())统一收敛到 unmount:
 *   → Binding unmount Component → useEffect cleanup → 一次性 diff 写回 PM + 清 context
 *
 * 关键设计:
 * - CodeHost 用 capability;onChange 同步 lastValueRef + setSource(mermaid 路径要传给
 *   PreviewPane 触发预览;非 mermaid 路径 setSource 也调,无副作用)
 * - lastValueRef 写回 PM(memory feedback_react_unmount_child_cleanup_order):React unmount
 *   时子组件 cleanup 先于父执行,直接调 editorRef.current?.getValue() 会拿到 ''
 * - language 切换:全屏内 select onChange → setLanguage state + 写回 PM attrs(供
 *   关闭后 inline 同步)。CodeHost 用 key={language} 强制重 mount(走新 language
 *   的 loader);mount 前 lastValueRef 已保住内容,新 mount 走 initialValue=ref.current。
 *   mermaid 路径切换:language === 'mermaid' 时显示右侧 MermaidPreviewPane,从
 *   mermaid 切出时 PreviewPane 自然 unmount(cleanup 恢复 dark theme 渲染单例)。
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { FullscreenOverlayCloseProps }
  from '@slot/interaction-registries/fullscreen-overlay-registry/types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi, CodeEditingHandle, LanguageItem }
  from '@capabilities/code-editing/types';
import { instanceRegistry } from '../../../instance-registry';
import {
  getCodeFullscreenContext,
  clearCodeFullscreenContext,
} from './menu-context';
import { MermaidPreviewPane } from './MermaidPreviewPane';
import './code-fullscreen.css';
import './mermaid-fullscreen.css';

const ICON_COPY =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const LS_SPLIT = 'krig-mermaid-fs-split-ratio';

function readSplitRatio(): number {
  const raw = parseFloat(localStorage.getItem(LS_SPLIT) || '0.5');
  if (isNaN(raw)) return 0.5;
  return Math.max(0.15, Math.min(0.85, raw));
}

export function CodeFullscreenPanel({ onClose }: FullscreenOverlayCloseProps) {
  // ── mount 时一次性读取 context + 初始内容 ──
  const ctxRef = useRef(getCodeFullscreenContext());
  const editorRef = useRef<CodeEditingHandle | null>(null);

  // capability: Host + 语言注册查询
  const codeApi = requireCapabilityApi<CodeEditingApi>('code-editing');
  const CodeHost = codeApi.Host;

  const initialCodeRef = useRef<string>('');
  if (!initialCodeRef.current && ctxRef.current) {
    const inst = instanceRegistry.get(ctxRef.current.instanceId);
    const node = inst?.view.state.doc.nodeAt(ctxRef.current.nodePos);
    initialCodeRef.current = node?.textContent ?? '';
  }

  // **关键**:lastValueRef 镜像 CM 当前内容。React unmount 时子组件
  // (code-editing capability 的 CodeHost)的 cleanup 先于本 Panel 的 cleanup 执行
  // → CM view.destroy() → editorRef.current?.getValue() 返回 ''(SDK 已死)。
  // 详见 memory feedback_react_unmount_child_cleanup_order。
  const lastValueRef = useRef<string>(initialCodeRef.current);

  // language 用 React state — select onChange 切换时让 CodeHost / PreviewPane 重渲
  const [language, setLanguage] = useState<string>(ctxRef.current?.language ?? '');
  const isMermaid = language === 'mermaid';

  // 用 source state 给 MermaidPreviewPane 提供 doc 源 — onChange 同步,不影响非 mermaid 路径
  const [source, setSource] = useState<string>(initialCodeRef.current);

  // 编辑器内容变化 → 同步 lastValueRef + source(MermaidPreview 内部 300ms 防抖渲染)
  const onEditorChange = useCallback((v: string) => {
    lastValueRef.current = v;
    setSource(v);
  }, []);

  // template / direction 改动需要写回 editor(setValue 触发 onChange 回流)
  const onSourceChange = useCallback((newSource: string) => {
    editorRef.current?.setValue(newSource);
    // setValue 通过 CMView dispatch 触发 onChange → 已同步 lastValueRef + source state
  }, []);

  // ── 全屏内切语言:写回 PM attrs.language + setLanguage 让 CodeHost 重 mount ──
  // CodeHost 用 key={language} 在 React render 中,setLanguage 即触发 unmount+mount;
  // unmount 子组件 cleanup 先于父执行,但 lastValueRef 已保住当前内容,新 mount 走
  // initialValue=lastValueRef.current,内容不丢。
  // mermaid ↔ plain 切换:mermaid 时 MermaidPreviewPane 显;切走时自然 unmount,其 cleanup
  // 恢复 dark theme 渲染单例(memo:feedback_react_unmount_child_cleanup_order)。
  const onLanguageSelectChange = useCallback((e: FormEvent<HTMLSelectElement>) => {
    const newLang = e.currentTarget.value;
    if (newLang === language) return;
    // 写回 PM attrs(让关闭后 inline 同步)
    const ctx = ctxRef.current;
    if (ctx) {
      const inst = instanceRegistry.get(ctx.instanceId);
      if (inst) {
        const view = inst.view;
        const node = view.state.doc.nodeAt(ctx.nodePos);
        if (node && node.type.name === 'codeBlock') {
          const tr = view.state.tr.setNodeMarkup(ctx.nodePos, undefined, {
            ...node.attrs,
            language: newLang,
          });
          view.dispatch(tr);
        }
      }
    }
    setLanguage(newLang);
  }, [language]);

  // ── unmount cleanup:diff 写回 + 清 context ──
  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      if (ctx) {
        const inst = instanceRegistry.get(ctx.instanceId);
        if (inst) {
          const view = inst.view;
          const node = view.state.doc.nodeAt(ctx.nodePos);
          if (node && node.type.name === 'codeBlock') {
            const newContent = lastValueRef.current;
            if (node.textContent !== newContent) {
              const tr = view.state.tr;
              const start = ctx.nodePos + 1;
              const end = ctx.nodePos + node.nodeSize - 1;
              if (newContent) {
                tr.replaceWith(start, end, view.state.schema.text(newContent));
              } else {
                tr.delete(start, end);
              }
              view.dispatch(tr);
            }
            try {
              const focusPos = ctx.nodePos + 1;
              const selTr = view.state.tr.setSelection(
                TextSelection.create(view.state.doc, focusPos),
              );
              view.dispatch(selTr);
            } catch {
              // 节点几何已变(理论不可能 — overlay 期间 workspace 全 hidden)
            }
            view.focus();
          }
        }
      }
      clearCodeFullscreenContext();
    };
  }, []);

  // ── 分隔线拖拽(只 mermaid 路径下生效)──
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitRatioRef = useRef<number>(readSplitRatio());
  const draggingRef = useRef(false);

  const applySplitRatio = useCallback((ratio: number) => {
    const r = Math.max(0.15, Math.min(0.85, ratio));
    splitRatioRef.current = r;
    if (editorPaneRef.current) {
      editorPaneRef.current.style.flex = 'none';
      editorPaneRef.current.style.width = `${r * 100}%`;
    }
    if (previewPaneRef.current) {
      previewPaneRef.current.style.flex = 'none';
      previewPaneRef.current.style.width = `${(1 - r) * 100}%`;
    }
  }, []);

  useEffect(() => {
    if (isMermaid) applySplitRatio(splitRatioRef.current);
  }, [applySplitRatio, isMermaid]);

  useEffect(() => {
    if (!isMermaid) return;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      applySplitRatio(ratio);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem(LS_SPLIT, splitRatioRef.current.toString());
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [applySplitRatio, isMermaid]);

  const onDividerDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ── 通用 toolbar:Copy(纯文本)──
  const [copyJustSucceeded, setCopyJustSucceeded] = useState(false);
  const onCopyText = useCallback(() => {
    void navigator.clipboard.writeText(lastValueRef.current).then(() => {
      setCopyJustSucceeded(true);
      window.setTimeout(() => setCopyJustSucceeded(false), 1500);
    });
  }, []);

  // 当前语言显示;select 选项 = Plain Text + 所有已注册语言(含 mermaid)
  const langs: LanguageItem[] = codeApi.getLanguages();

  // ── 没有 context 的兜底 ──
  if (!ctxRef.current) {
    return (
      <div className="krig-code-fs">
        <div style={{ padding: 16, color: '#e57373' }}>
          CodeFullscreenPanel:缺少 context(需通过 setCodeFullscreenContext 触发)
        </div>
      </div>
    );
  }

  return (
    <div className="krig-code-fs">
      {/* 通用 toolbar(mermaid 也用这个;mermaid 自己的模板/方向/主题/下载/复制 SVG 在 PreviewPane 内) */}
      <div className="krig-code-fs__toolbar">
        <span className="krig-code-fs__title">
          {isMermaid ? 'Mermaid Editor' : 'Code Editor'}
        </span>

        {/* Language select(可切;选项 = Plain Text + 所有已注册语言) */}
        <select
          className="krig-code-fs__select"
          value={language}
          onChange={onLanguageSelectChange}
          title="切换语言"
        >
          <option value="">Plain Text</option>
          {langs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>

        <div className="krig-code-fs__spacer" />

        {/* mermaid 路径下,Copy 文本 vs Copy SVG/PNG 语义不同 — 通用 Copy 留给非 mermaid;
            mermaid 用户期望复制 SVG/PNG,由 PreviewPane 内的 Copy 按钮处理。
            因此 mermaid 路径下隐藏通用 Copy,避免按钮语义混淆 */}
        {!isMermaid && (
          <button
            type="button"
            className={
              'krig-code-fs__btn' + (copyJustSucceeded ? ' krig-code-fs__btn--ok' : '')
            }
            title="复制代码"
            onClick={onCopyText}
            dangerouslySetInnerHTML={{ __html: ICON_COPY }}
          />
        )}

        <span className="krig-code-fs__sep" />

        <button
          type="button"
          className="krig-code-fs__btn krig-code-fs__btn--close"
          title="关闭 (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* split:editor + (mermaid 时)preview */}
      <div className="krig-code-fs__split krig-mermaid-fs__split" ref={splitContainerRef}>
        <div
          className="krig-code-fs__pane krig-code-fs__pane--editor krig-mermaid-fs__pane--editor"
          ref={editorPaneRef}
        >
          {/* key={language} 在 language 变化时强制 unmount+mount 走新 loader;
              initialValue 用 lastValueRef.current(切语言时已保住当前内容,新 mount 不丢) */}
          <CodeHost
            key={language || 'plain'}
            initialValue={lastValueRef.current}
            language={language || undefined}
            theme="dark"
            onChange={onEditorChange}
            onMount={(handle) => {
              editorRef.current = handle;
            }}
          />
        </div>

        {isMermaid && (
          <>
            <div className="krig-code-fs__divider krig-mermaid-fs__divider" onMouseDown={onDividerDown} />
            <MermaidPreviewPane
              ref={previewPaneRef}
              source={source}
              onSourceChange={onSourceChange}
            />
          </>
        )}
      </div>
    </div>
  );
}
