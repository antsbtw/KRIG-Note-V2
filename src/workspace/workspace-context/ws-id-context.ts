import { createContext, useContext } from 'react';

export const WorkspaceIdContext = createContext<string | null>(null);

/** 拿当前 Workspace 的 wsId — 必须在 Provider 内调用 */
export function useWsId(): string {
  const wsId = useContext(WorkspaceIdContext);
  if (!wsId) throw new Error('[ws] useWsId called outside <WorkspaceIdContext.Provider>');
  return wsId;
}
