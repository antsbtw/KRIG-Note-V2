/**
 * auth capability 对外类型(供 shell / view 经 requireCapabilityApi 间接消费)
 *
 * shell/view 层不直 import capability 运行时值(eslint W5 设计 §5 硬约束),
 * 只 `import type { AuthApi } from '@capabilities/auth/types'`,运行时走
 * `requireCapabilityApi<AuthApi>('auth').StatusBadge`。
 *
 * 对齐 web-rendering 的 `WebRenderingApi.Host` 范式(view 经 api 拿 React 组件)。
 */

/** auth capability 暴露给 shell/view 的 API(只含 UI 组件;登录态读 useAuthState)*/
export interface AuthApi {
  /** WorkspaceBar 最右端徽标(账号邮箱 + 登出);未登录返 null */
  StatusBadge: () => React.ReactElement | null;
}
