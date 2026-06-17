/**
 * auth capability — renderer 侧封装(账号登录 + 归因;本期不做授权)
 *
 * 职责:把 main 进程 auth 能力(login/register/logout/refresh + onAuthChanged 广播)
 * 暴露给 renderer,并持一份**本地 public AuthState 快照**(不含 token,红线 1)。
 *
 * 设计为**模块级单例 store**(对齐 fullscreen-overlay-controller 范式):
 * - 全 renderer 只订阅一次 `onAuthChanged`(模块加载时挂),N 个组件读同一快照。
 * - 这天然规避多 ws 扇出(红线 4):不是「每 ws 一个 view 实例各订阅」,而是
 *   App 根挂一份;onAuthChanged 是窗口级广播,本窗口只有这一个监听器消费一次。
 *
 * 实现位置:src/platform/main/auth/(auth-service + auth-handler)。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  AuthState,
  AuthSendCodeInput,
  AuthRegisterInput,
  AuthLoginInput,
  AuthActionResult,
} from '@shared/auth/auth-types';
import type { AuthApi } from './types';
import { AuthStatusBadge } from './AuthStatusBadge';

export type { AuthApi } from './types';
export type {
  AuthState,
  AuthStatus,
  AuthAccount,
} from '@shared/auth/auth-types';

/** 初始快照:loading(等 main restore 完广播 / 首次 getState 回填)*/
const INITIAL_STATE: AuthState = { status: 'loading' };

class AuthStore {
  private state: AuthState = INITIAL_STATE;
  private listeners = new Set<() => void>();
  private wired = false;

  constructor() {
    this.wire();
  }

  /** 挂一次 onAuthChanged + 拉一次当前态(模块级单例,只跑一次)*/
  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    const api = window.electronAPI;
    if (!api?.onAuthChanged) return; // 非 electron 环境(测试 / SSR)兜底

    api.onAuthChanged((state) => {
      this.state = state;
      this.notify();
    });

    // 首屏回填:main 可能已 restore 完(广播早于本监听挂载)
    void api
      .authGetState()
      .then((state) => {
        this.state = state;
        this.notify();
      })
      .catch((err) => {
        console.warn('[auth] 初始 authGetState 失败:', err);
      });
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        console.warn('[auth] store listener 抛错(忽略):', err);
      }
    }
  }

  // ── 操作(返回 main 归一的 { ok, error };UI 据此 fail loud)──

  async sendCode(input: AuthSendCodeInput): Promise<AuthActionResult> {
    if (!window.electronAPI?.authSendCode) {
      return { ok: false, error: 'auth 不可用(非 electron 环境)' };
    }
    return window.electronAPI.authSendCode(input);
  }

  async register(input: AuthRegisterInput): Promise<AuthActionResult> {
    if (!window.electronAPI?.authRegister) {
      return { ok: false, error: 'auth 不可用(非 electron 环境)' };
    }
    return window.electronAPI.authRegister(input);
  }

  async login(input: AuthLoginInput): Promise<AuthActionResult> {
    if (!window.electronAPI?.authLogin) {
      return { ok: false, error: 'auth 不可用(非 electron 环境)' };
    }
    return window.electronAPI.authLogin(input);
  }

  async logout(): Promise<void> {
    if (!window.electronAPI?.authLogout) return;
    return window.electronAPI.authLogout();
  }

  async refresh(): Promise<AuthActionResult> {
    if (!window.electronAPI?.authRefresh) {
      return { ok: false, error: 'auth 不可用(非 electron 环境)' };
    }
    return window.electronAPI.authRefresh();
  }
}

/** 模块级单例 store(全 renderer 共享一份快照 + 一个订阅)*/
export const authStore = new AuthStore();

// 注册 auth capability:暴露 UI 组件给 shell/view 经 requireCapabilityApi<AuthApi>('auth') 取
// (shell/view 不直 import capability 运行时值,eslint W5 §5 硬约束;对齐 web-rendering.Host 范式)。
const authApi: AuthApi = { StatusBadge: AuthStatusBadge };
capabilityRegistry.register({ id: 'auth', api: authApi });
