/**
 * `web.input` 数据模型(`01-contract.md` §10)
 *
 * ── 这一层管什么、不管什么(§10 边界)──
 *
 * | 管(动作)                    | 不管(内容)        |
 * |------------------------------|--------------------|
 * | 怎么把文本**真的放进框里**   | 该是什么格式       |
 * | 怎么确认**真的落地了**       | 内容对不对         |
 * | 怎么把文件**真的喂给上传控件** | 该喂哪个文件     |
 * | 往**哪个作用域**填           | 哪个模态是「对的」 |
 *
 * ⚠️ **底座不认识 markdown。** 业务侧以 markdown 为源,adapter 转成目标格式
 * (X 发推要纯文本、X 长文要 HTML、AI 提问要纯文本)。本层只收**最终形态**。
 *
 * 🚦 **发布闸门(§7.1)不在本层。** `tap` 是中立原语:不分等级、不设危险词表、
 * **不拒绝任何目标**。证据(§10.3):同一个「发送按钮」,AI 必须自动点(问答语义),
 * X 绝不能点(发布不可撤回)—— 差别在**业务语义**,不在按钮本身,底座无从判断。
 */

import type { AnchorName, ScriptId } from '../dom/types';

export type { AnchorName, ScriptId };

/**
 * ⭐ 作用域 —— 本层的核心新增(§10.1)。
 *
 * **为什么必须有**:X 长文是「点 Insert → 弹菜单 → 点项 → **弹模态** →
 * 往模态里填 → 点 Update → **等模态关闭**」。
 * 没有作用域,`type` 只能「往页面上第一个匹配的框填」——**模态叠模态时会填错地方**。
 *
 * 现有代码里这件事是**手搓的**:`x-article-driver.ts:1005-1011` 为了点到
 * 「本块的铅笔按钮」,得先 `closest()` 再往上爬 5 层 parent 逐层 `querySelectorAll`。
 * 那段逻辑既没有名字也没有失败语义 —— `within` 就是把它变成模型里的一等公民。
 */
export type InputScope =
  | { readonly kind: 'main' }
  /**
   * ⚠️ **本轮只留类型位置,不实现**(§10.5)。
   * 实测 X / AI 现有代码**零处操作 iframe**,没有真实消费者。
   * 真遇到再补(届时 `web.page` 要一并补 `frames()`)。
   * 传进来会得到 `frame-not-found` 的**明确失败**,不会被静默当成 `main`。
   */
  | { readonly kind: 'frame'; readonly frameId: string }
  /** ⭐ 模态 / 抽屉 / 下拉:锚点只在这个容器内解析 */
  | { readonly kind: 'within'; readonly container: AnchorName };

/**
 * 作用域解析结果(§10.1)。
 *
 * ⚠️ **`ambiguous` 必须报错,不许挑第一个** —— 与 `web.page` 的 `find` 同源:
 * **底座不替调用方挑**。挑错了是应用的问题;悄悄替你挑是底座的问题。
 */
export type ScopeResolution =
  | { readonly ok: true; readonly scopeDesc: string }
  | {
      readonly ok: false;
      readonly reason: 'frame-not-found' | 'container-not-found' | 'ambiguous';
      /** 人能读懂的细节(命中几个、哪个容器)—— 排查时的第一条线索 */
      readonly detail: string;
    };

/**
 * 落地确认判据(§10.2)。
 *
 * ⚠️ **`kind:'none'` 必须显式写,不能是省略参数的默认** ——
 * 不校验是**明确的选择**,而省略参数的人可能只是忘了。
 * 这两件事在结果里必须能区分,否则「忘了校验」会伪装成「已确认落地」。
 */
export type LandingCheck =
  /** ⚠️ 显式声明「我不校验」。结果里 `checked:false`,且**绝不谎称 landed** */
  | { readonly kind: 'none' }
  /** 框内容包含某片段(现有实现的做法:取首 12 个非空白字符做包含匹配) */
  | { readonly kind: 'contains'; readonly fragment: string }
  /** 框内容与写入文本完全相等(去空白后) */
  | { readonly kind: 'exact' }
  /** 某锚点出现 —— 图片「缩略图出现」(秒级)/ 视频「转码完成」(60s+)共用这一种表达 */
  | { readonly kind: 'anchorAppears'; readonly anchor: AnchorName }
  /** 自定义判据,走预注册脚本(不收脚本字符串,同 `web.dom`) */
  | { readonly kind: 'custom'; readonly script: ScriptId };

