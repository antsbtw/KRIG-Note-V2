/**
 * useFullscreen — 订阅窗口全屏状态
 *
 * 用于 WorkspaceBar 在全屏 / 非全屏时切换 Toggle 位置:
 * - 全屏:Toggle 紧贴最左(margin-left: 0)
 * - 非全屏:Toggle 让位 macOS 红绿灯(margin-left: 72px)
 */

import { useEffect, useState } from 'react';

export function useFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    // electronAPI 在 preload 暴露,可能 L0 早期未就绪 — 防御性检查
    if (!window.electronAPI?.onFullscreenChanged) return;
    const unsubscribe = window.electronAPI.onFullscreenChanged(setIsFullscreen);
    return unsubscribe;
  }, []);

  return isFullscreen;
}
