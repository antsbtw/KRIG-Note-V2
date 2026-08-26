/**
 * 邮箱模块(主进程)出口 — 阶段 0:webview 薄壳
 *
 * 见 docs/tasks/2026-08-26-mail-module-design.md
 */

export { registerMailWebviewHook } from './webview-hook';
export { registerMailHandlers } from './handlers';
export { trackWebContentsForMailService } from './webview-registry';
export { requireMailWebContents } from './mail-webcontents';
export { extractMail } from './mail-extract';
export type { MailExtractData, MailExtractResult } from './mail-extract';
