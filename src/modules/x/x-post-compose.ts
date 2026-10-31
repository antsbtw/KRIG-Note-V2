/**
 * ⭐⭐ note → 推文 排版(发推第①期,2026-10-27)—— 纯函数,两个进程都能用(只吃 PM JSON,不碰 Electron / DOM)
 *
 * 设计 docs/10-business-design/x/x-posting-design.md §3:先把 note 的块拆成「单元」(一段字 / 一个附件 / 一个断点),
 * 再按五种发法各排一份,给出建议的那种。界面(预览窗)和 AI 都经能力 x.post.prepare 调它。
 *
 * ⚠️ 不静默丢东西:X 发不了的(音频 / 文件 / 外链视频)、只能降级的(行内公式)、认不出的块,都进 warnings。
 * ⭐ 转图(第④期剩下的,10-28):X 显示不了的块(needsImage 认)由预览窗先画成 PNG 存进图片库,
 *   在块的 attrs 上标 xImage(media:// 地址)或 xImageError(画不出来的原因)再交给这里 ——
 *   有 xImage 就当一张图附上;没有(还没画 / 画不出来)就是 render 占位,fillProblem 挡住不让填。
 *   画图要 DOM,只能在渲染进程做;这里仍是纯函数。⚠️ AI 直接调 x.post.fill 时没人先画,转图块会被挡(P3 再补)。
 */
import { X_POST_LIMIT, xWeightedLength } from './x-post-length';
import { articleDraft, articleProblem, type ArticleDraft } from './x-post-article';

export type PmNode = {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly PmNode[];
  readonly marks?: ReadonlyArray<{ readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }>;
  readonly text?: string;
};

/**
 * section:整篇转图时的一节;columns:X 文章里的分栏(整块拼成一张图,用户 10-30 选 A)
 * —— 这两种都不是 needsImage 给出的(推文里分栏照常拆开发)
 */
export type RenderWhat = 'math' | 'code' | 'mermaid' | 'table' | 'mathVisual' | 'html' | 'svg' | 'inlineMath' | 'section' | 'columns';
export type PostMedia =
  /** fromBlock:这张是哪种块转成的图(转图才有)—— 一图一条要认它 */
  | { readonly kind: 'image'; readonly src: string; readonly alt: string; readonly fromBlock?: RenderWhat }
  | { readonly kind: 'video'; readonly src: string }
  /** 要渲染成图的块(第④期才真渲染) */
  | { readonly kind: 'render'; readonly what: RenderWhat; readonly source: string; readonly error?: string };

export type PostDraft = { readonly text: string; readonly weight: number; readonly media: readonly PostMedia[] };
export type PostForm = 'single' | 'thread' | 'longPost' | 'article' | 'image';
export type PostOption = {
  readonly form: PostForm;
  readonly label: string;
  readonly available: boolean;
  /** 不可用的原因 */
  readonly why?: string;
  /** 可用但有前提(如要 Premium) */
  readonly note?: string;
  readonly posts: readonly PostDraft[];
  /** X 文章才有:一步一步怎么填进 X 文章编辑器(第⑥期,x-post-article) */
  readonly article?: ArticleDraft;
};
export type PostPlan = {
  readonly empty: boolean;
  /** 整段当一条发的加权字数 */
  readonly weight: number;
  readonly suggested: PostForm;
  /** 为什么建议它(给人看) */
  readonly reason: string;
  /** note 标题(整篇发时有;X 文章用) */
  readonly title?: string;
  readonly options: readonly PostOption[];
  /** 推串的「件」和分组(预览里手动合并 / 分开 / 拖图用) */
  readonly threadEdit: ThreadEdit;
  readonly warnings: readonly string[];
};

const LONG_POST_LIMIT = 25000;
const MAX_IMAGES = 4;
/** 推串每条末尾留给「 12/34」的位置 */
const THREAD_SUFFIX_RESERVE = 6;
const THREAD_BUDGET = X_POST_LIMIT - THREAD_SUFFIX_RESERVE;
export const RENDER_LABEL: Record<RenderWhat, string> = {
  math: '公式', code: '代码', mermaid: 'Mermaid', table: '表格', mathVisual: '函数图像', html: 'HTML 块', svg: 'SVG 图', inlineMath: '带行内公式的段落', section: '这一节', columns: '分栏',
};

/** 短代码发文字(用户 10-28 选「短的发文字」;3 行 / 80 字是我提的界线) */
const SHORT_CODE_LINES = 3;
const SHORT_CODE_CHARS = 80;
const isShortCode = (src: string): boolean => {
  const t = src.replace(/\n+$/, '');
  return t.split('\n').length <= SHORT_CODE_LINES && [...t].length <= SHORT_CODE_CHARS;
};

