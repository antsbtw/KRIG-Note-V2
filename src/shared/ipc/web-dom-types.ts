/**
 * `renderer → web.dom` 的 IPC 契约(L2 收口最后一块)
 *
 * ⚠️ 本文件在 `shared/`,**只放纯数据类型** —— renderer / preload / main 共用。
 * 不 import `@platform` / `@capabilities`(分层边界)。
 *
 * ── 为什么要这层(设计见 docs/handoff/web-dom-ipc-surface-design.md §〇)──
 *
 * renderer 侧 18 处裸注入,实测四个缺陷:
 *  ① `sync-driver` 有 **26 处静默吞异常、零日志** —— 违反可靠性纲领 §44
 *  ② 对占位符做 regex 替换,把运行时值**文本替换进脚本源码**,
 *     与 `project-x-inject-template-escape` 同机制,**且已经咬过一次**
 *  ③ 9 处把运行时值拼进脚本(含数字 —— `JSON.stringify(NaN)` → `null` → 浏览器当 0)
 *  ④ 零留痕:完全绕过 `trace` / `raw`,出事查不到「往页面里塞了什么」
 *
 * ⭐ 而「社区论坛自动化」会让这四条**随每个新站点线性增长** —— 这才是必要性。
 */

/**
 * ⭐ renderer 怎么指认一个页面。
 *
 * ⚠️⚠️ 用 renderer 手上的 `webview.getWebContentsId()`,**绝不让 main 侧猜**:
 * 不用 activeWs、不用「最后 navigate 的那个」。
 * `page-registry.ts:15` 记过这条血泪 ——
 * 「底座替应用做了选择,而它没资格做:它不知道业务意图。
 * 　实测后果:日志说注入成功,但右栏框是空的」。
 */
export type WebDomPageRef = {
  /** guest `<webview>` 的 webContents id */
  readonly wcId: number;
};

/** 脚本参数 —— ⚠️ 一律由 main 侧 `JSON.stringify` 绑定,renderer 给不了脚本文本 */
export type WebDomParams = Readonly<Record<string, string | number | boolean>>;

/**
 * 一次调用。⭐ **带 `op` 的单通道**,不是每个方法一条通道
 * (逐个开意味着每加能力就动通道表,而
 * `feedback-guard-hardcoded-list-never-grows` 已栽过三次)。
 *
 * ⚠️ 这里**没有** `runDynamic` —— 求值任意脚本的口子不对 renderer 开放。
 *
 * ── ⚠️ 为什么只有 `run` 一个 op(2026-09-30 实测)──
 *
 * `WebDom` 接口声明了 6 个方法(run/read/query/text/selection/runDynamic),
 * 但**全仓零实现** —— `grep "implements WebDom"` 零命中,
 * 只有 `ElectronDomRunner.run` 真的落地了。
 * 又是「**建好了没接线**」那个形态(同 `recordRequestStart` 零调用、
 * `ready`/`scrollUntil` 掉出公开面)。
 *
 * ⭐ 所以本层**只开 `run`** —— 开 `read`/`query`/`text`/`selection`
 * 就是给 renderer 一个**空头承诺**:调了必然失败,而失败原因是
 * 「底座没实现」而不是调用方的错,排查方向完全被带偏。
 * 等它们真的实现了再加 op,**那时本类型是唯一改动点**。
 *
 * ⭐ 2026-10-01 已加控制三个(`goto`/`ready`/`scrollUntil`),
 * 2026-10-02 加 `identify` —— 它们都**有真实现**,不是空头承诺。
 */
