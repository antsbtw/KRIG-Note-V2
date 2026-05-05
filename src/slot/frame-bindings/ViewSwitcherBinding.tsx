/**
 * ViewSwitcher Binding — NavSide 顶部 view 切换条
 *
 * 订阅 viewTypeRegistry.getAllForNavSide(),按 order 排好的 view 列表。
 * 点击切换:调 onSwitch(viewId) — 由父组件(WorkspaceInstance)决定怎么切。
 *
 * 按 charter § 1.4:式样在 Workspace,内容由 viewTypeRegistry 注册驱动。
 */

import { useNavSideTabs } from './use-registry';

interface ViewSwitcherBindingProps {
  /** 当前活跃 view ID(高亮当前 tab)*/
  activeViewId: string | null;
  /** 切换 view 回调 */
  onSwitch: (viewId: string) => void;
}

export function ViewSwitcherBinding({ activeViewId, onSwitch }: ViewSwitcherBindingProps) {
  const tabs = useNavSideTabs();

  if (tabs.length === 0) {
    return (
      <div className="krig-view-switcher-empty">(待 view 注册)</div>
    );
  }

  return (
    <div className="krig-view-switcher">
      {tabs.map((view) => {
        const isActive = view.id === activeViewId;
        return (
          <button
            key={view.id}
            type="button"
            className={`krig-view-switcher-tab${isActive ? ' krig-view-switcher-tab--active' : ''}`}
            onClick={() => onSwitch(view.id)}
            title={view.navSideTab!.label}
          >
            <span className="krig-view-switcher-icon">{view.navSideTab!.icon}</span>
            <span className="krig-view-switcher-label">{view.navSideTab!.label}</span>
          </button>
        );
      })}
    </div>
  );
}
