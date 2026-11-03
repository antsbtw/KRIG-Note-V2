/**
 * ⭐ 把排好的 X 文章一步步填进 X 文章编辑器(发推第⑥期,2026-10-30)—— 主进程;不发
 *
 * 步骤(x-post-article 排的)→ 页面脚本 x.articleAct 的一个 op,或输入引擎的喂文件 / 真点击。
 * 顺序:新建 → 封面 → 标题 → 真点击正文第一行(X 只认它自己的光标)→ 一块块往下 → 读回核对。
 * 填到一半没成 → 删掉这份草稿(X 文章一新建就存成草稿,不删会留在 X 的草稿箱里)。
 * ⚠️ 调之前网页必须已被执行器占着。⚠️ 这里不点发布。
 */
import { inputEngine } from '@platform/main/web-capability/wiring/runtime';
import { resolve as resolvePage } from '@platform/main/web-capability/wiring/web-collect-engine';
import { webviewPorts } from './x-collect-ports';
import { X_ARTICLE_SCRIPT } from './x-article-scripts';
import { X_ANCHORS, X_PAGE_NAME } from './x-pages';
import type { ArticleStep } from './x-post-article';
import type { PendingPost, PublishOutcome } from './x-post-draft';

/** 填进去的一步:图片换成磁盘文件(调用方从 media:// 解出来) */
export type ArticleFillStep = Exclude<ArticleStep, { k: 'media' }> | { readonly k: 'image'; readonly file: string };
export type ArticleFill = { readonly title: string; readonly cover: string | null; readonly steps: readonly ArticleFillStep[] };
export type ArticleFillOutcome = { readonly ok: true; readonly editId: string; readonly warnings: readonly string[] } | { readonly ok: false; readonly why: string };

type Act = { state?: string; why?: string; editId?: string; [k: string]: unknown } | null;

/**
 * 图插进去之后:等它出现在正文里 → 等 X 顶上变成「Last saved just now」(存好了)再往下,最多 IMAGE_SAVE_MS。
 * ⚠️ 11-02 删掉了「等图从 blob: 变成 X 的地址」(X 从不换,每张死等 20 秒);
 *   11-03 只稳 1.5 秒又太快(第 5 张图后粘小标题 X 没接住)→ 改成主动看保存状态(用户:「应该主动检查而不是等待」)。
 */
const IMAGE_SAVE_MS = 20_000;

