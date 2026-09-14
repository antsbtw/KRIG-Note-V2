/**
 * ⭐⭐ 采集策略契约 —— Module5 的地基(`agent/Module5-02-x-pipeline.md` §1.3)
 *
 * ── 用户口径(2026-09-09 拍板)──
 *
 * > 「(盯推主)这个只是**一个例子**,也就是**不要写死代码**。」
 *
 * 初稿写的是 `strategy: 'keyword' | 'browse' | 'tweet-watch' | 'author-watch'` ——
 * **那正是要反对的东西**:加第五种策略要改类型定义、改 switch 分支,
 * 于是每加一种采集方式都得动核心代码。
 *
 * ⭐ **判据(与 `web/capability-layer/01-contract.md` §6「加新站点只写 adapter」同源)**:
 *
 * > **加一种新采集策略 = 新增一个文件 + 一行注册;
 * >   改动现有文件数 = 0,改动 UI = 0。**
 *
 * ── ⭐⭐ 为什么契约里**没有** `run()` ──
 *
 * 有 `run()` 就等于允许策略自己写导航和滚动,于是「同一 bug 修三遍」**原样复发**。
 *
 * ⚠️ 这不是假设。`x-timeline-harvester.ts` 文件头记着实测代价:
 *
 * > 「滚动逻辑曾散在**三个文件**,同一 bug **修三遍**,每次都以为修好了。
 * >   用户拿官网数据一核对 —— **10 天 433 条回复,库里只有 81 条(19%)**。」
 *
 * **那三个文件,正是现在的三种策略**(`scanRecipe` / `harvestTimeline` /
 * `x-article-replies`)—— 它们各自写了一遍滚动,所以各自都漏数据。
 *
 * ⭐ **策略只声明,不执行。** 骨架(导航 → 等到位 → 滚 → 收载荷)由 web 能力层
 * 跑**唯一那一份**,策略只回答三个问题(`Module5-02` §1.2.2):
 *
 * ```
 * ① 去哪个页面   ② 怎样算到位   ③ 什么时候停
 * ```
 *
 * ── 分层 ──
 *
 * ```
 * ┌─ 本文件:策略注册表 ────────────────────────────┐
 * │  「有哪些采集方式、各要什么参数、去哪停哪」         │
 * │   ⚠️ 只声明,不执行;零 Electron,可完全单测        │
 * └────────────────────────────────────────────────┘
 *                    ↓ 填三个答案
 * ┌─ web 能力层(已建)─────────────────────────────┐
 * │  goto → ready → scrollUntil → capture           │
 * │  ⚠️ 不认识 X、不认识「推文」、不认识「搜索页」     │
 * └────────────────────────────────────────────────┘
 * ```
 */

/**
 * ⭐ 参数声明 —— 「有描述、有配置」的兑现点。
 *
 * UI **不认识**任何具体策略,它只读这份 schema 渲染表单。
 * 所以新策略的配置界面**自动就有了** —— 这才叫「不写死」。
 *
 * ⚠️ 故意只有五种基础类型:类型越多,UI 的 switch 越长,
 * 「加策略零改 UI」就越难守住。不够用时先问「能不能用现有的表达」。
 */
export type ParamKind = 'string' | 'number' | 'boolean' | 'stringList' | 'enum';

export type ParamSpec = {
  /** 参数名 —— 运行期 params 对象的 key */
  readonly key: string;
  /** 给人看的标签(表单 label) */
  readonly label: string;
  readonly kind: ParamKind;
  /** ⭐ 说明这个参数是干什么的 —— 用户要的「有描述」落到字段级 */
  readonly help?: string;
  /**
   * 必填。⚠️ 缺了要**明确失败**,不许静默用默认值继续 ——
   * 「看着跑了实际没按你说的跑」是本仓反复踩的形态。
   */
  readonly required?: boolean;
  /** 默认值。⚠️ 只在**非必填**时有意义 */
  readonly defaultValue?: string | number | boolean | readonly string[];
  /** `kind==='enum'` 时的候选值 */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  /** `kind==='number'` 时的范围(UI 据此约束,校验层据此拒绝) */
  readonly min?: number;
  readonly max?: number;
};

/** 运行期传给策略的参数集合。⚠️ 形状由 `paramsSchema` 声明,不是随便什么都能塞 */
export type CollectParams = Readonly<Record<string, unknown>>;

/**
 * ① 去哪个页面 —— 策略产出**完整 URL**。
 *
 * ⚠️ **本轮先用自己的形状,不用 `web.page` 的 `PageTarget`**(总指挥 2026-09-14 拍板):
 * 那份是不透明 brand 串,要由 adapter 解释成语义页面表,
 * 而 `goto` **至今未实现**(`01-contract.md` §15「待 adapter」)。
 * 地基不该被一个没实现的东西卡住。
 *
 * ⏳ **记账**:将来 `goto` + 语义页面表落地后,这里换成 `PageTarget`,
 * URL 拼装下沉进 adapter。**换的是这一个类型,策略文件不用动** ——
 * 这正是契约存在的意义。
 */
