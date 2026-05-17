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
 * - language 切换:Phase 3 v1 不支持全屏内切语言(D8 拍板 + complexity 收敛);Language
 *   select 显示当前语言只读;如果用户期望切语言,关闭全屏 → inline 切 → 重开
 *   (避免复杂的 CodeHost 重 mount + 语言验证 + PM attrs 同步链)
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
import { getLanguageLabel } from '../lang-dropdown';
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

  const language = ctxRef.current?.language ?? '';
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

  // 当前语言显示
  const langs: LanguageItem[] = codeApi.getLanguages();
  const langLabel = getLanguageLabel(language);

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

        {/* Language select(Phase 3 v1 只读显示;切语言走 inline toolbar) */}
        <select
          className="krig-code-fs__select"
          value={language}
          disabled
          title="语言切换请在 inline toolbar 内操作"
        >
          <option value={language}>{langLabel}</option>
          {/* 兜底:列出已注册语言(disabled 状态下浏览器仍渲;disabled 时点击无效) */}
          {langs.map((l) =>
            l.id === language ? null : (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ),
          )}
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
          <CodeHost
            initialValue={initialCodeRef.current}
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
