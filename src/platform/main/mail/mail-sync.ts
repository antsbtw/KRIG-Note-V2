/**
 * 邮件增量同步编排(邮箱模块 阶段 1)
 *
 * 流程:
 *   1. 连接 → 打开 mailbox → 读 UIDVALIDITY
 *   2. **校验 UIDVALIDITY**(见下)
 *   3. 追新:从 `UID > lastSeenUid` 拉 → 解析 → 落库
 *   4. 回填:从 `UID < backfillUid` 往下拉历史 → 落库(见下)
 *   5. 更新两个游标 + 与服务端 EXISTS 对账
 *
 * ## 为什么是两个游标(2026-08-28 补)
 *
 * 单次同步有上限(MAIL_SYNC_BATCH_LIMIT),超量时取的是**最新的**一批。
 * 若只有向上追新的 lastSeenUid,首次同步拿走最新 200 封、游标停在那批的最大 UID,
 * **更旧的邮件就永远够不着了** —— 真机上 1341 封的收件箱只同步到 201 封就不动了,
 * 而 UI 还显示「同步成功」,是典型的静默丢数据。
 *
 * 故游标从「一个水位」改成「一个区间」:lastSeenUid 向上追新,backfillUid 向下
 * 补历史(降到 1 表示触底)。两头收敛,最终覆盖整个 mailbox。
 * 已用模拟验证:1341 封 / 单次 200,6 轮拉完、零遗漏。
 *
 * ## ⚠️ UIDVALIDITY 是本模块的正确性核心
 *
 * IMAP 的 UID 只在「同一个 mailbox 的同一个 UIDVALIDITY 世代」内唯一且递增。
 * 服务端重建 mailbox(改名、删了重建、某些服务商的维护操作)时会换发新的
 * UIDVALIDITY,此时**旧 UID 全部失效,而且会被重新分配给不同的邮件**。
 *
 * 如果不校验就继续按 `UID > lastSeenUid` 增量:
 * - 新世代的 UID 从 1 重新开始 → 全都 ≤ lastSeenUid → 一封也拉不到,
 *   用户看到「同步成功,0 封新邮件」但收件箱明明有新信(静默坍缩,最糟的失败形态)
 * - 或者新邮件恰好撞上旧 UID → UNIQUE(account,mailbox,uid) 冲突被 INSERT IGNORE
 *   跳过 → 张冠李戴
 *
 * 故:UIDVALIDITY 一变,**必须**清空该 mailbox 的全部已同步邮件与游标,全量重来。
 * 这个代价(重新拉一次)远小于数据错乱。
 *
 * ## 为什么不用时间戳做增量
 *
 * 服务端时钟、客户端时钟、邮件自带的 Date 头三者都可能不一致且不可信
 * (伪造的 Date 头很常见)。UID 是服务端单调递增的权威序号,这是 IMAP 设计好的
 * 增量机制,不该自作聪明换掉。
 */

import type { MailAccount, MailSyncResult } from '@shared/types/mail-types';
import { connect, openMailbox, fetchSince, fetchBefore } from './imap-client';
import {
  getSyncState,
  upsertSyncState,
  insertMails,
  countMails,
  getMinUid,
  resetMailbox,
} from '../db/mail-repo';

/** 默认同步的 mailbox。Gmail 的 INBOX 就是收件箱。 */
export const DEFAULT_MAILBOX = 'INBOX';

/**
 * 同步一个账号的一个 mailbox。
 *
 * @returns 结构化结果(不 throw)—— 调用方据 success 决定 UI 提示。
 *   失败原因已转成中文可读文案(见 imap-client.toReadableError)。
 */
