/**
 * X 拖拽落点定位(main 侧)— 拖 note block 到 X 发推/回复的「拿松手坐标 + 解析落点」
 *
 * 背景(实锤,见 [[project-x-drag-to-post-method]]):X 在 <webview> guest 里。靠 guest 监听
 * 拖拽期 **dragover**(拖拽时 mousemove 被抑制,坐标只能从 dragover 拿)记录最后坐标:
 *   - armXDragListener:note 拖起(dnd.started)时,往**当前活跃 ws 的 X guest**(targetWcId,
 *     按 ws 定向,见 [[project-ws-instance-isolation-invariant]])注入监听。dragover 一举两得:
 *     ① preventDefault 拦掉落进 X 的原生 drop(转圈根因:X 收到带 krig-block-source 数据的
 *        drop 会启动"接收内容"加载态转圈)+ ② 记 clientX/Y 到 window.__xDragPt。
 *   - resolveXDropAt:松手(dnd.completed)读回 window.__xDragPt(guest CSS 像素,不需 /dpr)
 *     → elementFromPoint 定位「发推框 / 某条推 + reply 按钮 + statusHref」。drop/dragover 拦截器
 *     延迟 1.2s 清(原生 drop 常在 resolve 之后才到,过早清会漏拦又转圈)。
 *
 * ⚠️ 写方向红线:本模块只「定位落点」,注入仍走 x-write 的 pasteTweet/pasteReply(填内容,
 * 用户点发布),绝不程序点发布。
 */

import { webContents, type WebContents } from 'electron';
import { getXServiceProfile, type XServiceId } from '@shared/types/x-service-types';

/** 落点解析结果 */
export type XDropTarget =
  | { kind: 'compose' }
  | { kind: 'tweet'; author: string | null; statusHref: string | null; hasReplyButton: boolean }
  | { kind: 'other' }
  | { kind: 'none' };

function getGuestById(targetWcId: number): WebContents | null {
  const wc = webContents.fromId(targetWcId);
  return wc && !wc.isDestroyed() ? wc : null;
}

/**
 * note 拖起时调:往 X guest 注入 mousemove 监听,记录最后坐标到 window.__xDragPt。
 * 防重:同 guest 多次 arm 只装一次(用 window.__xDragArmed 标记)。
 */
export async function armXDragListener(targetWcId: number): Promise<void> {
  const guest = getGuestById(targetWcId);
  if (!guest) return;
  const script = `
    (function() {
      // 清掉残留的旧监听(防多次 arm / 上次拖拽未善后)
      if (window.__xDragoverHandler) { try { document.removeEventListener('dragover', window.__xDragoverHandler, true); } catch(e){} }
      if (window.__xDropHandler) { try { document.removeEventListener('drop', window.__xDropHandler, true); } catch(e){} }
      if (window.__xMoveHandler) { try { document.removeEventListener('mousemove', window.__xMoveHandler, true); } catch(e){} }
      window.__xDragArmed = true;
      window.__xDragPt = null;
      // ⚠️ 拦掉落进 X webview 的原生 drop —— 转圈根因(实锤):note handle 是 HTML5 draggable,
      //   拖到 X 上松手时浏览器把原生 drop(带 application/krig-block-source 数据)落进 X 页面,
      //   X 当成"拖入内容/文件"启动接收态 → 转圈。我们靠坐标自处理落点,不需要原生 drop,故
      //   preventDefault + stopPropagation 拦死。
      // ⚠️ 坐标来源:HTML5 拖拽期间浏览器派发的是 **dragover** 而非 mousemove(拖拽时 mousemove
      //   被抑制),故坐标记录必须在 dragover 里做。dragover 一举两得:preventDefault(拦 drop 区
      //   + 让 drop 可拦)+ 记 clientX/Y。mousemove 监听留作非拖拽兜底。
      window.__xDropHandler = function(e) { e.preventDefault(); e.stopPropagation(); };
      window.__xDragoverHandler = function(e) {
        e.preventDefault();
        window.__xDragPt = { x: e.clientX, y: e.clientY };
      };
      window.__xMoveHandler = function(e) { window.__xDragPt = { x: e.clientX, y: e.clientY }; };
      document.addEventListener('mousemove', window.__xMoveHandler, true);
      document.addEventListener('dragover', window.__xDragoverHandler, true);
      document.addEventListener('drop', window.__xDropHandler, true);
      return true;
    })();
  `;
  try {
    await guest.executeJavaScript(script);
  } catch (err) {
    console.error('[x-drag] armXDragListener failed:', err);
  }
}

