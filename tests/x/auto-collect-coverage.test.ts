/**
 * ⭐⭐ 采集完整性:**字段级覆盖率** —— 源码守卫
 *
 * ── 用户 2026-09-18 ──
 *
 * > 「我关注的是采集数据的完整性,每一条数据都是完整的吗?可以展示给我检查吗?」
 *
 * ⚠️ 此前只报总数(「采到 77 条、入库 77 条」)—— 而 77 条里可能**条条缺字段**,
 * 数字照样好看。总数不等于完整。
 *
 * ⚠️ 覆盖率最容易出的错是**分母选错**,而且错了会给出一个「令人安心的错数」:
 *  · payloadOnly 字段拿全部推当分母 → DOM 兜底的推本来就没有,覆盖率无谓地低
 *  · conditional 字段也算覆盖率  → 不是回复本来就没 inReplyTo,会制造**假缺失**
 *
 * ⚠️ 合并逻辑埋在 autoCollect 里、依赖真 webContents,单测跑不了,
 * 所以这里钉的是**分母规则的源码形态**(分工见
 * feedback-source-scan-cant-see-execution:行为要行为测试,形态用源码扫)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = strip(readFileSync(SRC, 'utf-8'));

describe('⭐⭐ 覆盖率的分母不能选错', () => {
  it('前提自检:切到了覆盖率计算', () => {
    expect(code, '找不到 coverage 计算 —— 下面的断言会空转').toMatch(/const coverage =/);
  });

  it('⭐⭐ payloadOnly 字段的分母是**载荷来源那些**,不是全部', () => {
    /**
     * DOM 兜底的推本来就没有 conversationId/restId/关系 ——
     * 拿全部当分母会让覆盖率无谓地低,而低得没有信息量:
     * 人看见「40%」会以为采集坏了,其实是分母算错了。
     */
    expect(
      code,
      'payloadOnly 没有单独选分母 —— 覆盖率会被 DOM 兜底的推拉低,数字失去意义',
    ).toMatch(/kind === 'payloadOnly'[\s\S]{0,160}filter\([\s\S]{0,40}!t\.fromDom/);
  });

  it('⭐⭐ conditional 字段**不算**覆盖率(否则制造假缺失)', () => {
    /**
     * 不是回复本来就没有 inReplyTo、没图本来就没有 media ——
     * 把它们算进覆盖率,等于把「本来就不该有」报成「缺了」,
     * 那会让人去查一个根本不存在的问题。
     */
    expect(
      code,
      'conditional 也算了覆盖率 —— 会把「本来就没有」报成「缺失」',
    ).toMatch(/kind === 'conditional' \? 0/);
  });

  it('⭐⭐ 逐条明细里 conditional 不计入 missing', () => {
    expect(
      code,
      '逐条 missing 把 conditional 也算上了 —— 每条都会"缺"一堆本不该有的东西',
    ).toMatch(/if \(spec\.kind === 'conditional'\) return false/);
  });

  it('⭐⭐ DOM 兜底的推,payloadOnly 缺失不算它的错', () => {
    expect(
      code,
      'DOM 兜底的推被记成缺 payloadOnly 字段 —— 那是这一路本来就拿不到的',
    ).toMatch(/spec\.kind === 'payloadOnly' && t\.fromDom\) return false/);
  });
});

describe('⭐⭐ 0 和 false 算「有值」', () => {
  it('⭐⭐ has() 不能用 !v —— 0 赞/false 是事实,不是没采到', () => {
    const i = code.indexOf('function has(');
    expect(i, '找不到 has()').toBeGreaterThan(0);
    const body = code.slice(i, code.indexOf('\n}', i));
    expect(body.length, '切出来的 has() 是空的').toBeGreaterThan(60);

    expect(body, 'has() 退回了 !v —— 0 赞和 iFollow:false 会被当成「没采到」')
      .not.toMatch(/return\s+!!v;?\s*$/m);
    expect(body, '没有区分 undefined/null').toMatch(/undefined/);
    expect(body, '空串该算没值').toMatch(/trim\(\)/);
  });
});

describe('⭐ 明细要真能给人检查', () => {
  it('⭐ 逐条带回 tweetId / handle / 来源 / 缺了什么', () => {
    const i = code.indexOf('const sample =');
    expect(i, '找不到 sample 计算').toBeGreaterThan(0);
    const body = code.slice(i, code.indexOf('return {', i));
    for (const f of ['tweetId', 'handle', 'fromDom', 'missing']) {
      expect(body, `逐条明细缺 ${f} —— 人没法逐条核对`).toContain(f);
    }
  });

  it('⭐ 覆盖率是**全量**算的,不是只算样本那几条', () => {
    /**
     * sample 只带回前 40 条(IPC 不适合搬整批),
     * 但覆盖率必须按全量算 —— 否则「99%」可能只是前 40 条的 99%。
     */
    const i = code.indexOf('const coverage =');
    const body = code.slice(i, code.indexOf('const sample', i));
    expect(body, '覆盖率用了 slice —— 那只是样本的覆盖率,不是全量的')
      .not.toMatch(/\.slice\(/);
  });
});
