/**
 * LibraryPicker — 双栏 popover(Canvas.md §3.3)
 *
 * V1 直迁(src/plugins/graph/canvas/ui/LibraryPicker/LibraryPicker.tsx:442 行),
 * V2 改动:
 * - `import { AddModeSpec }` 路径从 V1 InteractionController 改 V2 `../../types`
 * - ShapeRegistry / SubstanceRegistry 直接 import → 走 requireCapabilityApi
 *
 * 结构(macOS Freeform 风格):
 *   ┌─────────────────────────┐
 *   │ 🔍 Search          ✎(灰)│  ← 顶部全宽搜索 + 自定义入口(v1.5+)
 *   ├──────────┬──────────────┤
 *   │ ▸ Basic  │  □ ◯ ◇ ...   │  ← 左:分类 / 右:3-col 网格
 *   │   Arrow  │              │
 *   │   ...    │              │
 *   │ ──────── │              │  ← Shape / Substance 间分隔(视觉)
 *   │   Library│              │
 *   └──────────┴──────────────┘
 *           ▲ anchor 三角指向触发按钮
 *
 * 入口:view Toolbar "+ 添加" 按钮触发(open prop 由 view 控制)
 * 关闭:点 item / ESC / 点外部 → onClose
 * 选完 item:onPick(spec) → view 调 host.enterAddMode(spec)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ShapeCategory,
  ShapeLibraryApi,
} from '@capabilities/shape-library/types';
import type { AddModeSpec } from '../../types';
import { shapeToSVG, substanceToSVG } from './preview-svg';

type Section = 'shape' | 'substance';

export interface LibraryPickerProps {
  open: boolean;
  /** 触发按钮在容器内的屏幕坐标(用于定位 popover + anchor 三角) */
  anchorRect: { left: number; top: number; width: number; height: number } | null;
  onPick: (spec: AddModeSpec) => void;
  onClose: () => void;
}

interface CategoryGroup {
  section: Section;
  category: string;
  label: string;
  count: number;
}

interface PickerItem {
  section: Section;
  ref: string;
  name: string;
  category: string;
}

let _shapeApi: ShapeLibraryApi | null = null;
function getShapeApi(): ShapeLibraryApi {
  if (!_shapeApi) {
    _shapeApi = requireCapabilityApi<ShapeLibraryApi>('shape-library');
  }
  return _shapeApi;
}

