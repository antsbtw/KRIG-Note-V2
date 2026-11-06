/**
 * 网页正文截图 —— 注入网页的「框选正文」脚本(2026-11-05)
 *
 * 用户 11-05 定的效果:截**整篇正文长图**;先自动框出正文,**给一个框选调整和确认的步骤,
 * 否则有可能会漏掉部分正文**。
 *
 * 脚本返回 Promise(executeJavaScript 会等它):
 *   确认 → { x, y, width, height, dpr, title, url }(文档坐标,CSS px)
 *   取消 / Esc → null
 * 确认后、resolve 前:移掉框;把选区滚一遍触发懒加载图片;藏起 fixed/sticky 元素
 * (吸顶导航在长截图里会反复出现)—— 截完由 RESTORE_SCRIPT 还原。
 *
 * ⚠️ 脚本里的滚动一律 behavior:'instant':开着 scroll-behavior:smooth 的站点 scrollTo 会慢慢滑(bufanche 实测)。
 * ⚠️ 用 el.style(CSSOM)设样式,不用 style 属性字符串:严格 CSP 的站点会拦 style 属性。
 * ⚠️ 外部值一律 JSON.stringify 绑定,不拼接进脚本文本(project-x-inject-template-escape)。
 */

export interface ShotSelection {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
  title: string;
  url: string;
}

const LABELS = {
  confirm: '确认截图',
  cancel: '取消',
  hint: '拖蓝框的边或角调整 · Enter 确认 · Esc 取消',
  toTop: '⤒ 顶边',
  toBottom: '⤓ 底边',
};

