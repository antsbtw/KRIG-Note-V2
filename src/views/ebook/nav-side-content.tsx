/**
 * EBookView NavSide 内容(L5-C1)
 *
 * 三件事:
 * 1) 书架面板(FolderTree + 文件夹 + 书目)+ 搜索框 + 拖拽 + 重命名
 * 2) ImportModal(选 managed / link)
 * 3) 打开失败 toast(D-5 路径失效提示 + 重新定位入口)
 *
 * 数据来源:
 * - 全局书架 / 文件夹 → 走 ebook-library capability(IPC + onBookshelfChanged 推流)
 * - per-ws activeBookId / expandedFolders / selectedIds → views/ebook/data-model
 *
 * 不做(留 C2~C5):
 * - 阅读位置 / 书签同步(C2~C4)
 * - 标注(C5)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { folderTreeContextMenuRegistry } from '@slot/nav-side-registry/folder-tree-context-menu-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { FolderTree, type ItemNode, type TreeNode, type FolderNode, type KeyAction } from '@slot/shared-ui/FolderTree';
import {
  useActiveWorkspaceId,
  useWorkspace,
} from '@workspace/workspace-instance/use-workspace';
import type {
  EBookLibraryApi,
  EBookInfo,
  EBookFileType,
  EBookStorageMode,
  PickFileResult,
} from '@capabilities/ebook-library/types';
import type { FolderCapabilityApi, FolderInfo } from '@capabilities/folder/types';
import {
  getEBookWsState,
  setSelectedIds,
  setFolderExpanded,
} from './data-model';
import {
  encodeTreeId,
  decodeTreeId,
  setImportTrigger,
  setRenameTrigger,
  setFolderCreatedTrigger,
  setOpenFailedTrigger,
} from './bookshelf-commands';

const FILE_ICONS: Record<EBookFileType, string> = {
  pdf: '📄',
  epub: '📖',
  djvu: '📄',
  cbz: '🖼️',
};

/** EBookFileType narrowing helper — 兜底未知 fileType (沿 V2 EBookFileType union 4 项) */
function fileIcon(fileType: string): string {
  return (FILE_ICONS as Record<string, string | undefined>)[fileType] ?? '📄';
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? '昨天' : `${days} 天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} 周前`;
  return new Date(ts).toLocaleDateString();
}

