/**
 * ⭐ X 文章编辑器里的页面脚本(发推第⑥期,2026-10-30)—— 一个脚本、按 op 分动作,主进程 x-post-article-fill 一步步调
 *
 * 全部 2026-10-30 在 @antsBTW 的真机上用收件箱 probe 一个个量过(记忆 project-x-articles-impl):
 *   - 新文章:列表页右上「create」→ 地址变成 /compose/articles/edit/<id>,X 立刻存成草稿
 *   - 标题:textarea[placeholder="Add a title"],原生 value setter + input
 *   - 正文:[data-testid=composer](DraftJS),合成 paste 带 text/html —— 段落 / 粗斜删 / 链接 / 列表 / 引用 / h1 h2 都保留
 *     ⚠️ 粘贴的第一块会并进光标所在的那行(标题就丢了)→ 前面垫一个零宽空格段落;光标那行是空的、第一块又是段落就不垫(免得多一个空行)
 *     ⚠️ X 只认它自己的光标(DraftJS),脚本设的 DOM 选区它不理 —— 开头由主进程真点击一下空的第一行,之后每步插入光标都跟在最后
 *   - Insert(button[aria-label="Add Media"])→ 菜单 Media / GIF / Posts / Link preview / Divider / Code / LaTeX / Table
 *     LaTeX:弹窗里一个 textarea → 「Insert」;Code:programming-language-input 打字 → 点出来的那个语言 → textarea → 「Insert」
 *     Table:网格 aria-label「Insert a {行} by {列} table」(要完整鼠标序列)→ 插空表 → 点那张表 → 它的「Edit block」→ markdown textarea → 「Update」
 *     Divider:直接插;Media:弹窗里的 fileInput(喂文件由输入引擎做),图直接进正文(没有裁剪框),每块最多 4 张
 *   - 封面:页面上不在弹窗里的 fileInput(只收图)→ 「Edit media」裁剪框 →「Apply」(applyButton)
 *   - 删草稿:「Publish」旁边的 More → 「Delete Article」→ 确认框 confirmationSheetConfirm「Yes, delete」
 *   ⚠️ X 网页宽度是 0(没显示在屏幕上)时 Insert 的弹窗是空的 —— 驱动前先确认页面有宽度
 * ⚠️ 只有 op=publish 点「Publish」(由 x.post.publish 调,人点了确认发布);别的 op 都不碰它。
 */
import type { RegisteredScript, ScriptId } from '@platform/main/web-capability/dom/types';

export const X_ARTICLE_SCRIPT = 'x.articleAct' as ScriptId;

