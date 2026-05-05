/**
 * GenericOverlayFrame — 通用浮层容器(帮助 / dialog / 进度等)
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md(用户决策:所有 Overlay 都归 Workspace,无 scope 字段):
 * - 所有"非五大交互"的浮层都在这里渲染
 * - L3 阶段:占位(等 L4 overlayRegistry)
 */

export function GenericOverlayFrame() {
  return null;
}
