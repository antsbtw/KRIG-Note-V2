/**
 * 单个 Workspace Tab
 *
 * 按 src/shell/DESIGN.md v0.3 § 1:
 * - UI 渲染在 L2 WorkspaceBar(本组件)
 * - 数据来源 / 切换 / 关闭逻辑在 L3 WorkspaceManager
 *
 * L2 阶段:不渲染任何 Tab(因为还没有 Workspace 实例),等 L3 接入。
 * 本文件先占位,L3 阶段会被 WorkspaceBar 调用。
 */

interface WorkspaceTabProps {
  /** Workspace ID */
  id: string;
  /** Tab 显示文字 */
  label: string;
  /** 是否活跃 */
  active: boolean;
  /** 点击 Tab(切 active) */
  onActivate: (id: string) => void;
  /** 点击 × 关闭 */
  onClose: (id: string) => void;
}

export function WorkspaceTab({ id, label, active, onActivate, onClose }: WorkspaceTabProps) {
  return (
    <div
      className={`krig-workspace-tab ${active ? 'krig-workspace-tab--active' : ''}`}
      onClick={() => onActivate(id)}
    >
      <span className="krig-workspace-tab-label">{label}</span>
      <button
        type="button"
        className="krig-workspace-tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose(id);
        }}
        aria-label={`Close ${label}`}
      >
        ×
      </button>
    </div>
  );
}
