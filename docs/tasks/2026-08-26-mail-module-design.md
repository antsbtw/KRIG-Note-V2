# 邮箱模块设计方案

> 状态：设计待评审 · 2026-08-26
> 决策人：wenwu · 记录：本文档是开工前的唯一事实源

## 0. 一句话

**webview 给人用，IMAP 给机器用。** 同一个邮箱账号两条通路并存、互不同步，IMAP 是权威源。

---

## 1. 背景与已定决策

用户目标：在 KRIG-Note 内管理邮件收发，未来对接 Gemma 自动处理。

已拍板的四条：

| # | 决策 | 理由 |
|---|---|---|
| D1 | UI 层用 webview 开网页版邮箱 | 复杂操作（附件、日历邀请、原生搜索）不自己造轮子 |
| D2 | 数据层走 IMAP/SMTP，落 SurrealDB | Gemma 需要结构化输入 + 判断可持久化 |
| D3 | **第一版不依赖 OAuth**，用应用专用密码 | 保持独立性，不被外部审核卡住推进 |
| D4 | 邮件是独立实体，显式归档到 note | 邮件量级远大于 note，全量 block 化会拖垮库 |

### D3 的展开（关键澄清）

「不依赖 OAuth」≠「不用 IMAP」。IMAP 是 RFC 3501 标准协议，所有服务商同一套代码，
比 webview 更独立（webview 依赖 Gmail 私有 DOM，说改就改）。

IMAP 认证两种，第一版只做第二种：

| 认证 | 外部依赖 | 第一版 |
|---|---|---|
| XOAUTH2 | OAuth client + CASA 审核 | ❌ 不做 |
| PLAIN/LOGIN + 应用专用密码 | **零** | ✅ 做 |

覆盖面：Gmail（开两步验证后可生成应用专用密码）、QQ、163、iCloud、Fastmail、企业自建。

> 补充：用户持有 Google Workspace 企业账号，OAuth consent screen 设 `Internal` 可免 CASA 审核。
> 但那只对域内账号有效，且属于**后续增强**，不进第一版。

---

## 2. 架构总览

```
                       ┌─ webview (persist:webview-${wsId})  ← 人：手动收发、复杂操作
   邮箱账号 ───────────┤     Gmail/Outlook 网页版原样
                       │
                       └─ IMAP/SMTP (main 进程) ──> mail 表 ──> Gemma ──> mail_verdict
                                                      │
                                          (用户显式动作) └──> import-orchestrator ──> note
```

**两条通路不做同步**。webview 里发的信，下次 IMAP 拉取自然可见；
IMAP 的 `UID + flags` 就是天然对账机制（对齐 `reliability-charter` 的「对账」条）。

---

## 3. 代码地基摸底结论

开工前对仓库做了两轮调研，三条与既有假设不符，**必须以此为准**：

### 3.1 `web-service-base` 是原语库，不是插件框架

位置 `src/platform/main/web-service-base/`（仅主进程，908 行 / 7 文件）。
导出 5 个泛型函数 + 3 个类型，**没有 `WebServiceDefinition` 这种统一契约接口**，
也**没有中央注册表**。各服务在自己目录里 `new` 一份 registry、写一份 profile、挂一份 hook。

新增邮箱 = 照 X 模板复刻 8 个落点，不是"注册一下"。

### 3.2 ⚠️ `shouldHandle` 必须改（推翻旧记忆）

旧记忆「shouldHandle 靠 URL 判定故零钩子改动」对了一半：

- ✅ 三个下游钩子（右键菜单 / 快捷键 / 下载）不用改，它们只调 `shouldHandle(guest)`
- ❌ **`shouldHandle` 本身必须加一行**

`src/platform/main/web-shared/should-handle.ts:43` 前插入：
```ts
if (url && detectMailServiceByUrl(url)) return false;
```
**不加的后果**：邮箱 webview 被当"普通浏览"，原生右键菜单与自己的右键菜单**同时弹**（双菜单），
快捷键层也会误接管。

### 3.3 X 不在 AI 切换器里，它是独立 view

`src/views/x/index.ts` 顶部注释「X 放进 AI navSide 服务切换器」**已过期**。
实际 X 在 `src/views/social/`，`order: 6`，label `Social`。

→ 邮箱同样做**独立 view**，`order: 7`。

### 3.4 现有 navSide 入口

| order | viewId | label | icon |
|---|---|---|---|
| 1 | `note-view` | Note | 📝 |
| 2 | `ebook-view` | eBook | 📕 |
| 3 | `web-view` | Web | 🌐 |
| 4 | `graph-canvas-view` | Graph | 🎨 |
| 5 | `ai-view` | AI | 🤖 |
| 6 | `social-view` | Social | 💬 |
| **7** | **`mail-view`** | **Mail** | **📧** ← 新增 |

