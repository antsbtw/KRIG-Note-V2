/**
 * OutlinePanel — 目录侧栏(L5-C3)
 *
 * V1 → V2 改写:src/plugins/ebook/components/OutlinePanel.tsx(99 行)。
 * 改动:接收 host 命令式 API 而不是直传 renderer — view 端不感知 renderer 细节,
 * 通过 hostRef.getTOC / hostRef.goToPage / hostRef.goToCFI 间接调。
 *
 * 样式使用 CSS 类(.krig-ebook-outline-panel*),在 ebook-rendering/styles.css 里。
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import type { TOCItem } from '../types';

export interface OutlinePanelHost {
  getTOC(): Promise<TOCItem[]>;
  goToPage(page: number): void;
  goToCFI(cfi: string): void;
}

interface OutlinePanelProps {
  host: OutlinePanelHost;
  /** EPUB 当前章节 label(用作高亮)*/
  currentChapter?: string;
  /** PDF 当前页(用作高亮)*/
  currentPage?: number;
  /** 触发 host.getTOC 的 token — 切书时变化即重新拉 TOC */
  reloadToken?: string | number;
  onClose: () => void;
}

export function OutlinePanel({
  host,
  currentChapter,
  currentPage,
  reloadToken,
  onClose,
}: OutlinePanelProps) {
  const [toc, setToc] = useState<TOCItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setToc([]);
    host
      .getTOC()
      .then((items) => {
        setToc(items);
        setLoading(false);
        const firstLevel = new Set<string>();
        items.forEach((_, i) => firstLevel.add(`root-${i}`));
        setExpanded(firstLevel);
      })
      .catch(() => setLoading(false));
  }, [host, reloadToken]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleClick = useCallback(
    (item: TOCItem) => {
      const pos = item.position;
      if (pos.type === 'page') host.goToPage(pos.page);
      else if (pos.type === 'cfi' && pos.cfi) host.goToCFI(pos.cfi);
    },
    [host],
  );

  const renderItems = (
    items: TOCItem[],
    depth: number,
    parentKey: string,
  ): ReactNode[] => {
    return items.map((item, index) => {
      const key = `${parentKey}-${index}`;
      const hasChildren = item.children && item.children.length > 0;
      const isExpanded = expanded.has(key);
      const page = item.position.type === 'page' ? item.position.page : null;
      const isCurrent = currentChapter
        ? item.label === currentChapter
        : currentPage && page
          ? page === currentPage
          : false;

      return (
        <div key={key}>
          <div
            className={`krig-ebook-outline-panel__item ${isCurrent ? 'krig-ebook-outline-panel__item--current' : ''}`}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => handleClick(item)}
          >
            {hasChildren ? (
              <span
                className="krig-ebook-outline-panel__toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(key);
                }}
              >
                {isExpanded ? '▾' : '▸'}
              </span>
            ) : (
              <span className="krig-ebook-outline-panel__toggle-placeholder" />
            )}
            <span className="krig-ebook-outline-panel__label">{item.label}</span>
            {page && <span className="krig-ebook-outline-panel__page">{page}</span>}
          </div>
          {hasChildren && isExpanded && renderItems(item.children!, depth + 1, key)}
        </div>
      );
    });
  };

  return (
    <div className="krig-ebook-outline-panel">
      <div className="krig-ebook-outline-panel__header">
        <span className="krig-ebook-outline-panel__title">目录</span>
        <button className="krig-ebook-outline-panel__close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="krig-ebook-outline-panel__content">
        {loading && (
          <div className="krig-ebook-outline-panel__placeholder">加载中...</div>
        )}
        {!loading && toc.length === 0 && (
          <div className="krig-ebook-outline-panel__placeholder">此文档没有目录</div>
        )}
        {!loading && toc.length > 0 && renderItems(toc, 0, 'root')}
      </div>
    </div>
  );
}
