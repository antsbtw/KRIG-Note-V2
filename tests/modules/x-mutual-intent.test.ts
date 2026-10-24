/**
 * ⭐⭐ 互关倾向 —— 算法层(1.2.30,蓝V互关 M2)
 * 用户 10-16:「对有蓝V有互关倾向的(比如写了蓝V互关/浇朋友等类似属于的Bio或者帖子),进行互动求关。」
 * 误判样本都来自真库(10-16 查)。
 */
import { describe, it, expect } from 'vitest';
import { capBlock, capOfOp } from './_x-ipc-wiring';
import {
  detectMutualIntent, planIntentRuleWrite, evidenceText, SEARCH_TERMS_ZH, SEARCH_TERMS_EN,
} from '@modules/x/x-mutual-intent';
import { USER_BUSINESS_FIELDS } from '@modules/x/x-user-repo';
import { BLUE_MUTUAL_RECIPES } from '../../scripts/x-seed-blue-mutual-recipes';

describe('detectMutualIntent', () => {
  it('⭐ 「#浇蓝朋友」算(10-17 真机漏判 @azurecloud000)', () => {
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text: '还差100多，大的小的老的少的男的女的都来\n\n#浇蓝朋友' }]).hit).toBe(true);
  });

  it('⭐ Bio 命中,依据是命中的那一句(不是整段 Bio)', () => {
    const h = detectMutualIntent('长期主义者 🌿｜终身学习者 📚\n互关交友，关注必回 🤝\n慢慢来', []);
    expect(h).toMatchObject({ hit: true, where: 'bio', phrase: '关注必回' });
    expect(h.hit && h.evidence).toBe('互关交友，关注必回 🤝');
  });

  it('⭐⭐ 推文里单独的「互关」也算(10-16 真机第一次搜漏判 5/10)—— 限制评论的说法除外', () => {
    for (const text of ['@DesertCamelX 互关互关😊', '@JohnnyL 互关的来喔，永不取关', '@ArkWallpaper 帮你互关涨粉', '@rainwaterJay 已互关，一起加油！']) {
      expect(detectMutualIntent(undefined, [{ tweetId: '1', text }]).hit, text).toBe(true);
    }
    expect(detectMutualIntent('蓝v回关', []).hit).toBe(true);
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text: '本条仅允许互关好友评论' }]).hit).toBe(false);
    /** 10-16 真库预演:新闻「相互关联」被拆出「互关」 */
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text: '该公司隶属于一个相互关联的中国黑客网络' }]).hit).toBe(false);
    expect(detectMutualIntent('研究经济互关系', []).hit).toBe(false);
    /** ⚠️ 但「相互关注」「FB/相互关爱」是求互关(真库都有)—— 不能因为前一字是「相」就不认 */
    expect(detectMutualIntent('欢迎相互关注', []).hit).toBe(true);
    expect(detectMutualIntent('FB/相互关爱', []).hit).toBe(true);
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text: '设置成互关好友才能评论了' }]).hit).toBe(false);
    /** 同一条里先有限制、后一句真求互关 → 认后一句 */
    const h = detectMutualIntent(undefined, [{ tweetId: '1', text: '仅允许互关好友评论。新号求关注，互关一下' }]);
    expect(h.hit && h.evidence).toBe('新号求关注，互关一下');
  });

  it('⭐ 「浇朋友」(用户原话里的说法,真库有)也算', () => {
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text: '新人报到，浇个朋友～' }])).toMatchObject({ hit: true, phrase: '浇个朋友' });
  });

  it('Bio 里单独写「互关」也算(真库 austzk 的 Bio 就是「互关」两个字)', () => {
    expect(detectMutualIntent('互关', [])).toMatchObject({ hit: true, phrase: '互关' });
  });

  it('⚠️ 真库误判样本都不命中:回关小黑屋 / 推文里的「仅允许互关好友评论」/ IFBB', () => {
    /** 「回关小黑屋」不含「互关」也不含任何词组 */
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text: '不给钱就不给入境，直接回关小黑屋' }]).hit).toBe(false);
    expect(detectMutualIntent(undefined, [{ tweetId: '2', text: '后续：“荆楚网”开启 “仅允许互关好友评论”。' }]).hit).toBe(false);
    expect(detectMutualIntent('IFBB pro bodybuilder', []).hit).toBe(false);
  });

  it('推文命中 → 带推文 id;英文按词边界、不分大小写', () => {
    const h = detectMutualIntent('just a guy', [{ tweetId: '9', text: 'New here! Follow back guaranteed 🙏' }]);
    expect(h).toMatchObject({ hit: true, where: 'tweet', tweetId: '9', phrase: 'follow back' });
    expect(evidenceText(h as never)).toBe('推文 9:Follow back guaranteed 🙏');
    expect(detectMutualIntent('#F4F always', []).hit).toBe(true);
  });

  it('Bio 优先于推文;都没有就是没有', () => {
    expect(detectMutualIntent('有关必回', [{ tweetId: '1', text: '互粉' }])).toMatchObject({ where: 'bio' });
    expect(detectMutualIntent('写代码的', [{ tweetId: '1', text: '今天天气不错' }]).hit).toBe(false);
  });

  it('⭐⭐ 配方的每个搜索词,判断都认得出(搜进来的人要能说出依据)', () => {
    expect(BLUE_MUTUAL_RECIPES[0].keywords).toEqual([...SEARCH_TERMS_ZH]);
    expect(BLUE_MUTUAL_RECIPES[1].keywords).toEqual([...SEARCH_TERMS_EN]);
    for (const t of [...SEARCH_TERMS_ZH, ...SEARCH_TERMS_EN]) {
      expect(detectMutualIntent(undefined, [{ tweetId: '1', text: `随便一句 ${t} 结尾` }]).hit, t).toBe(true);
    }
    expect(SEARCH_TERMS_ZH).not.toContain('回关');
  });

  it('⭐ 用户截图那条(@MathWithShan):「#蓝V互关 #真诚交友」', () => {
    const text = '今天来找几个“关注以后真能说上话”的朋友。\n做AI图片、视频、教育内容的蓝V,评论区碰个头。\n#蓝V互关 #真诚交友';
    expect(detectMutualIntent(undefined, [{ tweetId: '1', text }])).toMatchObject({ hit: true, phrase: '蓝V互关', evidence: '#蓝V互关 #真诚交友' });
  });
});

