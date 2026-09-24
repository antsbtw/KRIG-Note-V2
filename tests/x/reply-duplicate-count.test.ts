/**
 * ⚠️⚠️ 刷屏判定的**双重计数** —— 2026-09-24 编排实跑揪出来的。
 *
 * ── 现象 ──
 * 编排报「拟出 0 条,跳过 10 条(duplicate_text×10)」,
 * 而那 10 条**内容各不相同**(日语/中文/西语/马其顿语),全被判「模板刷屏」。
 *
 * ── 真因 ──
 * 调用方的 `fingerprintCounts` 从**全库语料**统计,而候选这批**本身就在语料里**。
 * 每条计数 = 1(语料里的自己) + 1(planReplies 再数的自己) = 2,
 * 正好撞 `DUPLICATE_FINGERPRINT_THRESHOLD = 2` ——
 * ⭐ **每一条都会中招,与内容无关**。
 *
 * ⚠️ 这个 bug 在「拟回复」这条线上是**致命**的:它让整条链路永远拟不出草稿,
 * 而报告只说「跳过 N 条」,不说为什么 —— 正是编排把原因报出来才暴露的。
 */
import { describe, it, expect, vi } from 'vitest';

/** ⚠️ planReplies 会查屏蔽名单(真库)—— 测试里不碰库,给个空名单 */
vi.mock('../../src/platform/main/db/x-author-repo', () => ({
  getBlockedHandleSet: vi.fn(async () => [] as string[]),
}));

/**
 * ⚠️ 也不碰模型 —— 本文件只验**前置过滤**(刷屏判定),模型答什么无关。
 * ⭐ 让它返回「模型说不值得回」:这样**通过了前置过滤**的条目
 * 会以 `ai_declined` 结束,与 `duplicate_text` 区分得开。
 */
vi.mock('../../src/platform/main/local-llm/ollama-client', () => ({
  callOllama: vi.fn(async () => ({
    content: JSON.stringify({ decisions: [] }),
  })),
}));
import { planReplies, textFingerprint, DUPLICATE_FINGERPRINT_THRESHOLD } from '../../src/platform/main/x/x-reply-planner';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cfg = { model: 'm', endpoint: 'e' } as never;
const rec = (id: string, text: string) =>
  ({ tweet_id: id, text, author_handle: `a${id}`, status: 'worth' } as never);

describe('⭐⭐ 语料里已有的计数不许再叠加', () => {
  it('⚠️⚠️ 候选本身在语料里(计数 1)→ 不该被判刷屏', async () => {
    const text = '谁有好用稳定的VPN提供一个';
    const r = await planReplies([rec('t1', text)], cfg, {
      /** ⭐ 语料里数到 1 次 —— 那 1 次**就是它自己** */
      fingerprintCounts: new Map([[textFingerprint(text), 1]]),
      /** ⚠️ planReplies 要求知道「我是谁」(否则 ref 会归错账号)——与本文件要验的无关,给一个 */
      selfHandle: 'me',
    });
    const reason = (r.skips[0] as { skipReason?: string } | undefined)?.skipReason;
    expect(reason, '自己把自己数成了刷屏 —— 每一条都会中招,整条链路永远拟不出草稿')
      .not.toBe('duplicate_text');
  });

  it('⭐ 真刷屏仍要拦住(语料里出现 2 次以上)', async () => {
    /** ⚠️ 修双重计数不能把真正的刷屏放过去 */
    const text = '加我微信看更多';
    const r = await planReplies([rec('t2', text)], cfg, {
      fingerprintCounts: new Map([[textFingerprint(text), 3]]),
      selfHandle: 'me',
    });
    expect((r.skips[0] as { skipReason?: string } | undefined)?.skipReason,
      '真刷屏没拦住 —— 修 bug 修过头了').toBe('duplicate_text');
  });

  it('⭐ 没传语料时,本批内部重复照样识别', async () => {
    /**
     * ⚠️ 本批内部比对**不能删** —— 调用方不传 fingerprintCounts 时,
     * 「同一批里一字不差出现两次」只能靠它识别。
     */
    const text = '一模一样的模板文案';
    const r = await planReplies([rec('t3', text), rec('t4', text)], cfg, { selfHandle: 'me' });
    const dup = r.skips.filter(
      (s) => (s as { skipReason?: string }).skipReason === 'duplicate_text');
    expect(dup.length, '本批内部的重复没识别出来').toBeGreaterThan(0);
  });

  it('⚠️ 阈值就是 2 —— 这条 bug 的放大器,改动前先想清楚', () => {
    /**
     * ⭐ 阈值 2 本身没错(「真人不会一字不差发两遍」),
     * 错的是**把自己数了两遍**。记在这里免得下次有人去调阈值掩盖问题。
     */
    expect(DUPLICATE_FINGERPRINT_THRESHOLD).toBe(2);
  });
});

describe('⚠️⚠️ 「模型没答」与「模型说不该回」必须分开', () => {
  /**
   * ── 2026-09-24 编排实跑暴露 ──
   * 报告只给 `ai_declined×10`,**分不出是哪种**:
   *  · 模型**没覆盖**这条 → **故障**(契约不对/漏答),**重跑可能就好**
   *  · 模型**说不该回**   → **判断**,重跑也一样
   * ⭐ 与上次 duplicate_text 同一形态:不说清原因,人还得再查一次。
   */
  it('⭐⭐ 模型没返回这条 → ai_no_answer(不是 ai_declined)', async () => {
    const r = await planReplies([rec('t9', '谁有稳定的梯子推荐一下')], cfg, {
      selfHandle: 'me',
    });
    const first = r.skips[0] as { skipReason?: string; detail?: string } | undefined;
    expect(first?.skipReason,
      '模型没答被混进了 ai_declined —— 故障与判断分不开,人还得再查一次')
      .toBe('ai_no_answer');
    expect(first?.detail, '没说可重跑').toMatch(/重跑/);
  });

  it('⭐ 两个原因都要有人话标签(UI 上不能显示裸 key)', () => {
    /** ⭐ Record<ReplySkipReason,string> 会让漏写的编译不过 —— 这里再钉一道 */
    const compose = readFileSync(
      join(process.cwd(), 'src/views/x-inbox/ReplyComposeDialog.tsx'), 'utf-8');
    expect(compose, 'ReplyComposeDialog 没给 ai_no_answer 标签').toMatch(/ai_no_answer:/);
    const drafts = readFileSync(
      join(process.cwd(), 'src/views/x-inbox/ReplyDraftsView.tsx'), 'utf-8');
    expect(drafts, 'ReplyDraftsView 没给 ai_no_answer 标签').toMatch(/ai_no_answer:/);
  });
});