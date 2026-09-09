/**
 * `web.page` 数据模型(`06-data-model-and-interfaces.md` §1.4 / §4.1)
 *
 * ⭐ 本文件最重要的一件事:**身份不透明,且不由维度拼出。**
 *
 * 初版方案 `pageId = ${windowId}:${wsId}:${slot}:${serviceId}` 已被否决(`06` §8.1),
 * 一个反例打穿:内置浏览器有 tab(`src/views/web/data-model.ts` 的 `tabs: WebTab[]`),
 * 同 ws 开三个标签页会算出**同一个 id**。要治的病在方案自身复发。
 *
 * 错因(原文记录,比结论有用):
 *  1. 拿故障史倒推维度 = 给已知的坑各配一把钥匙,不是建模 —— 下一个没出过事的坑必然漏掉
 *  2. 把「身份」和「位置」混进一个 id —— 位置一变身份就变,trace 断、订阅断、租约失效
 *
 * 所以这里:`PageId` 是**不透明串**,位置(window/ws/slot/tabId)只是 facts 的字段。
 * 判据:**加一个没想到的维度 = 加一个 facts 字段,身份不动。**
 */

/**
 * 不透明页面身份。生到死不变。
 *
 * ⚠️ 调用方**只用它、不解析它、不从维度拼它**。
 * 这里用 branded type 让「自己拼一个 pageId」在**类型层面**就过不去 ——
 * 参考 `06` §3.3 的同一手法(`run` 只收脚本 id 不收脚本串,把事故类型化根治)。
 */
export type PageId = string & { readonly __brand: 'web.page.PageId' };

/** 谁开的这个页面。用于区分「X 服务的页面」和「浏览器里恰好停在 x.com 的 tab」 */
export type PageOwner = string;

/** 左右分栏。见记忆 `project-slot-symmetry`:已从主从改对称,单一来源 activeSlot */
export type PageSlot = 'left' | 'right';

/**
 * 页面生命周期状态。
 *
 * ⚠️ **状态不参与身份**(`06` §2.4)—— 它只影响「现在能不能做事」,
 * 不影响「是哪个」。否则页面一 loading 身份就变了,又回到老问题。
 */
export type PageState = 'loading' | 'interactive' | 'complete' | 'unknown';

/**
 * 页面的**可查、可变属性**。位置和状态都在这里,身份不在。
 *
 * 对照 V1 `BrowserState`:补了 `window` / `slot` / `tabId` / `owner`,
 * 去掉了 `frames` / `downloads` / `selection`(那些属于 web.dom / web.net,不属于控制层)。
 */
export type PageFacts = {
  /** 不透明身份,生到死不变 */
  readonly pageId: PageId;
  /** 哪个 app 窗口。多窗口下每窗口各有活跃 ws,见记忆 `project-host-broadcast-multi-ws-fanout` */
  readonly window: string;
  /** 哪个 workspace */
  readonly ws: string;
  /** 左栏还是右栏 */
  readonly slot: PageSlot;
  /** 内置浏览器的标签页 id;非 tab 化的页面(AI view 等)没有这一维 */
  readonly tabId?: string;
  /**
   * 页面所在的 session partition(如 `persist:webview-ws-1` / `persist:webview-translate`)。
   *
   * ⚠️ **必填,没有默认值。** 缺省成 `persist:webview` 会让「忘了传」变成
   * 静默错配到别的 session —— 那正是本仓明令禁止的静默兜底。
   *
   * 两个硬需求逼出这个字段(`06` §1.4):
   *  1. `prepare` 要挂 `webRequest`,**必须知道页面在哪个 partition**,否则挂不上
   *  2. 剥 CSP 是**整个 partition 生效**的 —— facts 拿不到 partition 就
   *     回答不了「这次 prepare 会波及哪些别的页面」
   *
   * 它与 window / ws / slot 同类:**位置事实,可查、可变、不参与身份**。
   */
  readonly partition: string;
  /** 谁开的(如 'x-service' / 'ai-service' / 'browser') */
  readonly owner: PageOwner;
  /** 当前停在哪个站(如 'x' / 'google')。跨站导航时**这个变,pageId 不变** */
  readonly service?: string;
  readonly url: string;
  readonly state: PageState;
};

/**
 * `find` 的条件 —— **全部是事实性的**(`06` §2.1)。
 *
 * ⚠️ 注意这里**没有** state / loading 之类的筛选项:状态不参与「是哪个」(§2.4)。
 * 想知道能不能做事,用 `ready()`,不是把它塞进 find。
 */
export type PageQuery = {
  readonly window?: string;
  readonly ws?: string;
  readonly slot?: PageSlot;
  /** 精确相等匹配,与其它条件同规格 —— 不做前缀/包含匹配 */
  readonly partition?: string;
  readonly owner?: PageOwner;
  readonly service?: string;
  readonly urlIncludes?: string;
};

/** 注册一个新页面时要给的事实。pageId 由底座分配,调用方给不了 */
export type RegisterPageInput = {
  readonly window: string;
  readonly ws: string;
  readonly slot: PageSlot;
  readonly tabId?: string;
  /** ⚠️ 必填。底座**不猜** partition —— 见 `PageFacts.partition` 的注释 */
  readonly partition: string;
  readonly owner: PageOwner;
  readonly service?: string;
  readonly url?: string;
  readonly state?: PageState;
};

/**
 * 页面事实的可变部分。
 *
 * ⭐ 注意 `pageId` 不在里面 —— **身份不可改**,这是编译期强制的。
 * 换 slot / 换窗口 / 拖 tab / 跨站导航,改的都是这里的字段。
 */
export type PageFactsPatch = {
  readonly window?: string;
  readonly ws?: string;
  readonly slot?: PageSlot;
  readonly tabId?: string;
  /**
   * ⭐ **可变**。V2 的 partition 是 per-ws 的(`persist:webview-${wsId}`),
   * 而「换 ws 时 pageId 不变」是已验收的不变量(`06` §1.6)——
   * 两条合起来只有一个结论:换 ws 时 partition 必须能跟着改。
   * 若把它做成不可变,换 ws 后 facts 里的 partition 就是**过期的谎话**,
   * prepare 会挂到旧 session 上。
   */
  readonly partition?: string;
  readonly owner?: PageOwner;
  readonly service?: string;
  readonly url?: string;
  readonly state?: PageState;
};

/** 页面占用租约(`06` §3.1 的 lease/release)*/
export type Lease = {
  readonly leaseId: string;
  readonly pageId: PageId;
  /** 干什么用的 —— 排查「谁占着」时唯一的线索,不许空 */
  readonly purpose: string;
  readonly acquiredAt: number;
  /** 到期时刻(epoch ms)。undefined = 不过期,必须显式 release */
  readonly expiresAt?: number;
};

/** 页面生命周期事件(供 web.trace 消费;本步只发,不接消费者)*/
export type PageLifecycleEvent =
  | { readonly kind: 'page-created'; readonly pageId: PageId; readonly facts: PageFacts; readonly at: number }
  | { readonly kind: 'page-destroyed'; readonly pageId: PageId; readonly at: number }
  | { readonly kind: 'page-navigated'; readonly pageId: PageId; readonly url: string; readonly service?: string; readonly at: number }
  | { readonly kind: 'page-moved'; readonly pageId: PageId; readonly facts: PageFacts; readonly at: number };