/**
 * 这个块发 X 时要不要先画成图 —— 要的话是哪种(预览窗据此去画,排版据此认)。
 * 只认块本身(不往里递归);容器里的由调用方递归到。
 */
export function needsImage(n: PmNode): RenderWhat | null {
  switch (n.type) {
    case 'mathBlock': return 'math';
    case 'codeBlock': {
      if (((n.attrs?.language as string) || '').toLowerCase() === 'mermaid') return 'mermaid';
      return isShortCode(textOf(n)) ? null : 'code';
    }
    case 'table': return 'table';
    case 'htmlBlock': return 'html';
    case 'mathVisual': return 'mathVisual';
    case 'image': return /\.svg$/i.test((n.attrs?.src as string) || '') ? 'svg' : null;
    case 'paragraph': case 'heading': return (n.content ?? []).some((c) => c.type === 'mathInline') ? 'inlineMath' : null;
    default: return null;
  }
}

// ── 第一步:块 → 单元 ──

type Role = 'title' | 'heading' | 'para' | 'item' | 'quote';
type TextUnit = {
  readonly k: 'text'; readonly text: string; readonly role: Role;
  /** 同一个列表的项之间只换行不空行 */
  readonly list?: number;
  /** 一段被按句子切开后的后续片 —— 和前一片直接相连 */
  readonly cont?: boolean;
};
type Unit = TextUnit | { readonly k: 'media'; readonly m: PostMedia } | { readonly k: 'break' };

type Ctx = { readonly units: Unit[]; readonly warn: Set<string>; title?: string; listSeq: number };

function textOf(n: PmNode): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(textOf).join('');
}

/** 行内:去标记留字;链接 = 文字 + 空格 + 网址(粗体切开的同一个链接只出一次网址) */
function inline(nodes: readonly PmNode[] | undefined, ctx: Ctx): string {
  let out = '';
  let href: string | null = null;
  let linkText = '';
  let spaceNext = false;
  const push = (s: string): void => {
    if (s === '') return;
    if (spaceNext && !/^\s/.test(s)) out += ' ';
    spaceNext = false;
    out += s;
  };
  const flush = (): void => {
    if (href === null) return;
    push(linkText === href ? linkText : `${linkText} ${href}`);
    spaceNext = true;
    href = null;
    linkText = '';
  };
  for (const n of nodes ?? []) {
    const h = n.type === 'text' ? (n.marks?.find((m) => m.type === 'link')?.attrs?.href as string | undefined) : undefined;
    if ((h ?? null) !== href) flush();
    if (h) { href = h; linkText += n.text ?? ''; continue; }
    switch (n.type) {
      case 'text': push(n.text ?? ''); break;
      case 'hardBreak': out += '\n'; spaceNext = false; break;
      case 'noteLink': push((n.attrs?.label as string) || ''); break;
      case 'mathInline':
        push(`$${(n.attrs?.latex as string) || ''}$`);
        ctx.warn.add('行内公式按源码发出($…$),X 显示不了公式');
        break;
      case 'fileLink': push(`📎${(n.attrs?.filename as string) || ''}`); break;
      default: push(textOf(n));
    }
  }
  flush();
  return out;
}

const addText = (ctx: Ctx, text: string, role: Role, list?: number): void => {
  if (text.trim() === '') return;
  ctx.units.push({ k: 'text', text, role, list });
};
const addMedia = (ctx: Ctx, m: PostMedia): void => { ctx.units.push({ k: 'media', m }); };
/** 要转图的块:画好了(attrs.xImage)就是一张图;没画好就是占位(带画不出来的原因),fillProblem 会挡 */
const render = (ctx: Ctx, n: PmNode, what: RenderWhat, source: string): void => {
  const src = n.attrs?.xImage as string | undefined;
  if (src) { addMedia(ctx, { kind: 'image', src, alt: `${RENDER_LABEL[what]}(转成的图)`, fromBlock: what }); return; }
  const error = n.attrs?.xImageError as string | undefined;
  addMedia(ctx, { kind: 'render', what, source, error });
  if (error) ctx.warn.add(`${RENDER_LABEL[what]}没转成图:${error}`);
};

/** 容器里的东西压成一段字(引用 / 提示框用);里面的附件照样带出来 */
function flatten(children: readonly PmNode[] | undefined, ctx: Ctx): string {
  const sub: Ctx = { units: [], warn: ctx.warn, listSeq: ctx.listSeq };
  for (const c of children ?? []) block(c, sub, 0);
  ctx.listSeq = sub.listSeq;
  const lines: string[] = [];
  for (const u of sub.units) {
    if (u.k === 'text') lines.push(u.text);
    else if (u.k === 'media') ctx.units.push(u);
  }
  return lines.join('\n');
}

