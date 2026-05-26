/**
 * math-visual driver block — components 索引
 *
 * Phase 1B 范围(7 个):
 * - FunctionRow / KaTexHelpers(KaTeX + LatexDisplay) / StylePopover / SettingsPanel /
 *   RangeInput / ParameterSlider
 *
 * Phase 1B 不迁(对齐决议):
 * - SmartGrid / InlineEndpoints — V1 用 Mafs `useTransformContext`,
 *   driver 单点屏障禁直 import Mafs;改由 capability `MathHost` 内部接管
 *   (renderAxis + renderEndpoint props)
 * - FullscreenErrorBoundary — Phase 2 全屏体系接入时迁
 */

export { FunctionRow } from './FunctionRow';
export { KaTeX, LatexDisplay } from './KaTexHelpers';
export { StylePopover } from './StylePopover';
export { ParameterSlider } from './ParameterSlider';
export { RangeInput } from './RangeInput';
export { SettingsPanel } from './SettingsPanel';
export { ExpressionDialog } from './ExpressionDialog';
