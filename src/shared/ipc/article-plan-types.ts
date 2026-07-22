/**
 * X Article 原生 Insert 驱动计划——纯数据类型(IPC 可序列化)。
 *
 * 从 drivers/text-editing-driver/serializers/note-to-article-plan 下沉到 shared，
 * 使 shared 层可直接引用而不跨层 import drivers。
 * 运行时函数(buildArticlePlan 等)仍留在 drivers。
 */

// ═══════════════════════════════════════════════════════
// §1  InsertStep 类型(IPC 可序列化:纯数据,无 PMNode / 函数)
// ═══════════════════════════════════════════════════════

/** X Article 原生 Insert 菜单项(驱动器据此选菜单 + 填模态)。 */
export type ArticleInsertKind = 'html' | 'heading' | 'latex' | 'code' | 'table' | 'posts' | 'divider' | 'media';

interface BaseStep {
  kind: ArticleInsertKind;
  /**
   * 降级标记:本 step 是「原本想走原生但源数据缺失 / 渲图失败」退下来的(已并入文本)。
   * 驱动器照常执行,调用方汇总提示用户(fail loud,不静默)。
   */
  degraded?: boolean;
}

/** 连续可粘贴块 → 一段 X 支持的 HTML(在 X 正文合成 paste)。 */
export interface HtmlStep extends BaseStep {
  kind: 'html';
  html: string;
}

/**
 * 标题块(★ 2026-06-14 总指挥正解):**不靠 paste `<h1>/<h2>` 让 X 识别**(图块边界后 X 不可靠,
 * 会降级正文),而是**填纯文本 → 选中该块 → 点工具栏块类型下拉选 Heading/Subheading**(X 自己格式化,
 * 不受块边界影响)。level:1 → Heading(大标题),2+ → Subheading(X 只有这两级 + Body)。
 */
export interface HeadingStep extends BaseStep {
  kind: 'heading';
  level: number; // note heading level(driver 据此选 Heading=1 / Subheading=2+)
  text: string; // 标题纯文本
}

/** 块级公式 → 填 X LaTeX 模态文本框(latex 源码,无 `$` 包裹)→ Update。 */
export interface LatexStep extends BaseStep {
  kind: 'latex';
  latex: string;
}

/** 普通代码块 → 填 X Code 模态(语言搜索框 + 代码框)→ Update。 */
export interface CodeStep extends BaseStep {
  kind: 'code';
  language: string;
  code: string;
}

/** 表格 → 填 X Table 模态(markdown 表格,placeholder "Add markdown here")→ Update。 */
export interface TableStep extends BaseStep {
  kind: 'table';
  markdown: string;
}

/** 嵌推 → 填 X Posts 模态("Paste post URL")→ 自动嵌。 */
export interface PostsStep extends BaseStep {
  kind: 'posts';
  tweetUrl: string;
}

/** 分割线 → 仅点 Insert → Divider。 */
export interface DividerStep extends BaseStep {
  kind: 'divider';
}

/**
 * 图(image / 渲图兜底)→ 喂文件给 X Media 控件(网页内 Crop media,非 OS 框)。
 * mediaUrl 是 media://(驱动器 main 侧 resolveMediaPath 解析磁盘路径再 feedFilesToInput)。
 */
export interface MediaStep extends BaseStep {
  kind: 'media';
  mediaUrl: string;
  alt?: string;
}

export type ArticleInsertStep =
  | HtmlStep
  | HeadingStep
  | LatexStep
  | CodeStep
  | TableStep
  | PostsStep
  | DividerStep
  | MediaStep;

/** 整篇驱动计划。 */
export interface ArticlePlan {
  /** Article 标题(note isTitle 首块 → X Article 标题字段)。无则空串。 */
  title: string;
  /** 有序驱动步骤。驱动器按序逐个执行(每步等模态关闭再下一个)。 */
  steps: ArticleInsertStep[];
  /**
   * 发布前预检警告(格式有问题/会降级的点)。非空 = publishToXArticle 弹确认让用户决定
   * 「先回 note 调整」还是「继续发布(接受降级)」。纯文案,不阻断逻辑。
   */
  warnings: string[];
}
