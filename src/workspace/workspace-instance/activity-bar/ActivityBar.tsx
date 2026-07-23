/**
 * ActivityBar — 最左侧垂直 icon 条（VSCode 式样）
 *
 * 布局：logo 顶部固定 → view icon 列表居中撑满 → 账号按钮底部固定。
 * 交互：点已激活 tab → toggle NavSide 折叠；点未激活 tab → 切 view + 展开 NavSide。
 */

import { useState, useEffect, useRef } from 'react';
import { useNavSideTabs } from '@slot/frame-bindings/use-registry';
import { useAuthState } from '@capabilities/auth/use-auth-state';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
import { settingsController } from '../settings/settings-controller';
import logoUrl from '../view-switcher-frame/assets/logo.jpeg';
import './activity-bar.css';

function AccountButton() {
  const { status, account } = useAuthState();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const isAuthenticated = status === 'authenticated';
  const avatarLabel =
    isAuthenticated && account?.email ? account.email[0].toUpperCase() : '?';

  const handleLogout = async () => {
    setMenuOpen(false);
    await window.electronAPI?.authLogout?.();
  };

  return (
    <div className="krig-activity-bar__account-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`krig-activity-bar__account${isAuthenticated ? ' krig-activity-bar__account--authed' : ''}`}
        onMouseDown={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        title={account?.email ?? '未登录'}
        aria-label="账号"
      >
        {isAuthenticated ? (
          <span className="krig-activity-bar__avatar">{avatarLabel}</span>
        ) : (
          <span className="krig-activity-bar__icon">👤</span>
        )}
      </button>
      {menuOpen && (
        <div className="krig-activity-bar__account-menu">
          {account?.email && (
            <div className="krig-activity-bar__account-email" title={account.email}>
              {account.email}
            </div>
          )}
          <button
            type="button"
            className="krig-activity-bar__account-logout"
            onMouseDown={handleLogout}
          >
            登出
          </button>
        </div>
      )}
    </div>
  );
}

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
      // navSideDisabled=true 的 view 没有 NavSide 内容，禁止 toggle 展开
      const navSideDisabled = viewTypeRegistry.get(viewId)?.navSideTab?.navSideDisabled;
      if (!navSideDisabled) {
        onToggleCollapse();
      }
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
      <div className="krig-activity-bar__bottom">
        <AccountButton />
        <button
          type="button"
          className="krig-activity-bar__settings"
          title="Settings"
          aria-label="Settings"
          onClick={() => settingsController.open('profiles')}
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
