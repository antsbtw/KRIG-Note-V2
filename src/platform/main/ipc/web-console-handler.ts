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
  controlEngine, inputEngine, listAnchorOwners, listAnchorNames, listPageNames, resolveSemanticPage, identifySemanticPage,
  traceRecorder, traceSink,
} from '../web-capability/wiring/runtime';
import { listBoundPages } from '../web-capability/wiring/page-hosts';
import { traceRecorder as traceRec } from '../web-capability/wiring/runtime';
import { planTrace, describeWhy, type CapabilityOutcome } from './web-console-classify';
import { xPageId } from '../x/x-net-capture';
import { resolveXWebContents } from '../x/x-webcontents';
import { READ_APP_TAB_BAR, READ_VERIFIED_BADGE, PROBE_X_MEMORY } from '../x/x-anchors';
import type { PageId } from '../web-capability/page/types';
import type { AnchorName, ScriptId } from '../web-capability/dom/types';
import type { ReadyCriterion, ScrollStop, ScrollOptions } from '../web-capability/page/control-types';
import { LocalExecutor } from '../executor/local-executor';
import type { ExecuteTask, ExecuteMaterial } from '../executor/executor-types';
import { takeDossierInventory } from '../db/x-dossier-inventory';
import { autoCollect } from '../x/x-auto-collect';
import { backfillArticleBodies } from '../x/x-article-backfill';
import { PAGE_PARAMS, PAGE_LABELS } from '../x/x-pages';
import { recordStep } from '../flow/flow-run-repo';
import { deriveStep, type ExecContext, type StepType, type StepStatus } from '../flow/exec-context';

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
/**
 * ⭐ 判断与副作用分开:**判断**在 `web-console-classify.ts`(纯函数、可单独测),
 * 这里只负责把判断结果**写进** `web.trace`。
 *
 * ⚠️ 抽出去的理由不是好看 —— 是这段逻辑本会话出过三次 bug
 * (耗时写死 0 / 层归错 / 「等不到」被当成站点改版),
 * 而它当时埋在本文件里且没导出,守卫只能 grep 源码文本,**两次假绿**。
 * 现在测试直接调 `planTrace` 断言返回值。
 */
/**
 * ⭐ 能力名 → 步骤分类(与 `flow_step_run.step_type` 同一套词)。
 *
 * ⚠️ 未登记的**不猜**:返回 undefined,调用方据此不写 flow 记录。
 * 猜一个分类会让审计数据从一开始就是脏的,而脏在哪儿看不出来。
 */
const STEP_TYPE_OF: Readonly<Record<string, StepType>> = {
  goto: 'act', ready: 'act', scrollUntil: 'act',
  tap: 'act', press: 'act', hover: 'act', type: 'act',
  pages: 'fetch', anchors: 'fetch', pageNames: 'fetch',
  readTabBar: 'fetch', inventory: 'fetch', readVerified: 'fetch', probeMemory: 'fetch',
  autoCollect: 'fetch', whereAmI: 'fetch', backfillArticles: 'fetch',
  execute: 'judge',
};

/** 三态 → 步骤状态。⚠️ 能力层只会给三态,skipped/rejected 由编排层写 */
function toStepStatus(result: CapabilityOutcome): StepStatus {
  return result.status === 'ok' ? 'ok'
    : result.status === 'degraded' ? 'degraded' : 'failed';
}

/**
 * ⭐⭐ 一次调用同时喂**两套留痕** —— 它们答的不是同一个问题:
 *
 *   `web.trace`      「这个**能力**健康吗」—— 按层聚合、算成功率、探测站点改版、滚动丢弃
 *   `flow_step_run`  「这次**执行**做了什么」—— 一步一行、带来历、只增不改、可回放
 *
 * ⚠️ **不合并**:合并会让审计记录跟着 trace 的保留策略被丢掉,
 * 而审计的意义正在于「过很久还查得到」。
 *
 * ⚠️ `ctx` 是**可选**的:面板上手点一个 goto 不属于任何流程,
 * 这时**不写** flow 记录 —— 硬造一个假 run 会让 flow_run 堆满「一步的流程」,
 * 把真正的执行淹掉,那等于把追溯能力自己稀释掉。
 */
function recordRun(
  fn: string,
  params: unknown,
  result: CapabilityOutcome,
  elapsedMs: number,
  ctx?: ExecContext & { seq: number; stepId?: string },
): void {
  // ── ② 执行记录(只在属于某次流程时写)──
  if (ctx) {
    const stepType = STEP_TYPE_OF[fn];
    if (!stepType) {
      // fail loud:新增能力忘了登记分类,审计数据会缺一块
      console.warn(`[web-console] 能力 ${fn} 没登记 step_type —— 本步不进执行记录`);
    } else {
      const step = deriveStep(ctx, {
        seq: ctx.seq, stepId: ctx.stepId ?? fn, stepType, capability: fn,
      });
      void recordStep(step, {
        status: toStepStatus(result),
        input: params as Record<string, unknown>,
        missing: result.status === 'degraded' ? result.missing : undefined,
        reasoning: result.reason,
        durationMs: elapsedMs,
      });
    }
  }

  // ── ① 能力健康留痕(照旧,与上面互不影响)──
  const plan = planTrace(fn, params, result, elapsedMs);
  if (plan.kind === 'recovery') {
    traceRecorder.recovery({
      layer: plan.layer, what: plan.what, outcome: plan.outcome, detail: plan.detail,
    });
    return;
  }
  traceRecorder.degradation({
    layer: plan.layer,
    capability: plan.capability,
    operation: plan.operation,
    category: plan.category,
    reason: plan.reason,
    inputRef: plan.inputRef,
    rawSnippet: plan.rawSnippet,
  });
}

