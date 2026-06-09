/**
 * MermaidPreviewPane — 全屏右侧 mermaid 预览面板(Phase 3 抽出)
 *
 * 从原 MermaidFullscreenPanel 抽出的 mermaid 特化部分:
 * - 顶部 mermaid 局部工具栏(模板下拉 / 方向切换 / 主题切换 / PNG-SVG 下载 / PNG-SVG 复制 / Fit + 缩放)
 * - 中间 MermaidPreview(渲染 SVG)
 * - 底部状态栏(idle / ok / error)
 *
 * 不含的(已交给父 CodeFullscreenPanel 通用 toolbar):
 * - × 关闭按钮
 * - Language select
 * - 通用纯文本 Copy(mermaid Copy 是 SVG/PNG 语义,留在本组件)
 *
 * 与父的交互契约:
 * - 父传 source(CodeHost 的实时内容)+ onSourceChange(template / direction 切换需写回 CodeHost)
 * - 父持有 editor handle;direction / template 切换调 父.setValue 写回 editor → editor 触发
 *   onChange → 父 setSource → 本组件 props.source 变 → MermaidPreview 重渲(300ms 防抖)
 *
 * 样式:沿用原 .krig-mermaid-fs__* 类(mermaid-fullscreen.css 未瘦身 Phase 4 再做)。
 */

import { forwardRef, useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  MERMAID_THEMES,
  MERMAID_TEMPLATES,
  buildMermaidConfig,
  getMermaidModule,
  type MermaidTheme,
} from '../mermaid-renderer';
import { downloadBlob, downloadText } from '../save-blob';
import {
  MermaidPreview,
  type MermaidPreviewHandle,
  type RenderStatus,
} from './MermaidPreview';

const LS_THEME = 'krig-mermaid-fs-theme';
const LS_SCALE = 'krig-mermaid-fs-scale';
const VALID_THEMES: readonly MermaidTheme[] = ['dark', 'default', 'forest', 'neutral', 'base'];

/**
 * 读上次手动调整后的缩放(全局共用,所有图共享一份)。
 * 返回 null 表示「无记忆」—— 首帧应按宽度铺满,而非 100%。
 */
function readStoredScale(): number | null {
  const raw = localStorage.getItem(LS_SCALE);
  if (raw === null) return null;
  const v = parseFloat(raw);
  if (isNaN(v) || v < 0.1 || v > 5) return null;
  return v;
}

const DIRECTIONS = ['TB', 'LR', 'RL', 'BT'] as const;
type Direction = (typeof DIRECTIONS)[number];

export type ExportFormat = 'PNG' | 'SVG';

const ICON_DOWNLOAD =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_CLIPBOARD =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>';
const ICON_FIT =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';

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
    const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
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

export interface MermaidPreviewPaneProps {
  /** 当前 mermaid 源(父级 CodeHost 持有真值,通过 onChange 同步 — 用作 preview 渲染 + template/direction 重写后写回) */
  source: string;
  /** 父级通知 — template/direction 切换后用户期望写回 CodeHost(再 onChange 回流) */
  onSourceChange: (newSource: string) => void;
}

