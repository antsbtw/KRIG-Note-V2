/**
 * ⭐ 把排好的 X 文章一步步填进 X 文章编辑器(发推第⑥期,2026-10-30)—— 主进程;不发
 *
 * 步骤(x-post-article 排的)→ 页面脚本 x.articleAct 的一个 op,或输入引擎的喂文件 / 真点击。
 * 顺序:新建 → 封面 → 标题 → 真点击正文第一行(X 只认它自己的光标)→ 一块块往下 → 等图传完 → 读回核对。
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
 * 等图传完:每张插完最多等 PER_IMAGE_UPLOAD_MS,最后整篇再等 UPLOAD_WAIT_MS。
 * ⚠️ 判「传完」靠正文里的图从 blob: 变成 X 的地址 —— 这一点没在真机上见过(10-30 脚本喂的图一直是 blob:),
 *   所以只限时等、不挡;日志里记等了多久,下一次真跑就知道会不会变。
 */
const PER_IMAGE_UPLOAD_MS = 20_000;
const UPLOAD_WAIT_MS = 30_000;

export async function fillArticle(wcId: number, a: ArticleFill): Promise<ArticleFillOutcome> {
  const ports = webviewPorts(wcId);
  const act = (op: string, p: Record<string, unknown> = {}): Promise<Act> => ports.runScript(X_ARTICLE_SCRIPT, { op, ...p }) as Promise<Act>;
  const page = resolvePage({ wcId });
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

  if (a.cover) {
    const fed = await inputEngine.feed(page.pageId, { anchor: X_ANCHORS.articleCoverInput, files: [a.cover], check: { kind: 'none' } });
    if (fed.status === 'failed') return fail(`封面没放进去:${fed.reason}`);
    const ap = await act('coverApply');
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
        r = await act('mediaWait', { want: images, uploadMs: PER_IMAGE_UPLOAD_MS });
        if (r?.state === 'ok' && Number(r.uploading) > 0) console.warn(`[x.post] X 文章第 ${images} 张图等了 ${PER_IMAGE_UPLOAD_MS / 1000} 秒还是 blob:(没传完,或 X 不换地址)—— 接着往下`);
        else if (r?.state === 'ok') console.log(`[x.post] X 文章第 ${images} 张图传完(等了 ${(Number(r.waited) / 1000).toFixed(1)} 秒)`);
        break;
      }
    }
    if (r?.state !== 'ok') {
      console.warn(`[x.post] X 文章${at}(${s.k})没成:${JSON.stringify(r)}`);
      return fail(`${at}(${STEP_NAME[s.k]})没填进去:${r?.why ?? r?.state ?? '脚本没回话'}`);
    }
  }

  const up = await act('uploads', { ms: UPLOAD_WAIT_MS });
  if (up?.state !== 'ok') warnings.push(`等了 ${UPLOAD_WAIT_MS / 1000} 秒还有 ${String(up?.busy ?? '?')} 张图在上传 —— 在 X 上看一眼`);

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
  console.log(`[x.post] X 文章 ${editId} 填好了:${a.steps.length} 步,${images} 张图${a.cover ? ',有封面' : ''}`);
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
  const r = (await webviewPorts(wcId).runScript(X_ARTICLE_SCRIPT, { op: 'publish', editId: p.articleId })) as Act;
  console.log(`[x.post] X 文章 ${p.articleId ?? '?'} 点发布:${JSON.stringify(r)}`);
  if (r?.state === 'left') {
    const url = String(r.url ?? '');
    const id = /\/article\/(\d+)/.exec(url)?.[1] ?? /\/status\/(\d+)/.exec(url)?.[1];
    if (id) return { ...base, outcome: 'sent', detail: `发出去了,到了文章页 ${url}`, tweetId: id, tweetIds: [id], url };
    return { ...base, outcome: 'unseen', detail: `点了发布、离开了编辑页,但停在 ${url},认不出是不是文章页 —— 请在 X 上看一眼` };
  }
  if (r?.state === 'stuck') {
    return { ...base, outcome: 'unseen', detail: `点了发布 30 秒还在编辑页${r.dialogNow ? `,弹窗里写着「${String(r.dialogNow).slice(0, 80)}」` : ''} —— 请在 X 上看一眼` };
  }
  return { ...base, outcome: 'failed', detail: `没点成发布:${r?.why ?? r?.state ?? '脚本没回话'}` };
}
