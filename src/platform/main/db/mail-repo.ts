/**
 * mail_account / mail / mail_sync_state 表 CRUD(邮箱模块 阶段 1)
 *
 * 调用边界:仅 main 进程调用,直接 import @storage/surreal/client。
 *
 * ## 命名映射
 *
 * DB 行是 snake_case、类型是 camelCase,两者靠本文件的 rowToXxx 显式转换
 * (照 search-recipe-repo)。不用自动转换 —— 隐式映射一旦漂移就很难查。
 *
 * ## id 策略
 *
 * 各表都有自己的业务 id 字段(account_id / mail_id),**不依赖 SurrealDB 内建
 * record id**。铁律:绝不 DEFINE FIELD id(1.8.6 踩过 readonly 冲突,
 * 表现是新建/保存静默失败)。业务 id 用 ULID。
 */

import { getDB } from '@storage/surreal/client';
import { generateUlid } from '@shared/ulid';
import type {
  MailAccount,
  CreateMailAccountInput,
  MailRecord,
  MailSyncState,
  MailAttachmentMeta,
  MailServiceId,
} from '@shared/types/mail-types';
import { saveMailPassword, deleteMailPassword } from '../mail/credential-store';

// ═══════════════════════════════════════════════════════
// §1  mail_account
// ═══════════════════════════════════════════════════════

interface AccountRow {
  account_id: string;
  ws_id: string;
  service_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  enabled: boolean;
  created_at: string;
}

