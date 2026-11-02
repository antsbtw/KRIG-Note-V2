/**
 * ⭐ note → X 文章(发推第⑥期,2026-10-30)—— 纯函数(只吃 PM JSON),两个进程都能用
 *
 * 用户 10-29:「我们的目标就是如何把note中的各种block漂亮的排版发推。传达思想。」
 * 做法沿用 06-13 实机定的终态(记忆 project-x-articles-impl):**用 X 文章编辑器自己的原生功能**,几乎不转图 ——
 *   公式 → X 的 LaTeX、表格 → X 表格、代码 → X 代码块、图片 → X 的 Media;
 *   字 / 列表 / 引用 / 链接 → 富文本粘贴(X 认 HTML 不认 markdown);小标题单独一步(粘 <h1> 在图后面会被 X 降成正文)。
 *   X 没有对应的才转图:Mermaid / 函数图像 / HTML 块 / SVG 图 / 带行内公式的段落 / 分栏(用户 10-30 选 A:整块拼成一张图)。
 * 转图沿用推文那套:预览窗先画好标在块的 attrs.xImage(分栏也是),这里只认标记;没画好是 render 占位,fill 会挡。
 *
 * 这里只排「做哪几步」,不碰网页;驱动在 x-post-article-driver(主进程)。
 * ⚠️ 不静默丢东西:X 文章没有的格式(下划线 / 高亮 / 缩进…)、略过的块,都进 warnings。
 */
import { needsImage, fillProblem, RENDER_LABEL, type PmNode, type PostMedia, type RenderWhat } from './x-post-compose';
import { xWeightedLength } from './x-post-length';

export type ArticleStep =
  /** 一段连续的字 / 列表 / 引用 → 一次富文本粘贴;text 是纯文字(预览、核对用) */
  | { readonly k: 'html'; readonly html: string; readonly text: string }
  /** X 文章只有两级:1 = Heading,2 = Subheading */
  | { readonly k: 'heading'; readonly level: 1 | 2; readonly text: string }
  | { readonly k: 'latex'; readonly latex: string }
  | { readonly k: 'code'; readonly language: string; readonly code: string }
  | { readonly k: 'table'; readonly markdown: string; readonly rows: number; readonly cols: number }
  | { readonly k: 'divider' }
  /** 图片(note 里的 / 转成的)、还没转好的占位、视频 */
  | { readonly k: 'media'; readonly m: PostMedia };

export type ArticleDraft = {
  /** 文章标题(note 的标题块;没有就是空的,X 发布前要人补) */
  readonly title: string;
  readonly steps: readonly ArticleStep[];
  /**
   * 默认封面:标题下面紧挨着的那张图(它就是封面,正文里不再放 —— 用户 10-30「这样不是有两张封面图了吗?」);
   * 没有的话用正文里第一张普通图片(正文里照样放)
   */
  readonly coverDefault: string | null;
  /** 封面是不是标题下面那张(是的话正文里没放它) */
  readonly coverFromLead: boolean;
  /**
   * 发布时的导语(X 的 Publish 弹窗「Add a caption」,时间线上那条推文的正文;X 自动附文章链接)——
   * 封面图下面紧挨着的引用块,正文里不再放(用户 10-31 同意);没有就空着
   */
  readonly caption: string;
  /** 导语的加权字数(X 上限 ARTICLE_CAPTION_MAX) */
  readonly captionWeight: number;
  readonly warnings: readonly string[];
};

/** X 文章发布弹窗的导语上限(10-30 真机截图「172 / 256」,按加权字数算) */
export const ARTICLE_CAPTION_MAX = 256;

/** 引用块 → 导语的纯文字:每段一行,段之间空一行(和人在 X 弹窗里写的样子一样) */
function quoteText(n: PmNode): string {
  return (n.content ?? []).map((c) => textOf(c).trim()).filter((t) => t !== '').join('\n\n');
}

/** X 文章表格的网格最大 10 × 10(06-14 实机) */
export const ARTICLE_TABLE_MAX = 10;

type Ctx = {
  readonly steps: ArticleStep[];
  readonly warn: Set<string>;
  /** 正文里最大一级小标题的 level(它 → Heading,更小的 → Subheading) */
  readonly topLevel: number;
  /** 攒着的一段可以一起粘贴的 HTML */
  html: string[];
  text: string[];
  cover: string | null;
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textOf(n: PmNode): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(textOf).join('');
}

