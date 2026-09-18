/**
 * ⭐⭐ 采集监视器:**逐字段并集** —— 源码守卫,钉住合并逻辑不退化
 *
 * ── 用户 2026-09-18 纠正 ──
 *
 * > 「我们需要的是并集哦」
 *
 * 此前是 `if (!captured.has(id))` —— 载荷抓到过这条,DOM 那份**整个不看**。
 * 后果:载荷里没有的 `authorName` / `authorAvatar` / `media` / `tweetUrl`
 * 跟着一起丢,而那几项**只有 DOM 拿得到**。
 *
 * ⚠️ 更要命的是它的来历:那是 AI 自己的实现取舍(「载荷优先、DOM 兜底」),
 * 却以既定方针的口吻写进注释,后来读的人当成用户定的了。
 * 用户 2026-09-02 的原话是「**都能保证抓取这些内容**」,没说过谁优先谁兜底。
 *
 * ⚠️ 本文件是**源码守卫**,不是行为测试:合并逻辑埋在 setInterval 回调里,
 * 没导出、拿不到。所以钉的是「源码里有没有退回二选一」这种**结构性**的事
 * (分工见 feedback-source-scan-cant-see-execution:
 *  「有没有真的调」才必须行为测试,这里钉的是形态)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src/platform/main/x/x-capture-monitor.ts');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const code = strip(readFileSync(SRC, 'utf-8'));

/**
 * 切到 DOM 扫描的**整个循环体** —— 合并逻辑在这里。
 *
 * ⚠️ 初版从 `const prev = captured.get(` 切起,**切晚了**:
 * 注入 `if (captured.has(id)) continue;` 在那一行**之前**,
 * 切片压根没覆盖到它 → 守卫全绿。
 * ⭐ 切片起点要覆盖**整个可能出现跳过的区域**,不是只覆盖合并那几行。
 */
const mergeBlock = (() => {
  const i = code.indexOf('for (const it of r.items');
  const j = code.indexOf('broadcast(snapshot(', i);
  return i > 0 && j > i ? code.slice(i, j) : '';
})();

describe('⭐⭐ 逐字段并集,不是整条二选一', () => {
  it('前提自检:切到了合并那段(否则整段空转)', () => {
    expect(mergeBlock.length, '合并逻辑没切到 —— 下面的断言会恒真').toBeGreaterThan(400);
  });

  it('⭐⭐ 已有的推**必须**走到合并分支,不许任何形式的整条跳过', () => {
    /**
     * ⚠️ 初版只禁了 `if (!captured.has(id))` 这一种写法 ——
     * 注入 `if (captured.has(id)) continue;` 时**照样全绿**:
     * 退化的形态不止一种,罗列反面写法永远漏。
     *
     * ⭐ 改成钉**正面形态**:合并块里不许出现任何 `captured.has(` 判断
     * (要判也该是 `captured.get()` 取出来合并),且必须真有合并动作。
     */
    expect(
      mergeBlock,
      '合并块里还有 captured.has 判断 —— 多半是某种形式的整条跳过\n'
      + '(载荷抓到过就不看 DOM → authorName/avatar/media/tweetUrl 全丢)',
    ).not.toMatch(/captured\.has\(/);
    expect(
      mergeBlock,
      '没有 continue/return 之外的合并路径 —— 已有的推根本没被补字段',
    ).toMatch(/captured\.set\(/);
  });

  it('⭐⭐ 已有载荷版本时,要走「只补没有的」那条分支', () => {
    expect(mergeBlock, '没有 else 分支 —— 载荷已有的推就完全不补 DOM 字段')
      .toMatch(/}\s*else\s*{/);
    expect(mergeBlock, '没有「只在原值是 undefined 时才补」的判断')
      .toMatch(/===\s*undefined/);
  });

  it('⭐⭐ DOM 独有的四项都参与合并', () => {
    /**
     * 这四项**只有 DOM 拿得到**(载荷里作者名要另查 user 结构、
     * 头像与 media 的实际 url 是渲染后才定的)。
     * 少一项就是「取并集」没做到。
     */
    for (const f of ['authorName', 'authorAvatar', 'tweetUrl', 'media']) {
      expect(mergeBlock, `DOM 独有字段 ${f} 没进合并 —— 载荷路的推会永远缺它`)
        .toContain(f);
    }
  });

  it('⭐ 补字段不改 fromDom(主体来自哪一路不因补字段而变)', () => {
    expect(
      mergeBlock,
      'else 分支里改了 fromDom —— 「这条是载荷抓的还是 DOM 抓的」就说不清了',
    ).not.toMatch(/else[\s\S]*fromDom\s*[:=]/);
  });
});

describe('⭐⭐ 扫描脚本复用完整提取器,不自己写精简版', () => {
  it('⭐⭐ 用的是 TWEET_SCRAPE_FN_BODY', () => {
    /**
     * 此前自己写了个只取 5 个字段的扫描(id/handle/text/createdAt/likes),
     * 而仓里 TWEET_SCRAPE_FN_BODY 早就抓全了(lang / metrics 四项 /
     * authorName / avatar / media),且已被 x-timeline-scan 复用。
     * 与 x-navigate 那次同族:**仓里已有更好的实现,却另造了一份差的**。
     */
    expect(code, '没复用完整提取器 —— 字段会缺一大半').toContain('TWEET_SCRAPE_FN_BODY');
    expect(code, '没调用 scrapeTweetArticle').toMatch(/scrapeTweetArticle\s*\(/);
  });

  it('⭐⭐ metrics 四项都取(不是只取 likes)', () => {
    /**
     * 用户实机验证当场看出来的:左边 102 回复/1 转推/51 赞/2.5K 阅读,
     * 右边只显示 {"likes":51}。
     */
    expect(code, 'metrics 写死成只取 likes —— 页面上另外三个数字白白丢掉')
      .not.toMatch(/metrics:\s*\{\s*likes:\s*it\.likes\s*\}/);
    expect(code, '没有把整份 metrics 带过来').toMatch(/metrics:\s*it\.metrics/);
  });

  it('⭐ lang 有取(空 lang 会让翻译/判断走偏)', () => {
    expect(code, 'lang 没取 —— 中文推会被当成未知语种').toMatch(/lang:\s*it\.lang/);
  });
});

describe('⭐⭐ 原始载荷要留(分清「X 没给」与「我们没解出来」)', () => {
  it('⭐⭐ rawPayloads 真的被填充,不只是个计数', () => {
    /**
     * 此前 body 解完就扔,只留 `payloads` 计数。于是用户说
     * 「这个数据明明有」时,分不清是 X 压根没返回,还是返回了但我们没解出来 ——
     * 而这两者的修法完全相反(去补采集 vs 去修解析器)。
     */
    expect(code, 'rawPayloads 没有被 push —— 原始载荷仍然解完就扔')
      .toMatch(/rawPayloads\.push\(/);
    expect(code, '没有截断策略 —— 一次 timeline 载荷可达几百 KB')
      .toMatch(/RAW_PAYLOAD_KEEP_CHARS/);
    expect(code, '没有条数上限 —— 内存会一直涨')
      .toMatch(/RAW_PAYLOAD_KEEP_COUNT/);
  });

  it('⭐ 载荷要记下是哪个 GraphQL 操作(逐页面验证时要分得清)', () => {
    expect(code, '没记操作名 —— 面板上分不清这条载荷是 UserTweets 还是 TweetDetail')
      .toMatch(/op:\s*url\.match\(/);
  });
});
