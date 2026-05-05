/**
 * V2 Renderer 进程入口
 *
 * L2 阶段:渲染 Shell(WorkspaceBar + WorkspaceContainer)
 *
 * 按 charter § 6.3 阶段递进:
 * - L0 阶段:占位组件 "L0+L1 alive"(已废弃)
 * - L2 阶段:Shell 框架 = WorkspaceBar + WorkspaceContainer(本阶段)
 * - L3 阶段:Shell 内挂 Workspace 实例
 */

import { createRoot } from 'react-dom/client';
import { WorkspaceBar } from '@shell/workspace-bar/WorkspaceBar';
import { WorkspaceContainer } from '@shell/workspace-container/WorkspaceContainer';
import { reportL2Alive } from '@shell/diagnostics/L2-alive';
import { reportRendererAlive } from './diagnostics/renderer-alive';
import './app.css';

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
}