/** 行内 → HTML:粗 / 斜 / 删除线 / 链接保留;X 文章没有的标记去掉、留字,说一句 */
function inlineHtml(nodes: readonly PmNode[] | undefined, warn: Set<string>): string {
  let out = '';
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'text': {
        let h = esc(n.text ?? '');
        let href: string | null = null;
        for (const m of n.marks ?? []) {
          if (m.type === 'bold' || m.type === 'strong') h = `<strong>${h}</strong>`;
          else if (m.type === 'italic' || m.type === 'em') h = `<em>${h}</em>`;
          else if (m.type === 'strike') h = `<s>${h}</s>`;
          else if (m.type === 'link') href = (m.attrs?.href as string) || null;
          else if (m.type === 'underline') warn.add('下划线:X 文章没有,变成普通字');
          else if (m.type === 'highlight') warn.add('高亮:X 文章没有,变成普通字');
          else if (m.type === 'code') warn.add('行内代码:X 文章没有,变成普通字');
        }
        out += href ? `<a href="${esc(href)}">${h}</a>` : h;
        break;
      }
      case 'hardBreak': out += '<br>'; break;
      case 'noteLink': out += esc((n.attrs?.label as string) || textOf(n)); break;
      case 'fileLink': out += esc(`📎${(n.attrs?.filename as string) || ''}`); break;
      default: out += esc(textOf(n));
    }
  }
  return out;
}

const flushHtml = (ctx: Ctx): void => {
  if (ctx.html.length === 0) return;
  ctx.steps.push({ k: 'html', html: ctx.html.join(''), text: ctx.text.join('\n') });
  ctx.html = [];
  ctx.text = [];
};
const push = (ctx: Ctx, s: ArticleStep): void => { flushHtml(ctx); ctx.steps.push(s); };
const pasteable = (ctx: Ctx, html: string, text: string): void => {
  if (text.trim() === '') return;
  ctx.html.push(html);
  ctx.text.push(text);
};

/** 要转图的块:画好了就是一张图,没画好就是占位(fill 挡住) */
function shot(ctx: Ctx, n: PmNode, what: RenderWhat, source: string): void {
  const label = RENDER_LABEL[what];
  const src = n.attrs?.xImage as string | undefined;
  if (src) { push(ctx, { k: 'media', m: { kind: 'image', src, alt: `${label}(转成的图)`, fromBlock: what } }); return; }
  const error = n.attrs?.xImageError as string | undefined;
  push(ctx, { k: 'media', m: { kind: 'render', what, source, error } });
  if (error) ctx.warn.add(`${label}没转成图:${error}`);
}

/** 这个块里(往下找)有没有要单独成一步的东西 —— 有的话容器拆开排,没有就整个当字粘 */
function hasNative(n: PmNode): boolean {
  return (n.content ?? []).some((c) => isNative(c) || hasNative(c));
}
function isNative(n: PmNode): boolean {
  if (needsImage(n) !== null) return true;
  return ['image', 'mathBlock', 'codeBlock', 'table', 'horizontalRule', 'videoBlock', 'columnList', 'heading'].includes(n.type);
}

/** 列表 → <ul>/<ol>;项里套的列表照样套 */
function listHtml(n: PmNode, warn: Set<string>): { html: string; text: string } {
  const tag = n.type === 'orderedList' ? 'ol' : 'ul';
  const start = typeof n.attrs?.start === 'number' && n.attrs.start !== 1 ? ` start="${n.attrs.start as number}"` : '';
  const texts: string[] = [];
  const items = (n.content ?? []).map((item) => {
    const mark = n.type === 'taskList' ? (item.attrs?.checked ? '☑ ' : '☐ ') : '';
    const parts = (item.content ?? []).map((c) => {
      if (c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList') {
        const sub = listHtml(c, warn);
        texts.push(sub.text);
        return sub.html;
      }
      const s = textOf(c);
      texts.push(mark + s);
      return (mark ? esc(mark) : '') + inlineHtml(c.content, warn);
    });
    return `<li>${parts.join('<br>')}</li>`;
  });
  if (n.type === 'taskList') warn.add('待办列表:X 文章没有勾选框,变成 ☐ / ☑ 开头的普通列表');
  return { html: `<${tag}${start}>${items.join('')}</${tag}>`, text: texts.join('\n') };
}

