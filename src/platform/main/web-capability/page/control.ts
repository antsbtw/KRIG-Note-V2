/**
 * `ready` + `scrollUntil` 的纯逻辑引擎(`01-contract.md` §9.4 / §9.5)
 *
 * ⭐ 与 `web.input` 同构:能力层零 Electron,真正跑脚本的宿主是个接缝。
 * 守卫 `page-boundary-guard.test.ts` 扫本目录禁 `from 'electron'` ——
 * 这不是绕过守卫,这个接缝**就是**守卫要的那层隔断。
 *
 * ── 本文件承载的四条血泪(§9.5)──
 * ① 同步 `scrollBy` + 滚动之后才回读      → `scroll-scripts.ts`(有守卫)
 * ② 不许用 DOM 条数判进度/判停            → 本文件零处元素计数(有守卫)
 * ③ 只有 `scrollY` **连续多轮**不变才算到底 → `stuckRounds` 默认 3(有守卫)
 * ④ 日期只做显示,绝不做停止判据           → `ScrollStop` 里根本没有日期(有守卫)
 */

import { type Failed, type Ok, type Result, failed, ok } from '../result';
import type { PageId } from './types';
import type {
  PageTarget,
  PageResolver,
  GotoReport,
  ReadyCriterion,
  RoundTrace,
  ScrollOptions,
  ScrollReport,
  ScrollStop,
} from './control-types';
import {
  buildAnchorExistsScript,
  buildReadPositionScript,
  buildReadUrlScript,
  buildScrollStepScript,
} from './scroll-scripts';

/** `ready` 默认超时。取两份实现的并集口径:**可配**,默认给宽的那个 */
export const DEFAULT_READY_TIMEOUT_MS = 6000;
/** 轮询间隔。`x-write:106` 用 200,`x-article-driver:84` 用 POLL_INTERVAL_MS,取 200 */
export const READY_POLL_MS = 200;

/** ⭐ 连续几轮不变才算到底。**默认 3** —— 一轮就停是血泪③ 的复发形态 */
export const DEFAULT_STUCK_ROUNDS = 3;
export const DEFAULT_MAX_ROUNDS = 50;
export const DEFAULT_SETTLE_MS = 800;
/** 每轮滚屏高的几成:0.55~0.85 抖动(匀速是风控最容易识别的特征) */
export const STEP_RATIO_MIN = 0.55;
export const STEP_RATIO_MAX = 0.85;

/**
 * 能跑脚本的宿主。能力层**只知道有这么个东西**,不知道 Electron 存在。
 *
 * ⚠️ 命名避开 `webContents` —— 那是既有守卫在本层的禁词(不变量 3)。
 */
export interface ControlHost {
  /** 在页面上下文求值。失败**必须抛**,不许返 undefined 假装成功 */
  evaluate(pageId: PageId, script: string): Promise<unknown>;
  /**
   * 导航到某 URL,并返回**实际落地 URL**。
   *
   * ⚠️ 实现方要 `await` 导航,但 **reject 不算失败**(站点自行接管导航时必 reject),
   * 把 reject 的原因**如实返回**给引擎,由引擎决定怎么解释 ——
   * 在接线层吞掉它,`goto` 就分不出「站点接管了」与「真没导航成」。
   */
  navigate?(pageId: PageId, url: string): Promise<{ landedUrl: string; rejected?: string }>;
  /** 可注入的时钟(测试用可控版,免得真等) */
  sleep?(ms: number): Promise<void>;
  /** 可注入的随机源(测试要可复现;生产用 Math.random) */
  random?(): number;
}

/**
 * 锚点解释器 —— adapter 的活(§14):语义锚点名 → selector。
 *
 * ⚠️ 解释不出来返回 null(调用方据此 Failed),**不返回空串**:
 * 空 selector 会让「锚点名打错了」表现为「查了个空,什么也没找到」——
 * 静默失聪的又一种形态。上一步(`web.input`)注入实验证过这条:
 * 不这么做,「锚点没登记」和「元素不在页面」会混成同一个 Failed。
 */
export interface AnchorResolver {
  resolve(anchor: string): string | null;
}

/** 预注册脚本表 —— `custom` 判据只认 id,不认脚本字符串(同 `web.dom`)*/
export interface CustomScriptSource {
  /** 取不到返回 null */
  build(scriptId: string): string | null;
}

type Position = { y: number; docHeight: number; usedContainer: boolean };

