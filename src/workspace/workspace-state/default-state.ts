/**
 * 默认 WorkspaceState 工厂
 */

import type { WorkspaceState } from './workspace-state';

/** 默认 NavSide 宽度(V1 沿用)*/
export const DEFAULT_NAVSIDE_WIDTH = 224;

/** 默认 dividerRatio */
export const DEFAULT_DIVIDER_RATIO = 0.5;

/** dividerRatio 拖拽限制范围 */
export const DIVIDER_RATIO_MIN = 0.2;
export const DIVIDER_RATIO_MAX = 0.8;

/** 创建默认 WorkspaceState */
export function createDefaultWorkspaceState(id: string, label: string, customLabel: boolean): WorkspaceState {
  return {
    id,
    label,
    customLabel,
    navSideCollapsed: false,
    navSideWidth: null,
    dividerRatio: DEFAULT_DIVIDER_RATIO,
    slotBinding: {
      left: null,
      right: null,
    },
    pluginStates: {},
    createdAt: Date.now(),
    isOpen: true, // 新建即在顶部 bar 打开
  };
}
