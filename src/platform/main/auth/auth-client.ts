/**
 * Auth Portal HTTP 客户端(基于 Electron `net`,仿 upload-service.ts 风格)
 *
 * 职责:把后端契约(实现计划 §1)封装成纯数据函数,**唯一的对接面**——
 * 真实接口到了只改本文件的数据源,不动 auth-service / UI / 门控(实现计划 §8)。
 *
 * 后端契约(已核实代码 + 已部署):
 * - POST /api/v1/auth/code      { email, purpose }                  → { message }
 * - POST /api/v1/auth/register  { email, password, code, device, app_source, referral_code } → 201 AuthResponse
 * - POST /api/v1/auth/login     { email, password, device, app_source } → 200 AuthResponse
 * - POST /api/v1/auth/refresh   { refresh_token }                   → 200 AuthResponse(轮换:旧 refresh 作废)
 *
 * 字段坑(照真值,实现计划 §1.1):验证码字段 `code`(6 位);`device` 嵌套对象;
 * `app_source` 顶层;token 有效期读响应 `expires_in`(别硬编码);X-Request-ID 非强制。
 *
 * mock 开关(auth-config.USE_MOCK_AUTH):Step B 起**默认 false 接真实后端**;
 * 仅在无后端联调时置环境变量 KRIG_AUTH_USE_MOCK='true' 走固定 mock 数据。
 *
 * 红线 2(fail loud):网络错(status 0)/ 非 2xx 都明确归一为带 status 的 AuthClientError,
 * 不静默吞。401 → auth-service 判 token-expired;0 / 5xx → 可重试;非 JSON 错误体用原文。
 *
 * app_source=krig-note:注册 + 登录请求体**必带**(归因的根,硬要求)。
 */

import { net } from 'electron';
import type { AuthDeviceInfo } from '@shared/auth/auth-types';
import {
  getPortalBase,
  AUTH_PATH_PREFIX,
  APP_SOURCE,
  USE_MOCK_AUTH,
} from './auth-config';

// ─────────────────────────────────────────────────────────────────────────────
// 后端响应结构(原样,snake_case;翻译成 public 态在 auth-service)
// ─────────────────────────────────────────────────────────────────────────────

/** AuthResponse(注册 / 登录 / 刷新通用)*/
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  /** 秒;按此算到期,别硬编码 24h */
  expires_in: number;
  token_type: string; // 'Bearer'
  user: {
    id: string;
    email: string;
    source: string;
    role: string;
    email_verified: boolean;
    created_at: string;
  };
}

/**
 * 归一化的客户端错误:带 HTTP status(network 错为 0),供 auth-service 区分
 * 「该重新登录(401)」vs「网络可重试(0 / 5xx)」(实现计划 §1.1)。
 */
export class AuthClientError extends Error {
  /** HTTP 状态码;网络错(无响应)为 0 */
  readonly status: number;
  /** 后端 { error } code(若有)*/
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthClientError';
    this.status = status;
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 底层 net 请求(仿 upload-service:headers→write→end、累积 response、JSON 解析)
// ─────────────────────────────────────────────────────────────────────────────

interface RawResponse {
  status: number;
  body: string;
}

function rawRequest(
  method: 'GET' | 'POST',
  url: string,
  opts: { bearer?: string; jsonBody?: unknown } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method, url });
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('Accept', 'application/json');
    if (opts.bearer) request.setHeader('Authorization', `Bearer ${opts.bearer}`);

    let responseData = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: responseData });
      });
    });
    // 网络错(无响应)→ status 0,供上层判「可重试」
    request.on('error', (err) =>
      reject(new AuthClientError(`network error: ${err.message}`, 0)),
    );

    if (opts.jsonBody !== undefined) request.write(JSON.stringify(opts.jsonBody));
    request.end();
  });
}

/** 解析 2xx JSON;非 2xx 抛 AuthClientError(带 status + 后端 error code)*/
function parseJsonOrThrow<T>(res: RawResponse): T {
  if (res.status >= 200 && res.status < 300) {
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new AuthClientError(`invalid JSON response: ${res.body.slice(0, 200)}`, res.status);
    }
  }
  // 失败:尝试解析 { error, message }
  let code: string | undefined;
  let msg = res.body.slice(0, 200);
  try {
    const parsed = JSON.parse(res.body) as { error?: string; message?: string };
    code = parsed.error;
    if (parsed.message) msg = parsed.message;
  } catch {
    /* 非 JSON 错误体,用原文 */
  }
  throw new AuthClientError(msg || `HTTP ${res.status}`, res.status, code);
}

// ─────────────────────────────────────────────────────────────────────────────
// mock 数据源(USE_MOCK_AUTH 时用;固定「已登录」,跑通上层,不依赖真实后端)
// ─────────────────────────────────────────────────────────────────────────────

function mockAuthResponse(email: string): AuthResponse {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 86400,
    token_type: 'Bearer',
    user: {
      id: 'mock-user-0001',
      email,
      source: 'email',
      role: 'user',
      email_verified: true,
      created_at: '2026-06-16T00:00:00Z',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 公开 API(auth-service 调;mock 与 real 在此处分流,上层无感)
// ─────────────────────────────────────────────────────────────────────────────

/** 发邮箱验证码(注册前置)。purpose 默认 register。 */
export async function sendCode(
  email: string,
  purpose: 'register' | 'reset_password' | 'bind_email' = 'register',
): Promise<void> {
  if (USE_MOCK_AUTH) return; // mock:直接成功
  const url = `${getPortalBase()}${AUTH_PATH_PREFIX}/code`;
  const res = await rawRequest('POST', url, { jsonBody: { email, purpose } });
  parseJsonOrThrow<{ message: string }>(res);
}

/** 注册(device / app_source 由 auth-service 组装后传入)。 */
export async function register(args: {
  email: string;
  password: string;
  code: string;
  device: AuthDeviceInfo;
}): Promise<AuthResponse> {
  if (USE_MOCK_AUTH) return mockAuthResponse(args.email);
  const url = `${getPortalBase()}${AUTH_PATH_PREFIX}/register`;
  const res = await rawRequest('POST', url, {
    jsonBody: {
      email: args.email,
      password: args.password,
      code: args.code,
      device: args.device,
      app_source: APP_SOURCE,
      referral_code: '',
    },
  });
  return parseJsonOrThrow<AuthResponse>(res);
}

/** 登录(老用户)。 */
export async function login(args: {
  email: string;
  password: string;
  device: AuthDeviceInfo;
}): Promise<AuthResponse> {
  if (USE_MOCK_AUTH) return mockAuthResponse(args.email);
  const url = `${getPortalBase()}${AUTH_PATH_PREFIX}/login`;
  const res = await rawRequest('POST', url, {
    jsonBody: {
      email: args.email,
      password: args.password,
      device: args.device,
      app_source: APP_SOURCE,
    },
  });
  return parseJsonOrThrow<AuthResponse>(res);
}

/** 刷新 token(轮换式:返回新一对,调用方必须存新 refresh)。 */
export async function refresh(refreshToken: string): Promise<AuthResponse> {
  if (USE_MOCK_AUTH) return mockAuthResponse('mock@krig-note.local');
  const url = `${getPortalBase()}${AUTH_PATH_PREFIX}/refresh`;
  const res = await rawRequest('POST', url, {
    jsonBody: { refresh_token: refreshToken },
  });
  return parseJsonOrThrow<AuthResponse>(res);
}