export class ControlEngine {
  constructor(
    private readonly host: ControlHost,
    private readonly anchors: AnchorResolver,
    private readonly scripts?: CustomScriptSource,
    /** ⭐ 语义页面表(adapter 的活)。不给 → `goto` 只能收 `kind:'url'` */
    private readonly pages?: PageResolver,
  ) {}

  private sleep(ms: number): Promise<void> {
    if (this.host.sleep) return this.host.sleep(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  private random(): number {
    return this.host.random ? this.host.random() : Math.random();
  }

  /**
   * ⭐⭐ 去某个**语义**页面(§9.3)。
   *
   * ── 三条必须内建的事(`x-collect-runner` 的血泪,别再各写一遍)──
   *
   * ① `loadURL` 要 await:不等它,后面的注入会在旧文档拆卸时被拒。
   * ② 但 await **reject 不算失败** —— 站点自行接管导航时必 reject
   *    (X 常见 ERR_ABORTED),页面照样会到位。真失败由「等到位」判定。
   * ③ ⭐ **落地校验是必须的**:到位 ≠ 到对地方。
   *    2026-09-07 实测:被弹回首页时「页面上有推文」照样成立,
   *    于是把首页时间线当成搜索结果**整批入库**。
   *
   * ⚠️ 本方法**不抛**,一律回三态 —— 与 `ready`/`scrollUntil` 一致。
   */
  async goto(
    pageId: PageId,
    target: PageTarget,
    options: { readyTimeoutMs?: number } = {},
  ): Promise<Result<GotoReport>> {
    if (!this.host.navigate) {
      return failed('宿主没有 navigate 能力 —— 接线层没接上导航接缝', false);
    }

    // ── 语义名 → URL + 到位判据 ──
    let url: string;
    let arrival: ReadyCriterion;
    let describe: string;

    if (target.kind === 'url') {
      // ⚠️ 仅 adapter 内部可用。没有语义名就没有到位判据,
      //    只能退化成「URL 里含它自己」—— 弱,但至少不是没有。
      url = target.url;
      arrival = { kind: 'urlIncludes', fragment: stripOrigin(target.url) };
      describe = `裸 URL ${target.url}`;
    } else {
      if (!this.pages) {
        return failed(
          `没有语义页面表,无法解释 ${target.name}(adapter 没把表推进来?)`,
          false,
        );
      }
      const hit = this.pages.resolve(target.name, target.params);
      if (!hit) {
        // ⚠️ fail loud:不兜底、不猜 —— 兜底会导航到别的页面,
        //    而那正是「把首页当搜索结果」的成因
        const known = this.pages.names?.().join(', ') ?? '(表未提供 names())';
        return failed(`未登记的语义页面: ${target.name}(可用: ${known})`, false);
      }
      url = hit.url;
      arrival = hit.arrival;
      describe = hit.describe;
    }

    const startedAt = Date.now();

    // 血泪①②:要 await,但 reject 不算失败
    let nav: { landedUrl: string; rejected?: string };
    try {
      nav = await this.host.navigate(pageId, url);
    } catch (err) {
      // 宿主自己抛(如页面已关闭)才是真失败
      return failed(
        `导航 ${describe} 失败: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }

    // 等到位 —— 复用 ready 的全部血泪(多候选 / 注入异常重试 / 超时如实报)
    const arrived = await this.ready(pageId, arrival, options.readyTimeoutMs);
    if (arrived.status !== 'ok') {
      return failed(
        `${describe}:导航后未到位 —— ${arrived.status === 'failed' ? arrived.reason : '判据未满足'}`
        + (nav.rejected ? `;loadURL 曾 reject: ${nav.rejected}` : ''),
        true,
      );
    }

    /**
     * ⚠️ 这里**不再单独做一次落地校验** —— 探针实证它是死码(2026-09-15)。
     *
     * 初版我照搬 `x-collect-runner` 的 `assertLanded`,写成
     * 「`ready` 之后再比一次 URL 片段」。实测 reason 恒为
     * 「导航后未到位 —— 等待判据 urlIncludes:/xxx 超时」:
     * **`ready` 先失败,那段永远走不到**。
     *
     * 而且它对**四种判据全是死的**:只有 `urlIncludes` 带 fragment,
     * 另外三种(anchorAppears / anchorGone / custom)根本没有 URL 可比。
     *
     * ⭐ 真相是:**落地校验本来就由 `ready` 的 `urlIncludes` 判据承担** ——
     * 语义页面表给的 arrival 就是那道闸(见 `x-pages.ts`:
     * `x.withReplies` 的判据是 `/{handle}/with_replies`,带 handle,
     * 跳到别人的页面照样不算到位)。再写一遍只是重复,而重复的那份还够不着。
     *
     * ⚠️ 我的测试当时写 `/没落在目标页|未到位/` —— 两种结果都放过,
     * 于是这段死码一直没被发现。**用 `|` 放过多种结果 = 假绿的又一种形态。**
     */
    const landedUrl = await this.currentUrl(pageId, nav.landedUrl);

    return ok({
      requestedUrl: url,
      landedUrl,
      elapsedMs: Date.now() - startedAt,
      describe,
      loadRejected: nav.rejected,
    });
  }

  /** 读当前 URL;读不到就退回导航时拿到的那个(**不假装成功**,只是少一次确认) */
  private async currentUrl(pageId: PageId, fallback: string): Promise<string> {
    try {
      const raw = await this.host.evaluate(pageId, 'window.location.href');
      return typeof raw === 'string' && raw ? raw : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * 等页面达到某个判据(§9.4)。
   *
   * ⚠️ **合并两份不等价实现,取并集**:
   *  - 多候选 selector(来自 `x-write.ts:106`;`x-article-driver` 那份没有)
   *  - **注入异常重试**(来自 `x-write.ts:106` 的 `catch { }` 后继续轮询;
   *    `x-article-driver` 那份没有 try —— 页面正在导航时注入必抛,
   *    没有重试就会把「还没加载完」误判成「判据不满足」)
   *  - 可配超时(`x-write` 写死 6000;这里做成参数)
   *
   * 超时返回 `Failed`,**不返回 Ok** —— 「等不到」就是没等到。
   */
  async ready(
    pageId: PageId,
    criterion: ReadyCriterion,
    timeoutMs: number = DEFAULT_READY_TIMEOUT_MS,
  ): Promise<Result<void>> {
    const probe = this.buildProbe(criterion);
    if (probe.status !== 'ok') return probe;

    const deadline = Date.now() + timeoutMs;
    /** 最后一次注入异常 —— 超时时要如实说出来,不能只说「判据不满足」 */
    let lastError: string | null = null;

    for (;;) {
      try {
        const raw = await this.host.evaluate(pageId, probe.value.script);
        lastError = null;
        if (probe.value.satisfied(raw)) return ok(undefined);
      } catch (err) {
        // ⭐ **注入异常要重试,不是立刻失败** ——
        // 页面正在导航时 executeJavaScript 必抛,那恰恰说明「还没到位」,
        // 正是该继续等的时刻。但**记下来**:超时时它是最有用的线索。
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (Date.now() >= deadline) {
        const detail = lastError
          ? `;最后一次注入异常: ${lastError}`
          : '';
        return failed(
          `等待判据 ${describeCriterion(criterion)} 超时(${timeoutMs}ms)${detail}`,
          true,
        );
      }
      await this.sleep(READY_POLL_MS);
    }
  }

  /**
   * ⭐ 滚动直到某个判据(§9.5)。**只管滚,不管抓。**
   *
   * 现有 `harvestTimeline` 把 `loadURL + 滚动 + 捕获 + 判停` 缝死在一个函数里,
   * 结果「只滚不抓」「抓但不导航」「换判停规则」**全做不到**。
   * 拆开后:`goto` → `scrollUntil` → `capture` 各自独立,业务自由编排。
   */
  async scrollUntil(
    pageId: PageId,
    stop: ScrollStop,
    options: ScrollOptions = {},
  ): Promise<Result<ScrollReport>> {
    const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const stuckRounds = options.stuckRounds ?? DEFAULT_STUCK_ROUNDS;
    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

    if (maxRounds < 1) return failed(`maxRounds 必须 ≥ 1,收到 ${maxRounds}`, false);
    if (stuckRounds < 1) return failed(`stuckRounds 必须 ≥ 1,收到 ${stuckRounds}`, false);

    // `rounds` 判据下 n 轮就是全部意图,不该被 maxRounds 悄悄截断 —— fail loud
    if (stop.kind === 'rounds') {
      if (stop.n < 1) return failed(`rounds 判据的 n 必须 ≥ 1,收到 ${stop.n}`, false);
      if (stop.n > maxRounds) {
        return failed(
          `rounds 判据要 ${stop.n} 轮,但 maxRounds 只有 ${maxRounds} —— ` +
            `会被静默截断,请显式调大 maxRounds`,
          false,
        );
      }
    }

    // 停止判据要用到的探针(anchorAppears / custom)
    const stopProbe = this.buildStopProbe(stop);
    if (stopProbe.status !== 'ok') return stopProbe;

    // ── 基线:滚之前先读一次位置。没有它,「滚了多少」只能靠猜 ──
    const start = await this.readPosition(pageId);
    if (start.status !== 'ok') return start;

    const trace: RoundTrace[] = [];
    let lastY = start.value.y;
    const startY = start.value.y;
    let stuck = 0;
    let rounds = 0;
    let reachedBottom = false;
    let stopReason = `达到轮次上限 ${maxRounds}`;

    for (let i = 1; i <= maxRounds; i++) {
      rounds = i;
      const roundStart = Date.now();

      // 每轮抖动步长 —— 匀速请求是风控最容易识别的特征
      const stepRatio =
        options.stepRatio ?? STEP_RATIO_MIN + this.random() * (STEP_RATIO_MAX - STEP_RATIO_MIN);

      let pos: Position;
      try {
        // ⭐⭐ 同步 scrollBy + **滚动之后**回读(血泪①)—— 都在这一个脚本里,
        // 中间不可能插进异步等待,所以「读到滚动前的值」在结构上不可能发生
        pos = normalizePosition(await this.host.evaluate(pageId, buildScrollStepScript(stepRatio)));
      } catch (err) {
        // 滚动本身炸了 = 页面没了 / 注入被拒。这不是「滚不动」,是**做不了** ——
        // 当成「到底了」会把失败伪装成成功,正是要治的病
        return failed(
          `第 ${i} 轮滚动失败: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }

      // 每轮后等渲染(给懒加载补货时间)
      await this.sleep(settleMs);

      // ⭐ 血泪③:只有位置**连续多轮不变**才算真到底
      if (pos.y === lastY) stuck += 1;
      else stuck = 0;
      lastY = pos.y;

      trace.push({
        round: i,
        scrollY: pos.y,
        docHeight: pos.docHeight,
        stuck,
        elapsedMs: Date.now() - roundStart,
        usedContainer: pos.usedContainer,
      });

      // ── 判停 ──
      if (stop.kind === 'rounds' && i >= stop.n) {
        stopReason = `达到指定轮次 ${stop.n}`;
        break;
      }
      if (stopProbe.value) {
        let hit = false;
        try {
          hit = stopProbe.value.satisfied(await this.host.evaluate(pageId, stopProbe.value.script));
        } catch (err) {
          // 判据探针炸了 ≠ 判据不满足。吞掉会让「探针一直炸」表现为「一直没到」,
          // 白滚满 maxRounds 轮还报「未滚到底」—— 原因完全指错方向
          return failed(
            `第 ${i} 轮停止判据探测失败: ${err instanceof Error ? err.message : String(err)}`,
            true,
          );
        }
        if (hit) {
          stopReason = `停止判据满足(${describeStop(stop)})`;
          break;
        }
      }
      if (stuck >= stuckRounds) {
        reachedBottom = true;
        stopReason = `滚到底(连续 ${stuck} 轮 scrollY=${pos.y} 未变)`;
        break;
      }
    }

    const scrolledPx = lastY - startY;

    // ── A 层自校验:滚动确实发生了(§9.5)。不过要**如实标红**,不许静默 ──
    const problems: string[] = [];
    if (scrolledPx <= 0) {
      // ⚠️ 这条是本层最重要的一条:滚动没生效时,后面所有判断都建立在假数据上。
      // 现有实现只查 `maxY <= 0`,漏掉「起点不为 0 但一动没动」的情形
      problems.push(
        `页面从未向下移动(起点 ${startY} → 终点 ${lastY})—— 滚动没生效`,
      );
    }
    if (stop.kind === 'atBottom' && !reachedBottom) {
      problems.push(`要求滚到底,但 ${rounds} 轮后仍未到底 —— 结果不完整`);
    }
    if (stop.kind === 'anchorAppears' && !stopReason.startsWith('停止判据满足')) {
      problems.push(`要求等锚点出现,但直到停止都没出现 —— 结果不完整`);
    }
    if (stop.kind === 'custom' && !stopReason.startsWith('停止判据满足')) {
      problems.push(`要求等自定义判据满足,但直到停止都没满足 —— 结果不完整`);
    }

    const report: ScrollReport = {
      // ⭐ ok 由 problems 算出,不是独立字段 —— 两者各说各话就是撒谎的入口
      ok: problems.length === 0,
      problems,
      rounds,
      scrolledPx,
      reachedBottom,
      stopReason,
      trace,
    };

    // ⚠️ 校验没过**不返回 Failed**:数据是真的、滚了多少是真的,
    // 只是不完整 —— 当 Failed 会让调用方丢掉已经滚出来的进度。
    // 这正是 `Degraded` 的场景(§8:「当 Ok 是撒谎,当 Failed 是冤枉」)。
    if (problems.length > 0) {
      return { status: 'degraded', value: report, missing: problems };
    }
    return ok(report);
  }

  private async readPosition(pageId: PageId): Promise<Ok<Position> | Failed> {
    try {
      return ok(normalizePosition(await this.host.evaluate(pageId, buildReadPositionScript())));
    } catch (err) {
      return failed(
        `读取初始滚动位置失败: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
  }

  /** 把判据编译成「一段脚本 + 怎么判它满没满足」 */
  private buildProbe(
    criterion: ReadyCriterion,
  ): Ok<{ script: string; satisfied: (raw: unknown) => boolean }> | Failed {
    switch (criterion.kind) {
      case 'anchorAppears': {
        const sel = this.anchors.resolve(criterion.anchor);
        if (!sel) return anchorFailure(criterion.anchor);
        return ok({ script: buildAnchorExistsScript(sel), satisfied: (raw) => raw === true });
      }
      case 'anchorGone': {
        const sel = this.anchors.resolve(criterion.anchor);
        if (!sel) return anchorFailure(criterion.anchor);
        // ⭐ 判「不在场」。⚠️ 用 `=== false` 而不是 `!raw`:
        // 注入返回 undefined(脚本没跑成)会被 `!raw` 当成「已消失」——
        // 那就是把失败读成成功
        return ok({ script: buildAnchorExistsScript(sel), satisfied: (raw) => raw === false });
      }
      case 'urlIncludes':
        return ok({
          script: buildReadUrlScript(),
          satisfied: (raw) => typeof raw === 'string' && raw.includes(criterion.fragment),
        });
      case 'custom': {
        const script = this.scripts?.build(criterion.script);
        if (!script) {
          return failed(
            `自定义判据脚本 ${criterion.script} 未注册(web.dom 的注册表里没有)`,
            false,
          );
        }
        return ok({ script, satisfied: (raw) => raw === true });
      }
    }
  }

  private buildStopProbe(
    stop: ScrollStop,
  ): Ok<{ script: string; satisfied: (raw: unknown) => boolean } | null> | Failed {
    if (stop.kind === 'atBottom' || stop.kind === 'rounds') return ok(null);
    if (stop.kind === 'anchorAppears') {
      const sel = this.anchors.resolve(stop.anchor);
      if (!sel) return anchorFailure(stop.anchor);
      return ok({ script: buildAnchorExistsScript(sel), satisfied: (raw) => raw === true });
    }
    const script = this.scripts?.build(stop.script);
    if (!script) {
      return failed(`自定义停止判据脚本 ${stop.script} 未注册`, false);
    }
    return ok({ script, satisfied: (raw) => raw === true });
  }
}

function anchorFailure(anchor: string): Failed {
  return failed(`锚点 ${anchor} 无法解释成 selector(adapter 没登记?)`, false);
}

/**
 * 把脚本回读的位置规范化。
 *
 * ⚠️ 字段缺失**抛错**,不填默认值:`y` 取不到时填 0 会让「回读失败」
 * 表现为「滚回顶部了」,于是 stuck 计数全乱 —— 又一次静默坍缩。
 */
function normalizePosition(raw: unknown): Position {
  const r = raw as Partial<Position> | null;
  if (!r || typeof r.y !== 'number' || typeof r.docHeight !== 'number') {
    throw new Error(`滚动位置回读结果不合法: ${JSON.stringify(raw)}`);
  }
  return { y: r.y, docHeight: r.docHeight, usedContainer: r.usedContainer === true };
}

function describeCriterion(c: ReadyCriterion): string {
  switch (c.kind) {
    case 'anchorAppears': return `anchorAppears:${c.anchor}`;
    case 'anchorGone': return `anchorGone:${c.anchor}`;
    case 'urlIncludes': return `urlIncludes:${c.fragment}`;
    case 'custom': return `custom:${c.script}`;
  }
}

function describeStop(s: ScrollStop): string {
  switch (s.kind) {
    case 'atBottom': return 'atBottom';
    case 'rounds': return `rounds:${s.n}`;
    case 'anchorAppears': return `anchorAppears:${s.anchor}`;
    case 'custom': return `custom:${s.script}`;
  }
}

/**
 * 从完整 URL 里取出 path 部分,给 `kind:'url'` 当退化判据。
 * ⚠️ 解析失败就原样返回 —— 宁可判据宽一点,也不要在这里抛。
 */
function stripOrigin(url: string): string {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}
