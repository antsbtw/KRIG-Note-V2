/**
 * 普通浏览 webview 判定(共享 guest 过滤）
 *
 * 三个 did-attach-webview 钩子(右键菜单 / 快捷键 / 弹窗导流）都收到所有 guest
 * webview(普通浏览 / AI / 翻译)。本 helper 统一判定「该 guest 是否为普通浏览
 * webview」—— 只有普通浏览 webview 才接管右键菜单 / 快捷键 / 弹窗导流,绝不接管
 * AI / 翻译 webview。
 *
 * 判定方式(与 Phase 2 web-context-menu 一致):
 *  1. 排除翻译 webview —— 翻译用独立 partition `persist:webview-translate`,
 *     `session.fromPartition(p)` 对同一 partition 字符串返回同一 Session 实例,
 *     故用实例身份比较 `guest.session === translateSession` 可靠识别并排除。
 *  2. 排除 AI webview —— AI webview 与普通浏览**共用** `persist:webview` partition
 *     (见 capabilities/ai-extraction/Host.tsx),partition 无法区分;改用 URL:
 *     `detectAIServiceByUrl(guest.getURL())` 命中 AI 服务则跳过。
 *  3. 排除 X webview —— X 与 AI / 普通浏览**共用** `persist:webview` partition(见
 *     capabilities/x-extraction/Host.tsx),partition 无法区分;改用 URL:
 *     `detectXServiceByUrl` 命中 x.com / twitter.com 则跳过(对齐 AI 的 URL 判定)。
 *     X 自带原生右键菜单(x/webview-hook.ts),不能让普通浏览的右键/快捷键/弹窗导流接管。
 */

import { session, type WebContents } from 'electron';
import { WEBVIEW_TRANSLATE_PARTITION } from '@shared/constants/webview';
import { detectAIServiceByUrl } from '@shared/types/ai-service-types';
import { detectXServiceByUrl } from '@shared/types/x-service-types';

/**
 * 判断该 guest 是否为「普通浏览 webview」(需接管交互)。
 *
 * @returns true = 普通浏览,接管;false = 翻译 / AI / X,放过(保持现状)。
 */
export function shouldHandle(guest: WebContents): boolean {
  // 1) 翻译 webview:独立 partition,实例身份比较排除。
  const translateSession = session.fromPartition(WEBVIEW_TRANSLATE_PARTITION);
  if (guest.session === translateSession) return false;

  // 2) AI webview:共用 persist:webview partition,只能靠 URL 区分。
  const url = guest.getURL();
  if (url && detectAIServiceByUrl(url)) return false;

  // 3) X webview:URL 命中 x.com / twitter.com 排除。
  if (url && detectXServiceByUrl(url)) return false;

  return true;
}
