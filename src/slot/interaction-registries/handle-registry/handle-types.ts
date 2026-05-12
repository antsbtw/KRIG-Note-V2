/** Handle 菜单类型(块手柄)
 *
 * L5-B3.11:加 visibleWhen / icon / submenuOf 支持子菜单 + 条件显示(对齐 V1)
 */

export interface HandleVisibilityContext {
  /** 当前 block 节点的 type name(如 'paragraph' / 'heading' / 'bulletList')*/
  blockType: string;
  /** 当前 block 节点的 attrs(给 visibleWhen 判断 isTitle / level / indent 等)*/
  blockAttrs: Record<string, unknown>;
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
}
