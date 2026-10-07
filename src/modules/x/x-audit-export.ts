/**
 * 把核对结果导成**人能一条条对**的文本 —— ⭐ X 的活,在 X 模块
 *
 * ── 用户 2026-10-02 ──
 * 「我觉得只用你看得懂的方式暂时,问题很大,**我不知道你采的数据是否完整**。
 * 　显示这些采集的内容包括元数据,**我来一条条对**吧。」
 *
 * ⚠️ 问题的本质:核对结果只活在面板上 —— 我读不到、你要截图,
 * 而 22 个字段 × N 条推文**没法靠截图对**。
 * ⭐ 落成文件,你我看**同一份**。
 *
 * ⚠️ 这是**给人读的**,不是给机器读的:
 * 字段用中文名、每条推文一块、缺什么直接标在那一行。
 */

import { summarizeAudits } from './x-timeline-audit';
import type { TimelineAudit, TweetAudit } from './x-timeline-audit';

/** 一条推文的全部字段 —— ⭐ 顺序按「先看什么」排,不按类型 */
function renderTweet(t: TweetAudit, idx: number): string {
  const L: string[] = [];
  const mark = (ok: boolean): string => (ok ? '✓' : '✗');
  /** ⚠️ `undefined` 与 `false` 必须分开显示 —— 「不知道」不是「没有」 */
  const tri = (v: boolean | undefined): string =>
    (v === undefined ? '—（载荷没带）' : v ? '是' : '否');

  L.push(`── 第 ${idx} 条 ───────────────────────────────`);
  L.push(`  推文id    ${t.id || '✗ 缺'}`);
  L.push(`  正文      ${mark(t.hasText)} ${t.textLen} 字`
    + (t.isLongText ? '（长推）' : '') + (t.isArticle ? '（长文）' : ''));
  if (t.incomplete === 'text-truncated') {
    L.push('            ⚠️⚠️ 正文被截断 —— 载荷只给了截断版，没拿到全文');
  }
  if (t.incomplete === 'article-no-body') {
    L.push('            ⚠️⚠️ 长文没正文 —— 列表页只给标题+摘要，正文在单篇页');
    /**
     * ⭐⭐ 连**去哪取**一起印 —— 2026-10-03 真机发现地址就在载荷里。
     * ⚠️ 取不到时明说,别留空:「没地址」与「没印」要分得开。
     */
    L.push(`            正文去处  ${t.articleUrl ?? '✗ 载荷没给地址 —— 这条补不了'}`);
  }
  /**
   * ⭐⭐ **判据凭什么** —— 不管报没报截断都印。
   *
   * 起因(2026-10-03):报告写着「正文被截断」而我**拿不出依据** ——
   * 原始载荷只在内存、跑完就没,只能回头猜判据,结果那条是误报。
   * ⭐ `feedback-maintainability-over-feature-completion`:成功路径也要留痕。
   */
  const ev = t.truncationEvidence;
  if (ev !== undefined) {
    L.push(`            截断判据  ${ev.verdict}`);
    /** ⚠️ 只在判据真用到时才印细项,免得每条推多三行噪音 */
    if (ev.displayTextRange !== undefined) {
      /**
       * ⚠️ 写 `full_text=` 而不是「正文=」—— 长推时这个数比上面那行的
       * 「正文 N 字」**小**(判据量的是 full_text,正文取的是 note 全文)。
       * 真机 2026-10-03 第 2 条:正文 767 字、这里 135,看着像自相矛盾。
       */
      L.push(`                      display_text_range=[${ev.displayTextRange[0]},${ev.displayTextRange[1]}]`
        + `　full_text=${ev.textUnits} 单元`);
    }
    if (ev.trailingUrlIsEntity !== undefined) {
      L.push(`                      末尾t.co在entities.urls里=${ev.trailingUrlIsEntity ? '是' : '否'}`
        + (ev.trailingExpandedUrl !== undefined ? `　→ ${ev.trailingExpandedUrl}` : ''));
    }
  }
  L.push(`  正文内容  ${t.preview || '（空）'}`);
  L.push('');
  L.push(`  作者      ${mark(t.hasAuthor)} @${t.handle || '?'}`);
  L.push(`  显示名    ${t.authorName ? `✓ ${t.authorName}` : '✗ 缺'}`);
  L.push(`  作者id    ${t.authorRestId ? `✓ ${t.authorRestId}` : '✗ 缺'}`);
  L.push(`  头像      ${mark(t.hasAvatar)}`);
  L.push(`  作者bio   ${t.authorBio ? `✓ ${t.authorBio.slice(0, 50)}` : '✗ 缺'}`);
  L.push(`  蓝V       ${tri(t.isBlueVerified)}`);
  L.push(`  我关注他  ${tri(t.iFollow)}`);
  L.push(`  他关注我  ${tri(t.followsMe)}`);
  L.push('');
  L.push(`  发布时间  ${mark(t.hasCreatedAt)}`);
  L.push(`  语言      ${t.lang ? `✓ ${t.lang}` : '✗ 缺'}`);
  L.push(`  会话id    ${mark(t.hasConversationId)}`);
  L.push(`  推文链接  ${mark(t.hasTweetUrl)}`);
  /** ⭐ 六项逐个列 —— 「缺互动数」太笼统,要知道缺哪一项 */
  const m = t.metrics;
  L.push(`  互动数    ${t.metricsCount}/6 项`
    + `　赞 ${m.likes ?? '✗'}　转 ${m.retweets ?? '✗'}　评 ${m.replies ?? '✗'}`
    + `　引用 ${m.quotes ?? '✗'}　收藏 ${m.bookmarks ?? '✗'}　浏览 ${m.views ?? '✗'}`);
  L.push(`  我的操作  赞 ${tri(t.self.favorited)}　转 ${tri(t.self.retweeted)}`
    + `　收藏 ${tri(t.self.bookmarked)}`);
  L.push('');
  L.push(`  媒体      ${t.hasMedia ? `✓ ${t.mediaTypes.join('/')}` : '无'}`);
  L.push(`  是回复    ${t.inReplyToStatusId ? `是 → ${t.inReplyToStatusId}` : '否'}`
    + (t.inReplyToScreenName ? `（@${t.inReplyToScreenName}）` : ''));
  L.push(`  引用推文  ${t.quotedStatusId || '无'}`);
  return L.join('\n');
}

