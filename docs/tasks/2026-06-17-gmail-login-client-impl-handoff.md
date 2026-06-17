# 交接 prompt：KRIG-Note 桌面端 Gmail 登录（方案 B：PKCE + loopback）

> **⏸️ 状态：暂缓（2026-06-17 总指挥决定）。** 优先 Apple 商城发布，Google 登录这条线往后放。本文档保留备用，重启时从「重启前置」往下看。
> **自包含交接文档**，给实现新对话。**指挥/验收**：总指挥（审计，不写实现代码）。
> **日期**：2026-06-17
> **前置**：邮箱登录已完成并提交在 `feat/auth-login` 分支（commit `ab439e62`）。本次在其上加 Google 登录。

## ⏸️ 暂缓说明 + 重启前置（2026-06-17）

**为什么暂缓**：建独立 Google 项目 + 配/发布同意屏幕这套流程超出当前优先级；先做 Apple 商城发布，Google 登录之后再启。

**已确定但未执行的决定**：
1. **KRIG 用独立 Google 项目**（不搭 OTun-M 车）——同意屏幕要显示「KRIG Note」品牌，发布节奏自主。
   - ⚠️ 当前那个 Desktop client（`1062828599725-5fgpavco...`）是建在 **OTun-M** 项目里的，属「先试手」。重启时应在 **KRIG 独立 Google 项目** 里重新建 Desktop OAuth client，**那个旧 client_id 作废不用**。
2. 同意屏幕发布（Testing→Production）留到真放量前；测试期用「测试用户」名单即可（项目级、上限 100、不分平台）。

**重启这条线时的前置清单（按顺序）**：
1. 建 KRIG 独立 Google Cloud 项目 → 配 OAuth 同意屏幕（scope: `openid email profile`，显示 KRIG Note 品牌）。
2. 在该项目建 **Desktop app** 类型 OAuth client（redirect loopback）→ 拿新 client_id（+ client_secret，存好不入库）。
3. 把新 client_id 交后端追加进 `GOOGLE_CLIENT_IDS` + `deploy.sh`。
4. 测试期把测试者 Gmail 加进该项目「测试用户」。
5. 再按下方 §0–§8 实现客户端（方案 B 不变，后端契约不变）。

> 后端契约（方案 B、`/auth/google` 只收 id_token、`app_source=krig-note`、device_type macos/windows）**重启时仍有效**，无需再问后端。变的只是 client_id 要换成 KRIG 独立项目的。

## 0. 一句话

给 KRIG-Note（Electron，跨平台 Win+Mac）加 Google 登录：**主进程走 Desktop OAuth + PKCE + 系统浏览器 + 本地回环(loopback) 换到 `id_token` → POST 现有 `/api/v1/auth/google` → 复用现有 token 处理**。后端代码零改动。

## 1. 必读背景

- 方案选型已与后端敲定（见 [2026-06-17-gmail-login-backend-asks.md](./2026-06-17-gmail-login-backend-asks.md) + 后端回复）：**方案 B**。A（后端换 code）不可行——后端 `/auth/google` 只收 `id_token`、无 code 字段、生产 `GOOGLE_CLIENT_SECRET` 未配。
- 现有邮箱登录架构（复用，别重写）：`src/platform/main/auth/`（auth-config/auth-client/auth-store/auth-service）、`src/capabilities/auth/`（authStore/AuthGate/LoginScreen）。Google 登录成功后的 `AuthResponse` 与邮箱**完全同款**，存盘/refresh/登出/广播全复用。
- 设计总纲见 [authorization-management-design.md](../authorization-management-design.md)（本期只做登录+归因，无授权）。

## 2. 为什么是方案 B（别再考虑 A / webview）

- Electron 无官方 Google Sign-In SDK；Google 禁止在嵌入式 webview 走 OAuth（`disallowed_useragent`）。
- 桌面标准路：`shell.openExternal` 开**系统默认浏览器** → 本地回环服务器接回调。
- Desktop OAuth + **PKCE**（`code_verifier` 即凭证，无需 client_secret）+ `scope` 含 `openid` → token 响应**直接带 `id_token`**。

## 3. 后端契约（已实测，零改动）

```
POST https://portal.situstechnologies.com/api/v1/auth/google
{
  "id_token": "<PKCE 换到的 id_token>",
  "device": { "device_id": "<复用现有 device_id>", "device_type": "macos" | "windows" },
  "app_source": "krig-note"      // ⚠️ 必须 krig-note(不是 web),归因一致
}
→ 200 AuthResponse { access_token, refresh_token, expires_in, token_type, user }
```
- 后端 `aud` 精确匹配 `GOOGLE_CLIENT_IDS`（无前缀豁免）→ **桌面 client_id 必须在白名单**，否则 401 audience mismatch。
- 失败：401（token 无效/audience 不匹配）、其余按现有错误码契约。
- AuthResponse 与邮箱登录同款 → **复用 `auth-service` 的 persistSession + setAuthenticated + 广播**，不新增落盘/状态逻辑。

## 4. 实现要点（主进程为主，renderer 只加一个按钮）

### 4.1 OAuth 流程（主进程，新增模块如 `src/platform/main/auth/google-oauth.ts`）

1. 生成 PKCE：`code_verifier`（随机高熵串）+ `code_challenge = base64url(sha256(code_verifier))`。
2. 起本地回环服务器：`http.createServer` 监听 `127.0.0.1:0`（系统分配随机端口），拿到实际端口。
3. 拼授权 URL 并 `shell.openExternal`：
   `https://accounts.google.com/o/oauth2/v2/auth?client_id=<DESKTOP_CLIENT_ID>&redirect_uri=http://127.0.0.1:<port>&response_type=code&scope=openid%20email%20profile&code_challenge=<challenge>&code_challenge_method=S256&state=<随机 state>`
