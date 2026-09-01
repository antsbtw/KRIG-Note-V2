/**
 * Mail Service Profile 类型定义(邮箱模块 阶段 0)
 *
 * 与 AIServiceProfile / XServiceProfile 完全独立(同 X 的铁律 3):AI 是问答语义、
 * X 是推文语义,邮箱是「邮件列表 / 单封邮件」语义,三者 selector 与 URL 判定各不相干。
 *
 * ## 阶段 0 的定位:薄壳
 *
 * 本阶段只做「内嵌网页版邮箱 + 右键提取单封邮件」。selectors 只需要
 * `mailElement`(单封邮件的容器,右键定位用)。**不做批量 DOM 抓取** ——
 * 那是阶段 1 的 IMAP 的活(见 docs/10-business-design/mail/module-design.md §1)。
 *
 * ## imapDefaults 为什么现在就写
 *
 * 阶段 1 配置向导要按服务商预填 IMAP 服务器地址/端口,值是公开且稳定的常量
 * (imap.gmail.com:993 这类几年不变),现在写进 profile 比阶段 1 再散落到别处好。
 * 阶段 0 不读这个字段。
 *
 * ## selector 稳定性
 *
 * 网页版邮箱的 DOM 是编译产物(Gmail 的 class 名形如 `.zA.yO`),会随改版变化。
 * 故 selector 一律支持**逗号分隔多候选、运行时顺序命中**(web-service-base 原生支持),
 * 且失效时 fail loud 降级为「请手动复制」,绝不静默假装成功。
 * 影响面被限制在「右键提取单封」这一个功能 —— 数据层走 IMAP,不依赖 DOM。
 */

// ═══════════════════════════════════════════════════════
// §1  Mail Service ID
// ═══════════════════════════════════════════════════════

/**
 * 支持的网页版邮箱。
 *
 * 选型依据(设计方案 D3):第一版走「IMAP + 应用专用密码」,零 OAuth 依赖,
 * 故优先纳入**支持应用专用密码**的服务商。outlook 网页版可看可发(阶段 0),
 * 但其 IMAP 侧微软已逐步收紧基础认证 —— 阶段 1 接入时需实测,失败则该服务商
 * 仅保留 webview 形态(fail loud,不假装能同步)。
 */
export type MailServiceId = 'gmail' | 'outlook' | 'qq' | 'netease163';

// ═══════════════════════════════════════════════════════
// §2  MailServiceSelectors
// ═══════════════════════════════════════════════════════

export interface MailServiceSelectors {
  /**
   * 单封邮件的容器(阶段 0 右键提取用)。
   *
   * 语义:用户右键点在邮件正文/列表行上时,由 guest 内 `elementFromPoint(x,y).closest(sel)`
   * 向上找到的那个「一封邮件」的边界。web-service-base 的 buildHitTestScript 会在
   * miss 时于 ±24px 纵向邻域回退。
   *
   * ⚠️ SPIKE 待实机校验:下列为「待确认」初值,需在真机 devtools 逐个核对。
   * 网页版邮箱的 class 名是编译产物,优先选带语义的 role / aria 属性(更耐改版)。
   */
  mailElement: string;
  /**
   * 邮件正文区(阶段 0 提取正文用)。miss 则退回 mailElement 全文。
   * ⚠️ SPIKE 待实机校验。
   */
  mailBody?: string;
  /**
   * 邮件主题(阶段 0 提取标题用)。miss 则由正文首行兜底。
   * ⚠️ SPIKE 待实机校验。
   */
  mailSubject?: string;
}

// ═══════════════════════════════════════════════════════
// §3  IMAP 默认值(阶段 1 用,阶段 0 不读)
// ═══════════════════════════════════════════════════════

/**
 * 服务商的 IMAP/SMTP 默认连接参数,配置向导预填用。
 *
 * 这些是公开且长期稳定的常量。用户仍可在配置里覆盖(企业自建域名走自己的服务器)。
 */