/**
 * ⭐ 导出全文。
 *
 * @param audits 每页一个
 * @param meta   采集过程的事实(轮次/条数…)—— ⚠️ 要一起写进去:
 *               没有它的话,「只有 1 条推文」分不清是**采少了**还是**页面就这么多**。
 */
export function exportAuditText(
  audits: readonly TimelineAudit[],
  meta: {
    pages: number; totalResponses: number; rounds?: number; scrolledPx?: number;
    /**
     * ⭐⭐ **为什么停的** —— 2026-10-03 加。
     * 「滚动 60 轮」读起来一样,但**到上限停**和**滚到底停**
     * 是两件事:前者意味着页面还有,只是没让它接着滚。
     */
    reachedBottom?: boolean; stopReason?: string;
  },
): string {
  const out: string[] = [];
  out.push('═══════════════════════════════════════════════');
  out.push(`  X 采集核对报告   ${new Date().toLocaleString('zh-CN')}`);
  out.push('═══════════════════════════════════════════════');
  out.push('');
  out.push(`采集过程：收到 ${meta.totalResponses} 条响应，`
    + `其中 ${meta.pages} 条是时间线载荷`
    + (meta.rounds !== undefined ? `；滚动 ${meta.rounds} 轮 ${Math.round(meta.scrolledPx ?? 0)}px` : ''));
  if (meta.stopReason !== undefined) {
    out.push(`停止原因：${meta.stopReason}`
      + (meta.reachedBottom === false
        /**
         * ⚠️ 没到底就停 = **页面还有,只是没接着滚**。
         * 真机 2026-10-03:滚 60 轮(到上限)只拿到 2 页载荷,
         * 而 6138 条的账号显然不止 40 条 —— 这句话就是让它别再被忽略。
         */
        ? '　⚠️ **没滚到底** —— 还有内容没采到，加轮数再跑'
        : '　✓ 已到底'));
  }

  /**
   * ⭐⭐⭐ 去重**问 `summarizeAudits`**,不在这里再写一遍(2026-10-04 改)。
   *
   * ⚠️⚠️ 真机实测的后果:这里原先是**第三份**去重实现(「保留先出现的」)。
   * 我把 `summarizeAudits` 改成「留更全的那份」时**它没跟上** ——
   * 于是同一次采集,面板说「第 3 条 4072 字」,报告说「第 3 条 23 字、
   * 长文没正文」:**36 篇正文取回来了,报告里一篇都看不见**。
   *
   * ⭐ 又是「两处做同一件事必漂」(`x_tweet 加字段要登记四处` 同族)。
   * 修法是**换信息来源**,不是把第三份也改一遍 —— 再加一份还会漂。
   */
  const all = summarizeAudits(audits).items as TweetAudit[];
  out.push(`解析结果：${all.length} 条推文（已按 id 去重）`);

  /** ⭐ 翻页游标 —— 它回答「还能不能继续翻」 */
  const cursors = audits.filter((a) => a.hasCursor).length;
  out.push(`翻页游标：${cursors}/${audits.length} 页有`
    + (cursors < audits.length ? '　⚠️ 没有游标的那页翻不动下一页' : ''));
  out.push('');

  if (audits.some((a) => a.problems.length > 0)) {
    out.push('⚠️ 解析时的问题：');
    for (const p of new Set(audits.flatMap((a) => a.problems))) out.push(`   · ${p}`);
    out.push('');
  }

  /**
   * ⭐⭐ 长文缺口**一眼可见,且带去处** —— 2026-10-03。
   *
   * 真机 @KA594594:40 条里 **38 条是长文**,正文全在单篇页。
   * ⚠️ 旧版只在每条底下各标一句「长文没正文」,40 条里散着看不出规模。
   * ⭐ 这里报「几篇缺、其中几篇有地址」——「补不了的」要单独数出来,
   * 　 否则「有地址的补完了」会被当成「全补完了」。
   */
  const noBody = all.filter((t) => t.incomplete === 'article-no-body');
  if (noBody.length > 0) {
    const withUrl = noBody.filter((t) => t.articleUrl !== undefined);
    /**
     * ⚠️⚠️ **「缺」不等于「取失败」**(2026-10-04 真机写明)。
     *
     * 那一跑:面板报「取回长文正文 **38/38**」零失败,报告却说「缺 19 篇」。
     * 两个数都对 —— 因为补长文时,**单篇页载荷里还夹着别的长文**
     * (引用的、相关的),它们被一起收进账,但**从来没被请求过**。
     * ⭐ 所以这一行说的是「这份账里还有多少篇没正文」,
     * 不是「取失败了多少篇」。想知道取的结果看面板那一行。
     */
    out.push(`⭐ 长文正文缺 ${noBody.length} 篇 —— 其中 ${withUrl.length} 篇载荷给了地址（可逐篇去取）`
      + (withUrl.length < noBody.length
        ? `，${noBody.length - withUrl.length} 篇**没地址,补不了**`
        : ''));
    for (const t of withUrl) out.push(`   · ${t.articleUrl}`);
    out.push('');
  }

  for (let i = 0; i < all.length; i += 1) {
    out.push(renderTweet(all[i], i + 1));
    out.push('');
  }

  if (all.length === 0) {
    out.push('⚠️ 一条推文都没解出来 —— 展开面板里的原始载荷看看结构是不是变了。');
  }
  return out.join('\n');
}
