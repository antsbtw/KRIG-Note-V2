/**
 * Substance visual-rules 求值器(L5-G2)— 空壳
 *
 * 决策 G2-7=B:本段留空壳,留 family-tree 阶段(里程碑 H)真实施.
 *
 * **职责**(规划):
 * 求值 SubstanceDef.visual_rules,把 substance 实例的 props 映射到 style overrides.
 * 例:Library.md 红楼梦例 `{ if: "gender === 'M'", apply: { 'frame.fill.color': '#a8c7e8' } }`
 * → 传入 props={gender:'M'},返回 { 'frame.fill.color': '#a8c7e8' }.
 *
 * **当前消费方**:无 — family-tree variant 才会真用 visual_rules.
 *
 * **设计要点**:
 * - 表达式求值用安全沙箱(不能 new Function / eval — 用户内容 + 内置 substance
 *   共用一套 evaluator,必须防恶意输入)
 * - 推荐 v1.5+ 实施时用 `jsep` 或 `expr-eval` 类小型表达式解析器
 *
 * TODO:family-tree 实施时迁入 V1 NodeRenderer 内的 visual_rules 求值逻辑.
 */

export {};