export type CollectTarget = {
  /** 完整可导航 URL */
  readonly url: string;
  /** 给日志/留痕看的一句话(如「关键词搜索:VPN求助-中文」) */
  readonly describe: string;
};

/**
 * ② 怎样算到位 —— 判据,不是等待实现。
 *
 * ⚠️ **`urlIncludes` 是必须的,不是可选的**:X 是 SPA,登录态刷新、路由接管、
 * 被弹回首页都会让 URL 变,而「页面上有没有推文」不管「是不是你要的那个页面」。
 *
 * 实测代价(`x-timeline-scan.ts:320-329`,用户 2026-09-07 发现):
 * 采回来的推大多既不含关键词也不含求助信号 —— 不是 X 搜索「宽松」,
 * 而是**我们压根在读别的页面,把首页时间线当成了搜索结果**。
 */
export type CollectArrival = {
  /** 落地 URL 必须包含这个片段,否则本轮中止 */
  readonly urlIncludes: string;
  /** 还要等这些元素出现(CSS selector;由业务层解释) */
  readonly awaitSelector?: string;
};

/**
 * ③ 什么时候停 —— ⭐ **这是个判断,所以由策略回答,底座不替你决定**。
 *
 * 与 `01-contract.md` §2 铁律、§9.2 `find` 不替调用方挑同源:
 * 底座提供「能滚、能停」,**停的条件由调用方传**。
 *
 * ⚠️⚠️ **这里没有「DOM 条数不变就停」,也没有任何日期判据 —— 是刻意的**
 * (与 `control-types.ts` 的 `ScrollStop` 同源,那两条血泪照搬):
 *  - 血泪②:虚拟列表滚过的元素会被删,「当前 DOM 条数」不是进度(实测 +0/−1,**不涨反降**)
 *  - 血泪④:「见过的最旧一条」≠ 覆盖深度(置顶/热门旧内容排在前面,
 *    一条 3 月的推就让判据误以为覆盖 166 天)→ **日期只做显示,绝不做停止判据**
 */
export type CollectStop =
  /** ⭐ 血泪③:只有 `scrollY` **连续多轮不变**才算真到底 */
  | { readonly kind: 'atBottom' }
  /** 固定轮数 */
  | { readonly kind: 'rounds'; readonly n: number }
  /** 收够 N 条(由业务层数,**不是数 DOM 元素**,是数跨轮去重后的 id) */
  | { readonly kind: 'itemCount'; readonly n: number }
  /**
   * ⭐⭐ 滚过某个时间点就停(2026-09-14 补;初稿漏了这条,是**实打实的缺口**)。
   *
   * ⚠️ 判据是「**本轮最旧一条的发布时间** < `beforeTs`」——
   * 到了这个深度,说明这次要的那段已经看完了。
   *
   * ── 为什么非有不可(实测账,`x-timeline-scan.ts:452` 注释)──
   *
   * > 「30 分钟一轮却每次滚 48 小时 = **76 倍无用功**
   * >   (实测 1062 条里只有 14 条是新的)。」
   *
   * 少了它,keyword 策略每轮都要滚到搜索窗口的尽头 —— 采集量暴涨两个数量级。
   *
   * ⚠️⚠️ **这与血泪④「日期只做停止判据」不矛盾,区别要说清**:
   *  - 血泪④ 禁的是拿「**见过的最旧一条**」当**覆盖深度**的证明
   *    (置顶/热门旧内容排在前面,一条 3 月的推让判据误以为覆盖 166 天)
   *  - 这里用的是「**已经滚到这么旧了,够了**」—— 只用来**提前收工**,
   *    不用来声称「这段时间都采全了」。**方向相反:一个是停,一个是断言完整性。**
   *
   * ⭐ 所以它只能让采集**变短**,永远不会让采集**漏报**为「已完整」。
   */
  | { readonly kind: 'olderThan'; readonly beforeTs: number };

/**
 * ⭐⭐ 一种采集策略。**只声明,不执行。**
 *
 * 加一种 = 新建一个文件实现本接口 + 一行 `register()`。
 */
export interface CollectStrategy {
  /** 稳定 id(落库、留痕、`x_filter_feedback.strategy` 都用它)。⚠️ 定了就别改 */
  readonly id: string;
  /** 给人看的名字 */
  readonly name: string;
  /** ⭐ 用户要的「有描述」—— 这个策略是干什么的、适合什么场景 */
  readonly description: string;
  /** ⭐ 用户要的「有配置」—— UI 据此**自动生成表单** */
  readonly paramsSchema: readonly ParamSpec[];

  /** ① 去哪个页面 */
  target(params: CollectParams): CollectTarget;
  /** ② 怎样算到位 */
  arrived(params: CollectParams): CollectArrival;
  /** ③ 什么时候停 */
  stop(params: CollectParams): CollectStop;
}

/**
 * 参数校验结果。
 *
 * ⚠️ 用三段式而不是 `boolean` —— 「哪个参数错了、错在哪」必须说得出来。
 * 只回 false 会让「配置填错」表现为「策略跑不动」,排查方向指错。
 */
export type ParamValidation =
  | { readonly ok: true; readonly params: CollectParams }
  | { readonly ok: false; readonly problems: readonly string[] };
