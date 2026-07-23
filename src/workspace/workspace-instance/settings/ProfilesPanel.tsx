/**
 * ProfilesPanel — Settings > Profiles 面板
 *
 * 每个 Workspace 就是一个独立的工作环境（Profile）。
 * 在这里直接编辑每个 Workspace 的网络隔离配置（代理、UA）和显示颜色。
 */

import { useState } from 'react';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { useAllWorkspaces, getMyWsId } from '../use-workspace';
import { ipcWorkspaceSetConfig, ipcWorkspaceRename, ipcWorkspaceRemove } from '../../ipc/workspace-ipc';
import './profiles-panel.css';

const COLOR_OPTIONS = [
  { value: 'blue',   hex: '#4a90d9' },
  { value: 'green',  hex: '#4caf7d' },
  { value: 'purple', hex: '#9c6fdb' },
  { value: 'red',    hex: '#e05c5c' },
  { value: 'orange', hex: '#d97b3a' },
  { value: 'gray',   hex: '#737373' },
];

function colorHex(color?: string): string {
  return COLOR_OPTIONS.find((c) => c.value === color)?.hex ?? '#444';
}

// ── 单个 Workspace 行（可展开编辑）──────────────────────────────

interface WsRowProps {
  ws: WorkspaceState;
  expanded: boolean;
  onToggle: () => void;
  isCurrent: boolean;
}

function WsRow({ ws, expanded, onToggle, isCurrent }: WsRowProps) {
  const [name, setName]           = useState(ws.label);
  const [proxyId, setProxyId]     = useState(ws.proxyId ?? '');
  const [userAgent, setUserAgent] = useState(ws.userAgent ?? '');
  const [color, setColor]         = useState(ws.color ?? '');
  const [saving, setSaving]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 打开时重置为当前值
  const handleToggle = () => {
    if (!expanded) {
      setName(ws.label);
      setProxyId(ws.proxyId ?? '');
      setUserAgent(ws.userAgent ?? '');
      setColor(ws.color ?? '');
      setConfirmDelete(false);
    }
    onToggle();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== ws.label) {
        await ipcWorkspaceRename(ws.id, trimmedName);
      }
      await ipcWorkspaceSetConfig(ws.id, {
        color: color || undefined,
        proxyId: proxyId.trim() || null,
        userAgent: userAgent.trim() || null,
      });
      onToggle(); // 保存后收起
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await ipcWorkspaceRemove(ws.id);
  };

  const hasConfig = !!(ws.proxyId || ws.userAgent || ws.color);

  return (
    <div className={`krig-ws-profile-row${expanded ? ' krig-ws-profile-row--expanded' : ''}${isCurrent ? ' krig-ws-profile-row--current' : ''}`}>
      {/* 折叠头 */}
      <div className="krig-ws-profile-row__header" onClick={handleToggle}>
        <span
          className="krig-ws-profile-row__dot"
          style={{ background: ws.color ? colorHex(ws.color) : '#333', border: ws.color ? 'none' : '1px solid #444' }}
        />
        <span className="krig-ws-profile-row__name">{ws.label}</span>
        <div className="krig-ws-profile-row__badges">
          {ws.proxyId && <span className="krig-ws-profile-row__badge" title={`Proxy: ${ws.proxyId}`}>proxy</span>}
          {ws.userAgent && <span className="krig-ws-profile-row__badge" title={`UA: ${ws.userAgent}`}>ua</span>}
          {!hasConfig && <span className="krig-ws-profile-row__badge krig-ws-profile-row__badge--dim">直连</span>}
        </div>
        <span className="krig-ws-profile-row__chevron">{expanded ? '▲' : '▼'}</span>
      </div>

      {/* 展开编辑区 */}
      {expanded && (
        <div className="krig-ws-profile-row__body">
          <label className="krig-ws-profile-edit__field">
            <span className="krig-ws-profile-edit__label">Name</span>
            <input
              className="krig-ws-profile-edit__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workspace name"
            />
          </label>

          <div className="krig-ws-profile-edit__field">
            <span className="krig-ws-profile-edit__label">Color</span>
            <div className="krig-ws-profile-edit__colors">
              <button
                type="button"
                className={`krig-ws-profile-edit__color-dot${!color ? ' krig-ws-profile-edit__color-dot--active' : ''}`}
                style={{ background: '#333', border: '1px solid #555' }}
                title="无颜色"
                onClick={() => setColor('')}
              />
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`krig-ws-profile-edit__color-dot${color === c.value ? ' krig-ws-profile-edit__color-dot--active' : ''}`}
                  style={{ background: c.hex }}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </div>
          </div>

          <label className="krig-ws-profile-edit__field">
            <span className="krig-ws-profile-edit__label">Proxy</span>
            <input
              className="krig-ws-profile-edit__input"
              value={proxyId}
              onChange={(e) => setProxyId(e.target.value)}
              placeholder="Proxy node ID（留空 = 直连）"
            />
          </label>

          <label className="krig-ws-profile-edit__field">
            <span className="krig-ws-profile-edit__label">User Agent</span>
            <input
              className="krig-ws-profile-edit__input"
              value={userAgent}
              onChange={(e) => setUserAgent(e.target.value)}
              placeholder="留空 = 默认 UA"
            />
          </label>

          <div className="krig-ws-profile-edit__field">
            <span className="krig-ws-profile-edit__label">Session</span>
            <span className="krig-ws-profile-edit__partition">
              persist:webview-{ws.id}
            </span>
          </div>

          <div className="krig-ws-profile-edit__actions">
            {confirmDelete ? (
              <>
                <span className="krig-ws-profile-edit__delete-confirm-text">Delete this workspace?</span>
                <button type="button" className="krig-ws-profile-edit__btn-cancel" onClick={() => setConfirmDelete(false)}>
                  No
                </button>
                <button type="button" className="krig-ws-profile-edit__btn-delete-confirm" onClick={handleDelete}>
                  Yes, delete
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="krig-ws-profile-edit__btn-delete"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isCurrent}
                  title={isCurrent ? 'Cannot delete the current workspace' : undefined}
                >
                  Delete
                </button>
                <div style={{ flex: 1 }} />
                <button type="button" className="krig-ws-profile-edit__btn-cancel" onClick={handleToggle}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="krig-ws-profile-edit__btn-save"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主面板 ───────────────────────────────────────────────────────

export function ProfilesPanel() {
  const workspaces = useAllWorkspaces();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const myWsId = getMyWsId();

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="krig-profiles">
      <div className="krig-profiles-section__title" style={{ marginBottom: 12 }}>Workspaces</div>
      <div className="krig-profiles-ws-list">
        {workspaces.map((ws) => (
          <WsRow
            key={ws.id}
            ws={ws}
            expanded={expandedId === ws.id}
            onToggle={() => toggle(ws.id)}
            isCurrent={ws.id === myWsId}
          />
        ))}
      </div>
    </div>
  );
}
