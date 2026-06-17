# 交接 prompt：KRIG-Note 客户端「注册 + 登录 + 测试期授权」实现

> **这是一份自包含的交接文档**，给一个全新对话（无本次设计上下文）照着实现客户端代码。
> **指挥/验收**：总指挥（出此文档 + 做审计验收，不写实现代码）。
> **你（实现方）的角色**：按本文档逐阶段实现客户端，每阶段自验后交回，由总指挥审计。
> **日期**：2026-06-16

---

## 0. 你要做什么（一句话）

为 KRIG Note V2（Electron + React + TS）实现最小授权链路：**用户能注册/登录 → 客户端查到「一年免费授权(grant)」→ 全功能可用 + 显示「测试版·剩余 N 天」**。功能分档、购买、Apple 登录**本期都不做**。

## 1. 必读的既有文档（按顺序读，别跳）

1. [authorization-management-design.md](../authorization-management-design.md) — 总设计。重点：§二·补（测试期 grant 策略 + 为什么到期记后端）、§三（信任边界：客户端门控是软态非安全边界）、§五（核心模型）、§六（登录流程 + 真实字段）、§七（grant 优先判定）、§八（门控收口）、§九（session 安全）。
2. [2026-06-16-auth-register-test-grant-impl-plan.md](./2026-06-16-auth-register-test-grant-impl-plan.md) — **实现计划，你的主蓝图**。§1 是后端真实契约、§3 文件清单、§4 channel、§5 关键实现、§6 分步顺序、§7 验证、§8 风险。
3. [KRIG_NOTE_AUTH_AND_BILLING_SUPPORT.md](../KRIG_NOTE_AUTH_AND_BILLING_SUPPORT.md) — 后端授权/计费背景（订阅是下一期，本期只看登录部分）。

读完三份你应理解：本期=grant 兜底全免费；客户端门控**搭好不开闸**；token 只在主进程。

## 2. 后端契约（已核实代码 + 已部署，照此对接）

**登录**（`portal.situstechnologies.com` + `/api/v1/auth/*`，prod 域名先用；dev 域名后端待补，不阻塞）：
- ⚠️ 字段坑（务必照真值）：验证码字段 **`code`**（非 verification_code，6 位）；**`device` 嵌套对象** `{device_id, device_type:'macos'|'windows', device_name?, fingerprint?}`；**`app_source` 顶层** = `'krig-note'`；token 有效期读响应 `expires_in`（别硬编码）；`X-Request-ID` 不强制（非幂等键）。
- 两步注册：`POST /auth/code {email, purpose:'register'}` → `POST /auth/register {email, password(min8), code, device, app_source, referral_code:''}`。
- 登录：`POST /auth/login {email, password, device, app_source}`。
- 刷新：`POST /auth/refresh {refresh_token}` —— **轮换式：旧 refresh 作废，必须存新返回的**。
- AuthResponse（注册/登录/刷新通用）：`{access_token, refresh_token, expires_in:86400, token_type:'Bearer', user:{id, email, source, role, email_verified, created_at}}`。失败 `{error, message}` + HTTP 状态码。
- refresh 失败判据：HTTP 401 = 重新登录；网络/5xx = 可重试。

**grant**（已部署）：
```
GET /api/v1/me/grants/krig-note   (Authorization: Bearer <access_token>)
→ 200 { "app":"krig-note", "grant":{
    "active":true, "issuedAt":<ms>, "expiresAt":<ms>,
    "durationDays":365, "signature":"base64", "alg":"Ed25519" } }
无 grant: { "active":false, "durationDays":365 }  (issuedAt/expiresAt=0)
```
- `active` 后端读时算（`now < expiresAt`）。`expiresAt = issuedAt + durationDays`，后端改配置可回溯。
- **本期不验签**（signature 字段先忽略，但 `auth-types` 里保留它）。下期再消费。验签方法（备查，本期不写）：raw 32B 公钥套 SPKI DER 前缀 `302a300506032b6570032100`，`crypto.verify(null, Buffer.from('krig-note|'+userId+'|'+issuedAt), key, sig)`；总指挥已用样例验通。

## 3. 集成点（已核实，行号可能微漂，按符号定位）

