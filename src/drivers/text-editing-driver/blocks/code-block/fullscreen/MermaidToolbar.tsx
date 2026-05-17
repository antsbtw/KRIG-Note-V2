/**
 * MermaidToolbar — 全屏顶部工具栏
 *
 * 包含:
 * - Template 下拉(选模板插入)
 * - Theme 下拉(切预览主题)
 * - 方向下拉(改 graph/flowchart 方向标记)
 * - 下载按钮(点图标主体下载,点 PNG/SVG 标签切格式)
 * - 复制按钮(同上语义)
 * - Fit(scale=1) + 缩放控件(− / 100% / +)
 * - × 关闭
 *
 * 所有按钮用 React JSX <button>,合成事件 — 不手工 addEventListener。
 * V1 的"点标签切格式 vs 点主体触发动作"语义靠 e.target.closest('.label') 区分。
 */

import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useState } from 'react';
import {
  MERMAID_THEMES,
  MERMAID_TEMPLATES,
  type MermaidTheme,
} from '../mermaid-renderer';

const ICON_DOWNLOAD =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const ICON_CLIPBOARD =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>';
const ICON_FIT =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';

const DIRECTIONS = ['TB', 'LR', 'RL', 'BT'] as const;
type Direction = (typeof DIRECTIONS)[number];

export type ExportFormat = 'PNG' | 'SVG';

interface MermaidToolbarProps {
  theme: MermaidTheme;
  onThemeChange: (theme: MermaidTheme) => void;

  onTemplateInsert: (templateCode: string) => void;
  onDirectionChange: (dir: Direction) => void;

  downloadFormat: ExportFormat;
  onDownloadFormatChange: (format: ExportFormat) => void;
  onDownload: () => void;

  copyFormat: ExportFormat;
  onCopyFormatChange: (format: ExportFormat) => void;
  onCopy: () => void;
  copyJustSucceeded: boolean;

  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onScaleInput: (percent: number) => void;

  onClose: () => void;
}

export function MermaidToolbar(props: MermaidToolbarProps) {
  const {
    theme,
    onThemeChange,
    onTemplateInsert,
    onDirectionChange,
    downloadFormat,
    onDownloadFormatChange,
    onDownload,
    copyFormat,
    onCopyFormatChange,
    onCopy,
    copyJustSucceeded,
    scale,
    onZoomIn,
    onZoomOut,
    onFit,
    onScaleInput,
    onClose,
  } = props;

  const [zoomEditing, setZoomEditing] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');

  const handleTemplate = (e: FormEvent<HTMLSelectElement>) => {
    const v = (e.currentTarget as HTMLSelectElement).value;
    const tpl = MERMAID_TEMPLATES.find((t) => t.label === v);
    if (tpl) onTemplateInsert(tpl.code);
    // reset to placeholder so user can re-pick same template
    e.currentTarget.value = 'Template...';
  };

  const handleTheme = (e: FormEvent<HTMLSelectElement>) => {
    onThemeChange(e.currentTarget.value as MermaidTheme);
  };

  const handleDirection = (e: FormEvent<HTMLSelectElement>) => {
    onDirectionChange(e.currentTarget.value as Direction);
  };

  /** 点 .label 切格式 / 点其他位置触发动作 — 同 V1 语义 */
  const isLabelClick = (e: ReactMouseEvent<HTMLButtonElement>): boolean => {
    const target = e.target as HTMLElement;
    return !!target.closest('.krig-mermaid-fs__btn-label');
  };

  const handleDownloadClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (isLabelClick(e)) {
      e.stopPropagation();
      onDownloadFormatChange(downloadFormat === 'PNG' ? 'SVG' : 'PNG');
      return;
    }
    onDownload();
  };

  const handleCopyClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (isLabelClick(e)) {
      e.stopPropagation();
      onCopyFormatChange(copyFormat === 'PNG' ? 'SVG' : 'PNG');
      return;
    }
    onCopy();
  };

  const startZoomEdit = () => {
    setZoomInputValue(String(Math.round(scale * 100)));
    setZoomEditing(true);
  };

  const commitZoom = () => {
    const v = parseInt(zoomInputValue, 10);
    if (!isNaN(v) && v > 0) onScaleInput(v);
    setZoomEditing(false);
  };

  return (
    <div className="krig-mermaid-fs__toolbar">
      <span className="krig-mermaid-fs__title">Mermaid Editor</span>

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

      <span className="krig-mermaid-fs__sep" />

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

      <span className="krig-mermaid-fs__sep" />

      <button
        type="button"
        className="krig-mermaid-fs__btn krig-mermaid-fs__btn--close"
        title="关闭 (Esc)"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
