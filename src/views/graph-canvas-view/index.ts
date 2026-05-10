/**
 * GraphCanvasView self-register 入口(L5-G1)
 *
 * 见 docs/RefactorV2/v1-graph-migration-plan.md v0.2 +
 * docs/RefactorV2/stages/L5G1-graph-platform-and-skeleton-design.md v0.1。
 *
 * import 时触发副作用:
 * - registerView(声明 graph-canvas-view + install: ['graph-library-store'];
 *   shape-library / canvas-rendering / canvas-text-node 留 G2~G4 加进 install)
 * - registerGraphCanvasCommands(注册 graph-canvas-view.* 命令)
 * - registerNavSide(NavSide 内容 + 画板列表面板)
 * - registerFolderTreeContextMenu(scope='graph-canvas-view' 右键菜单项)
 *
 * **view-id 选定**:`graph-canvas-view`(用户拍板 D-1=A,2026-05-10,对齐 V2
 * 既有 note-view / ebook-view / web-view 命名惯例;v0.2 plan 字面 `graph-canvas`,
 * 实施时微调,与 ebook v0.3 → 实施 `ebook-view` 是同样路径)。
 *
 * **install 列表(G1)**:
 * - `graph-library-store`:画板 + 文件夹列表 + CRUD(L5-G1)
 *
 * **后续 G 段加入 install**:
 * - G2:`shape-library`(Shape + Substance 资源仓库)
 * - G3:`canvas-rendering`(Three.js Host)
 * - G4:`canvas-text-node`(文字节点 PM 桥接)
 *
 * **navSideTab.order=4**:Note=1 / eBook=2 / Web=3 / **Graph=4**(决策 G1-2)
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { GraphCanvasView } from './GraphCanvasView';
import { registerGraphCanvasCommands } from './canvas-commands';
import {
  registerNavSide,
  registerFolderTreeContextMenu,
} from './nav-side-content';

registerView({
  id: 'graph-canvas-view',
  install: [
    'graph-library-store', // L5-G1:画板 + 文件夹 + CRUD(JSON 起步)
  ],
  component: GraphCanvasView,
  navSideTab: { label: 'Graph', icon: '🎨', order: 4 },
});

registerGraphCanvasCommands();
registerNavSide();
registerFolderTreeContextMenu();
