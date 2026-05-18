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
  /** 字符串引用 commandRegistry */
  command: string;
  enabledWhen?: EnabledWhen;
  group?: string;
  order?: number;
  /** 关联的 view ID(undefined = 全局,所有 view 显示) */
  view?: string;
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