export const MermaidPreviewPane = forwardRef<HTMLDivElement, MermaidPreviewPaneProps>(
  function MermaidPreviewPane({ source, onSourceChange }, ref) {
  const previewRef = useRef<MermaidPreviewHandle | null>(null);

  const [theme, setTheme] = useState<MermaidTheme>(readInitialTheme);
  // 初始 scale:有记忆→用记忆值;无记忆→先占位 1,首帧渲染后按宽度铺满覆盖
  const [scale, setScale] = useState<number>(() => readStoredScale() ?? 1);
  // 是否已对本次全屏会话应用过「初始 scale」(记忆恢复 or 首帧 fit-width)——只跑一次
  const initialScaleAppliedRef = useRef(readStoredScale() !== null);
  const [downloadFormat, setDownloadFormat] = useState<ExportFormat>('PNG');
  const [copyFormat, setCopyFormat] = useState<ExportFormat>('PNG');
  const [copyJustSucceeded, setCopyJustSucceeded] = useState(false);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>({ state: 'idle' });
  const [zoomEditing, setZoomEditing] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');

  // theme 用 ref 镜像,unmount cleanup 时读最新值(避免闭包陈旧)
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // theme 持久 + 恢复 dark theme 单例(unmount 时跑 — 避免污染 inline 预览)
  useEffect(() => {
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);
  useEffect(() => {
    return () => {
      if (themeRef.current !== 'dark') {
        void getMermaidModule().then((mm) => mm?.initialize?.(buildMermaidConfig('dark')));
      }
    };
  }, []);

  // ── callbacks ──
  const handleTemplate = (e: FormEvent<HTMLSelectElement>) => {
    const v = (e.currentTarget as HTMLSelectElement).value;
    const tpl = MERMAID_TEMPLATES.find((t) => t.label === v);
    if (tpl) onSourceChange(tpl.code);
    e.currentTarget.value = 'Template...';
  };
  const handleTheme = (e: FormEvent<HTMLSelectElement>) => {
    setTheme(e.currentTarget.value as MermaidTheme);
  };
  const handleDirection = (e: FormEvent<HTMLSelectElement>) => {
    const dir = e.currentTarget.value as Direction;
    const replaced = source.replace(/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)/m, `$1 ${dir}`);
    if (replaced !== source) onSourceChange(replaced);
  };

  const flashCopyOk = useCallback(() => {
    setCopyJustSucceeded(true);
    window.setTimeout(() => setCopyJustSucceeded(false), 1500);
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

  // 用户手动调整后:记忆该值(全局共用),并标记初始 scale 已定(阻止 fit-width 再覆盖)
  const persistScale = useCallback((s: number) => {
    initialScaleAppliedRef.current = true;
    localStorage.setItem(LS_SCALE, String(s));
  }, []);

  // 「适应屏幕」= 按宽度铺满当前预览区(并记忆)
  const onFit = useCallback(() => {
    const fit = previewRef.current?.computeFitWidthScale();
    const next = fit && fit > 0 ? Math.max(0.1, Math.min(5, fit)) : 1;
    setScale(next);
    persistScale(next);
  }, [persistScale]);
  const onZoomIn = useCallback(() => {
    setScale((s) => {
      const next = Math.min(5, Math.round((s + 0.1) * 100) / 100);
      persistScale(next);
      return next;
    });
  }, [persistScale]);
  const onZoomOut = useCallback(() => {
    setScale((s) => {
      const next = Math.max(0.1, Math.round((s - 0.1) * 100) / 100);
      persistScale(next);
      return next;
    });
  }, [persistScale]);
  const startZoomEdit = () => {
    setZoomInputValue(String(Math.round(scale * 100)));
    setZoomEditing(true);
  };
  const commitZoom = () => {
    const v = parseInt(zoomInputValue, 10);
    if (!isNaN(v) && v > 0) {
      const next = Math.max(0.1, Math.min(5, v / 100));
      setScale(next);
      persistScale(next);
    }
    setZoomEditing(false);
  };

  // 首帧渲染回调:无记忆时按宽度铺满(只跑一次;之后任何手动调整都跳过)
  const handleRendered = useCallback(() => {
    if (initialScaleAppliedRef.current) return;
    const fit = previewRef.current?.computeFitWidthScale();
    if (fit && fit > 0) {
      initialScaleAppliedRef.current = true;
      setScale(Math.max(0.1, Math.min(5, fit)));
    }
  }, []);

  /** 点 .label 切格式 / 点其他位置触发动作 — 同 V1 / 原 MermaidToolbar 语义 */
  const isLabelClick = (e: ReactMouseEvent<HTMLButtonElement>): boolean => {
    const target = e.target as HTMLElement;
    return !!target.closest('.krig-mermaid-fs__btn-label');
  };

  const handleDownloadClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (isLabelClick(e)) {
      e.stopPropagation();
      setDownloadFormat((cur) => (cur === 'PNG' ? 'SVG' : 'PNG'));
      return;
    }
    onDownload();
  };
  const handleCopyClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (isLabelClick(e)) {
      e.stopPropagation();
      setCopyFormat((cur) => (cur === 'PNG' ? 'SVG' : 'PNG'));
      return;
    }
    onCopy();
  };

  return (
    <div
      ref={ref}
      className="krig-code-fs__pane krig-code-fs__pane--preview krig-mermaid-fs__pane--preview"
    >
      {/* mermaid 局部工具栏(与父通用 toolbar 区分 — mermaid-specific 操作放这里) */}
      <div className="krig-mermaid-fs__toolbar krig-mermaid-fs__toolbar--preview">
        <select
          className="krig-mermaid-fs__select"
          defaultValue="Template..."
          onChange={handleTemplate}
          title="插入图表模板"
        >
          <option value="Template...">Template...</option>
          {MERMAID_TEMPLATES.map((t) => (
            <option key={t.label} value={t.label}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          className="krig-mermaid-fs__select"
          value={theme}
          onChange={handleTheme}
          title="预览主题"
        >
          {MERMAID_THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          className="krig-mermaid-fs__select"
          defaultValue="TB"
          onChange={handleDirection}
          title="流程方向"
        >
          {DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <div className="krig-mermaid-fs__spacer" />

        <button
          type="button"
          className="krig-mermaid-fs__btn krig-mermaid-fs__btn--labeled"
          title="下载(点 PNG/SVG 切格式)"
          onClick={handleDownloadClick}
        >
          <span
            className="krig-mermaid-fs__btn-icon"
            dangerouslySetInnerHTML={{ __html: ICON_DOWNLOAD }}
          />
          <span className="krig-mermaid-fs__btn-label">{downloadFormat}</span>
        </button>

        <button
          type="button"
          className={
            'krig-mermaid-fs__btn krig-mermaid-fs__btn--labeled' +
            (copyJustSucceeded ? ' krig-mermaid-fs__btn--ok' : '')
          }
          title="复制(点 PNG/SVG 切格式)"
          onClick={handleCopyClick}
        >
          <span
            className="krig-mermaid-fs__btn-icon"
            dangerouslySetInnerHTML={{ __html: ICON_CLIPBOARD }}
          />
          <span className="krig-mermaid-fs__btn-label">{copyFormat}</span>
        </button>

        <span className="krig-mermaid-fs__sep" />

        <button
          type="button"
          className="krig-mermaid-fs__btn"
          title="适应屏幕"
          onClick={onFit}
          dangerouslySetInnerHTML={{ __html: ICON_FIT }}
        />

        <div className="krig-mermaid-fs__zoom">
          <button
            type="button"
            className="krig-mermaid-fs__zoom-btn"
            title="缩小"
            onClick={onZoomOut}
          >
            −
          </button>
          {zoomEditing ? (
            <input
              type="text"
              className="krig-mermaid-fs__zoom-input"
              value={zoomInputValue}
              autoFocus
              onChange={(e) => setZoomInputValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitZoom();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setZoomEditing(false);
                }
                e.stopPropagation();
              }}
              onBlur={commitZoom}
            />
          ) : (
            <button
              type="button"
              className="krig-mermaid-fs__zoom-label"
              title="点击输入数值"
              onClick={startZoomEdit}
            >
              {Math.round(scale * 100)}%
            </button>
          )}
          <button
            type="button"
            className="krig-mermaid-fs__zoom-btn"
            title="放大"
            onClick={onZoomIn}
          >
            +
          </button>
        </div>
      </div>

      {/* preview body */}
      <MermaidPreview
        ref={previewRef}
        source={source}
        theme={theme}
        scale={scale}
        onStatusChange={setRenderStatus}
        onRendered={handleRendered}
      />

      {/* 状态栏(idle / ok / error) */}
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
  },
);
