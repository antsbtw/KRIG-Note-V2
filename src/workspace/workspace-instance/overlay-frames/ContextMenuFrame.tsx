/**
 * ContextMenuFrame — 右键菜单容器(式样)
 *
 * 按 charter § 1.4:
 * - L3 提供式样(本组件)
 * - L4 contextMenuRegistry 注册菜单内容
 * - L5 view 注册菜单项
 *
 * L3 阶段:占位 — Frame 存在但默认隐藏(等 L4 触发显示)。
 */

export function ContextMenuFrame() {
  // L3 阶段:不渲染任何内容(等 L4 Registry 注册 + 触发逻辑)
  return null;
}
