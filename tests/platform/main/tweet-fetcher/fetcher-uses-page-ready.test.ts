/**
 * ⭐ tweet-fetcher 的「等元素出现」必须走底座,不许手写轮询(L2 收口第 1 批)
 *
 * ── 为什么钉这个 ──
 *
 * 本文件头注释里躺着一条前人写下却没还的债:
 *   「Phase D browser-capability 正式化后,本能力被吸收为 DOM scraping 子能力」
 * 2026-09-30 还了其中一半:手写的 20 × 500ms 轮询换成 `controlEngine.ready`。
 *
 * ⭐ 收益不只是少几行 —— `ready` 多做了一件手写版**没做**的事:
 * 页面正在导航时 `executeJavaScript` 必抛,手写版把这一轮当"没渲染好"白等,
 * `ready` 记下异常继续等、超时时如实带出来。于是「网络慢」与「脚本坏了」
 * 不再混成同一句 'did not render in time'。
 *
 * ⚠️ 本文件是**源码结构守卫**,不是行为测试 —— 真跑一次要开 BrowserWindow 连真网。
 * 所以它只能证明「接线在」,证明不了「真的能抓到推文」。
 * 后者按 project-x-collect-two-legs 的教训,**只有真机能验**。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(process.cwd(), 'src/platform/main/tweet-fetcher/fetcher.ts');
const raw = readFileSync(FILE, 'utf-8');

/** ⚠️ 剥注释 —— 本文件注释里大量提到 setTimeout / 轮询(在讲被换掉的旧实现) */
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('⭐ tweet-fetcher 走底座的 ready,不手写轮询', () => {
  it('前提自检:确实读到了源码', () => {
    expect(raw.length, '文件空了 —— 守卫在空转').toBeGreaterThan(500);
    expect(code, '剥注释把代码也吃了').toContain('fetchTweetData');
  });

  it('⭐⭐ 零手写轮询 —— 没有 setTimeout / 计数循环', () => {
    expect(code, 'setTimeout 又回来了 —— 等元素应当交给 controlEngine.ready')
      .not.toMatch(/setTimeout/);
    expect(code, '计数轮询又回来了')
      .not.toMatch(/for\s*\(\s*let\s+i\s*=\s*0/);
  });

  it('⭐ 真的调了 controlEngine.ready,且用语义锚点不用裸 selector', () => {
    expect(code, '没调 ready —— 接线没接上').toMatch(/controlEngine\.ready\s*\(/);
    expect(code, '没用 anchorAppears 判据').toMatch(/kind:\s*'anchorAppears'/);
    // ⚠️ selector 只许出现在锚点表里,不许散在调用处
    const calls = code.slice(code.indexOf('export async function fetchTweetData'));
    expect(calls, '调用处出现了裸 selector —— 站点知识应当收在锚点表')
      .not.toMatch(/data-testid/);
  });

  it('⭐ selector 收在锚点表里,并推给底座(不是让底座 import 本模块)', () => {
    expect(code, '没注册锚点表').toMatch(/registerAnchorTable\s*\(\s*'tweet-fetcher'/);
    expect(code, '锚点表里没有那条 selector').toMatch(/article\[data-testid="tweet"\]/);
  });

  it('⭐⭐ register 与 bindPageHost 必须成对 —— 漏一个就「调不动且不报错」', () => {
    /**
     * ⚠️ page-hosts.ts 的告诫:只登记不绑定的话,引擎拿不到 wc,
     * 会回一个诚实但误导的 Failed「没有对应的渲染目标(已关闭?)」——
     * 看起来像页面关了,实际是没接线。
     */
    expect(code, '没登记页面').toMatch(/pageRegistry\.register\s*\(/);
    expect(code, '登记了页面但没绑 wc —— 引擎会说「页面已关闭」而其实是没接线')
      .toMatch(/bindPageHost\s*\(/);
  });

  it('⭐ 三态 Result 要分别处理 —— degraded 不许当失败', () => {
    /**
     * ⚠️ `goto` 返 degraded 表示「导航到了但有缺失」(如站点自己接管了导航,
     * X 的 ERR_ABORTED 是常态不是故障)。此时推文**仍可能渲染**,
     * 应当交给 `ready` 用事实判定,而不是在这里替它判死。
     * 写成 `status !== 'ok'` 就会把这种正常情况误杀。
     */
    expect(code, "用了 status !== 'ok' —— 会把 degraded(站点接管导航)误当失败")
      .not.toMatch(/landed\.status\s*!==\s*'ok'/);
    expect(code, '没有显式处理 failed').toMatch(/landed\.status\s*===\s*'failed'/);
  });

  it('站点知识(DOM 提取)仍留在本模块 —— 它不归底座', () => {
    expect(code, 'EXTRACT_TWEET_JS 不见了 —— 提取是 adapter 的活,不该搬进底座')
      .toMatch(/EXTRACT_TWEET_JS/);
  });
});