describe('⭐⭐ planIntentRuleWrite —— 人 > AI > 算法(用户 10-08)', () => {
  const hit = detectMutualIntent('互关必回', []);
  const miss = detectMutualIntent('写代码的', []);

  it('人或 AI 定过 → 算法不动(不管命中与否)', () => {
    for (const src of ['human', 'ai']) {
      expect(planIntentRuleWrite({ mutual_intent: false, mutual_intent_source: src }, hit)).toBe('skip-higher');
      expect(planIntentRuleWrite({ mutual_intent: true, mutual_intent_source: src }, miss)).toBe('skip-higher');
    }
  });

  it('命中:没标过 → 写;算法标过且依据一样 → 不写;依据变了 → 写', () => {
    expect(planIntentRuleWrite({}, hit)).toBe('set');
    const ev = evidenceText(hit as never);
    expect(planIntentRuleWrite({ mutual_intent: true, mutual_intent_source: 'rule', mutual_intent_evidence: ev }, hit)).toBe('same');
    expect(planIntentRuleWrite({ mutual_intent: true, mutual_intent_source: 'rule', mutual_intent_evidence: 'Bio:旧的' }, hit)).toBe('set');
  });

  it('没命中:算法以前标的 → 清掉(可重算);从没标过 → 什么都不做', () => {
    expect(planIntentRuleWrite({ mutual_intent: true, mutual_intent_source: 'rule' }, miss)).toBe('clear');
    expect(planIntentRuleWrite({}, miss)).toBe('none');
  });

  it('倾向字段是判断字段 —— 采集不许碰', () => {
    for (const f of ['mutual_intent', 'mutual_intent_source', 'mutual_intent_evidence', 'mutual_intent_at']) {
      expect(USER_BUSINESS_FIELDS).toContain(f);
    }
  });
});

describe('接线(M1 + M2)', () => {
  const read = (p: string): string => require('node:fs').readFileSync(require('node:path').join(process.cwd(), p), 'utf8');
  it('IPC 有 scan / set 两个 op,页面真的调;迁移 1.2.29 / 1.2.30 已登记', () => {
    const IPC = read('src/modules/x/x-data-ipc.ts');
    /** 2026-10-24 scanMutualIntent 迁到能力 x.intent.scan(x-capabilities-collect.ts) */
    expect(capOfOp(IPC, 'scanMutualIntent')).toBe('x.intent.scan');
    expect(capBlock('x.intent.scan')).toMatch(/const r = await scanMutualIntent\(\);/);
    /** 2026-10-24 setMutualIntent 迁到能力 x.person.setMutualIntent(x-capabilities-write.ts) */
    expect(capOfOp(IPC, 'setMutualIntent')).toBe('x.person.setMutualIntent');
    expect(capBlock('x.person.setMutualIntent')).toMatch(/await setMutualIntent\(i\.restId, i\.value\)/);
    const PAGE = read('src/modules/x/XOpsPeople.tsx');
    expect(PAGE).toMatch(/op: 'scanMutualIntent'/);
    expect(PAGE).toMatch(/op: 'setMutualIntent', restId: p\.rest_id, value/);
    expect(PAGE).toMatch(/intentOnly: e\.target\.checked/);
    const RUN = read('src/storage/migrations/x-runner.ts');
    expect(RUN).toMatch(/version: '1\.2\.29'[\s\S]{0,200}up: x_migration_1_2_29/);
    expect(RUN).toMatch(/version: '1\.2\.30'[\s\S]{0,200}up: x_migration_1_2_30/);
  });
  it('操作台有「只看蓝V作者」勾选框,且真的改 blueOnly', () => {
    expect(read('src/modules/x/XConsole.tsx')).toMatch(/checked=\{r\.blueOnly \?\? false\}\s*onChange=\{\(e\) => set\('blueOnly', e\.target\.checked\)\}/);
  });
});
