/**
 * ⭐⭐ X 发文能力(发推第①期,2026-10-27)—— 设计 docs/10-business-design/x/x-posting-design.md §2
 *
 * 用户 10-26:「发推是 x 模块的一个独立功能模块,note 调用接口就可以发推,要保持 AI 也同样能够调用这些功能。」
 * → note 右键、拖块、定时器、AI 都调这里的能力,入口自己不带发推代码。
 *
 * 第①期 x.post.prepare(只排版,input:不碰 X 网页、不对外)。
 * 第②期 x.post.fill(填进 X 发推弹窗不发,占着网页等人确认)/ x.post.cancel(清框、放网页)/ x.post.pending(查待发草稿)。
 * 第③期 x.post.publish(人在 X 上看过点确认 → 点 X 的发布 → 去主页核对)/ x.post.history(这段字发过没)。
 * 第③b期(10-28)x.post.ofNote(这篇 note 发过哪些,note 顶上那行用)/ x.post.show(在 X 网页上打开某条推)。
 * 第④a期(10-28)fill 带图:note 里存在本机图片库的图先喂进 X 再贴字;转图 / 视频是第④期剩下的,还没做。
 * 推串(10-28,用户「先把推文的各种形式搞完善」从第⑤期提前):fill 一条条加进 X 的发推弹窗,publish 点「全部发布」后逐条核对。
 * 每份草稿在 x_post 里一行(fill 建、cancel / publish 写结局)。
 */
import { capFailed, capRefused, execute } from '@platform/main/capability/capability';
import { Bad, str, xCap, type O } from './x-capabilities-common';
import { FILLABLE, composePost, fillBlock, formNotFillable, type PmNode, type PostForm, type PostMedia, type PostPlan, type ThreadLayout } from './x-post-compose';
import { releasePage } from './x-page-lock';
import {
  DRAFT_LOCK_TTL_MS, DRAFT_TTL_MS, addPending, type DraftPost, type FillPost, clearCompose, endPending, endPublished, fillCompose, lastEnded, newDraftId, pendingPost,
  publishCompose, viewOf, type CancelWhy, type PendingPost,
} from './x-post-draft';
import { findNotePosts, findPosted, recordEnded, recordFilled } from './x-post-repo';
import { webviewPorts } from './x-collect-ports';
import { X_PAGE_NAME } from './x-pages';

const isPmNode = (v: unknown): v is PmNode => !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';

/** layout:推串人排过的分条(预览里合并 / 分开 / 挪图,10-29);对不上就照自动排,warnings 里说 */
type PrepareIn = { readonly content?: readonly PmNode[]; readonly noteId?: string; readonly layout?: ThreadLayout };
type FillIn = PrepareIn & { readonly wsId: string; readonly form: PostForm };
type CancelIn = { readonly wsId: string; readonly draftId: string; readonly why: CancelWhy };
type DraftIn = { readonly wsId: string; readonly draftId: string };

/** 草稿 id 对不上 / 没有 → 拒(cancel、publish 共用) */
const noDraft = (i: DraftIn): string | null => {
  const p = pendingPost(i.wsId);
  return !p || p.draftId !== i.draftId ? `没有这份待发草稿(${i.draftId}):已经撤回 / 发过 / 过期 / 网页关了` : null;
};

/** 记录写不上不能吞(fail loud),但也不能因此把已经发生的事说成没发生 —— 打一行红字、结果照实返回 */
const logRecordError = (draftId: string, e: unknown): void => {
  console.error(`[x.post] ⚠️ 发推记录 ${draftId} 没写上(这次的结局只在执行记录里):${e instanceof Error ? e.message : String(e)}`);
};

const FORMS: readonly PostForm[] = ['single', 'thread', 'longPost', 'article', 'image'];

/** content / noteId 两种给法(prepare、fill 共用) */
function parseSource(o: O): PrepareIn {
  const noteId = typeof o.noteId === 'string' && o.noteId !== '' ? o.noteId : undefined;
  const layout = parseLayout(o.layout);
  if (o.content !== undefined) {
    if (!Array.isArray(o.content) || !o.content.every(isPmNode)) throw new Bad('content 要块数组(每个有 type)');
    return { content: o.content as PmNode[], noteId, layout };
  }
  if (noteId === undefined) throw new Bad('要 content(块数组)或 noteId');
  return { noteId, layout };
}

