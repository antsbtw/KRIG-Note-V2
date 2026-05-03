# src/platform — L0 应用层 + L1 窗口层

> 横向 L0~L1 入口:Electron 进程入口 + 主窗口管理 + IPC 总线

---

## 当前状态

⏳ **L0 阶段实施中**。

**已就位**:目录骨架(main/ + renderer/)+ DESIGN.md 草稿。

**待实施**:Electron 启动 + 主窗口创建 + 自我诊断。

---

## 该层做什么

平台层包含 V2 的**应用栈底座**——任何上层(L2 Shell / L3 Workspace / L4 Slot / L5 View)都依赖这一层。

| 子模块 | 职责 |
|---|---|
| `main/` | Electron 主进程入口(app 生命周期 + 主窗口创建 + IPC 总线 + 自我诊断) |
| `renderer/` | Electron renderer 入口(React mount + renderer 自我诊断) |

---

## 屏障约束

- ✅ `main/` 允许 import Electron 主进程 API(app / BrowserWindow / ipcMain 等)
- ✅ `renderer/` 允许 import 浏览器 API(React / DOM)
- ❌ `main/` 不能 import `renderer/` 代码(进程隔离)
- ❌ 不允许 import 业务 npm 包(prosemirror / three / pdfjs 等)——业务代码在能力层
- ❌ 不允许 import `src/storage/` 内部细节——存储通过 IPC 暴露

详细见 [DESIGN.md](./DESIGN.md)。

---

## 与 V1 的关系

V1 入口在 [src/main/app.ts](../../docs/99-archive-v1/refactor/00-总纲.md)(282 行,做了太多事)——V2 platform 仅含**真正 L0+L1** 责任的代码。

详细对比与改进见 [DESIGN.md § 4](./DESIGN.md)。

---

## 下一步

- 写 DESIGN.md(本目录子结构 + V1 对比 + 改进点)
- 用户审阅 DESIGN.md
- 通过后实施代码(package.json + tsconfig + Electron 启动 + 主窗口 + 诊断)
