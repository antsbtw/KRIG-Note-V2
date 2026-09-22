import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐ drain 空转必须**退避**,不能被 timer 无条件重启。
 *
 * ── 2026-09-21 的空转成环 ──
 * 刹车在 drain 里(连续 3 批没判成就停),油门在 scheduler 里
 * (backlogTimer 每 2 分钟无条件重启)—— 两边互不知道,于是
 * 「停 → 2 分钟后原样再来 → 再停」**永远循环**,日志刷屏、积压一条不动。
 *
 * ⚠️ 钉的是「两者之间有没有接线」:drain 收工要把 judged 告诉 scheduler,
 *    scheduler 零产出要退避。少任何一边都回到空转。
 */
describe('⭐ drain 零产出必须退避', () => {
  const schedPath = join(process.cwd(), 'src/platform/main/x/x-search-scheduler.ts');
  const judgePath = join(process.cwd(), 'src/platform/main/x/x-ai-judge.ts');
  const sched = strip(readFileSync(schedPath, 'utf-8'));
  const judge = strip(readFileSync(judgePath, 'utf-8'));

  /** 切到 drainBacklog 函数体再断言 —— 整文件 toMatch 会被别处同名 token 兜住。 */
  function drainBacklogBody(): string {
    const i = sched.indexOf('async function drainBacklog');
    expect(i).toBeGreaterThan(-1);
    const body = sched.slice(i, sched.indexOf('\n}', i));
    expect(body.length).toBeGreaterThan(0);
    return body;
  }

  it('drainBacklog 开头要有退避闸门(退避期内直接返回)', () => {
    const body = drainBacklogBody();
    expect(body).toMatch(/drainNextAllowedAt[\s\S]*Date\.now\(\)[\s\S]*return/);
  });

  it('startJudgeDrain 必须把「判成几条」回调出去', () => {
    const i = judge.indexOf('export function startJudgeDrain');
    expect(i).toBeGreaterThan(-1);
    const sig = judge.slice(i, judge.indexOf('{', judge.indexOf('): void', i)));
    expect(sig).toMatch(/onFinish\?:\s*\(judged: number\)\s*=>\s*void/);
  });

  it('⭐ onFinish 必须在 finally 里调 —— 出错停止也要退避', () => {
    const i = judge.indexOf('finally {', judge.indexOf('export function startJudgeDrain'));
    expect(i).toBeGreaterThan(-1);
    const fin = judge.slice(i, judge.indexOf('})();', i));
    expect(fin.length).toBeGreaterThan(0);
    expect(fin).toMatch(/onFinish\?\.\(total\)/);
  });

  it('scheduler 启动 drain 时必须把 noteDrainOutcome 传进去(不传=接线断了)', () => {
    expect(drainBacklogBody()).toMatch(/startJudgeDrain\([^)]*noteDrainOutcome/);
  });

  it('退避有上限,不会无限翻倍', () => {
    expect(sched).toMatch(/Math\.min\(drainBackoffMs \* 2, MAX_BACKOFF_MS\)/);
  });
});
