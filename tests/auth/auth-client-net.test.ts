/**
 * Step B 验收单测:auth-client 真实 net 路径(打桩 HTTP)
 *
 * 用 fake net.request 驱动真实 rawRequest / parseJsonOrThrow(USE_MOCK_AUTH=false),
 * 锁死真实后端对接的契约 + 错误映射(交接 §B / §5 验收):
 *  - 请求体真带 app_source=krig-note + 嵌套 device + code(6 位)+ referral_code
 *  - 成功 200/201 → 解析 AuthResponse
 *  - 401 → AuthClientError status=401(auth-service 据此判 token-expired)
 *  - 网络错(无响应)→ status=0(可重试)
 *  - 5xx → status=5xx(可重试)
 *  - 非 JSON 错误体 → 用原文,不崩
 *  - refresh 请求体含 refresh_token(轮换:调用方存新返回的)
 *
 * ⚠️ 这是**打桩验证**,不发真实网络请求。真端到端(对 portal.situstechnologies.com
 *    生产接口实跑注册→登录→refresh→登出)需可达环境 + 测试邮箱收码,列为待办,
 *    不在 CI / 本沙箱跑(且生产接口不可随意造测试账号 / 发验证码邮件)。
 *
 * mock 必须先于 import auth-client(模块加载即读 net + USE_MOCK_AUTH)。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 强制走真实 net 路径(非 mock 数据源)
process.env.KRIG_AUTH_USE_MOCK = 'false';
process.env.KRIG_PORTAL_BASE = 'https://portal.situstechnologies.com';

/** 一次请求的捕获 + 可编程响应 */
interface StubPlan {
  /** 响应 status;设 0 / 不设 response 走 error 分支(网络错)*/
  status?: number;
  body?: string;
  /** true → 触发 request error(网络错,无响应)*/
  networkError?: boolean;
}

let nextPlan: StubPlan = { status: 200, body: '{}' };
const captured: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = [];

// fake net.request:模拟 Electron net 的 EventEmitter 形态
vi.mock('electron', () => ({
  net: {
    request: (opts: { method: string; url: string }) => {
      const headers: Record<string, string> = {};
      let writtenBody = '';
      const responseListeners: Record<string, (arg: unknown) => void> = {};
      const reqListeners: Record<string, (arg: unknown) => void> = {};

      const fakeResponse = {
        statusCode: nextPlan.status,
        on: (ev: string, cb: (arg: unknown) => void) => {
          responseListeners[ev] = cb;
        },
      };

      const req = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        on: (ev: string, cb: (arg: unknown) => void) => {
          reqListeners[ev] = cb;
        },
        write: (b: string) => {
          writtenBody += b;
        },
        end: () => {
          captured.push({ method: opts.method, url: opts.url, headers, body: writtenBody });
          // 异步派发,贴近真实
          queueMicrotask(() => {
            if (nextPlan.networkError) {
              reqListeners['error']?.({ message: 'ECONNREFUSED' });
              return;
            }
            reqListeners['response']?.(fakeResponse);
            responseListeners['data']?.(Buffer.from(nextPlan.body ?? ''));
            responseListeners['end']?.(undefined);
          });
        },
      };
      return req;
    },
  },
}));

const client = await import('../../src/platform/main/auth/auth-client');

const DEVICE = { device_id: 'dev-1', device_type: 'macos' as const, device_name: 'KRIG Note' };

function authResponseBody() {
  return JSON.stringify({
    access_token: 'A1',
    refresh_token: 'R1',
    expires_in: 86400,
    token_type: 'Bearer',
    user: { id: 'u1', email: 'a@b.com', source: 'email', role: 'user', email_verified: true, created_at: 'x' },
  });
}

beforeEach(() => {
  captured.length = 0;
  nextPlan = { status: 200, body: '{}' };
});