function list(node: PmNode, ctx: Ctx, indent: number, listId: number): void {
  const start = typeof node.attrs?.start === 'number' ? (node.attrs.start as number) : 1;
  (node.content ?? []).forEach((item, i) => {
    const ind = indent + ((item.attrs?.indent as number | undefined) ?? 0);
    const marker = node.type === 'orderedList' ? `${start + i}. ` : node.type === 'taskList' ? (item.attrs?.checked ? '☑ ' : '☐ ') : '• ';
    const lines: string[] = [];
    for (const c of item.content ?? []) {
      if (c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList') {
        if (lines.length > 0) { addText(ctx, '  '.repeat(ind) + marker + lines.join('\n'), 'item', listId); lines.length = 0; }
        list(c, ctx, ind + 1, listId);
      } else if (c.content?.some((x) => x.type === 'text' || x.type === 'hardBreak') || c.type === 'paragraph' || c.type === 'heading') {
        lines.push(inline(c.content, ctx));
      } else {
        block(c, ctx, ind + 1);
      }
    }
    if (lines.length > 0) addText(ctx, '  '.repeat(ind) + marker + lines.join('\n'), 'item', listId);
  });
}

function block(n: PmNode, ctx: Ctx, indent: number): void {
  /** 带行内公式的段落 / 标题:整段转成图(用户 10-28 选的),正文里不留这段字 */
  if (needsImage(n) === 'inlineMath') {
    if (n.attrs?.isTitle) { const s = inline(n.content, ctx); if (s.trim() !== '' && ctx.title === undefined) ctx.title = s; }
    render(ctx, n, 'inlineMath', textOf(n));
    return;
  }
  switch (n.type) {
    case 'paragraph':
      if (n.attrs?.isTitle) {
        const s = inline(n.content, ctx);
        if (s.trim() !== '' && ctx.title === undefined) ctx.title = s;
        addText(ctx, s, 'title');
      } else addText(ctx, inline(n.content, ctx), 'para');
      return;
    case 'heading': addText(ctx, inline(n.content, ctx), 'heading'); return;
    case 'bulletList': case 'orderedList': case 'taskList': list(n, ctx, indent, ++ctx.listSeq); return;
    case 'blockquote': {
      const s = flatten(n.content, ctx);
      if (s.trim() !== '') addText(ctx, `「${s}」`, 'quote');
      return;
    }
    case 'callout': {
      const s = flatten(n.content, ctx);
      if (s.trim() !== '') addText(ctx, `${(n.attrs?.emoji as string) || '💡'} ${s}`, 'para');
      return;
    }
    case 'horizontalRule': ctx.units.push({ k: 'break' }); return;
    case 'image': {
      const src = (n.attrs?.src as string) || '';
      if (src === '') return;
      if (needsImage(n) === 'svg') { render(ctx, n, 'svg', src); return; }
      addMedia(ctx, { kind: 'image', src, alt: (n.attrs?.alt as string) || textOf(n).trim() });
      return;
    }
    case 'videoBlock': {
      const local = (n.attrs?.localFilePath as string) || '';
      const src = (n.attrs?.src as string) || '';
      if (local !== '' || src.startsWith('media://')) { addMedia(ctx, { kind: 'video', src: local || src }); return; }
      if (src !== '') addText(ctx, src, 'para');
      ctx.warn.add('外链视频不能当附件,按链接发出');
      return;
    }
    case 'audioBlock': ctx.warn.add('音频 X 发不了,已略过'); return;
    case 'fileBlock': ctx.warn.add('文件 X 发不了,已略过'); return;
    case 'mathBlock': render(ctx, n, 'math', (n.attrs?.latex as string) || textOf(n)); return;
    case 'codeBlock': {
      const what = needsImage(n);
      /** 短代码直接发字(用户 10-28 选「短的发文字」) */
      if (what === null) { addText(ctx, textOf(n).replace(/\n+$/, ''), 'para'); return; }
      render(ctx, n, what, textOf(n));
      return;
    }
    case 'mathVisual': render(ctx, n, 'mathVisual', (n.attrs?.thumbnail as string) || ''); return;
    case 'htmlBlock': render(ctx, n, 'html', textOf(n)); return;
    case 'table': render(ctx, n, 'table', (n.content ?? []).map((row) => (row.content ?? []).map(textOf).join(' | ')).join('\n')); return;
    case 'tweetBlock': {
      const url = (n.attrs?.tweetUrl as string) || '';
      if (url !== '') addText(ctx, url, 'para');
      return;
    }
    case 'externalRef': {
      const href = (n.attrs?.href as string) || '';
      const t = (n.attrs?.title as string) || '';
      addText(ctx, t && t !== href ? `${t} ${href}` : href, 'para');
      return;
    }
    case 'defBlock': addText(ctx, textOf(n), 'para'); return;
    case 'toggleList': case 'columnList': case 'column': case 'frameBlock': case 'listItem': case 'taskItem':
      for (const c of n.content ?? []) block(c, ctx, indent);
      return;
    default: {
      const s = textOf(n);
      ctx.warn.add(`认不出的块 ${n.type}${s.trim() !== '' ? ',只留了文字' : ',已略过'}`);
      addText(ctx, s, 'para');
    }
  }
}

