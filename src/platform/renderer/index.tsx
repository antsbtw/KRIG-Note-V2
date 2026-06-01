/**
 * V2 Renderer 进程入口
 *
 * L0 阶段:占位组件 "L0+L1 alive"(已废弃)
 * L2 阶段:Shell 框架 = WorkspaceBar + WorkspaceContainer
 * L3 阶段:接入 WorkspaceManager + 持久化 + 实例渲染(本阶段)
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceBar } from '@shell/workspace-bar/WorkspaceBar';
import { WorkspaceContainer } from '@shell/workspace-container/WorkspaceContainer';
import { FullscreenOverlayContainer } from '@shell/fullscreen-overlay/FullscreenOverlayContainer';
import { GlobalProgressOverlay } from '@shell/global-progress-overlay/GlobalProgressOverlay';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
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
import '@capabilities/text-editing';   // W5 C4 新增
import '@capabilities/learning';        // L5-B3.20a 新增(无 view 直接消费需显式拉,P1 审计修正)
import '@capabilities/ebook-library';   // L5-C1 新增(view install 声明 + 显式拉副作用,对齐 P1 审计模式)
import '@capabilities/bookmark';         // web view 书签树(书签步骤1 数据层:显式拉副作用注册 capability)
import '@capabilities/ebook-rendering'; // L5-C2(pdfjs-dist 4.9.155),自带 pdf-viewer 依赖
import '@capabilities/graph-library-store'; // L5-G1 新增(graph 画板列表 + 文件夹,JSON 起步)
import '@capabilities/shape-library';       // L5-G2 新增(Shape + Substance 资源仓库,0 import three)
import '@capabilities/canvas-rendering';    // L5-G3 新增(Three.js 单点屏障核心,P1-1 严格屏障)
import '@capabilities/canvas-text-node';    // L5-G4.5 新增(画板文字节点 PM 桥接 + EditOverlay,路径 A 嵌 text-editing.Host)
import '@capabilities/code-editing';        // Phase 1A 新增(CM6 单点屏障,封装 @codemirror/* + @lezer/*;mermaid 全屏 Phase 2 接入)
import '@capabilities/graph-layout';        // Phase 1B 新增(ELK 单点屏障,封装 elkjs + @mermaid-js/layout-elk;mermaid + 未来画板/BPMN/Mind/知识图谱共用)
import '@capabilities/math-rendering';      // math-visual Phase 1A 新增(Mafs + mathjs + @cortex-js/compute-engine 单点屏障)
import '@capabilities/note';                // L7-sub2 新增(note CRUD via IPC bridge,decision 012)
import '@capabilities/folder';              // L7-sub2 新增(folder CRUD via IPC bridge,decision 012)
import '@capabilities/thought';             // 横切思考层(thought-view-port.md v0.5)
import '@capabilities/ai-extraction';       // feature/ai-view:V1 web-bridge AI 自动化 → V2 横切 capability(原 ai-conversation,2026-05-19 改名)

import '@views/note';   // L5-A:NoteView self-register(触发 viewType / commands / NavSide 注册)
import '@views/web';    // L5-B4:WebView self-register
import '@views/web/translate-view'; // L5-B4.2:TranslateWebView self-register(隐式 view,通过 WebToolbar 翻译按钮触发)
import '@views/ebook';  // L5-C1:EBookView self-register
import '@views/ai';     // feature/ai-view:AI View self-register(NavSide tab 🤖 order=4)
import '@views/graph-canvas-view'; // L5-G1:GraphCanvasView self-register(D-1=A 命名)
import '@views/thought'; // 横切思考层 NavSide 主舞台 self-register
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
//
// **扩展模式**(不覆盖):各 capability(如 shape-library)启动副作用可能已经在
// `window.__krig` 上挂了自己的 dev 桥;这里 spread 现有对象保留它们,只追加 wm / bus.
// 修法对齐 L5-G2 shape-library 实施时发现的初始化顺序 bug — capability import 顺序
// 早于本段,如果这里硬赋值会抹掉 capability 设的桥.
if (import.meta.env.DEV) {
  const win = window as unknown as { __krig?: Record<string, unknown> };
  win.__krig = {
    ...(win.__krig ?? {}),
    wm: workspaceManager,
    get bus() {
      const id = workspaceManager.getActiveId();
      return id ? workspaceManager.getBus(id) : undefined;
    },
  };
}

/**
 * 订阅 fullscreenOverlayController state — 用于 active 时隐藏 WorkspaceBar +
 * WorkspaceContainer(让 overlay 视觉独占 viewport,与 workspace 切换语义隔离)。
 */
function useFullscreenOverlayActive(): boolean {
  const [visible, setVisible] = useState(
    fullscreenOverlayController.getState().visible,
  );
  useEffect(() => {
    return fullscreenOverlayController.subscribe(() =>
      setVisible(fullscreenOverlayController.getState().visible),
    );
  }, []);
  return visible;
}

function App() {
  const fullscreenActive = useFullscreenOverlayActive();
  // active 时把 WorkspaceBar + WorkspaceContainer 隐藏 — 保留 DOM 与 state,
  // 仅视觉 hide(切回时所有 workspace / view 状态原样保留)
  const workspaceStyle = fullscreenActive ? { display: 'none' } : undefined;

  return (
    <div className="krig-app">
      <div className="krig-app__workspace-layer" style={workspaceStyle}>
        <WorkspaceBar />
        <WorkspaceContainer />
      </div>
      <FullscreenOverlayContainer />
      <GlobalProgressOverlay />
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
