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

  it('⭐ 依赖 captureXPayloads 的模块都受这条链影响 —— 记在案', () => {
    // 这三个模块的载荷全靠 netBus;webRequest 侧空着它们就静默超时
    const consumers = FILES.filter((f) =>
      /captureXPayloads\s*\(/.test(strip(readFileSync(f, 'utf-8'))) &&
      !f.endsWith('x-net-capture.ts'));
    expect(consumers.length, '消费者清单变了,重新确认受影响范围').toBeGreaterThan(0);
  });
});