/** 不含要单独成一步的东西的块 → 一段 HTML(引用 / 提示框整个包起来) */
function blockHtml(n: PmNode, warn: Set<string>): { html: string; text: string } | null {
  switch (n.type) {
    case 'paragraph': {
      const t = textOf(n);
      return t.trim() === '' ? null : { html: `<p>${inlineHtml(n.content, warn)}</p>`, text: t };
    }
    case 'bulletList': case 'orderedList': case 'taskList': return listHtml(n, warn);
    case 'blockquote': case 'callout': {
      const inner = (n.content ?? []).map((c) => blockHtml(c, warn)).filter((x): x is { html: string; text: string } => x !== null);
      if (inner.length === 0) return null;
      const emoji = n.type === 'callout' ? `${(n.attrs?.emoji as string) || '💡'} ` : '';
      if (n.type === 'callout') warn.add('提示框:X 文章没有,改成引用');
      return { html: `<blockquote>${esc(emoji)}${inner.map((x) => x.html).join('')}</blockquote>`, text: emoji + inner.map((x) => x.text).join('\n') };
    }
    case 'toggleList': case 'frameBlock': case 'column': case 'listItem': case 'taskItem': {
      const inner = (n.content ?? []).map((c) => blockHtml(c, warn)).filter((x): x is { html: string; text: string } => x !== null);
      return inner.length === 0 ? null : { html: inner.map((x) => x.html).join(''), text: inner.map((x) => x.text).join('\n') };
    }
    case 'tweetBlock': case 'externalRef': {
      const href = ((n.attrs?.tweetUrl ?? n.attrs?.href) as string) || '';
      if (href === '') return null;
      const t = (n.attrs?.title as string) || href;
      return { html: `<p><a href="${esc(href)}">${esc(t)}</a></p>`, text: t };
    }
    case 'defBlock': { const t = textOf(n); return t.trim() === '' ? null : { html: `<p>${esc(t)}</p>`, text: t }; }
    case 'audioBlock': warn.add('音频:X 文章放不了,已略过'); return null;
    case 'fileBlock': warn.add('文件:X 文章放不了,已略过'); return null;
    default: {
      const t = textOf(n);
      warn.add(`认不出的块 ${n.type}${t.trim() !== '' ? ',只留了文字' : ',已略过'}`);
      return t.trim() === '' ? null : { html: `<p>${esc(t)}</p>`, text: t };
    }
  }
}

