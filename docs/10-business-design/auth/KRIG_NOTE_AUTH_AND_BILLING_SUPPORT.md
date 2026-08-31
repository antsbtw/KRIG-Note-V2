# KRIG-Note 授权与计费后端支撑说明（前端对接版）

**状态**: 设计稿，待评审
**创建日期**: 2026-06-16
**适用对象**: KRIG-Note 前端（macOS 客户端）+ 后端实施
**关联**:
- [SAAS_PLATFORM_V3_ARCHITECTURE.md](../SAAS_PLATFORM_V3_ARCHITECTURE.md)
- [FRONTEND_API_GUIDE.md](../FRONTEND_API_GUIDE.md)
- [OBOX_LICENSE_FULFILLMENT_DESIGN.md](../fulfillment-service/OBOX_LICENSE_FULFILLMENT_DESIGN.md)（同范式参照）
- [auth-service/AUTH_SERVICE_MODULE_GUIDE.md](../auth-service/AUTH_SERVICE_MODULE_GUIDE.md)
- [subscription-service/2026-06-04_SUBSCRIPTION_SERVICE_RESPONSIBILITY.md](../subscription-service/2026-06-04_SUBSCRIPTION_SERVICE_RESPONSIBILITY.md)

---

## 0. 一页纸结论（先看这个）

KRIG-Note **不是新建一套授权/计费系统**，而是作为 V3 平台已有三维订阅模型里的**一个新 `app`** 接入。后端复用现成的 auth / payment / subscription 链路，前端只需对接**统一门户**（`portal.situstechnologies.com`）的相对路径。

| 维度 | KRIG-Note 取值 |
|---|---|
| 商业模式 | **Freemium**（注册即免费档，**无 trial**，与 OBox 同范式） |
| `app` | `krig-note` |
| `service_type` | `license`（纯软件授权，无 VPN/VPS 资源） |
| `plan_tier` | `free`（隐式，不落订阅）/ `pro`（建议初始只做这一付费档，后续可加 `team` 等） |
| 分发渠道 | macOS **Mac App Store**（Apple IAP）+ **官网版**（Stripe），按 **email 统一账号** |
| 登录 | 商店版 = Sign in with Apple；官网版 = 邮箱注册/登录 |
| 授权判定 | **读订阅状态**（推荐，§5），客户端查"是否有有效 `krig-note/license` 订阅" |

**前端要做的就三件事**：①登录拿 JWT；②发起购买（Apple IAP 验单 / Stripe Checkout）；③启动时和定期查"我是不是付费用户"。其余（验单、订阅状态权威、过期回收）全在后端。

---

## 1. 架构定位：为什么 KRIG-Note 几乎是"零新增后端"

