/**
 * ⭐⭐ 控制台通道**四处接线必须齐全** —— 少一处就是「建好了却点不到」
 *
 * ── 为什么要这条守卫 ──
 *
 * 一个能力要在面板上跑起来,得同时具备四样:
 *   ① `channel-names.ts` 里有频道名
 *   ② `web-console-handler.ts` 里有 `ipcMain.handle`
 *   ③ `main-window-preload.ts` 里有暴露
 *   ④ `electron-api.d.ts` 里有类型
 *
 * 缺任何一处,现象都是**「点了没反应」**,而不是一条清晰的报错:
 *  · 缺 ② → invoke 直接 reject(还算响)
 *  · 缺 ③ → `api().xxx` 是 undefined,面板那侧静默什么也不做
 *  · 缺 ④ → 只有编译期报错,但 `api()` 是可选链,漏了也能跑
 *
 * ⭐ 本仓已经为这个形态付过多次学费:`ControlEngine`/`InputEngine` 四个类
 * **写完并测过**却全仓零处 `new`(缺接缝);`recordRequestStart` 至今零调用
 * (缺调用方);`dropShardsBefore` 方法在、调用方零(磁盘无限涨)。
 * 共同形态都是**「东西建好了,但没有人接上」**。
 *
 * ⚠️ 本守卫钉的是**接线完整性**,不是行为。行为由各能力自己的测试钉。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

/** ⚠️ 剥注释:行注释的 `//` 前面不能是冒号,否则会把 `https://` 里的 URL 连同后面代码吃掉 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const channelNames = strip(read('src/shared/ipc/channel-names.ts'));
const handler = strip(read('src/platform/main/ipc/web-console-handler.ts'));
const preload = strip(read('src/platform/main/preload/main-window-preload.ts'));
const apiTypes = strip(read('src/shared/ipc/electron-api.d.ts'));

/** 从 channel-names.ts 里抓出所有 WEBC_* 常量名 —— **真表**,不在这里抄一份 */
const WEBC_CHANNELS = Array.from(
  new Set(Array.from(channelNames.matchAll(/\b(WEBC_[A-Z_]+)\s*:/g)).map((m) => m[1])),
);

