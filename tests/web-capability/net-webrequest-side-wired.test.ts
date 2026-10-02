/**
 * ⭐⭐ web.net 的 webRequest 侧**必须真的接线**(2026-09-15)
 *
 * ── 起因(实测)──
 *
 * 用户点「抓画像」,日志刷了上百行:
 *   [web.net] body 关联失败 … 配不上任何 webRequest 记录
 * 其中包括 `UserByScreenName?screen_name=fang_danie121` 这条**正是抓画像要的载荷**。
 *
 * 真因:`NetworkEventBus.recordRequestStart`(webRequest 侧唯一入口)
 * **在生产代码里零调用** —— 只有 6 个测试文件在调。于是:
 *
 *   candidatesFor(pageId) 恒空
 *     → findClosestMatch 恒 null
 *       → attachProviderBody 恒 `关联失败`
 *         → captureXPayloads 的 onPayload **永不触发**
 *           → harvestAuthorProfile 空转 12s → 「未截获 @x 的账号载荷」
 *
 * ⚠️⚠️ 这是本仓反复出现的形态:**层建好了、测试六份、接线为零**。
 * 单测全绿,因为测试自己调 `recordRequestStart` 把两边都喂上了 ——
 * 而真机上没有任何人喂 webRequest 侧。
 * 与 [[feedback-guard-must-pin-live-code]] 同族:守卫钉的东西活不活。
 *
 * ⭐ 所以这条守卫钉的不是「函数存在」,而是「**生产代码里有人调用它**」。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(__dirname, '../../src');

/** 递归收集 src 下所有 .ts/.tsx(生产代码,不含 tests/) */
function allSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allSources(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = allSources(SRC);
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** 在生产代码里找某个符号的**调用点**(排除它自己的定义文件) */
function productionCallers(symbol: string, definedIn: string): string[] {
  const hits: string[] = [];
  for (const f of FILES) {
    if (f.endsWith(definedIn)) continue;
    const code = strip(readFileSync(f, 'utf-8'));
    if (new RegExp(`\\.${symbol}\\s*\\(`).test(code)) {
      hits.push(f.slice(SRC.length + 1));
    }
  }
  return hits;
}

describe('⭐⭐ web.net:两侧都要接线,只有一侧等于整层不工作', () => {
  it('⭐⭐ webRequest 侧(recordRequestStart)在生产代码里**有人调用**', () => {
    const callers = productionCallers('recordRequestStart', 'net/bus.ts');
    expect(
      callers,
      'recordRequestStart 只有测试在调 —— webRequest 侧恒空,'
      + '于是每一条 CDP 载荷都「配不上任何 webRequest 记录」,'
      + 'captureXPayloads 的 onPayload 永不触发(抓画像/通知监听全哑)',
    ).not.toHaveLength(0);
  });

  it('⭐⭐⭐ 而那个调用者自己也得**有人调** —— 否则整条链还是死的', () => {
    /**
     * ⚠️⚠️ **本条是 2026-10-02 补的,因为上一条假绿了。**
     *
     * 上一条用 `\.recordRequestStart\s*\(` 搜生产代码、排除定义文件
     * `net/bus.ts` —— 于是 `webrequest-side.ts` 里的 `bus.recordRequestStart({`
     * 让它变绿。可那两处在 `recordStart`/`recordHeaders` 里,
     * 而它们只被 `wireWebRequestSide` 调,**而 `wireWebRequestSide` 零调用**。
     *
     * ⭐ 所以上一条说的是「有人调」,真相是「**只有那个本身没被调的函数在调**」——
     * 正是 `feedback-guard-must-pin-live-code` 第二刀:
     * 守卫钉在**进不去的分支**上,全绿也证明不了链路活着。
     *
     * ⭐ 判据换成**从接线入口往回查**:`wireWebRequestSide` 必须有人调。
     * 它是整条 webRequest 侧的唯一门,门没开里面谁调谁都不算。
     */
    const callers = FILES.filter((f) => {
      if (f.endsWith('webrequest-side.ts')) return false;   // 它自己的定义处
      /**
       * ⚠️ 两个入口都算:`wireWebRequestSide(partition)` 与
       * `wireWebRequestSideOn(session)` —— 后者是 2026-10-02 加的,
       * 因为调用方手上只有 WebContents 时反推 partition 名会猜错
       * (猜错会**凭空建 session**,监听挂到没人用的地方,且完全静默)。
       * ⭐ 只认前者的话,改用新入口会让这条守卫**假红** —— 它会报
       * 「零调用」而链路其实是活的,然后有人去「修」一个不存在的问题。
       */
      return /\bwireWebRequestSide(On)?\s*\(/.test(strip(readFileSync(f, 'utf-8')));
    }).map((f) => f.slice(SRC.length + 1));

    expect(
      callers,
      'wireWebRequestSide 零调用 —— webRequest 侧整条是死的:\n'
      + '  candidatesFor(pageId) 恒空 → findClosestMatch 恒 null\n'
      + '  → attachProviderBody 恒「关联失败」→ 不发 response-complete\n'
      + '  → 所有订阅者一条载荷都收不到(而且是**静默**的,只在日志里刷关联失败)\n'
      + '⚠️ 上面那条「有人调用」会绿,因为调用者在 wireWebRequestSide 内部。',
    ).not.toHaveLength(0);
  });

  it('⭐ CDP 侧(bindProviderRequest)也要有人调用 —— 少哪边都配不上', () => {
    /**
     * ⚠️⚠️ 本条初版钉的是 `noteProviderRequest` —— **全仓不存在这个方法**
     * (bus.ts 里真正的名字是 `bindProviderRequest`,而 body-provider.ts
     *  早就在调)。于是这条断言**永远红,且红得没有意义**:
     * 它报告「CDP 侧没人接」,而事实是 CDP 侧一直接着。
     *
     * ⭐ 守卫钉的符号必须是**活的**(记忆 feedback-guard-must-pin-live-code)。
     * 写守卫时核对一下符号在不在,比事后查「为什么这条一直红」便宜得多。
     *
     * ⭐ 反向锁:符号名写错时要能立刻发现 —— 先断言它真的存在于 bus.ts。
     */
    const busSrc = readFileSync(resolve(SRC, 'platform/main/web-capability/net/bus.ts'), 'utf-8');
    expect(
      busSrc,
      'bindProviderRequest 不在 bus.ts 里 —— 守卫又钉了个幻影符号',
    ).toMatch(/\bbindProviderRequest\s*\(/);

    const callers = productionCallers('bindProviderRequest', 'net/bus.ts');
    expect(callers, 'CDP 侧登记没人调,关联同样恒失败').not.toHaveLength(0);
  });

  it('⭐⭐⭐ pageId 反查也得有人注册 —— 否则接线了也一条不记', () => {
    /**
     * ⚠️⚠️ **2026-10-02 真机查出的第三层缺口**,与前两条是同一条链:
     *
     *   `wireWebRequestSide` 零调用              ← 第一层(已修)
     *     → 接上了、`onBeforeRequest` 也触发了
     *       → 但 `pageOf(wcId)` 里 **`lookup` 是 null** → 返回 null
     *         → `recordStart` 直接 return,**一条记录都不写**  ← 第三层
     *           → `candidatesFor` 恒空 → 每条 CDP 载荷都 correlate-failed
     *
     * ⚠️ 真机症状:接线 ✅ attach ✅ 滚动 ✅(5 轮 3321px)、
     * CDP 什么都抓到了(GraphQL/timeline.json/视频流),
     * 但**每一条都关联失败**,最终 captured=0。
     *
     * ⭐ `webrequest-side.ts` 自己的注释早就警告过:
     * 「静默不记会让**关联失败看起来像 CDP 侧的问题**,排查方向完全相反」
     * —— 而我差点就去查 CDP 了。
     *
     * ⭐ 判据与前两条同款:从**注册入口**往回查,不钉内部调用。
     */
    const callers = FILES.filter((f) => {
      if (f.endsWith('webrequest-side.ts')) return false;   // 它自己的定义处
      return /\bregisterPageIdLookup\s*\(/.test(strip(readFileSync(f, 'utf-8')));
    }).map((f) => f.slice(SRC.length + 1));

    expect(
      callers,
      'registerPageIdLookup 零调用 —— webRequest 侧**接上了但一条记录都不写**:\n'
      + '  pageOf(wcId) 恒 null → recordStart 直接 return\n'
      + '  → candidatesFor 恒空 → 每条 CDP 载荷都 correlate-failed\n'
      + '⚠️ 症状会**看起来像 CDP 侧的问题**,排查方向完全相反。',
    ).not.toHaveLength(0);
  });

  it('⭐ 依赖 captureXPayloads 的模块都受这条链影响 —— 记在案', () => {
    // 这三个模块的载荷全靠 netBus;webRequest 侧空着它们就静默超时
    const consumers = FILES.filter((f) =>
      /captureXPayloads\s*\(/.test(strip(readFileSync(f, 'utf-8'))) &&
      !f.endsWith('x-net-capture.ts'));
    /**
     * ⚠️ 2026-09-29 改:X 业务层整体移除后,`captureXPayloads` **暂时零消费者**。
     * ⭐ 原来断言「> 0」是把「现在有几个用它」当成了不变量 ——
     * 那不是规则,是当时的现状。
     *
     * ⭐ **真正的规则**:只要有人用它,webRequest 侧就必须接线
     * (空着的话消费者会**静默超时**,而不是报错 —— 本仓 bio 采集
     *  0/192 就是这么来的)。零消费者时这条自然成立。
     */
    if (consumers.length > 0) {
      const wiring = strip(readFileSync(
        'src/platform/main/web-capability/wiring/webrequest-side.ts', 'utf-8'));
      expect(
        wiring,
        `有 ${consumers.length} 个模块靠 captureXPayloads 取数,`
        + 'webRequest 侧却没挂监听 —— 它们会静默超时,不报错',
      ).toMatch(/webRequest\.onBeforeRequest\(/);
    }
  });
});
