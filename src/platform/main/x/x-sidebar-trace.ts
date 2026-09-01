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
import { appendFile, mkdir } from 'node:fs/promises';
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

/** 给一个 X guest 装追踪探针 + 接它的上报 */
export function installSidebarTrace(wc: WebContents, wsId: string): void {
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
        void trace('guest', {
          wsId, wcId: wc.id,
          DOM算的: navW,
          画面上的: painted?.paintedW ?? null,
          一致: painted ? (Math.abs(painted.paintedW - navW) < 40 ? '是' : '✗ 不一致') : '-',
          ...parsed,
        });
      })();
    } catch { /* 解析不了就丢 */ }
  });
  if (!wc.isLoading()) install();
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
): Promise<{ paintedW: number; sampled: number } | null> {
  try {
    const img = await wc.capturePage();
    const size = img.getSize();
    if (size.width === 0 || size.height === 0) return null;
    const bmp = img.toBitmap();              // BGRA
    const rowBytes = size.width * 4;
    // capturePage 返回物理像素,Retina 下是 CSS 的 2 倍;换算回 CSS 才好与 navW 比
    const scale = size.width >= 2000 ? 2 : 1;
    const navZone = Math.min(size.width, 420 * scale);   // 导航区最多 420 CSS px
    let maxX = 0;
    let sampled = 0;
    for (let y = Math.floor(size.height * 0.25); y < size.height * 0.75; y += 16) {
      sampled++;
      for (let x = navZone - 1; x >= 0; x--) {
        const i = y * rowBytes + x * 4;
        const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
        // X 深色主题背景近黑;文字/图标明显更亮
        if (r + g + b > 120) { if (x > maxX) maxX = x; break; }
      }
    }
    return { paintedW: Math.round(maxX / scale), sampled };
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
    await appendFile(file, img.toPNG());
    return file;
  } catch {
    return null;
  }
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
