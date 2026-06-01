/**
 * WebTabBar — web view 内部 tab 栏(Phase 4 / Chrome 风格标签栏)
 *
 * 决策(实现包 §1):**单 tab 不显示 tab 栏;≥2 个 tab 才出现**,在工具栏上方。
 * 由 WebView 控制是否渲染(tabs.length >= 2),本组件只负责 UI + 回调。
 *
 * tab title(简化项):当前用 URL 的 host 部分当 label(没接 page-title-updated),
 * 留后续可加 onTitleChanged。
 */

import { useCallback } from 'react';
import type { WebTab } from './data-model';

interface WebTabBarProps {
  tabs: WebTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
}

/** 从 URL 取 host 当 label;失败回退原串截断 */
function tabLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || url;
  } catch {
    return url.length > 24 ? `${url.slice(0, 24)}…` : url;
  }
}

export function WebTabBar({ tabs, activeTabId, onSelect, onClose, onNewTab }: WebTabBarProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      onClose(tabId);
    },
    [onClose],
  );

  return (
    <div className="krig-web-tabbar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          className={
            'krig-web-tabbar__tab' +
            (tab.id === activeTabId ? ' krig-web-tabbar__tab--active' : '')
          }
          onClick={() => onSelect(tab.id)}
          title={tab.url}
        >
          <span className="krig-web-tabbar__title">{tabLabel(tab.url)}</span>
          <button
            type="button"
            className="krig-web-tabbar__close"
            onClick={(e) => handleClose(e, tab.id)}
            aria-label="关闭标签页"
            title="关闭标签页 (⌘W)"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="krig-web-tabbar__new"
        onClick={onNewTab}
        aria-label="新建标签页"
        title="新建标签页 (⌘T)"
      >
        +
      </button>
    </div>
  );
}
