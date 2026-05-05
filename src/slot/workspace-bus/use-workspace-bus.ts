/**
 * React 接入 — Context + hooks
 *
 * 见 PROTOCOL.md(三类管道)+ DESIGN.md § 3(API 形态)。
 *
 * 用法:
 *   // WorkspaceInstance 外层挂 Provider
 *   <WorkspaceBusContext.Provider value={bus}>
 *     ...
 *   </WorkspaceBusContext.Provider>
 *
 *   // view/capability 内
 *   const bus = useWorkspaceBus();
 *   const selection = useChannel<NoteSelectionPayload>('note.selection.changed');
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { WorkspaceBus } from './workspace-bus';

export const WorkspaceBusContext = createContext<WorkspaceBus | null>(null);

/** 拿当前 Workspace 的 bus 实例 — 必须在 Provider 内调用 */
export function useWorkspaceBus(): WorkspaceBus {
  const bus = useContext(WorkspaceBusContext);
  if (!bus) {
    throw new Error(
      '[bus] useWorkspaceBus called outside <WorkspaceBusContext.Provider>',
    );
  }
  return bus;
}

/**
 * 订阅 channel,自动用 lastValue 初始化。
 *
 * useSyncExternalStore 友好:getLastValue 返回 Map.get 稳定引用,无死循环
 * (与 L3 / L4 经验一致)。
 */
export function useChannel<T = unknown>(channel: string): T | undefined {
  const bus = useWorkspaceBus();
  return useSyncExternalStore(
    (cb) => bus.channels.subscribe(channel, cb as (payload: unknown) => void),
    () => bus.channels.getLastValue(channel) as T | undefined,
  );
}