/**
 * 松手时调:读回 guest 内最后坐标 → elementFromPoint 定位落点 → 清理监听。
 *
 * @returns 落点类型(compose / tweet / other / none)
 */
export async function resolveXDropAt(
  serviceId: XServiceId,
  targetWcId: number,
): Promise<XDropTarget> {
  const guest = getGuestById(targetWcId);
  if (!guest) return { kind: 'none' };
  const profile = getXServiceProfile(serviceId);
  const composeSel = profile.selectors.composeBox ?? '';
  const tweetSel = profile.selectors.tweetElement;

  const script = `
    (function() {
      var pt = window.__xDragPt;
      // 清理 mousemove 监听。drop/dragover 拦截器**不在此清**(原生 drop 常在 resolve 之后
      // 才到,过早清会漏拦 → 又转圈)。它们由下面延迟清理统一移除。
      if (window.__xMoveHandler) document.removeEventListener('mousemove', window.__xMoveHandler, true);
      window.__xDragArmed = false;
      window.__xMoveHandler = null;
      var lastPt = pt; window.__xDragPt = null;
      if (!lastPt) return { kind: 'none' };
      // 拖拽期坐标来自 dragover 的 clientX/Y,已是 guest CSS 像素,不需 /dpr
      var el = document.elementFromPoint(lastPt.x, lastPt.y);
      if (!el) return { kind: 'none' };
      var closest = function(sel) { return el.closest ? el.closest(sel) : null; };
      var composeSel = ${JSON.stringify(composeSel)};
      if (composeSel) {
        var parts = composeSel.split(',').map(function(s){return s.trim();}).filter(Boolean);
        for (var i = 0; i < parts.length; i++) {
          if (closest(parts[i])) return { kind: 'compose' };
        }
      }
      var tweet = closest(${JSON.stringify(tweetSel)});
      if (tweet) {
        var nameEl = tweet.querySelector('[data-testid="User-Name"]');
        var link = tweet.querySelector('a[href*="/status/"]');
        // 暂存被拖中的推文 DOM,供 clickReplyAtDrop 就地点回复按钮(不跳详情页)
        window.__xDropTweet = tweet;
        return {
          kind: 'tweet',
          author: nameEl ? nameEl.textContent.slice(0, 40) : null,
          statusHref: link ? link.getAttribute('href') : null,
          hasReplyButton: !!tweet.querySelector('[data-testid="reply"]')
        };
      }
      // 精确 closest 没命中,且不是推文 → 放宽:发推框(收起态仅 28px 细条,难拖准)用
      // 「纵向邻域 band」容差。落点在 compose 框上下 BAND 内、且横向在框列内 → 仍判 compose。
      // (总指挥:对不准 28px 细条体验不行;发推语义不需像素级对准。)
      var BAND = 80; // compose 框上下 80px 容差
      try {
        var cParts = composeSel.split(',').map(function(s){return s.trim();}).filter(Boolean);
        for (var k = 0; k < cParts.length; k++) {
          var cEl = document.querySelector(cParts[k]);
          if (cEl) { var rc = cEl.getBoundingClientRect();
            var inX = lastPt.x >= rc.left && lastPt.x <= rc.right;
            var inYBand = lastPt.y >= rc.top - BAND && lastPt.y <= rc.bottom + BAND;
            if (inX && inYBand) return { kind: 'compose' };
            break; }
        }
      } catch(e) {}
      return { kind: 'other' };
    })();
  `;
  try {
    const r = (await guest.executeJavaScript(script)) as XDropTarget;
    // 延迟清理 drop/dragover 拦截器:原生 drop 常在 dnd.completed/resolve 之后才到,
    // 过早清会漏拦 → 又转圈。1.2s 后原生 drop 必已触发并被拦,此时安全移除。
    setTimeout(() => {
      void guest
        .executeJavaScript(`(function(){
          if (window.__xDropHandler) { try { document.removeEventListener('drop', window.__xDropHandler, true); } catch(e){} window.__xDropHandler = null; }
          if (window.__xDragoverHandler) { try { document.removeEventListener('dragover', window.__xDragoverHandler, true); } catch(e){} window.__xDragoverHandler = null; }
          window.__xDragArmed = false;
        })()`)
        .catch(() => {});
    }, 1200);
    return r ?? { kind: 'none' };
  } catch (err) {
    console.error('[x-drag] resolveXDropAt failed:', err);
    return { kind: 'none' };
  }
}

