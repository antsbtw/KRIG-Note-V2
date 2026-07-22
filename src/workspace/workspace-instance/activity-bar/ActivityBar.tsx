/**
 * ActivityBar — 最左侧垂直 icon 条（VSCode 式样）
 *
 * 布局：logo 顶部固定 → view icon 列表居中撑满 → 底部留空（未来放设置等）。
 * 交互：点已激活 tab → toggle NavSide 折叠；点未激活 tab → 切 view + 展开 NavSide。
 */

import { useNavSideTabs } from '@slot/frame-bindings/use-registry';
import logoUrl from '../view-switcher-frame/assets/logo.jpeg';
import './activity-bar.css';

interface ActivityBarProps {
  activeViewId: string | null;
  navSideCollapsed: boolean;
  onSwitch: (viewId: string) => void;
  onToggleCollapse: () => void;
}

export function ActivityBar({
  activeViewId,
  navSideCollapsed,
  onSwitch,
  onToggleCollapse,
}: ActivityBarProps) {
  const tabs = useNavSideTabs();

  const handleClick = (viewId: string) => {
    if (viewId === activeViewId) {
      onToggleCollapse();
    } else {
      onSwitch(viewId);
    }
  };

  return (
    <div className="krig-activity-bar">
      <div className="krig-activity-bar__logo">
        <img src={logoUrl} alt="KRIG" className="krig-activity-bar__logo-img" />
      </div>
      <div className="krig-activity-bar__tabs">
        {tabs.map((view) => {
          const isActive = view.id === activeViewId && !navSideCollapsed;
          return (
            <button
              key={view.id}
              type="button"
              className={`krig-activity-bar__tab${isActive ? ' krig-activity-bar__tab--active' : ''}`}
              onClick={() => handleClick(view.id)}
              title={view.navSideTab!.label}
              aria-label={view.navSideTab!.label}
            >
              <span className="krig-activity-bar__icon">{view.navSideTab!.icon}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
