/**
 * auth-store(safeStorage 加密落盘)+ auth-client(mock 登录)单测
 *
 * 覆盖:
 *  1. 离线 mock 登录 / 注册 / refresh 返回固定数据。
 *  2. 加解密落盘读回(saveSession → loadSession roundtrip)+ atomic 写。
 *  3. safeStorage.isEncryptionAvailable()=false 时 saveSession fail loud(throw)。
 *
 * ⚠️ Step B 起 USE_MOCK_AUTH 默认 false(接真实后端);本文件验 mock 路径,故
 *    **显式置 KRIG_AUTH_USE_MOCK='true'**(不依赖默认,也防 sibling 测试设过 env 泄漏)。
 *
 * electron 在测试环境无效 → hoisted module-level mock(app.getPath / safeStorage / net)。
 * safeStorage 用可切换的 fake:base64「假加密」+ 一个开关模拟「不可用」。
 */

// 必须先于 import auth-client(模块加载即读 USE_MOCK_AUTH)
process.env.KRIG_AUTH_USE_MOCK = 'true';

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-auth-test-'));

// safeStorage 可用性开关(测试可切换,验证 fail loud)
const safeStorageState = { available: true };

// hoisted module-level mock — store 模块加载即计算 AUTH_DIR
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP_USERDATA,
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    // 假加密:明文 → Buffer(base64 落盘时再 .toString('base64'))
    encryptString: (plain: string) => Buffer.from('ENC:' + plain, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^ENC:/, ''),
  },
  net: {
    // mock 模式下 auth-client 不会走到这;留个会 throw 的桩防误触真实请求
    request: () => {
      throw new Error('net.request should not be called in USE_MOCK_AUTH mode');
    },
  },
}));

const store = await import('../../src/platform/main/auth/auth-store');
const client = await import('../../src/platform/main/auth/auth-client');

const SESSION_FILE = path.join(TMP_USERDATA, 'krig-data', 'auth', 'session.json');

beforeEach(() => {
  safeStorageState.available = true;
  store.clearSession();
});

afterAll(() => {
  fs.rmSync(TMP_USERDATA, { recursive: true, force: true });
});

describe('auth-store', () => {
  const sample = {
    accessToken: 'access-xyz',
    refreshToken: 'refresh-abc',
    accountId: 'user-1',
    email: 'a@b.com',
    accessExpiresAt: 1798464000000 + 86400_000,
    lastVerifiedAt: 1798464000000,
  };

  it('saveSession 加密落盘 + loadSession 解密回读(roundtrip)', () => {
    store.saveSession(sample);

    // 真落了盘 + atomic(无 tmp 残留)
    expect(fs.existsSync(SESSION_FILE)).toBe(true);
    expect(fs.existsSync(SESSION_FILE + '.tmp')).toBe(false);

    // 落盘内容是加密的(不含明文 token)
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    expect(raw).not.toContain('access-xyz');
    expect(raw).not.toContain('refresh-abc');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe('1');
    expect(parsed.accountId).toBe('user-1'); // 非机密字段明文存

    // 解密回读一致
    const loaded = store.loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('access-xyz');
    expect(loaded!.refreshToken).toBe('refresh-abc');
    expect(loaded!.email).toBe('a@b.com');
    expect(loaded!.accessExpiresAt).toBe(sample.accessExpiresAt);
  });

  it('loadSession 无文件返 null', () => {
    expect(store.loadSession()).toBeNull();
  });

  it('clearSession 删文件', () => {
    store.saveSession(sample);
    expect(fs.existsSync(SESSION_FILE)).toBe(true);
    store.clearSession();
    expect(fs.existsSync(SESSION_FILE)).toBe(false);
    expect(store.loadSession()).toBeNull();
  });

  it('safeStorage 不可用时 saveSession fail loud(throw,不明文落盘)', () => {
    safeStorageState.available = false;
    expect(() => store.saveSession(sample)).toThrow(/safeStorage/);
    // 没有写出明文文件
    expect(fs.existsSync(SESSION_FILE)).toBe(false);
  });

  it('safeStorage 不可用时 loadSession 返 null(非 throw,正常恢复分支)', () => {
    // 先在可用态存一份
    store.saveSession(sample);
    // 再切到不可用读
    safeStorageState.available = false;
    expect(store.loadSession()).toBeNull();
  });
});

describe('auth-client (mock 模式)', () => {
  it('login 返回固定 mock AuthResponse', async () => {
    const res = await client.login({
      email: 'a@b.com',
      password: 'pw12345678',
      device: { device_id: 'd1', device_type: 'macos' },
    });
    expect(res.access_token).toBe('mock-access-token');
    expect(res.refresh_token).toBe('mock-refresh-token');
    expect(res.expires_in).toBe(86400);
    expect(res.user.email).toBe('a@b.com');
  });

  it('register 返回固定 mock AuthResponse', async () => {
    const res = await client.register({
      email: 'new@b.com',
      password: 'pw12345678',
      code: '123456',
      device: { device_id: 'd1', device_type: 'windows' },
    });
    expect(res.access_token).toBe('mock-access-token');
    expect(res.user.email).toBe('new@b.com');
  });

  it('sendCode mock 不抛错', async () => {
    await expect(client.sendCode('a@b.com', 'register')).resolves.toBeUndefined();
  });

  it('refresh 返回新一对 mock token', async () => {
    const res = await client.refresh('mock-refresh-token');
    expect(res.access_token).toBe('mock-access-token');
    expect(res.refresh_token).toBe('mock-refresh-token');
  });
});