/**
 * 就地点击「被拖中推文」的回复按钮,弹出该推的 reply 框(不跳详情页 —— 总指挥拍板)。
 *
 * 依赖 resolveXDropAt 暂存的 window.__xDropTweet。点 [data-testid="reply"] 后,X 会弹出
 * reply compose(里头是 tweetTextarea_0)。本函数 poll 等 reply 框出现,返回是否就绪 —
 * 就绪后调用方(renderer)再走 pasteTweet(targetWcId)把内容填进这个 reply 框。
 *
 * @returns { ok: reply 框是否已弹出就绪 }
 */
export async function clickReplyAtDrop(
  serviceId: XServiceId,
  targetWcId: number,
): Promise<{ ok: boolean; error?: string }> {
  const guest = getGuestById(targetWcId);
  if (!guest) return { ok: false, error: '没有活跃的 X 实例' };
  const profile = getXServiceProfile(serviceId);
  const replySel = profile.selectors.replyBox ?? profile.selectors.composeBox ?? '';

  // 1. 点被拖中推文的 reply 按钮
  // ⚠️⚠️ 写方向红线:这里点的是 [data-testid="reply"] —— 推文下方那个「打开回复框」的图标按钮,
  //   作用仅是让 X 弹出 reply compose 输入框,绝非「发送回复」。X 的发送按钮是 [data-testid="tweetButton"],
  //   只差一个 testid。改这段前务必确认仍是 "reply"(开框)而非 "tweetButton"(发送)——
  //   点错 = 自动发布,直接违反写方向最高红线。内容填充仍由调用方走 pasteTweet,发布永远留给用户手动点。
  const clickScript = `
    (function() {
      var tweet = window.__xDropTweet;
      if (!tweet || !document.contains(tweet)) return { ok: false, reason: 'tweet-gone' };
      var btn = tweet.querySelector('[data-testid="reply"]');
      if (!btn) return { ok: false, reason: 'no-reply-btn' };
      btn.click();
      return { ok: true };
    })();
  `;
  try {
    const clicked = (await guest.executeJavaScript(clickScript)) as { ok: boolean; reason?: string };
    if (!clicked?.ok) {
      return { ok: false, error: `点回复按钮失败(${clicked?.reason || '未知'})` };
    }
  } catch (err) {
    return { ok: false, error: `点回复按钮异常:${String(err)}` };
  }

  // 2. poll 等 reply 框(tweetTextarea_0)出现(X 弹 reply compose 需要时间)
  const waitScript = `
    (function() {
      var sel = ${JSON.stringify(replySel)};
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      for (var i=0;i<parts.length;i++){ if (parts[i] && document.querySelector(parts[i])) return true; }
      return false;
    })();
  `;
  const start = Date.now();
  while (Date.now() - start < 6000) {
    try {
      if (await guest.executeJavaScript(waitScript)) return { ok: true };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: '回复框未弹出(X 改版 / reply selector 失效?)' };
}
