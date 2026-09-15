/**
 * ⭐⭐ Web 能力层控制台 —— 逐个原子能力单独跑,看**原样返回值**(dev-only)
 *
 * 用户 2026-09-15 拍板:
 * > 「先拆解,最后才是流程联调。」
 * > 「做一个函数测试面板,对函数的执行结果可看到,可验证才行。」
 * > 「抽象好函数,原子性操作很重要,这是业务编排的基础。」
 *
 * 分类按契约原文(`01-contract.md:15`):**控制 / 输入 / 输出**,
 * 不另立一套词汇。
 *
 * ── ⚠️ 两个「成不成」是两回事,字段名必须分开 ──
 *
 * `channelOk`  = **通道层**:IPC 通不通、页面找没找到、参数合不合法
 * `result`     = **能力层**的三态(`ok` / `failed` / `degraded`)
 *
 * 初版两个都叫 `ok`,于是面板上出现 `ok:true` 配 `status:"failed"` ——
 * 用户第一次看就说「读起来别扭」。同一屏两个不同的问题用同一个词,
 * 是让人把「通道通了」误读成「能力成了」的最短路径。
 *
 * ── 三条设计红线 ──
 *
 * ① ⭐ **一能力一通道**,绝不做「求值任意脚本」的万能通道。
 *    那等于把 `web.dom` 费力关掉的注入口重新打开
 *    (`project-x-inject-template-escape`:模板字面量吃掉转义 → 采集恒 0 一整天)。
 *
 * ② ⭐ **原样返回三态 `Result`**,不压成成功/失败两态。
 *    `Degraded`(做了但不完整)必须能被人看见 —— 把它当成功是
 *    「滚了个寂寞却报成功」,当失败会丢掉已滚出的进度。
 *
 * ③ ⭐ **pageId 不透明**:面板只传 `wcId`,pageId 由主侧用 `xPageId` 取。
 *    让面板构造/解析 pageId 会复活 `targetWcId` 那套身份透传
 *    (不变量 3,记忆 `project-ws-instance-isolation-invariant`)。
 *
 * ── dev-only ──
 * 本文件放在 `ipc/` 而**不是** `web-capability/` —— 它是能力层的**消费者**,
 * 要 import X(拿 pageId / 解析 webContents / X 的锚点脚本)。
 * ⚠️ 初版我放进了 `web-capability/`,当场被自己刚写的 `layering-direction` 守卫逮住:
 * 能力层 import 业务层 = 底座离开业务就不能构建。守卫写对了,位置放错了。
 *
 * `initIpcBus` 里按 `!app.isPackaged` 决定注册与否(沿用 `auth-config.ts` 的口径)。
 * 生产构建下这些通道**根本不存在**,面板那侧也会被 Vite dead-code 掉。
 */

import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import {
  controlEngine, inputEngine, listAnchorOwners, listAnchorNames, traceRecorder, traceSink,
} from '../web-capability/wiring/runtime';
import { listBoundPages } from '../web-capability/wiring/page-hosts';
import { xPageId } from '../x/x-net-capture';
import { resolveXWebContents } from '../x/x-webcontents';
import { READ_APP_TAB_BAR } from '../x/x-anchors';
import type { PageId } from '../web-capability/page/types';
import type { AnchorName, ScriptId } from '../web-capability/dom/types';
import type { ReadyCriterion, ScrollStop, ScrollOptions } from '../web-capability/page/control-types';

/** 解析出「当前这个 X 页面」的 pageId。拿不到就如实说,不猜 */
function resolvePage(wcId: unknown): { pageId: PageId } | { error: string } {
  const id = typeof wcId === 'number' ? wcId : undefined;
  const r = resolveXWebContents(id);
  if ('error' in r) return { error: r.error };
  return { pageId: xPageId(r.wc) };
}

/**
 * ⚠️ 面板传来的是普通 string,这里转成 branded type。
 *
 * 这是**合法的转换点** —— IPC 边界本就是「外部字符串进入类型世界」的关口,
 * 与 `ai-scripts.ts` 把脚本 id 常量 `as ScriptId` 同理。
 * 真正的保护在后面:锚点解释不出来 → `AnchorResolver.resolve` 返 null → Failed。
 */
const asAnchor = (v: unknown): AnchorName => String(v ?? '') as AnchorName;


/**
 * 把三态里的「为什么」摘出来打进日志。
 *
 * ⚠️ `failed` 有两种成因,现象长得一模一样但排查方向相反:
 *   · 锚点没登记 → 契约违反,改锚点表
 *   · 等不到     → 页面状态,改等待时机
 * 只打 `status` 的话这两种在日志里无法区分。
 * `degraded` 的 `missing` 同理 —— 不打出来就等于没报。
 */
