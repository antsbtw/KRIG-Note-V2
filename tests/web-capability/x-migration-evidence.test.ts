/**
 * ⭐⭐ 步 6a 迁移证据 —— X 的载荷捕获真的走了 `web.net`
 *
 * ⚠️ 为什么不能只靠 `tests/x/` 那 512 条:
 * 它们主要覆盖**业务逻辑**,不一定覆盖**取数层** —— 步 0 在 AI 侧就吃过这个亏
 * (`08` §6.5.2:把 walkMapping 改成事故形态,120 条一条不红)。
 * 所以每条断言都要能回答:**「如果没接上,这条还会成立吗?」**
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const X_DIR = join(process.cwd(), 'src/platform/main/x');
function src(name: string): string {
  return readFileSync(join(X_DIR, name), 'utf-8');
}
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** 本步已迁的模块 —— 每迁一个就加进来 */
const MIGRATED = [
  'x-author-profile.ts', 'x-notification-watch.ts',
  /**
   * ⭐ 2026-09-27 迁入 —— **它正是那个肇事者**:
   * 编排「先采集、后备料」，采集结束时的 `detach()` 把备料的订阅一起掐掉，
   * 于是 bio 采集 192 人里 159 次报「期间一条 GraphQL 载荷都没看见」。
   * `47582b72` 那次迁移就预言了这个形态，只是它叫停时没迁到这一个。
   */
  'x-timeline-harvester.ts',
];

