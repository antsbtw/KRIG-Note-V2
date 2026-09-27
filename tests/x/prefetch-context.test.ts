/**
 * ⭐⭐ **备料**(流水线第 ③ 步)—— 用户 2026-09-26:
 *
 * > 「针对目标数据，获取对应的 bio-上下文--打包」
 * > 「这一步应该是先查询数据库，有就即可获取，没有再从 x 上定位获取。」
 *
 * ⚠️ 这一步原来**根本不在编排里** —— 两个预取只挂在收件箱面板的按钮上。
 * 手点时人就是那根接线;编排一跑,拟回复拿到的推**没 bio 也没上文**。
 * 这正是用户说的「你割裂了流程了」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//`(本仓踩过:整段 URL 被删→假绿) */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('⭐⭐ 上文深度是变量,不是写死的 1 条', () => {
  const src = strip(read('src/platform/main/x/x-parent-tweet.ts'));

  it('⭐⭐ depth 参数真的进了注入脚本(不是收了不用)', () => {
    /**
     * ⚠️ 本仓最贵的死参数形态:「类型有、JSON 有、消费层零消费」。
     * 判据 = 那段浏览器脚本里**真的用到了 depth**,
     * 不能只断言函数签名上有这个参数。
     */
    const i = src.indexOf('var from = Math.max(0, idx -');
    expect(i, '注入脚本里没有按 depth 取的起点 —— 还是只读紧邻一条').toBeGreaterThan(0);
    const line = src.slice(i, src.indexOf('\n', i));
    expect(line, '起点没有用到 depth,是写死的').toMatch(/\$\{[^}]*depth[^}]*\}/);
  });

  it('⭐ 由近及远:context[0] 必须是紧邻那条', () => {
    /** 顺序错了的话,模型会把最远的那条当成直接上文 */
    const i = src.indexOf('for (var k = idx - 1;');
    expect(i, '不是从 idx-1 倒着取 —— 顺序会反').toBeGreaterThan(0);
    expect(src.slice(i, src.indexOf('\n', i)), '不是倒序(由近及远)').toMatch(/k--/);
  });

  it('⚠️ 向后兼容:老调用方只读 text,仍要拿到紧邻那条', () => {
    const i = src.indexOf("via: 'thread-page',");
    expect(i, '找不到真正的返回值').toBeGreaterThan(0);
    const blk = src.slice(Math.max(0, i - 200), i);
    expect(blk, 'text 不再是紧邻那条 —— 老调用方会拿到别的推').toMatch(/text: ctx\[0\]\.text/);
  });

  it('⚠️ 空正文的条目要丢掉(纯图片推没有 tweetText)', () => {
    expect(
      src,
      '留着空条目 → 模型读到「有一条但没内容」',
    ).toMatch(/\.filter\(\(r\) => r\.text\)/);
  });
});

describe('⭐⭐ 备料:先查库,缺了才去 X 取', () => {
  const src = strip(read('src/platform/main/x/x-prefetch-context.ts'));

  it('⭐⭐ bio:库里新鲜就跳过,不去 X 跑', () => {
    const i = src.indexOf('const fresh =');
    expect(i, '没有「新鲜就跳过」的判据 —— 每次都会重跑').toBeGreaterThan(0);
    const blk = src.slice(i, i + 300);
    expect(blk, '没用 PROFILE_STALE_HOURS 当新鲜度判据').toMatch(/PROFILE_STALE_HOURS/);
    expect(blk, '命中缓存没有 continue —— 还是会往下跑去采')
      .toMatch(/bioCached \+= 1;[\s\S]{0,40}continue/);
  });

  it('⭐⭐ 上文:库里有 parent_text 就不重抓', () => {
    expect(
      src,
      '没有「已有上文就跳过」—— 每跑一次就重抓一遍,白跳详情页',
    ).toMatch(/\.filter\(\(t\) => !t\.parent_text\)/);
  });

  it('⭐⭐ 只对真的是回复的推抓上文', () => {
    /**
     * ⚠️ 实测 60 条 worth 样本里 **39 条是孤立原创推**(天生没有上下文)。
     * 为它们白跑一次导航是纯浪费。
     */
    const i = src.indexOf('function isReply');
    expect(i, '没有 isReply 判据 —— 会给孤立原创推白跳详情页').toBeGreaterThan(0);
    const blk = src.slice(i, i + 220);
    expect(blk, '判据没看 in_reply_to_user').toMatch(/in_reply_to_user/);
    expect(src, 'isReply 算出来了却没用来筛').toMatch(/pool\.filter\(isReply\)/);
  });

  it('⚠️ handle 必须归一化(漂移 = 永远命中不上且不报错)', () => {
    const i = src.indexOf('const handles =');
    expect(i, '找不到取 handle 的地方').toBeGreaterThan(0);
    expect(
      src.slice(i, i + 200),
      'x_tweet 存 @Xxx、x_author 存小写 —— 不归一化就永远查不到,而且不报错',
    ).toMatch(/normalizeHandle/);
  });

  it('⭐ 连续失败要报机制可疑,不是默默继续', () => {
    expect(src, '没有连续失败的计数').toMatch(/maxConsecutive/);
    expect(
      src,
      '连着一串采不到多半是机制坏了 —— 继续往下拟回复,人会在毫不知情下拿到一堆「只读正文」的建议',
    ).toMatch(/mechanismSuspect: maxConsecutive >= 5/);
  });

  it('⭐ 深度有没有生效,看 avgDepth(恒为 1 就是没生效)', () => {
    expect(src, '没有回读实际抓到的深度 —— 变量填了也不知道生没生效')
      .toMatch(/avgDepth: ctxFetched > 0/);
  });
});

