/**
 * L-raw 原始层数据模型(`01-contract.md` §13)
 *
 * ── 这一层是干什么的 ──
 *
 * | 层 | 存什么 | 面向谁 | 保留 | 能重算? |
 * |---|---|---|---|---|
 * | **L-raw**(本层) | 原始响应体 / 文件 | **排查 / 回放 / 重解析** | **1 个月**(可配) | ❌ |
 * | L-struct | 解析后的领域对象 | 业务(中间态) | 会话级 | ✅ 从 L-raw |
 * | L-domain | `x_tweet` / note / … | 最终用户 | 业务规则定 | ⚠️ 部分 |
 *
 * **学费背书**:`tweet_feedback` 607 条历史采纳里 **449 条(74%)正文被 TTL 删掉**
 * —— 因为当时**只有 L-domain**。有 L-raw 后:业务表删了,一个月内还能重建。
 *
 * ⭐ **最值钱的一条**:拿一个月历史原始载荷**重跑解析器**,
 * 把「改进解析」从**等数据攒够**变成**立刻可验证**。
 */

/**
 * 取数机制(`01-contract.md` §12 的八种,字面对齐)。
 *
 * ⚠️⚠️ **本层对这八种一视同仁,不许有「这类不存」的分支**(§13.1)。
 *
 * 用户原话:「缓存就是大海,我们要从里面获取需要的东西可能是少量,
 * **但是不要把业务逻辑搞复杂影响可靠性。**」
 *
 * 初稿曾想「M4 不存」以省空间,**被否决**:那要引入分支规则
 * (每个调用点判断自己属于哪类,**判断错就丢数据**)——
 * **存储端加判断 = 拿可靠性换空间**,而空间恰是最不稀缺的。
 */
export type CaptureMechanism =
  /** CDP Network 域 —— 渲染**前**原始响应体 */
  | 'M1'
  /** 注入 fetch/XHR hook(SSE 属此类) */
  | 'M2'
  /** session.webRequest —— 仅元信息(无 body) */
  | 'M3'
  /** DOM 直读 —— 渲染**后**内容。⚠️ 全仓最广(36 文件),保真度最低,**照存** */
  | 'M4'
  /** 页面内主动 fetch(带登录态调站点 API) */
  | 'M5'
  /** 下载管线 —— 真实文件 bytes */
  | 'M6'
  /** cookies 导出 */
  | 'M7'
  /** postMessage 桥 */
  | 'M8';

export const ALL_MECHANISMS: readonly CaptureMechanism[] = [
  'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
] as const;

/**
 * ⭐ 七字段索引(§13.2)—— **全部与站点无关**。
 *
 * 为什么只有这七个:L-raw 层**站点知识 = 零,只认 URL 和 bytes**。
 * 这七样是 HTTP 本身的属性 + 我们自己的上下文,**任何网站都有**。
 *
 * > Chrome DevTools 的 Network 面板就是这个模型 —— 它能过滤**任何**网站的请求,
 * > 正因为它一个网站也不「认识」。
 *
 * **站点特化的索引归 adapter**:X 可建 `tweetId → bodyRef` 映射,
 * 存在 X 侧,**底座不需要知道它存在**。
 *
 * ```
 * 底座    大海 + 坐标(时间 / URL / 大小)
 * adapter 航海图(哪片海域有什么)
 * ```
 */
export type RawIndexEntry = {
  /** 取回 body 用的句柄。写入时由本层分配,**调用方不构造** */
  readonly ref: string;

  // ── 七个字段 ──
  /** ① 时间(epoch ms) */
  readonly ts: number;
  /** ② host。⚠️ 由本层从 URL 里解析,**不要调用方传** —— 传错了索引就查不着 */
  readonly host: string;
  /** ③ 完整 URL */
  readonly url: string;
  /** ④ 哪个页面(不透明 pageId) */
  readonly pageId: string;
  /** ⑤ 机制 M1..M8 */
  readonly mechanism: CaptureMechanism;
  /** ⑥ HTTP 状态。M4/M7/M8 这类没有 HTTP 状态的**留空**,不伪造一个 200 */
  readonly status?: number;
  /** ⑦ 大小(字节)。⚠️ 是**原始**大小,截断也记原始值(见 `truncated`) */
  readonly bytes: number;

  // ── 索引之外的现场信息 ──
  /** HTTP method(有就记) */
  readonly method?: string;
  readonly mimeType?: string;
  /**
   * 请求头 —— ⭐ **照存,参考 Chrome**(§13.1):排查需要完整现场。
   *
   * ⚠️ 里面会有 auth token / cookie。用户已裁定:
   * **照存,但不外发、不上报、清理时一并清**。
   * 「哪些数据敏感」是**应用层**的判断(§2),底座只负责
   * 「存得住、清得掉、不撑爆」。
   */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  /**
   * ⭐ **超限截断要标注**,不许静默截断。
   *
   * 静默截断最坏:回放时解析器在半截 JSON 上炸,而没人知道数据本来是全的 ——
   * 于是去改解析器,改的是个不存在的 bug。
   */
  readonly truncated?: boolean;
  /** 截断后实际落盘的字节数(仅 `truncated` 时有意义) */
  readonly storedBytes?: number;
};

