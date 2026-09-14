/**
 * `web.trace` 数据模型(`05-observability-and-maintenance.md` §3 / `06` §3.5)
 *
 * ⚠️ `DegradationRecord` **直接采用可靠性纲领 §3 已定的结构,不重新发明**:
 *   { ts, layer, capability, operation, category, reason, inputRef, rawSnippet }
 * `category` 用纲领 §2 的分类学。
 */

/**
 * 故障分类(可靠性纲领 §2 分类学,字面对齐)。
 *
 * ⭐ **`unexpected-format`(格式外)是站点改版的主要形态** ——
 * selector 失效归到这一类,于是「X 改版了」就从一次次孤立报障
 * 变成一个**可统计的指标**:某 adapter 的格式外计数突然上升 = 那个站改版了。
 * 这就是 `05` §4.5 说的「持续接待能力」。
 */
export type DegradationCategory =
  /** 格式外:输入合法但命中了尚未支持/未预期的构造。⭐ selector 失效属这类 */
  | 'unexpected-format'
  /** 解析崩溃:解析器在某单元上抛异常 */
  | 'parse-crash'
  /** 资源失败:依赖的 IO/IPC/媒体存储失败。网络请求本身失败属这类 */
  | 'resource-failure'
  /** 契约违反:产物违反下游 schema/不变量。落地确认失败(填了没进去)属这类 */
  | 'contract-violation'
  /** 系统级:启动失败/层不可用。CDP attach 失败属这类 */
  | 'systemic';

/** 能力层名。⚠️ 用 `web.*`,**不用 L0/L1**(见 `05` §1 与本层 README) */
export type CapabilityLayer = 'web.page' | 'web.net' | 'web.dom' | 'web.input' | 'web.trace';

/** 可靠性纲领 §3 的 record 结构 */
export type DegradationRecord = {
  readonly ts: number;
  readonly layer: CapabilityLayer;
  /** 更细的能力/站点标识(如 'x' / 'claude'),用于按站点统计格式外计数 */
  readonly capability?: string;
  readonly operation: string;
  readonly category: DegradationCategory;
  readonly reason: string;
  /** 指向输入的引用(如 bodyRef / pageId),便于回放 */
  readonly inputRef?: string;
  /** 原始片段。⚠️ 记不记、记多少由**调用方**决定,底座不判断敏感性 */
  readonly rawSnippet?: string;
};

export type LifecycleRecord = {
  readonly ts: number;
  readonly layer: CapabilityLayer;
  readonly event: string;
  readonly pageId?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
};

export type NetworkTraceRecord = {
  readonly ts: number;
  readonly pageId: string;
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly status?: number;
  /** 载荷到底来没来 —— `05` §3.2 明确要求记这个 */
  readonly gotBody: boolean;
  /** 哪个 provider 给的(cdp / webRequest) */
  readonly provider?: string;
};

/** 自愈留痕(`05` §4.2:静默自愈 = 把问题藏起来,违反铁律三) */
export type RecoveryRecord = {
  readonly ts: number;
  readonly layer: CapabilityLayer;
  readonly what: string;
  readonly outcome: 'recovered' | 'failed';
  readonly detail?: string;
};

/**
 * 配额(`05` §4.3)。
 *
 * V1 的 trace-writer 是**开发期工具**可以无限写;V2 跑在**用户机器**上必须有配额,
 * 否则「诊断模块」自己把磁盘/内存吃满 —— 那正是要避免的。
 */
export type TraceQuota = {
  readonly maxLifecycle?: number;
  readonly maxNetwork?: number;
  /** ⭐ degradation 保留得**更久**(低频事件,`05` §3.2 三条流保留策略不同) */
  readonly maxDegradation?: number;
  readonly maxRecovery?: number;
};

/**
 * 记录开关(`05` §4.3:默认只开 lifecycle + degradation)。
 *
 * ⚠️ 这是**调用方给的参数**,底座不内置任何站点规则(`05` §4.4,用户已裁定)。
 */
export type TraceSwitches = {
  readonly lifecycle?: boolean;
  readonly network?: boolean;
  readonly degradation?: boolean;
  readonly recovery?: boolean;
};

/** 健康探针的返回(`06` §3.5 / `05` §4.1)*/
export type HealthReport = {
  readonly layer: CapabilityLayer;
  readonly alive: boolean;
  readonly since: number;
  readonly metrics: Readonly<Record<string, number>>;
  /** ⚠️ 空数组 = 健康。非空即不健康,且**每条都要说清原因** */
  readonly problems: readonly string[];
};