export async function fillArticle(
  wcId: number, a: ArticleFill, progress: (step: number, total: number, what: string) => void = () => undefined,
): Promise<ArticleFillOutcome> {
  const ports = webviewPorts(wcId);
  const act = (op: string, p: Record<string, unknown> = {}): Promise<Act> => ports.runScript(X_ARTICLE_SCRIPT, { op, ...p }) as Promise<Act>;
  const page = resolvePage({ wcId });
  const t0 = Date.now();
  if ('error' in page) return { ok: false, why: page.error };

  const go = await ports.goto(X_PAGE_NAME.composeArticles, {});
  if (!go.ok) return { ok: false, why: `X 文章页没打开:${go.reason ?? '?'}` };
  const made = await act('create');
  if (made?.state === 'hidden') return { ok: false, why: made.why ?? 'X 网页没显示出来' };
  if (made?.state !== 'ok' || !made.editId) return { ok: false, why: `没新建成文章:${made?.why ?? made?.state ?? '脚本没回话'}` };
  const editId = made.editId;
  console.log(`[x.post] X 文章新建了草稿 ${editId}`);
  /** 从这里起,没成就删掉这份草稿 */
  const fail = async (why: string): Promise<ArticleFillOutcome> => {
    const d = await deleteArticle(wcId, editId);
    return { ok: false, why: `${why} —— ${d.deleted ? '这份草稿已删掉' : `草稿没删掉(${d.detail}),在 X 的文章草稿箱里手动删`}` };
  };
  const warnings: string[] = [];

  const total = a.steps.length;
  progress(0, total, '新建文章');
  if (a.cover) {
    progress(0, total, '封面');
    const fed = await inputEngine.feed(page.pageId, { anchor: X_ANCHORS.articleCoverInput, files: [a.cover], check: { kind: 'none' } });
    if (fed.status === 'failed') return fail(`封面没放进去:${fed.reason}`);
    const ap = await act('coverApply');
    console.log(`[x.post] X 文章封面:${JSON.stringify(ap)}`);
    if (ap?.state !== 'ok') return fail(`封面没放上:${ap?.why ?? ap?.state ?? '脚本没回话'}`);
  }
  if (a.title) {
    const t = await act('title', { text: a.title });
    if (t?.state !== 'ok') return fail(`标题没填进去(${t?.state ?? '脚本没回话'})`);
  }
  /** 新文章正文只有空的一行:真点它,X 的光标落进正文(脚本设的选区 X 不理,10-30 真机:公式插到了第一段后面) */
  const tap = await inputEngine.tap(page.pageId, { anchor: X_ANCHORS.articleFirstLine, trusted: true });
  if (tap.status === 'failed') return fail(`点不进正文:${tap.reason}`);

  let images = 0;
  for (const [i, s] of a.steps.entries()) {
    const at = `第 ${i + 1} / ${a.steps.length} 步`;
    progress(i + 1, total, STEP_NAME[s.k]);
    let r: Act;
    switch (s.k) {
      case 'html': r = await act('paste', { html: s.html, text: s.text }); break;
      case 'heading': r = await act('paste', { html: `<h${s.level}>${esc(s.text)}</h${s.level}>`, text: s.text }); break;
      case 'latex': r = await act('latex', { latex: s.latex }); break;
      case 'code':
        r = await act('code', { language: s.language, code: s.code });
        if (r?.state === 'ok' && s.language && !r.language) warnings.push(`代码块的语言「${s.language}」X 里没有,按没语言插了`);
        break;
      case 'table': r = await act('table', { rows: s.rows, cols: s.cols, markdown: s.markdown }); break;
      case 'divider': r = await act('divider'); break;
      case 'image': {
        r = await act('mediaOpen');
        if (r?.state !== 'ok') break;
        const fed = await inputEngine.feed(page.pageId, { anchor: X_ANCHORS.articleMediaInput, files: [s.file], check: { kind: 'none' } });
        if (fed.status === 'failed') { r = { state: 'feed-failed', why: fed.reason }; break; }
        images += 1;
        r = await act('mediaWait', { want: images, saveMs: IMAGE_SAVE_MS });
        if (r?.state === 'ok' && !r.savedOk) console.warn(`[x.post] X 文章第 ${images} 张图等了 ${IMAGE_SAVE_MS / 1000} 秒顶上还不是「Last saved just now」(是「${String(r.saved ?? '?')}」)—— 接着往下,读回核对兜着`);
        else if (r?.state === 'ok') console.log(`[x.post] X 文章第 ${images} 张图存好了(${(Number(r.waited) / 1000).toFixed(1)} 秒)`);
        break;
      }
    }
    if (r?.state !== 'ok') {
      console.warn(`[x.post] X 文章${at}(${s.k})没成:${JSON.stringify(r)}`);
      return fail(`${at}(${STEP_NAME[s.k]})没填进去:${r?.why ?? r?.state ?? '脚本没回话'}`);
    }
  }

  progress(total, total, '读回核对');
  /** 读回核对:标题、几张图 / 几张表 / 几段代码,字都在 */
  const st = await act('state');
  const c = (st?.counts ?? {}) as { img?: number; table?: number; code?: number };
  const want = { img: images, table: a.steps.filter((s) => s.k === 'table').length, code: a.steps.filter((s) => s.k === 'code').length };
  const bad: string[] = [];
  if (a.title && st?.title !== a.title) bad.push(`标题是「${String(st?.title ?? '')}」`);
  if ((c.img ?? 0) !== want.img) bad.push(`图 ${c.img ?? 0} / ${want.img}`);
  if ((c.table ?? 0) !== want.table) bad.push(`表格 ${c.table ?? 0} / ${want.table}`);
  if ((c.code ?? 0) !== want.code) bad.push(`代码 ${c.code ?? 0} / ${want.code}`);
  const text = String(st?.text ?? '').replace(/\s+/g, '');
  const lost = a.steps.flatMap((s) => (s.k === 'html' || s.k === 'heading' ? [s.text] : []))
    .filter((t) => !text.includes(t.replace(/\s+/g, '').slice(0, 20)));
  if (lost.length > 0) bad.push(`有 ${lost.length} 段字没找到(「${lost[0].slice(0, 20)}」…)`);
  if (bad.length > 0) return fail(`填完读回对不上:${bad.join(';')}`);
  console.log(`[x.post] X 文章 ${editId} 填好了(${((Date.now() - t0) / 1000).toFixed(0)} 秒):${a.steps.length} 步,${images} 张图${a.cover ? ',有封面' : ''}`);
  return { ok: true, editId, warnings };
}

