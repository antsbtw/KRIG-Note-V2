/**
 * X(Twitter)Service Profile 类型定义
 *
 * 铁律 3(profile 独立,用户已拍板):不扩展 AIServiceId / AIServiceProfile。
 * AI 的 profile 是问答语义(messageList / userMessage / assistantMessage)、SSE 拦截策略、
 * AIServiceId 写死三家 —— X 全用不上。X 自成一套:
 * - selectors 语义为 tweetElement(读方向,本阶段)/ composeBox / replyBox / publishButton
 *   (写方向,阶段 2 才用,本阶段先留字段、可空)。
 * - urlPattern 匹配 x.com / twitter.com,homeUrl = https://x.com/home。
 *
 * 与 AIServiceProfile 完全独立,X 提取/发布逻辑不污染 AI 问答逻辑。
 */

// ═══════════════════════════════════════════════════════
// §1  X Service ID
// ═══════════════════════════════════════════════════════

/** X 目前只一家(留 union 形态便于未来同模式扩展,如 mastodon / bluesky) */
export type XServiceId = 'x';

// ═══════════════════════════════════════════════════════
// §2  XServiceSelectors
// ═══════════════════════════════════════════════════════

export interface XServiceSelectors {
  /** 推文 article 容器(读方向,阶段 1 用)— X 官方 data-testid */
  tweetElement: string;
  // ── 写方向 selector(阶段 2)。支持逗号分隔多候选,运行时顺序命中(容错 X 改版)。──
  /** 发推 compose 输入框(阶段 2)*/
  composeBox?: string;
  /** 回复框(阶段 2)— X 上 reply 框与 compose 框通常同 testid(tweetTextarea_0)*/
  replyBox?: string;
  /** 发布按钮(阶段 2)— ⚠️ 仅用于「定位 / 校验内容落地」,写方向红线:绝不程序 click */
  publishButton?: string;
  // ── 媒体上传 selector(阶段 2.5-b,路线 B:喂文件给 X 自己的上传控件)──
  /**
   * 发推/回复框的文件上传 `<input type=file>`(阶段 2.5-b)。
   * 路线 B 关键:把 note 的图喂给这个 input(DataTransfer 注入 + change 事件),
   * 由 X 前端自己完成 INIT/APPEND/FINALIZE,我们绝不碰官方 API。
   * ⚠️ 待实机 spike 校验(X 改版频繁,失效 fail loud 降级「请手动拖图」)。
   */
  fileInput?: string;
  /**
   * 喂文件后 X 生成的「已上传媒体缩略图 / 移除按钮」(阶段 2.5-b)。
   * 喂完 poll 等它出现 = X 真接住了文件的证明;没出现 → fail loud(不假装成功)。
   * ⚠️ 待实机 spike 校验。
   */
  uploadedMediaThumb?: string;

  // ── X Articles 原生 Insert 驱动 selector(终态发布,2026-06-13)──
  /**
   * X Article 编辑器各模态/按钮的 selector(驱动原生 Insert 发长文用)。
   * 与发推/回复那组**完全独立**(别污染):Article 是独立编辑器(独立路由/富文本引擎),
   * 其 Insert 模态 DOM 与 compose 框无关。失效 fail loud(驱动器据此降级提示)。
   * ⚠️⚠️ 全部「待总指挥实机 spike 抓真实 data-testid」—— 见下方 ARTICLE_SELECTORS 注释。
   */
  article?: XArticleSelectors;
}

/**
 * X Article 原生 Insert 驱动所需的 selector 集合。
 *
 * 交互模式(总指挥实测,见 docs/tasks/2026-06-13-x-articles-native-insert-impl-prompt.md §6):
 *   点 Insert 触发钮 → 弹菜单 → 点项(LaTeX/Table/Code/Posts/Media/Divider)→ 弹模态
 *   → 往文本框填内容 → 点 Update/确认 → 模态关闭 → 块插入完成。
 *
 * ⚠️⚠️ 红线:**全部待实机 spike 抓真实 data-testid**。下面的初值多用「实测可见 placeholder 文本」
 *   (§6 总指挥已见,是真实证据)作主候选,辅以常见 aria-label/role,**不是抓到的 data-testid**。
 *   X 改版/本地实测后务必逐个 devtools 核对替换;失效时驱动器 fail loud(不静默假装成功)。
 */
