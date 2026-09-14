/**
 * `web.page` 页面登记处 —— 身份分配 + 事实存储 + find(`06` §1 / §2)
 *
 * 纯内存、零 Electron 依赖,**可完全单测**。接线(did-attach-webview 等)不在本文件,
 * 也不在本步 —— 凡是需要真实 Electron 运行时才能验证的,本步都不做。
 *
 * ── 两条最容易做错的地方,写在最前面 ──
 *
 * 1. ⭐ **身份不由维度拼出**(`06` §8.1 已否决拼维度方案)。
 *    这里的 pageId 是自增序号 + 随机段,与 window/ws/slot/tabId **完全无关**。
 *    所以「同 ws 三个 tab」天然是三个 id,不需要事先想到 tab 这一维。
 *
 * 2. ⭐ **find 不替调用方挑**(`06` §2.2)。
 *    如实返回全部命中,**不排序、不筛选、不取第一个**。
 *    现有 bug 的根源就是 `createWebviewServiceRegistry` 的「最后 navigate 胜出」——
 *    底座替应用做了选择,而它没资格做:它不知道业务意图。
 *    实测后果:「日志说注入成功,但右栏框是空的」(内容落进了用户没在看的实例)。
 */

import type {
  Lease,
  PageFacts,
  PageFactsPatch,
  PageId,
  PageLifecycleEvent,
  PageQuery,
  RegisterPageInput,
} from './types';
import { type Result, failed, ok } from '../result';

type LifecycleListener = (event: PageLifecycleEvent) => void;

/** 单调递增序号,保证同一进程内 id 绝不重复(随机段只防跨进程/跨重启的肉眼混淆)*/
let idCounter = 0;

function mintPageId(): PageId {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `page_${idCounter.toString(36)}_${rand}` as PageId;
}

let leaseCounter = 0;

