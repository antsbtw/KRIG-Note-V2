/**
 * 采集留痕 —— 把每一趟采集的**判断依据**落盘,而不是只渲染一次。
 *
 * ── 为什么有这个文件(用户 2026-09-22 拍板)──
 *
 * > **「要做一个健康的系统,不仅仅是完成功能,还有对功能的维护很重要。」**
 *
 * 起因很具体:面板上有一整屏判断依据 —— 接口名(`UserOriginalsTimeline`)、
 * 长文深度、解析率、停止原因、字段完整性 —— 但它们**只渲染一次,关掉就没了**,
 * 库里只存 `text`。于是要核对「方案 A 成不成立」时,只能反过来让用户截图。
 * 用户当场点破:**「面板的内容你不记录,如何做验证?」**
 *
 * ⭐⭐ 与可靠性纲领铁律③(**故障**要留痕)的区别 —— 这是新的一刀:
 * 那趟采集**完全成功**,依据照样蒸发。**成功路径的判断依据同样要留痕。**
 *
 * ⚠️ 判据一句话:**「下次要验证这个功能,能不能不靠人、只靠留下的东西说清楚?」**
 *
 * ── 只存元数据,不存正文 ──
 * 正文库里已经有了(`x_tweet.text`),这里重复搬只会让文件又大又敏感。
 * 这里存的是**回答「哪个接口给了多少、成没成」所需的最小事实**。
 */

import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/** 一趟采集的留痕。⚠️ 字段只增不改语义 —— 历史文件要一直可读。 */
export interface CollectJournalEntry {
  /** 落盘时刻(ISO) */
  at: string;
  /** 入口:语义页面名(如 `x.profile`),没有就是原始 URL */
  pageLabel?: string;
  /** 真实导航到的 URL */
  url: string;
  /** 参数里的 handle —— 「采的是谁」 */
  ownerHandle?: string;
  wsId?: string;
  /** 采到 / 入库 / 载荷数 */
  tweets: number;
  saved: number;
  payloads: number;
  people: number;
  /** 停止原因 —— 「为什么不采了」 */
  stopReason: string;
  rounds: number;
  elapsedMs: number;
  /** 解析率:X 给了多少条目、解出多少 */
  parseRate?: unknown;
  /**
   * ⭐⭐ 本趟的核心证据:**按接口聚合后**的请求清单。
   * 面板上曾同一个接口重复四行(每个载荷一行),有数据也读不出来。
   */
  ops: Array<{
    op: string;
    /** 该接口出现几次 */
    count: number;
    /** 累计字节 */
    bytes: number;
    /** 该接口给出的长文篇数(没有长文则省略) */
    articles?: number;
    /** 其中**真带正文**的篇数 —— 浅接口恒 0 */
    articlesWithBody?: number;
  }>;
  /** 字段覆盖率 */
  coverage?: unknown;
  problems: string[];
  notes: string[];
}

/**
 * ⭐ 把 `seenOps` 按 op 聚合。
 *
 * ⚠️ 这不只是「好看」:未聚合时同一接口刷四行,而**真正要比的是接口之间**
 * (`UserArticlesTweets` 浅 vs 时间线接口深)。不聚合就读不出差异。
 */
export function aggregateOps(
  seenOps: ReadonlyArray<{ op: string; bytes: number; articles?: number; articlesWithBody?: number }>,
): CollectJournalEntry['ops'] {
  const byOp = new Map<string, CollectJournalEntry['ops'][number]>();
  for (const s of seenOps) {
    const cur = byOp.get(s.op) ?? { op: s.op, count: 0, bytes: 0 };
    cur.count += 1;
    cur.bytes += s.bytes;
    if (s.articles != null) cur.articles = (cur.articles ?? 0) + s.articles;
    if (s.articlesWithBody != null) {
      cur.articlesWithBody = (cur.articlesWithBody ?? 0) + s.articlesWithBody;
    }
    byOp.set(s.op, cur);
  }
  // 字节多的在前 —— 带数据的接口排在杂项(ViewerBadgeCounts 0KB)前面
  return [...byOp.values()].sort((a, b) => b.bytes - a.bytes);
}

/** 留痕目录 */
export function journalDir(): string {
  return join(app.getPath('userData'), 'x-collect-journal');
}

/**
 * ⚠️ 留痕**不得影响采集** —— 写盘失败只 warn,绝不上抛。
 * (纲领铁律②:降级要局部。采集成功了就是成功了,不能因为记不下来而翻案。)
 */
export function writeJournal(entry: CollectJournalEntry): string | undefined {
  try {
    const dir = journalDir();
    mkdirSync(dir, { recursive: true });
    const name = `collect-${entry.at.replace(/[:.]/g, '-')}-${entry.pageLabel ?? 'page'}`
      .replace(/[^\w.-]/g, '_') + '.json';
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(entry, null, 2), 'utf-8');
    pruneJournal(dir);
    return path;
  } catch (err) {
    console.warn('[x-collect-journal] 留痕失败(不影响采集):', err);
    return undefined;
  }
}

/**
 * 只保留最近 200 份。
 * ⚠️ 留痕是为了**回溯**,不是为了攒垃圾;但也别删太狠 ——
 * 「上次那趟是哪个接口」经常要往回翻好几天。
 */
const KEEP = 200;
function pruneJournal(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('collect-') && f.endsWith('.json'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(KEEP)) unlinkSync(join(dir, f));
  } catch { /* 清理失败无所谓,不能影响采集 */ }
}
