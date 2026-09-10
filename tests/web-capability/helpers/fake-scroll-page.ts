/**
 * `scrollUntil` / `ready` 的测试宿主 —— 一个**行为像真页面**的假页面
 *
 * ⭐ 关键设计:它**真的求值注入脚本**(`new Function`),在一个模拟的滚动模型上跑。
 * 这样「用了 smooth 导致回读到旧值」「拿 DOM 条数判进度」这类缺陷才有地方现形 ——
 * 只断言「脚本文本里包含 scrollBy」对它们零区分力。
 *
 * ⚠️ 模拟的是**滚动语义**,不是完整 DOM:
 *  - `window.scrollBy` 同步改 scrollY,受 docHeight 封顶(到底了就不动)
 *  - `behavior:'smooth'` 被模拟成**异步**的(下一轮才生效)——
 *    这正是血泪① 的现场,不模拟它就测不出来
 *  - 内部滚动容器:主文档不可滚时才动,判据 `scrollHeight > clientHeight + 400`
 */

import type { ControlHost, AnchorResolver, CustomScriptSource } from '@platform/main/web-capability/page/control';
import type { PageId } from '@platform/main/web-capability/page';

export const PAGE = 'page-scroll-1' as PageId;

export type FakePageOptions = {
  /** 文档总高。scrollY 到 docHeight - innerHeight 就到底了 */
  docHeight?: number;
  innerHeight?: number;
  /** true = 主文档不可滚,只有内部容器能滚(X 时间线的形态) */
  mainUnscrollable?: boolean;
  /** 内部容器的可滚高度 */
  containerScrollHeight?: number;
  containerClientHeight?: number;
  /** 页面 URL(urlIncludes 判据用) */
  url?: string;
};

export class FakeScrollPage implements ControlHost {
  scrollY = 0;
  containerTop = 0;
  readonly docHeight: number;
  readonly innerHeight: number;
  readonly mainUnscrollable: boolean;
  readonly containerScrollHeight: number;
  readonly containerClientHeight: number;
  url: string;

  /** 页面上「在场」的 selector 集合 —— anchorAppears / anchorGone 用 */
  present = new Set<string>();
  /** 每次 evaluate 的脚本文本(守卫用) */
  readonly scripts: string[] = [];
  /** 注入异常:非 null 时 evaluate 抛(故障注入用) */
  evaluateThrows: string | null = null;
  /**
   * 还要抛几次。**`Infinity` = 一直抛**(模拟页面始终注入不进去)。
   *
   * ⚠️ 别用一个「很大的数」冒充无限:踩过 —— 写 9999 时它真的被跑完了
   * (可控时钟下一次 ready 能轮询上万次),之后假页面**停止抛错**,
   * 于是「一直抛到超时」这个场景根本没造出来,断言自然落空。
   */
  throwTimes = 0;
  evaluateCount = 0;
  sleepCalls: number[] = [];

  /**
   * ⭐ 虚拟列表模拟:DOM 里的「条目数」会随滚动**下降**。
   * 实测形态是 +0 / −1(不涨反降)。若谁拿它当进度,就会立刻判「到底了」。
   */
  domItemCount = 20;

  /** 每轮滚动后跑一次(模拟懒加载补货 / 锚点出现) */
  onScroll?: (page: FakeScrollPage) => void;

  constructor(opts: FakePageOptions = {}) {
    this.docHeight = opts.docHeight ?? 10_000;
    this.innerHeight = opts.innerHeight ?? 800;
    this.mainUnscrollable = opts.mainUnscrollable ?? false;
    this.containerClientHeight = opts.containerClientHeight ?? 800;
    // ⚠️ 内部容器默认**跟着文档高走**,不是写死 10000。
    //    踩过:默认给 10000 时,连「短文档」页面也永远有个能滚的高容器 ——
    //    主文档到底后脚本转去滚容器,于是**永远不会 stuck**,「到底」测不出来。
    //    这不是引擎的 bug,是假页面不像真页面 —— 真页面的容器不会凭空比文档高。
    this.containerScrollHeight = opts.containerScrollHeight ?? this.docHeight;
    this.url = opts.url ?? 'https://example.test/start';
  }

  /**
   * 主文档还能往下滚多少。
   *
   * ⚠️ `mainUnscrollable` 表示「**滚不动**」,不是「被拽回顶部」——
   * 故封顶取**当前位置**,让页面停在原地。写成 0 会把「一动没动」模拟成
   * 「倒退回顶部」,`scrolledPx` 变成负数,与真实浏览器行为不符。
   */
  private maxScrollY(): number {
    if (this.mainUnscrollable) return this.scrollY;
    return Math.max(0, this.docHeight - this.innerHeight);
  }

