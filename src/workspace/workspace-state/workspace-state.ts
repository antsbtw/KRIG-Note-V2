/**
 * WorkspaceState 类型定义
 *
 * 按 charter v0.4 § 1.1 强制规则 + V1 教训(memory project_active_resource_id_arch_debt):
 * - 业务字段全走 pluginStates(L5 view 自管理状态)
 * - WorkspaceState 仅含框架字段(身份 / NavSide / Slot 布局 / pluginStates)
 *
 * V2 vs V1 差异:
 * - 取消 V1 散落字段(activeNoteId / rightActiveNoteId / activeBookId / 等)
 * - 加 navSideCollapsed(替代 V1 navSideVisible,语义更精确)
 * - 加 pluginStates 字典
 * - 取消 V1 workModeId(charter § 1.4 取消 WorkMode 概念,用 viewType)
 */

/** Slot 装载形式 */
export interface SlotBinding {
  /** Workspace 左 Slot 装的 view ID(null = 空 Slot)*/
  left: string | null;
  /** 左 Slot 装载时的 payload(view mount 时作 prop 传入,可选)*/
  leftPayload?: unknown;
  /** Workspace 右 Slot 装的 view ID(null = 单视图模式)*/
  right: string | null;
  /** 右 Slot 装载时的 payload */
  rightPayload?: unknown;
}

/** 单 Workspace 完整状态 */
export interface WorkspaceState {
  /** 唯一标识(`ws-${counter}`)*/
  id: string;
  /** Tab 显示文字 */
  label: string;
  /** 是否用户自定义标签(false = 系统生成)*/
  customLabel: boolean;
  /** NavSide 折叠状态(true = 折叠隐藏)*/
  navSideCollapsed: boolean;
  /** NavSide 宽度(可拖拽,null = 用默认 224px)*/
  navSideWidth: number | null;
  /** Slot Area 内 Left/Right 比例(0~1,默认 0.5;限制 0.2~0.8)*/
  dividerRatio: number;
  /** Slot 装载形式 */
  slotBinding: SlotBinding;
  /** 业务字段全在这(L5 view 自管理) */
  pluginStates: Record<string, unknown>;
  /** 创建时间戳(ms)*/
  createdAt: number;
}

/** WorkspaceManager 整体状态(用于持久化)*/
export interface WorkspaceManagerState {
  workspaces: WorkspaceState[];
  activeId: string | null;
  counter: number;
}
