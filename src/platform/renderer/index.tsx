/**
 * V2 Renderer 进程入口
 *
 * L0 阶段:占位组件 "L0+L1 alive"(已废弃)
 * L2 阶段:Shell 框架 = WorkspaceBar + WorkspaceContainer
 * L3 阶段:接入 WorkspaceManager + 持久化 + 实例渲染(本阶段)
 */

import { createRoot } from 'react-dom/client';
import { WorkspaceBar } from '@shell/workspace-bar/WorkspaceBar';
import { WorkspaceContainer } from '@shell/workspace-container/WorkspaceContainer';
import { reportL2Alive } from '@shell/diagnostics/L2-alive';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { localStoragePersistence } from '@workspace/persistence/local-storage';
import { reportL3Alive } from '@workspace/diagnostics/L3-alive';
import { reportL4Alive } from '@slot/diagnostics/L4-alive';
import { reportRendererAlive } from './diagnostics/renderer-alive';
import './app.css';

// L3 启动:配置持久化 + 加载已存的 Workspaces + 确保至少一个
workspaceManager.setPersistence(localStoragePersistence);
workspaceManager.loadFromPersistence();
workspaceManager.ensureMinimum();

function App() {
  return (
    <div className="krig-app">
      <WorkspaceBar />
      <WorkspaceContainer />
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
  reportRendererAlive();
  reportL2Alive();
  reportL3Alive(workspaceManager.count, workspaceManager.getActiveId());
  reportL4Alive();
}