export function buildSelectScript(): string {
  return `(function () {
  var L = ${JSON.stringify(LABELS)};
  if (window.__krigShotActive) return Promise.resolve(null);
  window.__krigShotActive = true;
  return new Promise(function (resolve) {
    var doc = document.documentElement;
    function textLen(el) { return ((el && el.innerText) || '').replace(/\\s+/g, '').length; }

    // ① 找正文:候选里文字最多的;同等(≥70%)取最深的那个,免得框进侧栏
    var sel = 'article, main, [role="main"], .post-content, .article-content, .entry-content, .post, .article, #content, .content';
    var cands = Array.prototype.slice.call(document.querySelectorAll(sel));
    var maxLen = 0;
    cands.forEach(function (c) { maxLen = Math.max(maxLen, textLen(c)); });
    var best = null;
    cands.forEach(function (c) {
      if (textLen(c) < maxLen * 0.7) return;
      if (!best || best.contains(c)) best = c;
    });
    if (!best || maxLen < 200) best = document.body;
    var sx = window.scrollX, sy = window.scrollY;
    // 容器常是全宽的(2026-11-05 实测 bufanche:框成 1679 宽,正文栏只有 ~780)
    // → 量容器里**实际内容块**的范围,导航/侧栏/页脚里的不算
    var BLK = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figure,img,picture,video,table,figcaption';
    var SKIP = 'nav,aside,footer,[role="navigation"],[role="complementary"],[role="contentinfo"]';
    var u = null;
    Array.prototype.forEach.call(best.querySelectorAll(BLK), function (b) {
      if (b.closest(SKIP)) return;
      var br = b.getBoundingClientRect();
      if (br.width < 20 || br.height < 4) return;
      var cs = getComputedStyle(b);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (!u) u = { l: br.left, t: br.top, r: br.right, b: br.bottom };
      else { u.l = Math.min(u.l, br.left); u.t = Math.min(u.t, br.top); u.r = Math.max(u.r, br.right); u.b = Math.max(u.b, br.bottom); }
    });
    var r = u ? { left: u.l, top: u.t, width: u.r - u.l, height: u.b - u.t } : best.getBoundingClientRect();
    var box = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
    // 标题常在正文容器外面的上方:把它框进来
    var h1 = document.querySelector('h1');
    if (h1 && !best.contains(h1)) {
      var hr = h1.getBoundingClientRect();
      var hTop = hr.top + sy;
      if (hTop < box.y && box.y - hTop < 800) {
        box.h += box.y - hTop; box.y = hTop;
        var hl = hr.left + sx;
        if (hl < box.x) { box.w += box.x - hl; box.x = hl; }
      }
    }
    var PAD = 12;
    // 页面总宽高可能比内容还小(overflow 隐藏等)→ 至少按「内容 + 边距」算,免得把框裁坏
    var maxR = Math.max(doc.scrollWidth, box.x + box.w + PAD);
    var maxB = Math.max(doc.scrollHeight, box.y + box.h + PAD);
    var nx = Math.max(0, box.x - PAD), ny = Math.max(0, box.y - PAD);
    box.w = Math.min(maxR, box.x + box.w + PAD) - nx;
    box.h = Math.min(maxB, box.y + box.h + PAD) - ny;
    box.x = nx; box.y = ny;

    // ② 画框
    function el(tag, css) { var e = document.createElement(tag); Object.assign(e.style, css); return e; }
    var root = el('div', { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647' });
    var frame = el('div', { position: 'absolute', border: '2px solid #3b82f6', boxShadow: '0 0 0 100000px rgba(0,0,0,0.35)', pointerEvents: 'none', boxSizing: 'border-box' });
    root.appendChild(frame);
    // 四条边整条可拖(透明加宽的抓取带 + 中间一段醒目的把手),四角可同时拖两边
    var CUR = { t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize', tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize' };
    var grips = {};
    Object.keys(CUR).forEach(function (k) {
      var g = el('div', { position: 'absolute', cursor: CUR[k], pointerEvents: 'auto', background: k.length === 2 ? '#3b82f6' : 'transparent', borderRadius: k.length === 2 ? '3px' : '0' });
      g.dataset.edge = k;
      if (k.length === 1) {
        var knob = el('div', { position: 'absolute', background: '#3b82f6', borderRadius: '4px', pointerEvents: 'none' });
        g.appendChild(knob); g.__knob = knob;
      }
      grips[k] = g; root.appendChild(g);
    });
    var bar = el('div', { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '2147483647', background: '#1f2937', color: '#f9fafb', padding: '10px 14px', borderRadius: '10px', font: '13px -apple-system, sans-serif', display: 'flex', gap: '12px', alignItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' });
    var hint = el('span', { opacity: '0.7', fontSize: '12px' });
    hint.textContent = L.hint;
    var info = el('span', { fontVariantNumeric: 'tabular-nums' });
    function btn(text) { var b = el('button', { background: '#374151', color: '#fff', border: '0', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', font: 'inherit' }); b.textContent = text; return b; }
    var toTop = btn(L.toTop), toBottom = btn(L.toBottom);
    var ok = el('button', { background: '#3b82f6', color: '#fff', border: '0', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', font: 'inherit' });
    ok.textContent = L.confirm;
    var no = el('button', { background: '#4b5563', color: '#fff', border: '0', borderRadius: '6px', padding: '6px 14px', cursor: 'pointer', font: 'inherit' });
    no.textContent = L.cancel;
    bar.appendChild(hint); bar.appendChild(info); bar.appendChild(toTop); bar.appendChild(toBottom); bar.appendChild(ok); bar.appendChild(no);
    toTop.addEventListener('click', function (e) { e.stopPropagation(); window.scrollTo({ top: Math.max(0, box.y - 120) }); });
    toBottom.addEventListener('click', function (e) { e.stopPropagation(); window.scrollTo({ top: Math.max(0, box.y + box.h - window.innerHeight + 160) }); });
    document.body.appendChild(root); document.body.appendChild(bar);

    function paint() {
      Object.assign(frame.style, { left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' });
      var G = 16, C = 14, x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
      Object.assign(grips.t.style, { left: x0 + 'px', top: (y0 - G / 2) + 'px', width: box.w + 'px', height: G + 'px' });
      Object.assign(grips.b.style, { left: x0 + 'px', top: (y1 - G / 2) + 'px', width: box.w + 'px', height: G + 'px' });
      Object.assign(grips.l.style, { left: (x0 - G / 2) + 'px', top: y0 + 'px', width: G + 'px', height: box.h + 'px' });
      Object.assign(grips.r.style, { left: (x1 - G / 2) + 'px', top: y0 + 'px', width: G + 'px', height: box.h + 'px' });
      ['t', 'b'].forEach(function (k) { Object.assign(grips[k].__knob.style, { left: (box.w / 2 - 40) + 'px', top: (G / 2 - 4) + 'px', width: '80px', height: '8px' }); });
      // 竖边的把手放在「当前屏幕里」那段的中间,滚到哪都看得见
      var vTop = Math.max(y0, window.scrollY), vBot = Math.min(y1, window.scrollY + window.innerHeight);
      var knobY = (vBot > vTop ? (vTop + vBot) / 2 : (y0 + y1) / 2) - y0 - 40;
      ['l', 'r'].forEach(function (k) { Object.assign(grips[k].__knob.style, { left: (G / 2 - 4) + 'px', top: knobY + 'px', width: '8px', height: '80px' }); });
      [['tl', x0, y0], ['tr', x1, y0], ['bl', x0, y1], ['br', x1, y1]].forEach(function (c) {
        Object.assign(grips[c[0]].style, { left: (c[1] - C / 2) + 'px', top: (c[2] - C / 2) + 'px', width: C + 'px', height: C + 'px' });
      });
      info.textContent = Math.round(box.w) + ' × ' + Math.round(box.h);
    }
    paint();
    window.scrollTo({ top: Math.max(0, box.y - 80), behavior: 'instant' });

    // ③ 拖边(拖到窗口边缘自动滚动,好把下边拖到很远)
    var drag = null, lastY = 0, lastX = 0, timer = null;
    function apply(clientX, clientY) {
      var px = clientX + window.scrollX, py = clientY + window.scrollY, MIN = 40;
      if (drag.indexOf('t') >= 0) { var b = box.y + box.h; box.y = Math.max(0, Math.min(py, b - MIN)); box.h = b - box.y; }
      if (drag.indexOf('b') >= 0) { box.h = Math.max(MIN, Math.min(py, Math.max(doc.scrollHeight, box.y + box.h, py)) - box.y); }
      if (drag.indexOf('l') >= 0) { var rr = box.x + box.w; box.x = Math.max(0, Math.min(px, rr - MIN)); box.w = rr - box.x; }
      if (drag.indexOf('r') >= 0) { box.w = Math.max(MIN, Math.min(px, Math.max(doc.scrollWidth, box.x + box.w)) - box.x); }
      paint();
    }
    function onDown(e) { var k = e.target && e.target.dataset && e.target.dataset.edge; if (!k || !root.contains(e.target)) return; drag = k; e.preventDefault(); e.stopPropagation(); }
    // 滚动时把竖边的把手跟到屏幕里
    function onScroll() { paint(); }
    window.addEventListener('scroll', onScroll, true);
    function onMove(e) {
      if (!drag) return; e.preventDefault(); e.stopPropagation();
      lastX = e.clientX; lastY = e.clientY; apply(lastX, lastY);
      clearInterval(timer); timer = null;
      var dy = lastY > window.innerHeight - 40 ? 24 : lastY < 40 ? -24 : 0;
      if (dy) timer = setInterval(function () { window.scrollBy({ top: dy, behavior: 'instant' }); apply(lastX, lastY); }, 30);
    }
    function onUp() { drag = null; clearInterval(timer); timer = null; }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    }
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', function (e) { e.stopPropagation(); finish(true); });
    no.addEventListener('click', function (e) { e.stopPropagation(); finish(false); });

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function cleanup() {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      clearInterval(timer);
      root.remove(); bar.remove();
    }
    var done = false;
    function finish(confirmed) {
      if (done) return; done = true;
      cleanup();
      if (!confirmed) { window.__krigShotActive = false; resolve(null); return; }
      var sel2 = { x: box.x, y: box.y, width: box.w, height: box.h, dpr: window.devicePixelRatio || 1, title: document.title, url: location.href };
      (async function () {
        // ④ 懒加载图片:改 eager + 把选区滚一遍
        Array.prototype.forEach.call(document.images, function (im) { try { im.loading = 'eager'; } catch (_) {} });
        var startY = window.scrollY;
        for (var y = sel2.y; y < sel2.y + sel2.height; y += Math.max(200, window.innerHeight * 0.8)) {
          window.scrollTo({ left: 0, top: y, behavior: 'instant' }); await sleep(120);
        }
        window.scrollTo({ left: 0, top: startY, behavior: 'instant' });
        await sleep(400);
        // ⑤ 藏 fixed/sticky(截完还原)
        var hidden = [];
        Array.prototype.forEach.call(document.querySelectorAll('body *'), function (n) {
          var p = getComputedStyle(n).position;
          if (p === 'fixed' || p === 'sticky') { hidden.push([n, n.style.visibility]); n.style.visibility = 'hidden'; }
        });
        window.__krigShotHidden = hidden;
        await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
        resolve(sel2);
      })();
    }
  });
})()`;
}

/** 截完还原被藏的 fixed/sticky 元素;返还原了几个 */
export const RESTORE_SCRIPT = `(function () {
  var h = window.__krigShotHidden || [];
  h.forEach(function (p) { p[0].style.visibility = p[1]; });
  window.__krigShotHidden = null;
  window.__krigShotActive = false;
  return h.length;
})()`;
