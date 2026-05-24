/**
 * ContextMenu 类型
 *
 * EnabledWhen 重构(handoff: docs/tasks/context-menu-registry-handoff.md):
 * - 字面变 string,L4 不知道有哪些值
 * - 由 enabledWhenRegistry 提供 predicate 判定
 * - 找不到 predicate → fallback () => true(warn 去重)
 *
 * builtin(L4 自管,通用 DOM 概念):
 * - 'always'         总是显示
 * - 'has-selection'  选区非空(光标态隐藏)
 * - 'is-editable'    点击位置在可编辑区域
 *
 * 业务 enabledWhen(各 capability / view 注册):
 * - text-editing capability:'has-link' / 'has-marks' / 'has-block-selection'
 * - thought capability:'has-thought'
 * - (未来)ebook view:'has-pdf-annotation'
 *
 * 注册位置:capability/index.ts(随 capability 加载)/ view/index.ts(view self-register)。
 */
export type EnabledWhen = string;

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
   * 内部组件调 driver block-scoped API 时,instanceId 走
   *   ctx.contextInfo.custom.pmInstanceId
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
 * - 通过 ContextInfo.custom.pmInstanceId 暴露 PM 实例 id(右键触发瞬间快照,避免
 *   focus 转向菜单后 query 失败)。
 */
export interface ContextSubmenuContext {
  /** 触发时的 view id */
  viewId: string;
  /** 触发瞬间的 context info(含 custom.pmInstanceId / x / y / hasSelection 等) */
  contextInfo: ContextInfo;
  /** 关闭整个 context menu(submenu 内部操作完后调) */
  close: () => void;
}

/**
 * Base ContextInfo:L4 字面知道的通用 DOM 概念,不含任何 capability / view 业务字段。
 *
 * 业务字段全部进 ContextInfo.custom,由 contextInfoProviderRegistry 注册方贡献。
 */
export interface BaseContextInfo {
  /** DOM Selection 非空 */
  hasSelection: boolean;
  /** target 是 contentEditable / INPUT / TEXTAREA */
  isEditable: boolean;
  /** 鼠标位置 */
  x: number;
  y: number;
}

/**
 * 触发时的上下文信息(用于 enabledWhen 判断 + 命令 handler 取业务字段)。
 *
 * 字段分层:
 * - 顶层 4 个 base 字段:L4 通用 DOM 概念
 * - custom:各 contextInfoProvider 贡献的业务字段(如 thoughtId / pmInstanceId /
 *   hasLink / hasMarks / hasBlockSelection / pdfAnnotationId 等)
 *
 * 消费方约定:命令 handler / submenuRender 取业务字段走
 *   ctx.context.custom.<field> as <T>
 * (custom 字段类型为 unknown,消费方自己 type guard;未来 v1.x 可考虑 generic 模板)
 */
export interface ContextInfo extends BaseContextInfo {
  /** 各 contextInfoProvider 注册方贡献的字段(handoff §目标架构 / §字段迁移清单)*/
  custom: Record<string, unknown>;
}