export function LibraryPicker(props: LibraryPickerProps): ReactElement | null {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<{ section: Section; category: string }>(
    { section: 'shape', category: 'basic' },
  );

  // 打开时 reset 搜索
  useEffect(() => {
    if (!props.open) return;
    setSearch('');
  }, [props.open]);

  // 收齐分类组 + items(registry bootstrap 后稳定;依 open 触发避免初次未挂)
  const { groups, allItems } = useMemo(() => {
    return collectLibrary();
  }, [props.open]);

  // 搜索为空时按 activeCategory 过滤;非空时跨所有分类模糊
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q !== '') {
      return allItems.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.ref.toLowerCase().includes(q),
      );
    }
    return allItems.filter(
      (it) => it.section === activeCategory.section && it.category === activeCategory.category,
    );
  }, [search, activeCategory, allItems]);

  // ESC + 点外部关闭
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (popoverRef.current && target && !popoverRef.current.contains(target)) {
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [props.open, props.onClose, props]);

  const handlePickItem = useCallback(
    (item: PickerItem) => {
      const spec: AddModeSpec = {
        kind: item.section === 'shape' ? 'shape' : 'substance',
        ref: item.ref,
      };
      props.onPick(spec);
    },
    [props],
  );

  if (!props.open || !props.anchorRect) return null;

  // popover 定位:anchor 按钮正下方
  const POPOVER_W = 540;
  const POPOVER_H = 360;
  const padding = 6;
  let left = props.anchorRect.left;
  let top = props.anchorRect.top + props.anchorRect.height + padding;
  const winW = window.innerWidth;
  if (left + POPOVER_W > winW - 8) left = Math.max(8, winW - POPOVER_W - 8);
  if (top + POPOVER_H > window.innerHeight - 8) {
    top = Math.max(8, props.anchorRect.top - POPOVER_H - padding);
  }
  const arrowLeft = Math.max(
    16,
    Math.min(POPOVER_W - 16, props.anchorRect.left - left + props.anchorRect.width / 2),
  );

  return (
    <div
      ref={popoverRef}
      style={{ ...styles.popover, left, top, width: POPOVER_W, height: POPOVER_H }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ ...styles.arrow, left: arrowLeft - 6 }} />

      <div style={styles.header}>
        <div style={styles.searchBox}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            autoFocus
            type="text"
            placeholder="Search shapes & substances…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
        </div>
        <button style={styles.customBtn} disabled title="自定义 Shape(v1.5+)">
          ✎
        </button>
      </div>

      <div style={styles.body}>
        <div style={styles.sidebar}>
          {groups.map((g, idx) => (
            <div key={`${g.section}-${g.category}`}>
              {idx > 0 && groups[idx - 1].section !== g.section && (
                <div style={styles.sidebarDivider} />
              )}
              <button
                style={{
                  ...styles.sidebarItem,
                  ...(activeCategory.section === g.section && activeCategory.category === g.category && search === ''
                    ? styles.sidebarItemActive
                    : null),
                }}
                onClick={() => {
                  setSearch('');
                  setActiveCategory({ section: g.section, category: g.category });
                }}
              >
                <span>{g.label}</span>
                <span style={styles.sidebarCount}>{g.count}</span>
              </button>
            </div>
          ))}
        </div>

        <div style={styles.grid}>
          {visibleItems.length === 0 ? (
            <div style={styles.empty}>
              {search ? `No results for "${search}"` : 'No items in this category'}
            </div>
          ) : (
            visibleItems.map((item) => (
              <button
                key={`${item.section}-${item.ref}`}
                style={styles.gridCell}
                onClick={() => handlePickItem(item)}
                title={`${item.name} · ${item.ref}`}
              >
                <span
                  style={styles.gridIcon}
                  // SVG markup 是我们自己生成的(preview-svg.ts),不来自用户输入,无 XSS 风险
                  dangerouslySetInnerHTML={{ __html: getPreview(item) ?? '' }}
                />
                <span style={styles.gridLabel}>{item.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 数据收集 + label 映射
// ─────────────────────────────────────────────────────────

function collectLibrary(): { groups: CategoryGroup[]; allItems: PickerItem[] } {
  const api = getShapeApi();
  const items: PickerItem[] = [];

  for (const def of api.shapes.list()) {
    items.push({
      section: 'shape',
      ref: def.id,
      name: def.name,
      category: def.category,
    });
  }
  for (const def of api.substances.list()) {
    items.push({
      section: 'substance',
      ref: def.id,
      name: def.name,
      category: def.category ?? 'user',
    });
  }

  const SHAPE_ORDER: ShapeCategory[] = ['basic', 'arrow', 'flowchart', 'line', 'text'];
  const SUBSTANCE_ORDER: string[] = ['library', 'family', 'user'];

  const groups: CategoryGroup[] = [];
  for (const cat of SHAPE_ORDER) {
    const count = items.filter((i) => i.section === 'shape' && i.category === cat).length;
    if (count > 0) {
      groups.push({ section: 'shape', category: cat, label: capitalize(cat), count });
    }
  }
  for (const cat of SUBSTANCE_ORDER) {
    const count = items.filter((i) => i.section === 'substance' && i.category === cat).length;
    if (count > 0) {
      groups.push({ section: 'substance', category: cat, label: capitalize(cat), count });
    }
  }
  return { groups, allItems: items };
}

function getPreview(item: PickerItem): string | null {
  return item.section === 'shape' ? shapeToSVG(item.ref) : substanceToSVG(item.ref);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────
// styles(macOS Freeform 风格)
// ─────────────────────────────────────────────────────────

const ACCENT = '#4DD0E1';

const styles: Record<string, CSSProperties> = {
  popover: {
    position: 'fixed',
    zIndex: 1000,
    background: 'rgba(40, 40, 40, 0.92)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
    color: 'var(--krig-text-primary)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  arrow: {
    position: 'absolute',
    top: -7,
    width: 12,
    height: 12,
    background: 'rgba(40, 40, 40, 0.92)',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
    transform: 'rotate(45deg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  searchBox: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    padding: '4px 8px',
  },
  searchIcon: { fontSize: 12, marginRight: 6, opacity: 0.6 },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--krig-text-primary)',
    fontSize: 12,
  },
  customBtn: {
    width: 28,
    height: 28,
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 6,
    color: 'var(--krig-text-dim)',
    fontSize: 14,
    cursor: 'not-allowed',
  },
  body: { flex: 1, display: 'flex', minHeight: 0 },
  sidebar: {
    width: 160,
    borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    overflowY: 'auto',
    padding: '4px 0',
  },
  sidebarItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
    border: 'none',
    color: 'var(--krig-text-primary)',
    fontSize: 12,
    padding: '6px 14px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  sidebarItemActive: { background: ACCENT, color: '#0c2026', fontWeight: 600 },
  sidebarCount: { fontSize: 10, opacity: 0.5 },
  sidebarDivider: {
    height: 1,
    margin: '6px 12px',
    background: 'rgba(255, 255, 255, 0.08)',
  },
  grid: {
    flex: 1,
    overflowY: 'auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 6,
    padding: 12,
    alignContent: 'start',
  },
  gridCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    color: 'var(--krig-text-primary)',
    cursor: 'pointer',
    padding: '10px 6px',
    transition: 'background 80ms',
  },
  gridIcon: {
    width: 56,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: {
    fontSize: 10,
    color: 'var(--krig-text-muted)',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    width: '100%',
  },
  empty: {
    gridColumn: '1 / -1',
    color: 'var(--krig-text-dim)',
    fontSize: 12,
    textAlign: 'center',
    padding: 24,
  },
};