### 3.5 其他已确认的地基

- **partition**：`persist:webview-${workspaceId}`，5 处硬编码模板字符串、无共享常量。同 ws 内 AI/X/浏览器共用同一 Session。
- **凭据加密**：`safeStorage` 已在 `src/platform/main/auth/auth-store.ts` 用上，IMAP 密码直接复用，不新造。
- **migration 当前版本**：`1.8.7`（`src/storage/migrations/runner.ts:98`）→ 邮箱用 **1.8.8**。
- **导入 note 唯一入口**：`import-orchestrator` 的 `importDraftsToNotes()`，**禁止直接调 `noteCap.createNote`**。
- **Defuddle 剪藏**在 `src/platform/main/content-extraction/`，markdown→atoms 在 `src/capabilities/content-ingest/`。
- **无任何邮件相关 npm 依赖**（imapflow / mailparser / nodemailer 都没有）。

---

## 4. 分阶段方案

### 阶段 0：webview 邮箱（能看能发）

**目标**：内嵌网页版邮箱，右键可提取邮件到 note。零数据层。
**可独立交付**，代码不会因后续阶段作废（薄壳，无 DOM 抓取投入）。

#### 新建文件

| 文件 | 抄谁 | 内容 |
|---|---|---|
| `src/shared/types/mail-service-types.ts` | `x-service-types.ts` | Profile + `detectMailServiceByUrl` |
| `src/platform/main/mail/index.ts` | `main/x/index.ts` | 模块出口 |
| `src/platform/main/mail/webview-registry.ts` | 同名（37 行） | `createWebviewServiceRegistry` 实例 |
| `src/platform/main/mail/webview-hook.ts` | 同名（58 行） | `did-attach-webview` + 右键菜单 |
| `src/platform/main/mail/mail-webcontents.ts` | `x-webcontents.ts` | `resolveWsWebContentsWithWait` 薄包装 |
| `src/capabilities/mail-service/{index,types,Host.tsx,mail-host-registry}.ts` | `x-extraction/` | webview 宿主 |
| `src/views/mail/{index.ts,MailView.tsx,mail.css}` | `views/social/` | navSide 入口 + 服务切换器 |

`mail-service-types.ts` 骨架：
```ts
export type MailServiceId = 'gmail' | 'outlook' | 'qq' | 'netease163';

export interface MailServiceProfile {
  id: MailServiceId; name: string; icon: string;
  baseUrl: string; homeUrl: string; composeUrl: string;
  urlPattern: string;           // 字符串正则，如 '^https://mail\\.google\\.com'
  selectors: MailServiceSelectors;
  imapDefaults?: { host: string; port: number; secure: boolean };  // 阶段 1 用
}

export const MAIL_SERVICE_PROFILES: readonly MailServiceProfile[] = [...] as const;
export const DEFAULT_MAIL_SERVICE: MailServiceId = 'gmail';
export function getMailServiceProfile(id: MailServiceId): MailServiceProfile;  // 找不到 throw
export function detectMailServiceByUrl(url: string): MailServiceProfile | null;
```

#### 改既有文件（6 处）

1. `src/platform/main/web-shared/should-handle.ts` — 加 §3.2 那一行 ⚠️
2. `src/platform/main/index.ts:221-242` — `setPerWindowWebviewHooks` 内加 `registerMailWebviewHook(win);`
3. `src/shared/ipc/channel-names.ts` — 加 `MAIL_*` 通道常量
4. `src/platform/main/ipc/ipc-bus.ts` — `registerMailHandlers()`
5. `src/platform/main/preload/main-window-preload.ts` — 暴露 mail API
6. `src/platform/renderer/index.tsx:88` — `import '@views/mail';`

#### 阶段 0 红线

- 广播订阅**必须模块级**（照 `x-commands.ts`），**不得**进 view 的 `useEffect`
  → 否则多 ws 扇出，N 个实例各消费一次（`host-broadcast-multi-ws-fanout`）
- `handleClose` **必须**用 `ViewComponentProps.slot`，禁止 `slotBinding` 反推（`dont-guess-own-slot`）
  ```ts
  const handleClose = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    if (slot === 'right') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId, slot]);
  ```
- **不做任何 DOM 抓取**做数据。右键提取单封邮件可以（用户显式动作），批量抓取留给 IMAP。
- 照 X 抄（只导出 `track`），**别照 AI 抄**（AI 还留着 `@deprecated getActive`）

---

### 阶段 1：IMAP 只读同步

**目标**：邮件落库，验证协议层稳定性。**只读**，不碰 SMTP，风险最低。
UI 只做一个「同步状态 + 已同步 N 封」面板，不做完整列表。

#### 依赖