const STEP_NAME: Record<ArticleFillStep['k'], string> = {
  html: '文字', heading: '小标题', latex: '公式', code: '代码', table: '表格', divider: '分隔线', image: '图片',
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 删掉正在编辑的这份文章草稿(取消 / 填到一半没成)。editId 给了就核对编辑器停在不在这份上 ——
 * 人在 X 上点去了别处 → 不删(没把握删的是哪份),如实说,人去草稿箱删。
 */
export async function deleteArticle(wcId: number, editId?: string): Promise<{ deleted: boolean; detail: string }> {
  const ports = webviewPorts(wcId);
  if (editId) {
    const st = (await ports.runScript(X_ARTICLE_SCRIPT, { op: 'state' })) as Act;
    if (st?.editId !== editId) return { deleted: false, detail: `X 网页已经不在这份文章(${editId})的编辑页上了` };
  }
  const r = (await ports.runScript(X_ARTICLE_SCRIPT, { op: 'delete' })) as Act;
  if (r?.state === 'ok') return { deleted: true, detail: '已删掉这份文章草稿' };
  return { deleted: false, detail: `${r?.state ?? '脚本没回话'}${r?.why ? `:${r.why}` : ''}` };
}

/**
 * 发出去:点 X 文章的 Publish(确认框里再点一次)→ 等离开编辑页。离开了、到了文章页 → sent;离开了但认不出是不是发出去了 / 没离开 → 如实说。
 * ⚠️ 只点一次,不重试。⚠️ 第一次真发(10-30)之前没见过 Publish 之后的页面 —— 返回里带着看到的弹窗字,日志里留着。
 */
export async function publishArticle(wcId: number, p: PendingPost): Promise<PublishOutcome> {
  const base = { tweetIds: [] as string[], sentText: p.text, sentMedia: p.media.length, editedOnX: false };
  const r = (await webviewPorts(wcId).runScript(X_ARTICLE_SCRIPT, { op: 'publish', editId: p.articleId, caption: p.caption ?? '' })) as Act;
  console.log(`[x.post] X 文章 ${p.articleId ?? '?'} 点发布:${JSON.stringify(r)}`);
  if (r?.state === 'left') {
    const o = leftTo(p, String(r.url ?? ''));
    return r.captionKept ? { ...o, detail: `${o.detail}(导语用的是 X 框里已有的字)` } : o;
  }
  if (r?.state === 'caption-failed') return { ...base, outcome: 'failed', untouched: true, detail: `导语没填进 X 的发布弹窗(${String(r.why ?? '')})—— 没点发布;在 X 上自己填了点 Publish,或取消` };
  if (r?.state === 'stuck') {
    return { ...base, outcome: 'unseen', detail: `点了发布 30 秒还在编辑页${r.dialogNow ? `,弹窗里写着「${String(r.dialogNow).slice(0, 80)}」` : ''} —— 请在 X 上看一眼` };
  }
  /** 走到这里的都是脚本在点 Publish 之前就停了(不在编辑页 / 找不到按钮 / 按钮灰 / 脚本没回话)—— 草稿没动 */
  return { ...base, outcome: 'failed', untouched: true, detail: `没点成发布:${r?.why ?? r?.state ?? '脚本没回话'}` };
}

/** 离开编辑页落到了哪:推文 / 文章页 → 发出去了;别处 → 说不清 */
function leftTo(p: PendingPost, url: string): PublishOutcome {
  const base = { tweetIds: [] as string[], sentText: p.text, sentMedia: p.media.length, editedOnX: false };
  const id = /\/article\/(\d+)/.exec(url)?.[1] ?? /\/status\/(\d+)/.exec(url)?.[1];
  if (id) return { ...base, outcome: 'sent', detail: `发出去了,到了文章页 ${url}`, tweetId: id, tweetIds: [id], url };
  return { ...base, outcome: 'unseen', detail: `点了发布、离开了编辑页,但停在 ${url},认不出是不是文章页 —— 请在 X 上看一眼` };
}

/** 人在 X 网页上自己点的 Publish(x-post-article-watch 看见离开编辑页到了推文页)—— 不点任何东西,只按落到的页定结果 */
export function seenPublished(p: PendingPost, url: string): PublishOutcome {
  const o = leftTo(p, url);
  return { ...o, editedOnX: true, detail: `在 X 网页上点的发布 —— ${o.detail}` };
}