- **IPC 注册聚合**：[src/platform/main/ipc/ipc-bus.ts](../../src/platform/main/ipc/ipc-bus.ts) `initIpcBus()` —— 仿其他 `register*Handlers()` 加一行 `registerAuthHandlers()`。
- **启动序列**：[src/platform/main/index.ts](../../src/platform/main/index.ts) —— `initStorage()`(~116) → handlers → `registerFrameworkMenus()`(~180) → `createMainWindow()`(~183)。在建窗口前 `await authService.restore()`（但**不要阻塞窗口太久**，见 §5.2 实现计划：窗口照常起，AuthState 初始 `loading`，restore 完广播）。
- **HTTP 范式**：抄 [src/platform/main/extraction/upload-service.ts](../../src/platform/main/extraction/upload-service.ts) 的 electron `net.request` 写法（headers→write→end、累积 response、401 清 token）。**但 base URL 用自己的 `auth-config.ts`，不要复用 extraction/config.ts**（那是另一个后端 192.168.x）。
- **renderer 根**：[src/platform/renderer/index.tsx](../../src/platform/renderer/index.tsx) `App()`(~110) 里 `<WorkspaceBar/><WorkspaceContainer/>` —— 用 `<AuthGate>` 包住（loading→占位 / 未登录→LoginScreen / 已登录→工作区）。
- **channel 名**：[src/shared/ipc/channel-names.ts](../../src/shared/ipc/channel-names.ts) `IPC_CHANNELS` 对象（`as const`，SCREAMING_SNAKE→kebab 值）追加 `AUTH_*`。
- **preload**：[main-window-preload.ts](../../src/platform/main/preload/main-window-preload.ts) 一个大对象字面量，camelCase 方法，追加 auth 方法块。
- **renderer 类型**：[src/shared/ipc/electron-api.d.ts](../../src/shared/ipc/electron-api.d.ts) `Window.electronAPI` 接口加 auth 方法签名。

文件清单与每文件职责见实现计划 §3，照建。

## 4. 分阶段交付（每阶段独立验证后交回总指挥审计，等放行再下一阶段）

> 阶段 1–6 用 mock 数据源（不依赖后端真实接口），阶段 7 接真实后端。

- **阶段 1（纯类型，零行为）**：`src/shared/auth/auth-types.ts` + `AUTH_*` channel 名 + `electron-api.d.ts` auth 签名。验收：`tsc` 编译通过，app 行为无变化。 ✅ **已完成并通过审计（2026-06-16）**。
- **阶段 2（主进程基建）**：`auth-config.ts`（`app.isPackaged` 切环境）+ `auth-client.ts`（net HTTP，含 mock 开关）+ `auth-store.ts`（safeStorage 加密落盘 `{userData}/krig-data/auth/session.json`）。验收：离线脚本能 mock 登录、加解密落盘读回、`safeStorage.isEncryptionAvailable()` 不可用时 fail loud。
- **阶段 3（主进程 auth 全通）**：`auth-service.ts`（login/register/logout/refresh/resolveAuth/getPublicState/subscribe，grant 优先逻辑见实现计划 §5.1）+ `auth-handler.ts` + ipc-bus 接线 + index.ts 启动 restore + preload 暴露。验收：DevTools 里 `window.electronAPI.authLogin(...)`（mock）能跑通、AUTH_CHANGED 广播到达。
- **阶段 4（登录 UI + gate）**：`src/capabilities/auth/` 的 `index.ts` + `use-auth-state.ts` + `AuthGate.tsx` + `LoginScreen.tsx`，renderer 根接入。**UI 形态见 §4b（总指挥已拍板）**。验收：能注册/登录（mock）、gate 硬挡正确切换、登录失败 fail loud 显示错误。
- **阶段 5（状态展示）**：`AuthStatusBadge.tsx`（「测试版·剩余 N 天」+ 登出），挂 WorkspaceBar **右端**（见 §4b）。验收：显示剩余天数、登出回 gate 且清 token。
- **阶段 6（门控管线，不开闸）**：给 `commandRegistry.register` 加可选第三参 `{feature?, locked?}`、`execute` 内同步查 `auth.canUse`（grant 期内恒 true）；`MenuItem`/`ViewDefinition` 加 `feature?`。加一个**开发模拟开关**（env 或内部菜单）模拟 free 态验证门控真的限制。验收：默认全功能、开发开关打开后受限命令被拦且 fail loud、关闭恢复。**注意：`commandRegistry.execute` 必须保持同步**（被 keymap/toolbar 同步调用），`canUse` 查本地 tier 快照不跨 IPC。
- **阶段 7（接真实后端）**：把 `auth-client` 的 mock 数据源换成真实 net 请求；端到端跑真实注册/登录/grant。验收：实现计划 §7 全部勾掉。

