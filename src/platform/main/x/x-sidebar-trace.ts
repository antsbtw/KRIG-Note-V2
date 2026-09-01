/**
 * X 左侧栏状态追踪器(临时诊断设施)
 *
 * 起因:「侧栏不随宽度适配,但一开 DevTools 就正确」这个 bug 排查了多轮,
 * 每轮都靠用户口头描述现象 + 贴 DevTools 日志。而 DevTools 本身会**改变被观测的行为**
 * (它强制重绘),于是「打开 DevTools 才能看日志」和「打开 DevTools 就好了」纠缠在一起,
 * 根本分不清看到的是故障态还是被观测行为修正后的状态 —— 典型的观测者效应。
 *
 * 本模块把状态落到**文件**,不依赖 DevTools:
 *   ~/Library/Application Support/KRIG Note V2/krig-data/x-sidebar-trace.log
 *
 * 记两类事件:
 *   1. 我们主动量的(relayout 前后)
 *   2. guest 里 MutationObserver/ResizeObserver 自己观测到的变化 ——
 *      这类才能抓到「我们没触发、但状态确实变了」的时刻(比如开 DevTools 那一下)
 *
 * ⚠️ 临时设施,定位后连同 x-diag 日志一起删。
 */
import { app, webContents, type WebContents } from 'electron';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TRACE_DIR = path.join(app.getPath('userData'), 'krig-data');
const TRACE_FILE = path.join(TRACE_DIR, 'x-sidebar-trace.log');

let ready = false;
async function ensureDir(): Promise<void> {
  if (ready) return;
  try { await mkdir(TRACE_DIR, { recursive: true }); ready = true; } catch { /* 尽力而为 */ }
}

/** 写一行追踪记录。绝不抛 —— 诊断设施不该影响被诊断的程序。 */
export async function trace(tag: string, detail: unknown): Promise<void> {
  try {
    await ensureDir();
    const line = `${new Date().toISOString()} [${tag}] `
      + (typeof detail === 'string' ? detail : JSON.stringify(detail)) + '\n';
    await appendFile(TRACE_FILE, line, 'utf-8');
  } catch { /* 写不进去就算了 */ }
}

export function getTraceFilePath(): string {
  return TRACE_FILE;
}

/**
 * 在 guest 里装观察器:侧栏宽度一变就上报。
 *
 * 关键在于**由 guest 自己观测**,而不是我们定时去问 —— 只有这样才能抓到
 * 「我们没做任何事、状态却变了」的时刻(开 DevTools 就属于这种)。
 * 上报走 console 消息,主进程在 console-message 事件里捞出来落文件。
 */
const PROBE_JS = `(function(){
  if (window.__krigSidebarTrace) return 'already';
  window.__krigSidebarTrace = true;
  var last = null;
  function snap(reason) {
    var hdr = document.querySelector('header[role="banner"]');
    var side = document.querySelector('[data-testid="sidebarColumn"]');
    var s = {
      reason: reason,
      innerWidth: window.innerWidth,
      navW: hdr ? Math.round(hdr.getBoundingClientRect().width) : -1,
      rightW: side ? Math.round(side.getBoundingClientRect().width) : -1,
      hidden: document.hidden,
      visState: document.visibilityState,
    };
    var key = s.innerWidth + '|' + s.navW + '|' + s.rightW + '|' + s.visState;
    if (key === last) return;          // 没变化不刷屏
    last = key;
    console.log('__KRIG_SIDEBAR__' + JSON.stringify(s));
  }
  // ① guest 自己的尺寸变化
  try { new ResizeObserver(function(){ snap('resize-observer'); })
          .observe(document.documentElement); } catch (e) {}
  // ② 导航 DOM 被改写(X 切换展开/收起就是改 DOM)
  try {
    var mo = new MutationObserver(function(){ snap('mutation'); });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true,
                                attributeFilter: ['style', 'class'] });
  } catch (e) {}
  // ③ 可见性变化(display:none 复出、窗口切换都会走这里)
  document.addEventListener('visibilitychange', function(){ snap('visibility'); });
  window.addEventListener('resize', function(){ snap('window-resize'); });
  snap('probe-installed');
  return 'installed';
})()`;

