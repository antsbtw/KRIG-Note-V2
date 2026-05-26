/**
 * sections/ExportSection — 导出三件套(全屏 LeftPanel)
 *
 * 复制 PNG / 下载 PNG / 下载 SVG
 *
 * 原 LeftPanel 把导出按钮塞进"工具" section 末尾(mv-fl-export-group);
 * 拆 section 后保留 mv-fl-export-group 类避免改动 CSS,
 * 容器复用 .mv-fl-section 减弱视觉割裂。
 */

import React from 'react';

interface ExportSectionProps {
  onExport: (mode: 'copy' | 'download') => void;
  onExportSvg: () => void;
}

export const ExportSection: React.FC<ExportSectionProps> = ({ onExport, onExportSvg }) => {
  return (
    <div className="mv-fl-section">
      <div className="mv-fl-export-group">
        <button className="mv-fl-action-btn" onClick={() => onExport('copy')}>
          📋 复制 PNG
        </button>
        <button className="mv-fl-action-btn" onClick={() => onExport('download')}>
          💾 下载 PNG
        </button>
        <button className="mv-fl-action-btn" onClick={onExportSvg}>
          🖼 下载 SVG
        </button>
      </div>
    </div>
  );
};
