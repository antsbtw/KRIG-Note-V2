# overlay-frames — 浮层 mount 点(式样)

按 charter § 1.4 + view-hierarchy-v2.md § 6:

- 所有 Overlay 都归 Workspace Container(无"全局浮层"特例)
- 5 大交互(ContextMenu / Slash / Handle / FloatingToolbar)+ 通用 Overlay 各自一个 Frame
- L3 提供式样,L4 Registry 注册内容,L5 view 触发显示

## 文件清单

| Frame | 用途 |
|---|---|
| `ContextMenuFrame.tsx` | 右键菜单容器 |
| `SlashMenuFrame.tsx` | Slash 命令菜单容器 |
| `HandleMenuFrame.tsx` | Handle 菜单容器 |
| `FloatingToolbarFrame.tsx` | 选区上方浮动工具条容器 |
| `GenericOverlayFrame.tsx` | 通用浮层容器(帮助 / dialog / 进度等) |
| `index.tsx` | 集合,渲染所有浮层 |

## L3 阶段状态

5 个 Frame 都是 null 占位(等 L4 Registry)。
