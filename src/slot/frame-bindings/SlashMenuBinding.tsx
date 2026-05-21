/**
 * SlashMenu Binding — 渲染 / 命令菜单
 *
 * L5-B3.1:加 selectedIdx 内部 state(↑↓ 选中 / Enter 触发);query 变化时 reset 0。
 *
 * Notion 范式美化:
 * - 分组渲染(basic / media / advanced + 动态 suggestions)
 * - max-height 360px + 内部滚动,菜单不再撑屏
 * - 每项左 icon(lucide) + 中 label + 右 hint(md 标记)
 * - 有 query 时模糊匹配 top-3 → 顶部"建议"组(对齐 Notion 行为)
 * - 键盘 ↑↓ 跳过 group title,只在 item 上移动;选中项 scrollIntoView
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useSlashVersion } from './use-registry';
import { useCollisionPosition } from './use-collision-position';
import { slashRegistry } from '../interaction-registries/slash-registry/slash-registry';
import type { SlashGroup, SlashItem } from '../interaction-registries/slash-registry/slash-types';
import { slashMenuController } from '../triggers/slash-menu-controller';
import { commandRegistry } from '../command-registry/command-registry';
import { getCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi } from '@capabilities/code-editing/types';

/**
 * Slash 触发时根据 item 解析附加 payload(`code <lang>` 语法)
 *
 * - text-editing.slash-turn-code:query 第 2 词若是已注册语言 id → 落 attrs.language;
 *   未注册语言原样吃掉(不报错,落空 lang)— code block 至少能创出来。
 * - 其他 command:无 payload。
 */
/**
 * 解析 `code <lang>` 第 2 词为语言:
 * 1. 优先 id 精确匹配(`/code python` → python)
 * 2. 次选 id 或 label 前缀匹配(`/code pyt` → python;`/code Java` → JavaScript)
 */
function resolveCodeLang(query: string): { id: string; label: string } | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  return resolveCodeLangByToken(tokens[1].toLowerCase());
}

function buildCommandPayload(item: SlashItem, query: string): unknown {
  if (item.command !== 'text-editing.slash-turn-code') return undefined;
  const lang = resolveCodeLang(query);
  return lang ? { language: lang.id } : undefined;
}

interface RenderRow {
  kind: 'title' | 'item';
  title?: string;
  item?: SlashItem;
}

interface GroupedView {
  /** 扁平渲染行(含 title/item 混合),供 React map */
  rows: RenderRow[];
  /** 仅 item 的扁平列表,供键盘导航/Enter 触发 */
  flatItems: SlashItem[];
}

const GROUP_TITLES: Record<SlashGroup | 'suggestions', string> = {
  suggestions: '建议',
  basic: '基本区块',
  media: '媒体',
  advanced: '高级',
};

const GROUP_ORDER: SlashGroup[] = ['basic', 'media', 'advanced'];

/**
 * 模糊匹配打分:支持空格分词 AND 匹配(Notion 行为)
 *
 * "2 col" → ["2", "col"] 两词都需命中 label 或某个 keyword;
 * 每词单独打分(prefix > contains;label > keyword),累加。
 *
 * 特例:slash-turn-code 第 1 词命中后,第 2 词允许是已注册的 code-editing
 *      语言 id(`/code python` 模式)而不参与 AND 淘汰 — 那是命令 payload,
 *      不是过滤词。
 */
function scoreItem(item: SlashItem, q: string): number {
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const label = item.label.toLowerCase();
  const kws = (item.keywords ?? []).map((k) => k.toLowerCase());
  const isCode = item.command === 'text-editing.slash-turn-code';
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let s = 0;
    if (label.startsWith(t)) s = 100;
    else if (label.includes(t)) s = 50;
    else if (kws.some((k) => k.startsWith(t))) s = 30;
    else if (kws.some((k) => k.includes(t))) s = 10;
    if (s === 0) {
      // code-block 的第 2 词:精确/前缀命中已注册语言 → 视为 payload 跳过 AND
      // (`/code pyt` 输入未完时也能让 Code Block 留在建议组)
      if (isCode && i === 1 && resolveCodeLangByToken(t)) continue;
      return 0;
    }
    total += s;
  }
  return total;
}

/** 复用 resolveCodeLang 的查询语义(精确 + 前缀),专给 scoreItem 用 */
function resolveCodeLangByToken(token: string): { id: string; label: string } | null {
  const api = getCapabilityApi<CodeEditingApi>('code-editing');
  if (!api) return null;
  const exact = api.getLanguage(token);
  if (exact) return { id: exact.id, label: exact.label };
  const hit = api
    .getLanguages()
    .find(
      (l) =>
        l.id.toLowerCase().startsWith(token) ||
        l.label.toLowerCase().startsWith(token),
    );
  return hit ? { id: hit.id, label: hit.label } : null;
}

