/**
 * callout lucide icon renderer — driver setCalloutIconRenderer 字面注入点
 *
 * D023 Step 5.5.2 — B 路径字面闭环:
 *   driver NodeView (vanilla DOM)  →  setCalloutIconRenderer  →  本模块 (React + lucide)
 *
 * 字面架构:
 * - render(hostEl, iconName): 按 iconName 字面 lookup lucide React 组件,
 *   用 createRoot 挂载到 hostEl(每个 hostEl 字面对应一个 React Root)
 * - unmount(hostEl): 字面 root.unmount() 释放(防 NodeView destroy 内存泄漏)
 * - iconName 字面不存在(打错/未来 rename)→ 字面 console.warn + 不渲染
 *   (NodeView 字面外层 fallback 会继续渲 emoji 兜底,§7.1 字面预判)
 *
 * lucide-react 字面整包 import:
 * - V2 既有 2 处先例(AddWorkspaceButton / NavSideToggle 字面 named import)
 * - package.json 字面 sideEffects: false → bundler tree-shake 字面只打包实际用到的 icon
 *   (24 icon × ~500B = ~12KB,可接受)
 * - 字面避开 lucide-react/dynamic 字面 dynamic-import API 复杂度(全库 1952 个,
 *   v2 仅用 24 + 用户搜索时按需,搜索路径字面留 Step 5.5.3 处理)
 */

import { createRoot, type Root } from 'react-dom/client';
import * as LucideIcons from 'lucide-react';
import type { CalloutIconRenderer } from '@drivers/text-editing-driver';
import { setCalloutIconRenderer } from '@drivers/text-editing-driver';

// hostEl → React Root 字面映射(WeakMap 字面随 hostEl GC 自清)
const rootMap = new WeakMap<HTMLElement, Root>();

/** 按 iconName 字面 lookup lucide React 组件;字面不存在时返回 null */
function getLucideIcon(iconName: string): LucideIcons.LucideIcon | null {
  const exported = (LucideIcons as unknown as Record<string, unknown>)[iconName];
  // lucide icon 字面是 ForwardRefExoticComponent(typeof === 'object'),
  // 字面 $$typeof Symbol 标识 React 组件,但简单校验 truthy 即可
  if (!exported || typeof exported !== 'object') return null;
  return exported as LucideIcons.LucideIcon;
}

const calloutIconRenderer: CalloutIconRenderer = {
  render(hostEl, iconName) {
    const IconComp = getLucideIcon(iconName);
    if (!IconComp) {
      console.warn(`[callout-icon-renderer] 字面未知 iconName: ${iconName}`);
      return;
    }
    let root = rootMap.get(hostEl);
    if (!root) {
      root = createRoot(hostEl);
      rootMap.set(hostEl, root);
    }
    // size 20 字面对齐 callout emoji 视觉尺寸(emoji 1em ≈ 20px @默认字号)
    root.render(<IconComp size={20} aria-hidden />);
  },

  unmount(hostEl) {
    const root = rootMap.get(hostEl);
    if (!root) return;
    // React 字面在 commit 阶段 unmount 会报"unmount during render"警告;
    // queueMicrotask 字面推到 commit 后(对齐 V2 既有 React root 卸载惯例)
    queueMicrotask(() => {
      root.unmount();
    });
    rootMap.delete(hostEl);
  },
};

/** capability 加载时一次性字面注册 driver callout icon renderer */
export function registerCalloutIconRenderer(): void {
  setCalloutIconRenderer(calloutIconRenderer);
}
