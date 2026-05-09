/**
 * Help Panel Binding — 右栏长侧栏渲染(L4.1)
 *
 * 职责:
 * - 订阅 helpPanelController + helpPanelRegistry
 * - 渲染 shell:header(title + × 按钮)+ body 容器
 * - 渲染注册项的 Component(传 onClose)
 * - 全局 listener:Esc / mousedown 点外部
 *
 * 跟 PopupBinding 对比:
 * - 不需要 anchor 定位测量 — CSS 固定贴右
 * - 不需要 visibility: hidden 二次测量 trick
 * - click-outside 支持 entry.excludeFromClickOutside 选择器白名单(对齐 V1)
 */

import { useEffect, useRef, useState } from 'react';
import { helpPanelController } from '../triggers/help-panel-controller';
import { helpPanelRegistry } from '../interaction-registries/help-panel-registry/help-panel-registry';
import { useHelpPanelVersion } from './use-registry';
import './help-panel-binding.css';

export function HelpPanelBinding() {
  useHelpPanelVersion();
  const [state, setState] = useState(helpPanelController.getState());
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 订阅 controller 状态
  useEffect(() => {
    return helpPanelController.subscribe(() => setState(helpPanelController.getState()));
  }, []);

  // Esc 关闭
  useEffect(() => {
    if (!state.visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        helpPanelController.hide();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state.visible]);

  // 点外关闭(挂在 document 上,支持 excludeFromClickOutside 白名单)
  useEffect(() => {
    if (!state.visible || !state.activeId) return;
    const item = helpPanelRegistry.get(state.activeId);
    if (!item) return;
    const handler = (e: MouseEvent) => {
      const panelEl = panelRef.current;
      if (!panelEl) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 点击 panel 内部 → 不关
      if (panelEl.contains(target)) return;
      // 点击 entry.excludeFromClickOutside selector → 不关(对齐 V1)
      if (item.excludeFromClickOutside) {
        for (const sel of item.excludeFromClickOutside) {
          if (target.closest(sel)) return;
        }
      }
      helpPanelController.hide();
    };
    // 用 mousedown(在 click 之前触发)+ 微延迟避开当前事件
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [state.visible, state.activeId]);

  if (!state.visible || !state.activeId) return null;
  const item = helpPanelRegistry.get(state.activeId);
  if (!item) return null;

  const Component = item.Component;
  const handleClose = () => helpPanelController.hide();

  return (
    <div ref={panelRef} className="krig-help-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="krig-help-panel__header">
        <span className="krig-help-panel__title">{item.title}</span>
        <button
          type="button"
          className="krig-help-panel__close-btn"
          onClick={handleClose}
          aria-label="Close"
        >
          {'×'}
        </button>
      </div>
      <div className="krig-help-panel__body">
        <Component onClose={handleClose} />
      </div>
    </div>
  );
}