describe('⭐⭐ 已迁模块:零 debugger,走 web.net', () => {
  for (const file of MIGRATED) {
    it(`⭐ ${file} 不再有 debugger.attach / detach`, () => {
      const code = stripComments(src(file));
      expect(code, `${file} 仍在自己 attach`).not.toMatch(/debugger\s*\.\s*attach/);
      expect(code, `${file} 仍在自己 detach —— 会掐掉别人的监听`).not.toMatch(/debugger\s*\.\s*detach/);
      expect(code, `${file} 仍在自己收 CDP 消息`).not.toMatch(/debugger\s*\.\s*on\s*\(/);
      expect(code, `${file} 仍在自己取 body`).not.toMatch(/getResponseBody/);
    });

    it(`⭐ ${file} 经 captureXPayloads 订阅`, () => {
      expect(stripComments(src(file))).toMatch(/captureXPayloads\(/);
    });
  }

  it('⭐⭐ 通道故障对调用方可见(旧实现是静默的)', () => {
    // 旧写法:`try { attach } catch { /* 共用即可 */ }` —— 失败什么都不说,
    // 订阅者安静等一个永不来的载荷。这是「看着成功实际没做」的典型。
    for (const file of MIGRATED) {
      expect(stripComments(src(file)), `${file} 未处理通道故障`).toMatch(/onChannelFault/);
    }
  });

  it('⭐ author-profile 能区分「通道坏了」与「没截到」', () => {
    // 旧实现两种情况给同一句错误话术,排查时分不出来
    const code = src('x-author-profile.ts');
    expect(code).toMatch(/通道故障/);
    /**
     * ⚠️ 2026-09-27 改:原来钉的是**那句话的字面量**
     * (「可能未登录、页面没加载完」)。而 2026-09-26 加诊断后，
     * 那句猜测性的话被换成了**实据**(「期间看见了 N 个接口」/
     * 「一条载荷都没看见」)—— 比原来更能区分成因，守卫却因此假红。
     * ⭐ 改成钉**行为**:两条分支给的话必须不同，而不是钉某一句的措辞。
     */
    const i = code.indexOf('if (!profile)');
    expect(i, '找不到「没截到」的分支').toBeGreaterThan(0);
    const branch = code.slice(i, code.indexOf('await saveAuthorCounts', i));
    expect(branch.length, 'slice 空转').toBeGreaterThan(100);
    expect(branch, '通道坏了与没截到给的是同一句话 —— 排查时分不出来')
      .toMatch(/channelFault[\s\S]{0,200}\?[\s\S]{0,400}:/);
    expect(branch, '「没截到」那条没给出期间看见了什么 —— 分不出是没发请求还是接口改名')
      .toMatch(/期间/);
  });

  it('⭐ notification-watch 通道聋了会告警(常驻监听最怕静默失聪)', () => {
    const code = src('x-notification-watch.ts');
    expect(code).toMatch(/监听已聋/);
    expect(code).toMatch(/channelFault/);
  });
});

describe('⭐ x-net-capture:业务方拿到的是退订,不是关灯', () => {
  const code = stripComments(src('x-net-capture.ts'));

  it('⭐⭐ 本身不导出任何 detach 能力', () => {
    expect(code).not.toMatch(/export\s+(?:async\s+)?function\s+detach/);
    expect(code).not.toMatch(/debugger\s*\.\s*detach/);
  });

  it('装通道走 bodyProvider(幂等,不重复 attach)', () => {
    expect(code).toMatch(/bodyProvider\.attach\(/);
    expect(code).toMatch(/netBus\.subscribe\(/);
  });

  it('⭐ 拿不到 body 不静默丢(旧实现是 .catch(() => {}))', () => {
    expect(code).toMatch(/载荷取不到/);
  });

  it('页面在 web.page 登记,partition 如实读取(底座不猜)', () => {
    expect(code).toMatch(/pageRegistry\.register\(/);
    expect(code).toMatch(/partition/);
  });
});

describe('⭐ 未触及 AI 侧(步 3/4 的成果)', () => {
  it('AI 的 Gemini 链路标志物仍在', () => {
    const ai = stripComments(readFileSync(
      join(process.cwd(), 'src/platform/main/ai/interceptor.ts'), 'utf-8'));
    expect(ai).toMatch(/netBus\.subscribe\(/);
    expect(ai).toMatch(/bodyProvider\.attach\(/);
    expect(ai).toMatch(/AI_SCRIPTS\./);
  });
});

describe('⚠️ 尚未迁移的模块(清单只减不增)', () => {
  /**
   * ⭐ 与 `slot-resource-guard` 同一范式:清单必须与现实精确对齐。
   * 迁一个就从这里删一条 —— 否则它会在下一处真违规时误放行。
   */
  const NOT_YET_MIGRATED = [
    'x-article-replies.ts',
    'x-capture-monitor.ts',
    'x-notifications.ts',
    'x-payload-inspector.ts',
  ];

  it('⭐ 清单里的模块确实还在用 debugger(修好了就要删掉)', () => {
    const stale = NOT_YET_MIGRATED.filter(
      (f) => !/debugger\s*\.\s*attach/.test(stripComments(src(f))),
    );
    expect(
      stale,
      '这些已不再用 debugger,请从 NOT_YET_MIGRATED 删掉:\n  ' + stale.join('\n  '),
    ).toEqual([]);
  });

  it('⭐ 已迁的不许出现在待迁清单里', () => {
    for (const m of MIGRATED) expect(NOT_YET_MIGRATED).not.toContain(m);
  });
});

/**
 * ⭐⭐ **采集掐不断别人** —— 2026-09-27 真机 bug 的守卫。
 *
 * ── 病是怎么发作的 ──
 * 编排的顺序是**先采集、后备料**。采集(未迁)结束时 `detach()`，
 * 把备料(已迁，只订阅)的通道**一起掐掉** ——
 * bio 采集 192 人里 **159 次**报「期间一条 GraphQL 载荷都没看见」，
 * 每次白等 12s，共 32 分钟。
 *
 * ⚠️ `47582b72` 那次迁移**就预言了这个形态**
 * (「A 先 → B 共用，A 走时真的 detach，B 静默失聪」)，
 * 只是它**只迁了 2 个就叫停**，采集正是漏下的 5 个之一。
 * ⭐ 编排把那个「难复现」的场景变成了**每次必现**。
 */
describe('⭐⭐ 采集不得掐断别的订阅者', () => {
  const src = stripComments(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));

  it('⭐⭐ 采集里零 debugger（碰不到就掐不断）', () => {
    /**
     * ⚠️ 钉 `wc.debugger` 而不是 `detach` ——
     * 只禁 detach 的话，「自己 attach 但不 detach」会漏网，
     * 而那样仍然会与底座抢通道。
     */
    expect(
      /wc\.debugger/.test(src),
      '采集又碰 debugger 了 —— 它一 detach 就会把抓 bio 的订阅掐掉',
    ).toBe(false);
  });

  it('⭐⭐ 走 captureXPayloads，且收尾只退订', () => {
    expect(src, '没走 web.net').toMatch(/captureXPayloads\(/);
    expect(src, '收尾没有退订 —— 订阅会泄漏').toMatch(/unsubscribe\(\)/);
  });

  it('⭐ 通道故障要进 problems（静默失聪是这类 bug 的本体）', () => {
    /**
     * ⚠️ 旧实现 attach 失败只 catch 一下就继续，订阅者安静等一个永不来的载荷 ——
     * 现象是「采集突然变 0」而**不报错**。
     */
    expect(src, '没接通道故障回调').toMatch(/onChannelFault/);
    expect(src, '通道坏了却不进 problems —— 人看到的会是「这页没数据」')
      .toMatch(/problems\.push\(`CDP 通道故障/);
  });

  it('⚠️ 翻页模板:拿不到请求头就不抄（别抄个空头去重放）', () => {
    /**
     * ⚠️ `requestHeaders` 来自 `onSendHeaders`，**可能为空**。
     * 抄个空头去重放 → X 拒收 → 报 404 → 把人带去查「翻页坏了」，
     * 而真因是「头没拿到」。
     */
    const i = src.indexOf('lastPeopleReq = {');
    expect(i, '找不到抄请求的地方').toBeGreaterThan(0);
    const guard = src.slice(Math.max(0, i - 200), i);
    expect(guard, '没判请求头是否存在就抄').toMatch(/payload\.requestHeaders &&/);
  });
});
