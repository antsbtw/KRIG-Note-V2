/**
 * ⭐⭐ X 发文能力(发推第①期,2026-10-27)—— 设计 docs/10-business-design/x/x-posting-design.md §2
 *
 * 用户 10-26:「发推是 x 模块的一个独立功能模块,note 调用接口就可以发推,要保持 AI 也同样能够调用这些功能。」
 * → note 右键、拖块、定时器、AI 都调这里的能力,入口自己不带发推代码。
 *
 * 本期只有 x.post.prepare(只排版,类别 input:不碰 X 网页、不对外)。fill / publish / cancel 在第②③期。
 */
import { capFailed } from '@platform/main/capability/capability';
import { Bad, xCap, type O } from './x-capabilities-common';
import { composePost, type PmNode, type PostPlan } from './x-post-compose';

const isPmNode = (v: unknown): v is PmNode => !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';

type PrepareIn = { readonly content?: readonly PmNode[]; readonly noteId?: string };

export function registerXPostCapabilities(): void {
  xCap<PrepareIn>('input', {
    id: 'x.post.prepare',
    describe: '把 note 的内容排成推文:算 X 加权字数,给出建议的发法(单条 / 推串 / 长推 / X 文章 / 转图)和每种发法排出来的样子;只排版,不碰 X 网页、不发',
    inputDoc: {
      content: '可选:块数组(PM JSON,界面给选区 / 整篇;给了就不读库)',
      noteId: '可选:note id —— 不给 content 时到库里读整篇',
    },
    parse: (o: O) => {
      const noteId = typeof o.noteId === 'string' && o.noteId !== '' ? o.noteId : undefined;
      if (o.content !== undefined) {
        if (!Array.isArray(o.content) || !o.content.every(isPmNode)) throw new Bad('content 要块数组(每个有 type)');
        return { content: o.content as PmNode[], noteId };
      }
      if (noteId === undefined) throw new Bad('要 content(块数组)或 noteId');
      return { noteId };
    },
    subject: (i) => (i.noteId ? `note:${i.noteId}` : undefined),
    summarize: (out) => {
      const p = out as PostPlan;
      return {
        empty: p.empty, weight: p.weight, suggested: p.suggested, warnings: p.warnings.length,
        options: p.options.map((o) => `${o.form}:${o.available ? o.posts.length : 'x'}`).join(' '),
      };
    },
    run: async (i) => {
      if (i.content) return composePost(i.content);
      /** 动态 import:X 的单测不必把 note 存储整套拖进来 */
      const { getNote } = await import('@platform/main/note/capability-impl');
      const { unwrapPmDoc } = await import('@platform/main/note/envelope');
      const note = await getNote(i.noteId as string);
      if (!note) throw capFailed(`note ${i.noteId} 不存在(或已删除)`);
      const doc = unwrapPmDoc(note.doc) as { content?: PmNode[] };
      return composePost(doc.content ?? []);
    },
  });
}
