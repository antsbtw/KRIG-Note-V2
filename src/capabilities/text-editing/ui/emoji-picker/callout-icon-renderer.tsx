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
 * 字面 lookup 双路径(D023 Step 5.8.1 字面扩展):
 * 1. 静态 path:`LucideIcons[Pascal]` 字面命中走快路径(68 置顶 + 用户 dynamic 加载后字面已 cache 的 icon)
 * 2. 动态 path:静态 miss 时字面 fallback 到 `<DynamicIcon name={kebab}>`(lucide 字面自带 lazy 加载组件)
 *
 * 字面 attrs.iconName 字面 Pascal 形式(决议 §4 字面锁定,不动);
 * 字面 manifest 字面提供 pascalName 字段,字面我们在模块 init 时字面构建 Pascal→kebab 反向 map。
 *
 * 字面 bundle:
 * - 静态 lucide-react named import 字面 tree-shake 仅打包用到的 icon(68 ≈ 34KB)
 * - 动态 DynamicIcon 字面在 IconsTabPanel mount 时 lazy 加载(EmojiPickerPanel 字面 await)
 * - 每个 dynamic icon 字面单 chunk(~500B),Vite 字面按需 split
 */

import { createRoot, type Root } from 'react-dom/client';
import * as LucideIcons from 'lucide-react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import type { CalloutIconRenderer } from '@drivers/text-editing-driver';
import { setCalloutIconRenderer } from '@drivers/text-editing-driver';
import lucideManifest from './lucide-manifest.json';

// hostEl → React Root 字面映射(WeakMap 字面随 hostEl GC 自清)
const rootMap = new WeakMap<HTMLElement, Root>();

// Pascal → kebab 反向 map(模块 init 时一次性构建,~1952 entry × ~50B = ~100KB heap)
const pascalToKebab = new Map<string, string>();
for (const [kebab, info] of Object.entries(lucideManifest.icons)) {
  pascalToKebab.set((info as { pascalName: string }).pascalName, kebab);
}

/** 静态 path:按 Pascal name 字面 lookup lucide named export;字面不存在返回 null */
function getStaticLucideIcon(pascalName: string): LucideIcons.LucideIcon | null {
  const exported = (LucideIcons as unknown as Record<string, unknown>)[pascalName];
  if (!exported || typeof exported !== 'object') return null;
  return exported as LucideIcons.LucideIcon;
}

/** Pascal → kebab(走 manifest 反向 map),字面用于动态 path */
function pascalToKebabName(pascalName: string): string | null {
  return pascalToKebab.get(pascalName) ?? null;
}

const calloutIconRenderer: CalloutIconRenderer = {
  render(hostEl, iconName) {
    let root = rootMap.get(hostEl);
    if (!root) {
      root = createRoot(hostEl);
      rootMap.set(hostEl, root);
    }

    // 静态 path:Pascal 命中字面 lucide-react named export
    const StaticIcon = getStaticLucideIcon(iconName);
    if (StaticIcon) {
      root.render(<StaticIcon size={20} aria-hidden />);
      return;
    }

    // 动态 path:Pascal → kebab,字面用 lucide DynamicIcon lazy 加载
    const kebab = pascalToKebabName(iconName);
    if (!kebab) {
      console.warn(`[callout-icon-renderer] 字面未知 iconName: ${iconName}`);
      // 字面给 fallback 渲一个占位 SVG 空盒,防 root 留空导致 hostEl 字面零尺寸
      root.render(<span aria-hidden style={{ display: 'inline-block', width: 20, height: 20 }} />);
      return;
    }
    // kebab 字面源自 manifest(由 lucide repo 字面 dynamicIconImports.mjs 字面解析),
    // 字面运行期一定在 IconName union 内,字面 TS 字面静态推不出来字面 cast 即可。
    root.render(<DynamicIcon name={kebab as IconName} size={20} aria-hidden />);
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
