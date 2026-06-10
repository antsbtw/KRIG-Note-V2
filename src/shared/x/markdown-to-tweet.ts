/**
 * markdown → X 推文纯文本 降级(X 集成 阶段 2,写方向)
 *
 * 推文 / 回复输入框是**纯文本**(X compose 不吃 markdown 语法,`**x**` 会原样显示)。
 * note 选区 / 整篇导出的是 markdown(sliceToMarkdown / serializeDoc → markdown)。本模块
 * 把 markdown 降级成「保住可读文字、去掉语法噪声」的纯文本。
 *
 * 降级规则(总指挥拍板「去标记符保文字」):
 * - 粗体 `**x**` / `__x__`、斜体 `*x*` / `_x_`、删除线 `~~x~~`、行内代码 `` `x` `` → 去标记留文字
 * - 链接 `[label](url)` → `label (url)`;label 与 url 相同 / label 为空 → 仅 `url`
 * - 图片 `![alt](url)` → `url`(推文纯文本贴 URL,X 会自动展开为媒体卡片)
 * - 标题 `# x` / `## x` … → 去 `#` 留文字(单独成行)
 * - 无序列表 `- x` / `* x` / `+ x` → `• x`
 * - 有序列表 `1. x` → 保留序号 `1. x`
 * - 引用 `> x` → `x`(去 `>`)
 * - 代码围栏 ```` ```lang ```` → 去围栏,保留代码原文
 * - 水平线 `---` / `***` → 删
 *
 * 不做:thread 自动拆分(阶段 2 不做,见 TODO)、字数截断(总指挥拍板:超长 fail loud
 * 提示但仍填入,不静默截断 —— 见 checkTweetLength)。
 *
 * 纯函数,无副作用,renderer / main 均可 import。
 */

/** X 普通推文字数上限(非 Premium)。Premium 更长,本期按基础上限提示。 */
export const TWEET_CHAR_LIMIT = 280;

/**
 * markdown → 推文纯文本。
 *
 * @param markdown note 选区 / 整篇导出的 markdown
 * @returns 降级后的纯文本(已 trim,行间最多保留一个空行)
 */
export function markdownToTweetText(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    // 代码围栏:进/出 fence 时丢掉围栏行本身,fence 内的内容原文保留
    const fenceMatch = raw.match(/^\s*```/);
    if (fenceMatch) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }

    // 水平线 → 删
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(raw)) {
      continue;
    }

    let line = raw;

    // 标题:去前导 # (保留文字)
    line = line.replace(/^\s{0,3}#{1,6}\s+/, '');

    // 引用:去前导 >(可多层)
    line = line.replace(/^\s*(>\s?)+/, '');

    // 无序列表 → •(保留缩进语义为单层,X 纯文本无嵌套)
    line = line.replace(/^(\s*)[-*+]\s+/, (_m, indent: string) => `${indent}• `);

    // 有序列表 `1. ` 保留(数字 + . + 空格本身就是可读纯文本,不动)

    // 行内:链接 / 图片 / 强调标记
    line = stripInlineMarkdown(line);

    out.push(line);
  }

  // 收尾:trim 首尾空行,折叠 3+ 连续空行为 1 个空行
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/**
 * 处理一行内的行内 markdown(链接 / 图片 / 强调 / 行内代码)。
 */
function stripInlineMarkdown(line: string): string {
  let s = line;

  // 图片 ![alt](url) → url(先于链接处理,因语法前缀 ! 区分)
  s = s.replace(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, url: string) => url);

  // 链接 [label](url) → label (url);label==url 或空 → url
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, url: string) => {
    const l = label.trim();
    if (!l || l === url) return url;
    return `${l} (${url})`;
  });

  // 行内代码 `x` → x
  s = s.replace(/`([^`]+)`/g, (_m, t: string) => t);

  // 粗体 **x** / __x__ → x
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => t);
  s = s.replace(/__([^_]+)__/g, (_m, t: string) => t);

  // 斜体 *x* / _x_ → x(在粗体之后,避免吃掉 **)
  s = s.replace(/\*([^*]+)\*/g, (_m, t: string) => t);
  s = s.replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, (_m, t: string) => t);

  // 删除线 ~~x~~ → x
  s = s.replace(/~~([^~]+)~~/g, (_m, t: string) => t);

  return s;
}

/** 推文长度校验结果 */
export interface TweetLengthCheck {
  /** 字符数(X 实际按 weighted 计数,emoji/CJK 权重不同;本期用 [...text].length 近似码点数)*/
  length: number;
  /** 是否超过基础上限 */
  overLimit: boolean;
  limit: number;
}

/**
 * 校验推文长度。
 *
 * 注:X 真实计数是 weighted(URL 固定 23、CJK 算 2 等),本期用码点数近似,
 * 仅用于「超长 fail loud 提示」(总指挥拍板:超长仍填入,只提示,不截断)。
 * 精确计数留 TODO(阶段 2 不做)。
 */
export function checkTweetLength(text: string, limit = TWEET_CHAR_LIMIT): TweetLengthCheck {
  // 用展开运算符按 Unicode 码点计数(避免 emoji 被 .length 算成 2)
  const length = [...text].length;
  return { length, overLimit: length > limit, limit };
}
