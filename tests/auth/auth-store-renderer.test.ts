/**
 * 阶段 4 验收单测:renderer 侧 authStore(模块级单例快照 + 订阅 + 操作透传)
 *
 * 覆盖:
 *  - 模块加载即挂一次 onAuthChanged + 拉一次 authGetState(单订阅,防多 ws 扇出)
 *  - onAuthChanged 广播到达 → 快照更新 + 通知订阅者
 *  - authGetState 首屏回填
 *  - login/register/sendCode/logout/refresh 透传到 electronAPI
 *  - fail loud:main 返 { ok:false, error } 原样透出(不吞)
 *
 * 不渲染 JSX(项目无 RTL/jsdom);AuthGate 的 status 三分支是 store 之上的纯展示,
 * 逻辑核心在 store,故钉 store。
 *
 * mock window.electronAPI(模块加载即读,故 mock 必须先于 import authStore)。
 */

import { describe, it, expect, vi } from 'vitest';

// 捕获 onAuthChanged 注册的回调,供测试主动触发「广播」
let broadcastCb: ((state: unknown) => void) | null = null;
const api = {
  onAuthChanged: vi.fn((cb: (state: unknown) => void) => {
    broadcastCb = cb;
    return () => {
      broadcastCb = null;
    };
  }),
  authGetState: vi.fn(async () => ({ status: 'anonymous' })),
  authSendCode: vi.fn(async () => ({ ok: true })),
  authRegister: vi.fn(async () => ({ ok: true, state: { status: 'authenticated' } })),
  authLogin: vi.fn(async () => ({ ok: true, state: { status: 'authenticated' } })),
  authLogout: vi.fn(async () => {}),
  authRefresh: vi.fn(async () => ({ ok: true, state: { status: 'authenticated' } })),
};

// jsdom 缺席:手搭最小 window.electronAPI
(globalThis as unknown as { window: unknown }).window = { electronAPI: api };

const { authStore } = await import('../../src/capabilities/auth/index');

describe('authStore (renderer)', () => {
  it('模块加载即挂一次 onAuthChanged + 拉一次 authGetState(单订阅)', () => {
    expect(api.onAuthChanged).toHaveBeenCalledOnce();
    expect(api.authGetState).toHaveBeenCalledOnce();
  });

  it('onAuthChanged 广播 → 快照更新 + 通知订阅者', () => {
    const seen: string[] = [];
    const unsub = authStore.subscribe(() => seen.push(authStore.getState().status));

    broadcastCb?.({ status: 'authenticated', account: { id: 'u1', email: 'a@b.com' } });
    expect(authStore.getState().status).toBe('authenticated');
    expect(authStore.getState().account?.email).toBe('a@b.com');
    expect(seen).toContain('authenticated');

    // 取消订阅后不再收到
    const before = seen.length;
    unsub();
    broadcastCb?.({ status: 'anonymous' });
    expect(seen.length).toBe(before);
    // 但快照仍随广播更新
    expect(authStore.getState().status).toBe('anonymous');
  });

  it('login 透传到 electronAPI', async () => {
    const res = await authStore.login({ email: 'a@b.com', password: 'pw12345678' });
    expect(api.authLogin).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw12345678' });
    expect(res.ok).toBe(true);
  });

  it('register / sendCode 透传', async () => {
    await authStore.sendCode({ email: 'a@b.com', purpose: 'register' });
    expect(api.authSendCode).toHaveBeenCalledWith({ email: 'a@b.com', purpose: 'register' });
    await authStore.register({ email: 'a@b.com', password: 'pw12345678', code: '123456' });
    expect(api.authRegister).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw12345678',
      code: '123456',
    });
  });

  it('logout / refresh 透传', async () => {
    await authStore.logout();
    expect(api.authLogout).toHaveBeenCalledOnce();
    await authStore.refresh();
    expect(api.authRefresh).toHaveBeenCalledOnce();
  });

  it('fail loud:main 返 { ok:false, error } 原样透出(不吞)', async () => {
    api.authLogin.mockResolvedValueOnce({ ok: false, error: '密码错误' } as never);
    const res = await authStore.login({ email: 'a@b.com', password: 'wrong' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('密码错误');
  });
});