export type WebDomInvoke =
  | { readonly op: 'run'; readonly pageRef: WebDomPageRef; readonly scriptId: string; readonly params?: WebDomParams }
  // ── 控制(`web.page`)—— 2026-10-01 为 X Console 开放 ──
  /**
   * ⭐ 导航到**语义页面**。
   *
   * ⚠️ 只收 `name` + `params`,**不收 URL** —— URL 由各业务的页面表翻译。
   * 这是「改版只改一层」的前提:站点改版时变的是页面表,调用方不动。
   * ⭐ 同时它也是一道闸:renderer 给不了任意 URL,就导航不到计划外的地方
   * (旧实现 2026-09-07「把首页时间线当搜索结果」整批入库就是没这道闸)。
   */
  | {
      readonly op: 'goto';
      readonly pageRef: WebDomPageRef;
      readonly name: string;
      readonly params?: Readonly<Record<string, string>>;
      readonly readyTimeoutMs?: number;
    }
  /** 等某个判据满足(锚点出现/消失、URL 含片段) */
  | {
      readonly op: 'ready';
      readonly pageRef: WebDomPageRef;
      readonly criterion: WebDomReadyCriterion;
      readonly timeoutMs?: number;
    }
  /**
   * ⭐⭐ **反向**:当前 URL → 语义页面名 + 参数(「对称性」)。
   *
   * 用户 2026-09-18:「点击左边时,右边自动填充变量,点击采集,即可采集。」
   * 用户 2026-10-02:「在左边操作,右边自动识别行为并填写上参数?」
   *
   * ── ⚠️ 为什么**不收 pageRef**(本 op 是全家唯一一个)──
   *
   * 它**纯算**:问各业务的页面表「这个 URL 是哪一页」,不读页面、不改页面。
   * 收 pageRef 会迫使 main 侧走 `resolve()`——
   * 那条路会**登记一条 PageFacts 并 bindPageHost**(有副作用),
   * 于是「问一句这是哪页」变成了「注册一个页面」。
   * ⭐ 判据:本 op 在 webview 已关闭时也该照样能回答。
   *
   * ⚠️ 认不出来回 `ok` + `value: null`,**不是 failed** ——
   * 「这页我不认识」是正常答案(人可能在 x.com 的设置页),
   * 报 failed 会让留痕里堆满红条,真故障就被淹了。
   */
  | { readonly op: 'identify'; readonly url: string }
  // ── 输出(`web.net` 载荷捕获)—— 2026-10-02 为 X Console 第 3 步开放 ──
  /**
   * ⭐ 开始捕这一页的载荷。⚠️ **幂等**,重复调不会装两份订阅。
   *
   * ⚠️ 为什么要显式「开始」而不是一直开着:
   * 攒 body 占主进程内存,而**涨到卡住之前没有任何症状**。
   * 人点开始才攒,是让这件事有边界。
   *
   * ⚠️ 它会顺便 attach CDP 通道(由底座的单一持有者做)——
   * 调用方**没有** detach 这个动作,这是刻意的:
   * X 旧实现那 8 处业务方持有 detach,踩了「A 结束时把共用的 B
   * 一起掐掉」,而 B **静默失聪不报错**。
   */
  | { readonly op: 'captureStart'; readonly pageRef: WebDomPageRef }
  /** 停捕(只退自己的订阅,不碰通道) */
  | { readonly op: 'captureStop'; readonly pageRef: WebDomPageRef }
  /**
   * ⭐⭐ 取计数 —— **三种状态分开**,不是一个「捕获 N 条」。
   * 见 `CaptureStats`:captured / noBody(通道哑了) / bodyLost(老化赛跑输了)。
   */
  | { readonly op: 'captureStats'; readonly pageRef: WebDomPageRef }
  /** 取攒下来的载荷(最新在前)。⚠️ 原样文本,不解析 */
  | {
      readonly op: 'captureList';
      readonly pageRef: WebDomPageRef;
      readonly limit?: number;
    }
  /** 清掉攒的内容(保留计数 —— 人要知道这一轮总共来过多少) */
  | { readonly op: 'captureClear'; readonly pageRef: WebDomPageRef }
  /**
   * ⭐⭐ **只停翻页**(不碰采集)—— 用户 2026-10-02:
   * 「停应该包含两个动作 —— 停止翻页/停止取数据吧?」
   *
   * ⚠️ 为什么要独立一个 op 而不是只让 `captureStop` 兼管:
   * 人可能**只滚不捕**(光看页面),那时 `captureStop` 无从谈起,
   * 但翻页照样要能停。两个动作各有自己的入口才完整。
   *
   * ⚠️ 下一轮开头生效(循环在每轮开头检查),不是立即中断当前轮 ——
   * 当前轮最多再等一个 settleMs。
   */
  | { readonly op: 'scrollStop'; readonly pageRef: WebDomPageRef }
  /**
   * ⭐⭐ 重载当前页 —— **为了避开 attach 竞态**,不是便利功能。
   *
   * ⚠️ 实测:`page-created` 与 `capture-start` 在同一秒,而 X 的
   * `HomeTimeline` 首次请求在页面加载后 1–2 秒内发出 —— 两者是**竞态**。
   * 错过首次就只能等后续分页,而首页分页要滚很深才触发。
   * ⭐ 捕获已开着时重载,必然从第一条请求开始收。
   *
   * ⚠️ 它**不收 URL** —— 只重载当前页,给不了导航到别处的口子
   * (与 `goto` 只收语义名同一道理)。
   */
  | { readonly op: 'reload'; readonly pageRef: WebDomPageRef }
  // ── ⭐⭐ 第二条腿:页面内网络钩子(M4)—— 2026-10-02 ──
  /**
   * 装页面内钩子(覆写 XHR/fetch)。⚠️ **幂等**。
   *
   * ── 用户 2026-10-02 ──
   * 「要**充分利用几种方法**获取数据,而不是单独依赖 CDP。」
   * 「web 能力层应该具备**所有获取网页内容的能力**。」
   *
   * ⭐ 与 CDP 那条腿(`captureStart`)**平级并存,各记各的** ——
   * 单点依赖本身就是缺陷:一条腿收不到时,分不清
   * 「站点没发」还是「我们没收到」(2026-10-02 七轮排查的根因)。
   */
  /**
   * ⭐⭐ **面板动作落盘** —— 让「人点了什么」能被读到。
   *
   * ── 2026-10-02 实测逼出来的 ──
   * 连续两轮测试都卡在同一步:留痕里有 `acquire-start`、有 `scroll`,
   * 就是**没有 `acquire-stop`**。而我**读不到面板的状态**
   * (running / 按钮灰不灰 / 人点了哪个),只能反复静态推断 —— 查了四轮没结论。
   *
   * ⚠️ 这正是 `feedback-maintainability-over-feature-completion` 的下一处:
   * 主进程的动作有留痕,**renderer 的动作没有** ——
   * 于是「人点了但没发出去」与「人没点」长得一模一样。
   *
   * ⭐ 它只记事实:哪个按钮、当时的状态、结果。不改任何行为。
   */
  /**
   * ⭐⭐ **把核对报告写成文件** —— 用户 2026-10-02:
   * 「我不知道你采的数据是否完整…显示这些采集的内容包括元数据,**我来一条条对**吧。」
   *
   * ⚠️ 问题的本质:核对结果只活在面板上 —— 我读不到、人要截图,
   * 而 22 个字段 × N 条推文**没法靠截图对**。
   * ⭐ 落成文件,人和 AI 看**同一份**。
   *
   * ⚠️ 写到固定目录(`krig-data/x-audit/`),文件名带时间戳 —— 不覆盖历史。
   */
  | {
      readonly op: 'writeAudit';
      readonly pageRef: WebDomPageRef;
      /** 报告正文(由业务模块渲染好)—— ⚠️ 底座不认识 X 的字段 */
      readonly text: string;
      /** 文件名前缀,如 `x-home` */
      readonly name?: string;
    }
  | {
      readonly op: 'uiTrace';
      readonly pageRef: WebDomPageRef;
      /** 按钮/动作名 */
      readonly action: string;
      /** 当时面板的关键状态 —— ⚠️ 只放判断用得上的,不放全量 state */
      readonly state?: Readonly<Record<string, string | number | boolean | null>>;
    }
  /**
   * ⭐⭐⭐ **采这一页** —— 选好页面,点一下,它自己采完。
   *
   * ── 用户 2026-10-03 ──
   * 「应该是反过来,**我自己选定一个页面,点击开始采集,就采集**,
   * 　采集完毕后再验证采集的内容才对。」「每次采集 **10 页**。」
   *
   * ⚠️ 此前面板上有**五个**要人点的动作(goto/开始收/重载/滚动/停止),
   * 而且**顺序错了就采不到** —— 那是把编排推给了人。
   *
   * ⭐ 一次调用内部:装腿 → 重载(解竞态)→ 滚动 → 每轮展开折叠的推文
   * → 采够页数就停 → 出报告。调用方**不需要知道**这些。
   *
   * ⚠️ 这是**长操作**(可能几十秒),中途停用 `scrollStop`。
   */
  | {
      readonly op: 'harvest';
      readonly pageRef: WebDomPageRef;
      readonly plan?: {
        /** ⭐ 采够几页就停(「页」= 命中 pageUrlIncludes 的响应) */
        readonly wantPages?: number;
        /** ⚠️ 什么算「一页」—— 业务知识,底座不猜 */
        readonly pageUrlIncludes?: readonly string[];
        /** 滚动轮次**上限** —— 安全网不是目标 */
        readonly maxRounds?: number;
        /** ⭐ 每轮滚完跑的脚本 id —— 只收**预注册的 id** */
        readonly afterRoundScriptId?: string;
        /** ⚠️ 不要的 URL 子串 —— 业务给,底座一条不内置 */
        readonly noisyUrlSubstrings?: readonly string[];
        readonly maxMs?: number;
      };
    }
  // ── ⭐⭐ 采集(输出栏)—— **只管收,不碰页面** ──
  /**
   * ⭐⭐ 开始收。**立即返回**,不等。
   *
   * ── 用户 2026-10-02 ──
   * 「不要改变前面的逻辑,**控制是控制,采集是采集**。
   * 　你现在是简化了,但是**违背了逻辑**。控制/输出是分开的。」
   *
   * ⚠️ 我上一版把 reload / 滚动揉进了采集,实测当场看见后果:
   * `rounds=0 scrolledPx=0` —— 重载后首屏就够数、**一轮都没滚**,
   * 而人从输出那栏看不出来页面没动过。
   *
   * ⭐ 现在:页面怎么动去**控制那栏**(goto / 滚动 / 重载),
   * 这里只负责「开始接」。两条腿同时装,调用方不选。
   */
  | {
      readonly op: 'acquireStart';
      readonly pageRef: WebDomPageRef;
      /**
       * ⭐⭐ **采集时不要的 URL 子串** —— 由调用方给,底座一条都不内置。
       *
       * ⚠️ 2026-10-02 实测:滚 10 轮采到 59 条,**52 条是视频分片**(约 15MB),
       * 把容量挤爆 —— `HomeTimeline` 即使来了也存不下。
       * ⚠️ `resourceTypes` 挡不住:`video.twimg.com` 的 `.m4s` 报 `type=xhr`,
       * **与 GraphQL 同类型**。所以必须按 URL 挡。
       *
       * ⭐ 名单是**站点知识**,放在业务模块(`x-pages.ts` 的 `X_NOISY_URLS`)——
       * 底座内置就成了「Claude 的站点适配漏进底层」那种事(本仓栽过)。
       */
      readonly noisyUrlSubstrings?: readonly string[];
    }
  /** ⭐ 看当前收到多少 —— 纯读,不停不改 */
  | {
      readonly op: 'acquirePeek';
      readonly pageRef: WebDomPageRef;
      readonly goal?: { readonly wantUrlIncludes?: readonly string[] };
    }
  /** ⭐ 停止收,并给出报告(含完整性判据) */
  | {
      readonly op: 'acquireStop';
      readonly pageRef: WebDomPageRef;
      readonly goal?: {
        readonly wantUrlIncludes?: readonly string[];
        readonly wantAtLeast?: number;
      };
    }
  | { readonly op: 'hookStart'; readonly pageRef: WebDomPageRef }
  | { readonly op: 'hookStop'; readonly pageRef: WebDomPageRef }
  | { readonly op: 'hookStats'; readonly pageRef: WebDomPageRef }
  | {
      readonly op: 'hookList';
      readonly pageRef: WebDomPageRef;
      readonly limit?: number;
    }
  | { readonly op: 'hookClear'; readonly pageRef: WebDomPageRef }
  /** 滚动直到某判据 —— ⭐ 只管滚,不管抓(抓是 `capture` 的事) */
  | {
      readonly op: 'scrollUntil';
      readonly pageRef: WebDomPageRef;
      readonly stop: WebDomScrollStop;
      readonly maxRounds?: number;
      readonly settleMs?: number;
      /**
       * ⭐⭐ **每轮滚完跑一个预注册脚本** —— 业务自己的事,底座不猜。
       *
       * ── 用户 2026-10-02 ──
       * 「应该是**内部的控制机制**,而不是通过一个 button 来点击去做的呀。」
       *
       * ⭐ 起因:X 的折叠推文要点「Show more」才有全文,
       * 我原来做成了面板上一个按钮 —— 要人记得点、还要记得顺序。
       * 而**人读推文时看到折叠会自然点开**,采集也该自己做。
       *
       * ⚠️ 只收**预注册的脚本 id**,收不了脚本文本 ——
       * `project-x-inject-template-escape` 的那道闸不能开。
       * ⚠️ 脚本抛异常不中断滚动(业务的事做砸了不该让整轮采集作废)。
       */
      readonly afterRoundScriptId?: string;
    };