/**
 * ⭐⭐ 解析失败**也要落痕** —— 这恰恰是最需要诊断的情况。
 *
 * ── 用户 2026-09-18 实测暴露 ──
 *
 * 用户点「探内存」按钮,面板没反应,而**留痕里一条记录都没有** ——
 * 于是我据此断言「你没点」,而用户截图证明按钮就在那儿、也点了。
 * ⚠️ 我用**有缺陷的观测**去否定用户的**直接陈述**,这是今天最糟的一次。
 *
 * 真因:全仓 **10 处**早返回长这样:
 *   `if ('error' in r) return { channelOk: false, error: r.error };`
 * —— 解析不到页面就直接返回,**不落痕**。
 * 所以「点了没反应」这种最该有诊断的情况,偏偏是留痕全空的情况。
 *
 * ⚠️ 同族:本会话已栽过一次(bindPageHost 的早返回漏绑)。
 * 「早返回」是留痕的天然盲区 —— 凡是 return 之前没记的,都查不到。
 */
/**
 * ⭐⭐ 快速失败 —— **入参要落痕**。
 *
 * ⚠️ 原来第二个参数写死 `{}`,于是**失败那次的入参查不到** ——
 * 用户 2026-09-20 实测:x.status 报「参数不全」,而留痕里
 * 只有 `{page, maxRounds, …}` 没有 params,我据此推断「参数没传到后端」,
 * **那个推断是错的** —— 参数传了,只是 failFast 不记。
 *
 * ⭐ 最需要诊断的恰恰是失败那次,而它偏偏是留痕最空的一次。
 * 这与本文件下面那段注释说的「早返回是留痕的天然盲区」是同一件事。
 */
function failFast(
  fn: string, reason: string, t0: number, input?: unknown,
): { channelOk: false; error: string } {
  recordRun(fn, input ?? {}, { status: 'failed', reason }, Date.now() - t0);
  return { channelOk: false, error: reason };
}

/**
 * 注册的通道数 —— 与下面 ipcMain.handle 的条数一致。
 *
 * ⚠️ **加通道必须改这个数**(守卫 web-console-wiring-complete 会当场抓)——
 * 它只出现在启动日志里,漂了不会有任何报错,日志就开始说假话。
 * 2026-09-22 加「补长文正文」时 18 → 19。
 */
const WEBC_COUNT = 19;

