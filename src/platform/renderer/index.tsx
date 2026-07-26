/**
 * V2 Renderer 进程入口
 *
 * L0 阶段:占位组件 "L0+L1 alive"(已废弃)
 * L2 阶段:Shell 框架 = WorkspaceBar + WorkspaceContainer
 * L3 阶段:接入 WorkspaceManager + 持久化 + 实例渲染(本阶段)
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceContainer } from '@shell/workspace-container/WorkspaceContainer';
import { FullscreenOverlayContainer } from '@shell/fullscreen-overlay/FullscreenOverlayContainer';
import { GlobalProgressOverlay } from '@shell/global-progress-overlay/GlobalProgressOverlay';
import { AuthGate } from '@capabilities/auth/AuthGate';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
import { reportL2Alive } from '@shell/diagnostics/L2-alive';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { reportL3Alive } from '@workspace/diagnostics/L3-alive';
import { reportL3_5Alive } from '@slot/workspace-bus/L3.5-alive';
import { reportL4Alive } from '@slot/diagnostics/L4-alive';
import { reportL5Alive } from '@views/L5-alive';
import { reportInstallCoverage } from '@slot/diagnostics/install-coverage';
import { startKeymapListener } from '@slot/keymap-registry/keymap-listener';
import { reportRendererAlive } from './diagnostics/renderer-alive';
import { getActiveWorkspaceIdSync, onMyWsIdReady } from '@workspace/workspace-instance/use-workspace';
import { initNoteBaseSnapshotSync } from '@views/note/data-model';

// ── 系统主题同步（跟随 nativeTheme）──
// 初始用 matchMedia 快速设一次，再用主进程权威值覆盖（避免 Chromium matchMedia 与
// nativeTheme 不一致的情况，Windows 上尤为常见）。
// 后续变化由主进程 nativeTheme 'updated' 事件经 IPC 推送。
function applyTheme(dark: boolean): void {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
window.electronAPI?.getNativeTheme().then(({ dark }) => applyTheme(dark)).catch(() => {/* ignore */});
window.electronAPI?.onNativeThemeChanged(({ dark }) => applyTheme(dark));
import { registerNoteCommands } from '@views/note/note-commands';
import { registerWebCommands } from '@views/web/web-commands';
import { registerWebBookmarkCommands } from '@views/web/web-bookmark-commands';
import { registerEBookCommands } from '@views/ebook/bookshelf-commands';
import { registerAICommands } from '@views/ai/ai-commands';
import { registerXCommands } from '@views/x/x-commands';
import { registerXTestCommands } from '@views/x/x-test-commands';
import { registerGraphCanvasCommands } from '@views/graph-canvas-view/canvas-commands';
import { registerThoughtCommands } from '@views/thought/thought-commands';
// W5:capability 显式 side-effect import — 触发各 capability 的
// capabilityRegistry.register 副作用(原本由 L5-alive 直 import 触发,L5-alive
// 改 getCapabilityApi 后 import 链断,需要在 renderer 显式拉)
import '@capabilities/selection';
import '@capabilities/clipboard';
import '@capabilities/undo-redo';
import '@capabilities/drag-and-drop';
import '@capabilities/insertion';
import '@capabilities/media-storage';
import '@capabilities/font-storage';     // L5-G7:系统字体导入 + 嵌入(IPC 封装;node-toolbar 经 requireCapabilityApi 拿)
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
import '@capabilities/node-toolbar';        // L5-G5 新增(Graph 节点浮条,view-agnostic 注册式 section;与 canvas-rendering/Host 集成)
import '@capabilities/code-editing';        // Phase 1A 新增(CM6 单点屏障,封装 @codemirror/* + @lezer/*;mermaid 全屏 Phase 2 接入)
import '@capabilities/graph-layout';        // Phase 1B 新增(ELK 单点屏障,封装 elkjs + @mermaid-js/layout-elk;mermaid + 未来画板/BPMN/Mind/知识图谱共用)
import '@capabilities/math-rendering';      // math-visual Phase 1A 新增(Mafs + mathjs + @cortex-js/compute-engine 单点屏障)
import '@capabilities/note';                // L7-sub2 新增(note CRUD via IPC bridge,decision 012)
import '@capabilities/folder';              // L7-sub2 新增(folder CRUD via IPC bridge,decision 012)
import '@capabilities/thought';             // 横切思考层(thought-view-port.md v0.5)
import '@capabilities/ai-extraction';       // feature/ai-view:V1 web-bridge AI 自动化 → V2 横切 capability(原 ai-conversation,2026-05-19 改名)
import '@capabilities/x-extraction';        // X 集成 阶段 0/1:嵌 x.com webview + 右键提取推文 → tweetBlock(铁律 3 独立 capability)
import '@capabilities/import-orchestrator'; // 阶段 C:统一批量落库编排(markdown/PDF/剪藏三处 view 走 importDraftsToNotes)
import '@capabilities/content-extraction';  // 网页剪藏(Defuddle → Note);模块 load 即订阅 WEB_CLIP_RESULT 跑 import-pipeline
import '@capabilities/auth';                 // 授权:注册 auth capability(暴露 StatusBadge),模块 load 即挂 onAuthChanged 单订阅