describe('auth-client 真实 net 路径 · 请求体契约', () => {
  it('register 请求体带 app_source=krig-note + 嵌套 device + code + referral_code', async () => {
    nextPlan = { status: 201, body: authResponseBody() };
    await client.register({ email: 'a@b.com', password: 'pw12345678', code: '123456', device: DEVICE });

    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://portal.situstechnologies.com/api/v1/auth/register');
    const body = JSON.parse(req.body);
    expect(body.app_source).toBe('krig-note'); // ⚠️ 归因硬要求
    expect(body.code).toBe('123456'); // 字段名 code
    expect(body.device).toEqual(DEVICE); // 嵌套对象
    expect(body.referral_code).toBe('');
    expect(req.headers['Content-Type']).toBe('application/json');
  });

  it('login 请求体带 app_source=krig-note + 嵌套 device', async () => {
    nextPlan = { status: 200, body: authResponseBody() };
    await client.login({ email: 'a@b.com', password: 'pw12345678', device: DEVICE });

    const body = JSON.parse(captured[0].body);
    expect(captured[0].url).toBe('https://portal.situstechnologies.com/api/v1/auth/login');
    expect(body.app_source).toBe('krig-note');
    expect(body.device).toEqual(DEVICE);
    expect(body.password).toBe('pw12345678');
  });

  it('sendCode 请求体 { email, purpose }', async () => {
    nextPlan = { status: 200, body: '{"message":"sent"}' };
    await client.sendCode('a@b.com', 'register');
    const body = JSON.parse(captured[0].body);
    expect(captured[0].url).toBe('https://portal.situstechnologies.com/api/v1/auth/code');
    expect(body).toEqual({ email: 'a@b.com', purpose: 'register' });
  });

  it('refresh 请求体含 refresh_token;返回新一对(轮换由 service 存)', async () => {
    nextPlan = {
      status: 200,
      body: JSON.stringify({
        access_token: 'A2',
        refresh_token: 'R2',
        expires_in: 86400,
        token_type: 'Bearer',
        user: { id: 'u1', email: 'a@b.com', source: 'email', role: 'user', email_verified: true, created_at: 'x' },
      }),
    };
    const res = await client.refresh('R1');
    expect(JSON.parse(captured[0].body)).toEqual({ refresh_token: 'R1' });
    expect(res.refresh_token).toBe('R2'); // 新 refresh
    expect(res.access_token).toBe('A2');
  });
});

describe('auth-client 真实 net 路径 · 成功解析', () => {
  it('200 → 解析 AuthResponse(读 expires_in 不硬编码)', async () => {
    nextPlan = { status: 200, body: authResponseBody() };
    const res = await client.login({ email: 'a@b.com', password: 'pw12345678', device: DEVICE });
    expect(res.access_token).toBe('A1');
    expect(res.refresh_token).toBe('R1');
    expect(res.expires_in).toBe(86400);
    expect(res.user.email).toBe('a@b.com');
  });

  it('201(register)→ 解析 AuthResponse', async () => {
    nextPlan = { status: 201, body: authResponseBody() };
    const res = await client.register({ email: 'a@b.com', password: 'pw12345678', code: '123456', device: DEVICE });
    expect(res.access_token).toBe('A1');
  });
});

describe('auth-client 真实 net 路径 · 错误映射(交接 §B 必补)', () => {
  it('401 → AuthClientError status=401 + 后端 error code', async () => {
    nextPlan = { status: 401, body: '{"error":"invalid_credentials","message":"密码错误"}' };
    await expect(client.login({ email: 'a@b.com', password: 'x', device: DEVICE })).rejects.toMatchObject({
      name: 'AuthClientError',
      status: 401,
      code: 'invalid_credentials',
      message: '密码错误',
    });
  });

  it('网络错(无响应)→ status=0(可重试)', async () => {
    nextPlan = { networkError: true };
    await expect(client.login({ email: 'a@b.com', password: 'x', device: DEVICE })).rejects.toMatchObject({
      name: 'AuthClientError',
      status: 0,
    });
  });

  it('5xx → status=503(可重试)', async () => {
    nextPlan = { status: 503, body: '{"error":"unavailable","message":"维护中"}' };
    await expect(client.refresh('R1')).rejects.toMatchObject({ status: 503, code: 'unavailable' });
  });

  it('非 JSON 错误体 → 用原文,不崩', async () => {
    nextPlan = { status: 500, body: '<html>502 Bad Gateway</html>' };
    await expect(client.login({ email: 'a@b.com', password: 'x', device: DEVICE })).rejects.toMatchObject({
      status: 500,
      message: '<html>502 Bad Gateway</html>',
    });
  });

  it('2xx 但非 JSON body → invalid JSON 错误(带 status)', async () => {
    nextPlan = { status: 200, body: 'not json' };
    await expect(client.login({ email: 'a@b.com', password: 'x', device: DEVICE })).rejects.toMatchObject({
      name: 'AuthClientError',
      status: 200,
    });
  });
});
