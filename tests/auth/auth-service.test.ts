/**
 * auth-service 单测(登录态 + token 生命周期 + 广播;本期无 grant)
 *
 * 覆盖:
 *  - login(mock)→ authenticated + account(无 tier/grant)
 *  - register → authenticated
 *  - logout → anonymous + 清 session
 *  - restore:无 session → anonymous;有 session → authenticated(不查 grant)
 *  - refresh:成功轮换存新 refresh;401 → token-expired + 清 session;网络错 → 保持当前态
 *  - subscribe:状态变化回调到达(广播信号源)
 *  - 红线 1:getPublicState 不含 token
 *
 * (真实 net 路径的 401 / 网络错 / 5xx / 非 JSON 错误体映射测试在 Step B 补,
 *  那里直接打桩 net 覆盖 auth-client。本文件用 client mock 验 service 编排。)
 *
 * mock 策略:直接 mock auth-client(精确控制响应/抛错)+ auth-store(内存)+ electron。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── 内存版 auth-store(可控)──
const storeState: { saved: Record<string, unknown> | null } = { saved: null };

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/krig-auth-svc-test', getName: () => 'KRIG Note', isPackaged: false },
}));

vi.mock('../../src/platform/main/auth/auth-store', () => ({
  loadSession: () => storeState.saved,
  saveSession: (input: Record<string, unknown>) => {
    storeState.saved = { ...input };
  },
  clearSession: () => {
    storeState.saved = null;
  },
}));

// ── 可控 auth-client mock ──
import { AuthClientError } from '../../src/platform/main/auth/auth-client';
const clientMock = {
  sendCode: vi.fn(async () => {}),
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
};

vi.mock('../../src/platform/main/auth/auth-client', async () => {
  const actual = await vi.importActual<typeof import('../../src/platform/main/auth/auth-client')>(
    '../../src/platform/main/auth/auth-client',
  );
  return {
    AuthClientError: actual.AuthClientError,
    sendCode: (...a: unknown[]) => clientMock.sendCode(...a),
    register: (...a: unknown[]) => clientMock.register(...a),
    login: (...a: unknown[]) => clientMock.login(...a),
    refresh: (...a: unknown[]) => clientMock.refresh(...a),
  };
});

const { authService } = await import('../../src/platform/main/auth/auth-service');

const NOW = 1798464000000;

function authResponse(email = 'a@b.com', token = 'access-1', refreshTok = 'refresh-1') {
  return {
    access_token: token,
    refresh_token: refreshTok,
    expires_in: 86400,
    token_type: 'Bearer',
    user: {
      id: 'user-1',
      email,
      source: 'email',
      role: 'user',
      email_verified: true,
      created_at: '2026-06-16T00:00:00Z',
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  storeState.saved = null;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await authService.logout(); // 复位到 anonymous
});

describe('auth-service · 登录', () => {
  it('login 成功 → authenticated + account(无 tier/grant)', async () => {
    clientMock.login.mockResolvedValue(authResponse());

    await authService.login('a@b.com', 'pw12345678');

    const s = authService.getPublicState();
    expect(s.status).toBe('authenticated');
    expect(s.account?.email).toBe('a@b.com');
    expect(s.account?.id).toBe('user-1');
    // 本期无 tier/grant
    expect((s as Record<string, unknown>).tier).toBeUndefined();
    expect((s as Record<string, unknown>).grant).toBeUndefined();
    // 红线 1:public 态不含 token
    expect(JSON.stringify(s)).not.toContain('access-1');
    expect(JSON.stringify(s)).not.toContain('refresh-1');
    // token 落盘(经 store mock)
    expect(storeState.saved?.accessToken).toBe('access-1');
  });

  it('register 成功 → authenticated', async () => {
    clientMock.register.mockResolvedValue(authResponse('new@b.com'));

    await authService.register('new@b.com', 'pw12345678', '123456');

    const s = authService.getPublicState();
    expect(s.status).toBe('authenticated');
    expect(s.account?.email).toBe('new@b.com');
  });
});

describe('auth-service · token 生命周期', () => {
  it('refresh 成功 → 轮换存新 refresh + 保持 authenticated', async () => {
    clientMock.login.mockResolvedValue(authResponse('a@b.com', 'access-old', 'refresh-old'));
    await authService.login('a@b.com', 'pw12345678');

    clientMock.refresh.mockResolvedValue(authResponse('a@b.com', 'access-new', 'refresh-new'));
    await authService.refresh();

    const s = authService.getPublicState();
    expect(s.status).toBe('authenticated');
    expect(clientMock.refresh).toHaveBeenCalledOnce();
    expect(storeState.saved?.refreshToken).toBe('refresh-new'); // 轮换
  });

  it('refresh 401 → token-expired + 清 session', async () => {
    clientMock.login.mockResolvedValue(authResponse());
    await authService.login('a@b.com', 'pw12345678');

    clientMock.refresh.mockRejectedValue(new AuthClientError('revoked', 401));
    await authService.refresh();

    const s = authService.getPublicState();
    expect(s.status).toBe('token-expired');
    expect(s.error).toBeTruthy(); // fail loud
    expect(storeState.saved).toBeNull(); // 清了 session
  });

  it('refresh 网络错(status 0)→ 保持当前 authenticated(可重试,不掉线)', async () => {
    clientMock.login.mockResolvedValue(authResponse());
    await authService.login('a@b.com', 'pw12345678');

    clientMock.refresh.mockRejectedValue(new AuthClientError('network error', 0));
    await authService.refresh();

    const s = authService.getPublicState();
    expect(s.status).toBe('authenticated'); // 没掉线
    expect(storeState.saved).not.toBeNull(); // session 还在
  });

  it('refresh 5xx → 保持当前 authenticated(可重试)', async () => {
    clientMock.login.mockResolvedValue(authResponse());
    await authService.login('a@b.com', 'pw12345678');

    clientMock.refresh.mockRejectedValue(new AuthClientError('server error', 503));
    await authService.refresh();

    expect(authService.getPublicState().status).toBe('authenticated');
  });
});

describe('auth-service · logout / restore / subscribe', () => {
  it('logout → anonymous + 清 session', async () => {
    clientMock.login.mockResolvedValue(authResponse());
    await authService.login('a@b.com', 'pw12345678');

    await authService.logout();
    const s = authService.getPublicState();
    expect(s.status).toBe('anonymous');
    expect(s.account).toBeUndefined();
    expect(storeState.saved).toBeNull();
  });

  it('restore 无 session → anonymous', async () => {
    storeState.saved = null;
    await authService.restore();
    expect(authService.getPublicState().status).toBe('anonymous');
  });

  it('restore 有 session → authenticated(不查 grant)', async () => {
    storeState.saved = {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accountId: 'user-1',
      email: 'a@b.com',
      accessExpiresAt: NOW + 86400_000,
      lastVerifiedAt: NOW,
    };

    await authService.restore();
    const s = authService.getPublicState();
    expect(s.status).toBe('authenticated');
    expect(s.account?.email).toBe('a@b.com');
    // restore 不发任何网络请求(无 grant 查询)
    expect(clientMock.refresh).not.toHaveBeenCalled();
  });

  it('subscribe 收到状态变化(广播信号源),取消后不再收', async () => {
    const seen: string[] = [];
    const unsub = authService.subscribe((st) => seen.push(st.status));

    clientMock.login.mockResolvedValue(authResponse());
    await authService.login('a@b.com', 'pw12345678');
    await authService.logout();

    unsub();
    expect(seen).toContain('authenticated');
    expect(seen).toContain('anonymous');

    const before = seen.length;
    await authService.login('a@b.com', 'pw12345678');
    expect(seen.length).toBe(before);
  });
});
