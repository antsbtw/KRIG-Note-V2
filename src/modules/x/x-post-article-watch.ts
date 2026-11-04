/**
 * ⭐ X 文章待发期间盯着 X 网页(用户 11-02:「如果是 web 页面的确认发布是没有办法获取 caption 的吗?」→ 同意做)
 *
 * 人可能不点 KRIG 条上的「确认发布」,而是直接点 X 网页上的 Publish:
 *   - X 的发布弹窗一开、导语框是空的 → 填上 note 里的导语(人改过 / 删了就不再动)
 *   - 离开了这份文章的编辑页、到了推文 / 文章页 → 人在 X 上发出去了 → 交给 onPublished 走发布核对、结束这份草稿
 * KRIG 自己点发布 / 撤回之前先 stop,免得两边同时结束同一份草稿。
 */
import { webviewPorts } from './x-collect-ports';
import { X_ARTICLE_SCRIPT } from './x-article-scripts';
import { pendingPost, type PendingPost } from './x-post-draft';

const TICK_MS = 1500;
const watching = new Map<string, ReturnType<typeof setInterval>>();

type Seen = { state?: string; url?: string; dialog?: boolean; filled?: boolean; kept?: boolean } | null;

/** 发出去之后 X 落到的页(10-30 真机:/<handle>/status/<id>) */
export const publishedUrl = (url: string): boolean => /\/(status|article)\/\d+/.test(url);

export function watchArticle(p: PendingPost, onPublished: (p: PendingPost, url: string) => void): void {
  stopArticleWatch(p.draftId);
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    if (pendingPost(p.wsId)?.draftId !== p.draftId) { stopArticleWatch(p.draftId); return; }
    busy = true;
    void (webviewPorts(p.wcId).runScript(X_ARTICLE_SCRIPT, { op: 'watch', editId: p.articleId, caption: p.caption ?? '' }) as Promise<Seen>)
      .then((r) => {
        if (!watching.has(p.draftId)) return;
        if (r?.filled) console.log(`[x.post] X 文章 ${p.articleId}:X 的发布弹窗开了,导语已填上`);
        else if (r?.kept) console.log(`[x.post] X 文章 ${p.articleId}:X 的发布弹窗开了,导语框里已有字,没动`);
        if (r?.state === 'left' && r.url && publishedUrl(r.url)) {
          stopArticleWatch(p.draftId);
          console.log(`[x.post] X 文章 ${p.articleId}:在 X 网页上点的发布,到了 ${r.url}`);
          onPublished(p, r.url);
        }
      })
      .catch((e) => console.warn(`[x.post] 盯 X 文章 ${p.articleId} 没看成:${e instanceof Error ? e.message : String(e)}`))
      .finally(() => { busy = false; });
  }, TICK_MS);
  t.unref?.();
  watching.set(p.draftId, t);
}

export function stopArticleWatch(draftId: string): void {
  const t = watching.get(draftId);
  if (t) clearInterval(t);
  watching.delete(draftId);
}
