/**
 * Auth session 本地持久化(token safeStorage 加密落盘)
 *
 * 文件位置:`{userData}/krig-data/auth/session.json`
 * (路径范式照 ebook/web-download/learning,目录段独立为 `auth`)。
 *
 * token(access + refresh)用 Electron `safeStorage` 加密:
 * - macOS → Keychain;Windows → DPAPI。
 * - 只防别的程序偷读 token,不防本机用户自己改(设计 §九)——
 *   这对 token 机密性有意义,对软门控无影响。
 *
 * ⚠️ fail loud(红线 2):`safeStorage.isEncryptionAvailable()` 为 false 时,
 *   save 明确 throw,不静默明文落盘(明文存 token 是安全事故)。
 *
 * 写入策略:atomic — `session.json.tmp` → `fs.renameSync`(POSIX 原子),
 *   照搬 download-store,防写一半损坏旧数据。
 *
 * renderer 永远拿不到这里的 token —— 本模块只在主进程被 auth-service 调用。
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** 落盘结构(token 已 safeStorage 加密为 base64 字符串)*/
export interface StoredAuthSession {
  version: '1';
  /** safeStorage 加密后的 access_token(base64)*/
  encryptedAccessToken: string;
  /** safeStorage 加密后的 refresh_token(base64;轮换式,每次刷新覆写)*/
  encryptedRefreshToken: string;
  accountId: string;
  email: string;
  /** access_token 到期绝对时间(毫秒;= 落盘时刻 + expires_in*1000)*/
  accessExpiresAt: number;
  /** 上次成功联网核实时间(毫秒)*/
  lastVerifiedAt: number;
}

/** 已解密的 session(主进程内存用;token 是明文,绝不出主进程)*/
export interface DecryptedAuthSession {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string;
  accessExpiresAt: number;
  lastVerifiedAt: number;
}

/** 落盘前提供的可写字段(token 明文,save 内部加密)*/
export interface SaveAuthSessionInput {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string;
  accessExpiresAt: number;
  lastVerifiedAt: number;
}

const AUTH_DIR = path.join(app.getPath('userData'), 'krig-data', 'auth');
const SESSION_FILE = path.join(AUTH_DIR, 'session.json');

/**
 * fail loud:safeStorage 不可用时明确报错。
 * 不可用场景:Linux 无 keyring / 测试环境未初始化 —— 此时拒绝存 token。
 */
function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '[auth-store] safeStorage 加密不可用(无系统 keyring),拒绝明文存 token。' +
        '请检查 OS keychain/DPAPI 状态。',
    );
  }
}

function encrypt(plain: string): string {
  return safeStorage.encryptString(plain).toString('base64');
}

function decrypt(b64: string): string {
  return safeStorage.decryptString(Buffer.from(b64, 'base64'));
}

/**
 * 加密落盘 session(atomic 写)。
 * @throws safeStorage 不可用时 fail loud。
 */
export function saveSession(input: SaveAuthSessionInput): void {
  assertEncryptionAvailable();

  const data: StoredAuthSession = {
    version: '1',
    encryptedAccessToken: encrypt(input.accessToken),
    encryptedRefreshToken: encrypt(input.refreshToken),
    accountId: input.accountId,
    email: input.email,
    accessExpiresAt: input.accessExpiresAt,
    lastVerifiedAt: input.lastVerifiedAt,
  };

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const tmp = SESSION_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, SESSION_FILE);
}

/**
 * 读取并解密 session;无文件 / 损坏 / 解密失败均返 null(无 session 不是错误)。
 *
 * 注意:解密失败(如换机器换了 keychain)按「需重新登录」对待,返 null,
 * 不 throw —— 这是恢复路径的正常分支,不是 fail loud 场景。
 */
export function loadSession(): DecryptedAuthSession | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    const data = JSON.parse(raw) as StoredAuthSession;
    if (
      data.version !== '1' ||
      typeof data.encryptedAccessToken !== 'string' ||
      typeof data.encryptedRefreshToken !== 'string' ||
      typeof data.accountId !== 'string' ||
      typeof data.email !== 'string' ||
      typeof data.accessExpiresAt !== 'number'
    ) {
      return null;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      // 无法解密历史 token → 当作需重新登录(非 fail loud,正常恢复分支)
      console.warn('[auth-store] safeStorage 不可用,无法解密既有 session,需重新登录');
      return null;
    }
    return {
      accessToken: decrypt(data.encryptedAccessToken),
      refreshToken: decrypt(data.encryptedRefreshToken),
      accountId: data.accountId,
      email: data.email,
      accessExpiresAt: data.accessExpiresAt,
      lastVerifiedAt: data.lastVerifiedAt,
    };
  } catch (err) {
    console.warn('[auth-store] load 失败(文件损坏或解密失败),按未登录处理:', err);
    return null;
  }
}

/** 清除本地 session(登出 / token 失效)。文件不存在时静默。 */
export function clearSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch (err) {
    console.warn('[auth-store] clear 失败:', err);
  }
}
