/**
 * ⭐⭐ **请求头要真的被记下来** —— 2026-09-27 补。
 *
 * ── 为什么非补不可 ──
 * `NetworkRecord.requestHeaders` 这个字段**声明了但从没人写** ——
 * 又一例本仓常见的「类型有、字段有、生产端零写入」。
 * 而 X 的游标翻页要**复用 X 刚发过的那条请求**（authorization /
 * x-csrf-token 原样重发），没有请求头就只能自己拼鉴权 —— 那条路已被否决。
 *
 * ⚠️ `onBeforeRequest` **拿不到请求头**，必须另挂 `onSendHeaders`。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8');
/** ⚠️ 行注释正则要躲开 `https://` 里的 `//` */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WIRING = strip(read('src/platform/main/web-capability/wiring/webrequest-side.ts'));
const CAPTURE = strip(read('src/platform/main/x/x-net-capture.ts'));

describe('⭐⭐ 生产端真的写了（不是只在类型里）', () => {
  it('⭐⭐ 挂了 onSendHeaders（唯一拿得到请求头的钩子）', () => {
    expect(
      WIRING,
      '没挂 onSendHeaders —— onBeforeRequest 拿不到请求头，字段会永远是空的',
    ).toMatch(/sess\.webRequest\.onSendHeaders\(/);
  });

  it('⭐⭐ 真的把 requestHeaders 写进了 bus', () => {
    /** ⚠️ 挂了钩子却不写字段 = 白挂，而且看不出来 */
    const i = WIRING.indexOf('function recordHeaders');
    expect(i, '找不到 recordHeaders').toBeGreaterThan(0);
    const body = WIRING.slice(i, WIRING.indexOf('function recordDone'));
    expect(body.length, 'slice 空转').toBeGreaterThan(100);
    expect(body, '没调 recordRequestStart').toMatch(/bus\.recordRequestStart\(/);
    expect(body, '没写 requestHeaders —— 这一趟的全部价值就在这一行')
      .toMatch(/requestHeaders: details\.requestHeaders/);
  });

  it('⚠️ 与 recordStart 用同一个 requestId（补齐同一条，不是两条）', () => {
    /**
     * ⚠️ 用别的 id 会变成两条记录：一条有头没 body，一条有 body 没头，
     * 而翻页两样都要 —— 现象是「拿得到 body 却拿不到头」。
     */
    const i = WIRING.indexOf('function recordHeaders');
    const body = WIRING.slice(i, WIRING.indexOf('function recordDone'));
    expect(body, 'requestId 口径与 recordStart 不一致').toMatch(/requestId: String\(details\.id\)/);
  });

  it('⚠️ 映射不到已登记页面就丢（与 recordStart 同口径，绝不猜 pageId）', () => {
    const i = WIRING.indexOf('function recordHeaders');
    const body = WIRING.slice(i, WIRING.indexOf('function recordDone'));
    expect(body, '没做 pageId 映射检查 —— 会把别的页面的流量关联过来')
      .toMatch(/if \(!pageId\) return/);
  });

  it('⚠️ 记录出错不能影响真实请求', () => {
    const i = WIRING.indexOf('onSendHeaders(');
    const blk = WIRING.slice(i, i + 300);
    expect(blk, '没兜住异常 —— 留痕的错误会影响真实网络请求').toMatch(/try \{/);
  });
});

describe('⭐⭐ 一路透传到业务方', () => {
  it('⭐⭐ XPayload 带上 method 与 requestHeaders', () => {
    const i = CAPTURE.indexOf('export type XPayload');
    expect(i, '找不到 XPayload').toBeGreaterThan(0);
    const t = CAPTURE.slice(i, CAPTURE.indexOf('};', i));
    expect(t, 'XPayload 没有 method').toMatch(/method\?:/);
    expect(t, 'XPayload 没有 requestHeaders').toMatch(/requestHeaders\?:/);
  });

  it('⭐⭐ onPayload 真的传了（类型有、传递为零 = 死字段）', () => {
    /** ⚠️ 本仓最贵的一类 bug：字段声明了、消费层零传递 */
    const i = CAPTURE.indexOf('options.onPayload({');
    expect(i, '找不到 onPayload 调用').toBeGreaterThan(0);
    const call = CAPTURE.slice(i, CAPTURE.indexOf('});', i));
    expect(call.length, 'slice 空转').toBeGreaterThan(40);
    expect(call, 'method 没传下去').toMatch(/method: record\.method/);
    expect(call, 'requestHeaders 没传下去').toMatch(/requestHeaders: record\.requestHeaders/);
  });

  it('⚠️ 拿不到头就是拿不到，不许编一个空对象', () => {
    /**
     * ⚠️ 编一个 `{}` 会让翻页拿着空头去重放 → X 拒收 →
     * 现象是「404」而不是「没有头」，排查方向完全被带偏。
     */
    const i = CAPTURE.indexOf('options.onPayload({');
    const call = CAPTURE.slice(i, CAPTURE.indexOf('});', i));
    expect(
      /requestHeaders: record\.requestHeaders \?\?/.test(call),
      '给请求头兜了默认值 —— 空头重放会报 404，把人带去查错方向',
    ).toBe(false);
  });
});
