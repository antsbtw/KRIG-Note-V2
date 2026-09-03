/**
 * 识别「当前登录的 X 账号」—— 用于把自己发的推从收件箱面板隐藏。
 *
 * 为什么需要:x_author.is_self 字段自 0 期就在 schema 里,但**全仓零使用**,
 * 且 app 里从没存过「我的 handle」。没有它就无从判断一条推是不是自己发的。
 *
 * ⚠️ **X 的 DOM 易变**(交接文档 §4.1 对 B' 期的警告同样适用于这里)。
 * 因此这里**按优先级串多种取法**,任一成功即返回,全失败则 fail loud
 * 返回 error —— 绝不猜一个 handle 写进库,写错会把别人的推当成自己的隐藏掉。
 *
 * 各取法的依据(均为 X 长期稳定的结构,但仍以实机 spike 结果为准):
 *  1. 侧边栏「账号切换器」按钮 —— data-testid="SideNav_AccountSwitcher_Button"
 *     里含 @handle 文本,登录态下最稳。
 *  2. 侧边栏 Profile 链接 —— data-testid="AppTabBar_Profile_Link" 的 href
 *     就是 /myhandle,不依赖文本渲染。
 *  3. 页面内嵌的 __INITIAL_STATE__ / 用户对象里的 screen_name。
 *
 * 取到后统一过 normalizeHandle(),与 x_author.handle 的存储形态一致。
 */

import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/**
 * 在 X 页面里探测当前登录账号的 handle。
 *
 * 返回**未归一化**的原始串(可能带 @),调用方负责归一化 —— 便于
 * spike 时看清 X 实际给的是什么形态。
 */
const DETECT_SELF_HANDLE_JS = `(function () {
  var out = { handle: null, via: null, tried: [] };

  // ① 账号切换器按钮:登录态下侧边栏底部,含 @handle
  try {
    var sw = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    out.tried.push('AccountSwitcher:' + (sw ? 'found' : 'absent'));
    if (sw) {
      var spans = sw.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        if (t.indexOf('@') === 0 && t.length > 1) { out.handle = t; out.via = 'AccountSwitcher'; break; }
      }
    }
  } catch (e) { out.tried.push('AccountSwitcher:err:' + e); }

  // ② Profile 链接的 href = /myhandle
  if (!out.handle) {
    try {
      var pl = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
      out.tried.push('ProfileLink:' + (pl ? 'found' : 'absent'));
      var href = pl && pl.getAttribute('href');
      if (href && href.indexOf('/') === 0) {
        var seg = href.split('/').filter(Boolean)[0];
        if (seg) { out.handle = seg; out.via = 'ProfileLink'; }
      }
    } catch (e) { out.tried.push('ProfileLink:err:' + e); }
  }

  // rest_id:从内嵌状态里取当前用户的数字 id(契约的 x_uid)
  try {
    var raw2 = document.documentElement.innerHTML;
    var mid = raw2.match(/"id_str":"(\\d+)"[^}]{0,200}"screen_name":"([A-Za-z0-9_]{1,15})"/);
    if (mid) { out.restId = mid[1]; out.restIdHandle = mid[2]; }
  } catch (e) { out.tried.push('restId:err:' + e); }

  // ③ 兜底:页面里任何 /settings/ 之外的自链接结构都不可靠,改从内嵌状态取
  if (!out.handle) {
    try {
      var raw = document.documentElement.innerHTML;
      var m = raw.match(/"screen_name":"([A-Za-z0-9_]{1,15})"/);
      out.tried.push('InitialState:' + (m ? 'matched' : 'nomatch'));
      if (m) { out.handle = m[1]; out.via = 'InitialState'; }
    } catch (e) { out.tried.push('InitialState:err:' + e); }
  }

  return out;
})()`;

export interface SelfHandleProbe {
  /** 归一化后的 handle(无 @、全小写);未识别时为 null */
  handle: string | null;
  /** 数字 id(rest_id)—— 契约的 x_uid;handle 会改名,它不会 */
  restId?: string;
  /** 命中的取法,便于 spike 时判断哪条策略有效 */
  via: string | null;
  /** 各策略的尝试结果,失败时用于定位 */
  tried: string[];
}

/**
 * 探测当前登录的 X 账号。
 *
 * ⚠️ fail loud:webContents 取不到 / 页面里三种取法全失败 → 返回 handle=null
 * 并带上 tried 明细,**绝不返回一个猜的 handle**。
 */
export async function probeSelfHandle(targetWcId?: number): Promise<SelfHandleProbe> {
  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) {
    return { handle: null, via: null, tried: [`webContents:${resolved.error}`] };
  }

  const raw = await resolved.wc.executeJavaScript(DETECT_SELF_HANDLE_JS) as {
    handle: string | null; via: string | null; tried: string[];
    restId?: string; restIdHandle?: string;
  };

  const normalized = raw?.handle ? normalizeHandle(raw.handle) : '';
  // ⚠️ 只在 rest_id 与识别出的 handle **同属一人**时才采信 ——
  // 页面里可能混着别人的 id_str/screen_name(推荐关注等),配错会写错 x_uid。
  const restId = raw?.restId && raw.restIdHandle
    && normalizeHandle(raw.restIdHandle) === normalized
    ? raw.restId : undefined;

  return {
    handle: normalized || null,
    restId,
    via: raw?.via ?? null,
    tried: raw?.tried ?? [],
  };
}
