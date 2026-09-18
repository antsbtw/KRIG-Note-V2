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


describe('⭐⭐ 不许有「说谎的字段」', () => {
  /**
   * ── 用户 2026-09-18 问「bio 采集到了吗」──
   *
   * 答案曾是**没有**,而且是最坏的那种没有:
   *  · `HarvestedTweet` 里没有 bio 字段
   *  · 载荷解析器没解 `description`
   *  · 但 `authorsWithBio` **一直报 0**
   *
   * ⭐ 报 0 看着像「采到 0 个」,实际是「根本没采」——
   * 两者含义完全不同,而报告里长得一模一样。
   * 这与本仓常见的「类型有 JSON 有、渲染层零消费」的死字段同族,
   * 只是这次更坏:它**参与了对外报数**。
   */
  it('⭐⭐ authorsWithBio 必须真的被累加,不能恒为 0', () => {
    expect(code, 'authorsWithBio 声明了却从不累加 —— 报告里那个 0 是假的')
      .toMatch(/authorsWithBio\s*\+=/);
  });

  it('⭐⭐ bio 必须真的写进库', () => {
    const i = code.indexOf('saveAuthorCounts(');
    expect(i, '找不到 saveAuthorCounts 调用').toBeGreaterThan(0);
    const body = code.slice(i, code.indexOf('}', code.indexOf('{', i)));
    expect(body, 'saveAuthorCounts 没传 bio —— 采到了也没存').toMatch(/bio:/);
  });

  it('⭐ 报告里每个计数字段都有对应的累加', () => {
    // 声明在 AutoCollectReport 里的计数字段,必须都能在代码里找到累加/赋值
    for (const f of ['authorsWithRelation', 'authorsWithBio', 'saved']) {
      expect(
        code,
        `${f} 只声明不赋值 —— 会变成一个「说谎的数字」`,
      ).toMatch(new RegExp(`${f}\\s*(\\+=|=\\s*[^;]*\\+)`));
    }
  });
});


describe('⭐⭐ 采集层只报事实,不下判断', () => {
  /**
   * ── 用户 2026-09-18 定的边界 ──
   *
   * > 「我觉得我们应该忠实于页面能够获取的信息,分析数据是另外一个主题了。」
   *
   * ⚠️ 此前采集层混进了两条**判断**,其中一条判错了:
   *  · 「日期有 N 处空洞(**可能漏采**)」—— x.home 实测报出 684 天空洞,
   *    那不是漏采,是**首页算法混排**(会把两年前的热门推塞进来)。
   *    空洞检测建立在「时间连续」假设上,首页不满足 → 恒为噪音,还掩盖真问题。
   *  · 「达到轮次上限仍未滚到底 —— **结果不完整**」—— 「不完整」是判断,
   *    事实只是「滚了 30 轮、停在轮次上限」,而那本来就在 stopReason 里。
   *
   * ⭐ 删判断的同时**必须把事实交出去**,否则就成了丢数据 ——
   * 所以 dateSpan / rounds 要进报告,让分析层自己判断。
   */
  const harvester = strip(
    readFileSync(join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'),
  );

  it('⭐⭐ problems 里不许出现数据质量判断', () => {
    for (const judgement of ['可能漏采', '结果不完整']) {
      expect(
        harvester,
        `problems 里还有「${judgement}」—— 那是分析层的判断,不是采集层的事实`,
      ).not.toContain(judgement);
    }
  });

  it('⭐⭐ 但链路故障要留着(那是事实,不是判断)', () => {
    // 滚动没生效 / 零响应 / 零解析 —— 这三条是采集链路真的坏了
    for (const fact of ['滚动没生效', 'CDP 可能没挂上', '一条推文都没解析出来']) {
      expect(harvester, `链路故障「${fact}」被误删了 —— 那是真事实`).toContain(fact);
    }
  });

  it('⭐⭐ 删了判断就必须把事实交出去,否则是丢数据', () => {
    expect(code, 'dateSpan 没进报告 —— 判断删了、事实也没了,分析层无从判断')
      .toMatch(/dateSpan: r\.dateSpan/);
    expect(code, 'rounds 没进报告').toMatch(/rounds: r\.rounds/);
  });
});