import '@shell/slot-picker'; // 全局 SlotPicker popup 注册(right slot view 命令板)

import '@views/note';   // L5-A:NoteView self-register(触发 viewType / commands / NavSide 注册)
import '@views/web';    // L5-B4:WebView self-register
import '@views/web/translate-view'; // L5-B4.2:TranslateWebView self-register(隐式 view,通过 WebToolbar 翻译按钮触发)
import '@views/ebook';  // L5-C1:EBookView self-register
import '@views/ai';     // feature/ai-view:AI View self-register(NavSide tab 🤖 order=4)
import '@views/x';      // X 集成:注册 X 提取命令
import '@views/social'; // Social View self-register(NavSide tab 💬 order=6;含 X 平台)
import '@views/x-inbox'; // X Inbox View self-register(right slot，从 SocialView tabbar 触发)
import '@views/graph-canvas-view'; // L5-G1:GraphCanvasView self-register(D-1=A 命名)
import '@views/thought'; // 横切思考层 NavSide 主舞台 self-register
import './app.css';

// S3-a:ws 楼长状态由主进程管理，use-workspace.ts 的 ensureInit() 在首次 hook 调用时自动拉一次全量状态。
// 此处仍保留 getBus 初始化供 L3.5 alive 计数。

// Phase 1 多窗口 merge:订阅其他窗口写成功后的 blockHashes 基线广播（全局一次性）
initNoteBaseSnapshotSync();

// U1-c1-batch + 多窗口(S3-b):命令注册必须在本窗口 myWsId 确定后才能执行。
// 用 onMyWsIdReady 订阅——仅在本窗口 IPC 确认的 wsId 就绪后触发一次，
// 避免新窗口用 snapshot.activeId（ws-1）注册命令。
onMyWsIdReady((rendererWsId) => {
  registerNoteCommands(rendererWsId);
  registerWebCommands(rendererWsId);
  registerWebBookmarkCommands(rendererWsId);
  registerEBookCommands(rendererWsId);
  registerAICommands(rendererWsId);
  registerXCommands(rendererWsId);
  registerXTestCommands(rendererWsId);
  registerGraphCanvasCommands(rendererWsId);
  registerThoughtCommands(rendererWsId);
  // L3.5 bus 初始化(首次 wsId 就绪时补一次,确保 alive 计数 >= 1)
  workspaceManager.getBus(rendererWsId);
});

// L3.5 启动:为活跃 Workspace 创建 bus(lazy 创建,首个 getBus 调用触发)
// 这里主动调一次,让 alive 计数 >= 1(若 activeId 已同步就绪则立即触发)
const _activeId = getActiveWorkspaceIdSync();
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
      const id = getActiveWorkspaceIdSync();
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
      {/* AuthGate:未登录/loading 时只显登录页/占位,登录后才渲染工作区(包住全部 UI)*/}
      <AuthGate>
        <div className="krig-app__workspace-layer" style={workspaceStyle}>
          <WorkspaceContainer />
        </div>
        <FullscreenOverlayContainer />
        <GlobalProgressOverlay />
      </AuthGate>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
  reportRendererAlive();
  reportL2Alive();
  reportL3Alive(workspaceManager.count, null);
  reportL3_5Alive(workspaceManager.busCount);
  reportL4Alive();
  reportL5Alive();
  // W4.1:启动全局 keymap 路由(view 通过 ViewDefinition.keymap 字段声明绑定)
  startKeymapListener(workspaceManager.get.bind(workspaceManager));
  if (import.meta.env.DEV) {
    reportInstallCoverage();
  }
}
