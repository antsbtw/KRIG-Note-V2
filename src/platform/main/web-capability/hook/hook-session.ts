/**
 * 页面内网络钩子的**会话**(M4)—— 装钩子、收数据、攒下来
 *
 * ⚠️ 本层**零 Electron**:真正发 CDP 命令的是 `HookHost` 那个接缝
 * (守卫 `page-boundary-guard` 钉着「除 wiring/ 外零处 Electron」)。
 *
 * ── ⭐ 与 `CaptureSession`(CDP 那条腿)是**平级**的 ──
 *
 * 两者各记各的,**绝不合并计数** —— 用户 2026-10-02 指出的架构缺口正是
 * 「单独依赖 CDP」:一条腿收不到时,分不清「站点没发」还是「我们没收到」。
 * ⭐ 平级并存才能互证。
 */

import type { PageId } from '../page/types';
import type { HookHost, HookedResponse, HookStats } from './types';
import { buildHookScript, HOOK_PROBE } from './hook-script';

/**
 * 页面里可调用的函数名。
 * ⚠️ 带 `krig` 前缀且够长 —— 与站点自己的全局变量撞名会很难查
 * (现象是「站点某个功能莫名其妙坏了」)。
 */
const BINDING_NAME = '__krigNetHookSend';

/**
 * 攒着的条数上限。
 * ⚠️ 与 `CaptureSession` 同款理由:不封顶的话主进程内存一直涨,
 * 而**涨到卡住之前没有任何症状**。
 */
const MAX_HELD = 64;

/** 页面送回来的原始形状 —— ⚠️ 这是**不可信数据**(跑在站点上下文里) */
type RawRecord = {
  via?: unknown; url?: unknown; method?: unknown; status?: unknown;
  text?: unknown; byteLength?: unknown; at?: unknown; oversize?: unknown;
};

export class HookSession {
  private held: HookedResponse[] = [];
  private hooked = 0;
  private lost = 0;
  private injected = false;
  private started = false;

  constructor(
    private readonly host: HookHost,
    private readonly pageId: PageId,
    /** ⚠️ 可选 —— 不给只是不留痕,功能不变(同 `NetMonitor` 的 recorder) */
    private readonly onFirst?: (r: HookedResponse) => void,
  ) {}

  /**
   * 装钩子。⚠️ **幂等**。
   *
   * ⭐ 两步都要做,缺一不可:
   * ① `addScriptOnNewDocument` —— 下次导航/重载时**在站点脚本之前**执行
   *    (社区把这叫「赢得原型竞赛」)
   * ② `evaluateNow` —— 当前这个已经加载完的文档也补一次
   *    ⚠️ 没有②的话,人点「开始」之后不刷新就永远钩不到 ——
   *    那正是 CDP 那条腿踩过的**竞态**(attach 晚于首次请求)。
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.host.addBinding(BINDING_NAME);
    this.host.onBindingCalled((name, payload) => {
      if (name !== BINDING_NAME) return;
      this.consume(payload);
    });

    const src = buildHookScript(BINDING_NAME);
    await this.host.addScriptOnNewDocument(src);
    // ⭐ 当前文档补一次 —— 脚本自带防重,装两次不会钩两遍
    await this.host.evaluateNow(src);
    this.injected = true;
  }

  stop(): void {
    this.started = false;
    /**
     * ⚠️ **不撤销注入** —— CDP 的 `removeScriptToEvaluateOnNewDocument`
     * 撤不掉已经执行过的那份,而页面里的钩子是幂等且无害的
     * (不送回去就等于没装)。
     * ⭐ 真正停的是「收不收」:`started=false` 后 `consume` 直接丢。
     */
  }

  stats(): HookStats {
    return {
      hooked: this.hooked,
      lost: this.lost,
      held: this.held.length,
      running: this.started,
      injected: this.injected,
    };
  }

  list(limit = MAX_HELD): HookedResponse[] {
    return [...this.held].reverse().slice(0, Math.max(0, limit));
  }

  clear(): void {
    this.held = [];
  }

  /** ⭐ 自检表达式 —— 调用方拿它去问页面「钩子装上了吗」 */
  static readonly probe = HOOK_PROBE;

  /**
   * 消费页面送回来的一条。
   *
   * ⚠️⚠️ **页面送回来的是数据不是指令** —— 它跑在站点的上下文里,
   * 站点(或站点被注入的第三方脚本)能构造任意内容。
   * ⭐ 所以这里**逐字段校验**,不信任任何形状。
   */
  private consume(payload: string): void {
    if (!this.started) return;   // 已停 —— 丢掉,不记

    let raw: RawRecord;
    try {
      raw = JSON.parse(payload) as RawRecord;
    } catch {
      // ⚠️ 解不出来**要计数**:它意味着 binding 的 payload 被截断了
      this.lost += 1;
      return;
    }

    const via = raw.via === 'xhr' || raw.via === 'fetch' ? raw.via : null;
    const url = typeof raw.url === 'string' ? raw.url : '';
    if (!via || !url) {
      // ⚠️ 形状不对也计 lost —— 静默丢会让「钩到了但没进来」无从查起
      this.lost += 1;
      return;
    }

    /**
     * ⚠️ `oversize` 的那条**没有正文**,但它是**真实发生过的请求** ——
     * 仍要计进 `hooked` 并攒下来(text 为空、byteLength 是原始大小),
     * 否则「超大的那些」会凭空消失。
     */
    const rec: HookedResponse = {
      pageId: this.pageId,
      via,
      url,
      method: typeof raw.method === 'string' ? raw.method : 'GET',
      status: typeof raw.status === 'number' && Number.isFinite(raw.status) ? raw.status : 0,
      text: typeof raw.text === 'string' ? raw.text : '',
      byteLength: typeof raw.byteLength === 'number' && Number.isFinite(raw.byteLength)
        ? raw.byteLength : 0,
      at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
    };

    this.hooked += 1;
    this.held.push(rec);
    while (this.held.length > MAX_HELD) this.held.shift();

    if (this.hooked === 1) this.onFirst?.(rec);
  }
}