// ── 第二步:单元 → 一条推的字 ──

function sep(a: TextUnit, b: TextUnit): string {
  if (b.cont) return '';
  if (a.list !== undefined && a.list === b.list) return '\n';
  return '\n\n';
}
function joinTexts(texts: readonly TextUnit[]): string {
  let s = '';
  texts.forEach((u, i) => { s += i === 0 ? u.text.replace(/^\s+/, '') : sep(texts[i - 1], u) + u.text; });
  return s;
}

type MediaCount = { images: number; videos: number };
function countMedia(ms: readonly PostMedia[]): MediaCount {
  return { images: ms.filter((m) => m.kind !== 'video').length, videos: ms.filter((m) => m.kind === 'video').length };
}
/** X 规则:一条最多 4 张图,或 1 个视频,两者不能同时有 */
function mediaProblem(ms: readonly PostMedia[]): string | null {
  const c = countMedia(ms);
  if (c.videos > 0 && c.images > 0) return 'X 一条推里视频和图片不能同时有';
  if (c.videos > 1) return 'X 一条推最多 1 个视频';
  if (c.images > MAX_IMAGES) return `X 一条推最多 ${MAX_IMAGES} 张图(这里 ${c.images} 张)`;
  return null;
}

/** X 收的图片格式(SVG 不收,要先转成图) */
const X_IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

/**
 * 这条推的附件现在能不能填进 X —— 不能的话为什么(预览窗的按钮和 x.post.fill 用同一句,不各写一份)。
 * 第④a期只做 note 里存在本机图片库(media://)的图;转图 / 视频是第④期剩下的,还没做。
 */
export function fillProblem(ms: readonly PostMedia[]): string | null {
  for (const m of ms) {
    if (m.kind === 'render') return m.error ? `${RENDER_LABEL[m.what]}没转成图:${m.error}` : `${RENDER_LABEL[m.what]}还没转成图(预览窗打开时会自动转,转好再发)`;
    if (m.kind === 'video') return '视频还不能填进 X(还没做)—— 现在先把它去掉再发';
    if (!m.src.startsWith('media://')) return `有张图不在本机图片库里(${m.src.slice(0, 40)})—— 现在只能发存在本机的图`;
    if (!X_IMAGE_EXT.test(m.src)) return `X 不收这种图(${m.src.split('/').pop()})—— 只收 jpg / png / gif / webp`;
  }
  return null;
}

/** X 一个推串最多几条 */
export const X_THREAD_MAX = 25;
/** 现在能填进 X 的发法(推串 2026-10-28 用户「先把推文的各种形式搞完善」从第⑤期提前) */
export const FILLABLE: readonly PostForm[] = ['single', 'thread', 'image', 'article'];
const LATER: Partial<Record<PostForm, string>> = { longPost: '第⑤期' };

/** 这种发法现在还不能填进 X 的话,为什么(x.post.fill 的 preflight 先挡,不碰网页) */
export function formNotFillable(form: PostForm): string | null {
  return FILLABLE.includes(form) ? null : `这种发法还不能填进 X(${LATER[form] ?? '以后'}做)—— 现在能发单条推、推串、整篇转图、X 文章`;
}

/**
 * 按这种发法排出来的这几条,现在能不能填进 X —— 不能的话为什么。
 * 预览窗的「发布」按钮和 x.post.fill 用同一句,不各写一份。
 */
export function fillBlock(opt: PostOption): string | null {
  const notYet = formNotFillable(opt.form);
  if (notYet) return notYet;
  if (!opt.available) return `这段内容不能这么发:${opt.why ?? '没有这种发法'}`;
  if (opt.form === 'article') return opt.article ? articleProblem(opt.article) : '没排出文章';
  const n = opt.posts.length;
  if (n === 0) return '正文是空的';
  if (opt.form === 'single' && n !== 1) return `排出来是 ${n} 条,单条推只能 1 条`;
  if (n > X_THREAD_MAX) return `排出来是 ${n} 条,X 一个推串最多 ${X_THREAD_MAX} 条 —— 删短一点,或改发 X 文章`;
  for (const [k, p] of opt.posts.entries()) {
    const why = fillProblem(p.media)
      ?? mediaProblem(p.media)
      ?? (p.text.trim() === '' && p.media.length === 0 ? '是空的' : null)
      ?? (p.weight > X_POST_LIMIT ? `超过字数了(${p.weight} / ${X_POST_LIMIT})` : null);
    if (why) return n > 1 ? `第 ${k + 1} 条:${why}` : why === '是空的' ? '正文是空的' : why;
  }
  return null;
}