/**
 * 启动后连拍:用户报告的故障是「打开 app 侧栏就是关的,按 Cmd+Opt+I 才打开」。
 * 那是**启动期**的稳态故障,不是某次 resize 引起的 —— 之前的记录都在等
 * "宽度变化"才采样,恰好把这段漏掉了(还把它当成"页面在加载"忽略掉)。
 *
 * 这里按 1/2/4/8/15/25/40s 连拍,把启动后侧栏"一直没展开"的过程完整拍下来,
 * 并在每张图旁记下 DOM 此刻算的是多少 —— 若 DOM 一直是展开而画面一直是收起,
 * 「算对了没画出来」就实锤了。
 */
function scheduleStartupShots(wc: WebContents, wsId: string): void {
  // 启动窗口过后改为长期低频轮询:排查时随时能看到"此刻"的状态,
  // 不必再赶在启动 40s 内。开 DevTools 前后的对照就靠它。
  const poll = setInterval(() => {
    if (wc.isDestroyed()) { clearInterval(poll); return; }
    void probeLayoutVars(wc, 'poll');
  }, 5000);
  wc.once('destroyed', () => clearInterval(poll));

  for (const sec of [1, 2, 4, 8, 15, 25, 40]) {
    setTimeout(() => {
      if (wc.isDestroyed()) return;
      void (async () => {
        const painted = await capturePaintedNavWidth(wc);
        let dom: unknown = null;
        try {
          dom = await wc.executeJavaScript(
            `(function(){var h=document.querySelector('header[role="banner"]');`
            + `return JSON.stringify({w:window.innerWidth,`
            + `navW:h?Math.round(h.getBoundingClientRect().width):-1});})()`,
          );
        } catch { /* ignore */ }
        await probeLayoutVars(wc, `t${sec}s`);
        void trace('startup-shot', {
          wsId, wcId: wc.id, 秒: sec, dom,
          画面文字占比: painted?.paintedW ?? null,
        });
        await saveShot(wc, `wc${wc.id}-t${sec}s`);
      })();
    }, sec * 1000);
  }
}

/** 给一个 X guest 装探针 + 接它的上报 */
export function installSidebarTrace(wc: WebContents, wsId: string): void {
  let lastShotExpanded: boolean | null = null;
  const install = (): void => {
    wc.executeJavaScript(PROBE_JS)
      .then((r) => void trace('probe', { wsId, wcId: wc.id, result: r }))
      .catch(() => { /* guest 还没 ready */ });
  };
  wc.on('dom-ready', install);
  // console-message 里捞 guest 的上报(它没法直接写文件)
  wc.on('console-message', (...args: unknown[]) => {
    // Electron 版本间签名有差异:老版是 (event, level, message, ...),
    // 新版是 (event: {message,...})。两种都兜住,取出 message 字符串即可。
    let msg = '';
    for (const a of args) {
      if (typeof a === 'string' && a.includes('__KRIG_SIDEBAR__')) { msg = a; break; }
      if (a && typeof a === 'object' && typeof (a as { message?: unknown }).message === 'string'
          && (a as { message: string }).message.includes('__KRIG_SIDEBAR__')) {
        msg = (a as { message: string }).message; break;
      }
    }
    if (!msg) return;
    const json = msg.slice(msg.indexOf('__KRIG_SIDEBAR__') + '__KRIG_SIDEBAR__'.length);
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const navW = typeof parsed.navW === 'number' ? parsed.navW : -1;
      // 关键:同时记 DOM 算出来的宽度 **和** 真实画面里的宽度。
      // 两者不一致 = "算对了但没画出来";一致 = 布局侧真有问题。
      // 只有可见 guest 才截图(隐藏的截了也是空)。
      const visible = typeof parsed.innerWidth === 'number' && parsed.innerWidth > 0;
      void (async () => {
        const painted = visible ? await capturePaintedNavWidth(wc) : null;
        // 状态真正翻转时存一张图:启发式可能判错,图片不会。
        if (painted && visible) {
          const nowExpanded = painted.paintedW > 40;
          if (lastShotExpanded !== nowExpanded) {
            lastShotExpanded = nowExpanded;
            void saveShot(wc, `wc${wc.id}-${nowExpanded ? 'expanded' : 'collapsed'}`);
          }
        }
        void trace('guest', {
          wsId, wcId: wc.id,
          DOM算的: navW,
          // 画面文字区占比:>40% 基本可断定"画出来是展开的",<10% 是收起
          画面文字占比: painted?.paintedW ?? null,
          画面状态: painted == null ? '-' : painted.paintedW > 40 ? '展开' : painted.paintedW < 10 ? '收起' : '中间',
          一致: painted == null ? '-'
            : ((navW > 200) === (painted.paintedW > 40) ? '是' : '✗ DOM与画面不符'),
          ...parsed,
        });
      })();
    } catch { /* 解析不了就丢 */ }
  });
  if (!wc.isLoading()) install();
  scheduleStartupShots(wc, wsId);
}

