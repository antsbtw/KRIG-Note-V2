/**
 * Web NavSide 内容注册 + WebNavPanel 组件(批1)
 *
 * 用户决策:把 web view 的「书签 / 历史 / 下载」三类持久数据集中放 NavSide(左侧栏),
 * 仿 note(文件夹树)/ebook(书架)的注册式范式。分三批:
 *   批1 = 框架 + 历史(本文件)→ 批2 = 下载持久化 → 批3 = 书签。
 *
 * 本批只实装「历史」段(列表 + 点击右栏打开 + hover× 删除 + 清空);
 * 书签 / 下载段先占位(批3 / 批2 实装)。
 *
 * 三段用**垂直折叠区(toggle)**:每段标题点击展开/收起(▸/▾),竖排。
 * (用户决策:不用横排 tab — 否则跟 note view 风格不一致。)
 *
 * 注册机制:navSideRegistry.register({ view: 'web-view', ... });切到 web view 时
 * NavSide 自动显示(WorkspaceInstance 按活跃 viewId 取),基础设施零改动。
 * 范本:src/views/note/nav-side-content.tsx:166。
 */

import { useState, type ReactNode } from 'react';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import {
  getAllHistory,
  removeHistoryEntry,
  clearHistory,
  type WebHistoryEntry,
} from './web-history';

/**
 * 相对时间标签(历史项 lastVisit 显示用)。
 *
 * 本地实现 — 不跨 view import note/tree-builder(eslint no-restricted-imports:
 * view 间不直接 import)。逻辑与之等价,体量小,自包含即可。
 */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return new Date(ts).toLocaleDateString();
}

/** 历史项 title 兜底:无 title 用 url 的 hostname,再失败用原始 url。 */
function displayTitle(entry: WebHistoryEntry): string {
  if (entry.title) return entry.title;
  try {
    return new URL(entry.url).hostname;
  } catch {
    return entry.url;
  }
}

/** 折叠状态持久化(localStorage,per-section)— 记住上次展开/收起。 */
const COLLAPSE_KEY_PREFIX = 'krig:web:nav-collapse:';

function readCollapsed(storeKey: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY_PREFIX + storeKey);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeCollapsed(storeKey: string, open: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY_PREFIX + storeKey, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * 可折叠区(toggle)— 三段共用外壳。点 header 展开/收起。
 * storeKey:localStorage 持久化展开状态(记住上次)。defaultOpen 仅首次无记录时用。
 * headerExtra:展开时 header 右侧的额外控件(如历史段的「清空」按钮)。
 */
function CollapsibleSection({
  storeKey,
  icon,
  title,
  defaultOpen = false,
  headerExtra,
  children,
}: {
  storeKey: string;
  icon: string;
  title: string;
  defaultOpen?: boolean;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readCollapsed(storeKey, defaultOpen));
  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      writeCollapsed(storeKey, next);
      return next;
    });
  };
  return (
    <section className={`krig-web-nav__section${open ? ' krig-web-nav__section--open' : ''}`}>
      <header
        className="krig-web-nav__section-header"
        onClick={toggle}
      >
        <span className="krig-web-nav__caret">{open ? '▼' : '▶'}</span>
        <span className="krig-web-nav__section-title">
          {icon} {title}
        </span>
        {open && headerExtra}
      </header>
      {open && children}
    </section>
  );
}

/** 历史段:全量列表 + 点击右栏打开 + hover× 删除 + 清空历史。 */
function HistorySection() {
  // localStorage 非响应式 — mount 取一次,删除/清空后手动 setState 刷新。
  const [entries, setEntries] = useState<WebHistoryEntry[]>(() => getAllHistory());

  const openEntry = (url: string) => {
    // 复用现成命令:在活跃 ws 右栏 web view 活跃 tab 打开 url(签名是 url 字符串)。
    commandRegistry.execute('web-view.open-url', url);
  };

  const removeEntry = (url: string) => {
    removeHistoryEntry(url);
    setEntries((prev) => prev.filter((e) => e.url !== url));
  };

  const clearAll = () => {
    clearHistory();
    setEntries([]);
  };

  const clearBtn =
    entries.length > 0 ? (
      <button
        type="button"
        className="krig-web-nav__clear-btn"
        onClick={(e) => {
          e.stopPropagation(); // 不触发 header 折叠
          clearAll();
        }}
        title="清空全部历史"
      >
        清空
      </button>
    ) : undefined;

  return (
    <CollapsibleSection storeKey="history" icon="🕘" title="历史" defaultOpen headerExtra={clearBtn}>
      {entries.length === 0 ? (
        <div className="krig-web-nav__empty">暂无历史记录</div>
      ) : (
        <ul className="krig-web-nav__list">
          {entries.map((entry) => (
            <li
              key={entry.url}
              className="krig-web-nav__item"
              onClick={() => openEntry(entry.url)}
              title={entry.url}
            >
              <div className="krig-web-nav__item-main">
                <span className="krig-web-nav__item-title">{displayTitle(entry)}</span>
                <span className="krig-web-nav__item-url">{entry.url}</span>
              </div>
              <span className="krig-web-nav__item-time">{relativeTime(entry.lastVisit)}</span>
              <button
                type="button"
                className="krig-web-nav__item-del"
                title="删除此条历史"
                onClick={(e) => {
                  e.stopPropagation();
                  removeEntry(entry.url);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

/** 占位段(书签 / 下载,批3 / 批2 实装)。默认折叠。 */
function PlaceholderSection({
  storeKey,
  icon,
  title,
  hint,
}: {
  storeKey: string;
  icon: string;
  title: string;
  hint: string;
}) {
  return (
    <CollapsibleSection storeKey={storeKey} icon={icon} title={title}>
      <div className="krig-web-nav__empty krig-web-nav__placeholder">{hint}</div>
    </CollapsibleSection>
  );
}

/** Web NavSide 三段式折叠面板:书签 / 历史 / 下载。本批只实装历史段。 */
function WebNavPanel() {
  return (
    <div className="krig-web-nav">
      <PlaceholderSection storeKey="bookmark" icon="📌" title="书签" hint="批3 实装" />
      <HistorySection />
      <PlaceholderSection storeKey="download" icon="⬇" title="下载" hint="批2 实装" />
    </div>
  );
}

export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'web-view',
    title: 'Web',
    contentRenderer: () => <WebNavPanel />,
  });
}
