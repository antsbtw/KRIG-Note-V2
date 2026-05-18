/**
 * host/tools — Phase 2 全屏工具(capability 内部使用)
 *
 * 这些组件**只在 MathHost 内部使用**,不对外暴露(driver 通过 MathHostProps.overlays
 * 间接配置)。LegendOverlay 是纯 DOM(不依赖 Mafs hook)留 driver fullscreen 内。
 */

export { TangentTool } from './TangentTool';
export { NormalTool } from './NormalTool';
export { IntegralTool } from './IntegralTool';
export { AnnotationTool } from './AnnotationTool';
export { FeatureTool } from './FeatureTool';
export { RiemannTool } from './RiemannTool';
export { EndpointMarkers } from './EndpointMarkers';
export { HoverCoords } from './HoverCoords';
export type { RiemannMode } from './RiemannTool';
export type { EndpointData } from './EndpointMarkers';