/** 记一次「我们主动做了什么」,便于把因果对上 */
export function traceAction(action: string, detail: Record<string, unknown>): void {
  void trace('action', { action, ...detail });
}

/** DevTools 开合本身也要记 —— 它是这次排查里最大的干扰变量 */
export function traceDevtools(wc: WebContents, wsId: string): void {
  wc.on('devtools-opened', () => void trace('devtools', { wsId, wcId: wc.id, opened: true }));
  wc.on('devtools-closed', () => void trace('devtools', { wsId, wcId: wc.id, opened: false }));
}

/** 记录窗口级事件(全屏进出等),由 main-window 调用 */
export function traceWindowEvent(event: string, detail: Record<string, unknown>): void {
  void trace('window', { event, ...detail });
}

/** 会话开始分隔线 —— 每次启动在文件里留一道,便于分辨"这次"的记录 */
export function traceSessionStart(): void {
  void trace('SESSION', '═'.repeat(60) + ' app 启动 ' + new Date().toLocaleString());
}

/**
 * 抓真实渲染像素,判断左导航**画出来**没有。
 *
 * ⚠️ 为什么必须有这个:前面的 guest 探针读的是 DOM 计算值(getBoundingClientRect),
 * 它只证明 X 的**布局引擎跑过了**,完全无法说明像素有没有画到屏幕上。
 * 我曾据此断言"布局侧完全正确",被用户当场否掉 —— 眼睛看到的才是真相,
 * DOM 数字不是。(2026-09-01)
 *
 * 做法:截取导航区那一竖条,统计非背景像素的横向分布 ——
 * 展开态文字会一直延伸到 ~250px,收起态只有 ~88px 内有内容。
 * 这个数字与 DOM 的 navW 一对比,就能分辨"算对了但没画"。
 */
export async function capturePaintedNavWidth(
  wc: WebContents,
): Promise<{ paintedW: number; sampled: number } | null> {  // paintedW 现在是「文字区亮行占比 %」
  try {
    const img = await wc.capturePage();
    const size = img.getSize();
    if (size.width === 0 || size.height === 0) return null;
    const bmp = img.toBitmap();              // BGRA
    const rowBytes = size.width * 4;
    // capturePage 返回物理像素,Retina 下是 CSS 的 2 倍;换算回 CSS 才好与 navW 比
    const scale = size.width >= 2000 ? 2 : 1;
    // ⚠️ 上一版在 0~420px 里找"最右侧亮像素",结果几乎恒等于 420 —— 因为**时间线内容
    // 本身就在导航右边**,那片亮像素跟导航展开与否无关。读数饱和,毫无意义。
    // (2026-09-01 差点据此下结论,幸好先查了分布。)
    //
    // 改成量导航**自身**:X 左导航左侧固定留白约 12~20px,图标列约到 88px,
    // 展开时文字延伸到 ~250px。取 100~260px 这段"只有展开态才有内容"的区间,
    // 统计亮像素占比 —— 收起态该区间近乎全黑,展开态有明显文字笔画。
    let litRows = 0;
    let sampled = 0;
    const zoneL = Math.round(100 * scale);
    const zoneR = Math.round(260 * scale);
    for (let y = Math.floor(size.height * 0.3); y < size.height * 0.8; y += 8) {
      sampled++;
      let lit = 0;
      for (let x = zoneL; x < Math.min(zoneR, size.width); x++) {
        const i = y * rowBytes + x * 4;
        const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
        if (r + g + b > 150) lit++;
      }
      if (lit > 3) litRows++;             // 该行在文字区有笔画
    }
    // 展开态:多数采样行都有文字笔画;收起态:该区间是空的
    const ratio = sampled ? litRows / sampled : 0;
    return { paintedW: Math.round(ratio * 100), sampled };
  } catch {
    return null;
  }
}

