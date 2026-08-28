/**
 * IMAP 客户端(邮箱模块 阶段 1)—— 连接、认证、拉取
 *
 * 底层用 imapflow(现代 Promise API,Nodemailer 团队维护),MIME 解析用 mailparser。
 *
 * ## 认证:应用专用密码,零 OAuth 依赖
 *
 * 设计 D3:第一版走 PLAIN/LOGIN + 应用专用密码。Gmail(开两步验证后)、QQ、163、
 * iCloud、Fastmail、企业自建都支持,用户自己去邮箱设置里生成,不需要我们申请任何
 * 东西、不被任何审核卡住。将来接 OAuth 时把 `pass` 换成 XOAUTH2 token 即可,
 * imapflow 两种都支持,切换成本接近零。
 *
 * ## 连接策略:每次同步开一条,用完即关
 *
 * **不做连接池 / 不做常驻 IDLE**。理由:
 * - 阶段 1 是「只读同步」,触发是用户点按钮或定时,不需要实时推送
 * - 常驻连接是个必须在 before-quit 里显式关闭的资源(graceful-shutdown 铁律),
 *   而且服务端会因超时静默断开,得处理重连 —— 这些复杂度在阶段 1 没有收益
 * - IMAP 服务端普遍限制并发连接数(Gmail 15 条),池化反而容易撞上限
 *
 * 将来做实时收信(IDLE)时再引入常驻连接,那时必须配套 before-quit 关闭调用。
 *
 * ## fail loud
 *
 * 连不上要**响**:认证失败/网络不通/超时都返回明确 error 文案,不静默重试到天荒地老。
 * imapflow 自身不重试,我们也不加 —— 用户点了同步没反应比报错更糟。
 */

import { ImapFlow, type ListResponse } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import {
  MAIL_SYNC_BATCH_LIMIT,
  type MailAccount,
  type MailRecord,
  type MailAttachmentMeta,
} from '@shared/types/mail-types';
import { getMailPassword } from './credential-store';

/**
 * 三种超时的语义完全不同,初版全设成 30s 是错的:
 *
 * - connectionTimeout:TCP+TLS 握手上限。连不上就是连不上,30s 足够。
 * - greetingTimeout:等服务器打招呼。同上量级。
 * - socketTimeout:**socket 空闲**看门狗,不是「命令超时」。imapflow 默认 5 分钟。
 *   设成 30s 会让正常的大批量 FETCH(解析几百封邮件时 socket 会短暂安静)
 *   被误判成死连接 —— 实测就是这么崩的。
 */
const CONNECT_TIMEOUT_MS = 30_000;
const SOCKET_IDLE_TIMEOUT_MS = 300_000;

/**
 * 单次同步上限 —— 唯一来源在 shared(renderer 的同步结果面板也要显示这个数字)。
 * 别在这里另立一个常量,两边对不上时用户看到的提示就是错的。
 */
const MAX_FETCH_PER_SYNC = MAIL_SYNC_BATCH_LIMIT;

/** 列表页预览截断长度 */
const SNIPPET_LEN = 200;

/**
 * 建立一条 IMAP 连接。调用方**必须**在 finally 里 logout()。
 *
 * @throws 认证失败 / 网络不通 / 超时(消息已转成中文可读文案)
 */
export async function connect(account: MailAccount): Promise<ImapFlow> {
  const password = getMailPassword(account.id);
  if (!password) {
    throw new Error(
      `账号 ${account.email} 没有可用密码 —— 可能是首次配置未完成,` +
        `或换了机器导致系统钥匙串里的凭据无法解密。请重新填写应用专用密码。`,
    );
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.email, pass: password },
    // imapflow 默认往 stdout 打全量协议日志,噪音极大且含邮件内容 —— 关掉
    logger: false,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_IDLE_TIMEOUT_MS,
  });

  /**
   * ⚠️ 必须挂 error 监听器 —— ImapFlow 是 EventEmitter,socket 层的异步错误
   * (如 'Socket timeout')经 emit('error') 抛出,**不在任何 try/catch 的调用栈里**。
   * EventEmitter 的 'error' 事件没有监听器时会升级为未捕获异常,
   * 在 Electron 主进程里直接弹「A JavaScript error occurred in the main process」
   * 并崩掉整个 app(实测踩到)。
   *
   * 这里只记录不重抛:连接已经坏了,正在 await 的那个命令会自己失败并走正常
   * 错误路径;监听器的唯一职责是阻止进程级崩溃。
   */
  client.on('error', (err) => {
    console.error(`[imap-client] 连接错误 (${account.email}):`, err?.message ?? err);
  });

  try {
    await client.connect();
  } catch (e) {
    throw new Error(toReadableError(e, account));
  }
  return client;
}

