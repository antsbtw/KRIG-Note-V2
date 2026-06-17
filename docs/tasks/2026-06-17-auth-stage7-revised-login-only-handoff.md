# 交接 prompt：阶段 7 修订 —— 砍 grant/门控，回归「只做登录 + 归因」

> **自包含交接文档**，给实现新对话。**指挥/验收**：总指挥（审计，不写实现代码）。
> **日期**：2026-06-17
> **前置**：阶段 1–6 已实现并通过审计（auth 类型/主进程/UI gate/badge/门控管线）。本次因前后端最终决定**砍掉授权**，要做减法 + 接真实后端。

## 0. 背景：决定变了

前后端最终拍板（见 [authorization-management-design.md](../authorization-management-design.md) 顶部「★ 2026-06-17 最终决定」 + 后端「最终决定通知」）：

> **本期不做授权，只做登录 + 归因。** 砍掉「一年免费 grant / 到期判定 / 倒计时 / 验签 / 客户端功能门控」——计费系统还没上线，不提前为它造复杂度。

**授权的真正边界在后端的登录/refresh 判定，不在客户端**（下期计费时后端在登录/refresh 拒绝未付费账号，30 天 refresh 周期自动收口所有老用户，含装了不更新的）。所以阶段 6 的客户端门控管线是多余的，删。

## 1. 本次要做两件事

### A. 减法：删掉为「授权/计费」提前造的代码

| 删除目标 | 文件 / 位置 |
|---|---|
| grant 查询 | `auth-client.ts` 的 `fetchGrant` / `GrantResponse` / `GRANT_PATH`（auth-config）；`auth-service` 里 `resolveAuth` 的 grant 查询逻辑 |
| 倒计时 | `src/capabilities/auth/grant-days.ts` 整个文件 + 其测试 `tests/auth/grant-days.test.ts`；`AuthStatusBadge` 的「剩余 N 天」 |
| 验签 / 离线时钟兜底 | `auth-service` 的 `applyOfflineFallback`、grant 缓存离线判定；`auth-types` 的 `AuthGrant.signature/alg`（整个 `AuthGrant` 可删） |
| 功能门控管线（阶段 6） | `src/shared/auth/feature-policy.ts` 整个文件 + `tests/auth/feature-gate.test.ts`；`command-registry.ts` 的 `CommandOptions/FeatureGate/setFeatureGate/gate 检查`（**回退到 `register(id, handler)` 两参、`execute` 无 gate**）；`menu-types.ts` / `view-definition.ts` 的 `feature?`/`locked?` 字段；`auth/index.ts` 的 `canUse/effectiveTier/setSimTier/setFeatureGate 注入/dev 开关 __krig.authSimTier` |
| tier 判定 | `PlanTier`/`tier`/`cachedTier` 相关：本期无 free/pro 概念。`AuthState` 去掉 `tier`/`grant`；`AuthStatus` 去掉与 grant 相关的语义（保留 loading/anonymous/authenticated/token-expired） |

> 删除原则：**只删「为授权/计费造的」，不碰「登录本身需要的」**。删完 grep 确认无悬空引用，`tsc` 必须 0。

### B. 接真实后端 + 简化 resolveAuth

- `auth-config.ts`：`USE_MOCK_AUTH` 仍保留（联调用），但默认接真实后端；dev portal 域名**后端待补**，未补前用 prod 域名联调（`KRIG_PORTAL_BASE` 可覆盖）。
- **简化后的启动/登录逻辑**（无 grant）：
  ```
  restore(): loadSession → 有 token? 设 authenticated : anonymous
    （不再查 grant；token 有效性由后续真实请求自然暴露——401 则 refresh，refresh 也 401 → token-expired）
  login/register: 调后端 → 存 token → authenticated + 广播
  refresh: 401 → token-expired（回登录）；网络错 → 保持当前态可重试
  ```
- **真实 net 路径的错误映射**（阶段 2 标注「mock-only 未覆盖，阶段 7 必补」）：补测试覆盖 401→token-expired、网络错(status 0)/5xx→可重试不掉线、非 JSON 错误体解析。