/** 页面里的小工具(每个 op 都要) */
const LIB = String.raw`
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var vis = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var body = function () { return document.querySelector('[data-testid="composer"]'); };
  var blocks = function () { var b = body(); return b ? Array.prototype.slice.call(b.querySelectorAll('[data-block="true"]')) : []; };
  var clean = function (s) { return (s || '').replace(/​/g, '').trim(); };
  var waitFor = async function (fn, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 5000)) { var v = fn(); if (v) return v; await sleep(150); } return null; };
  var byText = function (sel, label) { var want = label.toLowerCase(); return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).find(function (e) { return (e.innerText || '').trim().toLowerCase() === want; }); };
  var sheet = function () { return document.querySelector('[data-testid="sheetDialog"]'); };
  var dlgBtn = function (label) { return byText('[role="dialog"] button, [role="dialog"] [role="button"]', label); };
  var setVal = function (el, v) {
    el.focus();
    var p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value === v;
  };
  /** 完整鼠标序列(表格网格只认这个,光 .click() 不行 —— 06-14 实机) */
  var mclick = function (el) {
    var r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    ['pointerover', 'mouseover', 'mouseenter', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }));
    });
  };
  var dialogTextarea = function () { return Array.prototype.slice.call(document.querySelectorAll('[role="dialog"] textarea')).filter(vis)[0] || null; };
  var counts = function () {
    var b = body();
    if (!b) return null;
    var sections = Array.prototype.slice.call(b.querySelectorAll('section[data-block="true"]'));
    return {
      blocks: blocks().length,
      h1: b.querySelectorAll('.longform-header-one').length,
      h2: b.querySelectorAll('.longform-header-two').length,
      img: b.querySelectorAll('section img').length,
      table: b.querySelectorAll('table').length,
      code: sections.filter(function (s) { return !!s.querySelector('pre, code'); }).length,
      sections: sections.length,
    };
  };
  var uploading = function () {
    return Array.prototype.slice.call(document.querySelectorAll('img')).filter(function (i) { return /^blob:/.test(i.src); }).length;
  };
  /** 现场(没成时带回去,日志里看得到正文成了什么样) */
  var outline = function () {
    return blocks().map(function (b) { return b.tagName.charAt(0) + (b.querySelector('img') ? '[img' + (/^blob:/.test(b.querySelector('img').src) ? ' 传' : '') + ']' : '') + (b.querySelector('table') ? '[表]' : '') + ':' + clean(b.innerText).slice(0, 8); }).join(' / ');
  };
  /**
   * 诊断(11-02 真机:取消后再填,一次封面 30 秒没放上、一次第 5 张图点了 Media 没出选文件的弹窗 —— 日志里看不出 X 当时说了什么)
   * scene:屏幕上的提示 / 弹窗字 / Insert 菜单项状态;ups:这页里发往上传接口的请求(页面自己的资源记录,带状态码)
   */
  var scene = function () {
    var texts = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).map(function (e) { return clean(e.innerText).slice(0, 120); }).filter(Boolean); };
    return {
      alerts: texts('[role="alert"], [data-testid="toast"]'),
      dialogs: texts('[role="dialog"]').map(function (s) { return s.slice(0, 80); }),
      menu: Array.prototype.slice.call(document.querySelectorAll('[role="menuitem"]')).filter(vis).map(function (e) { return clean(e.innerText) + (e.getAttribute('aria-disabled') === 'true' ? '(灰)' : ''); }),
    };
  };
  var ups = function () {
    return performance.getEntriesByType('resource').filter(function (e) { return /upload/i.test(e.name); }).slice(-12).map(function (e) {
      var q = /command=([A-Z]+)/.exec(e.name);
      return (q ? q[1] : e.name.replace(/^https?:\/\//, '').slice(0, 40)) + ':' + (e.responseStatus || '?') + '@' + Math.round(e.startTime / 1000) + 's/' + Math.round(e.duration) + 'ms';
    });
  };
  /**
   * X 文章的发布弹窗里的导语框 —— 11-02 真机量的:textarea[data-testid=articleTweetTextInput](aria-label「Add a caption to your article」),
   * 在 sheetDialog 里;外面那层 [role=dialog] 高度是 0(按「弹窗可见」找会恒找不到 —— 第一版就栽在这)。
   * 认它自己的 testid,LaTeX / Code / 表格弹窗里的 textarea 自然不会认错
   */
  var captionBox = function () {
    return Array.prototype.slice.call(document.querySelectorAll('textarea[data-testid="articleTweetTextInput"]')).filter(vis)[0] || null;
  };
  /** 顶上那行保存状态(「Draft · Last saved 28 seconds ago」/ 存的时候大概是 Saving…)—— 11-03 诊断:看它能不能当「这张图存好了」的信号 */
  var saveText = function () {
    var hit = Array.prototype.slice.call(document.querySelectorAll('span, div')).filter(function (e) { return e.children.length === 0 && /^(Saving|Saved|Last saved)/i.test(clean(e.innerText)); })[0];
    return hit ? clean(hit.parentElement ? hit.parentElement.innerText : hit.innerText).slice(0, 60) : null;
  };
  /**
   * ⭐ X 在处理图片(11-03 真机截图:顶上那行变成「Processing media...」、工具栏发灰)—— 这期间往编辑器里放东西 X 不接
   *   (存好了「Last saved just now」之后照样会进这个状态:两次都是图后面紧接着粘小标题 not-landed)
   */
  var processing = function () {
    /** 按整页的字找(11-03 第一版按「叶子元素以它开头」找,真机上一次都没命中,procWaited 恒 0)*/
    return /Processing media/i.test(document.body.innerText || '');
  };
  /** 顶上状态的那几个字(Processing / Saving / Last saved …),时间线诊断用 */
  var statusLine = function () {
    var m = /(Processing media[^\n]*|Saving[^\n]*|Last saved[^\n]*|Uploading[^\n]*)/i.exec(document.body.innerText || '');
    return m ? m[1].slice(0, 40) : '-';
  };
  var openInsert = async function (label) {
    var trig = document.querySelector('button[aria-label="Add Media"]');
    if (!trig) return 'no-insert-button';
    trig.click();
    var it = await waitFor(function () { return byText('[role="menuitem"]', label); }, 4000);
    if (!it) return 'no-menu-item';
    it.click();
    return 'ok';
  };
`;

