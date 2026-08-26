/**
 * 邮箱模块 阶段 1 IPC handlers(账号配置 + IMAP 同步)
 *
 * 与阶段 0 的 handlers.ts 分文件:那是 webview 提取(不碰数据层),
 * 这是账号/同步/查询(全走 SurrealDB + IMAP)。两者生命周期与依赖都不同。
 *
 * 模板纪律(对齐 main/note/handlers.ts):入参 typeof 严格校验,
 * 返回结构化结果而非 throw(renderer 据 success 决定提示)。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  MailAccount,
  MailRecord,
  MailSyncResult,
  MailTestResult,
  MailServiceId,
} from '@shared/types/mail-types';
import {
  listAccounts,
  createAccount,
  deleteAccount,
  getAccount,
  listMails,
  getMail,
} from '../db/mail-repo';
import { testConnection } from './imap-client';
import { syncMailbox, DEFAULT_MAILBOX } from './mail-sync';

export function registerMailSyncHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.MAIL_ACCOUNT_LIST,
    async (_e, wsId: unknown): Promise<MailAccount[]> => {
      if (typeof wsId !== 'string' || !wsId) return [];
      return listAccounts(wsId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_ACCOUNT_CREATE,
    async (_e, payload: unknown): Promise<{ success: boolean; account?: MailAccount; error?: string }> => {
      const p = payload as Record<string, unknown> | null;
      if (!p || typeof p !== 'object') return { success: false, error: '入参非法' };
      const { wsId, serviceId, email, imapHost, imapPort, imapSecure, password, smtpHost, smtpPort } = p;
      if (typeof wsId !== 'string' || !wsId) return { success: false, error: '缺少 wsId' };
      if (typeof email !== 'string' || !email) return { success: false, error: '缺少邮箱地址' };
      if (typeof password !== 'string' || !password) return { success: false, error: '缺少密码' };
      if (typeof imapHost !== 'string' || !imapHost) return { success: false, error: '缺少 IMAP 服务器' };
      if (typeof imapPort !== 'number') return { success: false, error: 'IMAP 端口非法' };

      try {
        const account = await createAccount({
          wsId,
          serviceId: (typeof serviceId === 'string' ? serviceId : 'gmail') as MailServiceId,
          email,
          imapHost,
          imapPort,
          imapSecure: imapSecure !== false,
          smtpHost: typeof smtpHost === 'string' ? smtpHost : undefined,
          smtpPort: typeof smtpPort === 'number' ? smtpPort : undefined,
          password,
        });
        return { success: true, account };
      } catch (e) {
        // createAccount 在 safeStorage 不可用时会 throw —— 那是必须让用户看到的
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_ACCOUNT_DELETE,
    async (_e, accountId: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof accountId !== 'string' || !accountId) {
        return { success: false, error: '缺少 accountId' };
      }
      try {
        await deleteAccount(accountId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_ACCOUNT_TEST,
    async (_e, accountId: unknown): Promise<MailTestResult> => {
      if (typeof accountId !== 'string' || !accountId) {
        return { success: false, error: '缺少 accountId' };
      }
      const account = await getAccount(accountId);
      if (!account) return { success: false, error: '账号不存在' };
      return testConnection(account);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_SYNC,
    async (_e, payload: unknown): Promise<MailSyncResult> => {
      const p = payload as { accountId?: unknown; mailbox?: unknown } | null;
      if (!p || typeof p.accountId !== 'string' || !p.accountId) {
        return { success: false, fetched: 0, total: 0, error: '缺少 accountId' };
      }
      const account = await getAccount(p.accountId);
      if (!account) {
        return { success: false, fetched: 0, total: 0, error: '账号不存在' };
      }
      const mailbox = typeof p.mailbox === 'string' && p.mailbox ? p.mailbox : DEFAULT_MAILBOX;
      return syncMailbox(account, mailbox);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_LIST,
    async (_e, payload: unknown): Promise<MailRecord[]> => {
      const p = payload as { accountId?: unknown; mailbox?: unknown; limit?: unknown; offset?: unknown } | null;
      if (!p || typeof p.accountId !== 'string' || !p.accountId) return [];
      const mailbox = typeof p.mailbox === 'string' && p.mailbox ? p.mailbox : DEFAULT_MAILBOX;
      const limit = typeof p.limit === 'number' ? p.limit : 50;
      const offset = typeof p.offset === 'number' ? p.offset : 0;
      return listMails(p.accountId, mailbox, limit, offset);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MAIL_GET,
    async (_e, mailId: unknown): Promise<MailRecord | null> => {
      if (typeof mailId !== 'string' || !mailId) return null;
      return getMail(mailId);
    },
  );
}
