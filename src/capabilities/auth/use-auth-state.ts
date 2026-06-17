/**
 * useAuthState — 订阅 authStore 的 React hook
 *
 * 用 useSyncExternalStore 接模块级单例 authStore(对齐 React 19 外部 store 范式)。
 * 返回当前 public AuthState 快照(不含 token);authStore 收到 onAuthChanged 广播
 * 或首屏 getState 回填后,所有用本 hook 的组件同步重渲染。
 */

import { useSyncExternalStore } from 'react';
import { authStore } from './index';
import type { AuthState } from '@shared/auth/auth-types';

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.getState(),
  );
}
