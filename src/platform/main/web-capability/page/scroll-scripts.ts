/**
 * `scrollUntil` 的注入脚本 —— 四条血泪的**机器强制点**(`01-contract.md` §9.5)
 *
 * ⚠️ 本文件是**纯字符串构造**,零 Electron 依赖(与 `web.dom` / `web.input` 同一手法);
 * 真正执行 `executeJavaScript` 的地方在 `wiring/electron-scroll.ts` 一个文件里。
 *
 * ── 为什么这些脚本值得被单独看管 ──
 * 滚动逻辑现在散在 **7 个** X 文件里(harvester / scan / notifications /
 * article-replies / capture-monitor / author-timeline-spike / payload-inspector),
 * `x-timeline-harvester.ts` 文件头写着:「同样的 bug 要修三遍,而且**每次都以为修好了**。
 * 实测代价:用户拿官网点击数据一核对 —— **10 天 433 条回复,库里只有 81 条(19%)**」。
 *
 * 四条血泪里有**三条落在这个文件**(①③在这里、②是「这里不许出现什么」),
 * 所以它们各配一条能红的守卫。
 */

/**
 * ⭐⭐ 血泪①:**必须同步 `scrollBy`,且滚动之后才回读**。
 *
 * `behavior:'smooth'` 是**异步**的:调用立刻返回、滚动尚未发生,
 * 在那之后读 `scrollY` 读到的是**滚动前**的值 —— **等于没测量**。
 * 这条最阴险的地方是:代码看起来完全正常,滚动在屏幕上也真的发生了,
 * 只是**测量值全错**,于是「滚到底了没有」这个判断全程建立在旧数据上。
 *
 * ⭐ 血泪(实现细节):**主文档滚不动时要找内部滚动容器**。
 * 判据 `scrollHeight > clientHeight + 400` 照搬 `x-timeline-harvester.ts:299`
 * —— 400 这个余量是为了跳过那些「只比可视区高一点点」的普通容器。
 *
 * ⚠️ 本脚本**只滚、只回读位置**,不数任何 DOM 元素(血泪②)。
 *
 * @param stepRatio 每轮滚屏高的几成。调用方给定值(抖动由调用方做,脚本不含随机数
 *   —— 脚本要可复现,否则守卫无从比对)
 */
export function buildScrollStepScript(stepRatio: number): string {
  return `(function () {
      var step = ${JSON.stringify(stepRatio)};
      var before = window.scrollY;
      // ⭐⭐ 同步 scrollBy —— 绝不用 behavior:'smooth'(它异步,回读会读到滚动前的值)
      window.scrollBy(0, window.innerHeight * step);
      var scrolledMain = window.scrollY !== before;
      var usedContainer = false;
      if (!scrolledMain) {
        // ⭐ 主文档滚不动 → 找内部滚动容器(X 等站点把时间线放在内部容器里)
        var all = document.querySelectorAll('div');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el.scrollHeight > el.clientHeight + 400) {
            el.scrollTop = el.scrollTop + el.clientHeight * step;
            usedContainer = true;
            break;
          }
        }
      }
      // **滚动之后**才回读 —— 这才是真实状态
      var containerY = 0;
      if (usedContainer) {
        var all2 = document.querySelectorAll('div');
        for (var j = 0; j < all2.length; j++) {
          if (all2[j].scrollHeight > all2[j].clientHeight + 400) {
            containerY = all2[j].scrollTop;
            break;
          }
        }
      }
      return {
        y: window.scrollY + containerY,
        docHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        usedContainer: usedContainer
      };
    })()`;
}

/**
 * 只回读位置,不滚动(第 0 轮建立基线用)。
 *
 * ⚠️ 有基线才知道「滚了多少」。没有它,第一轮的 `scrolledPx` 只能靠猜 ——
 * 而 A 层自校验(滚动确实发生了)恰恰要拿这个差值说话。
 */
export function buildReadPositionScript(): string {
  return `(function () {
      var containerY = 0;
      var all = document.querySelectorAll('div');
      for (var i = 0; i < all.length; i++) {
        if (all[i].scrollHeight > all[i].clientHeight + 400) {
          containerY = all[i].scrollTop;
          break;
        }
      }
      return {
        y: window.scrollY + containerY,
        docHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        usedContainer: false
      };
    })()`;
}

/**
 * 锚点是否在场(`ready` 的 anchorAppears/anchorGone 与 `scrollUntil` 的
 * anchorAppears 共用这一个)。
 *
 * ⭐ **多候选 selector**(逗号分隔,顺序尝试)—— 取自 `x-write.ts:106` 那一份;
 * `x-article-driver.ts:84` 那份没有,合并时取并集(§9.4)。
 * 站点改版时多候选是唯一的缓冲:新旧 selector 并列,改版当天不至于全线停摆。
 */
export function buildAnchorExistsScript(selector: string): string {
  return `(function () {
      var sel = ${JSON.stringify(selector)};
      var parts = sel.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      for (var i = 0; i < parts.length; i++) {
        try {
          if (document.querySelector(parts[i])) return true;
        } catch (e) { /* 非法 selector 试下一个候选,不让一个坏的拖垮全部 */ }
      }
      return false;
    })()`;
}

/** 当前 URL(`ready` 的 urlIncludes 判据用)*/
export function buildReadUrlScript(): string {
  return `(function () { return String(window.location.href); })()`;
}