describe('⭐⭐ prefetch 接进了编排(不是只挂在手点按钮上)', () => {
  it('⭐⭐ 能力表里有 prefetch', () => {
    const caps = strip(read('src/platform/main/x/x-flow-capabilities.ts'));
    expect(caps, 'x 的能力适配器里没有 prefetch').toMatch(/async prefetch\(/);
    expect(caps, '没调共用函数 —— 别在适配器里写第二份实现')
      .toMatch(/prefetchReplyContext\(/);
  });

  it('⭐⭐ 契约、登记表、配方三处都登记了', () => {
    expect(
      strip(read('src/shared/types/flow-recipe-types.ts')),
      "FlowStepKind 里没登记 'prefetch'",
    ).toMatch(/\| 'prefetch'/);
    const runner = strip(read('src/platform/main/flow/flow-runner.ts'));
    expect(runner, 'FlowCapabilities 里没有 prefetch').toMatch(/prefetch\(params/);
    expect(
      runner,
      "STEP_TYPE_BY_KIND 里没登记 prefetch —— step_type 会变成 unknown",
    ).toMatch(/prefetch: 'fetch'/);
    expect(
      strip(read('src/platform/main/x/x-flow-recipes.ts')),
      "默认配方里没有 prefetch 这一步 —— 接了也不会跑",
    ).toMatch(/kind: 'prefetch'/);
  });

  it('⚠️ 备料**不当闸门**:没料也能拟回复,只是质量差', () => {
    /**
     * ⚠️ 与判断步不同:判断说「没候选」是真的无事可做;
     * 备料失败只是语境差,不该把后面整条掐掉。
     */
    const caps = read('src/platform/main/x/x-flow-capabilities.ts');
    const i = caps.indexOf('async prefetch(');
    /**
     * ⚠️ 2026-09-26 改锚点:原来切到 `async planReply(`,
     * 而 `askAdvice` 插在 prefetch 与 planReply **之间**,
     * 它**该**表态 hasCandidates(没建议就无事可做)——
     * 于是这条守卫开始假红。⭐ 切到**下一个能力**为止,不是切到某个固定能力。
     */
    const j = caps.indexOf('async askAdvice(');
    expect(i, '找不到 prefetch').toBeGreaterThan(0);
    expect(j, '找不到 prefetch 后面那个能力').toBeGreaterThan(i);
    const body = caps.slice(i, j);
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    expect(
      /hasCandidates:/.test(strip(body)),
      '备料表态了 hasCandidates —— 会把拟回复误刹',
    ).toBe(false);
  });

  it('⭐ 备料要留观察点(先查库省了多少、现采成功率)', () => {
    const caps = read('src/platform/main/x/x-flow-capabilities.ts');
    const i = caps.indexOf('async prefetch(');
    const body = strip(caps.slice(i, caps.indexOf('async planReply(')));
    expect(body, '没留 evidence —— 「先查库」到底省没省,回头查不到')
      .toMatch(/evidence: \{ items:/);
  });
});

/**
 * ⭐⭐ **只有一份实现** —— 用户 2026-09-26:
 * > 「不要使用这些旧的函数了，要使用新的重构后的函数。」
 *
 * ⚠️ 重构最危险的收尾形态是**新旧并存**:新函数写好了,老 handler 还是老实现。
 * 两份必漂,而漂的表现是「手点能跑、编排跑出来的不一样」,极难查。
 * (本仓同形教训:`planReplyBatch` 当初就是为这个从 handler 里抽出来的。)
 */
describe('⭐⭐ 备料只有一份实现(新旧不并存)', () => {
  const handlers = strip(read('src/platform/main/x/x-timeline-handlers.ts'));

  it('⭐⭐ 两个 handler 都调共用函数', () => {
    const i = handlers.indexOf('X_PREFETCH_CONTEXT, async');
    const j = handlers.indexOf('X_PREFETCH_PROFILES, async');
    expect(i, '找不到 X_PREFETCH_CONTEXT 的 handler').toBeGreaterThan(0);
    expect(j, '找不到 X_PREFETCH_PROFILES 的 handler').toBeGreaterThan(i);
    /** ⚠️ 切到各自的函数体再断言,别整文件 toMatch(同名 token 会假绿) */
    const ctxBody = handlers.slice(i, j);
    const profBody = handlers.slice(j, j + 1200);
    expect(ctxBody.length, 'slice 空转').toBeGreaterThan(100);
    expect(ctxBody, '上文 handler 没走共用函数').toMatch(/prefetchReplyContext\(/);
    expect(profBody, '画像 handler 没走共用函数').toMatch(/prefetchReplyContext\(/);
  });

  it('⭐⭐ handler 里不许再有自己的备料循环', () => {
    /**
     * ⚠️ 钉的是**老实现的特征**:
     * 直接调 `harvestAuthorProfile` / `fetchParentTweet` 并自己 for 循环。
     * 它俩在别处还有用(单条现采),所以不能整文件禁用 ——
     * 只禁在这两个 handler 的范围内。
     */
    const i = handlers.indexOf('X_PREFETCH_CONTEXT, async');
    const seg = handlers.slice(i, handlers.indexOf('X_UPSERT_RECIPE'));
    expect(seg.length, 'slice 空转').toBeGreaterThan(200);
    expect(
      /fetchParentTweet\(/.test(seg),
      '备料 handler 里又出现了自己抓上文的实现 —— 两份必漂',
    ).toBe(false);
    expect(
      /harvestAuthorProfile\(/.test(seg),
      '备料 handler 里又出现了自己采画像的实现 —— 两份必漂',
    ).toBe(false);
  });

  it('⚠️ 两个调用方的 wsId 口径相反,都要说清楚', () => {
    /**
     * ⚠️ 收件箱**不按 wsId 过滤**(列表本身不过滤,过滤会出现
     * 「屏幕上明明有 67 条,预取却说没有可预抓的」);
     * 编排**要过滤**(planReplyBatch 按 wsId 取候选)。
     * ⭐ 口径由调用方给,函数里不替它定 —— 少给一个就会静默按错的口径跑。
     */
    expect(handlers, '收件箱这边没显式给 filterByWs').toMatch(/filterByWs: false/);
    const caps = strip(read('src/platform/main/x/x-flow-capabilities.ts'));
    expect(caps, '编排这边没显式给 filterByWs —— 会给别的 ws 的推白备料')
      .toMatch(/filterByWs: true/);
  });
});

/**
 * ⭐⭐ **配方里要真的标上** —— 2026-09-26 真机修。
 * ⚠️ 契约改了、runner 改了，配方漏标的话**一切照旧**:
 * 判断没判出 worth → 备料照样被跳过，库里存量候选照样被放弃。
 */
describe('⭐⭐ 备料在配方里标了 readsFromStore', () => {
  it('⭐⭐ 默认配方的 prefetch 那步标了', () => {
    const rec = read('src/platform/main/x/x-flow-recipes.ts');
    const i = rec.indexOf("kind: 'prefetch'");
    expect(i, '默认配方里没有 prefetch 这一步').toBeGreaterThan(0);
    /** ⚠️ 切到这一步的对象里再断言，别整文件 toMatch（同名 token 会假绿） */
    const blk = rec.slice(i, rec.indexOf("id: 'askAdvice'", i));
    expect(blk.length, 'slice 空转').toBeGreaterThan(50);
    expect(
      blk,
      '备料没标 readsFromStore —— 判断没判出 worth 时它还是会被跳过，\n'
      + '而库里 1075 条待备料的候选会被一起放弃',
    ).toMatch(/readsFromStore: true/);
  });

  it('⚠️ 拟回复**不该**标（它吃上一步的产出）', () => {
    const rec = read('src/platform/main/x/x-flow-recipes.ts');
    const i = rec.indexOf("kind: 'planReply'");
    expect(i, '找不到 planReply 步骤').toBeGreaterThan(0);
    const blk = rec.slice(i, rec.length);
    expect(
      /readsFromStore/.test(blk),
      '拟回复也标了自取 —— 没新候选时又会空转（回到 125 秒那个 bug）',
    ).toBe(false);
  });
});

/**
 * ⭐⭐ **限额只加在「产生对外动作」那一刻** —— 用户 2026-09-26 订正两次:
 *
 * > 「我们只需要限定自动回复的地方，你每个地方都限定是什么意思呢？」
 * > 「拟回复都不应该限定，因为这是一个处理过程，
 * >   真正担心封控和回复质量是真正回复的时候做限定就够了。」
 *
 * ⚠️ 我当初在采集/判断/备料/拟回复**四处**都填了 10 ——
 * 而这四步全是只读或只写自己的库，**不产生任何对外影响**。
 * 该限的那一步（自动填入 X 回复框）反而还没写。
 */
describe('⭐⭐ 内部处理步骤不设安全限额', () => {
  const REC = read('src/platform/main/x/x-flow-recipes.ts');
  /** 切出某一步的对象体 —— ⚠️ 别整文件 toMatch（同名 token 会假绿） */
  const stepOf = (id: string): string => {
    const i = REC.indexOf(`id: '${id}'`);
    expect(i, `配方里找不到步骤 ${id}`).toBeGreaterThan(0);
    const next = REC.indexOf('    {\n      id:', i);
    const body = REC.slice(i, next > i ? next : REC.length);
    expect(body.length, `${id} 的 slice 空转`).toBeGreaterThan(30);
    return body;
  };

  it('⭐⭐ 采集不写 pageBudget（翻到 X 说没有为止）', () => {
    expect(
      /pageBudget:/.test(stepOf('collect')),
      '采集又被限页数了 —— 它只写自己的库，不产生对外动作',
    ).toBe(false);
  });

  it('⭐⭐ 判断不写 batchSize（沿用实测出来的默认 25）', () => {
    expect(
      /batchSize:/.test(stepOf('judge')),
      '判断又被填了批量 —— 默认 25 是按「开销摊薄 vs 超时重来」实测权衡的，别覆盖',
    ).toBe(false);
  });

  it('⚠️ 备料/拟回复的 limit 是**分批批量**，不能小于默认值', () => {
    /**
     * ⚠️ 这两处**留空反而更小**:
     * 备料默认 20、拟回复默认 30，而库里各有 1080 / 1109 条待处理。
     * ⭐ 所以要显式写大，写的是「一趟处理多少」不是「最多允许多少」。
     */
    const pre = stepOf('prefetch').match(/limit:\s*(\d+)/)?.[1];
    const plan = stepOf('planReply').match(/limit:\s*(\d+)/)?.[1];
    expect(Number(pre), '备料 limit 比默认 20 还小 —— 留空都比这强').toBeGreaterThan(20);
    expect(Number(plan), '拟回复 limit 比默认 30 还小 —— 留空都比这强').toBeGreaterThan(30);
  });

  it('⭐ 送 Claude 的 limit 是**技术限制**不是安全闸（要有说明）', () => {
    /** ⚠️ 整批打包发，条数太多会超单条输入上限 —— 与安全限额是两回事 */
    expect(
      stepOf('askAdvice'),
      '保留了 limit 却没说清为什么 —— 会被当成又一个「随手填的谨慎数」',
    ).toMatch(/技术限制/);
  });
});