/**
 * 查询条件 —— **七个字段各自都能查**。
 *
 * ⚠️ 全部是**事实性**筛选,没有「最相关的一条」这类择优 ——
 * 与 `web.page` 的 `find` 同源:**底座不替调用方挑**。
 */
export type RawQuery = {
  readonly since?: number;
  readonly until?: number;
  readonly host?: string;
  /** URL 包含匹配(Chrome DevTools 的 filter 就是这个语义) */
  readonly urlIncludes?: string;
  readonly pageId?: string;
  readonly mechanism?: CaptureMechanism;
  readonly status?: number;
  readonly minBytes?: number;
  readonly maxBytes?: number;
  /** 返回条数上限。⚠️ 不给则全返 —— 底座不替调用方决定「够了」 */
  readonly limit?: number;
};

/** 写入一条 L-raw 时要给的东西。`ref` 由本层分配,调用方给不了 */
export type RawWriteInput = {
  readonly ts?: number;
  readonly url: string;
  readonly pageId: string;
  readonly mechanism: CaptureMechanism;
  readonly status?: number;
  readonly method?: string;
  readonly mimeType?: string;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
};

/**
 * ⭐ 占用情况(§13.1「不设上限」≠「不管」)。
 *
 * 底座责任从**限制**变成**让用户看得见、管得着** ——
 * 用户要据此决定配多少,所以这个必须能报得出来。
 */
export type RawUsage = {
  readonly entries: number;
  /** 实际落盘字节数(截断后的) */
  readonly bytes: number;
  /** 最旧一条的时间。空库时 undefined */
  readonly oldestTs?: number;
  readonly newestTs?: number;
  /** 配额上限(便于调用方直接算百分比) */
  readonly maxBytes: number;
  readonly retentionDays: number;
  /** ⚠️ 是否已越过告警线 —— 「将满时告警,不是静默写爆」 */
  readonly overWarnThreshold: boolean;
};

/** 清理条件。不给任何条件 = 全清(一键清除) */
export type RawPurgeFilter = {
  /** 清掉**早于**这个时刻的(过期清理用) */
  readonly olderThan?: number;
  readonly host?: string;
  readonly pageId?: string;
};

export type RawPurgeReport = {
  readonly removedEntries: number;
  readonly removedBytes: number;
};

/** 配额(§13.1:默认宽松,用户可配) */
export type RawQuota = {
  /** 保留天数。默认 **30**(1 个月) */
  readonly retentionDays?: number;
  /**
   * 总体积上限(字节)。⭐ **默认宽松** ——
   * 爬虫持久化后空间需求会很大,写死上限会在最需要数据的时候丢数据。
   */
  readonly maxBytes?: number;
  /**
   * 单条 body 上限。超限**截断并标注**(不静默丢整条)——
   * 半条现场也比没有强,但必须说清楚它是半条。
   */
  readonly maxBodyBytes?: number;
  /** 占用超过这个比例就告警(0~1)。默认 0.9 */
  readonly warnRatio?: number;
};

/**
 * ⭐ 重启后重建内存索引的入参(§15.1 第 2 条)。
 *
 * ⚠️ **收整个 `loadIndex()` 的返回值,不只收 entries** ——
 * 这样调用方**没有机会把 `badLines` 丢掉**。只收 entries 的话,
 * 「有几行坏了」就要靠调用方自觉去查、去报,那是静默吞掉的标准配方。
 */
export type RawHydrateInput = {
  readonly entries: readonly RawIndexEntry[];
  /** 读盘时解析失败的行数(`FsRawSink.loadIndex()` 已经数好了) */
  readonly badLines: number;
};

/**
 * 重建报告。
 *
 * ⚠️ `bytes` 是**落盘字节数**(截断条目用 `storedBytes`),
 * 与 `usage().bytes` 同口径 —— 两者对不上就说明重建算错了。
 */
export type RawHydrateReport = {
  /** 真正装进索引的条数 */
  readonly restored: number;
  /** 重建出来的占用字节数 */
  readonly bytes: number;
  /** 读盘时就坏掉的行数(原样透传,便于调用方决定要不要告警) */
  readonly badLines: number;
};
