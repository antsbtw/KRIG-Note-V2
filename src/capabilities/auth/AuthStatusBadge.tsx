/**
 * AuthStatusBadge — WorkspaceBar 最右端的账号徽标
 *
 * 显示账号邮箱;点击弹出登出。(本期不做授权 → 无倒计时/剩余天数。)
 *
 * 数据来源:同一个模块级单例 authStore(经 useAuthState),**不新增订阅**
 * (红线 4:badge 与 AuthGate 共用一份快照,一个 renderer 仍只一个 onAuthChanged)。
 *
 * 登出:走 authStore.logout() → main 清 token + 广播 anonymous → AuthGate 回登录页。
 */

import { useState } from 'react';
import { useAuthState } from './use-auth-state';
import { authStore } from './index';
import './auth.css';

export function AuthStatusBadge(): React.ReactElement | null {
  const { status, account } = useAuthState();
  const [menuOpen, setMenuOpen] = useState(false);

  // 仅已登录时显示(未登录/loading 不挂 badge,工作区本就被 gate 挡住)
  if (status !== 'authenticated') return null;

  // 邮箱本地名(@ 前)做紧凑标签,hover 显全邮箱
  const label = account?.email ? account.email.split('@')[0] : '账号';

  async function handleLogout(): Promise<void> {
    setMenuOpen(false);
    await authStore.logout();
  }

  return (
    <div className="krig-auth-badge">
      <button
        type="button"
        className="krig-auth-badge__chip"
        onClick={() => setMenuOpen((v) => !v)}
        title={account?.email}
      >
        {label}
      </button>
      {menuOpen && (
        <div className="krig-auth-badge__menu">
          {account?.email && (
            <div className="krig-auth-badge__email" title={account.email}>
              {account.email}
            </div>
          )}
          <button
            type="button"
            className="krig-auth-badge__logout"
            onClick={handleLogout}
          >
            登出
          </button>
        </div>
      )}
    </div>
  );
}
