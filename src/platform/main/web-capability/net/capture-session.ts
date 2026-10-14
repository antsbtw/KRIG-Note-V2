/**
 * 载荷捕获会话 —— ⭐ 「开始捕」→「攒下来」→「停」的那个**会话态**
 *
 * ── 为什么需要它(不是「总线不够用」)──
 *
 * 总线 `netBus` 已经能收载荷,但它的 body **按条数老化**
 * (`MAX_RESPONSE_BODIES = 256`,不按时间)。X 滚动采集时载荷密集,
 * 256 个会很快转完 —— 于是「列出来等人点开看」这种用法必然拿到
 * 「记录在、body 没了」。
 *
 * ⭐ 所以要在**捕到的那一刻**就把 body 取出来存住。
 * 这个类就是那个「存住」的地方。
 *
 * ⚠️ 它与 `NetMonitor` 的分工:
 * · `NetMonitor` 攒**计数**(近 5 分钟捕获几条),给健康探针
 * · 本类攒**内容**(原样 body),给调试台和采集
 * 两者都只订阅、都不 attach ——「关错灯」在接口上就不可能。
 *
 * ── ⭐⭐ 必须区分的三种状态(抄 `NetMonitor` 的判断)──
 *
 * `NetMonitor` 的注释写着:
 * > 只有真的拿到 body 才算「捕获」—— 有响应但没载荷不算,
 * > 否则通道哑了(能看到请求、拿不到 body)会被误判成健康
 *
 * ⭐ 本类把这条判断**显式建模**成三个计数,因为调试台必须让人看出区别:
 * ① `captured`  —— 有 body,真捕到了
 * ② `noBody`    —— 有响应但没 bodyRef(**通道哑了**的指纹)
 * ③ `bodyLost`  —— 有 bodyRef 但取不出来(老化赛跑输了)
 *
 * ⚠️ 混成一个「捕获 N 条」会让「通道哑了」长得像「这页没请求」——
 * 而记忆 `project-x-collect-two-legs` 的教训正是:
 * **判据要看 payloads 不看推文数**,因为 DOM 那条腿会顶着,
 * 掩盖载荷全断。本类就是让 payloads 这个数**看得见**的地方。
 */

import type { PageId } from '../page/types';
import type { NetworkEvent } from './types';
import type { NetworkEventBus } from './bus';

/** 一条攒下来的载荷 —— ⭐ 存**解码后的文本**,不存 bytes */
export type CapturedPayload = {
  readonly requestId: string;
  readonly url: string;
  readonly method?: string;
  readonly status?: number;
  readonly at: string;
  /** 原样响应体(已按 UTF-8 解码)。⚠️ 不解析、不挑字段 */
  readonly text: string;
  readonly byteLength: number;
  /**
   * ⭐⭐ **X 发这条请求时用的请求头** —— 游标翻页要原样重发它。
   * ⚠️ 只带 cookie 不够:X 的 GraphQL 还要 authorization / x-csrf-token,
   * 少了就是 **HTTP 403**(2026-10-06 真机实证)。
   */
  readonly requestHeaders?: Readonly<Record<string, string>>;
};

/**
 * ⚠️ 为什么要封顶:X 滚动一轮能来几十个载荷,长文单篇就有十几 KB。
 * 不封顶的话主进程内存会一直涨,而**涨到卡住之前没有任何症状**。
 * ⭐ 封顶策略与总线一致(淘汰最老的),但上限小得多:
 * 调试台只需要看最近几条,采集侧会自己把要的东西取走。
 */
const MAX_PAYLOADS = 64;

/** 攒下来的事实 —— ⭐ 三种状态分开计,不混成一个数 */
export type CaptureStats = {
  /** 有 body,真捕到了 */
  readonly captured: number;
  /** ⚠️ 有响应但没 bodyRef —— **通道哑了**的指纹 */
  readonly noBody: number;
  /** ⚠️ 有 bodyRef 但取不出来 —— 与老化赛跑输了 */
  readonly bodyLost: number;
  /** 通道故障次数 + 最后一条原因 */
  readonly channelFailures: number;
  readonly lastChannelFailure?: string;
  /** 当前攒着几条(受 MAX_PAYLOADS 封顶) */
  readonly held: number;
  /** 是否在捕 */
  readonly running: boolean;
};