function parseLayout(v: unknown): ThreadLayout | undefined {
  if (v === undefined || v === null) return undefined;
  const l = v as { key?: unknown; posts?: unknown };
  if (typeof l.key !== 'string' || !Array.isArray(l.posts) || !l.posts.every((p) => Array.isArray(p) && p.every((i) => Number.isInteger(i)))) {
    throw new Bad('layout 要 { key: string, posts: number[][] }(x.post.prepare 返回的 threadEdit 里有 key 和 posts)');
  }
  return { key: l.key, posts: l.posts as number[][] };
}

async function planOf(i: PrepareIn): Promise<PostPlan> {
  if (i.content) return composePost(i.content, i.layout);
  /** 动态 import:X 的单测不必把 note 存储整套拖进来 */
  const { getNote } = await import('@platform/main/note/capability-impl');
  const { unwrapPmDoc } = await import('@platform/main/note/envelope');
  const note = await getNote(i.noteId as string);
  if (!note) throw capFailed(`note ${i.noteId} 不存在(或已删除)`);
  const doc = unwrapPmDoc(note.doc) as { content?: PmNode[] };
  return composePost(doc.content ?? [], i.layout);
}

/** 图的 media:// → 磁盘路径;解不出来(文件没了)就拒,不少发一张 */
async function mediaFiles(media: readonly PostMedia[]): Promise<{ srcs: string[]; files: string[] }> {
  const srcs = media.map((m) => (m.kind === 'render' ? '' : m.src));
  if (srcs.length === 0) return { srcs, files: [] };
  /** 动态 import:媒体库拖着 Electron,X 的单测不必拉进来 */
  const { resolveMediaPath } = await import('@platform/main/media/media-store-impl');
  const files = srcs.map((src) => {
    const f = resolveMediaPath(src);
    if (!f) throw capFailed(`图在本机图片库里找不到了(${src})—— 在 note 里重新放一下这张图再发`);
    return f;
  });
  return { srcs, files };
}

/** 超时没确认:走执行器的 cancel(caller timer)—— 和人点取消同一条路、同样留痕 */
function cancelOnTimeout(p: PendingPost): void {
  void execute('x.post.cancel', { wsId: p.wsId, draftId: p.draftId, why: 'timeout' }, { caller: 'timer' }).then((r) => {
    if (!r.ok) console.warn(`[x.post] 待发草稿 ${p.draftId} 超时撤回没成:${r.why}`);
  });
}

