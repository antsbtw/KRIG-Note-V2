/**
 * 新建 Workspace [+] 按钮
 *
 * 按 src/shell/DESIGN.md v0.3 § 1:
 * - UI 渲染在 L2 WorkspaceBar(本组件)
 * - 触发时调 workspaceManager.create()(L3 提供)
 *
 * L2 阶段:占位按钮,触发暂不工作(等 L3 接入 WorkspaceManager)
 */

export function AddWorkspaceButton() {
  const handleClick = () => {
    console.log('[L2] [+] new workspace clicked (L3 待接入)');
  };

  return (
    <button
      type="button"
      className="krig-add-workspace"
      onClick={handleClick}
      title="新建 Workspace(L3 待接入)"
      aria-label="Add Workspace"
    >
      +
    </button>
  );
}