export interface MailImapDefaults {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  /**
   * 申请应用专用密码的官方页面(配置向导直接深链过去,降低上手门槛)。
   * 设计方案 §5 的「应用专用密码需用户手动生成」风险的应对。
   */
  appPasswordUrl?: string;
}

// ═══════════════════════════════════════════════════════
// §4  MailServiceProfile
// ═══════════════════════════════════════════════════════

export interface MailServiceProfile {
  id: MailServiceId;
  name: string;
  icon: string;
  /** 站点根(诊断/日志用) */
  baseUrl: string;
  /** webview 初始 URL(收件箱) */
  homeUrl: string;
  /** 写信页直达 URL(阶段 0 「写邮件」按钮用) */
  composeUrl: string;
  /**
   * URL 判定正则(字符串形态,`new RegExp(p.urlPattern).test(url)`)。
   *
   * ⚠️ 这是**全模块最关键的字段**:shouldHandle / 右键菜单 belongsToService /
   * webcontents 定位校验 三处都靠它。写宽了会把普通浏览的网页误判成邮箱
   * (吞掉那些页面的原生右键菜单),写窄了则邮箱页收不到自己的菜单。
   */
  urlPattern: string;
  selectors: MailServiceSelectors;
  /** 阶段 1 用;阶段 0 不读 */
  imapDefaults?: MailImapDefaults;
}

// ═══════════════════════════════════════════════════════
// §5  Profiles
// ═══════════════════════════════════════════════════════

/**
 * Gmail
 *
 * urlPattern 只匹配 `mail.google.com` —— **不能**写成 `google\.com`,
 * 否则会把 Google 搜索/Drive/Docs 全判成邮箱,吞掉它们的普通浏览右键菜单。
 */
const GMAIL_PROFILE: MailServiceProfile = {
  id: 'gmail',
  name: 'Gmail',
  icon: '📧',
  baseUrl: 'https://mail.google.com',
  homeUrl: 'https://mail.google.com/mail/u/0/#inbox',
  composeUrl: 'https://mail.google.com/mail/u/0/#inbox?compose=new',
  urlPattern: '^https://mail\\.google\\.com',
  selectors: {
    // ⚠️ SPIKE 待实机校验。Gmail 列表行是 tr.zA,展开的单封邮件是 div[role=listitem]。
    // 优先 role(耐改版),class 作兜底候选。
    mailElement: 'div[role="listitem"], tr.zA, div.adn.ads',
    // Gmail 正文容器长期是 div.a3s(带 aria-label 的可读区)
    mailBody: 'div.a3s, div[data-message-id] div.ii',
    mailSubject: 'h2[data-thread-perm-id], h2.hP',
  },
  imapDefaults: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
  },
};

/**
 * Outlook / Hotmail
 *
 * 网页版域名有 outlook.live.com(个人)与 outlook.office.com(企业)两支,一并识别。
 * ⚠️ IMAP 侧微软在收紧基础认证,阶段 1 接入时需实测(见 MailServiceId 注释)。
 */
const OUTLOOK_PROFILE: MailServiceProfile = {
  id: 'outlook',
  name: 'Outlook',
  icon: '📨',
  baseUrl: 'https://outlook.live.com',
  homeUrl: 'https://outlook.live.com/mail/0/',
  composeUrl: 'https://outlook.live.com/mail/0/deeplink/compose',
  urlPattern: '^https://outlook\\.(live|office|office365)\\.com',
  selectors: {
    // ⚠️ SPIKE 待实机校验。Outlook 用 role=listitem + data-convid
    mailElement: 'div[role="listitem"][data-convid], div[role="listitem"]',
    mailBody: 'div[aria-label][role="document"], div.PlainText',
    mailSubject: 'div[role="heading"][aria-level="2"], span[role="heading"]',
  },
  imapDefaults: {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    appPasswordUrl: 'https://account.live.com/proofs/AppPassword',
  },
};