export class CaptureSession {
  private payloads: CapturedPayload[] = [];
  private captured = 0;
  private noBody = 0;
  private bodyLost = 0;
  private channelFailures = 0;
  private lastChannelFailure?: string;
  private unsubscribe?: () => void;

  /**
   * ⭐⭐ 「这一轮有没有真的捕到过」的**首次**信号。
   *
   * ⚠️ 为什么不只在停捕时记:**人可能忘了点停**(或直接关面板),
   * 那样这一轮的事实一个字都不会留下 ——
   * 又回到「只能靠截图」(用户 2026-10-02 点破的那条)。
   * ⭐ 捕到第一条就记一次,之后不再重复(免得刷屏)。
   */
  private firstCaptureReported = false;

  /**
   * ⭐⭐ 已经算过 `noBody` 的 requestId。
   *
   * ── 为什么需要(2026-10-02 实测)──
   *
   * 同一条请求会收到**两次** `response-complete`:
   * ① webRequest 侧 `onCompleted` —— 有响应、**还没 body**
   * ② CDP 侧 body 到手后补发 —— 有 `bodyRef`
   * 这是有意的(「有响应」与「载荷到手」本是两个时刻),
   * 但不去重的话同一条既计 `noBody` 又计 `captured`。
   *
   * ⚠️⚠️ 后果不只是数字难看:`noBody > 0` 是面板上
   * 「**这是 CDP 通道的问题**」那句诊断的触发条件 —— 会**误报**,
   * 把人指向一个不存在的故障(而那正是这一栏要避免的事)。
   *
   * ⭐ 所以后来补到 body 时**撤回**先前那次 noBody。
   */
  private noBodySeen = new Set<string>();

  constructor(
    private readonly bus: NetworkEventBus,
    private readonly pageId: PageId,
    /**
     * ⚠️ 可选 —— 不给就只是不留痕,**不报错也不降级功能**。
     * 单测不需要留痕,生产一定要给。
     */
    private readonly onFirstCapture?: (url: string, byteLength: number) => void,
  ) {}

