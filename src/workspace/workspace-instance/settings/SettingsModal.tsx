/**
 * SettingsModal — 全局 Settings 弹窗
 *
 * 布局：左侧导航栏（Profiles / Network / General）+ 右侧内容区。
 * 挂在 WorkspaceInstance 根，不属于任何 slot/overlay 体系。
 * 点击背景或按 Esc 关闭。
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { settingsController, type SettingsPanel } from './settings-controller';
import { ProfilesPanel } from './ProfilesPanel';
import './settings.css';

function useSettingsState() {
  return useSyncExternalStore(
    (cb) => settingsController.subscribe(cb),
    () => settingsController.getState(),
  );
}

const NAV_ITEMS: { id: SettingsPanel; label: string; icon: string }[] = [
  { id: 'profiles', label: 'Profiles', icon: '🪪' },
  { id: 'network',  label: 'Network',  icon: '🌐' },
  { id: 'general',  label: 'General',  icon: '⚙' },
];

export function SettingsModal() {
  const { visible, activePanel } = useSettingsState();

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settingsController.close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="krig-settings-backdrop"
      onMouseDown={() => settingsController.close()}
    >
      <div
        className="krig-settings-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 左侧导航 */}
        <nav className="krig-settings-nav">
          <div className="krig-settings-nav__title">Settings</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`krig-settings-nav__item${activePanel === item.id ? ' krig-settings-nav__item--active' : ''}`}
              onClick={() => settingsController.setPanel(item.id)}
            >
              <span className="krig-settings-nav__icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="krig-settings-nav__spacer" />
          <button
            type="button"
            className="krig-settings-nav__close"
            onClick={() => settingsController.close()}
            aria-label="Close settings"
          >
            ✕ Close
          </button>
        </nav>

        {/* 右侧内容区 */}
        <div className="krig-settings-content">
          {activePanel === 'profiles' && <ProfilesPanel />}
          {activePanel === 'network'  && <NetworkPlaceholder />}
          {activePanel === 'general'  && <GeneralPlaceholder />}
        </div>
      </div>
    </div>
  );
}

function NetworkPlaceholder() {
  return (
    <div className="krig-settings-placeholder">
      <div className="krig-settings-placeholder__icon">🌐</div>
      <div className="krig-settings-placeholder__text">Network settings coming soon</div>
    </div>
  );
}

function GeneralPlaceholder() {
  return (
    <div className="krig-settings-placeholder">
      <div className="krig-settings-placeholder__icon">⚙</div>
      <div className="krig-settings-placeholder__text">General settings coming soon</div>
    </div>
  );
}

// 兼容旧引用：无状态钩子，外部可直接 import useState 读取
export { useSettingsState };