function rowToAccount(row: AccountRow): MailAccount {
  return {
    id: row.account_id,
    wsId: row.ws_id,
    serviceId: row.service_id as MailServiceId,
    email: row.email,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure,
    smtpHost: row.smtp_host ?? undefined,
    smtpPort: row.smtp_port ?? undefined,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * 新建账号。密码转交 credential-store 加密落盘,**不写进 DB**。
 *
 * ⚠️ 顺序很重要:先存密码再写 DB。反过来的话,密码存失败(safeStorage 不可用)
 * 会留下一条永远连不上的账号记录 —— 用户看到账号在列表里却一直同步失败,
 * 比「创建失败」更难排查。
 */
export async function createAccount(input: CreateMailAccountInput): Promise<MailAccount> {
  const accountId = generateUlid();
  // fail loud:密码存不下就别建账号(saveMailPassword 内部 throw)
  saveMailPassword(accountId, input.password);

  const db = getDB();
  const now = new Date();
  await db.query(
    `INSERT INTO mail_account {
      account_id: $account_id, ws_id: $ws_id, service_id: $service_id, email: $email,
      imap_host: $imap_host, imap_port: $imap_port, imap_secure: $imap_secure,
      smtp_host: $smtp_host, smtp_port: $smtp_port, enabled: true, created_at: $created_at
    }`,
    {
      account_id: accountId,
      ws_id: input.wsId,
      service_id: input.serviceId,
      email: input.email,
      imap_host: input.imapHost,
      imap_port: input.imapPort,
      imap_secure: input.imapSecure,
      smtp_host: input.smtpHost ?? null,
      smtp_port: input.smtpPort ?? null,
      created_at: now,
    },
  );

  return {
    id: accountId,
    wsId: input.wsId,
    serviceId: input.serviceId,
    email: input.email,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    enabled: true,
    createdAt: now.getTime(),
  };
}

/** 列出某 ws 的账号 */
export async function listAccounts(wsId: string): Promise<MailAccount[]> {
  const db = getDB();
  const res = await db.query<[AccountRow[]]>(
    `SELECT * FROM mail_account WHERE ws_id = $ws_id ORDER BY created_at ASC`,
    { ws_id: wsId },
  );
  return (res[0] ?? []).map(rowToAccount);
}

export async function getAccount(accountId: string): Promise<MailAccount | null> {
  const db = getDB();
  const res = await db.query<[AccountRow[]]>(
    `SELECT * FROM mail_account WHERE account_id = $id LIMIT 1`,
    { id: accountId },
  );
  const row = (res[0] ?? [])[0];
  return row ? rowToAccount(row) : null;
}

/**
 * 删账号 —— 连带清干净密码、邮件、同步游标。
 *
 * 只删 mail_account 会留下三处孤儿:credential-store 里的密码(安全隐患)、
 * mail 表里指向不存在账号的邮件、mail_sync_state 里的游标(重建同名账号时
 * 会拿到旧游标 → 新邮件被当成同步过的跳过)。
 */
export async function deleteAccount(accountId: string): Promise<void> {
  const db = getDB();
  await db.query(`DELETE FROM mail WHERE account_id = $id`, { id: accountId });
  await db.query(`DELETE FROM mail_sync_state WHERE account_id = $id`, { id: accountId });
  await db.query(`DELETE FROM mail_account WHERE account_id = $id`, { id: accountId });
  deleteMailPassword(accountId);
}

/**
 * 改密码 —— 只覆写 safeStorage,不动 mail_account(密码本来就不在 DB 里)。
 *
 * 用途:应用专用密码被吊销/重新生成,或首次填错(如带了空格)。
 * 没有这个入口的话用户只能删账号重建 —— 那会连带删掉已同步的邮件,代价过大。
 */
export async function updateAccountPassword(
  accountId: string,
  password: string,
): Promise<void> {
  const account = await getAccount(accountId);
  if (!account) throw new Error('账号不存在');
  saveMailPassword(accountId, password); // 内部去空白 + fail loud
}

export async function setAccountEnabled(accountId: string, enabled: boolean): Promise<void> {
  const db = getDB();
  await db.query(`UPDATE mail_account SET enabled = $enabled WHERE account_id = $id`, {
    id: accountId,
    enabled,
  });
}

// ═══════════════════════════════════════════════════════
// §2  mail
// ═══════════════════════════════════════════════════════

interface MailRow {
  mail_id: string;
  account_id: string;
  mailbox: string;
  uid: number;
  message_id: string | null;
  thread_key: string | null;
  subject: string;
  from_addr: string;
  from_name: string | null;
  to_addrs: string[];
  cc_addrs: string[] | null;
  date: string;
  body_text: string | null;
  body_html: string | null;
  snippet: string;
  flags: string[];
  has_attach: boolean;
  attachments: MailAttachmentMeta[] | null;
  archived_note_id: string | null;
  synced_at: string;
}

function rowToMail(row: MailRow): MailRecord {
  return {
    id: row.mail_id,
    accountId: row.account_id,
    mailbox: row.mailbox,
    uid: row.uid,
    messageId: row.message_id ?? undefined,
    threadKey: row.thread_key ?? undefined,
    subject: row.subject,
    fromAddr: row.from_addr,
    fromName: row.from_name ?? undefined,
    toAddrs: row.to_addrs ?? [],
    ccAddrs: row.cc_addrs ?? undefined,
    date: new Date(row.date).getTime(),
    bodyText: row.body_text ?? undefined,
    bodyHtml: row.body_html ?? undefined,
    snippet: row.snippet,
    flags: row.flags ?? [],
    hasAttach: row.has_attach,
    attachments: row.attachments ?? undefined,
    archivedNoteId: row.archived_note_id ?? undefined,
    syncedAt: new Date(row.synced_at).getTime(),
  };
}

/**
 * 批量写入邮件。
 *
 * 用 INSERT IGNORE —— UNIQUE(account_id, mailbox, uid) 冲突即「这封已经同步过」,
 * 直接跳过。增量同步理论上不会撞,但 UIDVALIDITY 重来 / 并发同步 / 中断重试
 * 都可能重复投递,靠数据库唯一索引兜底比在应用层判重可靠。
 */
export async function insertMails(
  accountId: string,
  mails: Omit<MailRecord, 'id' | 'accountId' | 'syncedAt'>[],
): Promise<number> {
  if (mails.length === 0) return 0;
  const db = getDB();
  const now = new Date();
  let inserted = 0;

  for (const m of mails) {
    await db.query(
      `INSERT IGNORE INTO mail {
        mail_id: $mail_id, account_id: $account_id, mailbox: $mailbox, uid: $uid,
        message_id: $message_id, thread_key: $thread_key, subject: $subject,
        from_addr: $from_addr, from_name: $from_name, to_addrs: $to_addrs, cc_addrs: $cc_addrs,
        date: $date, body_text: $body_text, body_html: $body_html, snippet: $snippet,
        flags: $flags, has_attach: $has_attach, attachments: $attachments,
        archived_note_id: NONE, synced_at: $synced_at
      }`,
      {
        mail_id: generateUlid(),
        account_id: accountId,
        mailbox: m.mailbox,
        uid: m.uid,
        message_id: m.messageId ?? null,
        thread_key: m.threadKey ?? null,
        subject: m.subject,
        from_addr: m.fromAddr,
        from_name: m.fromName ?? null,
        to_addrs: m.toAddrs,
        cc_addrs: m.ccAddrs ?? null,
        date: new Date(m.date),
        body_text: m.bodyText ?? null,
        body_html: m.bodyHtml ?? null,
        snippet: m.snippet,
        flags: m.flags,
        has_attach: m.hasAttach,
        attachments: m.attachments ?? null,
        synced_at: now,
      },
    );
    inserted++;
  }
  return inserted;
}

/** 列出某账号某 mailbox 的邮件(按日期倒序) */
export async function listMails(
  accountId: string,
  mailbox: string,
  limit = 50,
  offset = 0,
): Promise<MailRecord[]> {
  const db = getDB();
  const res = await db.query<[MailRow[]]>(
    `SELECT * FROM mail WHERE account_id = $acct AND mailbox = $mbox
     ORDER BY date DESC LIMIT $limit START $offset`,
    { acct: accountId, mbox: mailbox, limit, offset },
  );
  return (res[0] ?? []).map(rowToMail);
}

export async function getMail(mailId: string): Promise<MailRecord | null> {
  const db = getDB();
  const res = await db.query<[MailRow[]]>(
    `SELECT * FROM mail WHERE mail_id = $id LIMIT 1`,
    { id: mailId },
  );
  const row = (res[0] ?? [])[0];
  return row ? rowToMail(row) : null;
}

/** 某账号某 mailbox 已同步邮件总数(同步状态面板用) */
export async function countMails(accountId: string, mailbox: string): Promise<number> {
  const db = getDB();
  const res = await db.query<[Array<{ c: number }>]>(
    `SELECT count() AS c FROM mail WHERE account_id = $acct AND mailbox = $mbox GROUP ALL`,
    { acct: accountId, mbox: mailbox },
  );
  return (res[0] ?? [])[0]?.c ?? 0;
}

/** 归档到 note 后回写引用(避免重复归档 + 双向跳转) */
export async function setMailArchivedNote(mailId: string, noteId: string): Promise<void> {
  const db = getDB();
  await db.query(`UPDATE mail SET archived_note_id = $note WHERE mail_id = $id`, {
    id: mailId,
    note: noteId,
  });
}

// ═══════════════════════════════════════════════════════
// §3  mail_sync_state
// ═══════════════════════════════════════════════════════

interface SyncStateRow {
  account_id: string;
  mailbox: string;
  uid_validity: number;
  last_seen_uid: number;
  last_sync_at: string;
}

export async function getSyncState(
  accountId: string,
  mailbox: string,
): Promise<MailSyncState | null> {
  const db = getDB();
  const res = await db.query<[SyncStateRow[]]>(
    `SELECT * FROM mail_sync_state WHERE account_id = $acct AND mailbox = $mbox LIMIT 1`,
    { acct: accountId, mbox: mailbox },
  );
  const row = (res[0] ?? [])[0];
  if (!row) return null;
  return {
    accountId: row.account_id,
    mailbox: row.mailbox,
    uidValidity: row.uid_validity,
    lastSeenUid: row.last_seen_uid,
    lastSyncAt: new Date(row.last_sync_at).getTime(),
  };
}

/** 写入/更新游标(UPSERT 靠 UNIQUE(account_id, mailbox)) */
export async function upsertSyncState(state: Omit<MailSyncState, 'lastSyncAt'>): Promise<void> {
  const db = getDB();
  const existing = await getSyncState(state.accountId, state.mailbox);
  const now = new Date();
  if (existing) {
    await db.query(
      `UPDATE mail_sync_state SET uid_validity = $uv, last_seen_uid = $uid, last_sync_at = $now
       WHERE account_id = $acct AND mailbox = $mbox`,
      {
        acct: state.accountId,
        mbox: state.mailbox,
        uv: state.uidValidity,
        uid: state.lastSeenUid,
        now,
      },
    );
  } else {
    await db.query(
      `INSERT INTO mail_sync_state {
        account_id: $acct, mailbox: $mbox, uid_validity: $uv,
        last_seen_uid: $uid, last_sync_at: $now
      }`,
      {
        acct: state.accountId,
        mbox: state.mailbox,
        uv: state.uidValidity,
        uid: state.lastSeenUid,
        now,
      },
    );
  }
}

/**
 * UIDVALIDITY 变了 —— 丢弃该 mailbox 的全部已同步邮件与游标,准备全量重来。
 *
 * 为什么必须整个清空而不是继续增量:UIDVALIDITY 变化意味着服务端重建了 mailbox,
 * 旧 UID 全部失效**且会被重新分配给不同的邮件**。留着旧数据继续按 UID 增量,
 * 会把新邮件当成"已同步过的 UID"跳过,或者让两封不同的邮件撞进同一条唯一索引。
 */
export async function resetMailbox(accountId: string, mailbox: string): Promise<void> {
  const db = getDB();
  await db.query(`DELETE FROM mail WHERE account_id = $acct AND mailbox = $mbox`, {
    acct: accountId,
    mbox: mailbox,
  });
  await db.query(
    `DELETE FROM mail_sync_state WHERE account_id = $acct AND mailbox = $mbox`,
    { acct: accountId, mbox: mailbox },
  );
}
