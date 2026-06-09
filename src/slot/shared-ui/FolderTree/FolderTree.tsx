/**
 * FolderTree — 通用树状列表组件(框架层共用)
 *
 * 1:1 沿用 V1 src/renderer/navside/components/FolderTree/FolderTree.tsx。
 * 改造点:contextMenu callback 改为 contextMenuScope + folderTreeContextMenuRegistry(Q7=方案 2);
 *         菜单浮层从内置 ContextMenu 改为 import ContextMenuPopover。
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
} from 'react';
import {
  type FolderTreeProps,
  type TreeNode,
  type FolderNode,
  type ItemNode,
  type ContextMenuItem,
  type FolderTreeContextInfo,
  type KeyAction,
} from './types';
import { styles, TREE_INDENT_PX } from './styles';
import { ContextMenuPopover } from '../ContextMenuPopover';
import { folderTreeContextMenuRegistry } from '@slot/nav-side-registry/folder-tree-context-menu-registry';

export function FolderTree({
  nodes,
  selectedIds,
  onSelectChange,
  onFolderToggle,
  itemMeta,
  onItemClick,
  onItemDoubleClick,
  draggable = false,
  onDrop,
  onKeyAction,
  renamingId,
  renamingValue = '',
  onRenamingChange,
  onRenameCommit,
  onRenameCancel,
  contextMenuScope,
  contextMenuCtxExtra,
  emptyText = '暂无内容',
  containerStyle,
}: FolderTreeProps) {
  const rootStyle = containerStyle ? { ...styles.container, ...containerStyle } : styles.container;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragHoverFolderId, setDragHoverFolderId] = useState<string | null | 'root'>(null);

  const [menuState, setMenuState] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenuState(null), []);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 把树展平成可见行
  const visibleRows: Array<{ node: TreeNode; depth: number }> = [];
  function walk(list: TreeNode[], depth: number) {
    for (const n of list) {
      visibleRows.push({ node: n, depth });
      if (n.kind === 'folder' && n.expanded) walk(n.children, depth + 1);
    }
  }
  walk(nodes, 0);

  // ── 单击 ──
  const handleClick = (node: TreeNode, e: React.MouseEvent) => {
    setFocusedId(node.id);
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedIds);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      onSelectChange(next);
    } else if (e.shiftKey && focusedId) {
      const idxA = visibleRows.findIndex((r) => r.node.id === focusedId);
      const idxB = visibleRows.findIndex((r) => r.node.id === node.id);
      if (idxA >= 0 && idxB >= 0) {
        const [a, b] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        const next = new Set(selectedIds);
        for (let i = a; i <= b; i++) next.add(visibleRows[i].node.id);
        onSelectChange(next);
      }
    } else {
      onSelectChange(new Set([node.id]));
      if (node.kind === 'folder') {
        onFolderToggle(node.id, !node.expanded);
      }
    }
    if (node.kind === 'item') onItemClick?.(node, e);
  };

  const handleCaretClick = (folder: FolderNode, e: React.MouseEvent) => {
    e.stopPropagation();
    onFolderToggle(folder.id, !folder.expanded);
  };

  // 双击进入重命名
  const handleDoubleClick = (node: TreeNode) => {
    if (node.kind === 'item') onItemDoubleClick?.(node);
    else onKeyAction?.('rename', node);
  };

  // ── 右键菜单 ──
  const buildCtx = (target: TreeNode | null): FolderTreeContextInfo => ({
    scope: contextMenuScope ?? '',
    target: target ? target.kind : 'blank',
    targetId: target?.id ?? null,
    isMulti: selectedIds.size > 1 && (target ? selectedIds.has(target.id) : false),
    selectedCount: selectedIds.size,
    hasClipboard: false, // 业务通过 extra 提供;registry 内 enabledWhen 自己读 extra
    extra: contextMenuCtxExtra?.() ?? {},
  });

  const handleContextMenu = (target: TreeNode | null, e: React.MouseEvent) => {
    if (!contextMenuScope) return;
    e.preventDefault();
    e.stopPropagation();
    const ctx = buildCtx(target);
    // hasClipboard 让 registry 通过 ctx.extra 自取(简化:这里也读 extra.hasClipboard 兜底)
    if (ctx.extra && typeof ctx.extra.hasClipboard === 'boolean') {
      ctx.hasClipboard = ctx.extra.hasClipboard;
    }
    const items = folderTreeContextMenuRegistry.getItems(contextMenuScope, ctx);
    if (items.length > 0) {
      setMenuState({ x: e.clientX, y: e.clientY, items });
    }
  };

  // ── 拖拽 ──
  const handleDragStart = (node: TreeNode, e: React.DragEvent) => {
    if (!draggable) return;
    const ids = selectedIds.has(node.id) ? Array.from(selectedIds) : [node.id];
    e.dataTransfer.setData('application/krig-tree-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    if (!selectedIds.has(node.id)) onSelectChange(new Set([node.id]));
  };

  const handleDragOverFolder = (folder: FolderNode | null, e: React.DragEvent) => {
    if (!draggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragHoverFolderId(folder?.id ?? 'root');
  };

  const handleDragLeaveFolder = (folder: FolderNode | null, e: React.DragEvent) => {
    if (!draggable) return;
    e.stopPropagation();
    if (dragHoverFolderId === (folder?.id ?? 'root')) setDragHoverFolderId(null);
  };

  const handleDropOnFolder = (folder: FolderNode | null, e: React.DragEvent) => {
    if (!draggable) return;
    e.preventDefault();
    e.stopPropagation();
    setDragHoverFolderId(null);
    try {
      const raw = e.dataTransfer.getData('application/krig-tree-ids');
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids) && ids.length > 0) {
        const targetId = folder?.id ?? null;
        if (targetId && ids.includes(targetId)) return;
        onDrop?.(ids, targetId);
      }
    } catch {
      /* 忽略非 tree drop */
    }
  };

  // ── 键盘 ──
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedId || visibleRows.length === 0) return;
    const idx = visibleRows.findIndex((r) => r.node.id === focusedId);
    if (idx < 0) return;
    const focusedNode = visibleRows[idx].node;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < visibleRows.length - 1) {
        const next = visibleRows[idx + 1].node;
        setFocusedId(next.id);
        if (!e.shiftKey && !(e.metaKey || e.ctrlKey)) onSelectChange(new Set([next.id]));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) {
        const prev = visibleRows[idx - 1].node;
        setFocusedId(prev.id);
        if (!e.shiftKey && !(e.metaKey || e.ctrlKey)) onSelectChange(new Set([prev.id]));
      }
    } else if (e.key === 'ArrowRight' && focusedNode.kind === 'folder' && !focusedNode.expanded) {
      e.preventDefault();
      onFolderToggle(focusedNode.id, true);
    } else if (e.key === 'ArrowLeft' && focusedNode.kind === 'folder' && focusedNode.expanded) {
      e.preventDefault();
      onFolderToggle(focusedNode.id, false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const action: KeyAction = 'enter';
      onKeyAction?.(action, focusedNode);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onKeyAction?.('delete', focusedNode);
    } else if (e.key === 'F2') {
      e.preventDefault();
      onKeyAction?.('rename', focusedNode);
    }
  };

  useEffect(() => {
    if (focusedId && containerRef.current && document.activeElement !== containerRef.current) {
      containerRef.current.focus();
    }
  }, [focusedId]);

  // ── 渲染 ──
  if (visibleRows.length === 0) {
    return (
      <div
        data-krig-context-menu-handled
        style={rootStyle}
        onContextMenu={(e) => handleContextMenu(null, e)}
        onDragOver={(e) => handleDragOverFolder(null, e)}
        onDragLeave={(e) => handleDragLeaveFolder(null, e)}
        onDrop={(e) => handleDropOnFolder(null, e)}
      >
        <div style={styles.empty}>{emptyText}</div>
        {menuState && <ContextMenuPopover {...menuState} onClose={closeMenu} />}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-krig-context-menu-handled
      style={rootStyle}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) handleContextMenu(null, e);
      }}
      onDragOver={(e) => {
        if (e.target === e.currentTarget) handleDragOverFolder(null, e);
      }}
      onDrop={(e) => {
        if (e.target === e.currentTarget) handleDropOnFolder(null, e);
      }}
    >
      {visibleRows.map(({ node, depth }) => {
        const isSelected = selectedIds.has(node.id);
        const isHovered = hoveredId === node.id;
        const isDropTarget = node.kind === 'folder' && dragHoverFolderId === node.id;

        const rowStyle: CSSProperties = {
          ...styles.row,
          paddingLeft: 8 + depth * TREE_INDENT_PX,
          ...(isHovered && !isSelected ? styles.rowHover : {}),
          ...(isSelected ? styles.rowSelected : {}),
          ...(isDropTarget ? styles.rowDropTarget : {}),
        };

        const handlers = {
          onClick: (e: React.MouseEvent) => handleClick(node, e),
          onDoubleClick: () => handleDoubleClick(node),
          onContextMenu: (e: React.MouseEvent) => handleContextMenu(node, e),
          onMouseEnter: () => setHoveredId(node.id),
          onMouseLeave: () => setHoveredId(null),
          ...(draggable
            ? {
                draggable: true,
                onDragStart: (e: React.DragEvent) => handleDragStart(node, e),
                ...(node.kind === 'folder'
                  ? {
                      onDragOver: (e: React.DragEvent) => handleDragOverFolder(node, e),
                      onDragLeave: (e: React.DragEvent) => handleDragLeaveFolder(node, e),
                      onDrop: (e: React.DragEvent) => handleDropOnFolder(node, e),
                    }
                  : {}),
              }
            : {}),
        };

        const isRenaming = renamingId === node.id;
        const titleSlot = isRenaming ? (
          <RenameInput
            value={renamingValue}
            onChange={onRenamingChange ?? (() => {})}
            onCommit={() => onRenameCommit?.(node.id)}
            onCancel={() => onRenameCancel?.()}
          />
        ) : (
          <span style={styles.title}>
            {node.kind === 'folder' ? node.title : itemMeta(node).title}
          </span>
        );

        if (node.kind === 'folder') {
          const showOpen = node.expanded || isDropTarget;
          return (
            <div key={node.id} style={rowStyle} {...handlers}>
              <span
                style={styles.caret}
                onClick={(e) => handleCaretClick(node, e)}
                title={node.expanded ? '折叠' : '展开'}
              >
                {node.expanded ? '▼' : '▶'}
              </span>
              <span style={styles.icon}>{showOpen ? '📂' : '📁'}</span>
              {titleSlot}
            </div>
          );
        }

        // item
        const meta = itemMeta(node);
        return (
          <div key={node.id} style={rowStyle} {...handlers}>
            <span style={styles.caret}></span>
            <span style={styles.icon}>{meta.icon}</span>
            {titleSlot}
            {!isRenaming && meta.rightHint && <span style={styles.rightHint}>{meta.rightHint}</span>}
          </div>
        );
      })}
      {menuState && <ContextMenuPopover {...menuState} onClose={closeMenu} />}
    </div>
  );
}

export type { TreeNode, FolderNode, ItemNode };

// ── 重命名内联输入 ──

function RenameInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  return (
    <input
      ref={inputRef}
      style={{
        ...styles.title,
        background: 'rgba(74, 144, 226, 0.15)',
        border: '1px solid #4a90e2',
        borderRadius: 3,
        color: '#fff',
        outline: 'none',
        padding: '0 4px',
        fontSize: 13,
        fontFamily: 'inherit',
        minWidth: 0,
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