function describeWhy(r: { status: string; reason?: string; missing?: readonly string[] }): string {
  if (r.status === 'failed') return ` —— ${r.reason ?? '(无原因,这本身是 bug)'}`;
  if (r.status === 'degraded') return ` —— 缺: ${(r.missing ?? []).join(', ')}`;
  return '';
}

/**
 * ⭐⭐ 每次调用都**落一条可读回的痕**。
 *
 * 用户 2026-09-15:「这些数据应该记录到 log,这样你直接读取,
 * 未来可能需要遥测的这些能力来发现并迭代 app。」
 *
 * ⚠️ console.log 进程一关就没了,替代不了「我直接读取」——
 * 所以走 `web.trace`(已落盘,见 `fs-trace-sink.ts`),而不是另造一套日志。
 *
 * 映射:
 *  · `ok`       → recovery(outcome: 'recovered')  —— 成功也要记,否则算不出成功率
 *  · `degraded` → degradation(category: 'unexpected-format')
 *  · `failed`   → degradation,按原因分类:
 *      锚点解释不出来 = **契约违反**(改锚点表)
 *      其余           = **格式外**(站点改版的主要形态,可统计)
 *
 * ⚠️ 只记**能力名 / 参数摘要 / 原因 / 耗时**,不记页面正文 ——
 * 底座不内置过滤规则(§4.4),所以「记多少」是这里(调用方)的选择。
 */
/**
 * ⚠️ 按**能力真正所属的层**归类,不是「都算 web.page」。
 * 归错层会让 `countByCapability` 与将来任何按层的查询直接说谎 ——
 * 遥测里一条归错的记录比没有更坏。
 */
const LAYER_OF: Record<string, 'web.page' | 'web.input'> = {
  ready: 'web.page',
  scrollUntil: 'web.page',
  tap: 'web.input',
  press: 'web.input',
  hover: 'web.input',
  type: 'web.input',
};

function recordRun(
  fn: string,
  params: unknown,
  result: { status: string; reason?: string; missing?: readonly string[] },
  elapsedMs: number,
): void {
  const layer = LAYER_OF[fn] ?? 'web.page';
  const inputRef = `${fn}:${JSON.stringify(params).slice(0, 200)}`;
  const reason = result.reason ?? '';

  if (result.status === 'ok') {
    traceRecorder.recovery({
      layer, what: `console:${fn}`, outcome: 'recovered',
      detail: `${elapsedMs}ms ${inputRef}`,
    });
    return;
  }

  /**
   * ⚠️⚠️ **「等不到」不是降级** —— 2026-09-15 读真实留痕时发现的归类错误。
   *
   * 初版把所有 failed 都记成 degradation,且非锚点错一律 `unexpected-format`。
   * 于是「anchorGone 等推文消失、推文一直在」这种**完全正常的否定结果**
   * 被记成了「格式外」。而 `countByCapability('unexpected-format')` 正是
   * **站点改版探测器**(§3.3:某 adapter 格式外计数突然上升 = 那个站改版了)——
   * 拿正常超时去喂它,等 X 真改版时指标早被顶高,涨上去也看不出来。
   *
   * ⭐ 判据不是「失败了吗」,而是「**这次失败说明系统坏了吗**」:
   *  · 锚点解释不出来 → 契约违反(锚点表该改)      → degradation
   *  · 注入一直抛到超时 → 资源失败(页面/通道有问题)  → degradation
   *  · 纯粹没等到      → **正常的否定结果**          → recovery(failed),不污染指标
   */
  const isAnchorMiss = reason.includes('无法解释成 selector');
  const hadInjectionError = reason.includes('最后一次注入异常');

  if (!isAnchorMiss && !hadInjectionError && result.status === 'failed') {
    // 「问了,答案是否定的」—— 记事实,但不记成降级
    traceRecorder.recovery({
      layer, what: `console:${fn}`, outcome: 'failed',
      detail: `${elapsedMs}ms ${inputRef} —— ${reason}`,
    });
    return;
  }

  traceRecorder.degradation({
    layer,
    capability: 'x',
    operation: `console:${fn}`,
    category: isAnchorMiss
      ? 'contract-violation'
      : hadInjectionError
        ? 'resource-failure'
        : 'unexpected-format',
    reason: result.status === 'degraded'
      ? `缺: ${(result.missing ?? []).join(', ')}`
      : (reason || '(无原因)'),
    inputRef,
    rawSnippet: `${elapsedMs}ms`,
  });
}