/**
 * QQ 邮箱
 *
 * IMAP 走「授权码」(即应用专用密码的国内叫法),在设置-账户里生成。
 */
const QQ_PROFILE: MailServiceProfile = {
  id: 'qq',
  name: 'QQ 邮箱',
  icon: '🐧',
  baseUrl: 'https://mail.qq.com',
  homeUrl: 'https://mail.qq.com/',
  composeUrl: 'https://mail.qq.com/cgi-bin/readtemplate?t=compose',
  urlPattern: '^https://(mail|wx)\\.qq\\.com',
  selectors: {
    // ⚠️ SPIKE 待实机校验。QQ 邮箱是老式 frame 结构,选择器稳定性最差。
    mailElement: 'div.mailList tr, div[id^="mailContentContainer"]',
    mailBody: 'div#mailContentContainer, div.mail_content',
    mailSubject: 'span#subject, div.subject',
  },
  imapDefaults: {
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    appPasswordUrl: 'https://service.mail.qq.com/detail/0/75',
  },
};

/**
 * 网易 163 邮箱
 */
const NETEASE163_PROFILE: MailServiceProfile = {
  id: 'netease163',
  name: '163 邮箱',
  icon: '📬',
  baseUrl: 'https://mail.163.com',
  homeUrl: 'https://mail.163.com/',
  composeUrl: 'https://mail.163.com/js6/main.jsp?sid=&func=compose',
  urlPattern: '^https://mail\\.163\\.com',
  selectors: {
    // ⚠️ SPIKE 待实机校验。
    mailElement: 'div[id^="_mail_list"] div.gWel, div.tK1',
    mailBody: 'div.netease_mail_readhtml, div#spnMailContent',
    mailSubject: 'span.dP0, div.oR0',
  },
  imapDefaults: {
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    appPasswordUrl: 'https://help.mail.163.com/faqDetail.do?code=d7a5dc8471cd0c0e8b4b8f4f8e49998b374173cfe9171305fa1ce630d7f67ac2a5feb28b66796d3b',
  },
};

export const MAIL_SERVICE_PROFILES: readonly MailServiceProfile[] = [
  GMAIL_PROFILE,
  OUTLOOK_PROFILE,
  QQ_PROFILE,
  NETEASE163_PROFILE,
] as const;

export const DEFAULT_MAIL_SERVICE: MailServiceId = 'gmail';

// ═══════════════════════════════════════════════════════
// §6  查询
// ═══════════════════════════════════════════════════════

/**
 * 按 id 取 profile。
 *
 * fail loud:找不到直接 throw —— id 来自本模块内部的 union 类型,取不到说明
 * profile 表与类型不同步(编码错误),静默兜底只会把问题推到更远的地方。
 */
export function getMailServiceProfile(id: MailServiceId): MailServiceProfile {
  const profile = MAIL_SERVICE_PROFILES.find((p) => p.id === id);
  if (!profile) {
    throw new Error(`[mail-service-types] 未知 MailServiceId: ${id}`);
  }
  return profile;
}

/**
 * 根据 URL 检测邮箱服务。
 *
 * ⚠️ 本函数是**三处判定的唯一来源**,改动影响面:
 *  1. `web-shared/should-handle.ts` —— 命中则把该 guest 排除出「普通浏览」,
 *     不加这一条会导致邮箱页**双右键菜单**(普通浏览的原生菜单 + 邮箱自己的菜单)
 *  2. `main/mail/webview-hook.ts` —— 命中才挂邮箱右键菜单
 *  3. `main/mail/mail-webcontents.ts` —— 定位目标 guest 时校验它确实是邮箱页
 *
 * @returns 匹配的 Profile,未匹配返回 null
 */
export function detectMailServiceByUrl(url: string): MailServiceProfile | null {
  return MAIL_SERVICE_PROFILES.find((p) => new RegExp(p.urlPattern).test(url)) ?? null;
}