  private maxContainerTop(): number {
    return Math.max(0, this.containerScrollHeight - this.containerClientHeight);
  }

  async evaluate(_pageId: PageId, script: string): Promise<unknown> {
    this.evaluateCount += 1;
    this.scripts.push(script);
    if (this.evaluateThrows) {
      if (this.throwTimes > 0) {
        if (this.throwTimes !== Infinity) this.throwTimes -= 1;
        throw new Error(this.evaluateThrows);
      }
      // throwTimes 用完 → 停止抛(模拟「页面导航完成,注入恢复正常」)
      this.evaluateThrows = null;
    }
    return this.run(script);
  }

  async sleep(ms: number): Promise<void> {
    this.sleepCalls.push(ms);
  }

  /** 固定随机源 —— 步长可复现,守卫才比得了 */
  random(): number {
    return 0.5;
  }

  /**
   * 真求值脚本。给它一个模拟的 window/document。
   *
   * ⚠️ 用 `return (${script})`:脚本是纯表达式(不以换行开头、不以分号结尾),
   * 否则 ASI 会在 return 后插分号,**结果恒 undefined 且不报错**(上一步踩过)。
   */
  private run(script: string): unknown {
    const page = this;

    const container = {
      get scrollHeight() { return page.containerScrollHeight; },
      get clientHeight() { return page.containerClientHeight; },
      get scrollTop() { return page.containerTop; },
      set scrollTop(v: number) {
        page.containerTop = Math.min(Math.max(0, v), page.maxContainerTop());
      },
    };
    // 一个「不够格」的容器 —— 验判据 scrollHeight > clientHeight + 400 真的在筛选
    const smallContainer = { scrollHeight: 900, clientHeight: 800, scrollTop: 0 };

    const win = {
      get scrollY() { return page.scrollY; },
      get innerHeight() { return page.innerHeight; },
      /**
       * ⭐ 同步版:立刻改 scrollY。
       * 若被测代码传了 `{behavior:'smooth'}`,走下面的异步分支 —— 那才是血泪①。
       */
      scrollBy(_x: number, yOrOpts: number | { top?: number; behavior?: string }) {
        if (typeof yOrOpts === 'object' && yOrOpts?.behavior === 'smooth') {
          // ⭐⭐ smooth 是**异步**的:本次调用不改位置,下一轮才生效。
          // 于是紧接着的回读拿到的是**滚动前**的值 —— 等于没测量。
          page.pendingSmooth = (yOrOpts.top ?? 0);
          return;
        }
        const dy = typeof yOrOpts === 'number' ? yOrOpts : (yOrOpts?.top ?? 0);
        page.applyPendingSmooth();
        page.scrollY = Math.min(Math.max(0, page.scrollY + dy), page.maxScrollY());
      },
      location: { get href() { return page.url; } },
    };

    const doc = {
      body: { get scrollHeight() { return page.docHeight; } },
      documentElement: { get scrollHeight() { return page.docHeight; } },
      querySelector(sel: string) {
        return page.present.has(sel.trim()) ? { __el: sel } : null;
      },
      querySelectorAll(sel: string) {
        if (sel === 'div') return [smallContainer, container];
        // 条目计数 —— 只有「拿 DOM 条数判进度」的实现才会问这个
        return new Array(page.domItemCount).fill({ __item: true });
      },
    };

    const fn = new Function('window', 'document', `return (${script});`);
    return fn(win, doc);
  }

  /** smooth 的延迟生效:下一次同步滚动时才补上 —— 模拟「异步」 */
  pendingSmooth = 0;
  private applyPendingSmooth(): void {
    if (this.pendingSmooth) {
      this.scrollY = Math.min(Math.max(0, this.scrollY + this.pendingSmooth), this.maxScrollY());
      this.pendingSmooth = 0;
    }
  }
}

/** 锚点表:语义名 → selector(adapter 的活) */
export class MapAnchors implements AnchorResolver {
  constructor(private readonly table: Record<string, string>) {}
  resolve(anchor: string): string | null {
    // ⚠️ 查不到返回 null 而非原样返回 —— 「锚点名打错」必须是明确失败
    return this.table[anchor] ?? null;
  }
}

/** 预注册脚本表(custom 判据用) */
export class MapScripts implements CustomScriptSource {
  constructor(private readonly table: Record<string, string>) {}
  build(scriptId: string): string | null {
    return this.table[scriptId] ?? null;
  }
}