/**
 * 把 guest 当前画面存成 PNG。
 * 像素启发式可能判错,但**图片不会骗人** —— 存下来直接看就知道屏幕上是什么。
 */
export async function saveShot(wc: WebContents, label: string): Promise<string | null> {
  try {
    await ensureDir();
    const img = await wc.capturePage();
    if (img.isEmpty()) return null;
    const file = path.join(TRACE_DIR, `x-shot-${label}-${Date.now()}.png`);
    await writeFile(file, img.toPNG());   // 必须 write 不能 append(append 会拼成坏文件)
    return file;
  } catch {
    return null;
  }
}

/**
 * 深挖 X 布局到底由什么变量决定 —— 用户问:「更底层的 web 页布局时,
 * 侧栏是没有变量的吗?」这正是该查的:与其外部量宽度猜断点,
 * 不如直接问 X 自己用的是什么。
 *
 * 三个候选,一次全查:
 *  ① CSS 媒体查询 —— matchMedia 的实际匹配结果(X 的断点是多少、当前命中哪条)
 *  ② 导航元素的计算样式 —— 是靠 width 还是 display 切换的
 *  ③ html/body 上的自定义属性 —— 有些 SPA 用 data-* 或 CSS 变量存布局态
 */
const LAYOUT_VARS_JS = `(function(){
  var out = { mq: {}, nav: null, vars: {} };
  // ① X 已知断点附近全试一遍,看当前命中哪些
  [500,688,1005,1080,1265,1280].forEach(function(px){
    try { out.mq['min-'+px] = window.matchMedia('(min-width:'+px+'px)').matches; } catch(e){}
  });
  // ② 导航元素的实际计算样式
  var hdr = document.querySelector('header[role="banner"]');
  if (hdr) {
    var cs = getComputedStyle(hdr);
    var r = hdr.getBoundingClientRect();
    out.nav = {
      rectW: Math.round(r.width),
      styleWidth: cs.width, display: cs.display, visibility: cs.visibility,
      opacity: cs.opacity, transform: cs.transform,
      // 导航里第一个链接的宽度:展开时含文字会明显更宽
      firstLinkW: (function(){
        var a = hdr.querySelector('a[role="link"]');
        return a ? Math.round(a.getBoundingClientRect().width) : -1;
      })(),
      // 文字节点是否真的存在(收起态 X 会把 span 移除或隐藏)
      visibleText: (function(){
        var sp = hdr.querySelectorAll('span');
        var n = 0;
        for (var i=0;i<sp.length;i++){
          var t=(sp[i].textContent||'').trim();
          if (t && sp[i].getBoundingClientRect().width>0) n++;
        }
        return n;
      })(),
    };
  }
  // ③ 根元素上的自定义属性/CSS 变量
  try {
    var de = document.documentElement;
    for (var i=0;i<de.attributes.length;i++){
      var a=de.attributes[i];
      if (a.name.indexOf('data-')===0 || a.name==='style' || a.name==='class')
        out.vars[a.name] = String(a.value).slice(0,120);
    }
  } catch(e){}
  out.innerWidth = window.innerWidth;
  out.dpr = window.devicePixelRatio;
  return JSON.stringify(out);
})()`;

/** 查一次 X 的布局变量,写进 trace */
export async function probeLayoutVars(wc: WebContents, label: string): Promise<void> {
  try {
    const raw = await wc.executeJavaScript(LAYOUT_VARS_JS);
    void trace('layout-vars', { wcId: wc.id, label, data: JSON.parse(String(raw)) });
  } catch { /* ignore */ }
}

/** 供排查时从主进程直接查当前所有 X guest 的状态 */
export async function snapshotAll(): Promise<void> {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    const url = (() => { try { return wc.getURL(); } catch { return ''; } })();
    if (!url.includes('x.com')) continue;
    try {
      const r = await wc.executeJavaScript(
        `(function(){var h=document.querySelector('header[role="banner"]');`
        + `return JSON.stringify({w:window.innerWidth,`
        + `navW:h?Math.round(h.getBoundingClientRect().width):-1});})()`,
      );
      void trace('snapshot', { wcId: wc.id, data: r });
    } catch { /* ignore */ }
  }
}
