/**
 * AuthGate — 顶层授权 gate(包住整个工作区)
 *
 * 渲染策略(设计 §八.7 / 实现计划 §5.2):
 * - loading → 轻量占位(不闪登录页,避免已登录用户冷启动看到登录闪屏,红线 5)。
 * - anonymous / token-expired → 全屏 LoginScreen(未登录不该出现工作区)。
 * - authenticated → 渲染 children(正常工作区)。
 *
 * 挂载位置:src/platform/renderer/index.tsx 的 <App> 内,包住
 * <WorkspaceBar/> + <WorkspaceContainer/>。
 *
 * 多 ws 扇出(红线 4):本 gate 在 App 根挂一次,经 useAuthState 读模块级单例
 * authStore(全 renderer 一个订阅)——不是「每 ws 一份订阅」,天然不会 N 次扇出。
 */

import { useAuthState } from './use-auth-state';
import { LoginScreen } from './LoginScreen';
import './auth.css';

export function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status } = useAuthState();

  if (status === 'loading') {
    return (
      <div className="krig-auth-gate krig-auth-gate--loading">
        <span className="krig-auth-gate__placeholder">正在恢复登录状态…</span>
      </div>
    );
  }

  if (status === 'anonymous' || status === 'token-expired') {
    return (
      <div className="krig-auth-gate">
        <LoginScreen />
      </div>
    );
  }

  // authenticated → 正常工作区
  return <>{children}</>;
}
