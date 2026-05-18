/**
 * compute/integrate — Simpson 法则数值积分
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/fullscreen/math-utils.ts`
 * 的 integrate 函数。
 */

type EvalFn = (x: number) => number;

/**
 * Simpson 法则数值积分。
 *
 * @param fn 被积函数
 * @param a 左边界
 * @param b 右边界
 * @param n 分割数(偶数,默认 200);若传奇数自动 +1
 *
 * 返回 0 if a >= b(非法区间)。中间 NaN 采样自动跳过。
 */
export function integrate(fn: EvalFn, a: number, b: number, n = 200): number {
  if (a >= b) return 0;
  // 确保 n 为偶数
  if (n % 2 !== 0) n++;
  const h = (b - a) / n;
  let sum = fn(a) + fn(b);
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    const y = fn(x);
    if (!isFinite(y)) continue;
    sum += (i % 2 === 0 ? 2 : 4) * y;
  }
  return (h / 3) * sum;
}