export function registerWebConsoleHandlers(): void {
  if (app.isPackaged) {
    // 生产构建不注册 —— 控制台是排查工具,不是用户功能
    return;
  }

  // ── 控制(web.page / web.input 的动作)──────────────────────────

  /** 等页面到位。⚠️ 超时是 Failed,不是 Ok —— 「等不到」就是没等到 */
  ipcMain.handle(IPC_CHANNELS.WEBC_READY, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; criterion?: unknown; timeoutMs?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return { channelOk: false, error: page.error };

    const raw = (p.criterion ?? {}) as Record<string, unknown>;
    let criterion: ReadyCriterion;
    switch (raw.kind) {
      case 'anchorAppears':
      case 'anchorGone':
        criterion = { kind: raw.kind, anchor: asAnchor(raw.anchor) };
        break;
      case 'urlIncludes':
        criterion = { kind: 'urlIncludes', fragment: String(raw.fragment ?? '') };
        break;
      case 'custom':
        criterion = { kind: 'custom', script: String(raw.script ?? '') as ScriptId };
        break;
      default:
        return { channelOk: false, error: `未知判据 kind: ${JSON.stringify(raw.kind)}` };
    }

    const timeoutMs = typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined;
    // ⭐ 计时:`ready` 的判定常常**全在耗时上** ——
    //    「等满 6s 才 failed」与「立刻 failed」是两件完全不同的事,
    //    前者说明轮询在工作,后者说明第一次没命中就放弃了。
    //    ⚠️ 只打 status 不打耗时 = 把最关键的那一半留在人的印象里
    //    (用户 2026-09-15:「在后台能够 log 这些操作,而不是靠我口头描述」)。
    const t0 = Date.now();
    const result = await controlEngine.ready(page.pageId, criterion, timeoutMs);
    const readyMs = Date.now() - t0;
    console.log(`[web-console] ready ${JSON.stringify(criterion)} → ${result.status}`
      + ` (${readyMs}ms)${describeWhy(result)}`);
    recordRun('ready', criterion, result, readyMs);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  /** 滚动直到判据。⭐ 返回 ScrollReport:每轮的 scrollY / stuck / 是否滚的内部容器 */
  ipcMain.handle(IPC_CHANNELS.WEBC_SCROLL_UNTIL, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; stop?: unknown; options?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return { channelOk: false, error: page.error };

    const raw = (p.stop ?? {}) as Record<string, unknown>;
    let stop: ScrollStop;
    switch (raw.kind) {
      case 'atBottom': stop = { kind: 'atBottom' }; break;
      case 'rounds': stop = { kind: 'rounds', n: Number(raw.n ?? 1) }; break;
      case 'anchorAppears': stop = { kind: 'anchorAppears', anchor: asAnchor(raw.anchor) }; break;
      case 'custom': stop = { kind: 'custom', script: String(raw.script ?? '') as ScriptId }; break;
      default: return { channelOk: false, error: `未知停止判据 kind: ${JSON.stringify(raw.kind)}` };
    }

    const t0 = Date.now();
    const result = await controlEngine.scrollUntil(
      page.pageId, stop, (p.options ?? {}) as ScrollOptions,
    );
    const scrollMs = Date.now() - t0;
    console.log(`[web-console] scrollUntil ${JSON.stringify(stop)} → ${result.status}`
      + ` (${scrollMs}ms)${describeWhy(result)}`);
    recordRun('scrollUntil', stop, result, scrollMs);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  /** 点一个锚点。⚠️ `settled` 没给 settle 时恒 false —— 「没等」不算「等到了」 */
  ipcMain.handle(IPC_CHANNELS.WEBC_TAP, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; anchor?: unknown; settle?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return { channelOk: false, error: page.error };

    const s = (p.settle ?? null) as Record<string, unknown> | null;
    const t0 = Date.now();
    const result = await inputEngine.tap(page.pageId, {
      anchor: asAnchor(p.anchor),
      settle: s
        ? {
            anchorAppears: s.anchorAppears ? asAnchor(s.anchorAppears) : undefined,
            anchorGone: s.anchorGone ? asAnchor(s.anchorGone) : undefined,
            timeoutMs: typeof s.timeoutMs === 'number' ? s.timeoutMs : undefined,
          }
        : undefined,
    });
    console.log(`[web-console] tap ${String(p.anchor)} → ${result.status}${describeWhy(result)}`);
    recordRun('tap', { anchor: p.anchor }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  /** 按键(Escape / Enter …)。底座不解释语义 */
  ipcMain.handle(IPC_CHANNELS.WEBC_PRESS, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; key?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return { channelOk: false, error: page.error };
    const t0 = Date.now();
    const result = await inputEngine.press(page.pageId, { key: String(p.key ?? '') });
    console.log(`[web-console] press ${String(p.key)} → ${result.status}${describeWhy(result)}`);
    recordRun('press', { key: p.key }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  ipcMain.handle(IPC_CHANNELS.WEBC_HOVER, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; anchor?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return { channelOk: false, error: page.error };
    const result = await inputEngine.hover(page.pageId, { anchor: asAnchor(p.anchor) });
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  // ── 输入 ────────────────────────────────────────────────────────

  /**
   * 往锚点填文本。
   *
   * ⚠️ `check` 必须显式传 —— `{ kind:'none' }` 时 `LandingReport.landed` **恒 false**,
   * 那不是 bug 而是契约:没校验就不能说「落地了」。
   * 这正是历史上「日志说注入成功、右栏框是空的」那个 bug 的形态。
   *
   * 🚦 本通道**不点发布** —— 只 focus + 填。发布闸门是业务层的规则。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_TYPE, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as {
      wcId?: unknown; anchor?: unknown; text?: unknown; check?: unknown;
    };
    const page = resolvePage(p.wcId);
    if ('error' in page) return { channelOk: false, error: page.error };

    const c = (p.check ?? { kind: 'none' }) as Record<string, unknown>;
    const check = c.kind === 'contains'
      ? { kind: 'contains' as const, fragment: String(c.fragment ?? '') }
      : c.kind === 'exact'
        ? { kind: 'exact' as const }
        : { kind: 'none' as const };

    const t0 = Date.now();
    const result = await inputEngine.type(page.pageId, {
      anchor: asAnchor(p.anchor),
      text: String(p.text ?? ''),
      check,
    });
    console.log(`[web-console] type → ${result.status}${describeWhy(result)}`);
    recordRun('type', { anchor: p.anchor }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  // ── 输出(看得见的事实)────────────────────────────────────────

  /**
   * 页面清单 —— ⭐ 人验的关键:
   * **屏幕上开着几个页面,这里就该是几行**。多一行=幽灵页面(泄漏),
   * 少一行=有页面没登记(会漏操作)。这是 AI 验不出来的。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_PAGES, async () => {
    return { channelOk: true, pages: listBoundPages().map((b) => ({ ...b, pageId: String(b.pageId) })) };
  });

  /** 已注册的锚点表 —— 免得靠记忆猜锚点名 */
  ipcMain.handle(IPC_CHANNELS.WEBC_ANCHORS, async () => {
    return { channelOk: true, owners: listAnchorOwners(), tables: listAnchorNames() };
  });

  /**
   * ⭐ 在**真页面**上读 X 左栏 tab 的 testid。
   *
   * 全仓只验证过 `AppTabBar_Profile_Link` 一个,其余 11 个没有任何离线证据。
   * 猜 selector 的代价是「未找到可点的 X」与「这个 tab 不存在」长得一模一样。
   * 所以:**先看见事实,再写进锚点表**。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_READ_TABBAR, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown };
    const id = typeof p.wcId === 'number' ? p.wcId : undefined;
    const r = resolveXWebContents(id);
    if ('error' in r) return { channelOk: false, error: r.error };
    try {
      const tabs = await r.wc.executeJavaScript(READ_APP_TAB_BAR);
      return { channelOk: true, tabs };
    } catch (err) {
      // 只写事实,不写「多半是…」——那次事故的日志就是这么误导人的
      return { channelOk: false, error: `读取失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  /**
   * ⭐ 读回留痕 —— 「你直接读取」的那一半。
   *
   * ⚠️ 同时返回**内存**与**磁盘**两份计数:两者对不上就说明落盘坏了,
   * 而那正是「记录悄悄丢了」最容易发生的地方。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_TRACE, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { sinceMs?: unknown };
    const since = typeof p.sinceMs === 'number' ? Date.now() - p.sinceMs : undefined;
    const disk = traceSink.read<{ ts: number }>('degradation', since);
    return {
      channelOk: true,
      memory: {
        degradations: traceRecorder.listDegradations({ since }),
        recoveries: traceRecorder.listRecoveries(),
        dropped: traceRecorder.droppedCounts(),
        formatDriftByCapability: traceRecorder.countByCapability('unexpected-format', since),
      },
      disk: {
        degradationCount: disk.records.length,
        badLines: disk.badLines,
        shards: traceSink.shardCounts(),
      },
    };
  });

  console.log('[web-console] dev-only 控制台已注册(10 个通道)');
}
