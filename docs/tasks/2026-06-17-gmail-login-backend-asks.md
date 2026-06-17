# 给后端的问题：Electron 桌面端 Gmail 登录契约确认

> **日期**：2026-06-17
> **背景**：KRIG-Note 要加 Gmail（Google）登录。后端已就绪（`POST /api/v1/auth/google`，与 Apple 对称，注册+登录合一）。但后端给的对接指南是按 **Web 前端**写的（`device_type:'web'`、GSI `<script>`、`app_source:'web'`），而 **KRIG-Note 是 Electron 桌面 app（跨平台 Windows + macOS）**。桌面端拿 Google ID Token 的流程和 Web 完全不同，动代码前需确认下面几点。

## 为什么桌面端不能照 Web 指南做

- 后端要的是 **Google ID Token**。Web 用 `accounts.google.com/gsi/client` 弹窗直接回调拿到。
- **Electron 不能在嵌入式 webview / BrowserWindow 里直开 Google 登录页**——Google 反钓鱼策略会以 `disallowed_useragent` 拒绝。
- 桌面端标准做法：`shell.openExternal` 打开**系统默认浏览器**授权 → 客户端起**本地回环服务器**（`http://127.0.0.1:<port>`）接回调 → 拿到 `code` 或 `id_token`。

这套流程引出下面必须由后端确认的问题。

## ⚠️ Q1. 桌面端拿到 id_token 后，是不是还是 POST /api/v1/auth/google？

指南说「前端拿 id_token 直接 POST /auth/google」。请确认：
1. 桌面端走「系统浏览器 + loopback 回调」拿到 **id_token** 后，**接口和请求体是否与 Web 完全一致**（即仍 `POST /auth/google` `{id_token, device, app_source}`）？还是桌面有别的入口？
2. 如果桌面 loopback 流程拿到的是 **`code`（authorization code）而非 id_token**，后端能否提供「code 换 token」的接口？还是要求客户端自己用 code 向 Google 换 id_token 再 POST？
   - （这取决于你们注册的 Google OAuth Client 类型，见 Q2）

## ⚠️ Q2. client_id：桌面端要用哪个？后端白名单加了吗？

后端校验 id_token 的 `aud` 必须命中 `GOOGLE_CLIENT_IDS`（config.go:133-136）。桌面端的坑：
1. Google OAuth Client 分类型：**Web application** vs **Desktop app** vs **iOS/Android**。桌面 Electron 通常用 **Desktop app** 类型的 Client ID（走 loopback），它和 Web 的 client_id **不是同一个**。
2. 请确认：**生产 auth-service 的 `GOOGLE_CLIENT_IDS` 里，是否已包含一个可用于 KRIG-Note 桌面端的 Client ID？** 如果没有：
   - 谁来在 Google Cloud Console 建这个 Desktop/Web Client ID？
   - 建好后加进后端 `GOOGLE_CLIENT_IDS`（生产改配需你们操作）。
3. Windows 和 macOS 是否可共用同一个 Desktop Client ID？（通常可以，但请确认后端 `aud` 校验不卡平台。）

## Q3. app_source 填什么？

指南示例 `app_source:'web'`。但 KRIG-Note 邮箱登录这边一直用 **`app_source:'krig-note'`**（归因的根，后端已认）。请确认 Google 登录也应填 **`krig-note`**（保持归因一致），而不是 `web`。

## Q4. device_type

桌面端 `device.device_type` 填 **`macos` / `windows`**（与现有邮箱登录一致），不是指南示例的 `web`。确认后端 `/auth/google` 接受这两个值。

## 客户端这侧已确定的（供你们对齐）

- 复用现有 `auth-client`/`auth-store`/`auth-service` 架构：Google 登录成功后拿到的 AuthResponse（access/refresh/user）与邮箱登录**完全同款**，存盘、refresh、登出逻辑全复用，不新增。
- 登录入口加到现有 LoginScreen（「用 Google 登录」按钮）。
- `device`/`app_source` 由客户端主进程组装（renderer 不碰），与邮箱登录一致。

## 优先级

