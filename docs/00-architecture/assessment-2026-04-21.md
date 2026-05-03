# KRIG-Note 分层原则符合性评估报告

- 评估日期：2026-04-21
- 评估范围：`/Users/wenwu/Documents/VPN-Server/KRIG-Note`
- 评估方式：文档原则对照 + 代码静态抽样审查（只读）

---

## 1. 评估目标

本报告用于回答以下问题：

1. 当前代码实现是否遵循项目既定的构建原则。  
2. 尤其是是否满足“分层单向依赖、下层不干预上层业务”。

---

## 2. 评估依据

### 2.1 原则文档

- `principles.md`（分层、注册制、框架与插件分离）
- `ui-framework/view.md`（View 不知道 Slot/对面 View）
- `ui-framework/view-protocol.md`（协议由框架路由与注入）
- `ui-framework/workspace.md`（Workspace 作为调度单元）

### 2.2 对照关键原则（摘要）

1. 单向依赖：上层依赖下层，下层不感知上层。  
2. 层间契约：通过接口通信，不直接操作上层编排。  
3. View 不知道 Slot，不知道对面 View。  
4. 协议关系由框架注入，View 只收发消息。  
5. 注册即生效，新增能力尽量不改框架骨架。

---

## 3. 总体结论

结论：**部分符合，但未严格符合**。  

当前项目已具备较好的分层雏形（目录分层、main 路由转发、插件化组织），但在关键边界上存在越层现象，尤其是：

1. View 层直接感知并操控 Slot/WorkMode。  
2. 协议行为大量落在 View 内部实现，未形成“框架协议层注入”。  
3. 新增能力仍需改动 `main/app.ts`、`main/window/shell.ts` 与构建配置，不满足“注册即生效”的理想状态。

---

## 4. 详细发现（按严重度）

## 4.1 P1：View 层干预上层编排（违反“下层不干预上层业务”）

原则要求：

- `ui-framework/view.md` 明确“View 不知道 Slot”“View 不知道对面”。

证据：

- `src/main/preload/view.ts` 暴露 `openRightSlot/ensureRightSlot/getMySlotSide` 给 View。  
- `src/plugins/note/components/NoteView.tsx` 基于 `getMySlotSide()` 做左/右行为分叉。  
- `src/plugins/web/components/WebToolbar.tsx` 直接触发 `ensureRightSlot('web-translate')`。

影响：

1. View 从“内容单元”上升为“编排参与者”，边界模糊。  
2. 后续替换/复用 View 时，会被当前 Shell/Slot 语义耦合。  
3. 难以保证编排策略统一演进（策略散落在各 View）。

---

## 4.2 P1：协议逻辑下沉到 View 内，框架协议层不足

原则要求：

- `ui-framework/view-protocol.md`：协议是 View 关系，不属于单个 View；由框架查表并注入行为。

证据：

- `src/shared/types.ts` 中 `ProtocolRegistration` 仅有 `id + match`，无 `behaviors` 抽象。  
- `src/plugins/web/components/WebView.tsx` 内部直接处理大量协议动作（`SYNC_ACTION.*`）。

影响：

1. 协议能力不可复用，逻辑分散在多个 View。  
2. 新协议扩展时需要修改多个 View，实现成本高且易回归。  
3. 与文档定义的“框架层可插拔协议”偏差较大。

---

## 4.3 P2：注册制不彻底，新增能力仍需改框架骨架

原则要求：

- `principles.md`：注册即生效，尽量不修改框架代码。

证据：

- `src/main/app.ts` 集中注册 WorkMode/NavSide/Protocol，且直接绑定插件侧钩子。  
- `src/main/window/shell.ts` 维护 `viewTypeRenderers` 映射，新增视图类型需改该映射。  
- `forge.config.ts` 的 renderer/preload 入口需手工维护。

影响：

1. 插件扩展仍然依赖主框架改动，边界不稳定。  
2. 框架文件膨胀，成为演进瓶颈。

---

## 4.4 P3：接口契约中混入 Electron 细节，抽象层穿透

证据：

- `src/shared/types.ts` 的 `WorkModeRegistration.onViewCreated` 直接暴露 Electron `WebContentsView/WebContents` 类型。

影响：

1. 共享契约层与 Electron 运行时强耦合。  
2. 降低未来替换实现或做更纯净分层测试的可能性。

---

## 5. 正向观察（已做对的部分）

1. 目录分层总体清晰：`main / plugins / renderer / shared`。  
2. View 间通信经 main 路由，方向正确。  
3. WorkMode / NavSide / Protocol 已有注册表雏形。  
4. 大量基础安全项已配置（多处 `contextIsolation: true`, `nodeIntegration: false`）。

---

## 6. 整改建议（分阶段）

## 6.1 第一阶段（先止血，1-2 周）

1. 从 `viewAPI` 下线编排接口：`openRightSlot/ensureRightSlot/getMySlotSide`。  
2. 将“打开右槽/选择 WorkMode”改为意图事件（intent），由 Workspace/Shell 决策。  
3. 对现有协议行为建立 `ProtocolBehavior` 抽象，先迁移 `web-translate` 一条链路。

验收标准：

- View 不再直接调用 Slot 编排 API。  
- 协议动作至少一类由框架层驱动，View 仅处理内容事件。

## 6.2 第二阶段（结构化整改，2-4 周）

1. 拆分 `main/app.ts` 中的注册职责，改为插件清单自动注册。  
2. 去除 `window/shell.ts` 中硬编码 `viewTypeRenderers`，改为注册发现机制。  
3. 将 `shared/types` 中 Electron 类型下沉到 main 侧适配层。

验收标准：

- 新增一个 ViewType/WorkMode 不修改核心框架文件。  
- `shared` 层不直接依赖 Electron 具体类型。

## 6.3 第三阶段（稳态治理）

1. 增加分层规则检查（静态规则或 lint 约束）。  
2. 为协议层和编排层补充最小自动化测试。  
3. 在 PR 模板中加入“分层边界自检”清单。

---

## 7. 本次评估引用的关键代码位置

- `src/main/preload/view.ts`
- `src/plugins/note/components/NoteView.tsx`
- `src/plugins/web/components/WebToolbar.tsx`
- `src/plugins/web/components/WebView.tsx`
- `src/shared/types.ts`
- `src/main/app.ts`
- `src/main/window/shell.ts`
- `forge.config.ts`

---

## 8. 最终判断（针对问题原句）

对“代码是否遵循构建原则，尤其分层原则，下层不干预上层业务”的判断：

**当前不完全遵循；在关键路径上存在下层干预上层业务的情况，需要按上文分阶段整改。**

