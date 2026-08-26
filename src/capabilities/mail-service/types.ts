/**
 * mail-service capability — 对外类型(阶段 0)
 *
 * 与 ai-extraction / x-extraction 完全独立:AI 是问答语义、X 是推文语义,
 * 邮箱是「邮件」语义,三者不复用彼此的 API。
 *
 * view 通过 requireCapabilityApi<MailServiceApi>('mail-service') 取 api。
 */

import type { ComponentType, CSSProperties, Ref } from 'react';
import type { MailServiceId } from '@shared/types/mail-service-types';
import type {
  MailAccount,
  MailRecord,
  MailSyncResult,
  MailTestResult,
  CreateMailAccountInput,
} from '@shared/types/mail-types';

export type { MailServiceId };
export type { MailAccount, MailRecord, MailSyncResult, MailTestResult };

/** 抓到的邮件字段(阶段 0 纯文本;附件/线程/flags 要等阶段 1 的 IMAP) */
export interface MailExtractData {
  subject?: string;
  bodyText?: string;
  from?: string;
  /** 收件日期(网页显示文本原样,未解析) */
  date?: string;
  sourceUrl?: string;
}

/** 右键提取单封邮件的结果 */
export interface MailExtractResult {
  success: boolean;
  data?: MailExtractData;
  error?: string;
}

/** 原生右键菜单点击推送 payload(guest viewport 坐标) */
export interface MailExtractRequest {
  serviceId: MailServiceId;
  x: number;
  y: number;
}

/** Mail Host(嵌网页版邮箱的 webview)imperative API */
export interface MailHostHandle {
  /** 导航到当前服务的收件箱 */
  goHome(): void;
  /** 导航到当前服务的写信页 */
  goCompose(): void;
  /** 导航到任意 URL */
  navigate(url: string): void;
  /** 重新加载 */
  reload(): void;
  /** 后退(网页版邮箱是 SPA,hash 路由后退常用) */
  goBack(): void;
  /** 取当前 URL */
  getURL(): string;
  /** 取 guest webContents id(提取按 ws 定向用);未 dom-ready / 取不到返 null */
  getWebContentsId(): number | null;
}

export interface MailHostProps {
  workspaceId: string;
  /** 当前邮箱服务(切换服务 = 换 homeUrl 导航,不重建 webview) */
  serviceId: MailServiceId;
  className?: string;
  style?: CSSProperties;
  /** 用户在 webview 内导航时回传 URL */
  onUrlChanged?: (url: string) => void;
  /** loading 状态推送(toolbar spinner 用) */
  onLoadingChanged?: (loading: boolean) => void;
}

export interface MailServiceApi {
  /**
   * 右键单封提取:按 guest viewport 坐标定位 + 抓主题/正文/发件人。
   *
   * targetWcId:本活跃 ws 的 Mail Host guest wcId(命令侧经 getMailHostWcId 取出后
   * 透传,按活跃 ws 定向,治多实例串扰)。缺失 → main 侧 fail loud,不回退全局。
   */
  extractMail(
    serviceId: MailServiceId,
    x: number,
    y: number,
    targetWcId?: number | null,
  ): Promise<MailExtractResult>;
  /** 订阅邮箱 webview 原生右键菜单点击(main 推 guest 坐标);返 unsubscribe */
  onExtractRequest(callback: (payload: MailExtractRequest) => void): () => void;
  // ── Mail Host wc 按 ws 登记(提取按活跃 ws 定向,治多实例串扰)──
  /** 登记某 ws 的 Mail Host guest wc id(MailView 调) */
  registerMailHostWcId(wsId: string, wcId: number): void;
  /** 清除某 ws 的登记(MailView 卸载调) */
  clearMailHostWcId(wsId: string): void;
  /** 取某 ws 的 Mail Host guest wc id;未登记返 null */
  getMailHostWcId(wsId: string): number | null;
  /** Mail Host — forwardRef MailHostHandle,封装 webview 生命周期 + per-ws partition */
  Host: ComponentType<MailHostProps & { ref?: Ref<MailHostHandle> }>;

  // ── 阶段 1:IMAP 只读同步 ──
  /** 列出本 ws 的账号(不含密码) */
  listAccounts(wsId: string): Promise<MailAccount[]>;
  /**
   * 新建账号。
   * ⚠️ password 明文入参,经 IPC 交给 main 侧 safeStorage 加密落盘,**不进 SurrealDB**。
   * renderer 侧用完即弃,不要存进任何 state / 日志。
   */
  createAccount(
    input: CreateMailAccountInput,
  ): Promise<{ success: boolean; account?: MailAccount; error?: string }>;
  /** 删账号(连带清密码/邮件/游标) */
  deleteAccount(accountId: string): Promise<{ success: boolean; error?: string }>;
  /** 测试连接 + 列 mailbox(配置向导用) */
  testAccount(accountId: string): Promise<MailTestResult>;
  /** 增量同步一个 mailbox(缺省 INBOX) */
  sync(accountId: string, mailbox?: string): Promise<MailSyncResult>;
  /** 列邮件(日期倒序,分页) */
  listMails(
    accountId: string,
    mailbox?: string,
    limit?: number,
    offset?: number,
  ): Promise<MailRecord[]>;
  /** 取单封全文 */
  getMail(mailId: string): Promise<MailRecord | null>;
}
