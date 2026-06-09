/**
 * 单个 Workspace Tab
 *
 * L3 阶段:接入 WorkspaceManager,点击切 active,× 关闭
 * 双击标签 → inline 重命名(与 NavSide 工作空间列表的重命名对称,同走 rename())
 */

import { useState } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';

interface WorkspaceTabProps {
  id: string;
  label: string;
  active: boolean;
}

export function WorkspaceTab({ id, label, active }: WorkspaceTabProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);

  const handleClick = () => {
    if (!editing) workspaceManager.setActive(id);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    workspaceManager.close(id);
  };

  const startEdit = () => {
    setDraft(label);
    setEditing(true);
  };
  const commit = () => {
    const name = draft.trim();
    if (name) workspaceManager.rename(id, name);
    setEditing(false);
  };

  return (
    <div
      className={`krig-workspace-tab ${active ? 'krig-workspace-tab--active' : ''}`}
      onClick={handleClick}
      onDoubleClick={startEdit}
    >
      {editing ? (
        <input
          className="krig-workspace-tab-rename"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="krig-workspace-tab-label">{label}</span>
      )}
      <button
        type="button"
        className="krig-workspace-tab-close"
        onClick={handleClose}
        aria-label={`Close ${label}`}
      >
        ×
      </button>
    </div>
  );
}