/**
 * 把 imapflow / 网络层的原始错误转成用户能看懂的话。
 *
 * fail loud 不等于把栈扔给用户 —— 「AUTHENTICATIONFAILED」对用户毫无意义,
 * 「密码不对,注意 Gmail 需要应用专用密码而非账号密码」才是可操作的。
 */
function toReadableError(e: unknown, account: MailAccount): string {
  // imapflow 把服务器的真实回复放在 responseText / serverResponseCode,
  // message 常常只是 'Command failed' 这类无信息量的壳(实测踩到:
  // 认证失败显示成「连接失败:Command failed」,用户完全不知道发生了什么)。
  // 故三个字段一起看。
  const err = e as {
    message?: string;
    responseText?: string;
    serverResponseCode?: string;
    authenticationFailed?: boolean;
    code?: string;
  } | null;
  const message = err?.message ?? String(e);
  const responseText = err?.responseText ?? '';
  const serverCode = err?.serverResponseCode ?? '';
  // 给用户看的原文:优先服务器回复(有实质内容),没有才退回 message
  const raw = [responseText, serverCode && `[${serverCode}]`, responseText ? '' : message]
    .filter(Boolean)
    .join(' ')
    .trim() || message;
  const lower = `${message} ${responseText} ${serverCode} ${err?.code ?? ''}`.toLowerCase();

  // imapflow 的 AuthenticationFailure 带这个标记 —— 比字符串匹配可靠
  if (err?.authenticationFailed) {
    return (
      `认证失败(${account.email}):${raw}\n\n` +
      `Gmail / QQ / 163 等**不接受账号密码**,必须在邮箱设置里生成「应用专用密码」` +
      `(QQ/163 叫「授权码」)。\n` +
      `另:Gmail 需要先开启两步验证,否则应用专用密码页面不会出现。`
    );
  }

  if (lower.includes('auth') || lower.includes('login') || lower.includes('credentials')) {
    return (
      `认证失败(${account.email}):密码不被接受。\n` +
      `注意:Gmail / QQ / 163 等都**不能用账号密码**,必须在邮箱设置里生成「应用专用密码」` +
      `(QQ/163 叫「授权码」)。原始信息:${raw}`
    );
  }
  if (lower.includes('timeout') || lower.includes('etimedout')) {
    return `连接超时(${account.imapHost}:${account.imapPort}):检查网络或代理设置。原始信息:${raw}`;
  }
  if (lower.includes('enotfound') || lower.includes('dns')) {
    return `找不到服务器 ${account.imapHost}:检查 IMAP 服务器地址是否填对。原始信息:${raw}`;
  }
  if (lower.includes('econnrefused')) {
    return `服务器拒绝连接(${account.imapHost}:${account.imapPort}):检查端口与 SSL 设置。原始信息:${raw}`;
  }
  if (lower.includes('certificate') || lower.includes('self signed')) {
    return `TLS 证书校验失败(${account.imapHost}):企业自建服务器可能用了自签证书。原始信息:${raw}`;
  }
  // 兜底也要给可操作的方向 —— 'Command failed' 这种壳信息对用户毫无用处
  return (
    `连接 ${account.imapHost}:${account.imapPort} 失败:${raw}\n\n` +
    `常见原因:① 用了账号密码而非应用专用密码;② 邮箱未开启 IMAP 访问` +
    `(Gmail 在「设置 → 转发和 POP/IMAP」里);③ 网络/代理拦截了 993 端口。`
  );
}

