# 实现计划：注册 + 登录 + 测试期授权（最小上线链路）

> **状态**：实现计划，待总指挥过目 → 批准后动手
> **日期**：2026-06-16
> **目标**：尽快上线「用户能注册/登录 → 拿到一年免费授权 → 全功能可用」的最小链路，供大众测试。功能分档、购买闭环**本期不做**（见 [feature-tier-decision-table.md](../feature-tier-decision-table.md) 与 [authorization-management-design.md](../authorization-management-design.md) §十 Phase 排序）。
> **关联**：设计文档 §二·补（测试期 grant 策略）、§五（核心模型）、§六（登录流程）。

---

## 0. 本期范围（明确边界）

**做**：
- 登录/注册 UI（邮箱方式优先；老用户直接登录）。
- 主进程 auth 模块：HTTP 客户端、token safeStorage 存取、状态管理、IPC。
- 启动恢复 session + 解析授权态（grant 优先）。
- 「测试版 · 免费授权剩余 N 天」状态展示。
- 门控管线**搭好但不开闸**（grant 期内恒全功能）——目的是让门控代码随测试版铺到所有用户机器（设计 §二·补 的关键前提）。

**不做（本期）**：
- 功能分档真实生效（`FEATURE_MIN_TIER` 留占位，不限制任何功能）。
- Stripe / Apple 购买闭环。
- Apple Sign-in（仅邮箱登录；除非后端三种方式里有更优的通用方式）。
- 设备数限制。

---

## 1. ⚠️ 阻塞项：需要后端先提供的东西

> **已与后端对齐（2026-06-16 后端回复）**，以下为**核过后端真实代码**的契约，开发以此为准。唯一待回：A4 dev portal 域名（不阻塞，mock 阶段不依赖）。

### 1.1 注册 / 登录 / Token 接口规格（已有，可直接对接）

Base：`https://portal.situstechnologies.com` + 相对路径，auth 在 `/api/v1/auth/*`（不直连 IP/端口）。`app_source=krig-note` 无白名单、直接传，**务必带**（归因）。`device_type` 合法值含 `macos`/`windows`。

**⚠️ 字段名以后端真值为准（之前需求稿写错了）**：
- 验证码字段是 **`code`** 不是 `verification_code`，且必须 **6 位**。
- **`device` 是嵌套对象**（`{ device_id, device_type, device_name?, fingerprint? }`），不是平铺。
- **`app_source` 是顶层字段**，不在 device 里。
- `X-Request-ID` 后端**不强制读取**（非幂等键），带上无害但不起作用；本期不依赖幂等。

```
// 前置:发验证码
POST /api/v1/auth/code
  { "email": "...", "purpose": "register" }   // purpose: register | reset_password | bind_email
  → 200 { "message": "verification code sent" }

// 注册
POST /api/v1/auth/register
  {
    "email": "...", "password": "...",        // password 必填 min=8
    "code": "123456",                          // 必填,6 位
    "device": { "device_id": "<uuid>", "device_type": "macos",
                "device_name": "...", "fingerprint": "..." },
    "app_source": "krig-note", "referral_code": ""
  }
  → 201 AuthResponse

// 登录(老用户)
POST /api/v1/auth/login
  { "email", "password", "device": {...}, "app_source": "krig-note" }
  → 200 AuthResponse

// 刷新(轮换式:旧 refresh 被撤销,必须存新返回的那个)
POST /api/v1/auth/refresh
  { "refresh_token": "..." }
  → 200 AuthResponse(含新一对 token)

// AuthResponse(注册/登录/刷新通用)
{
  "access_token": "eyJ...", "refresh_token": "uuid-...",
  "expires_in": 86400,                          // ⚠️ 按此读,别硬编码 24h
  "token_type": "Bearer",
  "user": { "id": "uuid", "email": "...", "source": "email",
            "role": "user", "email_verified": true, "created_at": "..." }
}
// 失败统一 { "error": "<code>", "message": "<可读>" } + HTTP 状态码(400/401/409...)
```