export interface XArticleSelectors {
  /** Article 正文编辑区(合成 paste 文字 HTML 落点)。 */
  body: string;
  /** Article 标题输入框(note isTitle → 填这里)。 */
  titleInput: string;
  /** Insert 菜单触发钮(＋ / Insert ▾)。 */
  insertTrigger: string;
  /**
   * 菜单项容器 selector(点 insertTrigger 后出现的可点项,如 [role="menuitem"])。
   * 驱动器用 querySelectorAll(menuItem) 拿全部项,再按**可见文本**(下面 menuLabels)匹配点击
   * —— 因 `document.querySelector` 不支持 `:has-text()`,菜单项必须靠文本筛而非纯 CSS。
   */
  menuItem: string;
  /**
   * 各 Insert 项的**可见文本标签**(驱动器在 menuItem 列表里按 textContent 包含匹配)。
   * 实测 §6 菜单项:Media / GIF / Posts / Divider / Code / LaTeX / Table。
   */
  menuLabels: {
    latex: string;
    table: string;
    code: string;
    posts: string;
    media: string;
    divider: string;
  };
  // ── 各模态的输入框 + 确认按钮 + 关闭判据 ──
  /** LaTeX 模态输入框(placeholder "Add a LaTeX expression here") */
  latexInput: string;
  /** Table 模态 markdown 输入框(placeholder "Add markdown here") */
  tableInput: string;
  /** Code 模态语言搜索框(placeholder "Search programming language") */
  codeLangInput: string;
  /** Code 模态代码框(placeholder "Add code here") */
  codeInput: string;
  /** Posts 模态 URL 输入框(placeholder "Paste post URL") */
  postsUrlInput: string;
  /**
   * 模态确认按钮容器 selector(底部按钮，如 [role="button"]/button)。驱动器用它 + 下面
   * modalButtonLabels 按可见文本(Update/Save)匹配点击(同菜单项,纯 CSS 选不中文本)。
   */
  modalButton: string;
  /** 模态确认按钮可见文本标签(实测:LaTeX/Table/Code 模态底部 "Update";Media Crop "Save")。 */
  modalButtonLabels: {
    update: string;
    save: string;
  };
  /** Media 模态(网页内 Crop media)的文件 input(喂文件)。 */
  mediaFileInput: string;
  /** 喂图成功后正文里图块的判据(poll 等它出现 = X 真接住)。可空(空则只 warn 不 fail)。 */
  mediaInsertedThumb?: string;
}

// ═══════════════════════════════════════════════════════
// §3  XServiceProfile
// ═══════════════════════════════════════════════════════

export interface XServiceProfile {
  /** 服务标识 */
  id: XServiceId;
  /** 显示名称 */
  name: string;
  /** 图标 */
  icon: string;

  // ── URL ──
  /** 基础 URL */
  baseUrl: string;
  /** 主页(Host 初始加载 + 「Home」按钮)*/
  homeUrl: string;
  /** 发推 compose 页(阶段 2「发到 X」确保 compose 框在场用)*/
  composeUrl: string;
  /** URL 匹配正则(字符串形式,运行时转 RegExp)— 匹配 x.com / twitter.com */
  urlPattern: string;

  // ── DOM ──
  selectors: XServiceSelectors;
}

// ═══════════════════════════════════════════════════════
// §4  X 配置
// ═══════════════════════════════════════════════════════

/**
 * X(Twitter)
 *
 * tweetElement 复用 tweet-fetcher/extract-script 同款官方 data-testid。
 * urlPattern 同时匹配 x.com(新域)与 twitter.com(旧域,仍会 302 到 x.com,
 * 但用户手动导航 / 旧链接仍可能落在 twitter.com,故一并识别)。
 */
