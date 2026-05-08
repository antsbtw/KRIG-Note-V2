/**
 * FileTab — LinkPanel 文件 Tab(L5-B3.15)
 *
 * V1 → V2 直迁:src/plugins/note/components/LinkPanel.tsx FileTab 部分
 *
 * 双模式:
 * - import(default):FileReader → mediaPutBase64 → href = `media://...`(自包含)
 * - link            :electronAPI.getFilePath → href = `file://...`(不复制,断链风险)
 *
 * V1 → V2 改造:
 * - V1 用 dialog.showOpenDialog 拿绝对路径 — V2 走 `<input type="file">` + B3.14
 *   getFilePath(webUtils.getPathForFile)
 * - V1 mediaPutFile IPC — V2 直接 FileReader 转 base64 + 已有 mediaPutBase64
 * - 失败提示走 inline 红字(对齐 B3.14 externalRef 决策 Q4)
 */

import { useEffect, useRef, useState } from 'react';
import { mediaPutBase64 } from '@storage/media-store';

interface FileTabProps {
  onApply: (href: string) => void;
  onClose: () => void;
}

type FileMode = 'link' | 'import';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fileToFileHref(file: File): string {
  const p = window.electronAPI?.getFilePath?.(file) || '';
  if (!p) return '';
  // POSIX 路径编码(本阶段 macOS-only,Windows 留 issue)
  const enc = p.split('/').map((s) => (s ? encodeURIComponent(s) : '')).join('/');
  return `file://${enc}`;
}

export function FileTab({ onApply, onClose }: FileTabProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [mode, setMode] = useState<FileMode>('import');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 让容器接收 keydown(Esc 关闭 / Enter 确认)
  useEffect(() => {
    containerRef.current?.focus();
  }, [pickedFile]);

  function pickFile(): void {
    setError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) setPickedFile(f);
    });
    input.click();
  }

  async function confirm(): Promise<void> {
    if (!pickedFile) return;
    setError(null);

    if (mode === 'link') {
      const href = fileToFileHref(pickedFile);
      if (!href) {
        setError('无法解析文件路径(可能是 Blob 来源)。请改用"导入到媒体库"模式。');
        return;
      }
      onApply(href);
      return;
    }

    // import 模式
    setImporting(true);
    try {
      const dataUrl = await readFileAsDataUrl(pickedFile);
      const r = await mediaPutBase64(
        dataUrl,
        pickedFile.type || 'application/octet-stream',
        pickedFile.name,
      );
      if (r.success && r.mediaUrl) {
        onApply(r.mediaUrl);
      } else {
        setError(`导入失败:${r.error || '未知错误'}`);
      }
    } catch (err) {
      setError(`读取文件失败:${String(err)}`);
    } finally {
      setImporting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && pickedFile && !importing) {
      e.preventDefault();
      void confirm();
    }
  }

  if (!pickedFile) {
    return (
      <div
        ref={containerRef}
        className="krig-link-panel__file-tab"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="krig-link-panel__file-pick-row">
          <button
            type="button"
            className="krig-link-panel__file-pick-btn"
            onClick={pickFile}
          >
            📂 选择文件...
          </button>
        </div>
        <div className="krig-link-panel__hint">选好文件后可选"链接 / 导入"</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="krig-link-panel__file-tab"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="krig-link-panel__file-name">📎 {pickedFile.name}</div>
      <div className="krig-link-panel__file-path">
        {window.electronAPI?.getFilePath?.(pickedFile) || '(Blob 来源,无路径)'}
      </div>

      <label className="krig-link-panel__radio-label">
        <input
          type="radio"
          name="krig-link-panel__file-mode"
          checked={mode === 'import'}
          onChange={() => setMode('import')}
        />
        <span>导入到媒体库(复制一份,自包含)</span>
      </label>
      <label className="krig-link-panel__radio-label">
        <input
          type="radio"
          name="krig-link-panel__file-mode"
          checked={mode === 'link'}
          onChange={() => setMode('link')}
        />
        <span>链接到原文件(不复制,文件移动会断链)</span>
      </label>

      {error && <div className="krig-link-panel__error">{error}</div>}

      <div className="krig-link-panel__file-actions">
        <button
          type="button"
          className="krig-link-panel__file-secondary-btn"
          onClick={() => {
            setPickedFile(null);
            setError(null);
          }}
        >
          重选
        </button>
        <button
          type="button"
          className="krig-link-panel__file-confirm-btn"
          onClick={() => void confirm()}
          disabled={importing}
        >
          {importing ? '导入中...' : '确认'}
        </button>
      </div>
    </div>
  );
}