- **token**：access 24h（读 `expires_in`）、refresh 30d 轮换。认证请求统一 `Authorization: Bearer <access_token>`。
- **refresh 失败判据**：收到 HTTP 401（`{error,message}`）= 重新登录；收不到响应/5xx = 网络问题可重试。
- **同邮箱跨渠道合并**：对 krig-note 生效（auth 三层防重 apple_user_id>email>device_id），前端只要保证用户用同一邮箱。
- **A4 环境**：prod = `portal.situstechnologies.com`；dev 域名后端待回。客户端配 `PORTAL_BASE` 环境变量，按 `app.isPackaged` 切。

### 1.2 一年免费 grant 接口（后端实现中，契约已定）

**方案**：后端在 auth-service 旁加极简表 `app_grants(user_id, app, issued_at, ...)` + 独立查询接口（不走重的订阅链路）。

```
GET /api/v1/me/grants/krig-note          (需 Bearer)
→ 200
{
  "app": "krig-note",
  "grant": {
    "active": true,
    "expiresAt": 1830000000000,    // 毫秒时间戳;读时计算 now>expiresAt → active=false
    "issuedAt": 1798464000000,
    "signature": "<对 app|user_id|expiresAt 的签名>"   // 后端带上,本期客户端不验签
  }
}
```

**三项拍板（2026-06-16 总指挥定）**：
1. **独立接口**（非并进 profile）。
2. **后端带 `signature`，客户端本期不验签**——测试期全免费、离线伪造收益为零；验签逻辑（算法+公钥管理）留到下期计费上线、离线兜底有价值时实现。后端契约一步到位，客户端分期消费。
3. **回溯=读时计算**：到期判定 = `issued_at + 当前配置时长`，**不发放时写死 `expires_at`**。改时长配置自动对所有人（含老用户）生效——保留后端统一调控能力（本机制初衷）。后端可加「全局到期下限」防误缩短伤用户，但须保留「延长所有人」能力。
4. 发放时机：注册成功即发，老用户无 grant 时首次登录补发。无条件发给所有 `app_source=krig-note` 新账号，时长后端可配（默认 365 天）。

> mock 阶段照上述字段定形，`resolveAuth()` 返回固定「已登录 + grant active」，先把上层 UI/门控管线跑通；真实接口到了只替换 `auth-client` 的数据源，不动上层。

---

## 2. 架构总览（数据流）

```
[Renderer]                          [Main]                         [Portal 后端]
LoginScreen ──authLogin(email,..)──▶ auth-handler
                                      └▶ auth-service.login()
                                          └▶ auth-client (net.request) ───▶ /api/v1/auth/login
                                          ◀── { access_token, refresh_token, user } ──┘
                                      auth-store.save() (safeStorage 加密落盘)
                                      auth-service.resolveAuth()
                                          └▶ auth-client ───▶ 查 grant (/me 或 grant 接口)
                                          ◀── { grant.active, expiresAt } ──┘
                                      广播 AUTH_CHANGED ──────────────────▶ onAuthChanged
useAuthState (本地快照) ◀────────────────────────────────────────────────┘
  └▶ AuthGate 决定渲染 LoginScreen / 正常工作区
```

**关键不变量**（沿用既有架构与记忆）：
- token 只在主进程 + safeStorage，renderer 只拿 public state（不含 token）。
- `AUTH_CHANGED` 广播要遍历所有 BrowserWindow/webContents，renderer 监听加 active 守卫（防多 ws 扇出，[[project-host-broadcast-multi-ws-fanout]]）。
- fail loud：登录失败、网络错明确报错，不静默兜底（[[feedback-fail-loud-no-fallback]]）。

---

## 3. 文件清单（新增/改动）

### 3.1 shared（共享类型）
| 文件 | 动作 | 内容 |
|---|---|---|
| `src/shared/auth/auth-types.ts` | 新增 | `AuthStatus`、`PlanTier`、`AuthAccount`、`AuthState`（public，不含 token）、`AuthGrant` |
| `src/shared/ipc/channel-names.ts` | 改 | 新增 `AUTH_*` channel 常量（见 §4） |
| `src/shared/ipc/electron-api.d.ts` | 改 | `window.electronAPI` 加 auth 方法签名（~line 60） |

