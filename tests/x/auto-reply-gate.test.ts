/**
 * ⭐⭐ **自动回复闸门** —— 用户 2026-09-26:
 *
 * > 「设置Gemma开关，当用户对目前这批配方及答复满意后，打开开关，
 * >   Gemma自动选定回复数据。」
 * > 「这个是针对某一个配方来自动回复，而不是任意所有的配方吧？」
 *
 * ⚠️⚠️ 本文件是**整条流水线上代价最不对称的一处**:
 * 少自动一条只是多点一次鼠标；自动发错一条是发到公开时间线上收不回来。
 * 所以判据一律**默认拒绝**，且每条都要能真的挡住。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ⚠️ 不碰真库:闸门只读配方，这里给它一个可控的假配方 */
const getRecipeById = vi.fn();
vi.mock('../../src/platform/main/db/search-recipe-repo', () => ({
  getRecipeById: (id: string) => getRecipeById(id),
}));

const { canAutoReply } = await import('../../src/platform/main/x/x-auto-reply-gate');

const LINK = 'https://otun.example/trial?ref=abc&lang=zh&v=6';
const base = { lang: 'zh' as const, text: `试试这个吧 ${LINK}`, link: LINK, recipeId: 'r1' };

/** 开着自动的配方 */
const ON = { id: 'r1', name: '中文求助', autoReply: true };

beforeEach(() => {
  getRecipeById.mockReset();
  getRecipeById.mockResolvedValue(ON);
});

describe('⭐⭐ 按配方，不是全局', () => {
  it('⭐⭐ 配方开着 → 放行', async () => {
    const r = await canAutoReply(base);
    expect(r.allowed, `开着却不放行：${r.detail}`).toBe(true);
  });

  it('⭐⭐ 同一条推，换个没开的配方 → 不放行', async () => {
    /**
     * ⭐ 这条是「按配方」的**核心证据**:
     * 输入完全相同，只换配方，结果必须相反。
     * 否则开关就是个摆设（现象:打开一个配方，全部都自动了）。
     */
    getRecipeById.mockResolvedValue({ id: 'r2', name: '英文泛词', autoReply: false });
    const r = await canAutoReply(base);
    expect(r.allowed, '配方没开却放行了 —— 开关是摆设').toBe(false);
    expect(r.reason).toBe('recipe_off');
    expect(r.detail, '没说清是哪个配方').toContain('英文泛词');
  });

  it('⭐⭐ 老配方没有这个字段 → **默认关**', async () => {
    /**
     * ⚠️ 判据必须是 `=== true` 不是 truthy:
     * 存量配方读出来 autoReply 是 undefined，
     * 用 truthy 判也会拒，但用 `!== false` 就会**全部放行** —— 那是灾难。
     */
    getRecipeById.mockResolvedValue({ id: 'r3', name: '老配方' });
    const r = await canAutoReply(base);
    expect(r.allowed, '字段缺失却放行 —— 存量配方会全部变成自动').toBe(false);
    expect(r.reason).toBe('recipe_off');
  });

  it('⚠️ 不知道来源配方 → 不放行', async () => {
    const r = await canAutoReply({ ...base, recipeId: undefined });
    expect(r.allowed, '没来源也自动 —— 无从判断是否在范围内').toBe(false);
    expect(r.reason).toBe('no_recipe');
  });

  it('⚠️ 配方查不到（被删了）→ 不放行，且说清楚', async () => {
    getRecipeById.mockResolvedValue(null);
    const r = await canAutoReply(base);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('recipe_missing');
  });

  it('⚠️ 查库抛错也不放行（默认拒绝）', async () => {
    getRecipeById.mockRejectedValue(new Error('db down'));
    const r = await canAutoReply(base);
    expect(r.allowed, '查库失败却放行 —— 库一抖就全自动了').toBe(false);
  });
});

describe('⭐⭐ 外语不自动（人读不懂＝确认这道闸失效）', () => {
  for (const lang of ['ru', 'fa', 'ja']) {
    it(`⚠️ ${lang} 不放行`, async () => {
      /**
       * ⚠️ 实测:Gemma 写俄语/波斯语会加「稳定运行」「最佳选择」等
       * 清单外承诺，而人读不懂那些字 ——「人工确认」形同虚设。
       * ⭐ 且落地页只有中英两版，外语回复会把人导向读不懂的英文页。
       */
      const r = await canAutoReply({ ...base, lang });
      expect(r.allowed, `${lang} 被放行了 —— 没人能确认它写了什么`).toBe(false);
      expect(r.reason).toBe('lang_not_allowed');
    });
  }

  it('⭐ 中英都放行', async () => {
    for (const lang of ['zh', 'en']) {
      const r = await canAutoReply({ ...base, lang });
      expect(r.allowed, `${lang} 该放行却没放`).toBe(true);
    }
  });
});

describe('⭐⭐ 自动路径更要校验，不是更宽松', () => {
  it('⭐⭐ 链接被改写 → 不放行', async () => {
    /** ⚠️ 人工路径还有人过一眼，自动路径没有 */
    const r = await canAutoReply({
      ...base,
      text: '试试这个 https://otun.example/trial?ref=CHANGED&lang=zh&v=6',
    });
    expect(r.allowed, 'ref 被改了却自动发 —— 那次点击永远归不了因').toBe(false);
    expect(r.reason).toBe('verify_failed');
  });

  it('⭐ 最高级承诺 → 不放行', async () => {
    const r = await canAutoReply({ ...base, text: `这是最好的选择 ${LINK}` });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('verify_failed');
  });

  it('⭐ 没带链接 → 不放行（白发一条）', async () => {
    const r = await canAutoReply({ ...base, text: '试试这个吧' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('verify_failed');
  });

  it('⚠️ 模型自己说不该回 → 不放行', async () => {
    const r = await canAutoReply({ ...base, worth: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not_worth');
  });
});

describe('⭐⭐ 红线:闸门绝不碰发布', () => {
  it('⭐⭐ 这个文件里不许出现任何发布/填入动作', () => {
    /**
     * ⚠️ 用户定的红线「绝不程序点发布」**不因为这个开关而松动**。
     * 自动只到「填进回复框」，发布仍然是人点。
     * ⭐ 闸门只回答「能不能」，连填都不该由它做。
     */
    const strip = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const src = strip(readFileSync(
      join(process.cwd(), 'src/platform/main/x/x-auto-reply-gate.ts'), 'utf-8'));
    for (const f of ['pasteReply', 'clickSendButton', 'publishTweet', 'replyTweet', 'markReplied']) {
      expect(
        new RegExp(`\\b${f}\\s*\\(`).test(src),
        `闸门里出现了 ${f} —— 它只该回答「能不能」，不该动手`,
      ).toBe(false);
    }
  });

  it('⭐ 不放行必须给原因（否则「为什么没自动」又要靠猜）', async () => {
    getRecipeById.mockResolvedValue({ id: 'r2', name: 'x', autoReply: false });
    const r = await canAutoReply(base);
    expect(r.reason, '拒了却不说为什么').toBeTruthy();
    expect(r.detail, '没有给人看的说明').toBeTruthy();
  });
});
