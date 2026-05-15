/** Handle 菜单类型(块手柄)
 *
 * L5-B3.11:加 visibleWhen / icon / submenuOf 支持子菜单 + 条件显示(对齐 V1)
 * 2026-05-15:加 submenuRender 让 submenu 容器自定义渲染内容(统一 hover ▸ 式样)
 *
 * 统一交互式样:
 * - 顶层 item(叶):click → 触发命令 + 关菜单
 * - 顶层 item(带 ▸):hover → 右侧浮出 submenu
 * - submenu 默认 button 列表(submenuOf 子项填充)
 * - submenu 自定义渲染(submenuRender 字段)— Color swatch grid 等复杂内容用
 *
 * 注册原则:未实装的功能不注册(registry 里没该 item → ⠿ 菜单不显示)。
 * "占位项" / "暂未实现"概念已废弃。
 */

import type { ReactNode } from 'react';

export interface HandleVisibilityContext {
  /** 当前 block 节点的 type name(如 'paragraph' / 'heading' / 'bulletList')*/
  blockType: string;
  /** 当前 block 节点的 attrs(给 visibleWhen 判断 isTitle / level / indent 等)*/
  blockAttrs: Record<string, unknown>;
}

/**
 * Submenu 自定义渲染上下文(submenuRender 收到)— 含 block 信息 + close 回调。
 *
 * 关键:blockPos 是 handle 触发那一刻的瞬时值,通过这里传给 submenu 内组件,
 * 不污染 popup-controller 匿名契约(后者只管 anchor + id)。
 */
export interface HandleSubmenuContext {
  blockType: string;
  blockAttrs: Record<string, unknown>;
  /** PM doc 中的 block pos(driver block-scoped API 用)*/
  blockPos: number;
  /** view id(driver 调用必传)*/
  viewId: string;
  /** 关闭整个 handle 菜单(submenu 内部操作完后调)*/
  close: () => void;
}

export interface HandleItem {
  id: string;
  /** 显示标签(可含图标前缀,但建议用 icon 字段)*/
  label: string;
  /** 图标(emoji 或单字符)— 渲染时显示在 label 前 */
  icon?: string;
  /**
   * 命令 ID(commandRegistry)— 子菜单容器项可不带 command(只展开 submenu)
   *
   * **占位项**:command 留空字符串 ''(渲染时按钮 disabled,显示 "暂未实现")
   */
  command: string;
  view?: string;
  /** 关联的 block 类型(已有,可选)*/
  blockType?: string;
  /** 分组 — group 切换时插分隔符(L5-B3.9)*/
  group?: string;
  order?: number;
  /**
   * 子菜单 ID — 设置则此 item 是 submenu 容器(右侧显 ▸)
   *
   * 配套 submenuOf:子菜单的子项设 submenuOf 指回父 ID。
   */
  submenuId?: string;
  /**
   * 该 item 属于哪个 submenu(submenuId 引用)
   *
   * 不设时是顶层 item;设了表示渲染在指定子菜单内,顶层菜单不显示。
   */
  submenuOf?: string;
  /**
   * 条件显示:返回 false 不渲染此项(对齐 V1 Format ▸ 只在 indent attr 时显示)
   *
   * ctx.blockType / ctx.blockAttrs 由 HandleMenuBinding 在 show 时填入。
   */
  visibleWhen?: (ctx: HandleVisibilityContext) => boolean;
  /**
   * Submenu 自定义渲染函数(submenuId 设置时可选)。
   *
   * 设置则 submenu 容器内不走默认 button 列表(按 submenuOf 收集),
   * 而是调本函数取得 ReactNode 渲染(Color swatch grid 等复杂内容用)。
   *
   * 收 HandleSubmenuContext:含 blockPos / blockType / blockAttrs / viewId / close。
   * 内部组件调 driver block-scoped API 后调 ctx.close() 关闭整个 handle 菜单。
   */
  submenuRender?: (ctx: HandleSubmenuContext) => ReactNode;
}
