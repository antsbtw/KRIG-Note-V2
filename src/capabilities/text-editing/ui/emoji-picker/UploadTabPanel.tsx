/**
 * UploadTabPanel — callout Upload tab(D024 §4.5)
 *
 * 字面架构同 IconsTabPanel:
 * - emoji picker popup 内一个 tab 子组件
 * - 父组件 EmojiPickerPanel 字面通过 `activeTab === 'upload'` 分支挂载
 * - 字面父组件传 onPick 回调(上传成功后回调 mediaUrl,父组件调 setCalloutImage)
 *
 * UI 字面三态:
 * - 未选文件:拖拽区 + "选择图片"按钮 + 支持格式提示
 * - 选中文件:预览缩略图 + 文件名 + "确认"/"重选"按钮
 * - 上传中:置灰所有按钮 + 按钮文字"上传中..."
 *
 * 错误形态字面 inline 红字(对齐 FileTab.tsx 既有模板)。
 *
 * 字面消费 media-storage capability(charter §1.1,不直 import @storage/*):
 *   requireCapabilityApi<MediaStorageApi>('media-storage').mediaPutBase64(...)
 */

import { useEffect, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MediaStorageApi } from '@capabilities/media-storage/types';

interface UploadTabPanelProps {
  onPick: (imageSrc: string) => void;
}

const ACCEPT_MIME = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function UploadTabPanel({ onPick }: UploadTabPanelProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 预览 URL 生命周期(字面 createObjectURL 必须 revoke 防内存泄漏)
  useEffect(() => {
    if (!pickedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pickedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pickedFile]);

  function pickFile(): void {
    setError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT_MIME;
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) setPickedFile(f);
    });
    input.click();
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setError(null);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError(`不支持的文件类型:${f.type || '未知'}`);
      return;
    }
    setPickedFile(f);
  }

  async function confirm(): Promise<void> {
    if (!pickedFile) return;
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(pickedFile);
      const mediaApi = requireCapabilityApi<MediaStorageApi>('media-storage');
      const r = await mediaApi.mediaPutBase64(
        dataUrl,
        pickedFile.type || 'application/octet-stream',
        pickedFile.name,
      );
      if (r.success && r.mediaUrl) {
        onPick(r.mediaUrl);
      } else {
        setError(`上传失败:${r.error || '未知错误'}`);
      }
    } catch (err) {
      setError(`读取文件失败:${String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  if (!pickedFile) {
    return (
      <div
        className={`krig-upload-tab ${isDragging ? 'krig-upload-tab--dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="krig-upload-tab__dropzone">
          <div className="krig-upload-tab__icon">🖼️</div>
          <div className="krig-upload-tab__hint">
            拖拽图片到此处,或
          </div>
          <button
            type="button"
            className="krig-upload-tab__pick-btn"
            onClick={pickFile}
          >
            选择图片
          </button>
          <div className="krig-upload-tab__formats">
            支持 PNG / JPEG / WEBP / GIF / SVG(最大 20 MB)
          </div>
        </div>
        {error && <div className="krig-upload-tab__error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="krig-upload-tab">
      <div className="krig-upload-tab__preview">
        {previewUrl && (
          <img
            src={previewUrl}
            alt={pickedFile.name}
            className="krig-upload-tab__preview-img"
          />
        )}
        <div className="krig-upload-tab__preview-name">{pickedFile.name}</div>
      </div>
      <div className="krig-upload-tab__actions">
        <button
          type="button"
          className="krig-upload-tab__confirm-btn"
          onClick={() => void confirm()}
          disabled={uploading}
        >
          {uploading ? '上传中...' : '确认'}
        </button>
        <button
          type="button"
          className="krig-upload-tab__reset-btn"
          onClick={() => {
            setError(null);
            setPickedFile(null);
          }}
          disabled={uploading}
        >
          重选
        </button>
      </div>
      {error && <div className="krig-upload-tab__error">{error}</div>}
    </div>
  );
}
