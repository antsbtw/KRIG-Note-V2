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

export type PmNode = {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly PmNode[];
  readonly marks?: ReadonlyArray<{ readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }>;
  readonly text?: string;
};

export type RenderWhat = 'math' | 'code' | 'mermaid' | 'table' | 'mathVisual' | 'html' | 'svg' | 'inlineMath';
export type PostMedia =
  | { readonly kind: 'image'; readonly src: string; readonly alt: string }
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
  readonly warnings: readonly string[];
};

const LONG_POST_LIMIT = 25000;
const MAX_IMAGES = 4;
/** 推串每条末尾留给「 12/34」的位置 */
const THREAD_SUFFIX_RESERVE = 6;
const THREAD_BUDGET = X_POST_LIMIT - THREAD_SUFFIX_RESERVE;
const RENDER_LABEL: Record<RenderWhat, string> = {
  math: '公式', code: '代码', mermaid: 'Mermaid', table: '表格', mathVisual: '函数图像', html: 'HTML 块', svg: 'SVG 图', inlineMath: '带行内公式的段落',
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
  if (src) { addMedia(ctx, { kind: 'image', src, alt: `${RENDER_LABEL[what]}(转成的图)` }); return; }
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
export const FILLABLE: readonly PostForm[] = ['single', 'thread'];
const LATER: Partial<Record<PostForm, string>> = { longPost: '第⑤期', article: '第⑥期', image: '第④期剩下的' };

/** 这种发法现在还不能填进 X 的话,为什么(x.post.fill 的 preflight 先挡,不碰网页) */
export function formNotFillable(form: PostForm): string | null {
  return FILLABLE.includes(form) ? null : `这种发法还不能填进 X(${LATER[form] ?? '以后'}做)—— 现在能发单条推和推串`;
}

/**
 * 按这种发法排出来的这几条,现在能不能填进 X —— 不能的话为什么。
 * 预览窗的「发布」按钮和 x.post.fill 用同一句,不各写一份。
 */
export function fillBlock(opt: PostOption): string | null {
  const notYet = formNotFillable(opt.form);
  if (notYet) return notYet;
  if (!opt.available) return `这段内容不能这么发:${opt.why ?? '没有这种发法'}`;
  const n = opt.posts.length;
  if (n === 0) return '正文是空的';
  if (opt.form === 'single' && n !== 1) return `排出来是 ${n} 条,单条推只能 1 条`;
  if (n > X_THREAD_MAX) return `排出来是 ${n} 条,X 一个推串最多 ${X_THREAD_MAX} 条 —— 删短一点,或改发 X 文章`;
  for (const [k, p] of opt.posts.entries()) {
    const why = fillProblem(p.media)
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

function buildThread(units: readonly Unit[], warn: Set<string>): PostDraft[] {
  type Cur = { texts: TextUnit[]; media: PostMedia[] };
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
      if (mediaProblem([...cur.media, u.m]) !== null) flush();
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
  const n = done.length;
  /** 页码跟在正文后面同一行(用户 10-28 选的:空一行再写页码,在 X 上看着像另一条) */
  return done.map((c, i) => draft(c.texts, c.media, n > 1 ? ` ${i + 1}/${n}` : ''));
}

// ── 合起来 ──

export function composePost(nodes: readonly PmNode[]): PostPlan {
  const ctx: Ctx = { units: [], warn: new Set(), listSeq: 0 };
  for (const n of nodes) block(n, ctx, 0);

  const texts = ctx.units.filter((u): u is TextUnit => u.k === 'text');
  const media = ctx.units.flatMap((u) => (u.k === 'media' ? [u.m] : []));
  const whole = draft(texts, media);
  const article = draft(texts.filter((u) => u.role !== 'title'), media);
  const mediaWhy = mediaProblem(media);
  const singleWhy = whole.weight > X_POST_LIMIT ? `${whole.weight} / ${X_POST_LIMIT},超了 ${whole.weight - X_POST_LIMIT}` : mediaWhy;
  const thread = buildThread(ctx.units, ctx.warn);
  const renders = media.filter((m) => m.kind === 'render');
  const headings = texts.filter((u) => u.role === 'heading').length;
  const hasTable = renders.some((m) => m.kind === 'render' && m.what === 'table');

  let suggested: PostForm;
  let reason: string;
  if (singleWhy === null) {
    suggested = 'single';
    reason = renders.length > 0
      ? `${whole.weight} / ${X_POST_LIMIT},一条发得下;${[...new Set(renders.map((m) => RENDER_LABEL[(m as { what: RenderWhat }).what]))].join(' / ')} 会转成图附上`
      : `${whole.weight} / ${X_POST_LIMIT},一条发得下`;
  } else if (whole.weight > X_POST_LIMIT && (headings >= 2 || hasTable)) {
    suggested = 'article';
    reason = `${whole.weight} / ${X_POST_LIMIT},有${hasTable ? '表格' : `${headings} 个小标题`},结构像文章`;
  } else {
    suggested = 'thread';
    reason = `${singleWhy},按段落拆成 ${thread.length} 条`;
  }

  return {
    empty: texts.length === 0 && media.length === 0,
    weight: whole.weight,
    suggested,
    reason,
    title: ctx.title,
    options: [
      { form: 'single', label: '单条推', available: singleWhy === null, why: singleWhy ?? undefined, posts: [whole] },
      { form: 'thread', label: '推串', available: thread.length > 0, posts: thread },
      {
        form: 'longPost', label: '长推', available: whole.weight <= LONG_POST_LIMIT && mediaWhy === null,
        why: whole.weight > LONG_POST_LIMIT ? `长推最多 ${LONG_POST_LIMIT} 字` : mediaWhy ?? undefined,
        note: '要 Premium(还认不出你的号是不是 Premium)', posts: [whole],
      },
      { form: 'article', label: 'X 文章', available: true, note: 'X 文章要 Premium;表格 / 公式 / 代码在文章里原样排(第⑥期)', posts: [article] },
      { form: 'image', label: '整段转图', available: false, why: '还没做(第④期剩下的):整段排成一张图 + 一句话正文', posts: [] },
    ],
    warnings: [...ctx.warn],
  };
}
