/**
 * ⭐⭐⭐ 逐页账 —— X 这一页给了什么 / 我们解出什么 / 库里有没有(2026-10-16)—— 纯函数,离线可测
 *
 * 用户 10-16:
 * 「你先搞清楚每一页的元数据,有问题就可以直接重采,比如A页是多少条,落库多少条,对不上问题在哪里,
 *  直接就可以敲定了,一页数据不完整,再往下翻页又有什么意义呢?」
 * 「为了采集,我们工作将近一个月的时间都在这里。应该找一个可靠的方法,把页面数据完成的采集下来。这是所有工作的基础呀!」
 *
 * ── 为什么逐条核对,不比总数 ──
 * 解析器会把一页里**所有**带正文的推文取出来(引用的、转发里层的原推也算),
 * 所以「解出 N 条」天然 ≥「X 列出的条目」。比总数会把丢的藏进多出来的里。
 * ⭐ 以 **X 列出的条目**为准,逐个 id 问:解出来没有?库里有没有?
 *
 * ── 元数据从哪来(不猜)──
 * X 的时间线载荷 = 若干 `instructions`;条目在 `TimelineAddEntries.entries` /
 * `TimelineReplaceEntry.entry` / `TimelinePinEntry.entry` / `TimelineAddToModule.moduleItems`。
 * 每个条目按内容归类;**不认识的照样计数、留下名字** —— 第一次真机跑完就知道每页实际由什么组成。
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type PageCensus = {
  /** X 列出的推文条目(可见的)—— 对账的基准 */
  readonly tweetIds: readonly string[];
  /** 推广(广告)推文 —— 单独数,不算漏 */
  readonly promotedIds: readonly string[];
  /** 不可见的推文(已删 / 受限 / 墓碑)—— X 列了但没内容,单独数 */
  readonly tombstones: number;
  /** X 列出的人(名单页)*/
  readonly userIds: readonly string[];
  readonly cursors: { readonly top?: string; readonly bottom?: string };
  /** 不认识的条目:类型 → 个数 */
  readonly other: Readonly<Record<string, number>>;
  /** 各种 instruction 的个数 —— 看这一页的结构 */
  readonly instructions: Readonly<Record<string, number>>;
};

/** TweetWithVisibilityResults 包了一层 */
function unwrapTweet(r: Record<string, unknown>): Record<string, unknown> {
  return str(r.__typename) === 'TweetWithVisibilityResults' && isObj(r.tweet) ? r.tweet : r;
}

function tweetIdOf(r: Record<string, unknown>): string {
  const t = unwrapTweet(r);
  const legacy = isObj(t.legacy) ? t.legacy : undefined;
  return str(t.rest_id) || str(legacy?.id_str);
}

/** entryId 去掉尾部数字/id,当类型名(who-to-follow-12345 → who-to-follow) */
function kindOf(entryId: string): string {
  return entryId.replace(/-\d[\w-]*$/, '').replace(/-[A-Za-z0-9_]{12,}$/, '') || '(无 entryId)';
}

export function censusPage(text: string): PageCensus | null {
  let root: unknown;
  try { root = JSON.parse(text); } catch { return null; }
  const tweetIds: string[] = [];
  const promotedIds: string[] = [];
  const userIds: string[] = [];
  let tombstones = 0;
  const cursors: { top?: string; bottom?: string } = {};
  const other: Record<string, number> = {};
  const instructions: Record<string, number> = {};

  const visitContent = (entryId: string, content: unknown): void => {
    if (!isObj(content)) { other[kindOf(entryId)] = (other[kindOf(entryId)] ?? 0) + 1; return; }
    const ct = str(content.cursorType).toLowerCase();
    if (ct !== '' || str(content.entryType) === 'TimelineTimelineCursor' || str(content.itemType) === 'TimelineTimelineCursor') {
      if (ct === 'top') cursors.top = str(content.value);
      else if (ct === 'bottom') cursors.bottom = str(content.value);
      return;
    }
    const ic = isObj(content.itemContent) ? content.itemContent : (isObj(content.content) ? content.content : undefined);
    if (ic && isObj(ic.tweet_results)) {
      const r = isObj(ic.tweet_results.result) ? ic.tweet_results.result : undefined;
      const id = r ? tweetIdOf(r) : '';
      const typename = r ? str(unwrapTweet(r).__typename) : '';
      if (!r || id === '' || /Tombstone|Unavailable/.test(typename)) { tombstones += 1; return; }
      if (entryId.includes('promoted') || isObj(ic.promotedMetadata)) promotedIds.push(id);
      else tweetIds.push(id);
      return;
    }
    if (ic && isObj(ic.user_results)) {
      const r = isObj(ic.user_results.result) ? ic.user_results.result : undefined;
      const id = r ? str(r.rest_id) : '';
      if (id !== '') userIds.push(id); else other['user(无id)'] = (other['user(无id)'] ?? 0) + 1;
      return;
    }
    /** 模块(对话串 / 推荐卡):里面一项一项再分 */
    if (Array.isArray(content.items)) {
      for (const it of content.items) {
        if (!isObj(it)) continue;
        visitContent(str(it.entryId) || entryId, it.item ?? it);
      }
      return;
    }
    other[kindOf(entryId)] = (other[kindOf(entryId)] ?? 0) + 1;
  };

  const visitEntry = (e: unknown): void => {
    if (!isObj(e)) return;
    visitContent(str(e.entryId), e.content ?? e.item);
  };

  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isObj(v)) return;
    if (Array.isArray(v.instructions)) {
      for (const ins of v.instructions) {
        if (!isObj(ins)) continue;
        const type = str(ins.type) || '(无 type)';
        instructions[type] = (instructions[type] ?? 0) + 1;
        if (Array.isArray(ins.entries)) for (const e of ins.entries) visitEntry(e);
        if (isObj(ins.entry)) visitEntry(ins.entry);
        if (Array.isArray(ins.moduleItems)) for (const e of ins.moduleItems) visitEntry(e);
      }
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(root);
  return { tweetIds: [...new Set(tweetIds)], promotedIds: [...new Set(promotedIds)], tombstones, userIds: [...new Set(userIds)], cursors, other, instructions };
}

