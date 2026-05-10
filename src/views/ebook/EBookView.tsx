/**
 * EBookView — view 主组件(L5-C1 骨架)
 *
 * **本段(C1)只到这一步**:订阅 per-ws activeBookId,显示空状态 / 加载占位。
 * C2 阶段接入 ebook-rendering capability 的 Host(PDF Canvas 渲染)。
 *
 * 见 docs/RefactorV2/v1-ebook-migration-plan.md v0.3 § 5 C1。
 *
 * LOC 红线(v0.3 § 3.1):≤150~200 行。本 C1 骨架 ~80 行,远低于红线。
 *
 * 注意点:
 * - 0 业务 npm import(eslint 拦)
 * - capability 通过 requireCapabilityApi 间接路由(C1 暂时不消费,但 C2 起会用)
 * - per-ws 状态走 pluginStates['ebook-view'](D-2=A)
 */

import { useSyncExternalStore, useEffect, useState } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi, EBookLoadedInfo } from '@capabilities/ebook-library/types';
import { getEBookWsState } from './data-model';
import './ebook.css';

interface EBookViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function EBookView({ workspaceId }: EBookViewProps) {
  // 订阅当前 ws 的 activeBookId(per-workspace)
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getEBookWsState(ws) : null;
    },
  );

  // C1:监听 onBookOpened 推流(C2 接 Host 后由 Host 自管)
  // 这里仅打 console 验证 IPC 链路通,不实际加载渲染
  const [lastLoaded, setLastLoaded] = useState<EBookLoadedInfo | null>(null);

  useEffect(() => {
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    return library.onBookOpened((info) => {
      console.log('[ebook-view] onBookOpened:', info);
      setLastLoaded(info);
    });
  }, []);

  if (!wsState) {
    return <div className="krig-ebook-empty">Workspace 未就绪</div>;
  }

  const activeBookId = wsState.activeBookId;

  if (!activeBookId) {
    return (
      <div className="krig-ebook-empty">
        <div className="krig-ebook-empty-icon">📕</div>
        <div className="krig-ebook-empty-text">在左侧书架中选择电子书</div>
        <div className="krig-ebook-empty-hint">或点击 NavSide 顶部 + 导入</div>
      </div>
    );
  }

  // C2 起这里接 Host;C1 显占位
  return (
    <div className="krig-ebook-view" data-view-id="ebook-view">
      <div className="krig-ebook-view__placeholder">
        <div className="krig-ebook-view__placeholder-icon">📕</div>
        <div className="krig-ebook-view__placeholder-text">
          {lastLoaded ? `已加载: ${lastLoaded.fileName}` : 'Loading...'}
        </div>
        <div className="krig-ebook-view__placeholder-hint">
          C1 骨架:渲染引擎将在 C2 段接入(PDF / EPUB)
        </div>
      </div>
    </div>
  );
}