| 项 | 优先级 | 说明 |
|---|---|---|
| Q1 桌面端流程（id_token vs code） | **P0** | 决定客户端 OAuth 流程怎么写 |
| Q2 桌面 client_id + 后端白名单 | **P0** | 不配好，后端校验 `aud` 必拒 |
| Q3 app_source | P1 | 归因一致性 |
| Q4 device_type | P1 | 确认接受 macos/windows |

请按 P0 先回 Q1/Q2。拿到后客户端照现有 7 阶段同款方式落地（类型→主进程 OAuth 流程→preload→LoginScreen 入口）。

---

## 附：读完你们《认证接入契约》后的精确追问（2026-06-17）

已读你们的《认证接入契约 · 所有客户端必读》（2026-06-04，§10 更新到 06-08）。它解决了：
- ✅ `device_type` 含 `macos`/`windows`（Q4）。
- ✅ Google 走 `POST /auth/google`、AuthResponse 同款、refresh/错误码契约清晰。
- ✅ §10 确认 Google 真机登录 200、`GOOGLE_CLIENT_IDS` 已配。

**但有两个针对 Electron 桌面的点，那份契约（面向 iOS/Android/Web）没覆盖，仍需你们确认：**

### 追问 1（最关键，原 Q1）：Electron 桌面怎么拿到 `id_token`？
契约 §4 写「发起 Google Sign-In → 拿到 id_token → 调接口」——这对 iOS/Android（原生 SDK）、Web（GSI 弹窗）成立。**但 Electron 桌面没有官方 Google Sign-In SDK**，且 Google 禁止在嵌入式 webview 走 OAuth（`disallowed_useragent`）。桌面唯一标准路是「系统浏览器 + 本地回环(loopback)回调」，而 **Google 的 Desktop/loopback 流程默认返回 `code`（authorization code），不是 `id_token`**。把 code 换成 id_token 需要 client_secret 调 Google token endpoint——client_secret 不应放客户端。

> **问：这个事实下，你们建议哪条路？**（我们倾向听你们的，因为你们更清楚 client_secret/client_id 配置现状）
> - **A.** 客户端把 loopback 拿到的 **`code`** 发给后端，**后端**用 client_secret 换 id_token（或直接换 token）→ 走现有 `/auth/google` 逻辑。需要你们加一个接口/参数（如 `/auth/google` 支持传 `code` + `redirect_uri`，或新增 `/auth/google/desktop`）。**client_secret 留后端，客户端零密钥，最安全。**
> - **B.** 客户端用 **Desktop OAuth + PKCE**（无 client_secret）自己换到 id_token，再 POST 现有 `/auth/google`。不改后端，但需确认下面追问 2 的 client_id。
>
> 请告诉我们 A / B 哪条，以及对应要你们做什么。

### 追问 2（原 Q2）：`GOOGLE_CLIENT_IDS` 里有没有「桌面端可用」的 client_id？
§10 说清单已配，但**没说里面那些是不是桌面端的**。Google client_id 分类型（Web / Desktop / iOS / Android），且你们说「Google 无安全前缀只能枚举」——所以桌面端用的 client_id **必须被显式加进 `GOOGLE_CLIENT_IDS`**，不会自动通过。
> **问：现有 `GOOGLE_CLIENT_IDS` 是否已含一个可用于 KRIG-Note 桌面（Win+Mac）的 client_id？** 若无：谁在 Google Cloud Console 建（Desktop 或 Web 类型，取决于追问 1 选 A/B）？建好后由你们加进清单（生产改配走 `deploy.sh`）。

### 追问 3（原 Q3 的出入）：`app_source` 能不能用 `krig-note`？
契约 §2.3 把 `app_source` 枚举写成 `otun｜obox｜web`，**没有 `krig-note`**。但我们邮箱登录一直传 `app_source:'krig-note'`（之前确认「无白名单直接传、落 users.app_source 归因」）。
> **问：`krig-note` 是合法 `app_source` 吗？** Google 登录应传 `krig-note` 还是 `web`？两边要一致，否则 KRIG 用户归因筛不出来。

### 已注意到的坑（无需回答，我们会照做）
- §10：`Authorization` 头只加一次 `Bearer `（避免 `Bearer Bearer`）——我们现有实现已是单前缀。
- §3：Apple 隐私邮箱、`user.email` 可空——本期不接 Apple，但记下了。

请按追问 1/2 优先回（决定客户端 OAuth 流程 + 是否改后端）。