function buildGrouped(items: SlashItem[], query: string): GroupedView {
  const q = query.trim().toLowerCase();
  const rows: RenderRow[] = [];
  const flatItems: SlashItem[] = [];

  // 有 query 时,先算 top-3 suggestions(取分数最高的 3 项)
  if (q) {
    const scored = items
      .map((it) => ({ it, s: scoreItem(it, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.it.order ?? 0) - (b.it.order ?? 0))
      .slice(0, 3)
      .map((x) => x.it);

    if (scored.length > 0) {
      rows.push({ kind: 'title', title: GROUP_TITLES.suggestions });
      for (const it of scored) {
        rows.push({ kind: 'item', item: it });
        flatItems.push(it);
      }
    }
  }

  // 静态分组(按 GROUP_ORDER)
  const seen = new Set(flatItems.map((it) => it.id));
  for (const g of GROUP_ORDER) {
    const groupItems = items
      .filter((it) => (it.group ?? 'basic') === g && !seen.has(it.id))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (groupItems.length === 0) continue;
    rows.push({ kind: 'title', title: GROUP_TITLES[g] });
    for (const it of groupItems) {
      rows.push({ kind: 'item', item: it });
      flatItems.push(it);
    }
  }

  return { rows, flatItems };
}

export function SlashMenuBinding() {
  useSlashVersion();
  const [state, setState] = useState(slashMenuController.getState());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { x, y } = useCollisionPosition(menuRef, state.x, state.y);

  // 选中 idx(指向 flatItems,跳过 title)
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    return slashMenuController.subscribe(() => setState(slashMenuController.getState()));
  }, []);

  // 计算分组视图(基于当前 view + query)
  const grouped = useMemo<GroupedView>(() => {
    if (!state.visible) return { rows: [], flatItems: [] };
    // registry.getItemsForView 已做 view 过滤;query 走我们自己的打分,故这里传空 query 拿全集
    const all = slashRegistry.getItemsForView(state.viewId, '');
    return buildGrouped(all, state.query);
  }, [state.visible, state.viewId, state.query]);

  // query/view 变化 → reset selectedIdx
  useEffect(() => {
    setSelectedIdx(0);
  }, [state.query, state.viewId]);

  // 选中项变化 → scrollIntoView
  useEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current.querySelector<HTMLElement>(
      `[data-slash-item-idx="${selectedIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, grouped.rows]);

  // 键盘导航(只在 visible 时)
  useEffect(() => {
    if (!state.visible) return;
    const items = grouped.flatItems;
    if (items.length === 0) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((idx) => (idx + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((idx) => (idx - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const item = items[selectedIdx];
        if (item) {
          const payload = buildCommandPayload(item, state.query);
          if (payload !== undefined) commandRegistry.execute(item.command, payload);
          else commandRegistry.execute(item.command);
          slashMenuController.hide();
        }
      }
    };
    // 用 capture 阶段抢在 PM 编辑器之前
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.visible, grouped.flatItems, selectedIdx]);

  if (!state.visible) return null;
  if (grouped.flatItems.length === 0) return null;

  let itemCursor = 0;
  return (
    <div
      ref={menuRef}
      className="krig-slash-menu krig-slash-menu--grouped"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {grouped.rows.map((row, rowIdx) => {
        if (row.kind === 'title') {
          return (
            <div
              key={`title-${rowIdx}`}
              className="krig-slash-menu-group-title"
              role="presentation"
            >
              {row.title}
            </div>
          );
        }
        const item = row.item!;
        const itemIdx = itemCursor++;
        const selected = itemIdx === selectedIdx;
        return (
          <button
            key={item.id}
            type="button"
            data-slash-item-idx={itemIdx}
            className={`krig-slash-menu-item${selected ? ' selected' : ''}`}
            onMouseEnter={() => setSelectedIdx(itemIdx)}
            onClick={() => {
              const payload = buildCommandPayload(item, state.query);
              if (payload !== undefined) commandRegistry.execute(item.command, payload);
              else commandRegistry.execute(item.command);
              slashMenuController.hide();
            }}
          >
            <span className="krig-slash-menu-item__icon" aria-hidden>
              {item.icon ? (
                <DynamicIcon name={item.icon as IconName} size={16} />
              ) : null}
            </span>
            <span className="krig-slash-menu-item__label">
              {item.label}
              {item.command === 'text-editing.slash-turn-code'
                ? (() => {
                    const lang = resolveCodeLang(state.query);
                    return lang ? (
                      <span className="krig-slash-menu-item__suffix"> · {lang.label}</span>
                    ) : null;
                  })()
                : null}
            </span>
            {item.hint ? (
              <span className="krig-slash-menu-item__hint">{item.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