/** 测试连接并列出 mailbox(配置向导用) */
export async function testConnection(
  account: MailAccount,
): Promise<{ success: boolean; error?: string; mailboxes?: string[] }> {
  let client: ImapFlow | null = null;
  try {
    client = await connect(account);
    const list = (await client.list()) as ListResponse[];
    // 排除不可选的容器节点(如 Gmail 的 '[Gmail]' 本身)
    const mailboxes = list.filter((m) => !m.flags?.has('\\Noselect')).map((m) => m.path);
    return { success: true, mailboxes };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (client) await safeLogout(client);
  }
}

/** logout 失败不该盖过业务错误 —— 连接反正要丢弃了 */
async function safeLogout(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    /* 连接已断/超时,忽略 */
  }
}

/** 打开 mailbox 拿到 UIDVALIDITY 与最大 UID(增量同步的前置探测) */
export interface MailboxStatus {
  uidValidity: number;
  uidNext: number;
  exists: number;
}

export async function openMailbox(client: ImapFlow, mailbox: string): Promise<MailboxStatus> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const mb = client.mailbox;
    if (!mb || typeof mb === 'boolean') {
      throw new Error(`打开 mailbox 失败:${mailbox}`);
    }
    return {
      // uidValidity 在 imapflow 里是 BigInt,转 number(实际值远小于 2^53)
      uidValidity: Number(mb.uidValidity),
      uidNext: Number(mb.uidNext),
      exists: mb.exists,
    };
  } finally {
    lock.release();
  }
}

/**
 * 拉取 UID 大于 sinceUid 的邮件。
 *
 * @param sinceUid 上次同步到的最大 UID;0 表示全量(首次同步 / UIDVALIDITY 重来)
 * @returns 解析好的邮件(不含 id/accountId/syncedAt,那些由 repo 生成)
 */
export async function fetchSince(
  client: ImapFlow,
  mailbox: string,
  sinceUid: number,
): Promise<Array<Omit<MailRecord, 'id' | 'accountId' | 'syncedAt'>>> {
  // `${sinceUid + 1}:*` 是 IMAP 的 UID 区间语法。sinceUid=0 → '1:*' = 全部。
  // 超量时取**最新的**一批(pick='newest'):首次同步用户要看的是最近的邮件。
  return fetchRange(client, mailbox, `${sinceUid + 1}:*`, 'newest');
}

/**
 * 向下回填:拉取 UID **小于** beforeUid 的历史邮件。
 *
 * 为什么需要它:单次同步有上限,fetchSince 超量时只取最新的一批,更旧的邮件
 * 靠向上追新的游标永远够不着(2026-08-28 真机:1341 封只同步到 201 封就不动了)。
 * 回填从已有的最小 UID 往下走,与追新两头收敛,最终覆盖整个 mailbox。
 *
 * @param beforeUid 已回填到的最小 UID;拉 `1:beforeUid-1`,取其中**最新的**一批
 *   —— 由近及远逐批回填,用户先拿到时间上更近的历史邮件。
 * @returns beforeUid <= 1 时返回空数组(已触底)
 */
export async function fetchBefore(
  client: ImapFlow,
  mailbox: string,
  beforeUid: number,
): Promise<Array<Omit<MailRecord, 'id' | 'accountId' | 'syncedAt'>>> {
  if (beforeUid <= 1) return [];
  return fetchRange(client, mailbox, `1:${beforeUid - 1}`, 'newest');
}

/**
 * 取一个 UID 区间的邮件,超过 MAX_FETCH_PER_SYNC 时按 pick 截取一批。
 *
 * 两步走(先列 UID 再取正文)是刻意的:先只 FETCH uid 很轻,拿到全集后才能
 * 精确截取「最新的 N 封」;若直接按区间取正文,超量时截断的是**任意**一批,
 * 而且白白传输了不要的邮件正文。
 */
