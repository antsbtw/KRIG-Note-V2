/**
 * EBookView self-register 入口(L5-C1)
 *
 * 见 docs/RefactorV2/v1-ebook-migration-plan.md v0.3。
 *
 * import 时触发副作用:
 * - registerView(声明 ebook-view + install: ['ebook-library'])
 * - registerEBookCommands(注册 ebook-view.* 命令)
 * - registerNavSide(NavSide 内容 + 书架面板)
 * - registerFolderTreeContextMenu(scope='ebook-view' 右键菜单项)
 *
 * **view-id 选定**:`ebook-view`(对齐 V2 既有 note-view / web-view 命名惯例)。
 * 注意:v0.3 文档 D-1 字面是 `ebook`,实施时确认 V2 实际 view-id 风格,
 * 微调为 `ebook-view`。已在 completion 报告登记说明。
 *
 * **install 列表**(C1 仅 ebook-library;C2 起追加 ebook-rendering):
 * - `ebook-library`:书架 + 文件夹 + 标注 + 数据传输(L5-C1)
 *
 * **navSideTab.order=2**:对齐 V1 demo-b 的 order;Note=1 / eBook=2 / Web=3
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { EBookView } from './EBookView';
import { registerEBookCommands } from './bookshelf-commands';
import { registerNavSide, registerFolderTreeContextMenu } from './nav-side-content';

registerView({
  id: 'ebook-view',
  install: [
    'ebook-library',  // L5-C1:书架 + 文件夹 + 标注 + 数据传输
    // C2 起追加:'ebook-rendering'
  ],
  component: EBookView,
  navSideTab: { label: 'eBook', icon: '📕', order: 2 },
});

registerEBookCommands();
registerNavSide();
registerFolderTreeContextMenu();
