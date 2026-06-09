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

import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useAllWorkspaces, useActiveWorkspaceId } from '@workspace/workspace-instance/use-workspace';
import { ContextMenuPopover, type ContextMenuItem } from '@slot/shared-ui/ContextMenuPopover';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { folderTreeContextMenuRegistry } from '@slot/nav-side-registry/folder-tree-context-menu-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import {
  FolderTree,
  type ItemNode,
  type TreeNode,
  type FolderNode,
  type KeyAction,
} from '@slot/shared-ui/FolderTree';
import type { BookmarkApi, BookmarkInfo } from '@capabilities/bookmark/types';
import type { FolderCapabilityApi, FolderInfo } from '@capabilities/folder/types';
import {
  getAllHistory,
  removeHistoryEntry,
  clearHistory,
  type WebHistoryEntry,
} from './web-history';
import {
  encodeTreeId,
  decodeTreeId,
  setRenameTrigger,
  setFolderCreatedTrigger,
  setFolderExpandTrigger,
  setNoticeTrigger,
  setSectionOpenTrigger,
} from './web-bookmark-commands';

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
 * headerExtra:展开时 header 右侧的额外控件(如历史段「清空」按钮)。
 *   注:书签的「+书签/+文件夹」不在这,而在 NavSide 面板顶 actions(跟 note/ebook 对称)。
 */
