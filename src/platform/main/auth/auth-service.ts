/**
 * Auth Service(主进程登录态单例)
 *
 * 持有 in-memory 的 public AuthState + 加密落盘的 token(经 auth-store)。
 * 对外只暴露 public state(不含 token,红线 1)。
 *
 * 本期只做登录 + 归因(authorization-management-design.md「★ 2026-06-17 最终决定」):
 * 砍掉 grant / 到期判定 / 倒计时 / 验签 / 离线时钟兜底 / tier。授权真正边界在后端
 * 登录/refresh 判定(下期计费时收口),不在客户端。
 *
 * 核心:
 * - restore():启动从磁盘读 token → 有则 authenticated、无则 anonymous(不再查 grant;
 *     token 有效性由后续真实请求自然暴露——401 则 refresh,refresh 也 401 → token-expired)。
 * - login / register:调后端 → 存 token → authenticated + 广播。
 * - refresh():轮换刷新 token;401 → token-expired(回登录);网络错/5xx → 保持当前态可重试。
 * - logout():清本地 token + 内存,回 anonymous。
 *
 * 红线:token 绝不进 renderer;fail loud(失败写入 state.error,不静默吞);
 *       app_source=krig-note 注册 + 每次登录必带(在 auth-client 内组装)。
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  AuthState,
  AuthAccount,
  DeviceType,
  AuthDeviceInfo,
} from '@shared/auth/auth-types';
import {
  loadSession,
  saveSession,
  clearSession,
  type DecryptedAuthSession,
} from './auth-store';
import {
  sendCode as clientSendCode,
  register as clientRegister,
  login as clientLogin,
  refresh as clientRefresh,
  AuthClientError,
  type AuthResponse,
} from './auth-client';

// ─────────────────────────────────────────────────────────────────────────────
// device id(per-install 稳定 UUID,落 {userData}/krig-data/auth/device-id)
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_DIR = path.join(app.getPath('userData'), 'krig-data', 'auth');
const DEVICE_ID_FILE = path.join(AUTH_DIR, 'device-id');

function getDeviceType(): DeviceType {
  // 本期跨平台仅 macOS / Windows;其他平台暂归 windows(后端合法值约束)
  return process.platform === 'darwin' ? 'macos' : 'windows';
}

/** 读取(或首次生成并落盘)稳定 device_id */
function getDeviceId(): string {
  try {
    if (fs.existsSync(DEVICE_ID_FILE)) {
      const id = fs.readFileSync(DEVICE_ID_FILE, 'utf-8').trim();
      if (id) return id;
    }
  } catch {
    /* 读失败 → 重新生成 */
  }
  const id = randomUUID();
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(DEVICE_ID_FILE, id, 'utf-8');
  } catch (err) {
    console.warn('[auth-service] 持久化 device-id 失败(本次用临时 id):', err);
  }
  return id;
}

function buildDeviceInfo(): AuthDeviceInfo {
  return {
    device_id: getDeviceId(),
    device_type: getDeviceType(),
    device_name: app.getName(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthService
// ─────────────────────────────────────────────────────────────────────────────

type Listener = (state: AuthState) => void;

class AuthService {
  /** 内存 public 态(初始 loading,restore 完广播)*/
  private state: AuthState = { status: 'loading' };

  /** 内存持有的明文 token(绝不出主进程)*/
  private session: DecryptedAuthSession | null = null;

  private listeners = new Set<Listener>();

  /** 取当前 public 态(不含 token)*/
  getPublicState(): AuthState {
    return { ...this.state };
  }

  /** 订阅状态变化;返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: AuthState): void {
    this.state = next;
    for (const l of this.listeners) {
      try {
        l(this.getPublicState());
      } catch (err) {
        console.warn('[auth-service] listener 抛错(忽略):', err);
      }
    }
  }

  /** 设 authenticated 态(由当前 session 派生 account)*/
  private setAuthenticated(): void {
    if (!this.session) {
      this.setState({ status: 'anonymous' });
      return;
    }
    const account: AuthAccount = { id: this.session.accountId, email: this.session.email };
    this.setState({
      status: 'authenticated',
      account,
      lastVerifiedAt: this.session.lastVerifiedAt,
    });
  }

  /** 把 AuthResponse 落盘 + 设内存 session(token 明文只在主进程)*/
  private persistSession(res: AuthResponse): void {
    const accessExpiresAt = Date.now() + res.expires_in * 1000;
    const input = {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      accountId: res.user.id,
      email: res.user.email,
      accessExpiresAt,
      lastVerifiedAt: Date.now(),
    };
    saveSession(input); // fail loud:safeStorage 不可用时 throw
    this.session = { ...input };
  }

  // ── 启动恢复 ──

  /**
   * 从磁盘恢复 session。不阻塞窗口(index.ts 以 void 调用)。
   * 有 token → authenticated;无 → anonymous。
   * 不再查 grant —— token 有效性由后续真实请求自然暴露(401 → refresh)。
   */
  async restore(): Promise<void> {
    const stored = loadSession();
    if (!stored) {
      this.setState({ status: 'anonymous' });
      return;
    }
    this.session = stored;
    this.setAuthenticated();
  }

  // ── 对外操作(auth-handler 调)──

  /** 发邮箱验证码(注册前置)*/
  async sendCode(email: string, purpose: 'register' | 'reset_password' | 'bind_email' = 'register'): Promise<void> {
    await clientSendCode(email, purpose);
  }

  /** 注册:注册成功 → 落 token → authenticated + 广播 */
  async register(email: string, password: string, code: string): Promise<void> {
    const res = await clientRegister({ email, password, code, device: buildDeviceInfo() });
    this.persistSession(res);
    this.setAuthenticated();
  }

  /** 登录(老用户):登录成功 → 落 token → authenticated + 广播 */
  async login(email: string, password: string): Promise<void> {
    const res = await clientLogin({ email, password, device: buildDeviceInfo() });
    this.persistSession(res);
    this.setAuthenticated();
  }

  /** 登出:清本地 token + 内存,回 anonymous */
  async logout(): Promise<void> {
    this.session = null;
    clearSession();
    this.setState({ status: 'anonymous' });
  }

  /**
   * 刷新 token(轮换式:存新返回的 refresh)。无 session → anonymous。
   * - 401(refresh 已吊销/过期)→ 清 session + token-expired(回登录)。
   * - 网络错/5xx → 保持当前 authenticated 态(可重试),不掉线。
   */
  async refresh(): Promise<void> {
    if (!this.session) {
      this.setState({ status: 'anonymous' });
      return;
    }
    try {
      const res = await clientRefresh(this.session.refreshToken);
      this.persistSession(res); // 轮换:覆写新一对 token
      this.setAuthenticated();
    } catch (err) {
      if (err instanceof AuthClientError && err.status === 401) {
        this.session = null;
        clearSession();
        this.setState({ status: 'token-expired', error: '登录已过期,请重新登录' });
        return;
      }
      // 网络错(status 0)/ 5xx → 保持当前态可重试(不掉线)
      console.warn('[auth-service] refresh 网络错(保持当前态,可重试):', err);
    }
  }
}

export const authService = new AuthService();
