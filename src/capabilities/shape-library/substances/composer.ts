/**
 * Substance composer(L5-G2)— 空壳
 *
 * 决策 G2-7=B:本段留空壳,v1.5+ 实施.
 *
 * **职责**(规划):
 * 把 substance.components(shape / 嵌套 substance)按 transform 组合渲染.
 * 输出 EvaluatedSubstance(规划中类型,本段未定义):component 数组,每项含
 * EvaluatedPath + transform + style.
 *
 * **当前消费方**:无 — G3 canvas-rendering NodeRenderer 直接遍历
 * substance.components,逐个调 ShapeRegistry.evaluate 即可,不需要 composer.
 *
 * **未来消费方**:family-tree projection(里程碑 H)+ Library Picker 缩略图
 * (G4)+ user-defined substance 编辑器(v1.5+).
 *
 * TODO:v1.5+ 真实施时,把 V1 NodeRenderer 内"substance 展开 components"逻辑
 * 抽到这里 + 加 EvaluatedSubstance 类型 + 加 ShapeLibraryApi.substances.evaluate.
 */

export {};
