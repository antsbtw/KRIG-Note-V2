/**
 * ContextMenu 类型
 */

/**
 * enabledWhen 枚举:
 * - 'always'         总是显示
 * - 'has-selection'  选区非空(光标态隐藏)
 * - 'is-editable'    点击位置在可编辑区域
 * - 'has-link'(L5-B3.15)选区上覆盖 link mark — "移除链接"等条件项用
 * - 'has-thought'    点击位置在 thought anchor 上(inline mark / block frame /
 *                    image node attr 三态任一)— "删除Thought" 条件项用
 * - 'has-marks'      选区上覆盖至少一个 mark — "移除格式" 条件项用(光标态/无 mark 选区隐藏)
 * - 'has-block-selection'  block / multi-block 选区(NodeSelection 或跨多 block 的 text 选区)
 *                    — "删除 Block" 条件项用;光标态 + 单 block 内文本选区隐藏
 *
 * 当 enabledWhen 不满足时:本 item 不渲染(对齐 V1 "条件显示"行为)。
 * 加新枚举时同步 use-context-menu-trigger 的 ContextInfo 计算逻辑。
 */
export type EnabledWhen =
  | 'always'
  | 'has-selection'
  | 'is-editable'
  | 'has-link'
  | 'has-thought'
  | 'has-marks'
  | 'has-block-selection';

export interface ContextMenuItem {
  id: string;
  label: string;
  /**
   * 字符串引用 commandRegistry。
   *
   * 子菜单容器项(submenuId 设置)可留空字符串 '' — 此时点击只展开 submenu,不触发命令;
   * 自定义渲染 submenu(submenuRender)由 submenu 内组件负责操作。
   */
  command: string;
  enabledWhen?: EnabledWhen;
  group?: string;
  order?: number;
  /** 关联的 view ID(undefined = 全局,所有 view 显示) */
  view?: string;
  /**
   * 子菜单 ID — 设置则此 item 是 submenu 容器(右侧显 ▸,hover 展开)
   *
   * 配套 submenuOf:子菜单的子项设 submenuOf 指回父 ID;或走 submenuRender 自定义渲染。
   * 语义对齐 handle-registry/handle-types.ts(2026-05-15 引入)。
   */
  submenuId?: string;
  /**
   * 该 item 属于哪个 submenu(submenuId 引用)
   *
   * 不设时是顶层 item;设了表示渲染在指定子菜单内,顶层菜单不显示。
   */
  submenuOf?: string;
  /**
   * Submenu 自定义渲染函数(submenuId 设置时可选)。
   *
   * 设置则 submenu 容器内不走默认 button 列表(按 submenuOf 收集),
   * 而是调本函数取得 ReactNode 渲染(Color swatch grid / FramePicker 等复杂内容用)。
   *
   * 收 ContextSubmenuContext:含 contextInfo / viewId / close。
   * 内部组件调 driver block-scoped API 时,instanceId 走 ctx.contextInfo.pmInstanceId
   * (右键触发瞬间快照,不再走 focus query)。
   */
  submenuRender?: (ctx: ContextSubmenuContext) => import('react').ReactNode;
}

/**
 * Context menu submenu 自定义渲染上下文(对齐 handle-types.ts HandleSubmenuContext)。
 *
 * 关键差异 vs HandleSubmenuContext:
 * - context 不带 blockPos(右键位置不一定对应单 block — 选区可能跨多块);
 *   pos 解析由 submenu 内组件按需用 contextInfo.x/y + driver.resolveBlockAt 取
 *   或走 driver.getSelectedTopLevelBlockPositions 跨多块。
 * - 直接暴露 pmInstanceId(右键触发瞬间快照,避免 focus 转向菜单后 query 失败)。
 */
export interface ContextSubmenuContext {
  /** 触发时的 view id */
  viewId: string;
  /** 触发瞬间的 context info(含 pmInstanceId / x / y / hasSelection 等) */
  contextInfo: ContextInfo;
  /** 关闭整个 context menu(submenu 内部操作完后调) */
  close: () => void;
}

/** 触发时的上下文信息(用于 enabledWhen 判断) */
export interface ContextInfo {
  hasSelection: boolean;
  isEditable: boolean;
  /** L5-B3.15:选区上是否覆盖 link mark(给"移除链接"条件项用) */
  hasLink: boolean;
  /** 选区上是否覆盖至少一个 mark — "移除格式"条件项用。
   *  来源:selection capability activeMarks 非空。光标态/无选区时 false。 */
  hasMarks: boolean;
  /** block / multi-block 选区(选区跨多个 block,或 NodeSelection)— "删除 Block"条件项用。
   *  来源:selection capability kind ∈ {'block','multi-block'}。光标态 + 单 block 内文本选区
   *  为 false(那种情况退格删字即可)。 */
  hasBlockSelection: boolean;
  /** thought-view:点击位置的 thought id(inline mark / block frame / image attr 任一)
   *  null = 不在 thought anchor 上;非空 = 用作 'has-thought' enabledWhen 判定 +
   *  传给 "删除Thought" 命令 handler。 */
  thoughtId: string | null;
  /** 右键触发时焦点 PM 实例 id(在 contextmenu 事件触发 / focus 转向菜单之前抓拍)。
   *  thought-view.add-from-note / ask-ai-from-note 等命令从 context menu 触发时,
   *  焦点已转向菜单,getFocusedInstanceId() 返 null;命令需从 controller.context
   *  拿本字段而非实时查 focus。null = 右键时本来就无 PM 实例聚焦。 */
  pmInstanceId: string | null;
  /** 鼠标位置 */
  x: number;
  y: number;
}