function CollapsibleSection({
  storeKey,
  icon,
  title,
  defaultOpen = false,
  headerExtra,
  openSignal,
  children,
}: {
  storeKey: string;
  icon: string;
  title: string;
  defaultOpen?: boolean;
  headerExtra?: ReactNode;
  /** 外部信号:值变化(>0)时强制展开本段(如加书签/建文件夹后让用户看到结果)。 */
  openSignal?: number;
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

  // openSignal 变化(>0)→ 强制展开 + 持久化
  useEffect(() => {
    if (openSignal && openSignal > 0) {
      setOpen(true);
      writeCollapsed(storeKey, true);
    }
  }, [openSignal, storeKey]);
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

/**
 * 工作空间段:列出所有工作空间,点击切换并强制进 web view,双击重命名。
 *
 * 工作空间本身已由 workspaceManager 自动持久化(localStorage),这里是「库列表 +
 * 切换 + 重命名」入口。复用 CollapsibleSection 外壳,与书签/下载/历史同组对齐。
 *
 * 用户决策(交互与 note / 书签一致):
 * - 点击列表项 → setActive + 强制 slotBinding.left='web-view'(从 web NavSide 进,默认看 web)
 * - 双击列表项 → inline 重命名(顶部 tab 也可重命名,两处对称)
 * - 右键列表项 → 菜单「重命名 / 删除」(删除 = 从库彻底删,跟 note 删除同走右键菜单)
 */
function WorkspaceSection() {
  const workspaces = useAllWorkspaces();
  const activeId = useActiveWorkspaceId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const openWorkspace = (id: string) => {
    workspaceManager.open(id); // 若已收起,重新打开到顶部 bar
    workspaceManager.setActive(id);
    // 强制进 web view(铁律 9:切主 view 关 right slot)
    workspaceManager.update(
      id,
      {
        slotBinding: {
          left: 'web-view',
          leftPayload: undefined,
          right: null,
          rightPayload: undefined,
        },
      },
      { source: 'navside' },
    );
  };

  const startRename = (id: string, label: string) => {
    setEditingId(id);
    setDraft(label);
  };
  const commitRename = () => {
    if (editingId) {
      const name = draft.trim();
      if (name) workspaceManager.rename(editingId, name);
    }
    setEditingId(null);
  };

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, id });
  };

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          id: 'ws-rename',
          label: '重命名',
          icon: '✏️',
          onClick: () => {
            const ws = workspaceManager.get(menu.id);
            if (ws) startRename(ws.id, ws.label);
          },
        },
        { id: 'ws-del-sep', label: '', separator: true },
        {
          id: 'ws-delete',
          label: '删除',
          icon: '🗑',
          onClick: () => workspaceManager.remove(menu.id),
        },
      ]
    : [];

  return (
    <CollapsibleSection storeKey="workspace" icon="🗂" title="工作空间" defaultOpen>
      <ul className="krig-web-nav__list">
        {workspaces.map((ws) => (
          <li
            key={ws.id}
            className={`krig-web-nav__item krig-ws-item${
              ws.isOpen ? ' krig-ws-item--open' : ''
            }`}
            onClick={() => editingId !== ws.id && openWorkspace(ws.id)}
            onDoubleClick={() => startRename(ws.id, ws.label)}
            onContextMenu={(e) => openMenu(e, ws.id)}
            title={ws.isOpen ? ws.label : `${ws.label}(已收起,点击重新打开)`}
            style={
              ws.id === activeId
                ? { background: 'rgba(138, 180, 248, 0.18)' }
                : undefined
            }
          >
            <div className="krig-web-nav__item-main">
              {editingId === ws.id ? (
                <input
                  className="krig-web-nav__rename-input"
                  value={draft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="krig-web-nav__item-title">{ws.label}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {menu && (
        <ContextMenuPopover
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </CollapsibleSection>
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

/** 书签叶子显示标题兜底:无 title 用 url 的 hostname,再失败用原始 url。 */
function bookmarkTitle(b: BookmarkInfo): string {
  if (b.title) return b.title;
  try {
    return new URL(b.url).hostname;
  } catch {
    return b.url;
  }
}

/**
 * 书签段:FolderTree 树(文件夹分类 + 拖拽 + 重命名 + 右键菜单)。
 *
 * 仿 ebook BookshelfPanel,但包在 CollapsibleSection 里保持垂直折叠(storeKey="bookmark")。
 * 展开/选中态用组件内 useState(transient UI 态,不持久化 — 不动 tab data-model hydrate cache)。
 *
 * ⚠️ 坑(ebook 同款,见 ebook nav-side-content L102-111):必须同时订阅
 * bookmark.onListChanged + folder.onListChanged 两条流 —— 漏订 folder 流则
 * 建文件夹后 UI 不刷新。
 */
function BookmarkSection() {
  const bookmarkApi = useMemo(() => requireCapabilityApi<BookmarkApi>('bookmark'), []);
  const folderApi = useMemo(() => requireCapabilityApi<FolderCapabilityApi>('folder'), []);

  const [bookmarks, setBookmarks] = useState<BookmarkInfo[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);

  // ref 持有最新 bookmarks/folders:全局单例 trigger 回调读 ref,避免捕获过期闭包
  // (rename「看手气」的根因:闭包里 folders 偶尔是旧/空的 → 找不到 cur → 放弃重命名)
  const bookmarksRef = useRef(bookmarks);
  const foldersRef = useRef(folders);
  bookmarksRef.current = bookmarks;
  foldersRef.current = folders;

  // per-ws transient UI 态用组件 useState(不动 tab schema 的 hydrate cache 不变量)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // 加书签/建文件夹后 bump → CollapsibleSection 强制展开(让用户看到结果)
  const [openSignal, setOpenSignal] = useState(0);

  const refresh = useCallback(() => {
    void bookmarkApi.list().then(setBookmarks).catch(() => {});
    void folderApi.listFolders('web').then(setFolders).catch(() => {});
  }, [bookmarkApi, folderApi]);

  useEffect(() => {
    refresh();
    // 两条流都订阅:bookmark(书签)+ folder(文件夹)。漏 folder 流 → 建文件夹后不刷新。
    const unsubBm = bookmarkApi.onListChanged(() => refresh());
    const unsubFolder = folderApi.onListChanged(() => refresh());
    return () => {
      unsubBm();
      unsubFolder();
    };
  }, [bookmarkApi, folderApi, refresh]);

  // 桥接 commands → rename / folder-created / expand / notice
  // 注:trigger 是全局单例,回调内读 ref(bookmarksRef/foldersRef)拿最新值,
  // 故本 effect 只需挂载一次([]),避免随 bookmarks/folders 频繁重注册引入竞态。
  useEffect(() => {
    setRenameTrigger((treeId) => {
      const { type, id } = decodeTreeId(treeId);
      const cur =
        type === 'bookmark'
          ? bookmarksRef.current.find((b) => b.id === id)?.title
          : foldersRef.current.find((f) => f.id === id)?.title;
      // 找不到旧标题也照常进编辑态(不放弃重命名);预填用旧值,缺则留空
      setRenamingId(treeId);
      setRenameValue(cur ?? '');
    });
    setFolderCreatedTrigger((folderId) => {
      const cur = foldersRef.current.find((f) => f.id === folderId);
      setRenamingId(encodeTreeId('folder', folderId));
      setRenameValue(cur?.title ?? '新建文件夹');
    });
    setFolderExpandTrigger((folderId) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(folderId);
        return next;
      });
    });
    setNoticeTrigger((message) => setNotice(message));
    setSectionOpenTrigger(() => setOpenSignal((n) => n + 1));
    return () => {
      setRenameTrigger(null);
      setFolderCreatedTrigger(null);
      setFolderExpandTrigger(null);
      setNoticeTrigger(null);
      setSectionOpenTrigger(null);
    };
  }, []);

  // notice 自动消失
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // ── TreeNode[] 组树 ──
  const buildChildren = (parentId: string | null): TreeNode[] => {
    const out: TreeNode[] = [];
    const subFolders = folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.title.localeCompare(b.title));
    for (const f of subFolders) {
      const node: FolderNode = {
        kind: 'folder',
        id: encodeTreeId('folder', f.id),
        parentId: parentId ? encodeTreeId('folder', parentId) : null,
        title: f.title,
        expanded: expandedFolders.has(f.id),
        children: buildChildren(f.id),
      };
      out.push(node);
    }
    const subBookmarks = bookmarks
      .filter((b) => (b.folderId ?? null) === parentId)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const b of subBookmarks) {
      const node: ItemNode = {
        kind: 'item',
        id: encodeTreeId('bookmark', b.id),
        parentId: parentId ? encodeTreeId('folder', parentId) : null,
        payload: b,
      };
      out.push(node);
    }
    return out;
  };
  const nodes = buildChildren(null);

  // ── 重命名提交(bookmark 走 bookmarkApi, folder 走 folderApi)──
  const commitRename = (treeId: string) => {
    const { type, id } = decodeTreeId(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (type === 'bookmark') void bookmarkApi.rename(id, trimmed);
      else void folderApi.renameFolder(id, trimmed);
    }
    setRenamingId(null);
  };

  // ── 拖拽(含防环:folder 拖进自己子孙拦掉)──
  const isDescendantFolder = (parentId: string, childId: string): boolean => {
    let current: string | null = childId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === parentId) return true;
      const f = folders.find((x) => x.id === current);
      current = f?.parentId ?? null;
    }
    return false;
  };

  const handleDrop = (draggedTreeIds: string[], targetTreeFolderId: string | null) => {
    const targetFolderId = targetTreeFolderId ? decodeTreeId(targetTreeFolderId).id : null;
    let needExpand = false;
    for (const treeId of draggedTreeIds) {
      const { type, id } = decodeTreeId(treeId);
      if (type === 'bookmark') {
        const b = bookmarks.find((x) => x.id === id);
        if (b && (b.folderId ?? null) !== targetFolderId) {
          void bookmarkApi.moveToFolder(id, targetFolderId);
          if (targetFolderId) needExpand = true;
        }
      } else {
        const f = folders.find((x) => x.id === id);
        if (f && f.parentId !== targetFolderId) {
          if (!targetFolderId || !isDescendantFolder(id, targetFolderId)) {
            void folderApi.moveFolder(id, targetFolderId);
            if (targetFolderId) needExpand = true;
          }
        }
      }
    }
    if (needExpand && targetFolderId) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.add(targetFolderId);
        return next;
      });
    }
  };

  // ── 键盘 ──
  const handleKeyAction = (action: KeyAction, target: TreeNode) => {
    if (action === 'enter') {
      if (target.kind === 'item') {
        commandRegistry.execute('web-view.bm-open', decodeTreeId(target.id).id);
      }
    } else if (action === 'rename') {
      // 与 note 一致:重命名是纯本地 UI 操作,直接 setRenamingId,不绕命令 +
      // 全局单例 trigger(那条链路时序脆弱,是双击「看手气」的根因)。
      const { type, id } = decodeTreeId(target.id);
      const cur =
        type === 'bookmark'
          ? bookmarksRef.current.find((b) => b.id === id)?.title
          : foldersRef.current.find((f) => f.id === id)?.title;
      setRenamingId(target.id);
      setRenameValue(cur ?? (target.kind === 'folder' ? target.title : ''));
    } else if (action === 'delete') {
      commandRegistry.execute('web-view.bm-delete', target.id);
    }
  };

  // 注:「+ 书签」「+ 文件夹」按钮在 NavSide 面板顶 actions(registerNavSide),
  // 跟 note/ebook 的「笔记目录 +笔记 +文件夹」对称,不放折叠段 header。

  return (
    <CollapsibleSection storeKey="bookmark" icon="📌" title="书签" openSignal={openSignal}>
      <div className="krig-web-nav__tree">
        <FolderTree
          nodes={nodes}
          selectedIds={selectedIds}
          onSelectChange={setSelectedIds}
          onFolderToggle={(treeFolderId, expanded) => {
            const { id } = decodeTreeId(treeFolderId);
            setExpandedFolders((prev) => {
              const next = new Set(prev);
              if (expanded) next.add(id);
              else next.delete(id);
              return next;
            });
          }}
          itemMeta={(item: ItemNode) => {
            const b = item.payload as BookmarkInfo;
            return {
              icon: '🔖',
              title: bookmarkTitle(b),
              rightHint: '',
            };
          }}
          onItemClick={(item) => {
            commandRegistry.execute('web-view.bm-open', decodeTreeId(item.id).id);
          }}
          onItemDoubleClick={(item) => {
            commandRegistry.execute('web-view.bm-rename', item.id);
          }}
          draggable
          onDrop={handleDrop}
          onKeyAction={handleKeyAction}
          renamingId={renamingId}
          renamingValue={renameValue}
          onRenamingChange={setRenameValue}
          onRenameCommit={commitRename}
          onRenameCancel={() => setRenamingId(null)}
          contextMenuScope="web-view"
          emptyText="点击上方 + 书签 收藏当前页"
          /* 不内部滚:树自然撑高,由整个 NavSide 统一滚动(像 note 文件夹一路展开)*/
          containerStyle={{ flex: 'none', overflowY: 'visible' }}
        />
      </div>
      {notice && <div className="krig-web-nav__notice">{notice}</div>}
    </CollapsibleSection>
  );
}