async function fetchRange(
  client: ImapFlow,
  mailbox: string,
  range: string,
  pick: 'newest' | 'oldest',
): Promise<Array<Omit<MailRecord, 'id' | 'accountId' | 'syncedAt'>>> {
  const lock = await client.getMailboxLock(mailbox);
  const out: Array<Omit<MailRecord, 'id' | 'accountId' | 'syncedAt'>> = [];

  try {
    const uids: number[] = [];
    for await (const msg of client.fetch(range, { uid: true }, { uid: true })) {
      uids.push(msg.uid);
    }
    if (uids.length === 0) return out;

    uids.sort((a, b) => a - b);
    const picked =
      uids.length > MAX_FETCH_PER_SYNC
        ? pick === 'newest'
          ? uids.slice(-MAX_FETCH_PER_SYNC)
          : uids.slice(0, MAX_FETCH_PER_SYNC)
        : uids;

    for await (const msg of client.fetch(
      picked.join(','),
      { uid: true, flags: true, source: true },
      { uid: true },
    )) {
      if (!msg.source) continue;
      try {
        const parsed = await simpleParser(msg.source);
        out.push(toMailRecord(parsed, mailbox, msg.uid, msg.flags));
      } catch (e) {
        // 单封解析失败不该让整次同步失败 —— 但要留痕,不静默吞掉
        console.error(`[imap-client] 解析邮件失败 uid=${msg.uid} mailbox=${mailbox}:`, e);
      }
    }
  } finally {
    lock.release();
  }

  return out;
}

/** ParsedMail → MailRecord(字段映射 + 线程键推导) */
function toMailRecord(
  parsed: ParsedMail,
  mailbox: string,
  uid: number,
  flags?: Set<string>,
): Omit<MailRecord, 'id' | 'accountId' | 'syncedAt'> {
  const from = parsed.from?.value?.[0];
  const bodyText = parsed.text ?? '';
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : undefined;

  const attachments: MailAttachmentMeta[] = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename ?? '(未命名附件)',
    contentType: a.contentType ?? 'application/octet-stream',
    size: a.size ?? 0,
    /** cid 用于内联图(HTML 正文里 <img src="cid:xxx">),阶段 3 归档时会用到 */
    cid: a.cid ?? undefined,
  }));

  return {
    mailbox,
    uid,
    messageId: parsed.messageId ?? undefined,
    threadKey: deriveThreadKey(parsed),
    subject: (parsed.subject ?? '').trim() || '(无主题)',
    fromAddr: from?.address ?? '',
    fromName: from?.name || undefined,
    toAddrs: addrList(parsed.to),
    ccAddrs: addrList(parsed.cc).length > 0 ? addrList(parsed.cc) : undefined,
    date: (parsed.date ?? new Date()).getTime(),
    bodyText: bodyText || undefined,
    bodyHtml,
    snippet: makeSnippet(bodyText || stripTags(bodyHtml ?? '')),
    flags: flags ? [...flags] : [],
    hasAttach: attachments.length > 0,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

/**
 * 线程键:References 链首 → In-Reply-To → 自身 Message-ID。
 *
 * RFC 5322 的 References 头按时间顺序记录整条线索,**首个**就是线程根。
 * 一封新邮件没有 References/In-Reply-To,它自己就是根。
 */
function deriveThreadKey(parsed: ParsedMail): string | undefined {
  const refs = parsed.references;
  if (Array.isArray(refs) && refs.length > 0) return refs[0];
  if (typeof refs === 'string' && refs.trim()) return refs.trim().split(/\s+/)[0];
  if (parsed.inReplyTo) return parsed.inReplyTo;
  return parsed.messageId ?? undefined;
}

function addrList(field: ParsedMail['to']): string[] {
  if (!field) return [];
  const arr = Array.isArray(field) ? field : [field];
  return arr.flatMap((a) => (a.value ?? []).map((v) => v.address ?? '')).filter(Boolean);
}

function makeSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET_LEN ? `${flat.slice(0, SNIPPET_LEN)}…` : flat;
}

/** 极简去标签 —— 只为算 snippet,不是正文渲染(那是阶段 3 走 Defuddle 的事) */
function stripTags(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ');
}

export { MAX_FETCH_PER_SYNC };
