/**
 * MermaidFullscreenPanel — V2 fullscreen-overlay 体系下的 Mermaid 全屏编辑器
 *
 * 触发链(见 [[menu-context]]):
 *   node-view 全屏按钮 mousedown
 *     → setMermaidFullscreenContext({ instanceId, nodePos })
 *     → fullscreenOverlayController.show('text-editing.fullscreen.mermaid')
 *     → FullscreenOverlayBinding 渲染 MermaidFullscreenPanel
 *
 * 关闭路径(× 按钮 / Esc / 业务方主动 controller.hide())统一收敛到 unmount:
 *   → Binding unmount Component
 *   → useEffect cleanup 执行
 *   → 一次性 diff 写回 PM + clearContext + 恢复 dark theme
 *
 * 关键设计:
 * - **CM 用 useRef + forwardRef,React 不重渲 CM**
 * - **预览 source / theme 用 React state,变更时 MermaidPreview 内部 300ms 防抖**
 * - **splitRatio 用 localStorage 持久;拖动时直接改 inline style(避免每帧 setState)**
 * - **单 cleanup 写回**(不需要 writeBackDoneRef):新 fullscreen-overlay binding 只
 *   有一条关闭路径(controller.hide → Binding unmount Component → cleanup),不存在
 *   旧 popup 的"点外绕过 onClose 直接 hide"问题
 *
 * 与 fullscreen-overlay 父容器的关系:
 * - 父 .krig-fullscreen-overlay 已 position:fixed inset:0 + flex column
 * - 本 Panel 自身 flex:1(由 .krig-mermaid-fs class 自管)填满父
 * - 不需要 position:fixed / onMouseDown stopPropagation / Esc handler
 *   (这些 binding 已统一处理)
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { FullscreenOverlayCloseProps }
  from '@slot/interaction-registries/fullscreen-overlay-registry/types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi, CodeEditingHandle } from '@capabilities/code-editing/types';
import { instanceRegistry } from '../../../instance-registry';
import {
  buildMermaidConfig,
  getMermaidModule,
  type MermaidTheme,
} from '../mermaid-renderer';
import { downloadBlob, downloadText } from '../save-blob';
import {
  getMermaidFullscreenContext,
  clearMermaidFullscreenContext,
} from './menu-context';
import {
  MermaidPreview,
  type MermaidPreviewHandle,
  type RenderStatus,
} from './MermaidPreview';
import { MermaidToolbar, type ExportFormat } from './MermaidToolbar';
import './mermaid-fullscreen.css';

const LS_SPLIT = 'krig-mermaid-fs-split-ratio';
const LS_THEME = 'krig-mermaid-fs-theme';
const VALID_THEMES: readonly MermaidTheme[] = ['dark', 'default', 'forest', 'neutral', 'base'];

function readSplitRatio(): number {
  const raw = parseFloat(localStorage.getItem(LS_SPLIT) || '0.5');
  if (isNaN(raw)) return 0.5;
  return Math.max(0.15, Math.min(0.85, raw));
}

function readInitialTheme(): MermaidTheme {
  const raw = localStorage.getItem(LS_THEME) as MermaidTheme | null;
  if (raw && (VALID_THEMES as readonly string[]).includes(raw)) {
    return raw;
  }
  return 'dark';
}

function svgToPngBlob(svgEl: SVGElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    const clone = svgEl.cloneNode(true) as SVGElement;
    const vb = svgEl.getAttribute('viewBox');
    if (vb) {
      const p = vb.split(/\s+/).map(Number);
      clone.setAttribute('width', String(p[2] || 800));
      clone.setAttribute('height', String(p[3] || 600));
    }
    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUri =
      'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = (img.naturalWidth || 800) * 2;
      canvas.height = (img.naturalHeight || 600) * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => resolve(b), 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

function svgWithBg(svgEl: SVGElement): string {
  const clone = svgEl.cloneNode(true) as SVGElement;
  const existingRect = clone.querySelector('rect');
  if (!existingRect) {
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#1e1e1e');
    clone.insertBefore(bg, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

export function MermaidFullscreenPanel({ onClose }: FullscreenOverlayCloseProps) {
  // ── mount 时一次性读取 context + 初始内容 ──
  const ctxRef = useRef(getMermaidFullscreenContext());
  // Phase 2:editorRef 通过 code-editing capability Host 的 onMount 回调拿 handle
  const editorRef = useRef<CodeEditingHandle | null>(null);
  const previewRef = useRef<MermaidPreviewHandle | null>(null);

  // Phase 2:Host 来自 code-editing capability(单点屏障核心 — @codemirror/* import 收敛)
  const CodeHost = requireCapabilityApi<CodeEditingApi>('code-editing').Host;

  const initialCodeRef = useRef<string>('');
  if (!initialCodeRef.current && ctxRef.current) {
    const inst = instanceRegistry.get(ctxRef.current.instanceId);
    const node = inst?.view.state.doc.nodeAt(ctxRef.current.nodePos);
    initialCodeRef.current = node?.textContent ?? '';
  }

  // **关键**:lastValueRef 镜像 CM 当前内容。React unmount 时子组件
  // (code-editing capability 的 CodeHost)的 cleanup 先于本 Panel 的 cleanup 执行
  // → CM view.destroy() → editorRef.current?.getValue() 返回 ''(SDK 已死)。
  // 如果 cleanup 用 getValue 拿 newContent 会拿到 '' → tr.delete 把内容清空。
  // 解法:onChange 时同步更新 lastValueRef,cleanup 用本 ref 而非 imperative
  // API,即使 CM 已 destroy 也能拿到最后一次正确内容。
  // 详见 memory feedback_react_unmount_child_cleanup_order。
  const lastValueRef = useRef<string>(initialCodeRef.current);

  // ── React state ──
  const [source, setSource] = useState<string>(initialCodeRef.current);
  const [theme, setTheme] = useState<MermaidTheme>(readInitialTheme);
  const [scale, setScale] = useState<number>(1);
  const [downloadFormat, setDownloadFormat] = useState<ExportFormat>('PNG');
  const [copyFormat, setCopyFormat] = useState<ExportFormat>('PNG');
  const [copyJustSucceeded, setCopyJustSucceeded] = useState(false);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>({ state: 'idle' });

  // theme 用 ref 镜像,unmount cleanup 时读最新值(避免闭包陈旧)
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // theme 持久
  useEffect(() => {
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  // ── unmount cleanup:diff 写回 + 清 context + 恢复 dark theme ──
  // 三条关闭路径(× / Esc / 业务方主动)统一走 binding hide → unmount → cleanup,
  // 无双重路径所以无需 writeBackDoneRef 防重入。
  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      if (ctx) {
        const inst = instanceRegistry.get(ctx.instanceId);
        if (inst) {
          const view = inst.view;
          const node = view.state.doc.nodeAt(ctx.nodePos);
          if (node && node.type.name === 'codeBlock') {
            // 用 lastValueRef 而非 editorRef.getValue() — 子组件 cleanup 先跑
            // 已 destroy CM,getValue 返回 '' 会让 tr.delete 把 codeBlock 清空
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
            // 光标回 codeBlock 内
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
      // 恢复 dark theme:渲染单例避免污染 inline 预览
      if (themeRef.current !== 'dark') {
        void getMermaidModule().then((mm) => mm?.initialize?.(buildMermaidConfig('dark')));
      }
      clearMermaidFullscreenContext();
    };
  }, []);

  // ── 分隔线拖拽 ──
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
    applySplitRatio(splitRatioRef.current);
  }, [applySplitRatio]);

  useEffect(() => {
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
  }, [applySplitRatio]);

  const onDividerDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ── 工具栏 callback ──
  const onTemplateInsert = useCallback((tplCode: string) => {
    editorRef.current?.setValue(tplCode);
    setSource(tplCode);
  }, []);

  const onDirectionChange = useCallback((dir: 'TB' | 'LR' | 'RL' | 'BT') => {
    const cur = editorRef.current?.getValue() ?? '';
    const replaced = cur.replace(/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/m, `$1 ${dir}`);
    if (replaced !== cur) {
      editorRef.current?.setValue(replaced);
      setSource(replaced);
    }
  }, []);

  const onDownload = useCallback(() => {
    const svgEl = previewRef.current?.getSvgEl();
    if (!svgEl) return;
    if (downloadFormat === 'PNG') {
      void svgToPngBlob(svgEl).then((blob) => {
        if (blob) downloadBlob(blob, 'mermaid-diagram.png');
      });
    } else {
      const svgData = svgWithBg(svgEl);
      downloadText(svgData, 'mermaid-diagram.svg', 'image/svg+xml');
    }
  }, [downloadFormat]);

  const flashCopyOk = useCallback(() => {
    setCopyJustSucceeded(true);
    window.setTimeout(() => setCopyJustSucceeded(false), 1500);
  }, []);

  const onCopy = useCallback(() => {
    const svgEl = previewRef.current?.getSvgEl();
    if (!svgEl) return;
    if (copyFormat === 'SVG') {
      const svgData = new XMLSerializer().serializeToString(svgEl);
      void navigator.clipboard.writeText(svgData).then(flashCopyOk).catch(() => {});
    } else {
      void svgToPngBlob(svgEl).then(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          flashCopyOk();
        } catch {
          // 剪贴板权限或 ClipboardItem 不可用,静默
        }
      });
    }
  }, [copyFormat, flashCopyOk]);

  const onFit = useCallback(() => setScale(1), []);
  const onZoomIn = useCallback(
    () => setScale((s) => Math.min(5, Math.round((s + 0.1) * 100) / 100)),
    [],
  );
  const onZoomOut = useCallback(
    () => setScale((s) => Math.max(0.1, Math.round((s - 0.1) * 100) / 100)),
    [],
  );
  const onScaleInput = useCallback((percent: number) => {
    setScale(Math.max(0.1, Math.min(5, percent / 100)));
  }, []);

  // 编辑器内容变化 → source state(MermaidPreview 内部 300ms 防抖)
  // + 同步 lastValueRef(cleanup 写回唯一可靠数据源,CM 子组件 cleanup 先跑会
  //   destroy CM 让 imperative getValue 拿不到)
  const onEditorChange = useCallback((v: string) => {
    lastValueRef.current = v;
    setSource(v);
  }, []);

  // ── 没有 context 的兜底(防御保护,理论不会发生)──
  if (!ctxRef.current) {
    return (
      <div className="krig-mermaid-fs">
        <div style={{ padding: 16, color: '#e57373' }}>
          MermaidFullscreenPanel:缺少 context(需通过 setMermaidFullscreenContext 触发)
        </div>
      </div>
    );
  }

  return (
    <div className="krig-mermaid-fs">
      <MermaidToolbar
        theme={theme}
        onThemeChange={setTheme}
        onTemplateInsert={onTemplateInsert}
        onDirectionChange={onDirectionChange}
        downloadFormat={downloadFormat}
        onDownloadFormatChange={setDownloadFormat}
        onDownload={onDownload}
        copyFormat={copyFormat}
        onCopyFormatChange={setCopyFormat}
        onCopy={onCopy}
        copyJustSucceeded={copyJustSucceeded}
        scale={scale}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
        onScaleInput={onScaleInput}
        onClose={onClose}
      />

      <div className="krig-mermaid-fs__split" ref={splitContainerRef}>
        <div className="krig-mermaid-fs__pane krig-mermaid-fs__pane--editor" ref={editorPaneRef}>
          <CodeHost
            initialValue={initialCodeRef.current}
            language="mermaid"
            theme="dark"
            onChange={onEditorChange}
            onMount={(handle) => {
              editorRef.current = handle;
            }}
          />
        </div>
        <div className="krig-mermaid-fs__divider" onMouseDown={onDividerDown} />
        <div className="krig-mermaid-fs__pane krig-mermaid-fs__pane--preview" ref={previewPaneRef}>
          <MermaidPreview
            ref={previewRef}
            source={source}
            theme={theme}
            scale={scale}
            onStatusChange={setRenderStatus}
          />
        </div>
      </div>

      <div
        className={
          'krig-mermaid-fs__status' +
          (renderStatus.state === 'ok' ? ' krig-mermaid-fs__status--ok' : '') +
          (renderStatus.state === 'error' ? ' krig-mermaid-fs__status--error' : '')
        }
      >
        {renderStatus.state === 'ok' && '✓ 渲染成功'}
        {renderStatus.state === 'error' && renderStatus.message}
      </div>
    </div>
  );
}
