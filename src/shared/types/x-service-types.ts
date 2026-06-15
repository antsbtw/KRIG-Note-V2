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
  /**
   * Article 编辑器直达 URL(总指挥实机确认,2026-06-13):
   * `https://x.com/compose/articles` 直接进**空白 Article 编辑器**(有 "Add a title" + 正文区 +
   * Insert 菜单),不是列表页,无需再点「新建」。grep 到入口 `aria-label="Articles" href=/compose/articles`。
   * ⚠️ Article 是 X 权限功能:无权限账号访问该 URL **进不了编辑器**(驱动器导航后 poll 等不到正文/Insert
   * → fail loud 提示「该账号可能无 Article 发布权限」)。
   */
  composeUrl: string;
  /**
   * 「新建文章」按钮(实机发现:`/compose/articles` 有时落 **Articles 列表页**而非直达编辑器,
   * 列表页右上角有个铅笔图标要点它才进空白编辑器)。驱动器:导航后若没直达编辑器、但此按钮在场
   * → 点它进编辑器;两者都没有才判无权限。
   * ⚠️ 待 spike 抓真实 selector;先用 href/aria-label 兜底。
   */
  newArticleButton: string;
  /** Article 正文编辑区(合成 paste 文字 HTML 落点;也是「编辑器就绪 + 权限通过」的判据之一)。 */
  body: string;
  /**
   * 「块」selector(★ 2026-06-14 实测 X = DraftJS:每块 `[data-block="true"]`)。驱动器用它数块
   * 落定(块数 +N = 块真插入)。缺省走 DraftJS 默认 `[data-contents="true"] [data-block="true"]`。
   * 跨平台预留:未来 Reddit/微博各填自己的块判据(各编辑器块模型不同)。
   */
  blockSelector?: string;
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
  // ── 各模态的输入框 + 确认按钮 + 关闭判据(★ 实测:模态 textarea 无 placeholder,用 :not([placeholder])) ──
  /** LaTeX 模态输入框(模态内无 placeholder 的 textarea)。 */
  latexInput: string;
  /** Table 模态输入框兜底(★ 实测 Table 实为网格选行列,见 tableGridCellLabel;此为兼容兜底)。 */
  tableInput: string;
  /** Code 模态语言搜索框(实测 input[data-testid="programming-language-input"])。 */
  codeLangInput: string;
  /** Code 模态代码框(模态内无 placeholder 的 textarea)。 */
  codeInput: string;
  /** Posts 模态 URL 输入框(待 spike)。 */
  postsUrlInput: string;
  /**
   * Table 网格按钮 aria-label 模板(★ 实测:Table 模态是网格,button aria-label
   * "Insert a {rows} by {cols} table")。驱动器按 note 表格行列数填模板点对应格。
   */
  tableGridCellLabel: string;
  /**
   * 嵌入块(表格/Mermaid/代码等)的「编辑」铅笔按钮(★ 实测 2026-06-13:X 嵌入块插入后是**预览态**,
   * 要先点这个 `[aria-label="Edit block"]` 铅笔进**编辑态**,cell 才可填。直接点 cell 焦点进不去)。
   */
  editBlockButton: string;
  /**
   * 工具栏「块类型下拉」触发钮(★ 2026-06-14 总指挥正解:标题=选中块+点这里选 Heading/Subheading)。
   * 实测它显示当前块类型文本(Body/Heading/Subheading)。驱动器靠 blockTypeLabels 按文本匹配点开。
   */
  blockTypeDropdown: string;
  /** 块类型下拉的选项可见文本(点开下拉后按文本匹配选)。 */
  blockTypeLabels: {
    heading: string; // 大标题(note level 1)
    subheading: string; // 副标题(note level 2+)
    body: string; // 正文
  };
  /**
   * 模态确认按钮容器 selector(底部按钮，如 [role="button"]/button)。驱动器用它 + 下面
   * modalButtonLabels 按可见文本匹配点击(同菜单项,纯 CSS 选不中文本)。
   */
  modalButton: string;
  /** 模态确认按钮可见文本标签(★ 实测更正:底部蓝按钮是 "Insert"，不是 "Update";Media Crop "Save")。 */
  modalButtonLabels: {
    update: string;
    save: string;
  };
  /**
   * 模态「打开中」判据(★ 实测:所有 Insert 模态顶部有 `[data-testid="app-bar-close"]` 关闭按钮)。
   * 驱动器靠它做可靠时序:点 Insert→等它**出现**(模态真开了)再填;点确认→等它**消失**(模态真关了)
   * 再下一步。比固定 sleep 可靠(X 异步快慢不定,固定等待赌不准 = 时好时坏的根因)。
   */
  modalOpenMarker: string;
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
      // Article 编辑器直达 URL(总指挥实机确认):直接进空白编辑器,无需点「新建」。
      // 无权限账号访问进不了编辑器 → 驱动器导航后 poll 等不到正文/Insert → fail loud 提示无权限。
      composeUrl: 'https://x.com/compose/articles',
      // 「新建文章」按钮:列表页右上角铅笔图标(实机 spike 2026-06-13:devtools 抓到
      //   `<button aria-label="create">` 即此铅笔)。主候选 aria-label="create";辅以拓宽兜底。
      newArticleButton: [
        'button[aria-label="create"]',          // ★ spike 实测命中(列表页右上角铅笔)
        '[role="button"][aria-label="create" i]',
        '[data-testid="articleComposeButton"]',
        'a[href="/compose/articles"][role="button"]',
        '[role="button"][aria-label*="Write" i]',
        '[role="button"][aria-label*="Compose" i]',
        '[role="button"][aria-label*="撰写"]',
      ].join(', '),
      // 正文 / 标题(★ spike 实测,2026-06-13):
      //   正文 = [data-testid="composer"](div role=textbox contenteditable=true);
      //   标题 = textarea[placeholder="Add a title"](★ 第二轮 spike 更正:真正的标题输入框是
      //     这个 textarea,不是 [data-testid="twitter-article-title"] —— 那个是展示用 div "(Needs title)")。
      body: '[data-testid="composer"], div[data-testid="composerRichTextInputContainer"] [contenteditable="true"], div[role="textbox"][contenteditable="true"]',
      titleInput: 'textarea[placeholder="Add a title"], textarea[placeholder*="title" i], [data-testid="twitter-article-title"] [contenteditable="true"]',
      // Insert 触发钮(★ spike 实测 2026-06-13):工具栏里那个钮**无 data-testid**,
      //   是 `aria-label="Add Media"` + 可见文本 "Insert" 的 button。主候选 aria-label="Add Media";
      //   辅以 aria-label/文本兜底(X 改版可能改 aria,留 Insert/Add 兜底)。
      insertTrigger: 'button[aria-label="Add Media"], [role="button"][aria-label="Add Media"], button[aria-label*="Insert" i], button[aria-label*="Add" i]',
      // 菜单项(★ spike 实测):点 Insert 后弹 7 个 [role="menuitem"],文本 Media/GIF/Posts/Divider/
      //   Code/LaTeX/Table —— 与 menuLabels 文本筛完全吻合。
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
      // 各模态输入框(★ 第三轮 spike 实测,dump 真实 DOM 2026-06-13):
      //   ⚠️ 重大更正:模态里的 textarea **没有 placeholder 属性**(占位文字 "Add a LaTeX expression
      //   here" / "Add code here" 是单独浮层元素,不在 textarea 上)→ 旧 placeholder selector 永久落空。
      //   真实结构:模态内唯一一个**无 placeholder 的可见 textarea**(标题框才有 placeholder="Add a title")。
      //   故 LaTeX/Code 输入框都用 `textarea:not([placeholder])` 命中(模态弹出时它就是当前那个)。
      latexInput: 'textarea:not([placeholder])',
      // Code 语言搜索框 = 真 testid `programming-language-input`;代码框 = 模态内无 placeholder textarea。
      codeLangInput: 'input[data-testid="programming-language-input"], input[placeholder*="programming language" i]',
      codeInput: 'textarea:not([placeholder])',
      // Posts URL 框待 spike(本轮未点到 Posts);先按 placeholder 兜底(同模态 textarea/input)。
      postsUrlInput: 'input[placeholder*="post URL" i], input[placeholder*="Paste" i], input[data-testid="postUrlInput"]',
      // ★★ Table 完整链路(2026-06-14 实机【全链验证】最终确认):Insert→Table 弹**网格模态**
      //   (N×M 选行列),点网格插**空表**;再点空表的**铅笔 Edit block** 才弹出 Markdown 编辑模态。
      //   markdown 编辑框 = 该模态内、可见、placeholder **空**的 <textarea>(实测 placeholder=""
      //   不是 "Add markdown here";"Add a title" 是文章标题框,需排除)。故选「模态(dialog)内、
      //   placeholder 为空的 textarea」。把整段 markdown 用原生 value setter+input 覆盖写,点 Update。
      //   driveTable 走 tableGridCellLabel(点网格)+ editBlockButton(点铅笔)+ 本框(写 md)三件套。
      tableInput: '[role="dialog"] textarea:not([placeholder]), [role="dialog"] textarea[placeholder=""]',
      // Table 网格按钮 aria-label 模板(N=行 M=列):"Insert a {rows} by {cols} table"。
      tableGridCellLabel: 'Insert a {rows} by {cols} table',
      // 嵌入块编辑铅笔(★ 实测 2026-06-13):X 嵌入块(表格等)插入后是预览态,先点这个进编辑态 cell 才可填。
      editBlockButton: 'button[aria-label="Edit block"], [role="button"][aria-label="Edit block"]',
      // 工具栏块类型下拉(★ 2026-06-14 正解):显示 Body/Heading/Subheading 文本的可点元素。
      //   driver 用 blockTypeLabels 按文本匹配点开(纯 CSS 选不中文本)。容器给宽松候选。
      blockTypeDropdown: 'button, [role="button"], [aria-haspopup]',
      blockTypeLabels: { heading: 'Heading', subheading: 'Subheading', body: 'Body' },
      // 模态确认按钮(★ 实测更正):底部蓝按钮文本是 **"Insert"**(不是 "Update");Media Crop 可能 "Save"。
      modalButton: 'button, [role="button"]',
      modalButtonLabels: { update: 'Insert', save: 'Save' },
      // 模态打开判据(★ 实测:所有 Insert 模态顶部都有 app-bar-close 关闭按钮)。出现=模态开,消失=模态关。
      modalOpenMarker: '[data-testid="app-bar-close"]',
      // Media(网页内 Crop media):文件 input(★ 实测确认 fileInput 在编辑器内)。
      mediaFileInput: 'input[type="file"][accept*="image"], input[type="file"][accept*="video"], input[data-testid="fileInput"]',
      // 喂图成功判据(★ 2026-06-14 修正:X = DraftJS,媒体块是 <section data-block> 含 img/video;
      //   旧 'article img' 对 Article 编辑器永久失效)。driveMediaWithPath 实际用 verifyMediaContent
      //   (走 blockSelector)判落定,此字段保留作兼容/诊断。
      mediaInsertedThumb: 'section[data-block] img, section[data-block] video',
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
