/**
 * pluginStates 操作 helper
 *
 * L5 view 通过这两个函数读写 pluginStates,例:
 *   const noteState = getPluginState<NoteState>(workspace, 'note');
 *   workspaceManager.update(workspace.id, {
 *     pluginStates: setPluginState(workspace, 'note', { activeNoteId: 'abc' }).pluginStates,
 *   });
 */

import type { WorkspaceState } from './workspace-state';

/** 读取某插件的 pluginState */
export function getPluginState<T>(state: WorkspaceState, plugin: string): T | undefined {
  return state.pluginStates[plugin] as T | undefined;
}

/** 更新某插件的 pluginState(返回新 WorkspaceState,不修改原状态)*/
export function setPluginState<T extends object>(
  state: WorkspaceState,
  plugin: string,
  partial: Partial<T>,
): WorkspaceState {
  const existing = (state.pluginStates[plugin] as object | undefined) ?? {};
  return {
    ...state,
    pluginStates: {
      ...state.pluginStates,
      [plugin]: { ...existing, ...partial },
    },
  };
}
