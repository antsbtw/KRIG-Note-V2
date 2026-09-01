/**
 * 邮箱模块(主进程)出口 — 阶段 0:webview 薄壳
 *
 * 见 docs/10-business-design/mail/module-design.md
 */

export { registerMailWebviewHook } from './webview-hook';
export { registerMailHandlers } from './handlers';
export { registerMailSyncHandlers } from './handlers-sync';
export { trackWebContentsForMailService } from './webview-registry';
export { requireMailWebContents } from './mail-webcontents';
export { extractMail } from './mail-extract';
export type { MailExtractData, MailExtractResult } from './mail-extract';

// ── 阶段 1:IMAP 只读同步 ──
export { syncMailbox, DEFAULT_MAILBOX } from './mail-sync';
export { testConnection } from './imap-client';