/**
 * 实际走通的路径。
 *
 * ⭐ **`via` 是本轮新增的**:现有实现有三级兜底(合成 paste → OS Cmd+V →
 * execCommand/native setter),但**走了哪条只在 console**。
 * 出问题时这是第一条线索 —— 「填错格式」和「主路径失效降级了」是两回事:
 * 前者要改 adapter 的格式转换,后者说明站点改版把主路径打掉了。
 */
export type LandingVia =
  | 'synthetic-paste'
  | 'exec-command'
  | 'native-setter'
  | 'os-paste'
  /** ⚠️ 只在 `check:{kind:'none'}` 时出现 —— 「没校验」不是一种成功路径 */
  | 'unchecked';

/** 落地报告(§10.2)*/
export type LandingReport = {
  /** 有没有校验过。`check:{kind:'none'}` 时为 false */
  readonly checked: boolean;
  /** ⚠️ 没校验时**必须为 false** —— 不许把「没看」说成「成了」 */
  readonly landed: boolean;
  readonly via: LandingVia;
  /** 试了几条路径(含主路径)。>1 说明主路径失效了,是站点改版的早期信号 */
  readonly attempts: number;
};

/**
 * ⭐ `tap` 点完等什么(§10.3)。
 *
 * 血泪来源(`x-article-driver.ts:377` 注释):
 * 某 step 中途失败(模态没关)→ 下一 step 在**脏态**上启动 →
 * 点 Insert 打不开新菜单、填值填错地方 → **连环失败**(前面成、后面一连串崩)。
 *
 * 把「点完等什么」放进模型,让**脏态在类型层面可被表达**。
 */
export type TapSettle = {
  /** 等某锚点消失 —— 模态关闭的可靠判据(现有代码用 app-bar-close 消失) */
  readonly anchorGone?: AnchorName;
  /** 等某锚点出现 —— 模态打开 / 下一屏就绪 */
  readonly anchorAppears?: AnchorName;
  /** 等多久。不给则由实现给默认(见 `web-input.ts` 的 DEFAULT_SETTLE_MS) */
  readonly timeoutMs?: number;
};

/** `tap` 的结果:点到了,以及 settle 判据满没满足 */
export type TapReport = {
  /**
   * settle 判据是否满足。
   * ⚠️ **没给 settle 时为 false** —— 与 `LandingReport.landed` 同理:
   * 「没等」不能说成「等到了」。给了 `settle` 才可能为 true。
   */
  readonly settled: boolean;
  /** 有没有等过(给了 settle 才为 true)。用于区分「没等」和「等了没等到」 */
  readonly waited: boolean;
};

/**
 * 一次动作的公共部分。
 *
 * ⚠️ `scope` 可省(缺省 `main`),但 `check` **不可省**(见 `LandingCheck` 注释)。
 * 这条差别是刻意的:作用域的缺省有唯一合理答案(主文档);
 * 「校不校验」没有 —— 省略只可能是忘了。
 */
export type InputTargetBase = {
  readonly anchor: AnchorName;
  readonly scope?: InputScope;
};

export type FocusInput = InputTargetBase;

export type TypeInput = InputTargetBase & {
  /** 最终形态的纯文本。底座不认识 markdown,不做任何转换 */
  readonly text: string;
  /**
   * 可选富文本。传了则合成 paste 的 DataTransfer 额外带 `text/html`
   * (X Article 正文等认富文本粘贴的编辑器用)。
   * ⚠️ 只有主路径(合成 paste)用得到;兜底路径仍只走 text/plain。
   */
  readonly html?: string;
  readonly check: LandingCheck;
};

export type FeedInput = InputTargetBase & {
  /** 真实磁盘绝对路径。底座**不判断**该喂哪个文件 */
  readonly files: readonly string[];
  readonly check: LandingCheck;
  /**
   * 落地校验的超时。
   * ⚠️ 图和视频判据不同:图是「缩略图出现」(秒级),视频是「**转码完成**」(60s+)。
   * 同一个 `check` 表达,**由调用方给不同判据和 timeout** —— 底座不内置这个差别。
   */
  readonly timeoutMs?: number;
};

export type TapInput = InputTargetBase & {
  readonly settle?: TapSettle;
};

export type PressInput = {
  /** 按键名(如 'Escape' / 'Enter')。底座不解释语义 */
  readonly key: string;
  readonly scope?: InputScope;
};

export type HoverInput = InputTargetBase;
