/**
 * ⭐⭐ X 任务 —— 「先配置任务,再执行」的数据模型(用户 2026-09-14 拍板「甲」)
 *
 * > 「我们先做一个 task 的配置面板,未来所有的执行从先在面板配置任务,然后才执行,
 * >   对于两个任务撞车的,不能同时执行。」
 * > 「甲 —— 我喜欢干净,对现有的代码已经难以忍受,搞不清楚哪个是哪个了。」
 *
 * ── ⭐ 它替代了什么 ──
 *
 * `search_recipes`(4 条配方)。迁移后配方这个概念**消失**,4 条配方变成 4 个任务。
 *
 * ⚠️ 关键差别:配方表把 `keywords`/`minLikes`/`lang` 这些**平铺成字段**,
 * 于是加一种新采集方式就要改表结构。任务表把它们收进 `params`,
 * 由 `CollectStrategy.paramsSchema` 定义与校验 ——
 * **加一种策略 = 注册一个,任务表一个字段都不用动。**
 *
 * ── 与 `CollectStrategy` 的分工 ──
 *
 * ```
 * 策略(注册表)  「有哪几种采集方式、各要什么参数」   ← 代码,开发期定
 * 任务(本表)    「这一个具体任务:用哪种策略、参数填什么、多久跑一次」← 数据,用户配
 * ```
 */

/** 任务当前的执行态 —— ⚠️ 是**运行期**状态,不是配置 */
export type XTaskRunState =
  /** 没在跑 */
  | 'idle'
  /** 正在跑 */
  | 'running'
  /** 上次跑失败了(`lastError` 有内容) */
  | 'failed';

export interface XTask {
  /** ULID。⚠️ 迁移时**沿用原 `recipe_id`** —— x_tweet.search_recipe 那 11850 行外键才对得上 */
  id: string;
  name: string;
  /** ⭐ 用户要的「有描述」:这个任务是干什么的 */
  description?: string;

  /**
   * ⭐ 用哪种采集策略 —— 对应 `CollectStrategyRegistry` 里注册的 id。
   *
   * ⚠️ **故意是 `string` 而不是联合类型**:写成 `'keyword' | 'author-watch'`
   * 就等于把注册制退回枚举,加第五种策略又要改类型定义(§1.3 明令反对)。
   * 取不到对应策略时由 `registry.get()` fail loud。
   */
  strategyId: string;

  /**
   * ⭐ 策略参数。形状由该策略的 `paramsSchema` 声明,**本类型不认识内容**。
   *
   * ⚠️ 这正是「加策略零改表」的兑现点。不许为了类型好看就把已知策略的
   * 字段平铺上来 —— 那会让表结构重新长回配方的样子。
   */
  params: Record<string, unknown>;

  enabled: boolean;
  /** 多久跑一次(分钟)。⚠️ 只在 enabled 时有意义 */
  intervalMinutes: number;
  lastRunAt?: string;

  /**
   * ⭐⭐ 这个任务**属于**哪个 ws —— 必填,创建时定死(用户 2026-09-14 拍板)。
   *
   * > 「应该是在哪个窗口配置,就是打开哪个窗口才执行吧?
   * >   任何的配置只是对自己的窗口负责。」
   *
   * ⚠️ 这不是「可选的定向」,是**归属**:在 ws-2 配的任务就是 ws-2 的任务,
   * ws-1 既看不见也不会跑。任务列表按 ws 过滤,新建时取当前窗口的 wsId,**不给选**。
   *
   * ── 为什么必须是归属而不是「留空=所有 ws」──
   *
   * 留空那版实测有三个洞(2026-09-14):
   *  · 同一任务在两个 ws 上**并行跑**,抓同一批推、翻译调两次(刚被 429 限流过)、
   *    两个 ws 同时导航滚动 = 很强的自动化信号
   *  · `run_state` 是任务级的,并行时后完成的**覆盖**先完成的 `lastResult` ——
   *    数字看着正常,只是少了一半
   *  · ⚠️ webview 租约**挡不住**它:租约按 pageId,两个 ws 是两个 pageId,
   *    各拿各的。租约防的是「同一 webview 上两任务撞车」,不是「同一任务跨 ws 并行」
   *
   * ⭐ 归属模型下,这三个洞**结构上不可能出现** —— 而不是靠人填对。
   *
   * ⚠️ 与 `x_ws_role` 不重复:那是「这个 ws 干哪类事」(粗,人配置),
   * 本字段是「这个任务是谁的」(归属)。
   */
  wsId: string;

  // ── 运行期状态(不是配置)──
  runState?: XTaskRunState;
  /** ⚠️ 失败原因要留着 —— 「跑了没成功」和「没跑」在界面上长得一样 */
  lastError?: string;
  /** 上次跑的产出摘要,供列表页显示「上次采了多少」 */
  lastResult?: {
    fetched?: number;
    saved?: number;
    duplicates?: number;
    elapsedMs?: number;
  };
}

/** 新建任务时可省略的字段 */
export type XTaskInput = Omit<XTask, 'id' | 'runState' | 'lastError' | 'lastResult'>
  & { id?: string };
