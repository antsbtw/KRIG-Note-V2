# view-switcher-frame/

NavSide 顶部固定区（应用级骨架）。

## 责任划分

- **Logo + 标题**:应用品牌（硬编码,不可注册）
- **View 切换 tab 条**:订阅 `viewTypeRegistry.getAllForNavSide()`,view 通过 `navSideTab` 字段贡献图标

## 与 NavSideFrame 的边界

| | ViewSwitcherFrame | NavSideFrame |
|---|---|---|
| 内容 | 应用品牌 + view tab 条 | 当前活跃 view 的 NavSide 内容 |
| 切 view | 不变(永远显示) | 整块换内容 |
| 注册源 | viewTypeRegistry | navSideRegistry |

## 切换语义

点击 tab → `workspaceManager.update(wsId, { slotBinding: { ...prev, left: viewId } })`。

约定:**主 view 在左 slot**,右 slot 用户自由组合（拖拽分屏时显式装载）。