/** 字节数人类可读(下载段用)。 */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

/** 进行中下载(renderer 内存态,从主进程 onWebDownloadEvent 维护)。 */
interface ActiveDownload {
  id: number;
  filename: string;
  received: number;
  total: number;
}

/** 下载文件名兜底:历史条 filename 为空时用 url 末段。 */
function downloadDisplayName(entry: WebDownloadHistoryEntry): string {
  if (entry.filename) return entry.filename;
  try {
    const u = new URL(entry.url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return seg || u.hostname;
  } catch {
    return entry.url || '(未知文件)';
  }
}

/**
 * 下载段:同时显**进行中**(进度条 + 取消)+ **已完成历史**(在 Finder 显示 / 删记录 / 清空)。
 * 像 Chrome 下载页。
 *
 * - 进行中:订阅 onWebDownloadEvent(started/progress/done,内存态)。
 * - 历史:mount 调 webDownloadList() + 订阅 onWebDownloadHistoryChanged 刷新。
 * - 去重:done 落盘后主进程广播 history-changed,本段从进行中内存移除该 id
 *   (done 事件本身也立即移除进行中,broadcast 只负责把它落到历史列表)。
 */
function DownloadSection() {
  const [active, setActive] = useState<ActiveDownload[]>([]);
  const [history, setHistory] = useState<WebDownloadHistoryEntry[]>([]);

  // 历史:mount 取一次 + 订阅广播刷新。
  useEffect(() => {
    let alive = true;
    void window.electronAPI
      .webDownloadList()
      .then((list) => {
        if (alive) setHistory(list);
      })
      .catch(() => {});
    const off = window.electronAPI.onWebDownloadHistoryChanged((entries) => {
      setHistory(entries);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // 进行中:订阅下载事件。done → 从进行中移除(落到历史由 history-changed 广播刷新)。
  useEffect(() => {
    const off = window.electronAPI.onWebDownloadEvent((payload) => {
      if (payload.type === 'started') {
        setActive((prev) => {
          const without = prev.filter((d) => d.id !== payload.id);
          return [
            ...without,
            {
              id: payload.id,
              filename: payload.filename,
              received: 0,
              total: payload.total ?? 0,
            },
          ];
        });
      } else if (payload.type === 'progress') {
        setActive((prev) =>
          prev.map((d) =>
            d.id === payload.id
              ? {
                  ...d,
                  received: payload.received ?? d.received,
                  total: payload.total ?? d.total,
                }
              : d,
          ),
        );
      } else {
        // done(completed/cancelled/interrupted):从进行中移除(去重),终态进历史。
        setActive((prev) => prev.filter((d) => d.id !== payload.id));
      }
    });
    return off;
  }, []);

  const cancel = (id: number) => {
    void window.electronAPI.webDownloadAction({ id, action: 'cancel' });
  };

  const removeHistory = (id: string) => {
    void window.electronAPI.webDownloadRemove(id);
    // 乐观更新(broadcast 也会刷,双保险)
    setHistory((prev) => prev.filter((e) => e.id !== id));
  };

  const clearAll = () => {
    // 逐条删(无批量 channel)。broadcast 刷新历史。
    for (const e of history) void window.electronAPI.webDownloadRemove(e.id);
    setHistory([]);
  };

  const clearBtn =
    history.length > 0 ? (
      <button
        type="button"
        className="krig-web-nav__clear-btn"
        onClick={(e) => {
          e.stopPropagation();
          clearAll();
        }}
        title="清空下载历史(不删磁盘文件)"
      >
        清空
      </button>
    ) : undefined;

  return (
    <CollapsibleSection storeKey="download" icon="⬇" title="下载" headerExtra={clearBtn}>
      {active.length === 0 && history.length === 0 ? (
        <div className="krig-web-nav__empty">暂无下载</div>
      ) : (
        <ul className="krig-web-nav__list">
          {/* 进行中 */}
          {active.map((d) => {
            const hasTotal = d.total > 0;
            const percent = hasTotal
              ? Math.min(100, Math.round((d.received / d.total) * 100))
              : 0;
            return (
              <li key={`active-${d.id}`} className="krig-web-nav__dl-item">
                <div className="krig-web-nav__dl-row">
                  <span className="krig-web-nav__dl-name" title={d.filename}>
                    {d.filename}
                  </span>
                  <button
                    type="button"
                    className="krig-web-nav__dl-cancel"
                    onClick={() => cancel(d.id)}
                  >
                    取消
                  </button>
                </div>
                <div className="krig-web-nav__dl-track">
                  {hasTotal ? (
                    <div
                      className="krig-web-nav__dl-fill"
                      style={{ width: `${percent}%` }}
                    />
                  ) : (
                    <div className="krig-web-nav__dl-fill krig-web-nav__dl-fill--indeterminate" />
                  )}
                </div>
                <span className="krig-web-nav__dl-meta">
                  {hasTotal
                    ? `${percent}% · ${formatBytes(d.received)} / ${formatBytes(d.total)}`
                    : `下载中… ${formatBytes(d.received)}`}
                </span>
              </li>
            );
          })}

          {/* 已完成历史 */}
          {history.map((entry) => (
            <li key={`hist-${entry.id}`} className="krig-web-nav__dl-item">
              <div className="krig-web-nav__dl-row">
                <span className="krig-web-nav__dl-name" title={entry.url}>
                  {downloadDisplayName(entry)}
                </span>
                <button
                  type="button"
                  className="krig-web-nav__item-del"
                  title="删除此记录(不删磁盘文件)"
                  onClick={() => removeHistory(entry.id)}
                >
                  ×
                </button>
              </div>
              {entry.state === 'completed' ? (
                <div className="krig-web-nav__dl-done-row">
                  <span className="krig-web-nav__dl-meta krig-web-nav__dl-meta--done">
                    ✓ 已完成
                  </span>
                  {entry.savePath && (
                    <button
                      type="button"
                      className="krig-web-nav__dl-show"
                      onClick={() => void window.electronAPI.showItemInFolder(entry.savePath)}
                    >
                      在 Finder 显示
                    </button>
                  )}
                </div>
              ) : (
                <span className="krig-web-nav__dl-meta krig-web-nav__dl-meta--failed">
                  {entry.state === 'cancelled' ? '已取消' : '下载中断'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

/** Web NavSide 三段式折叠面板:书签 / 历史 / 下载。 */
function WebNavPanel() {
  return (
    <div className="krig-web-nav">
      {/* 顺序:工作空间 → 书签 → 下载 → 历史 */}
      <WorkspaceSection />
      <BookmarkSection />
      <DownloadSection />
      <HistorySection />
    </div>
  );
}

export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'web-view',
    title: 'Web',
    // 面板顶 actions(跟 note「+笔记 +文件夹」/ ebook「+文件夹 +导入」对称)。
    actions: [
      { id: 'bm-add', label: '+ 书签', command: 'web-view.bm-add' },
      { id: 'bm-create-folder', label: '+ 文件夹', command: 'web-view.bm-create-folder' },
    ],
    contentRenderer: () => <WebNavPanel />,
  });
}

/**
 * 注册书签 FolderTree 右键菜单(scope='web-view')。
 *
 * 精简版(对 ebook 去掉导入 / 重新定位 / 转管理):
 * 空白处 → 新建文件夹;文件夹 → 在此新建子文件夹 + 重命名 + 删除;
 * 书签 → 重命名 + 移出文件夹 + 删除。
 */
export function registerBookmarkContextMenu(): void {
  // 空白处右键 — 新建文件夹
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-new-folder-blank',
    scope: 'web-view',
    appliesTo: ['blank'],
    label: '新建文件夹',
    icon: '📁',
    command: 'web-view.bm-create-folder',
    order: 10,
  });

  // 文件夹右键 — 在此新建子文件夹
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-new-folder-in',
    scope: 'web-view',
    appliesTo: ['folder'],
    label: '在此新建文件夹',
    icon: '📁',
    command: 'web-view.bm-create-folder-in',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 10,
  });
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-folder-sep',
    scope: 'web-view',
    appliesTo: ['folder'],
    label: '',
    separator: true,
    order: 20,
  });

  // 重命名 — folder + item 都有
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-rename',
    scope: 'web-view',
    appliesTo: ['folder', 'item'],
    label: '重命名',
    icon: '✎',
    disabled: (ctx) => ctx.isMulti,
    command: 'web-view.bm-rename',
    commandArgFn: (ctx) => ctx.targetId,
    order: 30,
  });

  // 移出文件夹 — 仅书签
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-move-out',
    scope: 'web-view',
    appliesTo: ['item'],
    label: '移出文件夹',
    icon: '↗',
    enabledWhen: (ctx) => !ctx.isMulti && ctx.target === 'item',
    command: 'web-view.bm-move-out',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 40,
  });

  // 分隔符 + 删除
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-delete-sep',
    scope: 'web-view',
    appliesTo: ['folder', 'item'],
    label: '',
    separator: true,
    order: 90,
  });
  folderTreeContextMenuRegistry.register({
    id: 'web-bm-delete',
    scope: 'web-view',
    appliesTo: ['folder', 'item'],
    label: (ctx) => (ctx.isMulti ? `删除 ${ctx.selectedCount} 项` : '删除'),
    icon: '🗑',
    command: 'web-view.bm-delete',
    commandArgFn: (ctx) => ctx.targetId,
    order: 100,
  });
}