### 3.2 main（主进程 auth 模块）
| 文件 | 动作 | 内容 |
|---|---|---|
| `src/platform/main/auth/auth-config.ts` | 新增 | portal base URL，按 `app.isPackaged` 切 dev/prod（**独立于 extraction/config.ts**，那是另一个后端） |
| `src/platform/main/auth/auth-client.ts` | 新增 | 基于 electron `net` 的 HTTP 客户端，仿 `upload-service.ts` 风格；封装 Bearer、`X-Request-ID`、401→refresh 重试、JSON 解析、错误归一 |
| `src/platform/main/auth/auth-store.ts` | 新增 | `{userData}/krig-data/auth/session.json`，token 用 `safeStorage` 加密；save/load/clear |
| `src/platform/main/auth/auth-service.ts` | 新增 | `login/register/logout/refresh/resolveAuth/getPublicState/subscribe`；in-memory 持有当前 AuthState；`resolveAuth()` 实现 grant 优先逻辑（设计 §7.1） |
| `src/platform/main/ipc/auth-handler.ts` | 新增 | `registerAuthHandlers()`，注册 `AUTH_*` handlers + 广播 `AUTH_CHANGED` |
| `src/platform/main/ipc/ipc-bus.ts` | 改 | `initIpcBus()` 内加 `registerAuthHandlers()`（~line 35） |
| `src/platform/main/index.ts` | 改 | 启动序列在 `registerFrameworkMenus()`(180) 后、`createMainWindow()`(183) 前，`await authService.restore()` 恢复 session + resolveAuth |
| `src/platform/main/preload/main-window-preload.ts` | 改 | electronAPI 加 auth 方法（grouped 注释块） |

### 3.3 renderer（登录 UI + 状态）
| 文件 | 动作 | 内容 |
|---|---|---|
| `src/capabilities/auth/index.ts` | 新增 | renderer auth API 封装：`getState/login/register/logout/subscribe`，持本地 AuthState 快照 |
| `src/capabilities/auth/use-auth-state.ts` | 新增 | React hook，订阅 `onAuthChanged`，返回 `{ status, account, tier, grant }` |
| `src/capabilities/auth/AuthGate.tsx` | 新增 | 顶层 gate：未登录→LoginScreen，loading→轻量占位，已登录→children |
| `src/capabilities/auth/LoginScreen.tsx` | 新增 | 登录/注册表单（邮箱方式），调 `authLogin/authRegister`，fail loud 显示错误 |
| `src/capabilities/auth/AuthStatusBadge.tsx` | 新增 | 「测试版 · 免费授权剩余 N 天」+ 账号/登出入口；挂到 WorkspaceBar |
| `src/platform/renderer/index.tsx` | 改 | `<App>` 内用 `<AuthGate>` 包裹 `<WorkspaceBar/><WorkspaceContainer/>`（line ~117） |

> 登录 UI 形态：用**全屏 gate**（AuthGate）而非 popup——未登录时整个工作区不该出现。已登录后账号/登出走 WorkspaceBar 上的 badge。（popup 系统留给后续「升级弹窗」用。）

---

## 4. IPC channel（仿现有 SCREAMING_SNAKE → kebab 风格）

```ts
AUTH_GET_STATE:    'auth.get-state',     // renderer → main, 拿当前 public state
AUTH_SEND_CODE:    'auth.send-code',     // 发邮箱验证码(POST /auth/code, purpose=register)
AUTH_REGISTER:     'auth.register',      // 注册(email+password+code+device)
AUTH_LOGIN:        'auth.login',         // 登录(email+password+device)
AUTH_LOGOUT:       'auth.logout',
AUTH_REFRESH:      'auth.refresh',       // 重查 grant + 刷 token(启动/恢复前台时)
AUTH_CHANGED:      'auth.changed',       // main → renderer 广播
```

> 邮箱注册是两步：先 `AUTH_SEND_CODE` 拿码，再 `AUTH_REGISTER` 带 6 位 `code`。device 嵌套对象、app_source 顶层（见 §1.1）。

---

## 5. 关键实现要点