/**
 * 到位判据 —— 与底座 `ReadyCriterion` 同构。
 * ⚠️ 这里**不含** `custom`(要预注册脚本 id),Console 用不到。
 */
export type WebDomReadyCriterion =
  | { readonly kind: 'anchorAppears'; readonly anchor: string }
  | { readonly kind: 'anchorGone'; readonly anchor: string }
  | { readonly kind: 'urlIncludes'; readonly fragment: string };

/** 滚动停止判据 —— 与底座 `ScrollStop` 同构 */
export type WebDomScrollStop =
  | { readonly kind: 'atBottom' }
  | { readonly kind: 'rounds'; readonly n: number }
  | { readonly kind: 'anchorAppears'; readonly anchor: string };

/**
 * 回传的三态结果 —— 与 `web-capability/result.ts` 同构。
 *
 * ⭐ 为什么不直接复用那个类型:它在 `@platform` 下,`shared/` 不许 import。
 * 形状保持一致,main 侧原样转。
 *
 * ⚠️ **`degraded` 必须显式处理**,不许当 Ok ——
 * 那正是「点了就当成了」这类病的入口。
 */
export type WebDomResult =
  | { readonly status: 'ok'; readonly value: unknown }
  | { readonly status: 'failed'; readonly reason: string; readonly retryable: boolean }
  | { readonly status: 'degraded'; readonly value: unknown; readonly missing: readonly string[] };