V3 是统一门户 + 平等微服务架构（[架构图](../SAAS_PLATFORM_V3_ARCHITECTURE.md#21-整体架构统一门户模式)）。订阅是**三维模型**：`app` × `service_type` × `plan_tier`。新增一个 app 的本质是**在这三维里多一个 `app=krig-note` 的取值**，而不是新写服务。

```
                  portal.situstechnologies.com (Nginx 统一入口)
                                │
       ┌────────────────────────┼────────────────────────┐
       ▼                        ▼                         ▼
  auth-service            payment-service          subscription-service
  (身份/JWT)        (Apple IAP / Stripe 验单)     (订阅真源 + 仲裁者)
   不分 app              按 app 路由 SKU            按 (app,service_type) 存订阅
       │                        │                         │
       └─────────── 所有服务用 auth JWT / X-Internal-Secret ─┘
                                │
                         fulfillment-service
                  （履约枢纽：license SKU 发卡 / 纯订阅则可空履约）
```

KRIG-Note 是**纯软件**产品，没有 VPN 用户、没有 VPS 节点要开。所以它落在 `service_type=license` 这一类——和 OBox license SKU **同范式**（参见 [OBOX_LICENSE_FULFILLMENT_DESIGN.md](../fulfillment-service/OBOX_LICENSE_FULFILLMENT_DESIGN.md)）。区别只在于：是否真的"发 license_key"——这正是 §5 的核心决策。

---

## 2. 授权（身份）— auth-service

KRIG-Note 与平台共用同一个身份系统，**一切以 `auth.users.id`（UUID）为账号主键**，所有下游服务从 JWT 的 `uid` claim 取身份。详见 [AUTH_SERVICE_MODULE_GUIDE.md](../auth-service/AUTH_SERVICE_MODULE_GUIDE.md)。

### 2.1 两条登录入口（按渠道）

| 渠道 | 登录方式 | 接口 |
|---|---|---|
| **Mac App Store 版** | Sign in with Apple | `POST /api/v1/auth/apple` |
| **官网版** | 邮箱注册 / 登录 | `POST /api/v1/auth/register` / `POST /api/v1/auth/login` |

> **统一账号关键点**：auth-service 有**三层防重账号匹配**（`apple_user_id` > `email` > `device_id`），同一个人用 Apple 登录、又用同邮箱注册官网版，会**合并到同一个账号**，不会产生两份订阅孤岛。前端无需为此做特殊处理，只要确保用户用同一邮箱即可。

### 2.2 前端要带的字段（`app_source`）

注册/登录请求里**务必带上 `app_source=krig-note`**（auth 会落到 `users.app_source` 和 `login_history.app_source`）。这是运营归因的依据，**不带会导致归因缺失**（这是平台已知坑，见 OBox/OTun 的归因缺陷历史）。

```jsonc
// POST /api/v1/auth/apple（商店版）
{
  "identity_token": "<Apple 返回的 JWT>",
  "app_source": "krig-note",
  "device_id": "<identifierForVendor>",
  "device_type": "macos",
  "device_name": "MacBook Pro",
  "device_fingerprint": { "model": "...", "os_version": "..." }
}

// POST /api/v1/auth/register（官网版）
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "verification_code": "123456",   // 先调 POST /api/v1/auth/code 拿验证码
  "app_source": "krig-note",
  "device_id": "<uuid>",
  "device_type": "macos"
}
```

### 2.3 Token 使用

- 响应里拿 `access_token`（默认 **24h**）+ `refresh_token`（**30d**）。
- 之后所有需认证的请求带 `Authorization: Bearer <access_token>`。
- 401 时用 `POST /api/v1/auth/refresh` 刷新（轮换式，旧 refresh 会被撤销，存新的）。
- 所有 POST 带 `X-Request-ID: <uuid>` 做幂等。

> ⚠️ **重要：免费档也要登录。** KRIG-Note 是 Freemium，但"免费"指的是**功能档位**，不是"匿名可用"。免费用户也要有 auth 账号（否则订阅、跨设备、未来升级都无从挂载）。前端逻辑：**先登录 → 再判断付费能力**。

---

## 3. 计费（购买）— payment-service

KRIG-Note 有两条支付链，按渠道走，最终都汇入 subscription-service 的同一套订阅真源。

### 3.1 商店版：Apple IAP

macOS Mac App Store 用 StoreKit 完成内购，然后把凭据交给后端验单。

```
KRIG-Note(macOS)        portal           payment-service        Apple
  │  StoreKit 购买成功                        │                   │
  │  拿到 transaction / receipt              │                   │
  │─ POST /api/apple/... (带 JWT + receipt) ─▶│ 向 Apple 验单 ───▶│
  │                                          │◀── 验单结果 ───────┤
  │                                          │ 写 apple_transaction
  │                                          │ → subscription event（app=krig-note）
  │◀──────────── 200 ────────────────────────│
```

- 前端职责：StoreKit 购买 → 把 `transaction_id` / receipt 交给 payment-service 的 Apple 接口（具体路径以 payment-service 当前 `/api/apple/*` 为准，实施时确认）。
- **后端会监听 Apple Server Notifications**（续期 `DID_RENEW`、过期 `EXPIRED`、退款 `REFUND` 等），自动更新订阅状态。前端**不需要**自己轮询续期。

### 3.2 官网版：Stripe Checkout

```
KRIG-Note 官网/客户端     portal        payment-service        Stripe
  │─ POST /api/stripe/checkout/session (带 JWT) ─▶│ 建 session ─▶│
  │◀────────── { url: "https://checkout.stripe.com/..." } ──────┤
  │  打开浏览器 / WebView → 用户在 Stripe 付款            │       │
  │◀── redirect 到 STRIPE_SUCCESS_URL ──────────────────────────┤
  │                            (Stripe webhook → payment-service 自动同步订阅)
```

- 前端职责：调 `POST /api/stripe/checkout/session` 拿 `url`，打开它；付完跳回 success 页。
- 订阅状态由 **Stripe webhook → payment-service** 自动同步，前端付完后**回到 App 重新查一次订阅状态即可**（§5）。

### 3.3 SKU 与 plan_tier（需产品确认后在 payment 配置）

后端要为 KRIG-Note 在 Apple / Stripe 各配一套产品（SKU），并映射到统一的 `plan_tier`：

| plan_tier | 含义 | Apple Product ID（待定） | Stripe Price（待定） |
|---|---|---|---|
| `free` | 免费档（**不产生订阅记录**） | — | — |
| `pro` | 付费档（月度/年度） | `com.situs.krignote.pro.monthly` / `.yearly` | `price_xxx` |

> 建议初期**只做 `pro` 一档**（月度 + 年度两个周期），别一上来就 basic/premium/unlimited 多档，note 类产品分太细反而难卖。后续要加档只是多配 SKU + 映射，不改链路。

---

## 4. 订阅真源 — subscription-service

无论 Apple 还是 Stripe，验单成功后 payment-service 都会向 subscription-service 推事件，写入订阅真源。**subscription-service 是"订阅真源 + 唯一仲裁者"**，持有"用户当前有效套餐 / 到期 / 状态"。

### 4.1 订阅记录维度

订阅按 `(app=krig-note, service_type=license, plan_tier=pro)` 存储，含 `current_period_start/end`、`status`、`auto_renew`、`channel`(apple/stripe)。

### 4.2 状态语义（前端必须理解的一点）

subscription-service 的 DB `status` 是**输入快照**，不是实时真相。对外判定走 **`effectiveStatus()` 读时计算**：

> DB 里是 `active`/`trial`，但 `current_period_end < now`，对外一律返回 **`expired`**。

**对前端的含义**：你**永远以接口返回的 status 为准**，不要自己缓存"上次是 active 就一直当 active"。每次 App 启动、以及恢复前台时，重新查一次（§5）。

### 4.3 过期/退款的回收（后端自动，前端无需处理）

- Apple `EXPIRED`/`REFUND`/`REVOKE`、Stripe `subscription.deleted` → 后端自动把订阅转 expired/cancelled。
- KRIG-Note 是纯软件、**无云资源成本**，所以不存在 OBox VPS 那种"过期不回收烧钱"的问题（那是 [LICENSE_AND_LIFECYCLE_AUDIT.md](../architecture/LICENSE_AND_LIFECYCLE_AUDIT.md) P0 漏洞的根源，对 KRIG-Note **不适用**）。前端只要按 §5 读到 `expired` 就降级回免费档功能即可。

---

## 5. 授权判定（前端最关心）— 推荐方案与对比

你让我分析"客户端怎么判定付费能力"。结论先行：

> ### ✅ 推荐：方案 A —「读订阅状态」（轻量，不发 license_key）

### 5.1 两种方案对比

| 维度 | **方案 A：读订阅状态**（推荐） | 方案 B：发 license_key + 设备绑定 |
|---|---|---|
| 客户端怎么判付费 | 查 `/api/subscriptions/active/krig-note/license` 有有效订阅 = `pro` | 查 fulfillment 拿 license_key，再 activate/heartbeat |
| 后端工作量 | **≈0**（链路现成，只配 SKU） | 需补 fulfillment 发卡链路（参照 OBox 设计约 4.5 天） |
| 设备数上限 / 并发控制 | 无（或在客户端软约束） | 有（license-service 原生支持） |
| 离线可用 | 弱（依赖联网查状态，可本地缓存兜底） | 强（license_key 可离线校验签名） |
| 防盗版强度 | 中（订阅态可伪造需破 JWT/中间人，已有 HTTPS） | 高（设备绑定 + 心跳） |
| 适用产品形态 | **在线/云同步的 SaaS 笔记**（联网是常态） | 离线优先、按设备售卖的桌面软件 |

### 5.2 为什么 KRIG-Note 选 A

1. **笔记类 SaaS 是联网常态**——云同步、跨设备本来就要联网，"必须联网才能确认付费"不是负担。license_key 的离线优势对你价值不大。
2. **后端几乎零新增**——A 直接复用已跑通的订阅查询链路，不用补 fulfillment 发卡（B 要新建 `license_provisions` 表、`LicenseServiceClient`、发卡 SAGA，是 OBox 那份 4.5 天的设计）。
3. **避免无意义运维**——OBox 设计里明确写过：Freemium 产品**别给免费用户强发 license_key**，会污染数据、制造运维负担。A 天然只对付费用户产生订阅记录，免费用户零足迹。
4. **设备数上限**可以先不做；真要做，前端读 `/api/v1/auth/devices`（auth 已有设备列表 + `max_devices`）做软提示即可，不必上 license-service 的硬并发控制。

> **如果将来**KRIG-Note 要做"买断制 / 按设备授权 / 强离线防盗版"，再升级到方案 B——届时复用 OBox 那条 fulfillment→license-service 链路，前端从"读订阅"切到"读 license_key"，是增量演进，不是推倒重来。

### 5.3 方案 A 的前端调用（这就是你要写的代码）

**首选：BFF 聚合接口**（一次拿全用户态，省请求）

```http
GET /api/v1/me
Authorization: Bearer <access_token>
```

返回里含订阅概览，前端从中筛 `app=krig-note && service_type=license && status==active` 即可。

**精确单查：订阅状态接口**

```http
GET /api/subscriptions/active/krig-note/license
Authorization: Bearer <access_token>
```

- 有有效订阅 → 返回订阅详情（`plan_tier=pro`、`current_period_end` 等）→ 前端解锁 `pro` 功能。
- 返回空 / 404 / `expired` → 前端走**免费档**。

```typescript
// 前端伪代码：判定付费能力（每次启动 & 恢复前台时调）
async function resolveEntitlement(): Promise<'free' | 'pro'> {
  const res = await fetch('/api/subscriptions/active/krig-note/license', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) { await refreshToken(); return resolveEntitlement() }
  if (!res.ok) return 'free'                       // 无订阅 = 免费档
  const sub = await res.json()
  // 以后端 effectiveStatus 为准，不要本地推算过期
  return sub?.status === 'active' ? 'pro' : 'free'
}
```

**调用时机**：①App 启动；②从后台恢复前台；③购买流程完成后（Apple 验单 / Stripe 回跳后）主动再查一次刷新 UI。

**离线兜底**（可选）：把上次成功查到的 `entitlement + current_period_end` 本地缓存；离线时若 `now < current_period_end` 暂当 `pro`，联网后以服务端为准纠正。这是体验兜底，不是授权依据。

---

## 6. 前端对接清单（按实现顺序）

| # | 能力 | 接口 | 备注 |
|---|---|---|---|
| 1 | 商店版登录 | `POST /api/v1/auth/apple` | 带 `app_source=krig-note`、`device_type=macos` |
| 2 | 官网版注册 | `POST /api/v1/auth/code` → `POST /api/v1/auth/register` | 邮箱验证码两步 |
| 3 | 官网版登录 | `POST /api/v1/auth/login` | |
| 4 | Token 刷新 | `POST /api/v1/auth/refresh` | 401 时调 |
| 5 | 当前用户 | `GET /api/v1/user/profile` 或 `GET /api/v1/me` | `/me` 是聚合，含订阅 |
| 6 | Apple 内购验单 | `POST /api/apple/*` | 路径以 payment-service 现状为准，实施时确认 |
| 7 | Stripe 下单 | `POST /api/stripe/checkout/session` | 拿 `url` 打开 |
| 8 | **付费能力判定** | `GET /api/subscriptions/active/krig-note/license` | **核心**，§5.3 |
| 9 | 设备列表（可选） | `GET /api/v1/auth/devices` | 含 `max_devices`，做软提示 |

> **全部用相对路径**，经 `portal.situstechnologies.com` 统一入口，**不要直连任何独立域名/IP/端口**（会有 CORS 和路由问题，见 [FRONTEND_API_GUIDE.md](../FRONTEND_API_GUIDE.md)）。本地开发用 Next.js rewrites 代理到 portal。

---

## 7. 后端实施清单（给后端的，前端可忽略细节）

KRIG-Note 选方案 A 后，后端的实际改动**很轻**：

1. **payment-service**：
   - 配 KRIG-Note 的 Apple Product ID / Stripe Price → `plan_tier` 映射。
   - Apple Bundle ID / IAP shared secret、Stripe webhook 需覆盖新 app 的 SKU（确认 webhook 能区分 app，必要时在 product metadata 带 `app=krig-note`）。
2. **subscription-service**：
   - 确认 `app=krig-note`、`service_type=license` 能正常落库（三维模型本就支持，重点验 `GetActiveByUser` 按 app/service_type 维度查询正确）。
   - **license 类型不触发 fulfillment 履约**（无资源要开），订阅 created 后直接 active 即可——这点与 OBox hosting 不同，省掉发卡分支。
3. **fulfillment-service**：**方案 A 下不动**（不发 license_key）。
4. **auth-service**：不动（`app_source` 是自由字符串，`krig-note` 直接可用）。
5. **网关 nginx**：不动（`/api/v1/auth/*`、`/api/subscriptions/*`、`/api/apple|stripe/*` 已有路由，按 app 复用）。

> ⚠️ 已知平台坑提醒（实施时注意，与 KRIG-Note 无直接关系但同环境）：
> - 改配置走各服务 `deploy.sh`，**别直接 `docker compose up`**（会让 `${VAR:-change-me}` 退化成 change-me 导致全 401）。
> - 生产 VPS 默认只读，任何改动先确认。

---

## 8. 待产品/双方确认的决策点

| # | 决策 | 默认建议 |
|---|---|---|
| D1 | 付费档数量 | **只做 `pro` 一档**（月+年两周期），后续再加 |
| D2 | 授权判定方案 | **方案 A（读订阅状态）**，§5 |
| D3 | 免费档 vs `pro` 的功能边界 | 产品定（后端不关心，纯客户端 gate） |
| D4 | 设备数是否限制 | 初期**不限制**（或 auth devices 软提示），不上 license-service |
| D5 | Apple / Stripe 具体 Product ID / Price | 待产品建 SKU 后回填 §3.3 |
| D6 | 取消订阅时机语义 | 建议"用完已付周期"（到 `current_period_end` 才降级），符合 Stripe/Apple 习惯且无云成本压力 |

---

## 9. 一句话给前端

> 你只需要：**带 `app_source=krig-note` 登录拿 JWT → 按渠道发起 Apple/Stripe 购买 → 每次启动查 `GET /api/subscriptions/active/krig-note/license` 决定解锁 `pro` 还是回落 `free`**。验单、续期、过期全是后端的事，全部走 `portal.situstechnologies.com` 相对路径。
