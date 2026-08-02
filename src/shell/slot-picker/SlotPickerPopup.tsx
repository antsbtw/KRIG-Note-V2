/**
 * SlotPickerPopup — 命令板风格的 right slot view 选择器
 *
 * 从 viewTypeRegistry 动态读取所有可进 picker 的 view(navSideTab ∪ slotPickerEntry —
 * 后者给 thought-view 这类不占 NavSide 切换条、但需要能手动召回右槽的 hidden view)。
 * 有 slotPickerChildren 的 view（如 AI、Social）展开为子项，直接选具体服务。
 * 支持名称/首字母过滤，方向键导航，Enter/点击确认。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { slotPickerContext } from './slot-picker-context';
import './slot-picker.css';

interface FlatItem {
  viewId: string;
  /** 子项 id（传给 view 作 payload.subId），无子项时为 null */
  subId: string | null;
  label: string;
  icon: string;
  /** 搜索用小写文本 */
  searchText: string;
}

function buildFlatItems(): FlatItem[] {
  const items: FlatItem[] = [];
  for (const v of viewTypeRegistry.getAllForSlotPicker()) {
    const children = v.navSideTab?.slotPickerChildren;
    if (children && children.length > 0) {
      for (const c of children) {
        items.push({
          viewId: v.id,
          subId: c.subId,
          label: c.label,
          icon: c.icon,
          searchText: c.label.toLowerCase(),
        });
      }
    } else {
      // navSideTab 或 slotPickerEntry 必有其一(getAllForSlotPicker 过滤保证)
      const entry = (v.navSideTab ?? v.slotPickerEntry)!;
      items.push({
        viewId: v.id,
        subId: null,
        label: entry.label,
        icon: entry.icon,
        searchText: entry.label.toLowerCase(),
      });
    }
  }
  return items;
}

export function SlotPickerPopup({ onClose }: PopupCloseProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const allItems = buildFlatItems();

  const filtered = query.trim()
    ? allItems.filter((item) => {
        const q = query.trim().toLowerCase();
        return item.searchText.startsWith(q) || item.searchText.includes(q);
      })
    : allItems;

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const pick = useCallback((item: FlatItem) => {
    const commandId = slotPickerContext.getCommandId();
    if (commandId) {
      const arg = item.subId != null
        ? { viewId: item.viewId, subId: item.subId }
        : item.viewId;
      commandRegistry.execute(commandId, arg);
    }
    onClose();
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIdx];
      if (item) pick(item);
    }
  };

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector('.krig-slot-picker__item--active') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div className="krig-slot-picker">
      <div className="krig-slot-picker__search">
        <input
          autoFocus
          className="krig-slot-picker__input"
          placeholder="输入名称或首字母…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="krig-slot-picker__list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="krig-slot-picker__empty">无匹配</div>
        ) : (
          filtered.map((item, idx) => (
            <button
              key={`${item.viewId}:${item.subId ?? ''}`}
              type="button"
              className={`krig-slot-picker__item${idx === activeIdx ? ' krig-slot-picker__item--active' : ''}`}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <span className="krig-slot-picker__icon">{item.icon}</span>
              <span className="krig-slot-picker__label">{item.label}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
