/**
 * ⭐ 先放一放 —— 读写(2026-10-23)
 * 用户 10-23:「近期已经放一放的,就先不要列表在下面了吧,否则不是重复的勾选它?」
 * 放一放 = 这几天别再给我看,不是排除:过了 DEFER_DAYS 天自动回到名单(天数是我定的)。
 */
import { getXDB } from '@storage/surreal/client';

export const DEFER_DAYS = 3;

export async function recordDefer(account: string, person: string, mode: 'ask' | 'engage' | 'vpn', tweetId?: string): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    'CREATE x_defer SET account = $a, person = $p, mode = $m, tweet_id = $t, at = time::now()',
    { a: account, p: person, m: mode, t: tweetId },
  );
  if (!rows || rows.length !== 1) throw new Error('[x.defer] 放一放没记上');
}

/** 最近 DEFER_DAYS 天放一放过的人(数字 id) */
export async function readDeferred(account: string, mode: 'ask' | 'engage' | 'vpn', now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - DEFER_DAYS * 86_400_000).toISOString();
  const [rows] = await getXDB().query<[string[]]>(
    'SELECT VALUE person FROM x_defer WHERE account = $a AND mode = $m AND at >= type::datetime($since)',
    { a: account, m: mode, since },
  );
  return [...new Set(rows ?? [])];
}
