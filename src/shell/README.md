# src/shell — Shell 层(L2 三栏布局 + Slot 容器)

> **纵向类目**:可视化层(L2 部分)
> **横向 L 层**:L2 Shell
> **当前状态**:⏸️ 待启用,L2 阶段实施时填充

---

## 该层做什么

三栏布局骨架(TopBar / LeftSlot / MainSlot / RightSlot)+ Slot 容器机制 + 窗口可拖拽分隔线。

详细说明见 [docs/00-architecture/charter.md § 2.2 横向 L0~L5 / L2 Shell](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ❌ 0 处业务 npm 包 import(prosemirror / three / pdfjs / 等)
- ❌ 0 处 `import 'electron'`(Electron API 必须经能力层封装)
- ✅ 允许 import:react / clsx / 等纯函数白名单
- ✅ 允许 import:`@capabilities/`(通过入口)/ `@semantic/` / `@shared/` / `@slot/`(Slot Registry)

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待 L2 阶段实施时设计。预期结构:

```
src/shell/
├── three-column-layout/    (三栏布局 React 组件)
└── slot-system/            (Slot 容器机制)
```

---

## V1 学习参考

V1 Shell 实现混合在 `src/main/window/shell.ts`(652 行)+ `src/renderer/shell/`。混合 L1(BrowserWindow)+ L2(Shell 视图)+ L4(Slot)+ L5(WorkMode 切换)。

V2 拆分:
- L1 BrowserWindow → `src/platform/main/window/`
- L2 Shell 视图(React 组件)→ `src/shell/`(本目录)
- L4 Slot Registry → `src/slot/`
- L5 视图实例化 → 由 L4 Slot 系统 + L5 视图自注册完成

---

## 下一步

L2 阶段(L0+L1 完成后):
1. 写 `src/shell/DESIGN.md`
2. 实施三栏布局 + Slot 容器
3. 验证 npm start 看到三栏 + 可拖拽分隔线
