/**
 * ⭐⭐⭐ **这份代码是什么时候构建的** —— 2026-10-06
 *
 * ⚠️⚠️ 为什么需要它(真机踩到的):
 * 我改完「滚不动就换位置」让用户再采一次,用户采了,
 * **数据纹丝不动、停因里连「抢救」两个字都没有** ——
 * 两个人对着同一份输出纳闷「究竟问题在哪里」。
 * 真因是 **app 还跑着旧构建**:构建 07:16,修复提交 07:18,差 2.5 分钟。
 *
 * ⭐ `electron-forge start` 只在**启动时**构建 —— 改完代码必须**重启 app**,
 * 而在此之前,「跑着的 app 里有没有我刚才那个修改」**无从得知**,
 * 只能靠我说「应该有了」。那是猜,不是判据。
 *
 * ⭐⭐ 把构建时刻印进产物、再印进留痕,这件事就从**猜**变成**看一眼**。
 * ⚠️ 这正是 `feedback-maintainability-over-feature-completion`:
 * 判断依据要留得下来,别让下次验证又靠人。
 */

/** ⚠️ 由 vite `define` 在**构建时**替换成字面量;没经过构建就是 undefined */
declare const __BUILD_STAMP__: string | undefined;

/**
 * ⭐ 构建时刻(ISO)。
 * ⚠️ 单测里没有 `define`,所以回 `'(未构建)'` —— **不编一个时间出来**
 * (`feedback-fail-loud-no-fallback`:兜底成 `new Date()` 会让
 * 「旧构建」永远显示成「刚刚」,正好掩盖掉要查的那件事)。
 */
export function buildStamp(): string {
  try {
    return typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '(未构建)';
  } catch {
    return '(未构建)';
  }
}

/**
 * ⭐⭐ 构建到现在多久了 —— **分钟**。
 * ⚠️ 判据:改完代码没重启的话,这个数会**一直涨**;
 * 而人刚重启过就应该是个位数。
 */
export function buildAgeMinutes(now: number = Date.now()): number | undefined {
  const s = buildStamp();
  if (s === '(未构建)') return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : Math.round((now - t) / 60000);
}