export function registerWebConsoleHandlers(): void {
  if (app.isPackaged) {
    // 生产构建不注册 —— 控制台是排查工具,不是用户功能
    return;
  }

  // ── 控制(web.page / web.input 的动作)──────────────────────────

  /**
   * ⭐⭐ 语义导航(§9.3)。
   *
   * ⚠️ 面板传**语义名 + 参数**,不传 URL —— URL 是 adapter 的知识。
   * 站点改版时变的是 `x-pages.ts`,面板一个字不用改。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_GOTO, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; name?: unknown; params?: unknown; timeoutMs?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return failFast('goto', page.error, Date.now());

    const name = String(p.name ?? '');
    if (!name) return { channelOk: false, error: '语义页面名必填' };
    const params = (p.params ?? {}) as Record<string, string>;
    const timeoutMs = typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined;

    const t0 = Date.now();
    const result = await controlEngine.goto(
      page.pageId, { kind: 'semantic', name, params }, { readyTimeoutMs: timeoutMs },
    );
    /**
     * ⚠️ 带上 `GotoReport` 的事实(落在哪 / 耗时 / loadURL 有没有 reject)——
     * 只记 `recovered` 就答不了「到底去到哪一页」,
     * 那是本会话犯过三次的同一个错(readTabBar 的 testid、耗时写死 0、type 的 landed)。
     */
    const report = result.status === 'ok'
      ? (result.value as { landedUrl: string; elapsedMs: number; loadRejected?: string })
      : undefined;
    console.log(`[web-console] goto ${name} → ${result.status}${describeWhy(result)}`
      + (report ? ` landed=${report.landedUrl}` : ''));
    recordRun('goto', { name, params, ...(report ?? {}) }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  /** 等页面到位。⚠️ 超时是 Failed,不是 Ok —— 「等不到」就是没等到 */
  ipcMain.handle(IPC_CHANNELS.WEBC_READY, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; criterion?: unknown; timeoutMs?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return failFast('ready', page.error, Date.now());

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
    if ('error' in page) return failFast('scrollUntil', page.error, Date.now());

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
    if ('error' in page) return failFast('tap', page.error, Date.now());

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
    // ⚠️ 同 type:`settled`/`waited` 在 result.value 里,不带上就答不了「等到了没」
    const tapReport = result.status === 'ok' || result.status === 'degraded'
      ? (result.value as { settled: boolean; waited: boolean })
      : undefined;
    console.log(`[web-console] tap ${String(p.anchor)} → ${result.status}${describeWhy(result)}`
      + (tapReport ? ` settled=${tapReport.settled} waited=${tapReport.waited}` : ''));
    recordRun('tap', { anchor: p.anchor, ...(tapReport ?? {}) }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  /** 按键(Escape / Enter …)。底座不解释语义 */
  ipcMain.handle(IPC_CHANNELS.WEBC_PRESS, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; key?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return failFast('press', page.error, Date.now());
    const t0 = Date.now();
    const result = await inputEngine.press(page.pageId, { key: String(p.key ?? '') });
    console.log(`[web-console] press ${String(p.key)} → ${result.status}${describeWhy(result)}`);
    recordRun('press', { key: p.key }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  ipcMain.handle(IPC_CHANNELS.WEBC_HOVER, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown; anchor?: unknown };
    const page = resolvePage(p.wcId);
    if ('error' in page) return failFast('hover', page.error, Date.now());
    const t0 = Date.now();
    const result = await inputEngine.hover(page.pageId, { anchor: asAnchor(p.anchor) });
    console.log(`[web-console] hover ${String(p.anchor)} → ${result.status}${describeWhy(result)}`);
    recordRun('hover', { anchor: p.anchor }, result, Date.now() - t0);
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
    if ('error' in page) return failFast('type', page.error, Date.now());

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
    /**
     * ⚠️⚠️ **`LandingReport` 必须进留痕**(2026-09-15,同一通道第三次丢事实)。
     *
     * `recordRun` 只收 `{status, reason, missing}` —— 而 `landed` / `via` / `attempts`
     * 在 `result.value` 里。于是留痕只写得出 `recovered`,
     * **答不了「文字到底进框了没有」** —— 而那正是本通道存在的唯一理由
     * (历史 bug:日志说注入成功、右栏框是空的)。
     *
     * ⭐ `attempts > 1` 更是契约里写明的「站点改版早期信号」:
     * 主路径(合成 paste)失效、靠 OS 粘贴兜底成功 —— 结果仍是 ok,
     * 不记下来就**看不见劣化**,直到某天两条路一起失效才发现。
     */
    const landing = result.status === 'ok' || result.status === 'degraded'
      ? (result.value as { checked: boolean; landed: boolean; via: string; attempts: number })
      : undefined;
    console.log(`[web-console] type → ${result.status}${describeWhy(result)}`
      + (landing ? ` landed=${landing.landed} via=${landing.via} attempts=${landing.attempts}` : ''));
    recordRun('type', { anchor: p.anchor, ...(landing ?? {}) }, result, Date.now() - t0);
    return { channelOk: true, pageId: String(page.pageId), result };
  });

  // ── 输出(看得见的事实)────────────────────────────────────────

  /**
   * 页面清单 —— ⭐ 人验的关键:
   * **屏幕上开着几个页面,这里就该是几行**。多一行=幽灵页面(泄漏),
   * 少一行=有页面没登记(会漏操作)。这是 AI 验不出来的。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_PAGES, async () => {
    // ⚠️ 同步读表,真实耗时就是 0~1ms —— 但仍要**量**而不是写死:
    //    写死是断言「它一定很快」,量出来才是事实(守卫禁 `recordRun(..., 0)` 正为此)
    const t0 = Date.now();
    const pages = listBoundPages().map((b) => ({ ...b, pageId: String(b.pageId) }));
    // ⭐ 页面清单也落痕:「当时有几个页面」是排查采集问题的第一个问题
    recordRun('pages', { count: pages.length }, { status: 'ok' }, Date.now() - t0);
    return { channelOk: true, pages };
  });

  /** 已注册的锚点表 —— 免得靠记忆猜锚点名 */
  ipcMain.handle(IPC_CHANNELS.WEBC_ANCHORS, async () => {
    const t0 = Date.now();
    const owners = listAnchorOwners();
    const tables = listAnchorNames();
    const total = tables.reduce((n, t) => n + t.names.length, 0);
    // ⚠️ 锚点表为空是「业务没推表进来」的征兆,必须留痕 —— 否则只表现为下拉是空的
    recordRun('anchors', { owners, total },
      total > 0 ? { status: 'ok' } : { status: 'failed', reason: '锚点表为空(业务没注册?)' },
      Date.now() - t0);
    return { channelOk: true, owners, tables };
  });

  /** 已注册的语义页面名 —— ⚠️ 面板下拉必须读**真表**,抄一份就会漂 */
  ipcMain.handle(IPC_CHANNELS.WEBC_PAGE_NAMES, async () => {
    const t0 = Date.now();
    const tables = listPageNames();
    /**
     * ⭐ 连**每页要哪些参数**一起报 —— 面板据此渲染输入框。
     *
     * ⚠️ 面板原本有四处写死的正则决定「显示不显示 handle 框」,
     * 加了新页面就漏(用户 2026-09-18 实测:在 verifiedFollowers 页点采集,
     * 报「未登记」而同一句的可用清单里就有它 —— 因为 handle 没传)。
     * 清单不会自己长,所以改成从真表来。
     */
    const paramsOf = PAGE_PARAMS;
    /** ⭐ 人话页名 —— 下拉里显示「单条推文详情(含回复)」而不是 `x.status` */
    const labelsOf = PAGE_LABELS;
    const total = tables.reduce((n, t) => n + t.names.length, 0);
    recordRun('pageNames', { total },
      total > 0 ? { status: 'ok' } : { status: 'failed', reason: '语义页面表为空(业务没注册?)' },
      Date.now() - t0);
    return { channelOk: true, tables, paramsOf, labelsOf };
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
    const t0 = Date.now();
    const r = resolveXWebContents(id);
    if ('error' in r) return failFast('readTabBar', r.error, t0);
    try {
      const tabs = await r.wc.executeJavaScript(READ_APP_TAB_BAR);
      const list = Array.isArray(tabs) ? tabs as Array<{ testid?: string | null }> : [];
      const withId = list.filter((t) => t?.testid).length;
      /**
       * ⭐⭐ 这条**必须**落痕 —— 它的产出正是要喂回锚点表的事实。
       *
       * ⚠️ 用户 2026-09-15 跑过一次,而当时本通道零落痕,我读不到,
       * 只能回头问他要 —— 那正是「靠人口头描述」的复发。
       */
      /**
       * ⚠️⚠️ **testid 清单必须进留痕本身,不能只进 console.log**(2026-09-15 第二次栽)。
       *
       * 初版只记 `{found, withTestid}` 两个**计数**,真正的名字进了 console ——
       * 而 console 我读不到。于是用户跑完 `readTabBar`,留痕里写着「8 个带 testid」,
       * **8 个叫什么仍然只有他知道**。落痕的意义正是「不用回头问人」,这等于没落。
       *
       * ⚠️ 也不能塞进 `params`:`inputRef` 有 200 字上限,
       * 实测 8 个 testid 的 JSON 是 **217 字** —— 会被截断,又是一次静默丢失。
       * 故单开一条 lifecycle 记录放全量清单(lifecycle 的 `detail` 不截断)。
       */
      traceRec.lifecycle({
        layer: 'web.dom',
        event: 'x.tabbar-read',
        pageId: String(xPageId(r.wc)),
        detail: { found: list.length, withTestid: withId, tabs: list },
      });
      recordRun('readTabBar', { found: list.length, withTestid: withId },
        withId > 0
          ? { status: 'ok' }
          : { status: 'failed', reason: `读到 ${list.length} 个节点但零个带 testid(X 换了 DOM?)` },
        Date.now() - t0);
      console.log(`[web-console] readTabBar → ${withId}/${list.length} 带 testid: `
        + JSON.stringify(list.slice(0, 20)));
      return { channelOk: true, tabs };
    } catch (err) {
      const reason = `读取失败: ${err instanceof Error ? err.message : String(err)}`;
      recordRun('readTabBar', {}, { status: 'failed', reason }, Date.now() - t0);
      // 只写事实,不写「多半是…」——那次事故的日志就是这么误导人的
      return { channelOk: false, error: reason };
    }
  });

  /**
   * ⭐ 读回留痕 —— 「你直接读取」的那一半。
   *
   * ⚠️ 同时返回**内存**与**磁盘**两份计数:两者对不上就说明落盘坏了,
   * 而那正是「记录悄悄丢了」最容易发生的地方。
   */
  /**
   * ⭐⭐ 第四类:跑一次**执行者**(对象=模型,不是页面)。
   *
   * 用户 2026-09-15 定:「在 Gemma 之下都是执行者,只是对象不同而已。」
   *
   * ── 为什么这个 handler 长得跟别的不一样 ──
   *
   * 别的能力开头都是 `resolvePage(p.wcId)`,返回里带 `pageId`。
   * 执行者**没有页面** —— 它只算不存、不碰浏览器。硬塞一个 pageId 进来
   * 会造出一个「永远没有意义的字段」,那是本仓库最常见的假字段形态。
   *
   * ⭐ 也正因为它不写库,**在面板上随便跑都不会动你的数据** ——
   * 这是它与 `judgeWithOllama` 的分界线(后者一跑就改 x_tweet)。
   *
   * ⚠️ 判据(instruction)与素材(material)都由**面板给**,
   * 主侧不内置任何业务判据:「VPN 求助该不该回」与「蓝V该不该点赞」
   * 走的是同一个执行者,差别全在传进来的参数里。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_EXECUTE, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as {
      model?: unknown; instruction?: unknown; content?: unknown;
      structured?: unknown; timeoutMs?: unknown; endpoint?: unknown;
      attachments?: unknown; missing?: unknown;
    };

    const model = String(p.model ?? '').trim();
    if (!model) {
      // ⚠️ 不给默认模型 —— 默认值会让「跑的是哪个模型」在留痕里永远说不清
      return { channelOk: false, error: 'model 必填(不给默认值:否则说不清跑的是哪个模型)' };
    }

    let executor: LocalExecutor;
    try {
      executor = new LocalExecutor({
        model,
        endpoint: typeof p.endpoint === 'string' && p.endpoint ? p.endpoint : undefined,
        timeoutMs: typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined,
      });
    } catch (err) {
      return { channelOk: false, error: String((err as Error).message) };
    }

    const task: ExecuteTask = {
      kind: 'judge',
      instruction: String(p.instruction ?? ''),
      structured: p.structured === true,
    };
    /**
     * ⭐ 卷宗:主体 + 附件 + 缺了什么(用户 2026-09-17 订正的素材形状)。
     *
     * ⚠️ 面板给什么就是什么 —— 主侧**不代取附件**。
     * 取附件是另一类执行者(对象=数据库)的活,取哪几样由编排决定;
     * 在这里顺手查库会把「判断」和「取数」又焊回一起。
     */
    const material: ExecuteMaterial = {
      content: String(p.content ?? ''),
      attachments: (p.attachments ?? undefined) as Record<string, unknown> | undefined,
      missing: Array.isArray(p.missing) ? p.missing.map(String) : undefined,
    };

    const t0 = Date.now();
    const result = await executor.execute(task, material);
    const elapsedMs = Date.now() - t0;

    console.log(`[web-console] execute ${model} -> ${result.status}${describeWhy(result)} ${elapsedMs}ms`);
    // ⭐ `by` 进 params —— classify 靠它把留痕记到执行者名下,而不是记到 X 头上
    recordRun('execute', { by: String(executor.name), model, structured: task.structured },
      result as CapabilityOutcome, elapsedMs);

    return { channelOk: true, result };
  });

  /**
   * ⭐ 卷宗盘点 —— 「附件实际能取到多少」用真数字回答。
   *
   * ⚠️ **只读不写**(纯 SELECT COUNT),所以面板上随便点都不动你的数据。
   * ⚠️ 这不是执行者 —— 它不判断任何东西,只是把库里的事实摆出来,
   *    好让「卷宗能有多厚」这个问题不用靠读代码推断。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_INVENTORY, async () => {
    const t0 = Date.now();
    try {
      const inv = await takeDossierInventory();
      recordRun('inventory', { tweets: inv.tweets, authors: inv.authorsSeen },
        { status: 'ok' }, Date.now() - t0);
      return { channelOk: true, inventory: inv };
    } catch (err) {
      // fail loud:X 库没起来时要说清楚,不返回一堆 0 假装「库是空的」
      const reason = String((err as Error).message ?? err);
      recordRun('inventory', {}, { status: 'failed', reason }, Date.now() - t0);
      return { channelOk: false, error: `盘点失败(X 库没初始化?):${reason}` };
    }
  });

  /**
   * ⭐ 在**真页面**上量蓝V徽章的结构 —— 不猜 selector。
   *
   * ⚠️ 蓝V的 DOM selector 全仓**没有实测记录**,只有载荷那条路解过。
   * 与 X 左栏 12 个 tab 同理:凭记忆写会写出「看着对、其实不存在」的东西,
   * 而且采集恒空且不报错。
   *
   * ⚠️⚠️ **结构必须进留痕本身,不能只进 console.log**(readTabBar 那次栽过):
   * 用户跑完,留痕里只有计数、真正的结构进了 console —— 而 console 我读不到,
   * 又得回头问人。落痕的意义正是「不用回头问人」。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_READ_VERIFIED, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown };
    const id = typeof p.wcId === 'number' ? p.wcId : undefined;
    const t0 = Date.now();
    const r = resolveXWebContents(id);
    if ('error' in r) return failFast('readVerified', r.error, t0);
    try {
      const rows = await r.wc.executeJavaScript(READ_VERIFIED_BADGE);
      const list = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
      const withMarks = list.filter((x) => Array.isArray(x.marks) && (x.marks as unknown[]).length > 0).length;
      // ⭐ 把**真实结构**原样落进留痕,不是只记个数
      recordRun('readVerified', { rows: list.length, withMarks, sample: list.slice(0, 3) },
        list.length > 0 ? { status: 'ok' } : { status: 'failed', reason: '页面上没找到 article[data-testid=tweet]' },
        Date.now() - t0);
      return { channelOk: true, rows: list };
    } catch (err) {
      const reason = String((err as Error).message ?? err);
      recordRun('readVerified', {}, { status: 'failed', reason }, Date.now() - t0);
      return { channelOk: false, error: reason };
    }
  });

  /**
   * ⭐⭐ 探 X 页面**内存**里的 user 数据 —— 用户判断「数据缓存在内存或硬盘」。
   *
   * 磁盘已实测排除:IndexedDB 存的是 UI 偏好 + 15 万个数字 id(画像字段零命中);
   * HTTP Cache 里 X 的 API 响应带 no-store,不落盘。
   * 所以数据在页面 JS 内存里,只能在页面上下文执行 JS 去读。
   *
   * ⚠️ **只探不取**:先回答「在哪个全局变量下、结构什么样」,
   * 拿到真实结构再写提取 —— 与蓝V那次同理,量出来再写,不猜。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_PROBE_MEMORY, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown };
    const id = typeof p.wcId === 'number' ? p.wcId : undefined;
    const t0 = Date.now();
    const r = resolveXWebContents(id);
    if ('error' in r) return failFast('probeMemory', r.error, t0);
    try {
      const probe = await r.wc.executeJavaScript(PROBE_X_MEMORY);
      const found = (probe as { userObjectsFound?: unknown[] })?.userObjectsFound ?? [];
      // ⭐ 结构原样落痕 —— 不是只记个数(readTabBar 那次栽过)
      recordRun('probeMemory', { found: found.length, probe },
        found.length > 0 ? { status: 'ok' }
          : { status: 'failed', reason: '没在任何全局变量下找到 user 对象' },
        Date.now() - t0);
      return { channelOk: true, probe };
    } catch (err) {
      const reason = String((err as Error).message ?? err);
      recordRun('probeMemory', {}, { status: 'failed', reason }, Date.now() - t0);
      return { channelOk: false, error: reason };
    }
  });

  /**
   * ⭐⭐ 无人工采集 —— 用户 2026-09-18:
   * 「不用点击就有办法拿到蓝V关系……而不是我点击推文进来才可以拿。」
   *
   * 导航 + 滚动 + 解析载荷 + 入库,一次跑完,零人工操作。
   * ⚠️ 导航是**必须的** —— 关系/蓝V 在载荷里就有,但要有新请求才截得到;
   * 页面早已渲染好的推不会重新请求(实测:悬停弹卡片零网络请求)。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_AUTO_COLLECT, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as {
      wcId?: unknown; page?: unknown; params?: unknown; current?: unknown;
      maxRounds?: unknown; budgetMs?: unknown; pageBudget?: unknown; wsId?: unknown;
      fastIncremental?: unknown;
    };
    const t0 = Date.now();
    /**
     * ⚠️ 收**语义页面名**,不收 URL —— URL 是 adapter 的知识。
     * 守卫「面板不许构造 x.com URL」正为此:站点改版只改 x-pages.ts 一处。
     */
    /**
     * ⭐ 两种模式:
     *  · 给了 page → 导航到那个语义页面再采
     *  · 没给 page → **采当前页**(用户 2026-09-18:
     *    「我直接点击某个人,x 跳转到这个人的页面,点击采集,即可采集」)
     *
     * ⭐ 「要不要跳转」由**流程自己判断**(harvestTimeline 比对当前 URL):
     * 已经在目标页就不跳,省掉重新加载、不冲掉滚动位置、不白等 4.5 秒。
     * ⚠️ 不让人选「要不要导航」—— 那是把到达方式当成了不同流程。
     */
    const current = p.current === true;
    const pageName = String(p.page ?? '').trim();
    if (!current && !pageName) {
      return failFast('autoCollect', 'page 必填(语义页面名),或传 current:true 采当前页',
        t0, { page: p.page, current: p.current, params: p.params });
    }

    let url = '';
    if (!current) {
      const resolved = resolveSemanticPage(pageName,
      typeof p.params === 'object' && p.params ? p.params as Record<string, string> : {});
      if (!resolved) {
        /**
         * ⭐⭐ **解析不出来有两种原因,处置完全相反** —— 用户 2026-09-20 实测。
         *
         * 现象:选 x.status 没填 tweetId,报
         *   「未登记的页面名『x.status』—— 可用:…, x.status, …」
         * **同一句话里说它未登记、又把它列在可用清单里** ——
         * 而真因是「参数不全」,不是「名字不认识」。
         *
         * ⚠️ 同一个坑 2026-09-18 踩过一次(verifiedFollowers 没传 handle,
         * 报的也是「未登记」),那次只修了参数框渲染、**没修这条消息本身**,
         * 于是换个页面又踩一遍。
         *
         * ⭐ 判据:**页面名在不在真表里** ——
         * 在 → 是参数问题,告诉他缺哪个;不在 → 才是名字问题。
         */
        const known = listPageNames().flatMap((t) => t.names);
        if (known.includes(pageName)) {
          const need = PAGE_PARAMS[pageName] ?? [];
          const got = (typeof p.params === 'object' && p.params
            ? p.params as Record<string, string> : {});
          const missing = need.filter((k) => !String(got[k] ?? '').trim());
          /**
           * ⭐⭐ **把收到的实际值交出来** —— 用户 2026-09-20 实测踩到:
           *
           * 报「参数都有,但值不合法」却**不说是哪个值、长什么样** ——
           * 于是我连着查了解析器、preload、面板传参四处,全是对的,
           * 因为**真值根本没进过视野**。
           *
           * ⚠️ 这正是本仓「别猜、看真实数据」那条:
           * 诊断消息不带真值,等于把排查者推回去猜。
           * ⭐ 带上 JSON.stringify:空串、纯空格、零宽字符、类型不对
           * (数字而非字符串)这几种在肉眼下长得一模一样,只有 repr 分得开。
           */
          const shown = need.map((k) => `${k}=${JSON.stringify(got[k])}`).join('、');
          return failFast('autoCollect',
            `「${pageName}」的参数解析不出 URL —— 需要 ${need.join('、') || '(无)'};`
            + `**收到的值**:${shown || '(没传 params)'};`
            + `缺(空值):${missing.join('、') || '(都非空)'}。`
            + (missing.includes('tweetId')
              ? '⭐ tweetId 是推文链接 /status/ 后面那串数字'
              : missing.includes('handle')
                ? '⭐ handle 填账号名(不带 @)'
                : '⚠️ 值都非空却仍解析不出 —— 多半是格式不合法'
                  + '(tweetId 必须是纯数字,不能带 http/斜杠/零宽字符)'),
            t0, { page: pageName, params: got });
        }
        return failFast('autoCollect',
          `未登记的页面名「${pageName}」—— 可用:${known.join(', ')}`,
          t0, { page: pageName, params: p.params });
      }
      url = resolved.url;
    }

    const r = await autoCollect(url,
      typeof p.wcId === 'number' ? p.wcId : undefined,
      {
        maxRounds: typeof p.maxRounds === 'number' ? p.maxRounds : undefined,
        pageBudget: typeof p.pageBudget === 'number' ? p.pageBudget : undefined,
        /**
         * ⚠️ 预算必须跟着轮数一起放开 —— 实测 8 轮跑了 24s,
         * 而默认预算 30s。只调轮数不调预算的话,会在预算到点时停下,
         * **轮数根本用不完**,人会以为「调了没用」。
         */
        budgetMs: typeof p.budgetMs === 'number' ? p.budgetMs : undefined,
        wsId: typeof p.wsId === 'string' ? p.wsId : undefined,
        /**
         * ⭐ 顺序的归属用**语义页面名 + handle**,比 URL 稳(URL 会带 query)。
         *
         * ⚠️ **没有 handle 的页面不要留空尾巴** —— 2026-09-20 实测:
         * 采通知页存出来的 list_source 是 `x.notifications:`(冒号后面空的),
         * 因为通知页不带 handle 参数,而这里无条件拼 `:${handle ?? ''}`。
         *
         * ⭐ 通知页的归属**不是 URL 参数里的谁**,而是**该 ws 登录的账号** ——
         * 多账号时两个 ws 的通知人会混进同一个 scope,**分不开**。
         * 所以没有 handle 时退而用 wsId 标识,至少不同 ws 分得开。
         */
        pageLabel: current ? '(当前页)' : (() => {
          const h = (p.params as Record<string, string> | undefined)?.handle;
          if (h) return `${pageName}:${h}`;
          const ws = typeof p.wsId === 'string' ? p.wsId : '';
          return ws ? `${pageName}@${ws}` : pageName;
        })(),
        // ⭐ 基准对账要知道这是**谁的**列表
        ownerHandle: (p.params as Record<string, string> | undefined)?.handle,
        /**
         * ⭐⭐ 快速增量 —— 「翻到遇见已知的人就停」。
         * ⚠️ 只认**显式的 true**:传别的类型不该被 truthy 蒙混成开启,
         * 那会让一次全量悄悄变成快速增量(而且不写快照)。
         */
        fastIncremental: p.fastIncremental === true,
      });

    if ('error' in r) return failFast('autoCollect', r.error, t0);

    // ⭐ 成果原样落痕 —— 「采到多少关系数据」正是这条能力的存在理由
    /**
     * ⚠️ **覆盖率必须进留痕** —— 用户跑完后我读留痕,只看到汇总数字,
     * 而「每条完整吗」正是他要的答案,却只在面板上、我读不到,
     * 于是又得回头问人。那正是「靠口头描述」的复发(用户定过的那条)。
     *
     * ⚠️ 只记**没到 100% 的**字段:全绿的记进去只会淹没真问题。
     */
    const gaps = r.coverage
      .filter((c) => c.total > 0 && c.rate < 1)
      .map((c) => `${c.field} ${c.have}/${c.total}(${(c.rate * 100).toFixed(0)}%)`);
    const incomplete = r.sample.filter((x) => x.missing.length > 0).length;

    recordRun('autoCollect',
      { page: current ? '(当前页)' : pageName, tweets: r.tweets, fromPayload: r.fromPayload, saved: r.saved,
        authorsWithRelation: r.authorsWithRelation, authorsWithBio: r.authorsWithBio,
        // ⭐ 采人的成果 —— 这条能力的存在理由
        people: r.people, peopleWithBio: r.peopleWithBio, peopleWithRelation: r.peopleWithRelation,
        // ⭐ 长推统计排在前面 —— 留痕会截断,要紧的先写
        longText: r.longText,
        payloads: r.payloads,
        // ⭐ 完整性 —— 「每一条都完整吗」的答案
        coverageGaps: gaps,
        sampleIncomplete: `${incomplete}/${r.sample.length}`,
        // ⭐ 事实照录:滚了几轮、日期跨多少天、几处空洞 —— 不解释成「漏没漏」
        rounds: r.rounds,
        pagedRounds: r.pagedRounds,
        pagingSkipped: r.pagingSkipped,
        /** ⭐ 解析率进留痕 —— 「X 给的接住了吗」日后回看要查得到 */
        parseRate: r.parseRate
          ? `${r.parseRate.parsed}/${r.parseRate.entries}`
            + `(${r.parseRate.rate !== undefined ? (r.parseRate.rate * 100).toFixed(0) : '?'}%)`
          : undefined,
        failedUrl: r.failedUrl,
        capturedUrl: r.capturedUrl,
        // ⭐ 「采完没有」进留痕 —— 全量/增量的第一个问题
        hasMore: r.paging.hasMore,
        /**
         * ⭐⭐ 快速增量进留痕 —— **`caughtUp` 是能不能信这个数的判据**。
         * ⚠️ 没追上却只留个「新增 3 人」,日后回看会把残缺当成事实。
         */
        fast: r.fast
          ? `新增${r.fast.newcomers.length}`
            + `(基线${r.fast.knownBaseline}`
            + `,${r.fast.caughtUp ? '已追上' : '**没追上**'}`
            + `,距上次全量${r.fast.daysSinceFullRun ?? '?'}天)`
          : undefined,
        // ⭐ 基准对账 —— 「采够了没有」从猜变成算
        /**
         * ⚠️ 别写成 `241/?` —— 那看着像「查不到基准」,
         * 而 verifiedFollowers 其实是**没有基准概念**(X 不单独报蓝V关注者数)。
         * 两者处置不同:前者要去补数据,后者什么都不用做。
         */
        reconcile: r.reconcile
          ? (r.reconcile.baseline !== undefined
              ? `${r.reconcile.got}/${r.reconcile.baseline}`
              : `${r.reconcile.got}(无基准:${r.reconcile.note.slice(0, 40)})`)
          : undefined,
        dateDays: r.dateSpan.days,
        dateGaps: r.dateSpan.gaps.length,
        notes: r.notes,
        // ⚠️ 只记**操作名与大小**,body 不进留痕(几 KB × N 会把留痕撑爆);
        //    完整 body 在面板上看,那才是量结构的地方
        unparsed: r.unparsedSamples.map((x) => `${x.op}(${x.bytes}B)`),
        // ⭐ 全部操作名进留痕 —— 我读得到就不用回头问人「那个请求发没发生」
        seenOps: r.seenOps.map((x) => `${x.op}:${x.bytes}`),
      },
      r.problems.length === 0 ? { status: 'ok' }
        : { status: 'degraded', missing: r.problems },
      r.elapsedMs);
    return { channelOk: true, report: r };
  });

  /**
   * ⭐⭐ 长文正文逐篇补全 —— 把「只有标题+摘要」的长文补成全文。
   *
   * ── 依据(2026-09-22 同账号三入口实测)──
   * 正文**只在单篇详情页**(`TweetDetail`)的载荷里;
   * 列表页(`UserArticlesTweets`)和主页(`UserOriginalsTimeline`)都只给标题+摘要。
   * 这是 X 的设计,不是 bug —— 要全文就必须逐篇进详情页。
   *
   * ⚠️ **手动触发、小批上限**(用户 2026-09-22 拍板):
   * 逐篇导航最容易被限流,所以**不**跟在采集后面自动跑 ——
   * 两件事缠在一起,出事时分不清是谁的问题。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_BACKFILL_ARTICLES, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as {
      wcId?: unknown; limit?: unknown; wsId?: unknown; budgetMs?: unknown; handle?: unknown;
    };
    const t0 = Date.now();
    try {
      const r = await backfillArticleBodies(
        typeof p.wcId === 'number' ? p.wcId : undefined,
        {
          limit: typeof p.limit === 'number' ? p.limit : undefined,
          wsId: typeof p.wsId === 'string' ? p.wsId : undefined,
          budgetMs: typeof p.budgetMs === 'number' ? p.budgetMs : undefined,
          handle: typeof p.handle === 'string' ? p.handle : undefined,
        },
      );
      /**
       * ⭐ 成果落痕 —— 每篇的 `字数前→后` 是这条能力唯一的成败判据。
       * ⚠️ 「尝试了 N 篇」不等于「补上了 N 篇」:`withBody` 与 `saved` 分开记,
       *    采到了但写库炸了必须看得出来。
       */
      recordRun('backfillArticles',
        {
          candidates: r.candidates, attempted: r.attempted,
          withBody: r.withBody, saved: r.saved,
          /** ⭐ 逐篇字数变化 —— 「下次验证不靠人」靠的就是这一行 */
          lens: r.items.map((i) => `${i.tweetId}:${i.lenBefore}→${i.lenAfter ?? '?'}`
            + (i.gotBody ? '✓' : '✗')),
          journalPath: r.journalPath,
          notes: r.notes,
        },
        r.problems.length === 0 ? { status: 'ok' }
          : { status: 'degraded', missing: r.problems },
        r.elapsedMs);
      return { channelOk: true, report: r };
    } catch (err) {
      return failFast('backfillArticles', String(err), t0);
    }
  });

  /**
   * ⭐ 当前页面是哪个语义页面 —— 让右边**跟着左边走**。
   *
   * 用户 2026-09-18:「点击左边时,右边自动填充变量,点击采集,即可采集。」
   * 下拉与参数框照样在(编排时要用),只是**值可以从当前页面自动来**,
   * 填完还看得见、能改 —— 不是黑盒。
   */
  ipcMain.handle(IPC_CHANNELS.WEBC_WHERE_AM_I, async (_e, payload: unknown) => {
    const p = (payload ?? {}) as { wcId?: unknown };
    const t0 = Date.now();
    const r = resolveXWebContents(typeof p.wcId === 'number' ? p.wcId : undefined);
    if ('error' in r) return failFast('whereAmI', r.error, t0);
    const url = r.wc.getURL();
    const hit = identifySemanticPage(url);
    // ⚠️ 认不出来不是错误(可能在设置页之类),但要如实说
    recordRun('whereAmI', { url, name: hit?.name ?? null },
      hit ? { status: 'ok' } : { status: 'degraded', missing: ['认不出这个页面'] },
      Date.now() - t0);
    return { channelOk: true, url, page: hit };
  });

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

  // ⚠️ 这个数必须跟着 ipcMain.handle 的条数改。
  //    本行曾写「10」而实际注册 12 个 —— 写死的计数会惄惄过期，
  //    是「说了假话的数字」的小号版。
  console.log(`[web-console] dev-only 控制台已注册（${WEBC_COUNT} 个通道）`);
}
