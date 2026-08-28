/**
 * 邮箱模块 数据层类型(阶段 1:IMAP 只读同步)
 *
 * 与 mail-service-types(webview profile / selector)分开:那是阶段 0 的
 * 「网页版邮箱怎么嵌」,这里是「邮件数据长什么样」。两者唯一的交集是 MailServiceId。
 *
 * 设计见 docs/tasks/2026-08-26-mail-module-design.md。
 */

import type { MailServiceId } from './mail-service-types';

export type { MailServiceId };

// ═══════════════════════════════════════════════════════
// §1  账号
// ═══════════════════════════════════════════════════════

/**
 * 邮箱账号配置(对应 mail_account 表)。
 *
 * ⚠️ **不含密码** —— 密码走 safeStorage(credential-store),永不进 DB。
 * per-ws:与 webview partition `persist:webview-${ws}` 对齐,工作 ws 登公司邮箱、
 * 个人 ws 登私人邮箱,两边身份必须一致。
 */
export interface MailAccount {
  /** SurrealDB 记录 id(形如 `mail_account:xxx`) */
  id: string;
  wsId: string;
  serviceId: MailServiceId;
  /** 邮箱地址,同时是 IMAP 登录用户名 */
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost?: string;
  smtpPort?: number;
  /** 关掉后不参与同步(保留配置,不删) */
  enabled: boolean;
  createdAt: number;
}

/** 新建账号的入参(id / createdAt 由落库层生成) */
export interface CreateMailAccountInput {
  wsId: string;
  serviceId: MailServiceId;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost?: string;
  smtpPort?: number;
  /** 明文密码(应用专用密码);落库层转交 credential-store 加密,不写进 mail_account */
  password: string;
}

// ═══════════════════════════════════════════════════════
// §2  邮件
// ═══════════════════════════════════════════════════════

/** 附件元信息(阶段 1 只记元信息,不下载内容) */
export interface MailAttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  /**
   * Content-ID —— HTML 正文里 `<img src="cid:xxx">` 引用内联图片时用。
   * 阶段 3 归档到 note 时,要靠它把内联图换成本地 media:// 引用。
   */
  cid?: string;
}

/**
 * 一封邮件(对应 mail 表)。
 *
 * 去重主键是 (accountId, mailbox, uid) —— IMAP UID 在单个 mailbox 内唯一且递增。
 */
export interface MailRecord {
  id: string;
  accountId: string;
  /** IMAP mailbox 路径,如 'INBOX' / '[Gmail]/Sent Mail' */
  mailbox: string;
  /** IMAP UID(mailbox 内唯一;换 UIDVALIDITY 后会重号,故必须连 mailbox 一起用) */
  uid: number;
  /** RFC Message-ID(全球唯一,跨 mailbox/账号识别同一封邮件用) */
  messageId?: string;
  /** 线程键:References 链首 ?? In-Reply-To ?? 自身 messageId */
  threadKey?: string;
  subject: string;
  fromAddr: string;
  fromName?: string;
  toAddrs: string[];
  ccAddrs?: string[];
  /** 邮件发送时间(毫秒) */
  date: number;
  bodyText?: string;
  bodyHtml?: string;
  /** 列表页预览(正文前若干字,同步时算好,避免列表页拉全文) */
  snippet: string;
  /** IMAP flags,如 '\\Seen' '\\Flagged' '\\Answered' */
  flags: string[];
  hasAttach: boolean;
  attachments?: MailAttachmentMeta[];
  /** 已归档到 note 的话记 note id(避免重复归档 + 双向跳转) */
  archivedNoteId?: string;
  syncedAt: number;
}

/**
 * 单次同步最多拉多少封 —— 防止首次同步把几万封邮件一次性灌进来。
 *
 * 放在 shared 是因为 **renderer 也要用**:同步结果面板要告诉用户
 * 「单次上限 N 封,再点几次继续」。放主进程侧的话 renderer 只能抄一份常量,
 * 迟早两边对不上(用户看到的数字和实际行为不符)。
 */
export const MAIL_SYNC_BATCH_LIMIT = 200;

// ═══════════════════════════════════════════════════════
// §3  同步游标
// ═══════════════════════════════════════════════════════

/**
 * 每 (account, mailbox) 一行的增量同步游标。
 *
 * ⚠️ uidValidity 是**正确性关键**:IMAP 服务端重建 mailbox 时会换发 UIDVALIDITY,
 * 旧 UID 全部失效且可能重号。不校验就会张冠李戴(把新邮件当成同步过的跳过,
 * 或把不同的邮件写进同一条记录)。变化时必须丢弃游标全量重来。
 */
export interface MailSyncState {
  accountId: string;
  mailbox: string;
  uidValidity: number;
  /** 已同步到的最大 UID;追新时从 `UID > lastSeenUid` 拉 */
  lastSeenUid: number;
  /**
   * 已回填到的最小 UID;回填时从 `UID < backfillUid` 往下拉。
   *
   * 0 = 尚未开始回填(首次同步后由 mail-sync 初始化成本批最小 UID);
   * 1 = 已触底,该 mailbox 的历史邮件全部同步完毕。
   *
   * ⚠️ 没有这个游标就会丢数据:单次同步有上限,首次只取最新的一批,
   * 若只靠 lastSeenUid 向上追,更旧的邮件永远够不着(2026-08-28 真机踩到,
   * 1341 封只同步到 201 封就不动了)。
   */
  backfillUid: number;
  lastSyncAt: number;
}

// ═══════════════════════════════════════════════════════
// §4  同步结果(IPC 回传 + UI 展示)
// ═══════════════════════════════════════════════════════

export interface MailSyncResult {
  success: boolean;
  /** 本次新同步的邮件数 */
  fetched: number;
  /** 该 mailbox 累计已同步数 */
  total: number;
  /**
   * 服务端该 mailbox 的邮件总数(IMAP EXISTS)。
   * 和 total 一起构成对账:两者不等就说明还没同步完,UI 据此提示用户继续。
   */
  serverTotal?: number;
  /** 历史邮件是否已全部回填到位(backfillUid 触底) */
  backfillDone?: boolean;
  /**
   * UIDVALIDITY 变化触发了全量重来(需要提示用户,因为耗时会明显变长)。
   */
  resynced?: boolean;
  error?: string;
}

/** 账号连接测试结果(配置向导用) */
export interface MailTestResult {
  success: boolean;
  error?: string;
  /** 连接成功时返回该账号的 mailbox 列表,供用户选同步哪些 */
  mailboxes?: string[];
}