const SRC = String.raw`(async function (P) {
  ${LIB}
  try {
    if (!(innerWidth > 0)) return { state: 'hidden', why: 'X 网页宽度是 0(没显示在屏幕上),X 文章的弹窗不会画出来' };
    var m = /\/compose\/articles\/edit\/(\d+)/.exec(location.pathname);
    var editId = m ? m[1] : null;
    /** 往正文里放东西的动作:先等 X 处理完图片(主动看,不干等;最多 P.processMs,默认 60 秒)*/
    var procWaited = 0;
    if (/^(paste|divider|latex|code|table|mediaOpen)$/.test(P.op) && processing()) {
      var tp = Date.now();
      await waitFor(function () { return !processing(); }, P.processMs || 60000);
      procWaited = Date.now() - tp;
      if (processing()) return { state: 'still-processing', why: 'X 处理图片 ' + Math.round(procWaited / 1000) + ' 秒还没完(顶上一直是 Processing media)', procWaited: procWaited };
    }
    switch (P.op) {
      case 'state': {
        var t = document.querySelector('textarea[placeholder="Add a title"]');
        return {
          state: 'ok', url: location.href, editId: editId, title: t ? t.value : null, counts: counts(), uploading: uploading(), saved: saveText(), outline: outline(),
          text: body() ? clean(body().innerText) : null, dialog: !!document.querySelector('[role="dialog"]'),
          cover: !!document.querySelector('button[aria-label="Remove photo"]'),
          create: !!document.querySelector('button[aria-label="create"]'),
          loggedOut: !!document.querySelector('[data-testid="loginButton"]'),
        };
      }
      case 'create': {
        if (editId) return { state: 'already-editing', editId: editId };
        var c = await waitFor(function () { return document.querySelector('button[aria-label="create"]'); }, 8000);
        if (!c) return { state: 'no-create', why: 'X 文章列表页上找不到「create」—— 这个号可能没有 X 文章(要 Premium)' };
        c.click();
        var got = await waitFor(function () { var x = /\/compose\/articles\/edit\/(\d+)/.exec(location.pathname); return x && body() ? x[1] : null; }, 10000);
        if (!got) return { state: 'timeout', why: '点了 create 10 秒没进编辑器', url: location.href };
        await sleep(800);
        return { state: 'ok', editId: got, blocks: blocks().length, empty: clean(body().innerText) === '' };
      }
      case 'title': {
        var ti = document.querySelector('textarea[placeholder="Add a title"]');
        if (!ti) return { state: 'no-title-box' };
        setVal(ti, P.text);
        await sleep(300);
        return { state: ti.value === P.text ? 'ok' : 'not-landed', got: ti.value };
      }
      case 'paste': {
        var b = body();
        if (!b) return { state: 'no-body' };
        var last = blocks()[blocks().length - 1];
        var lastEmpty = !last || (!last.querySelector('img, svg, table, pre') && clean(last.innerText) === '');
        var html = P.html;
        if (!lastEmpty || !/^<p[ >]/.test(html)) html = '<p>​</p>' + html;
        var before = counts().blocks;
        var dt = new DataTransfer();
        dt.setData('text/plain', P.text);
        dt.setData('text/html', html);
        var pev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        b.dispatchEvent(pev);
        var want = clean(P.text).replace(/\s+/g, '').slice(-12);
        var ok = await waitFor(function () { return clean(b.innerText).replace(/\s+/g, '').indexOf(want) !== -1; }, 4000);
        /**
         * 没进去时带回现场(11-03:同一位置同一段,出错那刻 X 不接、过会儿 probe 再粘就进去了)——
         * handled = X(DraftJS)接没接这个 paste 事件(编辑器暂时只读时不接);selBlock = 光标在第几块;status = 顶上状态
         */
        var selB = (function () { var sl = getSelection(); var an = sl && sl.anchorNode; var bs2 = blocks(); for (var x = an; x; x = x.parentElement || x.parentNode) { if (x.getAttribute && x.getAttribute('data-block') === 'true') return bs2.indexOf(x); } return -1; })();
        return ok ? { state: 'ok', before: before, after: counts().blocks, prefixed: html !== P.html, procWaited: procWaited }
          : { state: 'not-landed', before: before, after: counts().blocks, prefixed: html !== P.html, procWaited: procWaited, processingNow: processing(),
            handled: pev.defaultPrevented, selBlock: selB, blocksNow: blocks().length, status: statusLine(), outline: outline() };
      }
      /**
       * 插图前保证光标在一个空行上(11-03 真机:光标在刚粘的小标题末尾时,插图把小标题那一块整个换掉了)。
       * 最后一块已经是空行 → 什么都不做;不是 → 合成粘贴两个零宽段落:第一个并进当前行(看不见),第二个成新的空行。
       * 之后由 tail + 真点击把光标放进去
       */
      case 'newLine': {
        var bl = body();
        if (!bl) return { state: 'no-body' };
        var lb = blocks()[blocks().length - 1];
        if (lb && !lb.querySelector('img, svg, table, pre') && clean(lb.innerText) === '') return { state: 'ok', added: false };
        var n9 = counts().blocks;
        var dt9 = new DataTransfer();
        dt9.setData('text/plain', '\n');
        dt9.setData('text/html', '<p>\u200b</p><p>\u200b</p>');
        bl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt9, bubbles: true, cancelable: true }));
        var ok9 = await waitFor(function () { return counts().blocks > n9; }, 4000);
        return ok9 ? { state: 'ok', added: true, before: n9, after: counts().blocks } : { state: 'not-landed', before: n9, outline: outline() };
      }
      case 'divider': {
        var n0 = counts().sections;
        var o = await openInsert('Divider');
        if (o !== 'ok') return { state: o };
        var ok2 = await waitFor(function () { return counts().sections > n0; }, 4000);
        return { state: ok2 ? 'ok' : 'not-landed' };
      }
      case 'latex': {
        var s0 = counts().sections;
        var o2 = await openInsert('LaTeX');
        if (o2 !== 'ok') return { state: o2 };
        var ta = await waitFor(dialogTextarea, 5000);
        if (!ta) return { state: 'no-input', why: 'LaTeX 弹窗里没有输入框' };
        setVal(ta, P.latex);
        await sleep(300);
        var ins = dlgBtn('Insert');
        if (!ins) return { state: 'no-confirm' };
        ins.click();
        if (!(await waitFor(function () { return !sheet(); }, 5000))) return { state: 'dialog-stuck', why: '点了 Insert 弹窗没关(公式写错了?)' };
        var ok3 = await waitFor(function () { return counts().sections > s0; }, 4000);
        return { state: ok3 ? 'ok' : 'not-landed' };
      }
      case 'code': {
        var s1 = counts().code;
        var o3 = await openInsert('Code');
        if (o3 !== 'ok') return { state: o3 };
        var cta = await waitFor(dialogTextarea, 5000);
        if (!cta) return { state: 'no-input', why: 'Code 弹窗里没有代码框' };
        var lang = '';
        var li = document.querySelector('[data-testid="programming-language-input"]');
        if (li && P.language) {
          setVal(li, P.language);
          await sleep(700);
          /** 打字后下面列出来的语言按钮,和要的名字一样(不分大小写)才点;没有就清掉,当没语言 */
          var pick = dlgBtn(P.language);
          if (pick) { pick.click(); await sleep(300); lang = li.value; } else setVal(li, '');
        }
        setVal(cta, P.code);
        await sleep(300);
        var ins2 = dlgBtn('Insert');
        if (!ins2) return { state: 'no-confirm' };
        ins2.click();
        if (!(await waitFor(function () { return !sheet(); }, 5000))) return { state: 'dialog-stuck' };
        var ok4 = await waitFor(function () { return counts().code > s1; }, 4000);
        return { state: ok4 ? 'ok' : 'not-landed', language: lang };
      }
      case 'table': {
        var t0 = document.querySelectorAll('table').length;
        var o4 = await openInsert('Table');
        if (o4 !== 'ok') return { state: o4 };
        var r = Math.min(10, Math.max(1, P.rows)), cc = Math.min(10, Math.max(1, P.cols));
        var g = await waitFor(function () { return document.querySelector('[aria-label="Insert a ' + r + ' by ' + cc + ' table"]'); }, 5000);
        if (!g) return { state: 'no-grid', why: '表格弹窗里没有 ' + r + '×' + cc + ' 的格子' };
        mclick(g);
        if (!(await waitFor(function () { return document.querySelectorAll('table').length > t0; }, 5000))) return { state: 'not-landed', why: '点了格子没插出表格' };
        await sleep(500);
        var tb = Array.prototype.slice.call(document.querySelectorAll('table')).pop();
        var sec = tb.closest('section') || tb.closest('[data-block="true"]');
        mclick(tb);
        await sleep(400);
        var pen = sec && sec.querySelector('[aria-label="Edit block"]');
        if (!pen) return { state: 'no-pencil', why: '新表格上找不到「Edit block」' };
        mclick(pen);
        var mta = await waitFor(dialogTextarea, 5000);
        if (!mta) return { state: 'no-input', why: '点了铅笔没出 markdown 框' };
        setVal(mta, P.markdown);
        await sleep(300);
        var up = dlgBtn('Update') || dlgBtn('Insert');
        if (!up) return { state: 'no-confirm' };
        up.click();
        if (!(await waitFor(function () { return !sheet(); }, 5000))) return { state: 'dialog-stuck', why: '点了 Update 弹窗没关(markdown 不对?)' };
        await sleep(500);
        var cells = Array.prototype.slice.call(document.querySelectorAll('table')).pop().querySelectorAll('th, td');
        var filled = Array.prototype.filter.call(cells, function (x) { return clean(x.innerText) !== ''; }).length;
        return { state: filled > 0 ? 'ok' : 'empty-table', cells: cells.length, filled: filled };
      }
      case 'mediaOpen': {
        var o5 = await openInsert('Media');
        if (o5 !== 'ok') return { state: o5 };
        var inp = await waitFor(function () { return document.querySelector('[role="dialog"] input[data-testid="fileInput"]'); }, 5000);
        return inp ? { state: 'ok', img: counts().img } : { state: 'no-input', why: '点了 Media 没出选文件的弹窗', img: counts().img, scene: scene(), ups: ups() };
      }
      /**
       * 标出正文最后那个空行(主进程接着真点击它,把光标放回正文末尾)。
       * 11-03 真机:图插完之后接着粘的小标题,一次被后面插的图吃掉、一次干脆粘不进去 —— 推断 X 的光标停在了图上 / 图的说明框里;
       * 顺带带回点之前焦点在哪(active),验证这个推断
       */
      case 'tail': {
        var bs = blocks();
        Array.prototype.forEach.call(document.querySelectorAll('[data-krig-tail]'), function (x) { x.removeAttribute('data-krig-tail'); });
        var tl = bs[bs.length - 1];
        var ae = document.activeElement;
        var active = ae ? ae.tagName + (ae.getAttribute('data-testid') ? '#' + ae.getAttribute('data-testid') : '') + (ae.getAttribute('aria-label') ? '[' + ae.getAttribute('aria-label').slice(0, 30) + ']' : '') : null;
        if (!tl || tl.querySelector('img') || clean(tl.innerText) !== '') return { state: 'no-empty-tail', active: active, outline: outline() };
        tl.setAttribute('data-krig-tail', '1');
        return { state: 'ok', active: active };
      }
      case 'mediaWait': {
        var ok5 = await waitFor(function () { return !sheet() && counts().img >= P.want; }, 20000);
        if (!ok5) return { state: 'timeout', img: counts().img, dialog: !!sheet(), outline: outline() };
        /**
         * ⭐ 等 X 把这张图存好再往下 —— 主动看顶上的保存状态,不干等(用户 11-03:「应该采用主动检查的方式而不是等待」)。
         * 11-03 真机:图刚插完顶上读不到「Last saved」(在存),1~2 秒后变「Last saved just now」;
         *   只稳 1.5 秒那版,第 5 张图后紧接着粘小标题 → X 没接住(not-landed,块数 10→10)。
         *   10-30 第 14 步粘的字被冲掉,多半也是这个(当时每张死等 20 秒,碰巧盖过去了)。
         * 先等它离开「Last saved …」(开始存,最多 3 秒,可能已经存完了没看见)→ 再等「Last saved just now」(最多 P.saveMs)
         */
        /**
         * 11-03 第二次:等到 Last saved just now 也不够 —— 之后插的小标题先报成功、过后被冲掉(正文里没了)。
         * 这里记一条时间线(顶上状态每变一次记一笔 + 当时正文几块),并且:Processing media 出现过就等它没了;
         * 5 秒内一直没出现就往下(也记下来)。下一次真机看时间线定规则。
         */
        var t3 = Date.now();
        var line = [];
        var last = '';
        var blocks0 = counts().blocks;
        var seenProc = false;
        var procDone = false;
        while (Date.now() - t3 < (P.saveMs || 60000)) {
          var st = statusLine();
          if (st !== last) { line.push(Math.round((Date.now() - t3) / 100) / 10 + 's ' + st + ' #' + counts().blocks); last = st; }
          if (processing()) seenProc = true;
          else if (seenProc) { procDone = true; break; }
          else if (Date.now() - t3 > 5000 && /Last saved/i.test(st)) break;
          await sleep(200);
        }
        return { state: 'ok', img: counts().img, waited: Date.now() - t3, saved: saveText(), savedOk: !seenProc || procDone, seenProc: seenProc, blocks0: blocks0, blocks: counts().blocks, line: line };
      }
      case 'coverApply': {
        var ap = await waitFor(function () { return document.querySelector('[data-testid="applyButton"]'); }, 10000);
        if (!ap) return { state: 'no-apply', why: '喂了封面没出裁剪框' };
        /**
         * ⚠️ 11-02 真机(带现场):点了 Apply 30 秒后裁剪框还开着、Apply 还在、一条上传请求都没有 —— 那一下 X 没认,不是传得慢
         *   (10-30「第一次 10 秒没等到」多半也是这个,当时误判成上传慢放宽了时间)。
         *   → 等按钮能点再点(完整鼠标序列);每 5 秒框还在就再点一次,最多 6 次;每次点时按钮什么状态记下来
         */
        var landed = function () { return !document.querySelector('[data-testid="applyButton"]') && document.querySelector('button[aria-label="Remove photo"]'); };
        var clicks = [];
        var ok6 = null;
        for (var k = 0; k < 6 && !ok6; k++) {
          var b6 = document.querySelector('[data-testid="applyButton"]');
          if (b6) {
            var off = function (el) { return el.disabled || el.getAttribute('aria-disabled') === 'true'; };
            await waitFor(function () { var x = document.querySelector('[data-testid="applyButton"]'); return x && !off(x); }, 5000);
            b6 = document.querySelector('[data-testid="applyButton"]');
            if (b6) { clicks.push(off(b6) ? '灰' : '可点'); mclick(b6); }
          }
          ok6 = await waitFor(landed, 5000);
        }
        return ok6 ? { state: 'ok', clicks: clicks, ups: ups() } : { state: 'not-landed', clicks: clicks, apply: !!document.querySelector('[data-testid="applyButton"]'), dialog: !!document.querySelector('[role="dialog"]'), scene: scene(), ups: ups() };
      }
      case 'uploads': {
        var t1 = Date.now();
        while (uploading() > 0 && Date.now() - t1 < P.ms) await sleep(500);
        return { state: uploading() === 0 ? 'ok' : 'timeout', busy: uploading() };
      }
      case 'delete': {
        if (!editId) return { state: 'not-editing', url: location.href };
        var pub = byText('button, [role="button"]', 'Publish');
        if (!pub) return { state: 'no-publish-row' };
        var pr = pub.getBoundingClientRect();
        var more = Array.prototype.slice.call(document.querySelectorAll('button[aria-label="More"]')).filter(vis)
          .sort(function (a, b2) { var ra = a.getBoundingClientRect(), rb = b2.getBoundingClientRect(); return (Math.abs(ra.top - pr.top) + Math.abs(ra.left - pr.right)) - (Math.abs(rb.top - pr.top) + Math.abs(rb.left - pr.right)); })[0];
        if (!more) return { state: 'no-more' };
        more.click();
        var del = await waitFor(function () { return byText('[role="menuitem"]', 'Delete Article'); }, 4000);
        if (!del) return { state: 'no-delete-item' };
        del.click();
        /** 确认框「Delete Article? … Yes, delete / Cancel」(10-30 真机) */
        var conf = await waitFor(function () { return document.querySelector('[data-testid="confirmationSheetConfirm"]'); }, 4000);
        if (!conf) return { state: 'no-confirm', why: '点了 Delete Article 没出确认框' };
        conf.click();
        var gone = await waitFor(function () { return location.pathname.indexOf('/edit/' + editId) === -1; }, 8000);
        return { state: gone ? 'ok' : 'still-here', confirmed: !!conf, url: location.href };
      }
      /**
       * ⚠️⚠️ 真的发出去 —— 只由 x.post.publish(人点了确认发布)调。点一次 Publish;
       * 弹出确认框且里面有「Publish」就再点那一下(还没在真机上见过它长什么样,10-30);之后等离开编辑页。
       * 不重试(重试 = 可能发两篇)。
       */
      /**
       * 待发期间主进程隔一会儿看一眼(用户 11-02:点 X 网页自己的 Publish 也要有导语):
       * 发布弹窗开着、导语框空的 → 填一次(每个框只填一次,人删了不再填);离开了这份文章的编辑页 → 报 left(主进程看是不是发出去了)
       */
      case 'watch': {
        if (!editId || editId !== P.editId) return { state: 'left', url: location.href };
        var wb = captionBox();
        if (!wb) return { state: 'editing', dialog: false };
        if (wb.getAttribute('data-krig-caption')) return { state: 'editing', dialog: true, filled: false };
        wb.setAttribute('data-krig-caption', '1');
        if (wb.value || !P.caption) return { state: 'editing', dialog: true, filled: false, kept: !!wb.value };
        setVal(wb, P.caption);
        await sleep(300);
        return { state: 'editing', dialog: true, filled: wb.value === P.caption };
      }
      case 'publish': {
        if (!editId || editId !== P.editId) return { state: 'not-editing', url: location.href, why: '编辑器不在这份文章上 —— 没点发布' };
        /**
         * ⚠️ 11-02 删掉了「还有图在上传(正文图是 blob:)就不点」:X 从来不把 blob: 换掉(10-30 已知),这条恒成立 ——
         * 用户第一次点 KRIG 的确认发布就被它拦下(busy 7)。图传没传完 X 自己管(Publish 按钮灰 / 弹窗报错),下面都如实带回
         */
        var pb = byText('button, [role="button"]', 'Publish');
        if (!pb) return { state: 'no-publish', why: '找不到 Publish 按钮' };
        if (pb.disabled || pb.getAttribute('aria-disabled') === 'true') return { state: 'disabled', why: 'Publish 按钮是灰的(缺标题?)—— 没点' };
        pb.click();
        var seen = [];
        var t2 = Date.now();
        var confirmed = false;
        while (Date.now() - t2 < 30000) {
          await sleep(500);
          if (location.pathname.indexOf('/compose/articles/edit/' + editId) === -1) return { state: 'left', url: location.href, confirmed: confirmed, captionKept: capKept || undefined };
          var d = document.querySelector('[role="dialog"], [role="alertdialog"]');
          if (d && !confirmed) {
            seen.push(clean(d.innerText).slice(0, 200));
            /**
             * 发布弹窗(10-30 真机截图):Choose your audience / Who can reply / 「Add a caption to your article」(≤256)/ 右上 Publish。
             * 导语:弹窗里的 textarea;填不进去就不点(宁可停下让人自己填,不发出一篇没导语的)
             */
            var capKept = '';
            if (P.caption) {
              var cap = await waitFor(captionBox, 5000);
              if (!cap) return { state: 'caption-failed', why: '发布弹窗里找不到导语框', dialog: clean(d.innerText).slice(0, 300) };
              /** 框里已经有字(盯着的那边先填了 / 人在 X 上改过)→ 不覆盖,人改的算数 */
              if (cap.value) capKept = cap.value;
              else {
                setVal(cap, P.caption);
                await sleep(400);
                if (cap.value !== P.caption) return { state: 'caption-failed', why: '导语框里的字对不上', got: cap.value.slice(0, 60) };
              }
            }
            var cb = byText('[role="dialog"] button, [role="alertdialog"] button, [role="dialog"] [role="button"]', 'Publish');
            if (cb) { cb.click(); confirmed = true; }
          }
        }
        var dl = document.querySelector('[role="dialog"], [role="alertdialog"]');
        return { state: 'stuck', url: location.href, confirmed: confirmed, dialogs: seen, dialogNow: dl ? clean(dl.innerText).slice(0, 300) : null };
      }
      default: return { state: 'bad-op', op: P.op };
    }
  } catch (e) { return { state: 'error', why: String(e) }; }
})(__PARAMS__);`;

export const X_ARTICLE_SCRIPTS: readonly RegisteredScript[] = [
  {
    id: X_ARTICLE_SCRIPT,
    purpose: 'X 文章编辑器:新建 / 填标题 / 粘正文 / 插公式代码表格分隔线 / 开图片框 / 放封面 / 读回 / 删草稿 / 发布(op 分动作;只有 publish 真的发出去)',
    build: (params) => SRC.replace('__PARAMS__', () => JSON.stringify(params ?? {})),
  },
];
