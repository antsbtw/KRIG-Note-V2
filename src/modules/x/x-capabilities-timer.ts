/**
 * ⭐⭐ 定时器调的两个能力(Module5-04 收尾,2026-10-26)
 *
 *   x.bg.segment     后台采集跑一段(x-bg-runner 每 2 分钟挑一个到期任务调它)
 *   x.person.follow  关注一个人(关注队列每拍调它;也可以人在界面点)
 *
 * 原来这两处定时器自己占锁、自己干 —— 执行记录里没有它们(判据 1 / 4 的缺口)。
 * 现在定时器只「到点调一下」;占网页、记一行、结果格式归执行器,和界面 / 收件箱 / AI 走同一道关。
 */
import { capFailed, capRefused } from '@platform/main/capability/capability';
import { digits, str, xCap, type O } from './x-capabilities-common';
import { readJob } from './x-bg-job-repo';
import { driveSegment } from './x-bg-runner';
import { followOn } from './x-person-act';
import { accountForWrite } from './x-account-repo';

const optStr = (o: O, k: string): string | undefined => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : undefined);

export function registerXTimerCapabilities(): void {
  xCap('input', {
    id: 'x.bg.segment', describe: '后台采集跑一段:接着这个任务的断点采几页、存库、存回断点(节奏按限流自调)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页', jobId: '后台任务 id', handle: '采的是谁(写在锁上给人看)' },
    parse: (o) => ({ wsId: str(o, 'wsId'), jobId: str(o, 'jobId'), handle: str(o, 'handle') }),
    page: (i) => `后台正在采 @${i.handle}(可在人卡暂停)`,
    run: async (i, _a, page) => {
      const job = await readJob(i.jobId);
      if (job === null) throw capRefused(`后台任务 ${i.jobId} 没了(被取消了?)`);
      if (job.status === 'paused' || job.status === 'done' || job.status === 'failed') throw capRefused(`后台任务 @${job.handle} 是「${job.status}」,不跑`);
      return { jobId: job.id, handle: job.handle, ...(await driveSegment(i.wsId, page.wcId, job)) };
    },
  });

  xCap('output', {
    id: 'x.person.follow', describe: '关注一个人:去他主页点关注 → 按钮变 Following 才算 → 写关系 → 记动作(本来就关注的不记)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页', restId: '他的数字 id', handle: '他的 handle', reason: '可选:为什么关注(进动作记录)' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId'), handle: str(o, 'handle'), reason: optStr(o, 'reason') }),
    page: (i) => `关注 @${i.handle}`,
    subject: (i) => `x_author:${i.restId}`,
    run: async (i, _a, page) => {
      const account = await accountForWrite(page.wcId);
      if (account.kind !== 'ok') throw capRefused(`认不出登录的号:${account.reason}`);
      const r = await followOn(i.wsId, page.wcId, account, { restId: i.restId, handle: i.handle }, i.reason);
      if (r.state === 'failed') throw capFailed(r.detail ?? '关注没成', r);
      return r;
    },
  });
}