describe('⭐⭐ 控制台四处接线齐全', () => {
  it('前提自检:确实抓到了频道清单(否则整段空转)', () => {
    /**
     * ⚠️ 正则一旦失配就会返回空数组,而空数组让下面每条 `forEach` 都不执行 ——
     * **整段假绿**。本会话已因同族问题栽过六次,这里把前提钉死。
     */
    expect(WEBC_CHANNELS.length, 'WEBC_* 频道一个都没抓到 —— 守卫在空转').toBeGreaterThan(10);
  });

  it('⭐⭐ 每个频道都有主侧 handler(否则 invoke 必 reject)', () => {
    /**
     * ⚠️⚠️ **广播频道不该有 handler** —— 2026-09-24 加 WEBC_FLOW_PROGRESS 时撞红。
     *
     * 它是 **main → renderer 单向推送**(`wc.send`),不是 invoke ——
     * 给它注册 `ipcMain.handle` 反而是错的。
     * ⭐ 所以这条守卫要**区分两类频道**,而不是放宽成「有些可以没有」:
     * 放宽的话,真正漏了 handler 的 invoke 频道也会被放过。
     *
     * 判据:频道**名字**里带 PROGRESS/UPDATE/EVENT 的是广播
     * (与 X_CAPTURE_UPDATE / X_HARVEST_PROGRESS 同一套命名习惯)。
     * ⚠️ 加新的广播频道时按这个命名,否则这里会误报。
     */
    const isBroadcast = (c: string) => /_(PROGRESS|UPDATE|EVENT)$/.test(c);
    const invokeChannels = WEBC_CHANNELS.filter((c) => !isBroadcast(c));
    /** ⭐ 前提自检:别把所有频道都当成广播而空转 */
    expect(invokeChannels.length, 'invoke 型频道一个都没剩 —— 守卫在空转')
      .toBeGreaterThan(10);
    const missing = invokeChannels.filter(
      (c) => !new RegExp(`ipcMain\\.handle\\(\\s*IPC_CHANNELS\\.${c}\\b`).test(handler),
    );
    expect(
      missing,
      '这些频道声明了却没有 handler —— 面板点下去只会 reject:\n  ' + missing.join('\n  '),
    ).toEqual([]);
  });

  it('⭐⭐ 每个频道都在 preload 暴露(否则面板侧静默 no-op)', () => {
    const missing = WEBC_CHANNELS.filter(
      (c) => !new RegExp(`IPC_CHANNELS\\.${c}\\b`).test(preload),
    );
    expect(
      missing,
      '这些频道没在 preload 暴露 —— `api().xxx` 是 undefined,\n'
      + '面板那侧**静默什么也不做**(最难查的一种):\n  ' + missing.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ handler 注册数与 WEBC_COUNT 一致(写死的计数会悄悄过期)', () => {
    /**
     * 这行日志曾长期写「10」而实际注册 12 个 —— 小号的「说了假话的数字」。
     * 计数对不上时,启动日志就在骗人。
     */
    const registered = (handler.match(/ipcMain\.handle\(\s*IPC_CHANNELS\.WEBC_/g) ?? []).length;
    const declared = handler.match(/const WEBC_COUNT\s*=\s*(\d+)/);
    expect(declared, '找不到 WEBC_COUNT').not.toBeNull();
    expect(
      Number(declared![1]),
      `WEBC_COUNT=${declared![1]} 但实际注册 ${registered} 个 —— 启动日志在说假话`,
    ).toBe(registered);
  });
});

describe('⭐⭐ 执行者(第四类)的接线与分层', () => {
  it('⭐⭐ execute 四处齐全', () => {
    expect(channelNames, '频道没声明').toContain('WEBC_EXECUTE');
    expect(handler, '主侧没 handler').toMatch(/ipcMain\.handle\(\s*IPC_CHANNELS\.WEBC_EXECUTE\b/);
    expect(preload, 'preload 没暴露').toMatch(/IPC_CHANNELS\.WEBC_EXECUTE\b/);
    expect(apiTypes, '类型面没有 execute').toMatch(/execute\s*\(\s*args\s*:/);
  });

  it('⭐⭐ execute 登记在 exec 层 —— 不许落进 web.page 兜底', () => {
    /**
     * `planTrace` 的兜底是 `LAYER_OF[fn] ?? 'web.page'`。
     * execute 不登记的话,**每一次模型调用都会在留痕里显示成「页面层事件」**,
     * 于是「是页面出问题还是模型出问题」再也分不开。
     */
    const classify = strip(read('src/platform/main/ipc/web-console-classify.ts'));
    expect(classify, 'execute 没登记 LAYER_OF —— 会被盖上 web.page 的戳')
      .toMatch(/execute\s*:\s*'exec'/);
  });

  it('⭐⭐ exec 层的留痕不许记到 X 头上(改版探测器会说谎)', () => {
    /**
     * `capability` 是「按站点统计格式外计数」用的 —— 那是**改版探测器**。
     * 把模型调用失败记成 'x',会让探测器谎报「X 改版了」,
     * 引人去改没坏的代码(同族:project-x-inject-template-escape)。
     */
    const classify = strip(read('src/platform/main/ipc/web-console-classify.ts'));
    expect(classify, "capability 仍写死 'x' —— exec 的失败会被算到 X 的改版统计里")
      .toMatch(/layer\s*===\s*'exec'\s*\?/);
  });

  it('⭐⭐ execute handler 不做页面解析(执行者没有页面)', () => {
    /**
     * 别的能力开头都是 `resolvePage(p.wcId)`。执行者硬塞 pageId 会造出
     * 一个**永远没有意义的字段** —— 本仓库最常见的假字段形态。
     */
    const start = handler.indexOf("IPC_CHANNELS.WEBC_EXECUTE");
    expect(start, '找不到 execute handler').toBeGreaterThan(0);
    const end = handler.indexOf('ipcMain.handle', start + 10);
    const body = handler.slice(start, end > 0 ? end : undefined);
    expect(body.length, '切出来的 handler 体是空的 —— 断言会空转').toBeGreaterThan(200);
    expect(body, 'execute 里出现了 resolvePage —— 执行者不该有页面').not.toContain('resolvePage');
  });
});


describe('⭐⭐ 两套留痕:能力健康 vs 执行审计,不许合并', () => {
  const handlerSrc = handler;

  it('⭐⭐ recordRun 同时喂 planTrace 与 recordStep', () => {
    /**
     * 两者答的不是同一个问题:
     *   web.trace     「这个**能力**健康吗」—— 聚合、算成功率、**滚动丢弃**
     *   flow_step_run 「这次**执行**做了什么」—— 一步一行、带来历、**只增不改**
     *
     * 合并的后果:审计记录跟着 trace 的保留策略被丢掉,
     * 而审计的意义正在于「过很久还查得到」。
     */
    const i = handlerSrc.indexOf('function recordRun(');
    expect(i, '找不到 recordRun').toBeGreaterThan(0);
    const body = handlerSrc.slice(i, handlerSrc.indexOf('const WEBC_COUNT', i));
    expect(body.length, '切出来的 recordRun 是空的 —— 断言会空转').toBeGreaterThan(300);

    /**
     * ⚠️⚠️ 初版写的是 `.toMatch(/recordStep\(/)` —— 注入 `void 0 && recordStep(...)`
     * (**调用永不执行**)时仍然全绿:文本还在,行为没了。
     * ⭐ **源码扫描永远回答不了「这行会不会执行」**。
     * 「有没有真的调」已挪到行为测试 `tests/flow/record-run-feeds-both.test.ts`;
     * 这里只钉「调用没有被短路运算符掐掉」这个源码层面还看得出的形态。
     */
    expect(body, '没喂执行记录 —— 追溯是空的').toMatch(/(?<![&|]\s)\bvoid recordStep\(/);
    expect(body, 'recordStep 被短路掉了(文本在、永不执行)')
      .not.toMatch(/(?:&&|\|\||\?)\s*recordStep\(/);
    expect(body, '没喂能力留痕 —— 站点改版探测器失灵').toMatch(/planTrace\(/);
  });

  it('⭐⭐ 没有上下文时**不写** flow 记录(不硬造假 run)', () => {
    /**
     * 面板上手点一个 goto 不属于任何流程。硬造一个 run 会让 flow_run
     * 堆满「一步的流程」,把真正的执行淹掉 —— 等于把追溯能力自己稀释掉。
     */
    const i = handlerSrc.indexOf('function recordRun(');
    const body = handlerSrc.slice(i, handlerSrc.indexOf('const WEBC_COUNT', i));
    expect(body, 'ctx 不是可选的 / 没有「没上下文就不写」的判断')
      .toMatch(/if\s*\(\s*ctx\s*\)/);
  });

  it('⭐⭐ 未登记 step_type 的能力要吭声,不猜一个', () => {
    /**
     * 猜一个分类会让审计数据从一开始就是脏的,而脏在哪儿看不出来。
     */
    const i = handlerSrc.indexOf('function recordRun(');
    const body = handlerSrc.slice(i, handlerSrc.indexOf('const WEBC_COUNT', i));
    expect(body, '没登记分类时静默跳过了 —— 应当 warn').toMatch(/console\.warn/);
  });

  it('⭐ 每个已注册通道的能力都登记了 step_type', () => {
    // 漏登记 = 那个能力永远不进执行记录,而且只有 warn 一行
    const m = handlerSrc.match(/const STEP_TYPE_OF[^=]*=\s*\{([\s\S]*?)\};/);
    expect(m, '找不到 STEP_TYPE_OF').not.toBeNull();
    const registered = new Set(
      Array.from(m![1].matchAll(/(\w+)\s*:/g)).map((x) => x[1]),
    );
    // 从 preload 的方法名反推面板能跑哪些能力(真表,不抄一份)
    const called = Array.from(handlerSrc.matchAll(/recordRun\(\s*'(\w+)'/g))
      .map((x) => x[1]);
    expect(called.length, '一个 recordRun 调用都没抓到 —— 断言会空转').toBeGreaterThan(5);
    const missing = [...new Set(called)].filter((c) => !registered.has(c));
    expect(missing, '这些能力没登记 step_type,不会进执行记录:\n  ' + missing.join('\n  '))
      .toEqual([]);
  });
});


describe('⭐⭐ 早返回也要落痕 —— 最需要诊断的情况不能是留痕盲区', () => {
  /**
   * ── 用户 2026-09-18 实测暴露 ──
   *
   * 用户点「探内存」按钮没反应,**留痕里一条记录都没有** ——
   * 我据此断言「你没点」,而用户截图证明按钮在、也点了。
   * ⚠️ 我用**有缺陷的观测**否定了用户的**直接陈述**。
   *
   * 真因:全仓 10 处早返回写成
   *   `if ('error' in r) return { channelOk: false, error: r.error };`
   * —— 解析不到页面就直接返回,不落痕。
   * 于是「点了没反应」这种最该有诊断的情况,偏偏留痕全空。
   *
   * ⚠️ 同族:本会话已栽过一次(bindPageHost 的早返回漏绑)。
   * **「早返回」是留痕的天然盲区** —— return 之前没记的,事后都查不到。
   */
  it('⭐⭐ 不许出现「解析失败直接返回、不落痕」的早返回', () => {
    const bare = [
      /if\s*\('error'\s+in\s+r\)\s*return\s*\{\s*channelOk:\s*false/,
      /if\s*\('error'\s+in\s+page\)\s*return\s*\{\s*channelOk:\s*false/,
    ];
    for (const re of bare) {
      expect(
        handler,
        '有早返回没落痕 —— 「点了没反应」时留痕会是空的,而那正是最需要诊断的时候\n'
        + '(改用 failFast(fn, reason, t0),它会先 recordRun 再返回)',
      ).not.toMatch(re);
    }
  });

  it('⭐⭐ failFast 本身必须真的落痕', () => {
    const i = handler.indexOf('function failFast(');
    expect(i, '找不到 failFast').toBeGreaterThan(0);
    const body = handler.slice(i, handler.indexOf('\n}', i));
    expect(body.length, '切出来的 failFast 是空的 —— 断言会空转').toBeGreaterThan(80);
    expect(body, 'failFast 没调 recordRun —— 那它就只是个换了名字的裸返回')
      .toMatch(/recordRun\(/);
    // ⭐ 不许被短路掉(今天刚栽过:void 0 && recordStep(...) 文本在、行为没了)
    expect(body, 'recordRun 被短路掉了(文本在、永不执行)')
      .not.toMatch(/(?:&&|\|\||\?)\s*recordRun\(/);
  });

  it('⭐ 每个 failFast 调用都给了真实能力名(不是占位符)', () => {
    const calls = Array.from(handler.matchAll(/failFast\(\s*'([^']*)'/g)).map((m) => m[1]);
    expect(calls.length, '一个 failFast 调用都没有 —— 断言会空转').toBeGreaterThan(5);
    const bad = calls.filter((c) => !c || /^__|placeholder|TODO/i.test(c));
    expect(bad, `这些 failFast 用了占位符能力名:${bad.join('、')}`).toEqual([]);
    // 能力名必须登记过 step_type,否则那条留痕进不了执行记录
    const m = handler.match(/const STEP_TYPE_OF[^=]*=\s*\{([\s\S]*?)\};/);
    const registered = new Set(Array.from(m![1].matchAll(/(\w+)\s*:/g)).map((x) => x[1]));
    const unknown = [...new Set(calls)].filter((c) => !registered.has(c));
    expect(unknown, `failFast 用了未登记 step_type 的能力名:${unknown.join('、')}`).toEqual([]);
  });
});