```
imapflow      IMAP 客户端（现代、Promise、维护活跃）
mailparser    MIME → 结构化（正文/附件/编码/字符集）
```
两者同作者（Nodemailer 团队），配套好。仅主进程使用。

#### 数据模型（migration 1.8.8）

```sql
-- 账号配置（密码不在这，走 safeStorage）
DEFINE TABLE IF NOT EXISTS mail_account SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS ws_id       ON mail_account TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS service_id  ON mail_account TYPE string;
DEFINE FIELD IF NOT EXISTS email       ON mail_account TYPE string;
DEFINE FIELD IF NOT EXISTS imap_host   ON mail_account TYPE string;
DEFINE FIELD IF NOT EXISTS imap_port   ON mail_account TYPE int;
DEFINE FIELD IF NOT EXISTS imap_secure ON mail_account TYPE bool;
DEFINE FIELD IF NOT EXISTS smtp_host   ON mail_account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS smtp_port   ON mail_account TYPE option<int>;
DEFINE FIELD IF NOT EXISTS enabled     ON mail_account TYPE bool;
DEFINE FIELD IF NOT EXISTS created_at  ON mail_account TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_ma_ws    ON mail_account FIELDS ws_id;
DEFINE INDEX IF NOT EXISTS idx_ma_email ON mail_account FIELDS email UNIQUE;

-- 邮件正文
DEFINE TABLE IF NOT EXISTS mail SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS account_id  ON mail TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS mailbox     ON mail TYPE string;          -- INBOX / [Gmail]/Sent
DEFINE FIELD IF NOT EXISTS uid         ON mail TYPE int;             -- IMAP UID(mailbox 内唯一)
DEFINE FIELD IF NOT EXISTS message_id  ON mail TYPE option<string>;  -- RFC Message-ID(全球唯一)
DEFINE FIELD IF NOT EXISTS thread_key  ON mail TYPE option<string>;  -- References 链首
DEFINE FIELD IF NOT EXISTS subject     ON mail TYPE string;
DEFINE FIELD IF NOT EXISTS from_addr   ON mail TYPE string;
DEFINE FIELD IF NOT EXISTS from_name   ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS to_addrs    ON mail TYPE array<string>;
DEFINE FIELD IF NOT EXISTS cc_addrs    ON mail TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS date        ON mail TYPE datetime;
DEFINE FIELD IF NOT EXISTS body_text   ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS body_html   ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS snippet     ON mail TYPE string;          -- 列表页预览
DEFINE FIELD IF NOT EXISTS flags       ON mail TYPE array<string>;   -- \Seen \Flagged ...
DEFINE FIELD IF NOT EXISTS has_attach  ON mail TYPE bool;
DEFINE FIELD IF NOT EXISTS attachments ON mail TYPE option<array> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS archived_note_id ON mail TYPE option<string>;  -- 归档到 note 的引用
DEFINE FIELD IF NOT EXISTS synced_at   ON mail TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_mail_acct_uid ON mail FIELDS account_id, mailbox, uid UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_mail_msgid    ON mail FIELDS message_id;
DEFINE INDEX IF NOT EXISTS idx_mail_date     ON mail FIELDS date;
DEFINE INDEX IF NOT EXISTS idx_mail_thread   ON mail FIELDS thread_key;

-- 同步游标（增量拉取）
DEFINE TABLE IF NOT EXISTS mail_sync_state SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS account_id     ON mail_sync_state TYPE string;
DEFINE FIELD IF NOT EXISTS mailbox        ON mail_sync_state TYPE string;
DEFINE FIELD IF NOT EXISTS uid_validity   ON mail_sync_state TYPE int;   -- 变了要全量重来
DEFINE FIELD IF NOT EXISTS last_seen_uid  ON mail_sync_state TYPE int;
DEFINE FIELD IF NOT EXISTS last_sync_at   ON mail_sync_state TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_mss ON mail_sync_state FIELDS account_id, mailbox UNIQUE;
```

⚠️ 遵守既有铁律：**绝不 `DEFINE FIELD id`**（`surreal-id-field-readonly`）。
migration 末尾**必须** `UPSERT schema_version`，漏了每次启动重跑。

#### 归属决策

| 对象 | 归属 | 理由 |
|---|---|---|
| webview partition | per-ws（`persist:webview-${wsId}`） | 沿用既有，工作/个人 ws 各登各的 |
| 账号配置 `mail_account` | **per-ws**（带 `ws_id`） | 与 partition 对齐，否则两边对不上 |
| 邮件 `mail` | **全局表 + `account_id` 外键** | 默认按当前 ws 账号过滤，保留全局搜索可能 |
| IMAP 密码 | `safeStorage` 加密，**不入 DB** | 复用 `auth-store.ts` 现成方案 |

#### 新建文件

