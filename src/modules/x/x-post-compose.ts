/**
 * ⭐⭐ note → 推文 排版(发推第①期,2026-10-27)—— 纯函数,两个进程都能用(只吃 PM JSON,不碰 Electron / DOM)
 *
 * 设计 docs/10-business-design/x/x-posting-design.md §3:先把 note 的块拆成「单元」(一段字 / 一个附件 / 一个断点),
 * 再按五种发法各排一份,给出建议的那种。界面(预览窗)和 AI 都经能力 x.post.prepare 调它。
 *
 * ⚠️ 不静默丢东西:X 发不了的(音频 / 文件 / 外链视频)、只能降级的(行内公式)、认不出的块,都进 warnings。
 * ⚠️ 公式 / 代码 / Mermaid / 表格 这期只标「要转成图」(media.kind = render),真渲染是第④期剩下的(还没做)。
 * 第④a期(10-28)能填进 X 的附件只有 note 里存在本机图片库的图(fillProblem 判)。
 */
import { X_POST_LIMIT, xWeightedLength } from './x-post-length';

export type PmNode = {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly PmNode[];
  readonly marks?: ReadonlyArray<{ readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }>;
  readonly text?: string;
};

export type RenderWhat = 'math' | 'code' | 'mermaid' | 'table' | 'mathVisual' | 'html';
export type PostMedia =
  | { readonly kind: 'image'; readonly src: string; readonly alt: string }
  | { readonly kind: 'video'; readonly src: string }
  /** 要渲染成图的块(第④期才真渲染) */
  | { readonly kind: 'render'; readonly what: RenderWhat; readonly source: string };

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
/** 推串每条末尾留给「\n\n12/34」的位置 */
const THREAD_SUFFIX_RESERVE = 7;
const THREAD_BUDGET = X_POST_LIMIT - THREAD_SUFFIX_RESERVE;
const RENDER_LABEL: Record<RenderWhat, string> = { math: '公式', code: '代码', mermaid: 'Mermaid', table: '表格', mathVisual: '函数图像', html: 'HTML 块' };

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
const render = (ctx: Ctx, what: RenderWhat, source: string): void => {
  addMedia(ctx, { kind: 'render', what, source });
  ctx.warn.add('公式 / 代码 / Mermaid / 表格 会转成图附上(转图还没做,现在预览只是占位)');
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
    case 'mathBlock': render(ctx, 'math', (n.attrs?.latex as string) || textOf(n)); return;
    case 'codeBlock': {
      const lang = ((n.attrs?.language as string) || '').toLowerCase();
      render(ctx, lang === 'mermaid' ? 'mermaid' : 'code', textOf(n));
      return;
    }
    case 'mathVisual': render(ctx, 'mathVisual', (n.attrs?.thumbnail as string) || ''); return;
    case 'htmlBlock': render(ctx, 'html', textOf(n)); return;
    case 'table': render(ctx, 'table', (n.content ?? []).map((row) => (row.content ?? []).map(textOf).join(' | ')).join('\n')); return;
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
    if (m.kind === 'render') return `${RENDER_LABEL[m.what]}要先转成图(转图还没做)—— 现在先把它去掉再发`;
    if (m.kind === 'video') return '视频还不能填进 X(还没做)—— 现在先把它去掉再发';
    if (!m.src.startsWith('media://')) return `有张图不在本机图片库里(${m.src.slice(0, 40)})—— 现在只能发存在本机的图`;
    if (!X_IMAGE_EXT.test(m.src)) return /\.svg$/i.test(m.src) ? 'SVG 图 X 不收,要先转成图(转图还没做)' : `X 不收这种图(${m.src.split('/').pop()})—— 只收 jpg / png / gif / webp`;
  }
  return null;
}

const draft = (texts: readonly TextUnit[], media: readonly PostMedia[], suffix = ''): PostDraft => {
  const text = joinTexts(texts) + suffix;
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

  for (const u of units) {
    if (u.k === 'break') { flush(); continue; }
    if (u.k === 'media') {
      if (mediaProblem([...cur.media, u.m]) !== null) flush();
      cur.media.push(u.m);
      continue;
    }
    if ((u.role === 'heading' || u.role === 'title') && nonEmpty()) flush();
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
  return done.map((c, i) => draft(c.texts, c.media, n > 1 ? `\n\n${i + 1}/${n}` : ''));
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
