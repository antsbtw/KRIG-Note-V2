/**
 * AI View NavSide 内容 — 四入口快速导航(Claude / ChatGPT / Gemini / X)
 *
 * 用户拍板:四个快速导航放在 navSide(而非 toolbar 下拉);toolbar 下拉仍只三家 AI。
 *
 * 点某入口 → setActiveLauncher(切 AIView 渲染的 webview)。
 * - 选 AI 服务:currentServiceId 跟着切,AIView 渲染 AI Host。
 * - 选 X:activeLauncher='x',AIView 渲染 x-extraction Host(铁律 3 独立路径)。
 *
 * 同时确保 AI view 在台上(主舞台或右槽);若当前不在,点入口顺手把 AI view 切上主舞台。
 */

import { useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useActiveWorkspaceId } from '@workspace/workspace-instance/use-workspace';
import { navSideRegistry } from '@slot/nav-side-registry/nav-side-registry';
import { AI_SERVICE_PROFILES } from '@shared/types/ai-service-types';
import { getXServiceProfile, DEFAULT_X_SERVICE } from '@shared/types/x-service-types';
import { getAIWsState, setActiveLauncher, type LauncherId } from './data-model';
import './ai.css';

const AI_VIEW_ID = 'ai-view';

/** 四入口 = 三家 AI + X */
const LAUNCHERS: Array<{ id: LauncherId; name: string; icon: string }> = [
  ...AI_SERVICE_PROFILES.map((p) => ({ id: p.id as LauncherId, name: p.name, icon: p.icon })),
  {
    id: 'x',
    name: getXServiceProfile(DEFAULT_X_SERVICE).name,
    icon: getXServiceProfile(DEFAULT_X_SERVICE).icon,
  },
];

function AILauncherPanel(): React.ReactElement {
  const wsId = useActiveWorkspaceId();

  // 订阅 activeLauncher(高亮当前入口)
  const activeLauncher = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      if (!wsId) return null;
      const ws = workspaceManager.get(wsId);
      return ws ? getAIWsState(ws).activeLauncher : null;
    },
  );

  const handlePick = (id: LauncherId): void => {
    if (!wsId) return;
    setActiveLauncher(wsId, id);
    // 确保 AI view 在台上(若当前主舞台不是 ai-view,切上来)
    const ws = workspaceManager.get(wsId);
    if (ws && ws.slotBinding.left !== AI_VIEW_ID && ws.slotBinding.right !== AI_VIEW_ID) {
      workspaceManager.update(
        wsId,
        {
          slotBinding: { left: AI_VIEW_ID, leftPayload: undefined, right: null, rightPayload: undefined },
        },
        { source: 'navside' },
      );
    }
  };

  return (
    <div className="krig-ai-launcher">
      {LAUNCHERS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`krig-ai-launcher__item${item.id === activeLauncher ? ' active' : ''}`}
          onClick={() => handlePick(item.id)}
          title={item.name}
        >
          <span className="krig-ai-launcher__icon">{item.icon}</span>
          <span className="krig-ai-launcher__label">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

export function registerAINavSide(): void {
  navSideRegistry.register({
    view: AI_VIEW_ID,
    title: 'AI',
    contentRenderer: () => <AILauncherPanel />,
  });
}
