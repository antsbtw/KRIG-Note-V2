/**
 * IconsTabPanel — callout Icons tab 字面网格 + 搜索
 *
 * D023 Step 5.5.3:24 置顶 icon 字面网格 + 关键词搜索(对齐 v1 Callouts emoji 一一对应)。
 *
 * 字面范围决定(§10 偏离 #5):决议 §3.3 字面承诺"搜索过滤全库",
 * 实施期字面发现 lucide-react 全库 1952 icon 整包 import bundle ~1MB(对 emoji picker
 * 过重),dynamic import 字面搜索体验又差。v2 字面只搜 24 置顶(覆盖 v1 emoji),
 * 全库搜索字面留独立 sub-phase(可走 dynamic import 或预生成 search index)。
 *
 * 视觉对齐:panel 宽 352px、暗色主题(#1f1f1f),与 emoji-mart 字面 8 列网格协调。
 */

import { useMemo, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { CALLOUT_ICON_PICKS, type CalloutIcon } from './callout-icons';

interface Props {
  onPick: (iconName: string) => void;
}

function getLucideIcon(name: string): LucideIcons.LucideIcon | null {
  const exported = (LucideIcons as unknown as Record<string, unknown>)[name];
  if (!exported || typeof exported !== 'object') return null;
  return exported as LucideIcons.LucideIcon;
}

function matchesQuery(icon: CalloutIcon, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  if (icon.name.toLowerCase().includes(lower)) return true;
  if (icon.label.toLowerCase().includes(lower)) return true;
  return icon.keywords.some((k) => k.toLowerCase().includes(lower));
}

export function IconsTabPanel({ onPick }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => CALLOUT_ICON_PICKS.filter((icon) => matchesQuery(icon, query)),
    [query],
  );

  return (
    <div className="krig-icons-tab">
      <input
        type="text"
        className="krig-icons-tab__search"
        placeholder="Search icons…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="krig-icons-tab__grid">
        {filtered.length === 0 && (
          <div className="krig-icons-tab__empty">No icons match "{query}"</div>
        )}
        {filtered.map((icon) => {
          const IconComp = getLucideIcon(icon.name);
          if (!IconComp) return null;
          return (
            <button
              key={icon.name}
              type="button"
              className="krig-icons-tab__cell"
              title={icon.label}
              onClick={() => onPick(icon.name)}
            >
              <IconComp size={20} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}
