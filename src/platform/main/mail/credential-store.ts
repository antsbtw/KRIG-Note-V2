/**
 * 邮箱 IMAP/SMTP 凭据本地持久化(safeStorage 加密落盘)
 *
 * 文件位置:`{userData}/krig-data/mail/credentials.json`
 * (路径范式照 auth/ebook/web-download)。
 *
 * ## 为什么不进 SurrealDB
 *
 * `mail_account` 表只存连接参数(host/port/email),**密码永远不进 DB**。
 * DB 文件是明文可读的,凭据落进去等于把用户的邮箱密码摊在磁盘上。
 * 用 Electron `safeStorage` 加密:macOS → Keychain;Windows → DPAPI。
 *
 * ## 阶段 1 存的是「应用专用密码」而非账号密码
 *
 * 设计 D3:第一版走 IMAP + 应用专用密码(零 OAuth 依赖)。用户在邮箱设置里
 * 生成一串一次性的 16 位密码,泄露了也只影响邮件收发、可随时单独吊销,
 * 比存账号密码安全得多。将来接 OAuth 时这里改存 refresh_token,结构不变。
 *
 * ⚠️ fail loud(红线):`safeStorage.isEncryptionAvailable()` 为 false 时
 * save 明确 throw,**不静默明文落盘**。
 *
 * 写入策略:atomic — `credentials.json.tmp` → `fs.renameSync`(POSIX 原子),
 * 照搬 auth-store / download-store,防写一半损坏旧数据。
 *
 * renderer 永远拿不到明文密码 —— 本模块只在主进程被 imap-client 调用。
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** 落盘结构(密码已 safeStorage 加密为 base64) */
interface StoredCredentials {
  version: '1';
  /** key = accountId(mail_account 表的记录 id),value = 加密后的密码 base64 */
  entries: Record<string, string>;
}

const MAIL_DIR = path.join(app.getPath('userData'), 'krig-data', 'mail');
const CRED_FILE = path.join(MAIL_DIR, 'credentials.json');

/**
 * fail loud:safeStorage 不可用时明确报错。
 * 不可用场景:Linux 无 keyring / 测试环境未初始化 —— 此时拒绝存密码。
 */
function assertEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      '[mail-credential-store] safeStorage 加密不可用(无系统 keyring),' +
        '拒绝明文存邮箱密码。请检查系统钥匙串/凭据管理器是否可用。',
    );
  }
}

function readAll(): StoredCredentials {
  try {
    if (!fs.existsSync(CRED_FILE)) return { version: '1', entries: {} };
    const raw = fs.readFileSync(CRED_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoredCredentials;
    if (parsed?.version !== '1' || typeof parsed.entries !== 'object') {
      console.warn('[mail-credential-store] 凭据文件结构异常,按空处理');
      return { version: '1', entries: {} };
    }
    return parsed;
  } catch (e) {
    // 读失败不 throw:凭据丢失的后果是「要求用户重新输入」,而不是整个应用起不来。
    // 但必须留痕 —— 静默当空会让用户以为自己没配过。
    console.error('[mail-credential-store] 读取凭据失败:', e);
    return { version: '1', entries: {} };
  }
}

function writeAll(data: StoredCredentials): void {
  fs.mkdirSync(MAIL_DIR, { recursive: true });
  const tmp = `${CRED_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, CRED_FILE); // POSIX 原子替换
}

/**
 * 存某账号的密码(明文入参,内部加密)。
 * @throws safeStorage 不可用时 throw(不静默明文落盘)
 */
export function saveMailPassword(accountId: string, password: string): void {
  if (!accountId || !password) {
    throw new Error('[mail-credential-store] accountId / password 不能为空');
  }
  assertEncryptionAvailable();
  const data = readAll();
  data.entries[accountId] = safeStorage.encryptString(password).toString('base64');
  writeAll(data);
}

/**
 * 取某账号的明文密码。未配置 / 解密失败返 null。
 *
 * 解密失败通常意味着换了机器或系统 keyring 被重置 —— 此时正确做法是让用户
 * 重新输入,而不是抛错阻断整个同步流程。但要留痕。
 */
export function getMailPassword(accountId: string): string | null {
  const data = readAll();
  const enc = data.entries[accountId];
  if (!enc) return null;
  try {
    assertEncryptionAvailable();
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch (e) {
    console.error(`[mail-credential-store] 解密账号 ${accountId} 的密码失败:`, e);
    return null;
  }
}

/** 删除某账号的密码(账号被删时调,避免残留) */
export function deleteMailPassword(accountId: string): void {
  const data = readAll();
  if (!(accountId in data.entries)) return;
  delete data.entries[accountId];
  writeAll(data);
}

/** 某账号是否已配置密码(配置向导判断用,不解密) */
export function hasMailPassword(accountId: string): boolean {
  return Boolean(readAll().entries[accountId]);
}
