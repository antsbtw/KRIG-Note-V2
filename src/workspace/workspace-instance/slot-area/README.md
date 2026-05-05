# slot-area — 中央 Slot 区

按 charter § 1.4 + view-hierarchy-v2.md:

- L3 提供 Slot 容器 + Divider 拖拽机制(本目录)
- L5 view 通过 viewTypeRegistry 注册 + Slot 实例化时 mount

## 文件清单

| 文件 | 职责 |
|---|---|
| `SlotArea.tsx` | 中央 Slot 区根(Left + Divider + Right) |
| `LeftSlot.tsx` | 左 Slot 容器(L3 占位,L5 mount view) |
| `RightSlot.tsx` | 右 Slot 容器(可选) |
| `ResizableDivider.tsx` | 可拖拽分隔线(改 dividerRatio) |
| `slot-area.css` | 样式 |

## 模式

- 单视图模式:slotBinding.right === null,LeftSlot 全宽,无 Divider
- 双视图模式:slotBinding.right !== null,LeftSlot + Divider + RightSlot 按 dividerRatio 分配
- 拖拽限制:DIVIDER_RATIO_MIN ~ DIVIDER_RATIO_MAX(0.2 ~ 0.8)
