# triggers — 集中触发逻辑

V1 教训:右键 / Slash / hover / 选区检测散落各 view 自己写。
V2 改进:**集中在此**,view 不写触发逻辑(charter § 1.4 view 极轻)。

## 架构

```
DOM 事件(右键 / 输入 / hover / 选区)
    ↓ 监听
trigger hook(本目录)
    ↓ 调
controller.show(x, y, viewId, ...)
    ↓ 状态变化触发订阅
binding(frame-bindings/)→ 渲染浮层
```

## L4 阶段实施

| Trigger | 完整度 | 说明 |
|---|---|---|
| useContextMenuTrigger | ✅ 完整 | 监听右键 + 选区检测 + clickOutside / Escape 关闭 |
| useSlashTrigger | 🟡 仅 controller API | 完整触发依赖具体编辑能力(text-editing 等),L5 接入 |
| useHandleTrigger | 🟡 仅 controller API | 同上 |
| useFloatingToolbarTrigger | 🟡 仅 controller API | 同上 |

L5 view 实施时,各 capability 调对应 controller.show / hide。
