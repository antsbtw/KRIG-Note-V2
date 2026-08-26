/**
 * mail-service capability(阶段 0:webview 薄壳)
 *
 * 职责:嵌网页版邮箱的 webview 宿主 + 右键提取单封邮件的 renderer 侧门面。
 * 数据层(IMAP/SMTP → SurrealDB)是阶段 1,不在本 capability
 * (见 docs/tasks/2026-08-26-mail-module-design.md)。
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

export const mailServiceCapability: MailServiceApi = {
  extractMail,
  onExtractRequest,
  registerMailHostWcId,
  clearMailHostWcId,
  getMailHostWcId,
  Host,
};

capabilityRegistry.register({
  id: 'mail-service',
  api: mailServiceCapability,
});