## 2. 保留（这些是登录本身需要的，别删）

- 注册（两步：`/auth/code` 拿码 → `/auth/register`）/ 登录 / refresh / 登出
- token safeStorage 加密落盘（`auth-store.ts` 基本不动，去掉 `grantExpiresAt`/`cachedTier` 字段）
- device_id per-install 持久化、`device_type`、`app_source=krig-note` **必带**
- `AuthGate` **硬挡**（未登录不渲染工作区）+ loading 占位不闪屏
- `AuthStatusBadge`：**改为只显账号邮箱 + 登出**（去掉倒计时）。仍走 capability 注册路径（`requireCapabilityApi`）
- renderer 模块级单例 `authStore` + 单 `onAuthChanged` 订阅（多 ws 守卫）
- handler 层入参校验、fail loud

## 3. 后端契约（真值，已核代码 + 已部署）

Base `portal.situstechnologies.com` + `/api/v1/auth/*`（dev 域名待后端补，prod 先联调，不直连 IP）。

- `POST /auth/code` `{email, purpose:'register'}` → 拿 6 位码
- `POST /auth/register` `{email, password(min8), code(6位,字段名 code), device:{device_id,device_type:'macos'|'windows',...}, app_source:'krig-note'}` → 201 AuthResponse
- `POST /auth/login` `{email, password, device, app_source:'krig-note'}` → 200 AuthResponse
- `POST /auth/refresh` `{refresh_token}` → 200 AuthResponse（**轮换：旧 refresh 作废，存新的**）
- AuthResponse：`{access_token, refresh_token, expires_in:86400, token_type:'Bearer', user:{id,email,source,role,email_verified,created_at}}`，失败 `{error,message}`+HTTP 码
- token：access 24h（读 `expires_in`）/ refresh 30d。401=重登；网络/5xx=可重试。
- ⚠️ **`app_source=krig-note` 注册和每次登录都必带**——归因的根，硬要求。
- ❌ **没有** `GET /me/grants/krig-note`（已删除，别对接）。

## 4. 红线（违反即打回）

1. token 绝不进 renderer（只主进程 + safeStorage，renderer 只拿 public state）。
2. fail loud：登录失败/网络错/safeStorage 不可用明确报错，不静默吞。
3. `commandRegistry.execute` **回退为无 gate 的同步原状**（`register(id, handler)` 两参）——确认 131 个现有调用点零影响。
4. `auth.changed` 多 ws：主进程遍历所有 webContents；renderer 单订阅（已是单例）。
5. 冷启动 loading 占位不闪屏。
6. `app_source=krig-note` 注册 + 每次登录必带。
7. 减法干净：删完 grep 无悬空引用，`tsc`=0、lint=0、auth 测试全绿。

## 5. 验收（交回总指挥审计，等放行）

- 删除彻底：grant/门控/倒计时/验签 相关代码与测试全清，无悬空引用；`tsc`=0、`eslint`=0。
- `commandRegistry` 回退两参，131 调用点不受影响；`execute` 仍同步。
- 真实后端（或 `KRIG_PORTAL_BASE` 指向可达后端）端到端：注册（两步）→ 登录 → refresh 轮换 → 登出 → 重启恢复 session。若后端/ dev 域名未就位，至少用打桩 HTTP 覆盖错误映射逻辑，并说明哪些是真实跑、哪些是桩。
- 错误映射测试补齐：401→token-expired、网络错/5xx→可重试、非 JSON 错误体。
- badge 只显邮箱+登出，无倒计时。AuthGate 硬挡。
- `app_source=krig-note` 真的在注册/登录请求体里（抓请求或测试断言）。

## 6. 交付方式

- 建议分两步交：**(A) 减法**（删 grant/门控，回归登录-only，全绿）先交审计；放行后 **(B) 接真实后端 + 错误映射**。便于审计定位。
- 未经总指挥确认不 push / 不部署。
- 文档与代码现状矛盾时以代码为准并指出。
- 授权边界仅限本次「砍 grant + 接登录」改动；遇订阅/计费/Apple 登录等下期范围，停下问总指挥。