const draft = (texts: readonly TextUnit[], media: readonly PostMedia[], suffix = ''): PostDraft => {
  const body = joinTexts(texts);
  /** 只有图的那条:正文就是页码,前面不留空格 */
  const text = body === '' ? suffix.trimStart() : body + suffix;
  return { text, weight: xWeightedLength(text), media };
};

// ── 第三步:推串 ──

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });

/** 切句:中文句末标点(连同后面的引号)后断;英文 . ! ? 后跟空白才断(空白留在前一句) */
function sentences(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i];
    const c = chars[i];
    const next = chars[i + 1];
    let cut = false;
    if (/[。！？!?…]/.test(c) && !/[。！？!?…」』”"']/.test(next ?? '')) cut = true;
    if (/[」』”"']/.test(c) && /[。！？!?…]/.test(chars[i - 1] ?? '')) cut = true;
    if (/[.!?]/.test(c) && next !== undefined && /\s/.test(next)) {
      while (i + 1 < chars.length && /\s/.test(chars[i + 1])) cur += chars[++i];
      cut = true;
    }
    if (cut) { out.push(cur); cur = ''; }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** 一句话本身放不下:按看得见的字硬切 */
function hardSplit(s: string, budget: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const { segment } of segmenter.segment(s)) {
    if (cur !== '' && xWeightedLength(cur + segment) > budget) { out.push(cur); cur = ''; }
    cur += segment;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** 转图出来的(或还在转的)—— 一图一条:用户 10-29 选,多图拼在一起 X 会裁掉 */
const isShot = (m: PostMedia): boolean => m.kind === 'render' || (m.kind === 'image' && m.fromBlock !== undefined);

/**
 * pack:转成的图也合并(一条最多 4 张)—— 一图一条排出来超过 THREAD_SUGGEST_MAX 条时用,
 * 代价是 X 时间线上拼格显示会裁(点开看全图),选项上写明。
 */
type Group = { texts: TextUnit[]; media: PostMedia[] };

function buildThread(units: readonly Unit[], warn: Set<string>, pack = false): PostDraft[] {
  return drafts(threadGroups(units, warn, pack));
}

/** 每组一条推;页码跟在正文后面同一行(用户 10-28 选的:空一行再写页码,在 X 上看着像另一条) */
function drafts(groups: readonly Group[]): PostDraft[] {
  const n = groups.length;
  return groups.map((c, i) => draft(c.texts, c.media, n > 1 ? ` ${i + 1}/${n}` : ''));
}

function threadGroups(units: readonly Unit[], warn: Set<string>, pack = false): Group[] {
  type Cur = Group;
  const done: Cur[] = [];
  let cur: Cur = { texts: [], media: [] };
  const nonEmpty = (): boolean => cur.texts.length > 0 || cur.media.length > 0;
  const flush = (): void => { if (nonEmpty()) done.push(cur); cur = { texts: [], media: [] }; };
  const fits = (u: TextUnit): boolean => xWeightedLength(joinTexts([...cur.texts, u])) <= THREAD_BUDGET;
  const place = (u: TextUnit): void => {
    if (fits(u)) { cur.texts.push(u); return; }
    flush();
    cur.texts.push({ ...u, cont: false });
  };

  /** 从第 i 个单元起这一节的字(到下一个小标题 / 分隔线为止) */
  const section = (i: number): TextUnit[] => {
    const out: TextUnit[] = [];
    for (let j = i; j < units.length; j++) {
      const v = units[j];
      if (v.k === 'break') break;
      if (v.k !== 'text') continue;
      if (j > i && (v.role === 'heading' || v.role === 'title')) break;
      out.push(v);
    }
    return out;
  };

  for (const [i, u] of units.entries()) {
    if (u.k === 'break') { flush(); continue; }
    if (u.k === 'media') {
      /** 转成的图单独一条(前面挨着的字跟它一条,比如「质能方程如下:」),后面的字另起 */
      if (isShot(u.m) && !pack) {
        if (cur.media.length > 0) flush();
        cur.media.push(u.m);
        flush();
        continue;
      }
      if ((!pack && cur.media.some(isShot)) || mediaProblem([...cur.media, u.m]) !== null) flush();
      cur.media.push(u.m);
      continue;
    }
    /**
     * 小标题:整节塞得进这条就接着写,塞不下才开新的一条(不让小标题孤零零落在上一条末尾)。
     * 原来见小标题就开新条 —— 299 字带 5 个小标题排成 6 条;用户 10-28:「应该两个对话就够了」。
     */
    if ((u.role === 'heading' || u.role === 'title') && nonEmpty()
      && xWeightedLength(joinTexts([...cur.texts, ...section(i)])) > THREAD_BUDGET) flush();
    if (fits(u)) { cur.texts.push(u); continue; }
    if (nonEmpty()) flush();
    if (fits(u)) { cur.texts.push(u); continue; }
    /** 一段放不下:按句子切;一句也放不下才在句中硬切 */
    let first = true;
    for (const sen of sentences(u.text)) {
      const pieces = xWeightedLength(sen) <= THREAD_BUDGET ? [sen] : hardSplit(sen, THREAD_BUDGET);
      if (pieces.length > 1) warn.add(`有一句话超过 ${THREAD_BUDGET} 字,只能在句中断开`);
      for (const piece of pieces) {
        place({ k: 'text', text: piece, role: u.role, list: u.list, cont: !first });
        first = false;
      }
    }
  }
  flush();
  return done;
}

// ── 推串手动排(用户 10-29「让用户自己拖动合并」)──

/**
 * 推串拆成「件」:一段字 / 一张图。自动排好的每条是几件,人在预览里合并 / 分开 / 拖图改的就是「哪条放哪几件」。
 * 只改分组,不改字、不改顺序里的字(字只在 note 里改)。
 */
export type ThreadItem = { readonly k: 'text'; readonly text: string } | { readonly k: 'media'; readonly m: PostMedia };
/** 人排的:posts[i] = 第 i 条放哪几件(下标进 items);key 是这些件的指纹 —— note 改了对不上就作废,重新自动排 */
export type ThreadLayout = { readonly key: string; readonly posts: readonly (readonly number[])[] };
export type ThreadEdit = {
  readonly key: string;
  readonly items: readonly ThreadItem[];
  /** 现在每条放哪几件(人排过就是人排的) */
  readonly posts: readonly (readonly number[])[];
  readonly manual: boolean;
};

/** 图的指纹不看 src:转图还在画(render)和画好了(image)是同一件 */
const mediaKey = (m: PostMedia): string =>
  m.kind === 'render' ? `shot:${m.what}` : m.kind === 'image' && m.fromBlock ? `shot:${m.fromBlock}` : `${m.kind}:${m.src}`;

function layoutKey(items: readonly ThreadItem[]): string {
  const s = items.map((it) => (it.k === 'text' ? `t:${it.text}` : `m:${mediaKey(it.m)}`)).join('\u0000');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${items.length}:${h.toString(36)}`;
}

/** 人排的用不了(note 改了 / 件对不上)→ 为什么;用得了 → null */
function layoutProblem(layout: ThreadLayout, key: string, n: number): string | null {
  if (layout.key !== key) return 'note 内容变了';
  const seen = new Set<number>();
  for (const post of layout.posts) {
    if (post.length === 0) return '有一条是空的';
    for (const i of post) {
      if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return '分组对不上';
      seen.add(i);
    }
  }
  return seen.size === n ? null : '有的件没放进任何一条';
}

function threadEdit(groups: readonly Group[], layout: ThreadLayout | undefined, warn: Set<string>): { groups: Group[]; edit: ThreadEdit } {
  const items: ThreadItem[] = [];
  const texts: TextUnit[] = [];
  const auto: number[][] = groups.map((g) => {
    const idx: number[] = [];
    for (const u of g.texts) { idx.push(items.length); texts[items.length] = u; items.push({ k: 'text', text: u.text }); }
    for (const m of g.media) { idx.push(items.length); items.push({ k: 'media', m }); }
    return idx;
  });
  const key = layoutKey(items);
  const why = layout ? layoutProblem(layout, key, items.length) : 'none';
  if (layout && why) warn.add(`手动排的分条用不上了(${why}),已重新自动排`);
  if (why) return { groups: [...groups], edit: { key, items, posts: auto, manual: false } };
  const posts = (layout as ThreadLayout).posts;
  const mine = posts.map((idx) => ({
    texts: idx.filter((i) => items[i].k === 'text').map((i) => texts[i]),
    media: idx.flatMap((i) => { const it = items[i]; return it.k === 'media' ? [it.m] : []; }),
  }));
  return { groups: mine, edit: { key, items, posts, manual: true } };
}

// ── 整篇转图 ──

/**
 * ⭐ 整篇转图(用户 10-29 定):
 *  - 短文 + 普通图片(没有要转图的块,推串 3 条以内装得下)→ 照旧单条推 / 推串,一条最多 4 张图;
 *  - 其他(有公式 / 代码 / 流程图 / 表格… 要转图的块,或太长)→ 建议整篇画成**一张图**一条推(用户选 A:「一律整篇一张图」),或 X 文章。
 * 一张图里文字、公式、表格… 原样排在一起,正文是 note 开头一句。单条推 / 推串照样能手动选,只是不建议。
 * 画图在渲染进程(x-post-render 的 annotateSections),画好的标在第一个块的 attrs.xSectionImage / xSectionImageError。
 * ⚠️ 很长的 note 画成一张很高的图:X 时间线上会不会只露一截、PNG 会不会超 X 的 5MB 都没实测(10-29)。
 */
/**
 * ⭐ 推串超过这么多条就不建议(用户 10-29:「超过3条短推都不建议了」「按照3建议吧,太长是没有意义的」)。
 * 只是不建议,用户自己选照样能发。
 */
export const THREAD_SUGGEST_MAX = 3;

function unitsOf(nodes: readonly PmNode[]): Ctx {
  const ctx: Ctx = { units: [], warn: new Set(), listSeq: 0 };
  for (const n of nodes) block(n, ctx, 0);
  return ctx;
}

/** 是不是「短文 + 普通图片」之外的(要转图的块 / 推串超 3 条)—— 是就给整篇转图并建议它 */
export function sectionsOffered(nodes: readonly PmNode[]): boolean {
  return countImageBlocks(nodes) > 0 || buildThread(unitsOf(nodes).units, new Set()).length > THREAD_SUGGEST_MAX;
}

/** 整篇里要转图的块有几个(往容器里递归) */
export function countImageBlocks(nodes: readonly PmNode[]): number {
  let n = 0;
  for (const c of nodes) n += needsImage(c) !== null ? 1 : countImageBlocks(c.content ?? []);
  return n;
}

/** 画成哪几张:现在整篇一张(用户选 A);留成数组,以后太长要分张(B)只改这里 */
export function imageSections(nodes: readonly PmNode[]): number[][] {
  const from = leadText(nodes) === null ? 0 : 1;
  return nodes.length <= from ? [] : [nodes.slice(from).map((_, i) => i + from)];
}

/**
 * 开头第一块拿来当推文正文、图里不画它(用户 10-29:「note 有标题时,标题当推文正文,图里就不再画标题」
 * 「开头的第一个 block 如果不超过文字长度,没有行内公式就做正文」)—— 能拿就返回它的字,不能就 null(照旧:开头一句当正文、整篇都画)。
 * 能拿:段落 / 标题、有字、没有行内公式(needsImage 为 null)、一条推装得下;后面还得有东西可画。
 */
export function leadText(nodes: readonly PmNode[]): string | null {
  const n = nodes[0];
  if (!n || nodes.length < 2 || (n.type !== 'paragraph' && n.type !== 'heading') || needsImage(n) !== null) return null;
  const s = inline(n.content, { units: [], warn: new Set(), listSeq: 0 }).trim();
  return s !== '' && xWeightedLength(s) <= X_POST_LIMIT ? s : null;
}

/** 一节的开头当正文:第一个有字的块的第一行,太长截断 */
const OPENING_CHARS = 60;
function opening(nodes: readonly PmNode[]): string {
  for (const n of nodes) {
    const line = textOf(n).split('\n').map((l) => l.trim()).find((l) => l !== '');
    if (!line) continue;
    const g = [...segmenter.segment(line)].map((x) => x.segment);
    return g.length > OPENING_CHARS ? `${g.slice(0, OPENING_CHARS).join('')}…` : line;
  }
  return '';
}

function buildSections(nodes: readonly PmNode[]): PostDraft[] {
  const secs = imageSections(nodes);
  const n = secs.length;
  return secs.map((idx, i) => {
    const sec = idx.map((k) => nodes[k]);
    const head = sec[0].attrs ?? {};
    const src = head.xSectionImage as string | undefined;
    const text = (i === 0 ? leadText(nodes) : null) ?? opening(sec);
    const m: PostMedia = src
      ? { kind: 'image', src, alt: text || '整篇转图', fromBlock: 'section' }
      : { kind: 'render', what: 'section', source: text, error: head.xSectionImageError as string | undefined };
    return draft(text === '' ? [] : [{ k: 'text', text, role: 'para' }], [m], n > 1 ? ` ${i + 1}/${n}` : '');
  });
}

// ── 合起来 ──

export function composePost(nodes: readonly PmNode[], layout?: ThreadLayout): PostPlan {
  const ctx = unitsOf(nodes);

  const texts = ctx.units.filter((u): u is TextUnit => u.k === 'text');
  const media = ctx.units.flatMap((u) => (u.k === 'media' ? [u.m] : []));
  const whole = draft(texts, media);
  const article = draft(texts.filter((u) => u.role !== 'title'), media);
  const shots = media.filter(isShot).length;
  /** 一图一条:转成的图超过 1 张,一条推放不下(拼在一起 X 会裁) */
  const mediaWhy = (shots > 1 ? `转成的图有 ${shots} 张,一图一条要发推串` : null) ?? mediaProblem(media);
  const singleWhy = whole.weight > X_POST_LIMIT ? `${whole.weight} / ${X_POST_LIMIT},超了 ${whole.weight - X_POST_LIMIT}` : mediaWhy;
  const oneEach = threadGroups(ctx.units, ctx.warn);
  /** 一图一条超过 3 条:转成的图也并起来(一条最多 4 张),条数少了才用 */
  const packed = oneEach.length > THREAD_SUGGEST_MAX ? threadGroups(ctx.units, ctx.warn, true) : oneEach;
  const autoGroups = packed.length < oneEach.length ? packed : oneEach;
  const threadPacked = autoGroups !== oneEach;
  const edited = threadEdit(autoGroups, layout, ctx.warn);
  const thread = drafts(edited.groups);
  const renders = media.filter((m) => m.kind === 'render');
  const headings = texts.filter((u) => u.role === 'heading').length;
  const hasTable = renders.some((m) => m.kind === 'render' && m.what === 'table');
  const imageBlocks = countImageBlocks(nodes);
  const offered = imageBlocks > 0 || oneEach.length > THREAD_SUGGEST_MAX;
  const sections = offered ? buildSections(nodes) : [];
  const sectionsOk = sections.length > 0 && sections.length <= X_THREAD_MAX;

  let suggested: PostForm;
  let reason: string;
  if (!offered && singleWhy === null) {
    suggested = 'single';
    reason = `${whole.weight} / ${X_POST_LIMIT},一条发得下`;
  } else if (!offered) {
    suggested = 'thread';
    reason = `${singleWhy},按段落拆成 ${thread.length} 条`;
  } else if (sectionsOk) {
    suggested = 'image';
    reason = imageBlocks > 0
      ? `有${[...new Set(media.flatMap((m) => (m.kind === 'render' ? [m.what] : m.kind === 'image' && m.fromBlock ? [m.fromBlock] : [])).map((w) => RENDER_LABEL[w]))].join(' / ')},整篇画成一张图一条推,排版和 note 里一样`
      : `推串要 ${oneEach.length} 条,超过 ${THREAD_SUGGEST_MAX} 条太长;整篇画成一张图一条推`;
  } else if (headings >= 2 || hasTable) {
    suggested = 'article';
    reason = `有${hasTable ? '表格' : `${headings} 个小标题`},结构像文章`;
  } else {
    suggested = 'thread';
    reason = `${singleWhy ?? ''},按段落拆成 ${thread.length} 条`;
  }

  return {
    empty: texts.length === 0 && media.length === 0,
    weight: whole.weight,
    suggested,
    reason,
    title: ctx.title,
    options: [
      { form: 'single', label: '单条推', available: singleWhy === null, why: singleWhy ?? undefined, posts: [whole] },
      {
        form: 'thread', label: '推串', available: thread.length > 0, posts: thread,
        note: edited.edit.manual ? '按你手动排的分条'
          : threadPacked ? `一图一条要 ${oneEach.length} 条,太长,转成的图并在一起了 —— X 时间线上几张图拼格显示会裁,点开看全图` : undefined,
      },
      {
        form: 'longPost', label: '长推', available: whole.weight <= LONG_POST_LIMIT && mediaWhy === null,
        why: whole.weight > LONG_POST_LIMIT ? `长推最多 ${LONG_POST_LIMIT} 字` : mediaWhy ?? undefined,
        note: '要 Premium(还认不出你的号是不是 Premium)', posts: [whole],
      },
      { form: 'article', label: 'X 文章', available: true, note: 'X 文章要 Premium;公式 / 表格 / 代码用 X 自己的,流程图 / 分栏转成图', posts: [article], article: articleDraft(nodes) },
      {
        form: 'image', label: '整篇转图', available: sectionsOk,
        why: sectionsOk ? undefined : '只有文字和普通图片、也不长 —— 用不着整篇转图',
        note: '整篇画成一张图一条推,排版和 note 里一样', posts: sections,
      },
    ],
    threadEdit: edited.edit,
    warnings: [...ctx.warn],
  };
}