```
src/platform/main/mail/imap-client.ts      连接池、重连、UIDVALIDITY 校验
src/platform/main/mail/mail-sync.ts        增量拉取(SEARCH UID > last_seen_uid)
src/platform/main/db/mail-repo.ts          裸 SQL,抄 tweet-inbox-repo.ts
src/platform/main/mail/credential-store.ts safeStorage 包装
```

#### 阶段 1 红线

- **fail loud**：IMAP 连不上要**响**，不静默重试到天荒地老（`fail-loud-no-fallback`）
- `UIDVALIDITY` 变化 = 服务端 mailbox 重建，**必须**丢弃游标全量重来，否则 UID 对不上导致错乱
- 增量拉取用 `UID > last_seen_uid`，**不用**时间戳（时钟不可信）
- 连接要有**上限与退避**，别学历史上「重连封顶 60s」的坑（`graceful-shutdown`）
- IMAP 连接是常驻资源 → **`before-quit` 必须有关闭调用**（`graceful-shutdown` 铁律）

---

### 阶段 2：原生邮件列表 view

基于 `mail` 表做真正的收件箱 UI，占 slot。

- MailView 内切换「网页版 / 收件箱」两态（类似 SocialView 的 tabbar）
- 列表虚拟滚动，按 `date` 倒序，按 `thread_key` 折叠
- navSide 放账号树 + 文件夹（照 `views/ebook/nav-side-content.tsx`）
- ⚠️ 这里必踩 `dont-guess-own-slot`，写 `handleClose` 前先查那条铁律

---

### 阶段 3：SMTP 发信 + 归档到 note

- 发信走 `nodemailer`，同一套应用专用密码
- **归档链路（不造第四个转换器）**：
  ```
  mail.body_html → Defuddle 清洗 → markdown → content-ingest.markdownToAtoms
                                              → import-orchestrator.importDraftsToNotes
  ```
  对齐 `markdown-import-unify` 的既定方向。邮件特有的引用层级 `>`、签名剥离，
  **在 markdown 层加规则**，不另起转换器。
- 归档后回写 `mail.archived_note_id`

---

### 阶段 4：Gemma 接入

```sql
DEFINE TABLE IF NOT EXISTS mail_verdict SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS mail_id    ON mail_verdict TYPE string;
DEFINE FIELD IF NOT EXISTS verdict    ON mail_verdict TYPE string;   -- 分类/优先级
DEFINE FIELD IF NOT EXISTS ai_verdict ON mail_verdict TYPE option<object> FLEXIBLE;  -- ⚠️ 见下
DEFINE FIELD IF NOT EXISTS created_at ON mail_verdict TYPE datetime;
```

⚠️ **直接照抄 `tweet_feedback` 1.8.7 的教训**：人工标注会把 AI 原判覆盖掉，
`ai_verdict` 快照字段**从第一天就要有**，别等踩了再补（`x-timeline-intelligence`）。

挂到既有的指挥者/工单调度架构（`x-commander-orchestration`）——邮件处理就是一类工单。

---

## 5. 风险与遗留

| 风险 | 影响 | 应对 |
|---|---|---|
| 两套登录（webview 一次、IMAP 一次） | 体验割裂 | webview 登录成功后按域名推断服务商，引导配 IMAP；**IMAP 定位成可选增强**，没配也能用网页版 |
| 应用专用密码需用户手动去邮箱设置生成 | 上手门槛 | 配置向导内嵌各服务商的申请页深链 |
| 邮件量大，SurrealDB 存储膨胀 | 性能 | 只同步近 N 天/近 N 封（可配）；`body_html` 考虑单独表或按需拉取 |
| Gmail 网页版 DOM 改版 | 阶段 0 右键提取失效 | selector 多候选（`web-service-base` 原生支持逗号分隔顺序命中）；数据层不依赖 DOM，故影响面被限制在"提取单封"这一个功能 |
| OAuth（Workspace Internal）后续接入 | — | 代码层与应用专用密码只差认证方式，`imapflow` 同时支持两种，切换成本接近零 |

### 明确不做（第一版）

- ❌ Gmail API / Microsoft Graph 等厂商私有 REST API
- ❌ OAuth（含 Workspace Internal）
- ❌ 两条通路的实时双向同步
- ❌ 从 DOM 批量抓取邮件列表
- ❌ 邮件全文 block 化（只在用户显式归档时转 note）

---

## 6. 开工顺序

```
阶段 0 (webview)  ──> 可独立交付,验证入口/切换器/右键
   ↓
阶段 1 (IMAP 只读) ──> 验证协议层,只读风险最低
   ↓
阶段 2 (原生列表)  ──> 有数据了才有意义
   ↓
阶段 3 (SMTP+归档) ──> 写方向
   ↓
阶段 4 (Gemma)     ──> 挂工单调度
```

阶段 0 与阶段 1 之间可并行（不同进程侧、无共享代码）。
