/**
 * TocIndicator — note view 目录侧边面板
 *
 * 左侧有一条窄 hover 触发区;鼠标进入 → 滑出全量目录面板。
 * 顶部 H1/H2/H3/📖 4 按钮控制正文展开级别;主体可滚动 heading 列表。
 *
 * 数据源:text-editing capability.api.getTocHeadings(instanceId)
 * 订阅:capability.api.subscribeTocChange(instanceId, cb) — doc 变 / collapsed 变都触发
 * 点击 heading:capability.api.scrollToTocHeading(instanceId, pos)
 * 级别按钮:capability.api.expandHeadingsToLevel(instanceId, level)
 *
 * 与 V1 (src/plugins/note/toc/toc-indicator.ts) 的差异:
 *   - V1 imperative DOM + 直接持 EditorView;V2 React + 通过 capability api 间接驱动
 *   - V1 走 atom 索引(getAtoms);V2 直接用 pos(因 V2 doc 全量加载,无分片)
 *   - 折叠状态:V1 写 PM attrs.open 持久化;V2 仅存 plugin state(切笔记重置,决议拍板)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import './toc.css';

interface TocEntry {
  pos: number;
  level: 1 | 2 | 3;
  text: string;
}

interface TocIndicatorProps {
  /** PM 实例 id(NoteView 用 workspaceId 当 instanceId) */
  instanceId: string;
  /** text-editing capability(NoteView 已 requireCapabilityApi,直接传)*/
  textEditing: TextEditingApi;
}

const LEVELS = [
  { label: 'h1', value: 1, title: '只展开到 H1' },
  { label: 'h2', value: 2, title: '展开到 H2' },
  { label: 'h3', value: 3, title: '展开到 H3' },
  { label: '📖', value: Infinity, title: '全部展开' },
] as const;

export function TocIndicator({ instanceId, textEditing }: TocIndicatorProps) {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [expandLevel, setExpandLevel] = useState<number>(Infinity);
  const [panelVisible, setPanelVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ── 拉数据 ──
  const refresh = useCallback(() => {
    const next = textEditing.api.getTocHeadings(instanceId) as TocEntry[];
    setEntries(next);
    setExpandLevel(textEditing.api.getCurrentHeadingExpandLevel(instanceId));
  }, [instanceId, textEditing]);

  // 订阅:doc/collapsed 变化都触发 refresh
  useEffect(() => {
    refresh();
    const unsub = textEditing.api.subscribeTocChange(instanceId, refresh);
    return () => { unsub(); };
  }, [instanceId, textEditing, refresh]);

  // ── IntersectionObserver:跟踪当前可见 heading ──
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    if (entries.length === 0) return;

    // 滚动容器 = .krig-note-view(note.css line 8 overflow:auto)
    const scrollContainer = document.querySelector('.krig-note-view');
    if (!scrollContainer) return;

    const elToIdx = new WeakMap<Element, number>();
    const observer = new IntersectionObserver(
      (ioEntries) => {
        let bestIdx = -1;
        let bestTop = Infinity;
        for (const e of ioEntries) {
          if (!e.isIntersecting) continue;
          const idx = elToIdx.get(e.target) ?? -1;
          if (idx >= 0 && e.boundingClientRect.top < bestTop) {
            bestTop = e.boundingClientRect.top;
            bestIdx = idx;
          }
        }
        if (bestIdx >= 0) setActiveIndex(bestIdx);
      },
      { root: scrollContainer, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );

    // 用 DOM 选择器找 H1-H3 元素(按顺序匹配 entries)
    // NoteView 的 PM editor 容器是 .ProseMirror;按 DOM 顺序找前 N 个 h1/h2/h3
    const pm = document.querySelector('.krig-note-view .ProseMirror');
    if (pm) {
      const headingEls = pm.querySelectorAll('h1, h2, h3');
      for (let i = 0; i < Math.min(headingEls.length, entries.length); i++) {
        const el = headingEls[i];
        elToIdx.set(el, i);
        observer.observe(el);
      }
    }
    observerRef.current = observer;
    return () => { observer.disconnect(); };
  }, [entries]);

  // ── hover 隐藏延时 ──
  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);
  const scheduleHide = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = setTimeout(() => setPanelVisible(false), 200);
  }, [clearLeaveTimer]);

  useEffect(() => () => clearLeaveTimer(), [clearLeaveTimer]);

  // ── 事件 ──
  const onLevelClick = (level: number) => {
    textEditing.api.expandHeadingsToLevel(instanceId, level);
    // expandLevel 会通过 subscribeTocChange → refresh 同步,不在这里手动 setState
  };
  const onItemClick = (pos: number) => {
    textEditing.api.scrollToTocHeading(instanceId, pos);
  };

  return (
    <>
      <div
        className="toc-hotzone"
        onMouseEnter={() => { clearLeaveTimer(); setPanelVisible(true); }}
        onMouseLeave={scheduleHide}
      />
      <div
        className={`toc-panel${panelVisible ? ' toc-panel--visible' : ''}`}
        onMouseEnter={clearLeaveTimer}
        onMouseLeave={scheduleHide}
      >
        <div className="toc-panel__levels">
          {LEVELS.map((lv) => (
            <button
              key={lv.label}
              className={
                'toc-panel__level-btn' +
                (expandLevel === lv.value ? ' toc-panel__level-btn--active' : '')
              }
              title={lv.title}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onLevelClick(lv.value); }}
            >
              {lv.label}
            </button>
          ))}
        </div>
        <div className="toc-panel__list">
          {entries.length === 0 ? (
            <div className="toc-panel__empty">暂无目录</div>
          ) : (
            entries.map((entry, i) => (
              <button
                key={`${entry.pos}-${i}`}
                className={
                  'toc-panel__item' +
                  (i === activeIndex ? ' toc-panel__item--active' : '')
                }
                data-level={entry.level}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onItemClick(entry.pos); }}
              >
                {entry.text}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