/** 一页的账 */
export type PageLedgerRow = {
  /** 第几页(种子页记 0) */
  readonly page: number;
  readonly label: string;
  /** X 列出的推文 / 人 */
  readonly xTweets: number;
  readonly xUsers: number;
  readonly promoted: number;
  readonly tombstones: number;
  readonly other: Readonly<Record<string, number>>;
  /** X 列了、我们没解出来的(id)—— 解析层丢的 */
  readonly notParsed: readonly string[];
  /** 解出来了、库里查不到的(id)—— 落库层丢的;undefined = 这一页没做回读 */
  readonly notInDb?: readonly string[];
  /** 这一页推文时间方向反了(比上一页最新的还新的占多数)—— 翻页方向错 */
  readonly directionWrong: boolean;
  /** 发出去的游标简写 / 这一页给的下一页游标简写 */
  readonly cursor?: string;
  readonly nextCursor?: string;
  /** 这一页是重采过的 */
  readonly retried: boolean;
};

/** 这一页对不对得上 —— 不对的话说清楚是哪一层 */
export function pageProblem(r: PageLedgerRow): string | undefined {
  if (r.notParsed.length > 0) {
    return `第 ${r.page} 页:X 列了 ${r.xTweets + r.xUsers} 条,有 ${r.notParsed.length} 条没解出来(${r.notParsed.slice(0, 3).join(',')}…)—— 解析层`;
  }
  if (r.notInDb !== undefined && r.notInDb.length > 0) {
    return `第 ${r.page} 页:解出的里有 ${r.notInDb.length} 条库里查不到(${r.notInDb.slice(0, 3).join(',')}…)—— 落库层`;
  }
  if (r.directionWrong) {
    return `第 ${r.page} 页:推文比上一页还新 —— 翻页方向反了(拿错了游标)`;
  }
  return undefined;
}

/**
 * 翻页方向:这一页的推文(去掉置顶)多数比上一页最新那条还新 → 方向反了。
 * ⚠️ 只在两页都有时间时判;一页没时间就不判(不猜)。
 */
export function directionWrong(prevNewestMs: number | undefined, pageTimesMs: readonly number[]): boolean {
  if (prevNewestMs === undefined || pageTimesMs.length === 0) return false;
  const newer = pageTimesMs.filter((t) => t > prevNewestMs).length;
  return newer * 2 > pageTimesMs.length;
}

/** 报告用:一页一行 */
export function ledgerLine(r: PageLedgerRow): string {
  const x = r.xUsers > 0 ? `${r.xUsers} 人` : `${r.xTweets} 推`;
  const extra = [
    r.promoted > 0 ? `广告 ${r.promoted}` : '',
    r.tombstones > 0 ? `不可见 ${r.tombstones}` : '',
    ...Object.entries(r.other).map(([k, n]) => `${k}×${n}`),
  ].filter(Boolean).join(' ');
  const db = r.notInDb === undefined ? '—' : r.notInDb.length === 0 ? '✓' : `✗缺${r.notInDb.length}`;
  const ok = pageProblem(r) === undefined;
  return `${String(r.page).padStart(4)}  ${r.label.padEnd(4)}  X给 ${x.padEnd(6)}  解析 ${r.notParsed.length === 0 ? '✓' : `✗缺${r.notParsed.length}`}`
    + `  入库 ${db}  ${r.directionWrong ? '⚠️方向反' : ''}${r.retried ? ' (重采过)' : ''}  ${ok ? '✓' : '✗'}`
    + (extra ? `  [${extra}]` : '') + (r.cursor ? `  游标 ${r.cursor}` : '');
}