function BookshelfPanel() {
  const wsId = useActiveWorkspaceId();
  const ws = useWorkspace(wsId);

  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );
  // sub-phase 022: folder 走 folder capability + viewType='ebook'
  const folderApi = useMemo(
    () => requireCapabilityApi<FolderCapabilityApi>('folder'),
    [],
  );

  // 订阅全局书架 + 文件夹(书走 ebook capability, 文件夹走 folder capability)
  const [books, setBooks] = useState<EBookInfo[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);

  const refresh = useCallback(() => {
    void library.list().then(setBooks).catch(() => {});
    void folderApi.listFolders('ebook').then(setFolders).catch(() => {});
  }, [library, folderApi]);

  useEffect(() => {
    refresh();
    return library.onBookshelfChanged(() => refresh());
  }, [library, refresh]);

  // 订阅 transient selectedIds(全局 transientVersion 触发)
  // 读 wsState 的 selectedIds 只来自 transient,所以 ws 字段变化不触发 — 单独订阅 version
  // 简单实现:依赖 ws 引用即可,WeakMap 失效会重建 hydrated state
  // (note-view 走单独 transientVersion 订阅,本 C1 暂从简,wsState 的 selectedIds 有滞后但不影响 click)

  // 重命名局部 state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ImportModal 局部 state
  const [importing, setImporting] = useState<PickFileResult | null>(null);
  const [importStorage, setImportStorage] = useState<EBookStorageMode>('managed');

  // 打开失败 toast 局部 state
  const [toast, setToast] = useState<string | null>(null);

  // 桥接 commands → modal / rename / toast
  useEffect(() => {
    setImportTrigger(async () => {
      const picked = await library.pickFile();
      if (picked) {
        setImporting(picked);
        setImportStorage('managed');
      }
    });
    setRenameTrigger((treeId) => {
      const { type, id } = decodeTreeId(treeId);
      const cur =
        type === 'book'
          ? books.find((b) => b.id === id)?.displayName
          : folders.find((f) => f.id === id)?.title;
      if (cur === undefined) return;
      setRenamingId(treeId);
      setRenameValue(cur);
    });
    setFolderCreatedTrigger((folderId) => {
      const cur = folders.find((f) => f.id === folderId);
      setRenamingId(encodeTreeId('folder', folderId));
      setRenameValue(cur?.title ?? '新建文件夹');
    });
    setOpenFailedTrigger((bookId, err) => {
      const book = books.find((b) => b.id === bookId);
      const name = book?.displayName ?? '该书';
      const reason =
        err === 'File not found'
          ? '源文件已丢失(可能被移动 / 删除,或备份还原后路径失效)'
          : err === 'Entry not found'
            ? '书架记录不存在'
            : err || '未知错误';
      setToast(`无法打开「${name}」:${reason}`);
    });
    return () => {
      setImportTrigger(null);
      setRenameTrigger(null);
      setFolderCreatedTrigger(null);
      setOpenFailedTrigger(null);
    };
  }, [library, books, folders]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!wsId || !ws) return null;
  const wsState = getEBookWsState(ws);

  // ── TreeNode[] ──

  const buildChildren = (parentId: string | null): TreeNode[] => {
    const out: TreeNode[] = [];
    // sub-phase 022: FolderInfo 字段 parentId (camelCase) 取代 EBookFolder.parent_id;
    // FolderInfo 无 sort_order 字段, 沿 V2 现状 (note/tree-builder.ts) 字面用 title 排序
    const subFolders = folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.title.localeCompare(b.title));
    for (const f of subFolders) {
      const node: FolderNode = {
        kind: 'folder',
        id: encodeTreeId('folder', f.id),
        parentId: parentId ? encodeTreeId('folder', parentId) : null,
        title: f.title,
        expanded: wsState.expandedFolders.has(f.id),
        children: buildChildren(f.id),
      };
      out.push(node);
    }
    const subBooks = books
      .filter((b) => (b.folderId ?? null) === parentId)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    for (const b of subBooks) {
      const node: ItemNode = {
        kind: 'item',
        id: encodeTreeId('book', b.id),
        parentId: parentId ? encodeTreeId('folder', parentId) : null,
        payload: b,
      };
      out.push(node);
    }
    return out;
  };
  const nodes = buildChildren(null);

  // ── 重命名提交(book 走 ebook capability, folder 走 folder capability) ──

  const commitRename = (treeId: string) => {
    const { type, id } = decodeTreeId(treeId);
    const trimmed = renameValue.trim();
    if (trimmed) {
      if (type === 'book') void library.rename(id, trimmed);
      else void folderApi.renameFolder(id, trimmed);
    }
    setRenamingId(null);
  };

  // ── 拖拽 ──

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
      if (type === 'book') {
        const b = books.find((x) => x.id === id);
        if (b && (b.folderId ?? null) !== targetFolderId) {
          void library.moveToFolder(id, targetFolderId);
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
    if (needExpand && targetFolderId && wsId) {
      setFolderExpanded(wsId, targetFolderId, true);
    }
  };

  // ── 键盘 ──

  const handleKeyAction = (action: KeyAction, target: TreeNode) => {
    if (action === 'enter') {
      if (target.kind === 'item') {
        commandRegistry.execute('ebook-view.open-book', decodeTreeId(target.id).id);
      }
    } else if (action === 'rename') {
      commandRegistry.execute('ebook-view.rename', target.id);
    } else if (action === 'delete') {
      commandRegistry.execute('ebook-view.delete', target.id);
    }
  };

  return (
    <>
      <FolderTree
        nodes={nodes}
        selectedIds={wsState.selectedIds}
        onSelectChange={(ids) => setSelectedIds(wsId, ids)}
        onFolderToggle={(treeFolderId, expanded) => {
          const { id } = decodeTreeId(treeFolderId);
          setFolderExpanded(wsId, id, expanded);
        }}
        itemMeta={(item: ItemNode) => {
          const book = item.payload as EBookInfo;
          return {
            icon: fileIcon(book.fileType),
            title: book.displayName || '未命名',
            rightHint: relativeTime(book.lastOpenedAt),
          };
        }}
        onItemClick={(item) => {
          commandRegistry.execute('ebook-view.open-book', decodeTreeId(item.id).id);
        }}
        onItemDoubleClick={(item) => {
          commandRegistry.execute('ebook-view.rename', item.id);
        }}
        draggable
        onDrop={handleDrop}
        onKeyAction={handleKeyAction}
        renamingId={renamingId}
        renamingValue={renameValue}
        onRenamingChange={setRenameValue}
        onRenameCommit={commitRename}
        onRenameCancel={() => setRenamingId(null)}
        contextMenuScope="ebook-view"
        contextMenuCtxExtra={() => ({
          activeBookId: wsState.activeBookId,
        })}
        emptyText="点击上方 + 导入 添加电子书"
      />

      {importing && (
        <ImportModal
          fileName={importing.fileName}
          storage={importStorage}
          onStorageChange={setImportStorage}
          onConfirm={async () => {
            await library.add(importing.filePath, importing.fileType, importStorage);
            setImporting(null);
          }}
          onCancel={() => setImporting(null)}
        />
      )}

      {toast && (
        <div style={toastStyle} onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </>
  );
}

// ── ImportModal(V1 直迁,样式微调对齐 V2)──

interface ImportModalProps {
  fileName: string;
  storage: EBookStorageMode;
  onStorageChange: (s: EBookStorageMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function ImportModal({
  fileName,
  storage,
  onStorageChange,
  onConfirm,
  onCancel,
}: ImportModalProps) {
  return (
    <div style={modalStyles.overlay} onClick={onCancel}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.title}>导入电子书</div>
        <div style={modalStyles.fileName}>📄 {fileName}</div>

        <label style={modalStyles.radioLabel}>
          <input
            type="radio"
            name="ebook-storage"
            checked={storage === 'managed'}
            onChange={() => onStorageChange('managed')}
          />
          <div>
            <div style={modalStyles.radioTitle}>拷贝到 KRIG 管理(推荐)</div>
            <div style={modalStyles.radioDesc}>
              文件将被复制到 KRIG 资料库中,不会因为原文件移动或删除而丢失。
            </div>
          </div>
        </label>

        <label style={modalStyles.radioLabel}>
          <input
            type="radio"
            name="ebook-storage"
            checked={storage === 'link'}
            onChange={() => onStorageChange('link')}
          />
          <div>
            <div style={modalStyles.radioTitle}>链接原文件</div>
            <div style={modalStyles.radioDesc}>
              仅记录文件路径,不复制文件。移动或删除原文件后将无法打开。
            </div>
          </div>
        </label>

        <div style={modalStyles.actions}>
          <button style={modalStyles.btnCancel} onClick={onCancel}>
            取消
          </button>
          <button style={modalStyles.btnConfirm} onClick={onConfirm}>
            导入
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 注册 ──

/** 注册 NavSide 内容(view 级 — view active 时显示)*/
export function registerNavSide(): void {
  navSideRegistry.register({
    view: 'ebook-view',
    title: '书架',
    actions: [
      { id: 'create-folder', label: '+ 文件夹', command: 'ebook-view.create-folder' },
      { id: 'import', label: '+ 导入', command: 'ebook-view.import' },
    ],
    searchPlaceholder: '搜索书库...',
    onSearch: () => {
      // C1 不实施过滤(留 C3+ 全文搜索时统一做)
    },
    contentRenderer: () => <BookshelfPanel />,
  });
}

/** 注册 FolderTree 右键菜单(scope='ebook-view')*/
export function registerFolderTreeContextMenu(): void {
  // 空白处右键
  folderTreeContextMenuRegistry.register({
    id: 'ebook-new-folder-blank',
    scope: 'ebook-view',
    appliesTo: ['blank'],
    label: '新建文件夹',
    icon: '📁',
    command: 'ebook-view.create-folder',
    order: 10,
  });
  folderTreeContextMenuRegistry.register({
    id: 'ebook-blank-sep',
    scope: 'ebook-view',
    appliesTo: ['blank'],
    label: '',
    separator: true,
    order: 20,
  });
  folderTreeContextMenuRegistry.register({
    id: 'ebook-import-blank',
    scope: 'ebook-view',
    appliesTo: ['blank'],
    label: '导入电子书…',
    icon: '📥',
    command: 'ebook-view.import',
    order: 30,
  });

  // 文件夹右键 — 新建子文件夹
  folderTreeContextMenuRegistry.register({
    id: 'ebook-new-folder-in',
    scope: 'ebook-view',
    appliesTo: ['folder'],
    label: '在此新建文件夹',
    icon: '📁',
    command: 'ebook-view.create-folder-in',
    commandArgFn: (ctx) =>
      ctx.targetId ? decodeTreeId(ctx.targetId).id : null,
    order: 10,
  });
  folderTreeContextMenuRegistry.register({
    id: 'ebook-folder-sep1',
    scope: 'ebook-view',
    appliesTo: ['folder'],
    label: '',
    separator: true,
    order: 20,
  });

  // 重命名 — folder + item 都有
  folderTreeContextMenuRegistry.register({
    id: 'ebook-rename',
    scope: 'ebook-view',
    appliesTo: ['folder', 'item'],
    label: '重命名',
    icon: '✎',
    disabled: (ctx) => ctx.isMulti,
    command: 'ebook-view.rename',
    commandArgFn: (ctx) => ctx.targetId,
    order: 30,
  });

  // 移出文件夹 — 仅书 + 当前在某文件夹内
  folderTreeContextMenuRegistry.register({
    id: 'ebook-move-out',
    scope: 'ebook-view',
    appliesTo: ['item'],
    label: '移出文件夹',
    icon: '↗',
    enabledWhen: (ctx) => {
      // 只在书 + 已在文件夹内时显示;ctx.extra 不直接有书的 folderId,
      // 简化为"item 且非根目录拖出过的书"— 由于 ctx 不含 folderId 信息,
      // 这里只能宽松显示,用户点了无效会无操作(library.moveToFolder(id, null) 是幂等的)
      return !ctx.isMulti && ctx.target === 'item';
    },
    command: 'ebook-view.move-out',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 40,
  });

  // 重新定位(D-5)
  folderTreeContextMenuRegistry.register({
    id: 'ebook-relocate',
    scope: 'ebook-view',
    appliesTo: ['item'],
    label: '重新定位…',
    icon: '🔍',
    enabledWhen: (ctx) => !ctx.isMulti,
    command: 'ebook-view.relocate',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 50,
  });

  // link → managed
  folderTreeContextMenuRegistry.register({
    id: 'ebook-transfer',
    scope: 'ebook-view',
    appliesTo: ['item'],
    label: '拷贝到 KRIG 管理',
    icon: '📥',
    enabledWhen: (ctx) => !ctx.isMulti,
    command: 'ebook-view.transfer-to-managed',
    commandArgFn: (ctx) => (ctx.targetId ? decodeTreeId(ctx.targetId).id : null),
    order: 60,
  });

  // 分隔符 + 删除
  folderTreeContextMenuRegistry.register({
    id: 'ebook-delete-sep',
    scope: 'ebook-view',
    appliesTo: ['folder', 'item'],
    label: '',
    separator: true,
    order: 90,
  });
  folderTreeContextMenuRegistry.register({
    id: 'ebook-delete',
    scope: 'ebook-view',
    appliesTo: ['folder', 'item'],
    label: (ctx) =>
      ctx.isMulti ? `删除 ${ctx.selectedCount} 项` : '删除',
    icon: '🗑',
    command: 'ebook-view.delete',
    commandArgFn: (ctx) => ctx.targetId,
    order: 100,
  });
}

// ── inline styles(对齐 V1 ImportModal + toast)──

const toastStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 12,
  background: '#5a2222',
  border: '1px solid #a04040',
  color: '#ffd6d6',
  fontSize: 12,
  lineHeight: 1.4,
  padding: '8px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  zIndex: 100,
  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
};

const modalStyles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 10,
    padding: '20px 24px',
    width: 360,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e8eaed',
    marginBottom: 12,
  },
  fileName: {
    fontSize: 13,
    color: '#ccc',
    padding: '8px 10px',
    background: '#333',
    borderRadius: 6,
    marginBottom: 16,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0',
    cursor: 'pointer',
  },
  radioTitle: {
    fontSize: 13,
    color: '#e8eaed',
    fontWeight: 500,
  },
  radioDesc: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  btnCancel: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 6,
    color: '#ccc',
    fontSize: 13,
    padding: '6px 16px',
    cursor: 'pointer',
  },
  btnConfirm: {
    background: '#3b82f6',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    padding: '6px 16px',
    cursor: 'pointer',
  },
};
