/**
 * Auth Portal 配置(账号登录 + 归因;本期不做授权)
 *
 * ⚠️ 独立于 extraction/config.ts —— 那是 PDF 提取平台(192.168.1.240),
 * 不是 auth portal。两者后端不同,不要复用(红线 6)。
 *
 * Base:`portal.situstechnologies.com`,auth 在 `/api/v1/auth/*`。全走相对路径,
 * 不直连独立 IP/端口。(❌ 没有 grant 接口,已砍。)
 *
 * 环境切换:按 `app.isPackaged` 选 prod / dev。dev 域名后端待补,未补前回落 prod。
 * 可用环境变量 KRIG_PORTAL_BASE 覆盖(本地代理 / 联调指向可达后端)。
 */

import { app } from 'electron';

/** 顶层归因字段:务必带(平台归因,无白名单直接传)*/
export const APP_SOURCE = 'krig-note';

/** prod portal base(无尾斜杠)*/
const PROD_PORTAL_BASE = 'https://portal.situstechnologies.com';

/** dev portal base —— 后端待回;未定前回落 prod */
const DEV_PORTAL_BASE = 'https://portal.situstechnologies.com';

/**
 * 解析当前环境的 portal base URL(无尾斜杠)。
 *
 * 优先级:环境变量 KRIG_PORTAL_BASE > app.isPackaged ? prod : dev。
 */
export function getPortalBase(): string {
  const override = process.env.KRIG_PORTAL_BASE;
  if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  return app.isPackaged ? PROD_PORTAL_BASE : DEV_PORTAL_BASE;
}

/** auth 接口前缀(相对 base):/api/v1/auth */
export const AUTH_PATH_PREFIX = '/api/v1/auth';

/**
 * mock 开关:true 时 auth-client 不发真实网络请求,返回固定 mock 数据(无后端联调用)。
 *
 * ⚠️ Step B:默认**接真实后端**(USE_MOCK_AUTH 默认 false,走后端给的真实接口)。
 *    需在无后端时跑 mock,显式置环境变量 `KRIG_AUTH_USE_MOCK='true'`。
 */
export const USE_MOCK_AUTH =
  process.env.KRIG_AUTH_USE_MOCK === 'true';