export function registerXPostCapabilities(): void {
  xCap<PrepareIn>('input', {
    id: 'x.post.prepare',
    describe: '把 note 的内容排成推文:算 X 加权字数,给出建议的发法(单条 / 推串 / 长推 / X 文章 / 转图)和每种发法排出来的样子;只排版,不碰 X 网页、不发',
    inputDoc: {
      content: '可选:块数组(PM JSON,界面给选区 / 整篇;给了就不读库)',
      noteId: '可选:note id —— 不给 content 时到库里读整篇',
      layout: '可选:推串手动分条 { key, posts }(在返回的 threadEdit 上改 posts:每条放哪几件;key 原样带回)',
    },
    parse: parseSource,
    subject: (i) => (i.noteId ? `note:${i.noteId}` : undefined),
    summarize: (out) => {
      const p = out as PostPlan;
      return {
        empty: p.empty, weight: p.weight, suggested: p.suggested, warnings: p.warnings.length,
        options: p.options.map((o) => `${o.form}:${o.available ? o.posts.length : 'x'}`).join(' '),
      };
    },
    run: planOf,
  });

  xCap<FillIn>('output', {
    id: 'x.post.fill',
    describe: '把 note 的内容按某种发法排好,填进 X 的发推弹窗(note 里存在本机的图一起放进去,最多 4 张)—— 不发;网页一直占着,等人在 X 上看过再确认(publish)或取消(cancel),10 分钟没确认自动撤回',
    inputDoc: {
      wsId: '哪个 workspace 的号',
      form: `发法:${FORMS.join(' / ')}(现在能填的:${FILLABLE.join(' / ')})`,
      content: '可选:块数组(PM JSON,界面给选区 / 整篇;给了就不读库)',
      noteId: '可选:note id —— 不给 content 时到库里读整篇;给了也会记在草稿上',
      layout: '可选:推串手动分条(同 x.post.prepare)',
    },
    parse: (o) => {
      if (!FORMS.includes(o.form as PostForm)) throw new Bad(`form 只认 ${FORMS.join(' / ')}`);
      return { ...parseSource(o), wsId: str(o, 'wsId'), form: o.form as PostForm };
    },
    account: true,
    preflight: (i) => {
      const notYet = formNotFillable(i.form);
      if (notYet) return notYet;
      const p = pendingPost(i.wsId);
      return p ? `X 上已经有一份待发草稿在等你确认(「${p.text.slice(0, 20)}」)—— 先确认或取消那份` : null;
    },
    page: () => '发推:待发草稿,等你在 X 上确认',
    keepPage: { ttlMs: DRAFT_LOCK_TTL_MS },
    subject: (i) => (i.noteId ? `note:${i.noteId}` : undefined),
    run: async (i, acc, page, caller) => {
      const plan = await planOf(i);
      if (plan.empty) throw capRefused('内容是空的,没有可发的');
      const opt = plan.options.find((o) => o.form === i.form);
      if (!opt) throw capRefused(`没有这种发法(${i.form})`);
      const why = fillBlock(opt);
      if (why) throw capRefused(why);
      const resolved: Array<{ srcs: string[]; files: string[] }> = [];
      for (const post of opt.posts) resolved.push(await mediaFiles(post.media));
      const fills: FillPost[] = opt.posts.map((post, k) => ({ text: post.text, files: resolved[k].files }));
      const posts: DraftPost[] = opt.posts.map((post, k) => ({ text: post.text, media: resolved[k].srcs }));
      const r = await fillCompose(page.wcId, fills);
      if (!r.ok) throw capFailed(r.why);
      const now = Date.now();
      const text = posts.map((x) => x.text).join('\n\n');
      const srcs = posts.flatMap((x) => x.media);
      const p: PendingPost = {
        draftId: newDraftId(now), wsId: i.wsId, wcId: page.wcId, token: page.token, noteId: i.noteId,
        form: i.form, posts, text, media: srcs, handle: acc.handle, filledAt: now, expiresAt: now + DRAFT_TTL_MS,
      };
      /** 「发过没」按整段字认(预览窗拿单条推那份整段查):推串每条末尾的 1/N 不算进去 */
      const whole = plan.options.find((o) => o.form === 'single')?.posts[0]?.text ?? text;
      try {
        await recordFilled({
          draftId: p.draftId, account: acc.restId, handle: acc.handle, wsId: i.wsId, noteId: i.noteId, form: i.form,
          text, hashText: whole, posts: posts.length, media: srcs, caller,
        });
      } catch (e) {
        /** 记不下来就不留这份草稿:发出去了却查不到「发过」比填不进去更糟 */
        const c = await clearCompose(page.wcId);
        throw capFailed(`发推记录写不上,没留这份草稿(${e instanceof Error ? e.message : String(e)})—— ${c.cleared ? '框已清掉' : `框没清掉:${c.detail}`}`);
      }
      addPending(p, cancelOnTimeout);
      const weight = opt.posts.reduce((n, x) => n + x.weight, 0);
      console.log(`[x.post] 已填进 X 发推框(@${acc.handle},${posts.length > 1 ? `推串 ${posts.length} 条、` : ''}${weight} 字${srcs.length > 0 ? `、${srcs.length} 张图` : ''})草稿 ${p.draftId},${DRAFT_TTL_MS / 60_000} 分钟内等确认`);
      return viewOf(p);
    },
  });

  xCap<CancelIn>('control', {
    id: 'x.post.cancel',
    describe: '撤回 X 上的待发草稿:清掉发推框里的字、关掉弹窗、放开网页(不发)',
    inputDoc: { wsId: '哪个 workspace 的号', draftId: '草稿 id(fill 返回的)', why: '可选:user / back-to-note / timeout' },
    parse: (o) => {
      const why = o.why ?? 'user';
      if (why !== 'user' && why !== 'back-to-note' && why !== 'timeout') throw new Bad('why 只认 user / back-to-note / timeout');
      return { wsId: str(o, 'wsId'), draftId: str(o, 'draftId'), why };
    },
    preflight: noDraft,
    page: () => '发推:撤回草稿',
    /** 带 fill 留下的锁进来;执行器不替它放,这里放 */
    reuse: (i) => pendingPost(i.wsId)?.token,
    run: async (i, _a, page) => {
      const p = pendingPost(i.wsId) as PendingPost;
      const c = await clearCompose(page.wcId);
      endPending(p, i.why, c.cleared);
      releasePage(page.token);
      await recordEnded(p.draftId, { status: 'cancelled', detail: `${i.why}:${c.detail}` }).catch((e) => logRecordError(p.draftId, e));
      console.log(`[x.post] 撤回草稿 ${p.draftId}(${i.why}):${c.detail}`);
      if (!c.cleared) throw capFailed(`框里的字没清掉:${c.detail} —— 请在左边 X 上手动删掉;网页已放开`);
      return { draftId: p.draftId, detail: c.detail };
    },
  });

  xCap<DraftIn>('output', {
    id: 'x.post.publish',
    describe: '发出去:人在 X 上看过待发草稿、点了确认 → 点 X 的「发布」(推串是「全部发布」)→ 逐条核对推文真的出现了(作者是我、正文对得上、图数够)。只点一次,核对不上不重发',
    inputDoc: { wsId: '哪个 workspace 的号', draftId: '草稿 id(fill 返回的)' },
    parse: (o) => ({ wsId: str(o, 'wsId'), draftId: str(o, 'draftId') }),
    preflight: noDraft,
    page: () => '发推:点发布并核对',
    /** 带 fill 留下的锁进来;发完这里放 */
    reuse: (i) => pendingPost(i.wsId)?.token,
    subject: (i) => `draft:${i.draftId}`,
    run: async (i, _a, page) => {
      const p = pendingPost(i.wsId) as PendingPost;
      const o = await publishCompose(page.wcId, p);
      endPublished(p, o);
      releasePage(page.token);
      await recordEnded(p.draftId, {
        status: o.outcome, detail: o.detail, tweetId: o.tweetId, tweetIds: o.tweetIds.length > 1 ? o.tweetIds : undefined,
        sentText: o.sentText, sentMedia: o.sentMedia, editedOnX: o.editedOnX,
      })
        .catch((e) => logRecordError(p.draftId, e));
      const url = o.tweetId ? `https://x.com/${p.handle}/status/${o.tweetId}` : undefined;
      console.log(`[x.post] 发布 ${p.draftId}(@${p.handle},${o.tweetIds.length > 1 ? `推串 ${o.tweetIds.length} 条、` : ''}${o.sentMedia} 张图):${o.outcome} —— ${o.detail}${url ? ` ${url}` : ''}${o.editedOnX ? '(在 X 上改过字)' : ''}`);
      if (o.outcome !== 'sent') throw capFailed(o.detail);
      return { draftId: p.draftId, tweetId: o.tweetId, tweetIds: o.tweetIds, url, handle: p.handle, editedOnX: o.editedOnX };
    },
  });

  xCap<{ wsId: string; text: string }>('input', {
    id: 'x.post.history',
    describe: '这段字以前用这个号发过没(按内容比,不看空白);发过的给时间、哪个号、推文 id —— 只提醒用,不拦',
    inputDoc: { wsId: '哪个 workspace 的号', text: '要发的正文' },
    parse: (o) => ({ wsId: str(o, 'wsId'), text: str(o, 'text') }),
    account: true,
    run: async (i, acc) => ({ posted: await findPosted(acc.restId, i.text) }),
  });

  xCap<{ noteId: string }>('input', {
    id: 'x.post.ofNote',
    describe: '这篇 note 点过几次发布、各自怎样(发出去 / 点了没核对上 / 没发出去)、哪个号、推文 id —— 撤回的不算',
    inputDoc: { noteId: 'note id' },
    parse: (o) => ({ noteId: str(o, 'noteId') }),
    subject: (i) => `note:${i.noteId}`,
    /** 每切一篇 note 就问一次,算状态查询:成功不打终端、记录留 7 天(同 pending) */
    probe: true,
    run: async (i) => ({ posts: await findNotePosts(i.noteId) }),
  });

  xCap<{ wsId: string; tweetId: string }>('control', {
    id: 'x.post.show',
    describe: '在这个 workspace 的 X 网页上打开某条推文(只看,不动它)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页', tweetId: '推文 id' },
    parse: (o) => {
      const tweetId = str(o, 'tweetId');
      if (!/^\d+$/.test(tweetId)) throw new Bad('tweetId 要数字');
      return { wsId: str(o, 'wsId'), tweetId };
    },
    page: (i) => `打开推文 ${i.tweetId}`,
    subject: (i) => `x_tweet:${i.tweetId}`,
    run: async (i, _a, page) => {
      const go = await webviewPorts(page.wcId).goto(X_PAGE_NAME.status, { tweetId: i.tweetId });
      if (!go.ok) throw capFailed(`没打开那条推文:${go.reason ?? '?'}`);
      return { tweetId: i.tweetId };
    },
  });

  xCap<{ wsId: string }>('input', {
    id: 'x.post.pending',
    describe: '这个号在 X 上有没有待发草稿(填进去了、等人确认的);没有的话,上一份是怎么结束的',
    inputDoc: { wsId: '哪个 workspace 的号' },
    parse: (o) => ({ wsId: str(o, 'wsId') }),
    probe: true,
    run: (i) => {
      const p = pendingPost(i.wsId);
      return { pending: p ? viewOf(p) : null, ended: lastEnded(i.wsId) };
    },
  });
}
