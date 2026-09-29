/**
 * ⭐⭐ **采集要全面** —— 用户 2026-09-20 定的:
 * >「每个页面都能够正确、完整的提取数据」
 * 用户 2026-09-29 重申:「记得采集数据要全面，原来的文档有强调过的」。
 *
 * ── 为什么要有这一条(2026-09-29 的教训)──
 *
 * 我把采集迁到 web.net，**单测 1878 条全绿**照样提交，
 * 结果真机上载荷捕获整个失灵:
 *
 * | | 迁移前 | 迁移后 |
 * |---|---|---|
 * | payloads | 83 | **0** |
 * | 推文 | 894 | 38(DOM 兜底) |
 * | 人 | 784 | **0** |
 *
 * ⚠️ 推文还有 38 条是因为 **DOM 兜底**在兜 —— 于是「采到东西了」这个表象
 * 掩盖了「载荷一条没有」。而**人只在载荷里**，所以人归零才是真信号。
 *
 * ⭐ 教训:采集有两条腿(载荷 + DOM)，**一条断了另一条会替它站着** ——
 * 所以「采到了」不等于「采全了」，必须分开量。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const HARVESTER = strip(read('src/platform/main/x/x-timeline-harvester.ts'));
const AUTO = strip(read('src/platform/main/x/x-auto-collect.ts'));

describe('⭐⭐ 两条腿都要在:载荷 + DOM', () => {
  it('⭐⭐ 载荷捕获这条腿还在（它断了人就归零）', () => {
    /**
     * ⚠️ **人只在载荷里** —— DOM 兜底解得出推、解不出人。
     * 所以载荷断了的现象是「推文少了但还有、人变 0」，
     * 而「还有推文」会让人以为采集是好的。
     */
    expect(HARVESTER, '载荷捕获没了 —— 人会归零，而推文靠 DOM 兜底看着还在')
      .toMatch(/Network\.(loadingFinished|enable)|captureXPayloads\(/);
    expect(HARVESTER, '没有解析人的调用').toMatch(/extractPeopleFrom\(/);
  });

  it('⭐⭐ DOM 兜底这条腿也要在', () => {
    /** ⚠️ 两条腿是**互补**不是二选一(用户原话:「我们需要的是并集哦」) */
    expect(HARVESTER, 'DOM 扫描没了').toMatch(/TWEET_SCRAPE_FN_BODY|mergeDomTweets/);
  });

  it('⭐⭐ 载荷数要报出来（0 个载荷必须看得见）', () => {
    /**
     * ⭐ 这是本次事故里**唯一能一眼看出问题**的数字:
     * payloads 83 → 0。而推文数 894 → 38 会被解释成「这次搜的少」。
     */
    expect(HARVESTER, 'payloads 没进报告').toMatch(/payloads/);
    expect(AUTO, 'payloads 没往上报 —— 面板和留痕都看不到').toMatch(/payloads: r\.payloads/);
  });
});

describe('⭐⭐ 采集的完整性判据（用户 2026-09-20 定）', () => {
  it('⭐ 解析率要算（X 给了多少 vs 解出多少）', () => {
    /**
     * ⚠️ 有四个页面**没有外部分母**(search/home/notifications/articles)——
     * 对它们「完整」只能问:**X 给的我都接住了吗**。
     * 分母来自载荷本身，所以载荷一断这个判据也跟着失效 ——
     * 本次事故里 entries 就是 0。
     */
    expect(HARVESTER, '没算解析率').toMatch(/countTimelineEntries\(/);
    expect(HARVESTER, '解析率没进报告').toMatch(/parseRate/);
  });

  it('⭐⭐ 人和推**分开报**（合并报会掩盖一边归零）', () => {
    /**
     * ⚠️ 本次事故的核心:推 38 / 人 0。
     * 如果只报一个「采到 38 条」，人归零就完全看不出来。
     */
    expect(HARVESTER, '人没单独报').toMatch(/people: \[\.\.\.people\.values\(\)\]/);
    expect(AUTO, '人没往上报').toMatch(/people: r\.people\.length/);
  });

  it('⭐ 字段覆盖率要量（不量的字段永远 100%）', () => {
    /** ⚠️ 本仓踩过:coverage 不量 tweet_url/avatar，于是它们恒报 100% */
    expect(AUTO, '没有字段覆盖率').toMatch(/coverage/);
  });
});

/**
 * ⚠️⚠️ **本文件挡不住 2026-09-29 那次回归 —— 已实测证实**。
 *
 * 我写完上面这些守卫后，把**真正弄坏的那个版本**放回去重跑:
 * **7 条全绿**。因为坏版本里所有 token 都在 ——
 * `captureXPayloads` / `extractPeopleFrom` / DOM 扫描 / 解析率，一个不缺，
 * 代码「长得完全正确」，**只是运行时收不到载荷**。
 *
 * ⭐ 所以上面那些只是**结构守卫**:防「有人把某条腿整个删掉」，
 * 防不住「机制换了但收不到数据」。后者属于
 * `feedback-source-scan-cant-see-execution` 那一类 ——
 * 源码扫描看不见「会不会真的收到东西」。
 *
 * ⚠️ **别把它们当成采集的安全网**。采集是否真的全面，
 * 唯一判据在真机留痕里:
 *  · `payloads` 不为 0(本次事故 83 → **0**)
 *  · `people` 不为 0(本次 784 → **0**，而推文靠 DOM 兜底还有 38 条)
 *  · `parseRate.entries` 不为 0
 *
 * ⭐ 判据写在这里是为了下次改采集时**知道该看哪三个数** ——
 * 不是为了让这个文件变绿。
 */
describe('⚠️ 迁移这类改动的前置条件', () => {
  it('⭐⭐ 载荷捕获的机制不许在没有真机验证时被换掉', () => {
    /**
     * ⚠️⚠️ 2026-09-29 的教训:我把 `debugger.attach` 换成 `captureXPayloads`，
     * **单测 1878 条全绿**照样提交，真机上 payloads 直接归零。
     *
     * ⭐ 单测**证明不了 CDP 通道行为** —— 它是进程外的、要真页面才跑得起来。
     * 所以这类改动的判据只有一个:**真机跑一趟，看 payloads 不为 0**。
     *
     * 这条守卫钉不住「有没有真机验证」(那是流程不是代码)，
     * 但钉得住**别把两条腿同时换掉**:
     * 载荷这条腿换实现时，DOM 那条腿必须原样留着当对照。
     */
    const hasPayloadPath = /Network\.loadingFinished|captureXPayloads\(/.test(HARVESTER);
    const hasDomPath = /TWEET_SCRAPE_FN_BODY|mergeDomTweets/.test(HARVESTER);
    expect(
      hasPayloadPath && hasDomPath,
      '两条腿不能同时缺 —— 一条断了另一条要能顶着，且对比得出来',
    ).toBe(true);
    /**
     * ⚠️ 这一条**只能证明两条腿都写着**，证明不了载荷真收得到 ——
     * 实测:弄坏的那个版本在这里照样绿(见本 describe 上面的说明)。
     */
  });
});
