/**
 * ⭐⭐ **main 进程的构建时刻** —— 回答「跑着的 app 里有没有我刚才那个修改」。
 *
 * ⚠️ `electron-forge start` 只在**启动时**构建 —— 改完 main 的代码必须重启 app。
 * ⭐ 把构建时刻写进留痕,这件事就从**猜**变成**看一眼**。
 *
 * ⚠️ 放在能力层 wiring 而不是 X 模块:留痕是底座写的,X 可卸载而它不随之消失。
 */

/** ⚠️ 由 vite `define` 在构建时替换;没经过构建(单测)就是 undefined */
declare const __BUILD_STAMP__: string | undefined;

/**
 * ⚠️ 拿不到就如实说 `(未构建)` —— **不编一个时间出来**:
 * 兜底成 `new Date()` 会让「旧构建」永远显示成「刚刚」,
 * 正好掩盖掉要查的那件事(`feedback-fail-loud-no-fallback`)。
 */
export function mainBuildStamp(): string {
  try {
    return typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '(未构建)';
  } catch {
    return '(未构建)';
  }
}