4. 浏览器授权后回调 `http://127.0.0.1:<port>/?code=...&state=...`：回环服务器收 `code`，**校验 state**（防 CSRF），给浏览器回一个「可关闭本页」的简单 HTML，然后关服务器。
5. 用 `code + code_verifier` POST `https://oauth2.googleapis.com/token`（`grant_type=authorization_code`、带 client_id、redirect_uri）→ 响应含 **`id_token`**。
   - ⚠️ **Google Desktop client 注意点**：纯 PKCE 理论上无需 client_secret，但 **Google 的 Desktop client 在 token 交换时可能仍要求带 `client_id`，且历史上某些配置要带一个「非保密的」client_secret**。以 Google 当前文档/实测为准；若 Google 要求带 client_secret，它对 Desktop client 不算真·机密（可打包进客户端），但**优先尝试纯 PKCE 不带 secret**。这点实现时实测确认，别假设。
6. 拿到 `id_token` → 调 `authService.loginWithGoogle(idToken)`。

### 4.2 auth-service / auth-client 扩展

- `auth-client.ts`：加 `googleLogin(idToken, device)` → POST `/auth/google`，返回 `AuthResponse`（复用现有 `rawRequest`/`parseJsonOrThrow`/错误映射）。mock 分支返回固定 AuthResponse。
- `auth-service.ts`：加 `loginWithGoogle(idToken)`：调 `clientGoogleLogin` → `persistSession(res)` → `setAuthenticated()`（**复用现有方法，不新写落盘/广播**）。device/app_source 由 `buildDeviceInfo()` + 常量组装（与邮箱登录同源）。
- 配置：`auth-config.ts` 加 `GOOGLE_DESKTOP_CLIENT_ID`（来自 Google Console，**做成配置/常量，可后填**；未配时 Google 登录按钮禁用 + fail loud 提示「未配置」）。

### 4.3 IPC + preload + UI

- channel：`AUTH_GOOGLE_LOGIN: 'auth.google-login'`。
- handler：`AUTH_GOOGLE_LOGIN` → `authService.loginWithGoogle` 编排（OAuth 流程在主进程跑）；fail loud `{ok, error}`。
- preload：`authGoogleLogin(): Promise<AuthActionResult>`。
- LoginScreen：加「用 Google 登录」按钮，调 `authStore.googleLogin()`；成功后 main 广播 AUTH_CHANGED → AuthGate 自动切走（与邮箱同链路）。失败 fail loud 显示。

## 5. 红线（违反即打回）

1. **token / id_token / code / code_verifier 绝不进 renderer**：整个 OAuth 流程在主进程；renderer 只点按钮、只拿 public AuthState。
2. **fail loud**：OAuth 取消/超时/换 token 失败/audience 401/未配 client_id → 明确报错，不静默。
3. **state 校验**：回环回调必须校验 `state`（防 CSRF）；只接受 `127.0.0.1`。
4. **复用现有 token 处理**：persistSession/setAuthenticated/广播/refresh/登出全复用，不新写。
5. `app_source='krig-note'`、`device_type` 按平台 `macos`/`windows`、单次 `Bearer ` 前缀。
6. **不引重型 OAuth npm 库**：用 Node 内置 `http`/`crypto` + `shell.openExternal` 即可；如确需库，先问总指挥（避免给桌面塞 web-only SDK）。
7. 回环服务器用完即关、端口随机、超时自动关（不长驻、不占固定端口）。

## 6. 验收

- mock 模式：`googleLogin` 返回固定 AuthResponse，跑通 UI 链路（按钮→authenticated→进工作区）。
- 真实模式（需 client_id 就绪 + 后端白名单）：端到端——点按钮→系统浏览器授权→loopback 收 code→换 id_token→POST /auth/google→200→进工作区。**若 client_id / 白名单未就位，先 mock + 打桩覆盖 OAuth 流程逻辑（PKCE 生成、state 校验、错误映射），并说明哪些是桩。**
- 错误映射测试：用户取消授权、state 不匹配、Google token 交换失败、后端 audience 401、未配 client_id。
- 红线自查：renderer 抓不到 token/code（grep + 审查）；OAuth 全在主进程。
- `tsc`=0、`eslint`=0、auth 测试全绿。
- `app_source='krig-note'` 真在 `/auth/google` 请求体（测试断言）。

## 7. ⚠️ 前置依赖（不在你手里，总指挥推进）

- **Desktop OAuth client_id**：总指挥在 Google Cloud Console 建 Desktop app 类型 client（redirect_uri loopback）→ 交后端加进 `GOOGLE_CLIENT_IDS` + `deploy.sh`。
- **此前真实端到端跑不通**：client_id 未就绪/未加白名单时，后端 `aud` 必拒。所以**真实端到端列为待 client_id 就绪后做**；代码侧（PKCE/loopback/错误映射）先用 mock + 打桩完成并交审计。`GOOGLE_DESKTOP_CLIENT_ID` 做成配置项，最后填。

## 8. 交付方式

- 建议分两步：**(A) 主进程 OAuth 流程 + auth-client/service 扩展 + IPC/preload（mock + 打桩测试）** 先交审计；放行后 **(B) LoginScreen 按钮接入 + 真实端到端（待 client_id）**。
- 在 `feat/auth-login` 分支上继续（邮箱登录已在此）。
- 未经总指挥确认不 push / 不部署。
- 文档与代码现状矛盾以代码为准并指出。
- 边界仅限 Google 登录；遇 Apple/授权/计费等停下问总指挥。
