/**
 * 浏览器端 Blob/文本下载 (mermaid 导出用)
 *
 * V2 没有 Electron save-dialog IPC,改走 <a download> 触发浏览器下载弹窗。
 * V1 走 viewAPI.fileSaveDialog,体验略好(用户可选目录),但本期不引入 IPC。
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mimeType = 'image/svg+xml'): void {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(blob, filename);
}