### 5.1 `auth-service.resolveAuth()`（grant 优先，设计 §7.1）
```
restore(): 从 auth-store 读 token → 有则 resolveAuth() → 设 AuthState → 广播
resolveAuth():
  1) 无 token → status='anonymous'
  2) GET /api/v1/me/grants/krig-note (Bearer)
     - 200 grant.active=true → status='authenticated', tier='全功能'(测试期)
       缓存 grant.expiresAt(本期忽略 signature,不验签)
     - 200 grant.active=false → (下期)读订阅判 free/pro;本期留 TODO,暂当 free
     - 401 → 尝试 refresh(轮换:存新 refresh);仍 401 → status='token-expired'
     - 网络错/5xx → 用离线缓存兜底(见下),不改登录态
  离线兜底: 用缓存的 grant.expiresAt,now<expiresAt 暂沿用全功能;联网后纠正
```
> 注：本期不验签，离线兜底纯靠本机时钟比较——测试期可接受（设计 §二·补、§九）。下期计费上线时补验签，离线兜底才防改时钟。

### 5.2 启动时序（不阻塞窗口太久）
- `restore()` 做成**不阻塞窗口创建**：窗口照常起，AuthState 初始为 `loading`，restore 完成后广播。
- AuthGate 在 `loading` 时显示轻量占位（不是先显示登录页再闪走，避免已登录用户看到登录闪屏）。

### 5.3 门控管线「搭好不开闸」
- `commandRegistry`、`MenuItem`、`ViewDefinition` 的 `feature?`/`locked?` 字段**本期就加上**类型与读取逻辑。
- 但 `auth.canUse()` 在 grant 期内**恒返回 true**（因 tier=全功能）。
- 这样代码随测试版铺开，等 grant 到期/下期开闸时，老用户机器上已有门控逻辑——命中设计 §二·补 的关键前提。
- 为可测，提供一个**隐藏的开发开关**（如环境变量或内部菜单）模拟 free 态，验证门控真的会限制。

### 5.4 环境切换
`auth-config.ts` 用 `app.isPackaged` 选 prod portal / dev portal；dev 地址待后端给（§1.1）。

---

## 6. 分步实施顺序（每步可独立验证）

1. **shared 类型 + channel 名 + electron-api.d.ts**（编译通过，无行为）。
2. **auth-config + auth-client + auth-store**（主进程，可用离线脚本单测：发请求、加解密落盘）。
3. **auth-service + auth-handler + ipc-bus 接线 + 启动 restore**（主进程 auth 全通，preload 暴露）。
4. **renderer：use-auth-state + AuthGate + LoginScreen**（能登录、能 gate）。
5. **AuthStatusBadge + 登出 + 剩余天数展示**。
6. **门控管线字段铺设（不开闸）+ 开发模拟开关**。
7. **mock 适配层替换为真实后端接口**（待 §1 后端就绪）。
8. **多 ws 扇出守卫 + 冷启动 loading 态联调**。

> 1–6 步在后端接口就绪前就能做（靠 mock 适配层），第 7 步对接真实后端。这样最大化并行、不被后端阻塞。

---

## 7. 验证（对齐设计 §十一，本期相关项）

- 全新用户注册 → 自动获一年 grant → 全功能可用，badge 显示剩余天数。
- 老用户直接登录 → 恢复授权态。
- 登出 → 回登录 gate，本地 token 清除。
- 杀进程重启 → 自动恢复 session，不需重新登录（token 未过期）。
- 断网启动 → grant 缓存未过期则仍全功能；联网后纠正。
- 登录失败（错密码/网络错）→ 明确报错，不静默。
- 开发模拟 free 态 → 门控确实限制（证明管线有效），关掉后恢复全功能。
- 多窗口/多 ws → 单次登录只触发一次 UI/菜单重建。

---

## 8. 风险与注意

- **后端接口未定形**：用 mock 适配层隔离，把对接面收敛到 `auth-client.ts` 一处。
- **grant 是新后端能力**：§1.2 必须后端确认能做，否则「测试授权」无真实数据源（本期可先 mock 上线纯免费，但那样「一年后切计费」的兜底就没落地——需总指挥权衡是否接受先 mock）。
- **safeStorage 首次引入**：项目此前无用例；macOS 用 Keychain、Windows 用 DPAPI，注意 `safeStorage.isEncryptionAvailable()` 兜底（不可用时的降级策略 fail loud 提示）。
- **不要复用 extraction/config.ts 的后端地址**（那是 PDF 提取平台 192.168.1.240，非 auth portal）。
```
