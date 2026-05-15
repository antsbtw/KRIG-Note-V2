/**
 * GraphCanvasView self-register 入口
 *
 * 见 docs/RefactorV2/v1-graph-migration-plan.md v0.2 § 6.1 +
 * docs/RefactorV2/stages/L5G1-graph-platform-and-skeleton-design.md v0.3。
 *
 * import 时触发副作用:
 * - registerView(声明 graph-canvas-view + install 4 项 capability,P1-A 口径)
 * - registerGraphCanvasCommands(注册 graph-canvas-view.* 命令)
 * - registerNavSide(NavSide 内容 + 画板列表面板)
 * - registerFolderTreeContextMenu(scope='graph-canvas-view' 右键菜单项)
 *
 * **view-id 选定**:`graph-canvas-view`(用户拍板 D-1=A,2026-05-10,对齐 V2
 * 既有 note-view / ebook-view / web-view 命名惯例)。
 *
 * **install 列表 = 声明性契约(P1-A 修订,对齐 plan v0.2 § 6.1)**:
 *
 * install 是"view 最终需要哪些 capability"的契约,**不**是"已就绪"声明。
 * G1~G3 阶段后三项 capability 尚未注册,install-coverage 会报 warning
 * (`missing: shape-library, canvas-rendering, canvas-text-node`)— 这是
 * 预期状态,**不阻塞验收**(install-coverage 是 dev-only 告警)。
 *
 * 各 capability 归位渐次完成:
 * - G1:`graph-library-store`     画板 + 文件夹列表 + CRUD(已就位)
 * - G2:`shape-library`           Shape + Substance 资源仓库
 * - G3:`canvas-rendering`        Three.js Host(单点屏障核心)
 * - G4:`canvas-text-node`        文字节点 PM 桥接
 *
 * **navSideTab.order=4**:Note=1 / eBook=2 / Web=3 / **Graph=4**(决策 G1-2)
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { GraphCanvasView } from './GraphCanvasView';
import { registerGraphCanvasCommands } from './canvas-commands';
import {
  registerNavSide,
  registerFolderTreeContextMenu,
} from './nav-side-content';

const VIEW = 'graph-canvas-view';

registerView({
  id: VIEW,
  install: [
    'graph-library-store', // ✅ L5-G1:画板 + 文件夹 + CRUD(JSON 起步)
    'shape-library',       // 🚧 L5-G2:Shape + Substance 资源仓库
    'canvas-rendering',    // 🚧 L5-G3:Three.js Host(P1-1 单点屏障)
    'canvas-text-node',    // ✅ L5-G4.5:文字节点 PM 桥接(text-editing.Host 嵌入,路径 A)
  ],
  component: GraphCanvasView,
  navSideTab: { label: 'Graph', icon: '🎨', order: 4 },
});

registerGraphCanvasCommands();
registerNavSide();
registerFolderTreeContextMenu();

// canvas-text-node popup 编辑器(viewId='graph-canvas-view')自注册 PM 通用菜单
// 见 docs/refactor/stages/04-lift-pm-editing-to-capability/c8-d-c-design.md(方案 A)
// 注:7 业务插入(image/table/...)留 NoteView,画板文字节点无此语义
function registerTextEditingMenusForCanvas(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui;
  floatingToolbarRegistry.register([
    ...ui.floatingToolbar.createMarkButtons(VIEW),
    ui.floatingToolbar.createMathButton(VIEW),
    ui.floatingToolbar.createLinkButton(VIEW),
    ui.floatingToolbar.createColorButton(VIEW),
  ]);
  slashRegistry.register([
    ...ui.slashMenu.createTurnIntoItems(VIEW),
    ui.slashMenu.createMathBlockItem(VIEW),
  ]);
}

registerTextEditingMenusForCanvas();
