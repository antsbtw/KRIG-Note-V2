/**
 * mail-service capability(阶段 0:webview 薄壳)
 *
 * 职责:嵌网页版邮箱的 webview 宿主 + 右键提取单封邮件的 renderer 侧门面。
 * 数据层(IMAP/SMTP → SurrealDB)是阶段 1,不在本 capability
 * (见 docs/10-business-design/mail/module-design.md)。
 *
 * view 通过 requireCapabilityApi<MailServiceApi>('mail-service') 取 api,
 * 不直接碰 window.electronAPI。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { Host } from './Host';
import {
  registerMailHostWcId,
  clearMailHostWcId,
  getMailHostWcId,
} from './mail-host-registry';
import type {
  MailServiceApi,
  MailServiceId,
  MailExtractRequest,
  MailExtractResult,
} from './types';
import type {
  MailAccount,
  MailRecord,
  MailSyncResult,
  MailTestResult,
  CreateMailAccountInput,
} from '@shared/types/mail-types';

export type {
  MailAccount,
  MailRecord,
  MailSyncResult,
  MailTestResult,
} from '@shared/types/mail-types';

export type {
  MailServiceApi,
  MailServiceId,
  MailExtractData,
  MailExtractResult,
  MailExtractRequest,
  MailHostHandle,
  MailHostProps,
} from './types';

async function extractMail(
  serviceId: MailServiceId,
  x: number,
  y: number,
  targetWcId?: number | null,
): Promise<MailExtractResult> {
  return window.electronAPI.mailExtract(
    serviceId,
    x,
    y,
    targetWcId ?? undefined,
  ) as Promise<MailExtractResult>;
}

function onExtractRequest(callback: (payload: MailExtractRequest) => void): () => void {
  return window.electronAPI.onMailExtractRequest(callback);
}

// ── 阶段 1:IMAP 只读同步(薄 alias,主进程做实事) ──

async function listAccounts(wsId: string): Promise<MailAccount[]> {
  return window.electronAPI.mailAccountList(wsId);
}

async function createAccount(
  input: CreateMailAccountInput,
): Promise<{ success: boolean; account?: MailAccount; error?: string }> {
  return window.electronAPI.mailAccountCreate(input);
}

async function deleteAccount(accountId: string): Promise<{ success: boolean; error?: string }> {
  return window.electronAPI.mailAccountDelete(accountId);
}

async function setAccountPassword(
  accountId: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  return window.electronAPI.mailAccountSetPassword(accountId, password);
}

async function testAccount(accountId: string): Promise<MailTestResult> {
  return window.electronAPI.mailAccountTest(accountId);
}

async function sync(accountId: string, mailbox?: string): Promise<MailSyncResult> {
  return window.electronAPI.mailSync(accountId, mailbox);
}

async function listMails(
  accountId: string,
  mailbox?: string,
  limit?: number,
  offset?: number,
): Promise<MailRecord[]> {
  return window.electronAPI.mailList(accountId, mailbox, limit, offset);
}

async function getMail(mailId: string): Promise<MailRecord | null> {
  return window.electronAPI.mailGet(mailId);
}

export const mailServiceCapability: MailServiceApi = {
  extractMail,
  onExtractRequest,
  registerMailHostWcId,
  clearMailHostWcId,
  getMailHostWcId,
  Host,
  listAccounts,
  createAccount,
  deleteAccount,
  setAccountPassword,
  testAccount,
  sync,
  listMails,
  getMail,
};

capabilityRegistry.register({
  id: 'mail-service',
  api: mailServiceCapability,
});