function mintLeaseId(): string {
  leaseCounter += 1;
  return `lease_${leaseCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class PageRegistry {
  private readonly pages = new Map<PageId, PageFacts>();
  /** pageId → 当前租约。一个页面同时至多一个租约(第二个请求得到 Failed,不是排队)*/
  private readonly leases = new Map<PageId, Lease>();
  private readonly listeners = new Set<LifecycleListener>();
  /** 注入时钟,便于测试推进时间;生产用 Date.now */
  constructor(private readonly now: () => number = Date.now) {}

  // ── 生命周期事件(供 web.trace;本步只发不接)──

  subscribeLifecycle(listener: LifecycleListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: PageLifecycleEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        // 一个坏监听器不许拖垮登记处,但**必须留痕** —— 不静默吞
        console.warn('[web.page] lifecycle listener 抛错', { kind: event.kind, pageId: event.pageId, err });
      }
    }
  }

  // ── 注册 / 注销 ──

  /**
   * 登记一个新页面,分配一个**全新的**不透明 id。
   *
   * ⚠️ 每次调用都是**新页面**(新开 tab = 新建,见 `06` §1.6)。
   * 「webview 重挂」不该走这里 —— 那是同一个浏览上下文,应走 `update`。
   */
  register(input: RegisterPageInput): PageFacts {
    const pageId = mintPageId();
    const facts: PageFacts = {
      pageId,
      window: input.window,
      ws: input.ws,
      slot: input.slot,
      tabId: input.tabId,
      // 原样带过去,**不给默认值** —— 缺省成 persist:webview 会让「忘了传」
      // 变成静默错配到别的 session(类型层已经把它定成必填)
      partition: input.partition,
      owner: input.owner,
      service: input.service,
      url: input.url ?? '',
      state: input.state ?? 'unknown',
    };
    this.pages.set(pageId, facts);
    this.emit({ kind: 'page-created', pageId, facts, at: this.now() });
    return facts;
  }

  /**
   * 销毁页面(tab 关闭 / webview 销毁)。连带回收它的租约 —— 否则租约会泄漏成
   * 「一个已经不存在的页面永远被占着」。
   */
  destroy(pageId: PageId): boolean {
    const existed = this.pages.delete(pageId);
    // 页面没了,租约必须跟着没 —— 即使页面本来就不存在也清一遍,不留孤儿
    this.leases.delete(pageId);
    if (existed) {
      this.emit({ kind: 'page-destroyed', pageId, at: this.now() });
    }
    return existed;
  }

  // ── 事实读写 ──

  /**
   * 取页面事实快照。
   *
   * ⚠️ 不存在时返回 `Failed`,**不返回 null 也不返回空对象** ——
   * 「返回空值假装成功」是本层明令禁止的第四态(`06` §4.2)。
   */
  facts(pageId: PageId): Result<PageFacts> {
    const facts = this.pages.get(pageId);
    if (!facts) {
      // 不可重试:页面不存在不会因为再问一次就存在
      return failed(`page not found: ${pageId}`, false);
    }
    return ok(facts);
  }

  /**
   * 更新页面事实(换 slot / 换窗口 / 拖 tab / 导航)。
   *
   * ⭐ **pageId 不在 patch 里,类型层面就改不了** —— 这是「同一个浏览上下文 =
   * 同一个 pageId」(`06` §1.6)的机器强制点。
   * webview 重挂后 wcId 变、pageId 不变,走的就是这条路径。
   */
  update(pageId: PageId, patch: PageFactsPatch): Result<PageFacts> {
    const prev = this.pages.get(pageId);
    if (!prev) {
      return failed(`page not found: ${pageId}`, false);
    }
    const next: PageFacts = {
      ...prev,
      ...patch,
      // 身份原样带过去,任何 patch 都碰不到它
      pageId: prev.pageId,
    };
    this.pages.set(pageId, next);

    const at = this.now();
    if (patch.url !== undefined && patch.url !== prev.url) {
      // 跨站导航:url 和 service 都变,**pageId 不变**(否则 trace 会断成两截)
      this.emit({ kind: 'page-navigated', pageId, url: next.url, service: next.service, at });
    }
    const moved =
      (patch.window !== undefined && patch.window !== prev.window) ||
      (patch.ws !== undefined && patch.ws !== prev.ws) ||
      (patch.slot !== undefined && patch.slot !== prev.slot) ||
      // partition 与 window/ws/slot 同类(都是位置事实),换了同样算「移动过」
      (patch.partition !== undefined && patch.partition !== prev.partition);
    if (moved) {
      this.emit({ kind: 'page-moved', pageId, facts: next, at });
    }
    return ok(next);
  }

  // ── find ──

  /**
   * 按事实条件找页面。
   *
   * ⭐⭐ **唯一的铁律:如实返回全部命中,不排序、不筛选、不替调用方挑。**
   *
   * 底座不保证「挑得对」,只保证「不替你挑」。挑错了是应用的问题;
   * **悄悄替你挑是底座的问题**(`06` §2.2)。
   *
   * 找不到就返回空数组 —— 这不是「兜底」,这是**如实说没有**。
   * 兜底是「找不到时随便给一个」,那才是被禁的。
   */
  find(query: PageQuery = {}): PageFacts[] {
    const out: PageFacts[] = [];
    // 按插入序遍历(Map 的天然顺序)。这是**登记序**,不是任何形式的「优先级排序」——
    // 调用方不该依赖它,底座也不承诺它有语义。
    for (const facts of this.pages.values()) {
      if (query.window !== undefined && facts.window !== query.window) continue;
      if (query.ws !== undefined && facts.ws !== query.ws) continue;
      if (query.slot !== undefined && facts.slot !== query.slot) continue;
      // 精确相等,与其它位置条件同规格 —— 不做前缀匹配(`persist:webview` 不该命中
      // `persist:webview-ws-1`,那是两个真正不同的 session)
      if (query.partition !== undefined && facts.partition !== query.partition) continue;
      if (query.owner !== undefined && facts.owner !== query.owner) continue;
      if (query.service !== undefined && facts.service !== query.service) continue;
      if (query.urlIncludes !== undefined && !facts.url.includes(query.urlIncludes)) continue;
      out.push(facts);
    }
    return out;
  }

  /** 全部页面(诊断用)。同样不排序 */
  list(): PageFacts[] {
    return Array.from(this.pages.values());
  }

  has(pageId: PageId): boolean {
    return this.pages.has(pageId);
  }

  // ── 租约 ──

  /**
   * 占用页面。同一页面同时只允许一个租约。
   *
   * ⚠️ 已被占用时返回 `Failed(retryable=true)`,**不排队、不抢占**。
   * 「谁该让谁」是应用层的判断,底座不做(`06` §0)。
   *
   * 过期采用**惰性回收**(读时清),不用常驻 setInterval ——
   * 记忆 `project-graceful-shutdown`:常驻 timer 会吊住 Node 事件循环让进程不肯退,
   * 且本仓铁律要求每个常驻 timer 在 before-quit 有停止调用。惰性回收没有这个负担。
   * (V1 `lease-manager.ts` 用的是 60s setInterval —— 这一点**没有照抄**。)
   */
  lease(pageId: PageId, purpose: string, ttlMs?: number): Result<Lease> {
    if (!purpose.trim()) {
      // 空 purpose 的租约 = 排查「谁占着」时唯一线索没了
      return failed('lease 必须说明用途(purpose)', false);
    }
    if (!this.pages.has(pageId)) {
      return failed(`page not found: ${pageId}`, false);
    }
    const existing = this.currentLease(pageId);
    if (existing) {
      // 可重试:对方 release 或租约到期后就能拿到
      return failed(`page busy: ${pageId} 已被占用(purpose=${existing.purpose})`, true);
    }
    if (ttlMs !== undefined && !(ttlMs > 0)) {
      return failed(`lease ttl 必须为正数,收到 ${ttlMs}`, false);
    }
    const at = this.now();
    const lease: Lease = {
      leaseId: mintLeaseId(),
      pageId,
      purpose,
      acquiredAt: at,
      expiresAt: ttlMs === undefined ? undefined : at + ttlMs,
    };
    this.leases.set(pageId, lease);
    return ok(lease);
  }

  /**
   * 释放租约。
   *
   * ⚠️ 释放一个**不是当前持有者**的租约(过期后被别人拿走的旧 leaseId)时返回 Failed,
   * 而不是静默把别人的租约删掉 —— 那会造成「A 以为自己占着,实际被 B 的 release 顶掉」。
   */
  release(lease: Lease): Result<void> {
    const current = this.currentLease(lease.pageId);
    if (!current) {
      return failed(`lease 已不存在(可能已过期或已释放): ${lease.leaseId}`, false);
    }
    if (current.leaseId !== lease.leaseId) {
      return failed(
        `lease 不匹配:${lease.leaseId} 不是当前持有者(当前 ${current.leaseId})`,
        false,
      );
    }
    this.leases.delete(lease.pageId);
    return ok(undefined);
  }

  /** 当前有效租约(顺手惰性回收过期的)。无则 null */
  currentLease(pageId: PageId): Lease | null {
    const lease = this.leases.get(pageId);
    if (!lease) return null;
    if (lease.expiresAt !== undefined && lease.expiresAt <= this.now()) {
      this.leases.delete(pageId);
      return null;
    }
    return lease;
  }

  /** 全部有效租约(诊断用);顺手回收所有已过期的 */
  activeLeases(): Lease[] {
    const out: Lease[] = [];
    for (const pageId of Array.from(this.leases.keys())) {
      const lease = this.currentLease(pageId);
      if (lease) out.push(lease);
    }
    return out;
  }
}