  /**
   * 开始捕。⚠️ **幂等** —— 重复调不会装两份订阅。
   *
   * ⚠️ 不幂等会怎样:同一条载荷被存两次,
   * 现象是「捕获数翻倍」而人会以为真来了那么多
   * (记忆 `project-host-broadcast-multi-ws-fanout` 的同族形态)。
   */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe(this.pageId, {}, (event) => {
      this.observe(event);
    });
  }

  /**
   * 停。⚠️ 只退订**自己的订阅**,不碰通道 ——
   * 通道是 `bodyProvider` 的单一持有,业务方没有关灯这个动作。
   * X 旧实现那 8 处正是因为业务方持有 detach,踩了
   * 「A 结束时把正在共用的 B 一起掐掉」,而 B **静默失聪不报错**。
   */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** 清掉攒的内容,但**保留计数**(人要知道这一轮总共来过多少) */
  clearPayloads(): void {
    this.payloads = [];
  }

  /** 计数也归零 —— 开始新一轮观察时用 */
  resetStats(): void {
    // ⚠️ 首次标记一起复位 —— 不然新一轮捕到了也不留痕
    this.firstCaptureReported = false;
    this.noBodySeen.clear();
    this.captured = 0;
    this.noBody = 0;
    this.bodyLost = 0;
    this.channelFailures = 0;
    this.lastChannelFailure = undefined;
  }

  stats(): CaptureStats {
    return {
      captured: this.captured,
      noBody: this.noBody,
      bodyLost: this.bodyLost,
      channelFailures: this.channelFailures,
      lastChannelFailure: this.lastChannelFailure,
      held: this.payloads.length,
      running: this.unsubscribe !== undefined,
    };
  }

  /** 取攒下来的载荷(最新的在前)。`limit` 只影响返回量,不动存量 */
  list(limit = MAX_PAYLOADS): CapturedPayload[] {
    return [...this.payloads].reverse().slice(0, Math.max(0, limit));
  }

  /**
   * 消费一个总线事件。
   *
   * ⭐ `channel-failed` / `channel-lost` 在总线侧是**不受 kinds 过滤**广播的,
   * 所以这里一定收得到 —— 不会「安静等一个永不来的载荷」。
   */
  private observe(event: NetworkEvent): void {
    if (event.kind === 'channel-failed' || event.kind === 'channel-lost') {
      this.channelFailures += 1;
      this.lastChannelFailure = `${event.kind}: ${event.reason}`;
      return;
    }
    if (event.kind !== 'response-complete') return;

    /**
     * ⚠️⚠️ 没有 bodyRef = **有响应但拿不到载荷** —— 这是通道哑了的指纹,
     * 不是「这条没内容」。必须单独计,否则它会被当成正常请求滑过去。
     */
    if (event.bodyRef === undefined) {
      // ⚠️ 同一条只计一次 —— 重复的 onCompleted 不该让数字翻倍
      if (!this.noBodySeen.has(event.requestId)) {
        this.noBodySeen.add(event.requestId);
        this.noBody += 1;
      }
      return;
    }

    /**
     * ⭐ 这一条先前被算作 `noBody`,现在 body 到了 —— **撤回**那一次。
     * ⚠️ 不撤的话 `noBody` 虚高,而它是「CDP 通道有问题」的诊断依据,
     * 会在一切正常时误报。
     */
    if (this.noBodySeen.delete(event.requestId)) {
      this.noBody -= 1;
    }

    const body = this.bus.body(event.bodyRef);
    if (body.status !== 'ok') {
      /**
       * ⚠️ 取不到 body **单独计**,不混进 captured ——
       * 「与老化赛跑输了」和「通道哑了」是两种成因,
       * 混起来就不知道该调哪个参数。
       */
      this.bodyLost += 1;
      return;
    }

    const record = this.bus.list(this.pageId, {})
      .find((r) => r.requestId === event.requestId);

    this.captured += 1;
    this.payloads.push({
      requestId: event.requestId,
      // ⚠️ 记录找不到时 URL 如实留空串,**不猜**一个 —— 猜了会让人以为采的是那一页
      url: record?.url ?? '',
      method: record?.method,
      status: event.status ?? record?.status,
      at: event.at,
      text: new TextDecoder().decode(body.value),
      byteLength: body.value.byteLength,
      /** ⭐ `onSendHeaders` 早就记进 bus 了,这里只是往上送 */
      requestHeaders: record?.requestHeaders,
    });
    /**
     * ⭐⭐⭐ **请求头到底有没有跟过来** —— 2026-10-06,403 查了三轮。
     *
     * ⚠️⚠️ 游标翻页要原样重发 X 的请求头,少了就是 403。
     * 而链路是:`onSendHeaders` → bus 记录 → 这里按 requestId 回查 → 往上送。
     * 中间任何一环断了,**表现都是「种子带了 0 个请求头」** ——
     * 而我已经为此查了三轮、改了两处都没中。
     * ⭐ 在**取到的这一刻**报一次:有就是有,没有就说明回查没命中,
     * 两种情况当场分得开,不用再猜。
     * ⚠️ 只报**键数**不报值 —— 凭据不进日志。
     */
    /**
     * ⭐⭐ 403 诊断(2026-10-13 根治后**降噪**):正常有头不吵,
     * 只在回查**拿不到头**(0 个 / 没找到记录)时报 —— 那正是种子会 0 头 → 403 的苗头。
     * 根因已清(见 `project-x-paging-403-root-cause`),留作哨兵。
     * ⚠️ onSendHeaders 侧也只在没 authorization 时报,两条对照:
     * 　· 那边报了没头、这边也报 → Electron 源头没给(SW/keepalive,靠 CDP 补头兜)
     * 　· 那边没报(有头)、这边报没头 → 头在 bus 里被抹了(配对/合并 bug)
     */
    if (/\/i\/api\/graphql\//.test(record?.url ?? '')) {
      const n = Object.keys(record?.requestHeaders ?? {}).length;
      if (n === 0) {
        console.log(
          `[web.net][403诊断] ⚠️ 回查拿不到请求头`
          + `（requestId=${event.requestId}，记录${record ? '找到了但 0 个头' : '**没找到**'}`
          + `，url=…${(record?.url ?? '').slice(-50)}）`,
        );
      }
    }

    /**
     * ⭐ 首次捕到就报一次 —— 让「链路活了」这个事实**离开内存**。
     * ⚠️ 放在 push 之后:报的是真存下来的那一条。
     */
    if (!this.firstCaptureReported) {
      this.firstCaptureReported = true;
      this.onFirstCapture?.(record?.url ?? '', body.value.byteLength);
    }
    // 老化:淘汰最老的
    while (this.payloads.length > MAX_PAYLOADS) this.payloads.shift();
  }
}