## 4b. 登录 UI 形态（总指挥已拍板，照此实现，勿自由发挥）

**两个不同的 UI，别混为一谈：**

| | 登录前（未登录 / token-expired） | 登录后（authenticated） |
|---|---|---|
| 形态 | **全屏 AuthGate · 硬挡** | **顶栏小徽章 AuthStatusBadge** |
| 位置 | 盖住整个窗口（居中登录卡片） | `WorkspaceBar` **最右端** |
| 行为 | **不登录不能用**——未登录绝不渲染工作区 | 不抢工作区空间 |
| 内容 | 邮箱 / 密码 / 6 位验证码表单，注册登录切换 | 「测试版 · 剩余 N 天」+ 邮箱/头像 + 登出 |

实现要点：
- **硬挡**：`AuthGate` 在 `status` 为 `anonymous`/`token-expired` 时**只渲染 LoginScreen**，不渲染 `<WorkspaceBar/><WorkspaceContainer/>`。`loading` 时渲染轻量占位（不闪登录页）。`authenticated` 才渲染工作区。
- **badge 放最右端**：`WorkspaceBar`（[src/shell/workspace-bar/WorkspaceBar.tsx](../../src/shell/workspace-bar/WorkspaceBar.tsx)）当前右端是空白（tabs 容器靠左）。给 badge 容器加 `margin-left: auto` 推到最右——这是桌面应用放账号信息的惯例，别紧挨左侧 logo（会和品牌/tabs 挤）。
- 为什么硬挡：后端要求免费档也登录、注册是授权兜底锚点，每个测试用户都须有账号 + grant；可跳过会让人拿不到 grant，违背初衷。

## 5. 红线 / 不变量（违反即打回，源于既有架构记忆）

1. **token 绝不进 renderer**：只在主进程 + safeStorage，renderer 只拿 public state（不含 token/refresh）。
2. **fail loud，不静默兜底**：登录失败、网络错、safeStorage 不可用都要明确报错，不 try/catch 吞掉（项目铁律）。
3. **`commandRegistry.execute` 保持同步**：别改成 async，否则破坏全量 keymap/toolbar 同步调用点。
4. **AUTH_CHANGED 多 ws 扇出守卫**：广播要遍历所有 webContents；renderer 监听加 active 守卫，避免一次登录触发 N 次重建（这是本项目已知 bug 家族）。
5. **冷启动别闪屏**：loading 态显示占位，不要「先渲染登录页再闪走」。
6. **不复用 extraction/config.ts 的后端地址**（那是 PDF 提取平台，非 auth portal）。
7. **本期不验签**：signature 字段保留在类型里但不消费；不要提前写验签逻辑（下期才做）。
8. **门控搭好不开闸**：阶段 6 的门控 grant 期内对真实用户零副作用，只在开发开关下可验。
9. **匹配既有代码风格**：channel 名 SCREAMING_SNAKE→kebab、preload camelCase、handler 仿现有 `register*Handlers` 范式、HTTP 仿 upload-service。

## 6. 授权边界（重要）

本交接的编码授权**仅限 KRIG-Note grant 这一具体改动**，**不外溢**到仍在设计期的统一积分/计费系统。遇到本期范围外的东西（订阅判定、购买、Apple 登录、积分），**停下来问总指挥**，不要自行扩展。

## 7. 交付方式

- 每阶段完成后：跑通该阶段验收、`tsc`/lint 绿、自测说明，交回总指挥审计；**等放行再下一阶段**。
- 不要一次性堆完 7 个阶段再交——逐阶段，便于审计定位。
- 未经总指挥确认**不要 push / 不要部署**。
- 如发现本文档与代码现状矛盾（如行号/符号对不上），以代码为准并在交付说明里指出，别硬套。