const X_PROFILE: XServiceProfile = {
  id: 'x',
  name: 'X',
  icon: '𝕏',
  baseUrl: 'https://x.com',
  homeUrl: 'https://x.com/home',
  // /compose/post 打开独立发推弹窗(直达 compose 框,避免依赖首页布局)
  composeUrl: 'https://x.com/compose/post',
  urlPattern: '^https://(x\\.com|twitter\\.com)',
  selectors: {
    tweetElement: 'article[data-testid="tweet"]',
    // ── 写方向 selector(阶段 2)──
    //
    // ⚠️ SPIKE 待确认(总指挥本地 spike 后核对/替换):以下是 X 官方常用且本仓 read 方向
    //   extract-script 已在用的同体系 data-testid(稳定性与 tweetText/User-Name 同级),
    //   作为「待 spike 确认」的初值。X 改版频繁,务必在真机 devtools 核对一次:
    //   - composeBox:发推框(首页顶部「有什么新鲜事」/ /compose/post 弹窗 / reply 展开框)
    //       X 上发推与回复输入框同为 contenteditable,testid 通常是 tweetTextarea_0。
    //       多候选兜底:富文本 contenteditable 容器 [data-testid^="tweetTextarea_"]。
    //   - replyBox:同 composeBox(X reply 框点开后也是 tweetTextarea_0);保留独立字段
    //       便于将来 X 若区分时只改这里。
    //   - publishButton:发推/回复提交按钮。compose 弹窗用 tweetButton,
    //       内联(首页/详情页 reply)用 tweetButtonInline。⚠️ 仅定位校验,不 click。
    //
    // selector 清单同时誊抄进交付说明(X 改版会失效,要可查)。
    composeBox: '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"][contenteditable="true"], div[role="textbox"][data-testid^="tweetTextarea_"]',
    replyBox: '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"][contenteditable="true"], div[role="textbox"][data-testid^="tweetTextarea_"]',
    publishButton: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
    // ── 媒体上传 selector(阶段 2.5-b)──
    //
    // ⚠️ SPIKE 待实机校验(总指挥本地 spike 后核对/替换):以下取自开源 X 自动化库
    //   (XActions / twitter-automation-ai,见 roadmap §5)的已知起点,X 的发推/回复框
    //   媒体上传按钮背后都是一个隐藏的 <input type=file multiple accept="image/*,video/*">。
    //   - fileInput:X compose / reply 框的文件上传 input。官方 testid 长期是 fileInput。
    //       多候选兜底:accept 含 image 的隐藏 file input(testid 失效时)。
    //   - uploadedMediaThumb:喂文件后 X 在编辑器里渲染的已上传媒体缩略图 + 移除按钮容器。
    //       常见 testid:attachments(整组)/ removeMedia(单张移除按钮)。poll 它出现 =
    //       X 真把文件接住并开始上传的证明;没出现 → fail loud。
    //
    // selector 清单同时誊抄进交付说明(X 改版会失效,要可查)。
    fileInput: 'input[data-testid="fileInput"], input[type="file"][accept*="image"]',
    uploadedMediaThumb: '[data-testid="attachments"], [data-testid="removeMedia"], [aria-label*="Remove media"], [data-testid="media"]',

    // ── X Articles 原生 Insert 驱动 selector(终态发布,2026-06-13)──
    //
    // ⚠️⚠️ 全部「待总指挥实机 spike」:下面多用 §6 实测可见的 placeholder 文本(真实证据)
    //   作主候选 [placeholder="..."],辅以 aria-label/role 兜底。**这些不是抓到的 data-testid**
    //   —— 红线不凭记忆编 testid。本地 devtools 逐个核对后,把更稳的 data-testid 加到候选最前。
    //   失效时驱动器 fail loud(XArticleDriver 每步 selector 命不中 → 报错降级,不静默)。
    //   清单同时誊抄进交付说明(X 改版会失效,要可查)。
    article: {
      // 正文 / 标题:Article 编辑器富文本区与标题输入。data-testid 待抓,先用通用 contenteditable + 文章容器兜底。
      body: '[data-testid="editorParagraph"], div[role="textbox"][contenteditable="true"], article div[contenteditable="true"]',
      titleInput: '[data-testid="articleTitleInput"], textarea[placeholder*="Title" i], input[placeholder*="Title" i]',
      // Insert 触发钮:工具栏里的 ＋/Insert。待抓 testid;先用 aria-label 兜底。
      insertTrigger: '[data-testid="insertButton"], button[aria-label*="Insert" i], button[aria-label*="Add" i]',
      // 菜单项:点 Insert 后弹的可点项(role=menuitem 常见)。驱动器按 menuLabels 文本筛(见类型注释)。
      menuItem: '[role="menuitem"], [role="option"], [data-testid="Dropdown"] [role="button"]',
      // 各 Insert 项可见文本(实测 §6 菜单:Media/GIF/Posts/Divider/Code/LaTeX/Table)。
      menuLabels: {
        latex: 'LaTeX',
        table: 'Table',
        code: 'Code',
        posts: 'Posts',
        media: 'Media',
        divider: 'Divider',
      },
      // 各模态输入框:§6 实测 placeholder 文本(真实证据)作主候选,辅以模糊 placeholder 兜底。
      latexInput: 'textarea[placeholder="Add a LaTeX expression here"], textarea[placeholder*="LaTeX" i]',
      tableInput: 'textarea[placeholder="Add markdown here"], textarea[placeholder*="markdown" i]',
      codeLangInput: 'input[placeholder="Search programming language"], input[placeholder*="programming language" i]',
      codeInput: 'textarea[placeholder="Add code here"], textarea[placeholder*="code" i]',
      postsUrlInput: 'input[placeholder="Paste post URL"], input[placeholder*="post URL" i]',
      // Update/Save:模态底部按钮容器(驱动器按 modalButtonLabels 文本筛)。
      modalButton: 'button, [role="button"]',
      modalButtonLabels: { update: 'Update', save: 'Save' },
      // Media(网页内 Crop media):文件 input。复用通用隐藏 image input 兜底。
      mediaFileInput: 'input[type="file"][accept*="image"], input[data-testid="fileInput"]',
      // 喂图成功判据:正文里出现图块(待抓 testid;空 = 只 warn 不 fail)。
      mediaInsertedThumb: 'article img, figure img',
    },
  },
};

// ═══════════════════════════════════════════════════════
// §5  注册表 + 查询
// ═══════════════════════════════════════════════════════

/** 所有已注册的 X 服务 Profile */
export const X_SERVICE_PROFILES: readonly XServiceProfile[] = [X_PROFILE] as const;

/** 默认 X 服务 */
export const DEFAULT_X_SERVICE: XServiceId = 'x';

/** 根据 ID 查 Profile */
export function getXServiceProfile(id: XServiceId): XServiceProfile {
  const profile = X_SERVICE_PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown X service: ${id}`);
  return profile;
}

/**
 * 根据 URL 检测 X 服务。
 * @returns 匹配的 Profile,未匹配返回 null
 */
export function detectXServiceByUrl(url: string): XServiceProfile | null {
  return X_SERVICE_PROFILES.find((p) => new RegExp(p.urlPattern).test(url)) ?? null;
}
