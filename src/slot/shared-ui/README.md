# shared-ui — 框架层共用 UI 组件

跨 view 复用的 UI 组件,业务零知识。

| 组件 | 职责 |
|---|---|
| FolderTree | 通用树状列表(folder + item 两类节点、嵌套展开、拖拽、多选、键盘、inline rename);业务通过 itemMeta / contextMenuScope 提供数据和菜单 scope |
| ContextMenuPopover | 通用右键菜单浮层;边界自适应翻转、Esc/外部点击关闭、separator/disabled/icon 渲染 |

## 设计原则

- **业务零知识**:不出现 note / graph / ebook 等业务字眼
- **强制统一布局**:item 行 [icon][title][rightHint],folder 行 [▶/▼][📁/📂][title]
- **不允许业务接管行渲染**:无 renderItem / renderFolder 逃生口
- **菜单走 registry**:contextMenuScope 字段查 folderTreeContextMenuRegistry,业务通过注册扩展菜单项

## 视觉常量

V1 同款,集中在各组件 styles.ts:

| 常量 | 值 |
|---|---|
| TREE_ROW_HEIGHT | 28 |
| TREE_INDENT_PX | 16 |
| 行字色 | #ccc |
| hover 背景 | rgba(255,255,255,0.05) |
| selected 背景 | rgba(74,144,226,0.25) |
| dropTarget 背景 | rgba(74,144,226,0.18) + dashed outline |
| 菜单背景 | rgba(30,30,30,0.98) |
