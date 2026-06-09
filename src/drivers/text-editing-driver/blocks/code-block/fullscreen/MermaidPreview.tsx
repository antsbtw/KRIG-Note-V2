/**
 * MermaidPreview — Mermaid 预览 + 缩放
 *
 * 职责:
 * - 接 source / theme,300ms 防抖触发渲染(对齐 V1 全屏体验)
 * - scale 缩放容器(transform scale,父组件控值)
 * - 暴露 getSvgEl(给父组件的下载 / 复制按钮取 SVG)
 * - 渲染状态通过 onStatusChange 回调上抛父组件(由 Panel 渲染状态栏)
 *
 * 复用 V2 inline 渲染核心(getMermaidModule / buildMermaidConfig)— 不重新 init,
 * 全局 mermaid 单例;不同主题用 mm.initialize(buildMermaidConfig(theme)) 切换。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  buildMermaidConfig,
  getMermaidModule,
  type MermaidTheme,
} from '../mermaid-renderer';

export interface MermaidPreviewHandle {
  getSvgEl: () => SVGElement | null;
  /**
   * 计算「按宽度铺满预览区」所需 scale —— 预览区可用宽 / SVG 自然宽。
   * 无 SVG / 取不到尺寸时返回 null(调用方保持当前 scale)。
   */
  computeFitWidthScale: () => number | null;
}

export type RenderStatus =
  | { state: 'idle' }
  | { state: 'ok' }
  | { state: 'error'; message: string };

interface MermaidPreviewProps {
  source: string;
  theme: MermaidTheme;
  scale: number;
  onStatusChange: (status: RenderStatus) => void;
  /** 每次渲染出新 SVG 后触发(父用于首帧 fit-width;此时 computeFitWidthScale 已可用) */
  onRendered?: () => void;
}

let fsIdCounter = 0;

export const MermaidPreview = forwardRef<MermaidPreviewHandle, MermaidPreviewProps>(
  function MermaidPreview({ source, theme, scale, onStatusChange, onRendered }, ref) {
    const previewRef = useRef<HTMLDivElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onStatusChangeRef = useRef(onStatusChange);
    onStatusChangeRef.current = onStatusChange;
    const onRenderedRef = useRef(onRendered);
    onRenderedRef.current = onRendered;

    useImperativeHandle(ref, () => ({
      getSvgEl: () => wrapperRef.current?.querySelector('svg') ?? null,
      computeFitWidthScale: () => {
        const preview = previewRef.current;
        const svg = wrapperRef.current?.querySelector('svg');
        if (!preview || !svg) return null;
        // SVG 自然宽:优先 viewBox(不受外层 scale 影响),退回 getBBox
        const vb = svg.viewBox?.baseVal;
        let naturalW = vb && vb.width ? vb.width : 0;
        if (!naturalW) {
          try {
            naturalW = svg.getBBox().width;
          } catch {
            naturalW = 0;
          }
        }
        if (!naturalW) return null;
        // 预览区可用宽 = clientWidth - 左右 padding(见 .krig-mermaid-fs__preview)
        const cs = getComputedStyle(preview);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const availW = preview.clientWidth - padX;
        if (availW <= 0) return null;
        return availW / naturalW;
      },
    }));

    useEffect(() => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void renderPreview(source, theme);
      }, 300);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };

      async function renderPreview(src: string, t: MermaidTheme): Promise<void> {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        // 去 zero-width 字符 + trim
        const trimmed = src.replace(/[​‌‍﻿]/g, '').trim();
        if (!trimmed) {
          wrapper.innerHTML =
            '<div class="krig-mermaid-fs__empty">输入 Mermaid 语法查看预览</div>';
          onStatusChangeRef.current({ state: 'idle' });
          return;
        }
        try {
          const mm = await getMermaidModule();
          mm.initialize(buildMermaidConfig(t));
          const renderId = `fs-mermaid-${++fsIdCounter}`;
          try {
            const { svg } = await mm.render(renderId, trimmed);
            // 渲染回来时组件可能已 unmount(theme/source 快速切换)
            if (!wrapperRef.current) return;
            wrapperRef.current.innerHTML = svg;
            onStatusChangeRef.current({ state: 'ok' });
            onRenderedRef.current?.();
          } catch (err) {
            const e = err as { message?: string; toString?: () => string };
            const msg = e?.message || e?.toString?.() || 'Mermaid 语法错误';
            const lineMatch =
              msg.match(/line\s+(\d+)/i) ?? msg.match(/at position.*?line:\s*(\d+)/i);
            const lineInfo = lineMatch ? ` (第 ${lineMatch[1]} 行)` : '';
            const shortMsg = msg.split('\n')[0].slice(0, 200);
            if (!wrapperRef.current) return;
            wrapperRef.current.innerHTML =
              '<div class="krig-mermaid-fs__error">语法错误 — 查看底部状态栏</div>';
            onStatusChangeRef.current({
              state: 'error',
              message: `✗ ${shortMsg}${lineInfo}`,
            });
            // 清掉 mermaid 在 body 上的临时元素(失败时会残留)
            document.getElementById('d' + renderId)?.remove();
          }
        } catch (e) {
          if (!wrapperRef.current) return;
          wrapperRef.current.innerHTML =
            '<div class="krig-mermaid-fs__error">Mermaid 加载失败</div>';
          onStatusChangeRef.current({ state: 'error', message: '✗ Mermaid 模块加载失败' });
          console.warn('[MermaidPreview] load failed:', e);
        }
      }
    }, [source, theme]);

    return (
      <div className="krig-mermaid-fs__preview" ref={previewRef}>
        <div
          ref={wrapperRef}
          className="krig-mermaid-fs__preview-wrapper"
          style={{ transform: `scale(${scale})` }}
        />
      </div>
    );
  },
);
