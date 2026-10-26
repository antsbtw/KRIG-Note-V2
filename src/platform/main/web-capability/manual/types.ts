/**
 * ⭐⭐⭐ 站点说明书的格式(设计 `04-site-manual-self-repair.md` §4,P2 2026-10-19 定)
 *
 * ⭐ 铁律 1(§4.2):**说明书只有声明,没有可执行代码**。
 * 能出现在说明书里的只有:路径(`$变量.键.键`)、字面量、正则字符串、条件组合。
 * 引擎照着执行;AI 改说明书 = 改数据,注入不了脚本 —— 这是将来让 AI 自己改它的安全前提。
 *
 * ── 路径怎么写(为什么不用 JSONPath)──
 * `$body.itemContent.tweet_results` —— 以变量开头,点号取键;只有末尾允许 `[*]`(把数组摊开)。
 * 常见 JSONPath 库的过滤表达式 `?(@.x=='y')` 是靠 eval 实现的,等于把代码塞进了数据;
 * 这套小语法引擎能在**加载时逐条自检**(变量在这个位置有没有、正则编不编得过),
 * 错了当场报出来是哪一段哪一条,不等到真机跑出 0 条才发现。
 *
 * ⭐ 底座**不认识任何站点**:这里只有格式,X 的那份在 `src/modules/x/manual/`。
 */

/** 路径:`$变量` 开头,`.键` 往下取,末尾可带 `[*]`(只在「取一串」的位置) */
export type ManualPath = string;

/**
 * 取值:一条路径,或「几条里取第一个」。
 * · `first`       第一个不是 null / undefined 的
 * · `firstObject` 第一个是对象的
 * · `firstString` 第一个非空字符串
 */
export type ManualValue =
  | ManualPath
  | { readonly first: readonly ManualPath[] }
  | { readonly firstObject: readonly ManualPath[] }
  | { readonly firstString: readonly ManualPath[] };

/** 条件 —— 只有这几种,组合用 any / all / not */
export type ManualCond =
  | { readonly isObject: ManualValue }
  | { readonly isArray: ManualValue }
  | { readonly nonEmpty: ManualValue }
  | { readonly equals: readonly [ManualValue, string] }
  | { readonly contains: readonly [ManualValue, string] }
  /** 第三项是正则标志(如 `"i"`),可省 */
  | { readonly matches: readonly [ManualValue, string] | readonly [ManualValue, string, string] }
  | { readonly any: readonly ManualCond[] }
  | { readonly all: readonly ManualCond[] }
  | { readonly not: ManualCond };

/** 认出来但没 id 的东西怎么记:计数(墓碑之类),或记成「不认识」 */
export type ManualNoId = { readonly countAs: string } | { readonly unknownAs: string };

/** 游标条目 */
export type CursorRule = {
  readonly rule: 'cursor';
  /** 为什么这么写(人和 AI 改之前看) */
  readonly why?: string;
  readonly when: ManualCond;
  readonly value: ManualValue;
  /** 方向字段;按 `directions` 映射(不分大小写)。映射不到的单独计数,不丢 */
  readonly direction: ManualValue;
  readonly directions: Readonly<Record<string, 'up' | 'down'>>;
};

/** 带 id 的条目(推文 / 人 …) */
export type ItemRule = {
  readonly rule: 'item';
  readonly why?: string;
  readonly kind: string;
  readonly when: ManualCond;
  /** 条目对象在哪;之后的路径用 `$node` 指它 */
  readonly node: ManualValue;
  /** 包了一层的话剥开(按顺序试,命中一条就换成 `to`) */
  readonly unwrap?: readonly { readonly when: ManualCond; readonly to: ManualValue }[];
  readonly id: ManualValue;
  /** 条目对象不在、或 id 为空 */
  readonly missing: ManualNoId;
  /** 有 id 但不可见(墓碑 / 受限)*/
  readonly hidden?: { readonly when: ManualCond } & ManualNoId;
  /** 同一种条目里再细分(广告推文 …),命中第一条就记成它的 kind */
  readonly variants?: readonly { readonly kind: string; readonly when: ManualCond }[];
};

/** 模块条目(对话串 / 推荐卡):里面一项一项再按规则分 */
export type GroupRule = {
  readonly rule: 'group';
  readonly why?: string;
  readonly when: ManualCond;
  /** 子项列表,必须以 `[*]` 结尾 */
  readonly children: ManualPath;
  /** 子项的 id / 内容;用 `$child` 指子项 */
  readonly childId: ManualValue;
  readonly childBody: ManualValue;
};

export type CensusRule = CursorRule | ItemRule | GroupRule;

/**
 * ⭐⭐ 清点:一份载荷里「网站列了什么」。
 *
 * 走法:深找所有带 `find` 键(且是数组)的对象 → 数组里每一项是一个容器(`$ins`)
 * → 从容器取条目(`$entry`)→ 每个条目算出 `$id` / `$body` / 各 `bind`
 * → 按 `rules` 顺序第一条命中的归类;都不中记「不认识」,名字由 `unknownName` 从 `$id` 算。
 */
export type CensusSpec = {
  readonly containers: {
    readonly find: string;
    readonly label: ManualValue;
    readonly labelMissing: string;
  };
  /** 从容器里取条目的几处;以 `[*]` 结尾的摊开,否则取那一个对象 */
  readonly entries: readonly ManualPath[];
  readonly entry: { readonly id: ManualValue; readonly body: ManualValue };
  /** 给常用的子对象起名字,规则里用 `$名字` */
  readonly bind?: Readonly<Record<string, ManualValue>>;
  readonly rules: readonly CensusRule[];
  readonly unknownName: { readonly strip: readonly string[]; readonly empty: string };
};

/**
 * 「这一页是不是按时间排的」—— 只有按时间排的页判翻页方向才有意义。
 * 按顺序找第一条 `url` 正则命中的规则;它说了算:`require` 里的子串都在 → 是,否则不是。
 * 一条都不中 → 不是。URL 先解码再比。
 */
export type OrderedByTimeRule = { readonly url: string; readonly require?: readonly string[]; readonly why?: string };

/** ⭐ 说明书外 —— 真需要计算、说明书表达不了的,显式登记(§4.2 铁律 3:数量本身就是指标) */
export type OutsideEntry = { readonly what: string; readonly where: string; readonly why: string };

export type SiteManual = {
  readonly site: string;
  readonly version: number;
  readonly data: {
    readonly census: CensusSpec;
    readonly orderedByTime: readonly OrderedByTimeRule[];
    /** 采集时不要的 URL 子串(交给底座 `noisyUrlSubstrings`);⚠️ 只挡确定不要的,挡错 = 静默丢数据 */
    readonly noise: readonly { readonly url: string; readonly why: string }[];
  };
  readonly outside: readonly OutsideEntry[];
};

/** 清点结果 —— 与站点无关的形状 */
export type Census = {
  /** kind → id(去重,保持第一次出现的顺序) */
  readonly items: Readonly<Record<string, readonly string[]>>;
  /** 没有 id、只计数的(墓碑 …) */
  readonly counts: Readonly<Record<string, number>>;
  /** 同方向多个时取最后一个(与载荷里的顺序一致) */
  readonly cursors: { readonly up?: string; readonly down?: string };
  /** 方向映射不到的游标:方向名 → 个数 */
  readonly otherCursors: Readonly<Record<string, number>>;
  /** 不认识的条目:名字 → 个数 */
  readonly unknown: Readonly<Record<string, number>>;
  /** 容器的种类 → 个数(看这一页的结构) */
  readonly containers: Readonly<Record<string, number>>;
};
