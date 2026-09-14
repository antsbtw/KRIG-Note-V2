/**
 * GraphCanvasZoomControl — 画板缩放控件(显示 + 放大/缩小 + 档位下拉)
 *
 * ⭐ 设计约束(为将来导图继承留的):
 * 本组件**只依赖三件事** —— `getViewport()` 读当前值、`zoomTo()` 改、
 * `onZoomExternallyChanged` 订阅外部变化(滚轮/快捷键)。
 * ⚠️ 它**不知道视口存在哪**:画板存 `doc_content.view`,导图将来存 G 层,
 * 都与本组件无关。谁能提供上面三件事,谁就能挂这个控件。
 *
 * ⚠️ 百分比的真源是 Host 的相机,不是本组件的 state —— 滚轮缩放时显示要跟着走,
 * 所以 state 只是「最近一次读到的值」的镜像,永远以 getViewport 为准。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CanvasRenderingApi } from '@capabilities/canvas-rendering/types';

export interface GraphCanvasZoomControlProps {
  /** 读当前 zoom 倍率;宿主未就绪给 null(⚠️ 不要兜底成 1) */
  getZoom: () => number | null;
  /** 设 zoom(百分比,100 = 原始大小) */
  zoomTo: (percent: number) => void;
  /** 适应窗口;返回 false = 空画板没得 fit */
  fitToContent: () => boolean;
  /**
   * 订阅外部引起的缩放变化(滚轮 / pinch / 快捷键)。
   * ⚠️ 必须返回**退订函数** —— 常驻订阅没有停止调用就是泄漏。
   */
  subscribe: (onChange: () => void) => () => void;
}

export function GraphCanvasZoomControl({
  getZoom,
  zoomTo,
  fitToContent,
  subscribe,
}: GraphCanvasZoomControlProps) {
  // ⚠️ 档位 / 上下限是**渲染侧的事实**(滚轮、快捷键、按钮共用一套),
  //    view 只是消费者 —— 走 api 拿,不直 import(W5 边界)
  const zoom = useMemo(
    () => requireCapabilityApi<CanvasRenderingApi>('canvas-rendering').zoom,
    [],
  );

  const [percent, setPercent] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /** 从宿主重读一次 —— 所有显示都经这里,不在本地推算 */
  const sync = useCallback((): void => {
    const cur = getZoom();
    setPercent(cur == null ? null : zoom.format(cur));
  }, [getZoom, zoom]);

  // 订阅外部变化(滚轮 / 快捷键)+ 挂载时先读一次
  // ⚠️ Host 的挂载可能晚于 toolbar 的首帧(容器 mount 时序),首读会拿到 null,
  //    所以还挂一个低频兜底轮询把它接上;拿到值后自动停。
  useEffect(() => {
    sync();
    const off = subscribe(sync);
    return off;
  }, [subscribe, sync]);

  useEffect(() => {
    if (percent != null) return;
    const timer = window.setInterval(sync, 300);
    return () => window.clearInterval(timer);
  }, [percent, sync]);

  // 点外部关下拉
  useEffect(() => {
    if (!menuOpen) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const apply = useCallback(
    (target: number): void => {
      zoomTo(target);
      sync();
    },
    [zoomTo, sync],
  );

  const handleIn = (): void => {
    if (percent == null) return;
    apply(zoom.next(percent));
  };
  const handleOut = (): void => {
    if (percent == null) return;
    apply(zoom.prev(percent));
  };
  const handleFit = (): void => {
    setMenuOpen(false);
    fitToContent();
    sync();
  };

  const atMax = percent != null && percent >= zoom.MAX_PERCENT;
  const atMin = percent != null && percent <= zoom.MIN_PERCENT;

  return (
    <div className="krig-graph-canvas-zoom" ref={rootRef}>
      <button
        type="button"
        className="krig-graph-canvas-zoom__btn"
        onClick={handleOut}
        disabled={percent == null || atMin}
        title={`缩小(⌘−)${atMin ? ` — 已到最小 ${zoom.MIN_PERCENT}%` : ''}`}
        aria-label="缩小"
      >
        −
      </button>
      <button
        type="button"
        className="krig-graph-canvas-zoom__value"
        onClick={() => setMenuOpen((v) => !v)}
        title="选择缩放比例"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {percent == null ? '—' : `${percent}%`}
      </button>
      <button
        type="button"
        className="krig-graph-canvas-zoom__btn"
        onClick={handleIn}
        disabled={percent == null || atMax}
        title={`放大(⌘+)${atMax ? ` — 已到最大 ${zoom.MAX_PERCENT}%` : ''}`}
        aria-label="放大"
      >
        +
      </button>

      {menuOpen && (
        <div className="krig-graph-canvas-zoom__menu" role="menu">
          <button
            type="button"
            className="krig-graph-canvas-zoom__item"
            role="menuitem"
            onClick={handleFit}
          >
            适应窗口
          </button>
          <button
            type="button"
            className="krig-graph-canvas-zoom__item"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              apply(100);
            }}
          >
            100%<span className="krig-graph-canvas-zoom__hint">⌘0</span>
          </button>
          <div className="krig-graph-canvas-zoom__sep" />
          {[...zoom.STEPS].reverse().map((step) => (
            <button
              key={step}
              type="button"
              className={
                'krig-graph-canvas-zoom__item' +
                (percent === step ? ' krig-graph-canvas-zoom__item--active' : '')
              }
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                apply(step);
              }}
            >
              {step}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
