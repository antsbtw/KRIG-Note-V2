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
      L.push(`                      display_text_range=[${ev.displayTextRange[0]},${ev.displayTextRange[1]}]`
        + `　正文=${ev.textUnits} 单元`);
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
  meta: { pages: number; totalResponses: number; rounds?: number; scrolledPx?: number },
): string {
  const out: string[] = [];
  out.push('═══════════════════════════════════════════════');
  out.push(`  X 采集核对报告   ${new Date().toLocaleString('zh-CN')}`);
  out.push('═══════════════════════════════════════════════');
  out.push('');
  out.push(`采集过程：收到 ${meta.totalResponses} 条响应，`
    + `其中 ${meta.pages} 条是时间线载荷`
    + (meta.rounds !== undefined ? `；滚动 ${meta.rounds} 轮 ${Math.round(meta.scrolledPx ?? 0)}px` : ''));

  const all: TweetAudit[] = [];
  const seen = new Set<string>();
  for (const a of audits) {
    for (const t of a.items) {
      if (t.id && seen.has(t.id)) continue;
      if (t.id) seen.add(t.id);
      all.push(t);
    }
  }
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

  for (let i = 0; i < all.length; i += 1) {
    out.push(renderTweet(all[i], i + 1));
    out.push('');
  }

  if (all.length === 0) {
    out.push('⚠️ 一条推文都没解出来 —— 展开面板里的原始载荷看看结构是不是变了。');
  }
  return out.join('\n');
}
