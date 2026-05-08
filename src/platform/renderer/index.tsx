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
import { reportL3_5Alive } from '@slot/workspace-bus/L3.5-alive';
import { reportL4Alive } from '@slot/diagnostics/L4-alive';
import { reportL5Alive } from '@views/L5-alive';
import { reportInstallCoverage } from '@slot/diagnostics/install-coverage';
import { startKeymapListener } from '@slot/keymap-registry/keymap-listener';
import { reportRendererAlive } from './diagnostics/renderer-alive';
// W5:capability 显式 side-effect import — 触发各 capability 的
// capabilityRegistry.register 副作用(原本由 L5-alive 直 import 触发,L5-alive
// 改 getCapabilityApi 后 import 链断,需要在 renderer 显式拉)
import '@capabilities/selection';
import '@capabilities/clipboard';
import '@capabilities/undo-redo';
import '@capabilities/drag-and-drop';
import '@capabilities/insertion';
import '@capabilities/media-storage';
import '@capabilities/web-rendering';

import '@views/note';   // L5-A:NoteView self-register(触发 viewType / commands / NavSide 注册)
import '@views/web';    // L5-B4:WebView self-register
import '@views/web/translate-view'; // L5-B4.2:TranslateWebView self-register(隐式 view,通过 WebToolbar 翻译按钮触发)
import './app.css';

// L3 启动:配置持久化 + 加载已存的 Workspaces + 确保至少一个
workspaceManager.setPersistence(localStoragePersistence);
workspaceManager.loadFromPersistence();
workspaceManager.ensureMinimum();

// L3.5 启动:为活跃 Workspace 创建 bus(lazy 创建,首个 getBus 调用触发)
// 这里主动调一次,让 alive 计数 >= 1
const _activeId = workspaceManager.getActiveId();
if (_activeId) workspaceManager.getBus(_activeId);

// dev-only:DevTools 调试钩子 — 让 `window.__krig.bus` / `__krig.wm` 直接可用
// Vite 在 prod build 时会 dead-code eliminate 整段(import.meta.env.DEV === false)。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__krig = {
    wm: workspaceManager,
    get bus() {
      const id = workspaceManager.getActiveId();
      return id ? workspaceManager.getBus(id) : undefined;
    },
  };
}

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
  reportL3_5Alive(workspaceManager.busCount);
  reportL4Alive();
  reportL5Alive();
  // W4.1:启动全局 keymap 路由(view 通过 ViewDefinition.keymap 字段声明绑定)
  startKeymapListener();
  if (import.meta.env.DEV) {
    reportInstallCoverage();
  }
}