function tableMarkdown(n: PmNode): { markdown: string; rows: number; cols: number } {
  const cell = (c: PmNode): string => (c.content ?? []).map(textOf).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const rows = (n.content ?? []).map((r) => (r.content ?? []).map(cell));
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const line = (r: string[]): string => `| ${[...r, ...Array(cols - r.length).fill('')].join(' | ')} |`;
  const md = rows.length === 0 ? '' : [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
  return { markdown: md, rows: rows.length, cols };
}

function block(n: PmNode, ctx: Ctx): void {
  const what = needsImage(n);
  /** 带行内公式的段落:X 文章没有行内公式 → 整段转图(和推文一样) */
  if (what === 'inlineMath' || what === 'mermaid' || what === 'html' || what === 'mathVisual' || what === 'svg') {
    shot(ctx, n, what, textOf(n));
    return;
  }
  switch (n.type) {
    case 'heading': {
      const t = textOf(n).trim();
      if (t === '') return;
      const level = (n.attrs?.level as number | undefined) ?? 1;
      push(ctx, { k: 'heading', level: level <= ctx.topLevel ? 1 : 2, text: t });
      return;
    }
    case 'mathBlock': {
      const latex = ((n.attrs?.latex as string) || textOf(n)).trim();
      if (latex !== '') push(ctx, { k: 'latex', latex });
      return;
    }
    case 'codeBlock': {
      const code = textOf(n).replace(/\n+$/, '');
      if (code.trim() !== '') push(ctx, { k: 'code', language: ((n.attrs?.language as string) || '').trim(), code });
      return;
    }
    case 'table': {
      const t = tableMarkdown(n);
      if (t.rows === 0) return;
      if (t.rows > ARTICLE_TABLE_MAX || t.cols > ARTICLE_TABLE_MAX) {
        ctx.warn.add(`有张表格 ${t.rows} 行 × ${t.cols} 列,X 文章表格最多 ${ARTICLE_TABLE_MAX} × ${ARTICLE_TABLE_MAX},多出的会丢 —— 建议拆小`);
      }
      push(ctx, { k: 'table', ...t });
      return;
    }
    case 'horizontalRule': push(ctx, { k: 'divider' }); return;
    case 'image': {
      const src = (n.attrs?.src as string) || '';
      if (src === '') return;
      if (ctx.cover === null && src.startsWith('media://')) ctx.cover = src;
      push(ctx, { k: 'media', m: { kind: 'image', src, alt: textOf(n).trim() || (n.attrs?.alt as string) || '' } });
      return;
    }
    case 'videoBlock': {
      const local = (n.attrs?.localFilePath as string) || '';
      const src = (n.attrs?.src as string) || '';
      if (local !== '' || src.startsWith('media://')) { push(ctx, { k: 'media', m: { kind: 'video', src: local || src } }); return; }
      if (src !== '') pasteable(ctx, `<p><a href="${esc(src)}">${esc(src)}</a></p>`, src);
      ctx.warn.add('外链视频:按链接放进文章');
      return;
    }
    /** 分栏:整块拼成一张图(用户 10-30 选 A),和 note 里并排的样子一样 */
    case 'columnList': shot(ctx, n, 'columns', textOf(n)); return;
    default: break;
  }
  /** 容器里有要单独成一步的东西(图 / 公式 / 小标题…)→ 拆开逐个排(X 文章不能嵌套),说一句 */
  if (['blockquote', 'callout', 'toggleList', 'frameBlock', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'column'].includes(n.type) && hasNative(n)) {
    if (n.type === 'blockquote' || n.type === 'callout') ctx.warn.add('引用 / 提示框里有图片、公式等:X 文章不能嵌套,拆出来排了(引用样式没了)');
    else if (n.type !== 'listItem' && n.type !== 'taskItem' && n.type !== 'toggleList' && n.type !== 'frameBlock' && n.type !== 'column') ctx.warn.add('列表里有图片、公式等:X 文章不能嵌套,拆出来排了');
    for (const c of n.content ?? []) block(c, ctx);
    return;
  }
  const h = blockHtml(n, ctx.warn);
  if (h) pasteable(ctx, h.html, h.text);
}

/** 正文小标题里最大的那级(level 最小)—— 没有小标题就是 1 */
function topHeading(nodes: readonly PmNode[]): number {
  let top = Infinity;
  const walk = (ns: readonly PmNode[] | undefined): void => {
    for (const n of ns ?? []) {
      if (n.type === 'heading') top = Math.min(top, (n.attrs?.level as number | undefined) ?? 1);
      else walk(n.content);
    }
  };
  walk(nodes);
  return Number.isFinite(top) ? top : 1;
}

export function articleDraft(nodes: readonly PmNode[]): ArticleDraft {
  const first = nodes[0];
  const hasTitle = first?.type === 'paragraph' && first.attrs?.isTitle === true && textOf(first).trim() !== '';
  const afterTitle = hasTitle ? nodes.slice(1) : nodes;
  const lead = afterTitle[0];
  const leadSrc = lead?.type === 'image' ? ((lead.attrs?.src as string) || '') : '';
  const coverFromLead = leadSrc.startsWith('media://') && needsImage(lead as PmNode) === null;
  const afterCover = coverFromLead ? afterTitle.slice(1) : afterTitle;
  const capNode = coverFromLead && afterCover[0]?.type === 'blockquote' ? afterCover[0] : null;
  const caption = capNode ? quoteText(capNode) : '';
  const body = capNode ? afterCover.slice(1) : afterCover;
  const ctx: Ctx = { steps: [], warn: new Set(), topLevel: topHeading(body), html: [], text: [], cover: coverFromLead ? leadSrc : null };
  for (const n of body) block(n, ctx);
  flushHtml(ctx);
  if (!hasTitle) ctx.warn.add('note 没有标题:X 文章要标题,填进去后在 X 里补一个');
  return {
    title: hasTitle ? textOf(first).trim() : '', steps: ctx.steps, coverDefault: ctx.cover, coverFromLead,
    caption, captionWeight: xWeightedLength(caption), warnings: [...ctx.warn],
  };
}

/** 这篇文章现在能不能填进 X —— 不能的话为什么(预览按钮和 x.post.fill 同一句) */
export function articleProblem(a: ArticleDraft): string | null {
  if (a.steps.length === 0) return '正文是空的';
  if (a.captionWeight > ARTICLE_CAPTION_MAX) return `导语超了(${a.captionWeight} / ${ARTICLE_CAPTION_MAX})—— X 发布时放不下,在 note 里删短封面图下面那段引用`;
  for (const s of a.steps) {
    if (s.k !== 'media') continue;
    if (s.m.kind === 'video') return '视频还不能放进 X 文章(还没做)—— 现在先把它去掉再发';
    const why = fillProblem([s.m]);
    if (why) return why;
  }
  return null;
}
