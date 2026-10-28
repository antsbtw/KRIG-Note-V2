/**
 * ⭐⭐ X 发文能力(发推第①期,2026-10-27)—— 设计 docs/10-business-design/x/x-posting-design.md §2
 *
 * 用户 10-26:「发推是 x 模块的一个独立功能模块,note 调用接口就可以发推,要保持 AI 也同样能够调用这些功能。」
 * → note 右键、拖块、定时器、AI 都调这里的能力,入口自己不带发推代码。
 *
 * 第①期 x.post.prepare(只排版,input:不碰 X 网页、不对外)。
 * 第②期 x.post.fill(填进 X 发推弹窗不发,占着网页等人确认)/ x.post.cancel(清框、放网页)/ x.post.pending(查待发草稿)。
 * 第③期 x.post.publish(人在 X 上看过点确认 → 点 X 的发布 → 去主页核对)/ x.post.history(这段字发过没)。
 * 每份草稿在 x_post 里一行(fill 建、cancel / publish 写结局)。
 */
import { capFailed, capRefused, execute } from '@platform/main/capability/capability';
import { Bad, str, xCap, type O } from './x-capabilities-common';
import { composePost, type PmNode, type PostForm, type PostPlan } from './x-post-compose';
import { releasePage } from './x-page-lock';
import {
  DRAFT_LOCK_TTL_MS, DRAFT_TTL_MS, addPending, clearCompose, endPending, endPublished, fillCompose, lastEnded, newDraftId, pendingPost,
  publishCompose, viewOf, type CancelWhy, type PendingPost,
} from './x-post-draft';
import { findPosted, recordEnded, recordFilled } from './x-post-repo';

const isPmNode = (v: unknown): v is PmNode => !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';

type PrepareIn = { readonly content?: readonly PmNode[]; readonly noteId?: string };
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
/** 第②期能填进 X 的发法;别的先如实拒 */
const FILLABLE: readonly PostForm[] = ['single'];
const LATER: Partial<Record<PostForm, string>> = { thread: '第⑤期', longPost: '第⑤期', article: '第⑥期', image: '第④期' };

/** content / noteId 两种给法(prepare、fill 共用) */
function parseSource(o: O): PrepareIn {
  const noteId = typeof o.noteId === 'string' && o.noteId !== '' ? o.noteId : undefined;
  if (o.content !== undefined) {
    if (!Array.isArray(o.content) || !o.content.every(isPmNode)) throw new Bad('content 要块数组(每个有 type)');
    return { content: o.content as PmNode[], noteId };
  }
  if (noteId === undefined) throw new Bad('要 content(块数组)或 noteId');
  return { noteId };
}

async function planOf(i: PrepareIn): Promise<PostPlan> {
  if (i.content) return composePost(i.content);
  /** 动态 import:X 的单测不必把 note 存储整套拖进来 */
  const { getNote } = await import('@platform/main/note/capability-impl');
  const { unwrapPmDoc } = await import('@platform/main/note/envelope');
  const note = await getNote(i.noteId as string);
  if (!note) throw capFailed(`note ${i.noteId} 不存在(或已删除)`);
  const doc = unwrapPmDoc(note.doc) as { content?: PmNode[] };
  return composePost(doc.content ?? []);
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
    describe: '把 note 的内容按某种发法排好,填进 X 的发推弹窗 —— 不发;网页一直占着,等人在 X 上看过再确认(publish)或取消(cancel),10 分钟没确认自动撤回',
    inputDoc: {
      wsId: '哪个 workspace 的号',
      form: `发法:${FORMS.join(' / ')}(本期只能 single)`,
      content: '可选:块数组(PM JSON,界面给选区 / 整篇;给了就不读库)',
      noteId: '可选:note id —— 不给 content 时到库里读整篇;给了也会记在草稿上',
    },
    parse: (o) => {
      if (!FORMS.includes(o.form as PostForm)) throw new Bad(`form 只认 ${FORMS.join(' / ')}`);
      return { ...parseSource(o), wsId: str(o, 'wsId'), form: o.form as PostForm };
    },
    account: true,
    preflight: (i) => {
      if (!FILLABLE.includes(i.form)) return `这种发法还不能填进 X(${LATER[i.form] ?? '以后'}做)—— 现在只能发单条推`;
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
      if (!opt?.available) throw capRefused(`这段内容不能这么发:${opt?.why ?? '没有这种发法'}`);
      const post = opt.posts[0];
      if (opt.posts.length !== 1) throw capRefused(`排出来是 ${opt.posts.length} 条,单条推只能 1 条`);
      if (post.media.length > 0) throw capRefused(`带了 ${post.media.length} 个图 / 视频 / 要转图的块 —— 带图第④期才能填进 X;先去掉再发`);
      if (post.text.trim() === '') throw capRefused('正文是空的');
      const r = await fillCompose(page.wcId, post.text);
      if (!r.ok) throw capFailed(r.why);
      const now = Date.now();
      const p: PendingPost = {
        draftId: newDraftId(now), wsId: i.wsId, wcId: page.wcId, token: page.token, noteId: i.noteId,
        form: i.form, text: post.text, handle: acc.handle, filledAt: now, expiresAt: now + DRAFT_TTL_MS,
      };
      try {
        await recordFilled({ draftId: p.draftId, account: acc.restId, handle: acc.handle, wsId: i.wsId, noteId: i.noteId, form: i.form, text: post.text, caller });
      } catch (e) {
        /** 记不下来就不留这份草稿:发出去了却查不到「发过」比填不进去更糟 */
        const c = await clearCompose(page.wcId);
        throw capFailed(`发推记录写不上,没留这份草稿(${e instanceof Error ? e.message : String(e)})—— ${c.cleared ? '框已清掉' : `框没清掉:${c.detail}`}`);
      }
      addPending(p, cancelOnTimeout);
      console.log(`[x.post] 已填进 X 发推框(@${acc.handle},${post.weight} 字)草稿 ${p.draftId},${DRAFT_TTL_MS / 60_000} 分钟内等确认`);
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
    describe: '发出去:人在 X 上看过待发草稿、点了确认 → 点 X 的「发布」→ 去我的主页核对推文真的出现了(作者是我、正文对得上)。只点一次,核对不上不重发',
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
      await recordEnded(p.draftId, { status: o.outcome, detail: o.detail, tweetId: o.tweetId, sentText: o.sentText, editedOnX: o.editedOnX })
        .catch((e) => logRecordError(p.draftId, e));
      const url = o.tweetId ? `https://x.com/${p.handle}/status/${o.tweetId}` : undefined;
      console.log(`[x.post] 发布 ${p.draftId}(@${p.handle}):${o.outcome} —— ${o.detail}${url ? ` ${url}` : ''}${o.editedOnX ? '(在 X 上改过字)' : ''}`);
      if (o.outcome !== 'sent') throw capFailed(o.detail);
      return { draftId: p.draftId, tweetId: o.tweetId, url, handle: p.handle, editedOnX: o.editedOnX };
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