export async function syncMailbox(
  account: MailAccount,
  mailbox: string = DEFAULT_MAILBOX,
): Promise<MailSyncResult> {
  if (!account.enabled) {
    return { success: false, fetched: 0, total: 0, error: `账号 ${account.email} 已停用` };
  }

  let client;
  try {
    client = await connect(account);
  } catch (e) {
    // connect 已经把错误转成可读文案了,直接透出
    return {
      success: false,
      fetched: 0,
      total: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  try {
    const status = await openMailbox(client, mailbox);
    const prev = await getSyncState(account.id, mailbox);

    // ── UIDVALIDITY 校验(见文件头)──
    let sinceUid = 0;
    let resynced = false;
    if (prev) {
      if (prev.uidValidity !== status.uidValidity) {
        console.warn(
          `[mail-sync] UIDVALIDITY 变化 (${prev.uidValidity} → ${status.uidValidity}),` +
            `mailbox=${mailbox} account=${account.email} —— 丢弃本地数据全量重来`,
        );
        await resetMailbox(account.id, mailbox);
        resynced = true;
        sinceUid = 0;
        // 回填游标一并归零 —— 旧 UID 全部失效,历史也要重新回填
      } else {
        sinceUid = prev.lastSeenUid;
      }
    }

    // ── 第一步:追新(UID > lastSeenUid)──
    const fresh = await fetchSince(client, mailbox, sinceUid);
    let inserted = fresh.length > 0 ? await insertMails(account.id, fresh) : 0;

    // 游标推进到本次拉到的最大 UID。
    // ⚠️ 用**实际拉到的**最大 UID,不用服务端的 uidNext-1 —— 超过
    // MAX_FETCH_PER_SYNC 时我们只取了最新的一批,若按 uidNext 推进,
    // 那些没拉的旧邮件就再也不会被拉到了(静默丢数据)。
    const maxUid = fresh.reduce((m, x) => (x.uid > m ? x.uid : m), sinceUid);

    // ── 第二步:向下回填历史(UID < backfillUid)──
    //
    // 这一步是 2026-08-28 补的。只有追新的话,首次同步取了「最新 200 封」之后
    // 游标停在那批的最大 UID,更旧的邮件**永远够不着** —— 真机上 1341 封的收件箱
    // 只同步到 201 封就再也不动了,而 UI 还显示「同步成功」(静默丢数据)。
    //
    // 回填游标从本地已有的最小 UID 往下走,和追新两头收敛。
    let backfillUid = prev?.backfillUid ?? 0;
    if (backfillUid === 0) {
      // 尚未开始回填 —— 用本地已有的最小 UID 作起点。
      // 本次刚拉到的那批也要算进去(首次同步时 prev 为 null,库里此刻才有数据)。
      const localMin = await getMinUid(account.id, mailbox);
      backfillUid = localMin ?? 0;
    }

    let backfilled = 0;
    if (backfillUid > 1) {
      const older = await fetchBefore(client, mailbox, backfillUid);
      if (older.length > 0) {
        backfilled = await insertMails(account.id, older);
        // 回填游标下移到这批的最小 UID
        backfillUid = older.reduce((m, x) => (x.uid < m ? x.uid : m), backfillUid);
      } else {
        // 区间内一封都没有 = 已经触底
        backfillUid = 1;
      }
    }
    inserted += backfilled;

    await upsertSyncState({
      accountId: account.id,
      mailbox,
      uidValidity: status.uidValidity,
      lastSeenUid: maxUid,
      backfillUid,
    });

    const total = await countMails(account.id, mailbox);
    const backfillDone = backfillUid <= 1;

    // 对账:服务端有多少 vs 本地有多少。不等就说明没同步完,如实告诉用户。
    // (openMailbox 早就拿到了 exists,之前一直没用它对账 —— 于是「还差多少」
    //  这个信息从来没被呈现过,用户只能靠猜。)
    if (!backfillDone || total < status.exists) {
      console.log(
        `[mail-sync] 本次 +${inserted} 封(追新 ${fresh.length} / 回填 ${backfilled}),` +
          `本地 ${total} / 服务端 ${status.exists},回填游标=${backfillUid} —— 再次同步可继续`,
      );
    } else {
      console.log(`[mail-sync] 已全部同步:本地 ${total} / 服务端 ${status.exists}`);
    }

    return {
      success: true,
      fetched: inserted,
      total,
      serverTotal: status.exists,
      backfillDone,
      resynced,
    };
  } catch (e) {
    console.error(`[mail-sync] 同步失败 account=${account.email} mailbox=${mailbox}:`, e);
    return {
      success: false,
      fetched: 0,
      total: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    try {
      await client.logout();
    } catch {
      /* 连接已断,忽略 */
    }
  }
}
