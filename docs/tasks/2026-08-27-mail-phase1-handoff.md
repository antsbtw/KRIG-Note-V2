# 邮箱模块 阶段 1 交接 — IMAP 同步(migration 卡点已解,待真机验收)

> 2026-08-27 立 · 2026-08-28 更新(migration 卡点已解)
> 分支 `feature/mail-module`(未合 main)
> 设计总纲见 [2026-08-26-mail-module-design.md](./2026-08-26-mail-module-design.md)

## 一句话

**阶段 0(webview)已全部验收通过;阶段 1(IMAP)的 migration 卡点已于 2026-08-28
定位并修复 —— 三张表已建出。** 下一步是真机跑 §6 验收清单(测试连接 → 同步)。

---

## 1. ~~当前卡点~~ 已解决(2026-08-28)

### 真因:DDL parse error 让**整段** migration 被服务端拒收

```
DEFINE FIELD IF NOT EXISTS attachments ON mail TYPE option<array> FLEXIBLE;
                                                                 ^^^^^^^^
Parse error: FLEXIBLE can only be used with types containing object
```

SurrealDB 3.x 的 `FLEXIBLE` 只接受「类型里含 object」的字段。
修法:`option<array<object>> FLEXIBLE`(attachments 本来就是对象数组)。

### 为什么查了一整轮(两条放大器 + 一个假象)

1. **parse error 会让整段 DDL 被拒,不是只跳过出错那一条**。
   45 条 DDL 错 1 条 → 三张表一张都建不出来。
2. `main/index.ts:127` 对 `initStorage()` 的 catch 只 `console.error` 就放行,
   app 照常起来,报错淹没在启动日志里 → 现场表现成「migration 根本没跑」。
   **已修**:`runner.ts` 改成单条 migration 失败 fail loud + rethrow,
   并停在第一个坏 migration(后续 migration 常依赖前一个建的表)。
3. ⚠️ **假象**:`mail_account` 表当时**存在**,于是「表建了一半」看着像
   migration 跑到一半崩了。真相是它由业务代码 `INSERT INTO mail_account`
   触发 SurrealDB 自动建的 **schemaless** 表,跟 migration 无关。
   判据:`INFO FOR TABLE x` 显示 **0 字段 0 索引 = 自动建的,不是 migration 建的**。

### 三个假设的结局

| 假设 | 结论 |
|---|---|
| A 库版本已 ≥1.8.8 被跳过 | ❌ 否。实测最高版本 1.8.7,`schema_version` 里没有 1.8.8 |
| B migration 抛错被吞 | ✅ **就是它** |
| C app 跑的是旧代码 | ❌ 否 |

### 排查捷径(以后同类问题直接用)

app 在跑时**直接打 HTTP 问库**,别靠读代码脑补:

```bash
PW=$(python3 -c "import json;print(json.load(open('$HOME/Library/Application Support/KRIG Note V2/.db-credentials'))['password'])")
curl -s -X POST http://127.0.0.1:8533/sql -u "root:$PW" \
  -H 'Accept: application/json' -H 'surreal-ns: krig' -H 'surreal-db: krig_note_v2' \
  -d 'INFO FOR DB;'
```

- `INFO FOR DB` — 表在不在
- `INFO FOR TABLE mail` — 字段/索引数(0 字段 = 自动建的 schemaless 表)
- `SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 5` — 版本
- 整段 DDL 用 `--data-binary @file` 打过去,服务端会报出第几行第几列错

### 本轮改动

| 文件 | 改动 |
|---|---|
| `storage/surreal/schema.ts` | `attachments` 改 `option<array<object>> FLEXIBLE`(+ 防回退注释) |
| `storage/surreal/schema.ts` | 补 DEFINE `mail_account.account_id` / `mail.mail_id` + UNIQUE 索引 —— 这两个业务 ULID 代码在写也在查,SCHEMAFULL 表里却没声明(本版本实测不丢数据,但属隐性依赖)。铁律:SCHEMAFULL 表里凡代码会写/会查的字段都要显式 DEFINE |
| `storage/migrations/runner.ts` | 单条 migration 失败 fail loud + rethrow,不再让半应用状态静默放行 |

三张表已用修正后的 DDL 应用到本机库(49 条语句全绿,已有账号行完好)。
`schema_version` 的 1.8.8 行留给下次正常启动写入(migration 幂等,会自然补上)。

---

## 2. 已完成 / 已验收

### 阶段 0(webview 薄壳)—— 真机全部验收通过 ✅

| 项 | 状态 |
|---|---|
| 📧 Mail 入口(navSide order 7)+ 四家服务商切换 | ✅ |
| Gmail 登录态(复用 `persist:webview-${ws}` partition) | ✅ |
| 右键**只弹一个菜单**(`shouldHandle` 那条加对了) | ✅ |
| 提取单封邮件 → note + 左右对照布局 | ✅ |
| ⊞ 开右栏(复用全局 SlotPicker) | ✅ |
| ⚙ 账号弹窗(从 navSide 挪来) | ✅ |

### 阶段 1(IMAP)—— 代码完成 + 建表已通,IMAP 链路待真机验收 ⚠️

已写完:
- `migration 1.8.8`:mail_account / mail / mail_sync_state 三表
- `imap-client.ts`:连接 + 六类错误分类文案
- `mail-sync.ts`:增量同步(UIDVALIDITY 校验 + UID > last_seen_uid)
- `credential-store.ts`:safeStorage 加密,密码不入 DB
- `mail-repo.ts`:三表 CRUD
- 账号面板 UI(⚙ 弹窗):新建 / 测试连接 / 同步 / 改密码 / 删除

**还没成功连上过 Gmail** —— 此前卡在 §1 的 migration 问题(已解)。
三张表已建出,下一步就是按 §6 走一遍:测试连接 → 同步。

---

## 3. 已排除的可能(别重复排查)

排查这条链路烧了很多轮,以下都**已确证不是问题**:

| # | 曾怀疑 | 结论 |
|---|---|---|
| 1 | Gmail IMAP 没启用 | ✅ 已启用。Google 近年默认开启且不再提供关闭开关,设置页只有细则没有 enable 单选框 —— 看不到开关是正常的,不是没开 |
| 2 | 网络 / 端口被拦 | ✅ 通。离线实测 DNS→TCP 993→TLS 握手→Gmail greeting 全部成功 |
| 3 | 应用专用密码没生成 | ✅ 已生成(名为 krig-note),两步验证已开 |
| 4 | 密码填错 | ⚠️ **是**,但已修 —— 见下 |

### 坑 1:应用专用密码带空格(已修 `ca1e23ad`)

Google 显示成 `abcd efgh ijkl mnop`,用户复制必然带空格,IMAP 认证要连续 16 字符。

**确证方式**(值得记下来,以后同类问题可复用):用 app 存的真实凭据离线直连,
解出明文长度 **19**(16+3 空格)、`含空格: 是`、服务器回 `Invalid credentials`。
比反复猜快得多。

修法:表单层 + `credential-store` 写库必经处**双层** `replace(/\s+/g,'')`。

### 坑 2:测试连接崩掉主进程(已修 `083625c4`)

`imapflow` 的 `client.connect()` 失败时,error 事件若无监听器会成为 uncaught
exception 打崩主进程。且错误信息只剩 `Command failed`(真实原因在 `responseText`)。

修法:挂 error 监听器 + 从 `e.responseText` / `e.authenticationFailed` 取真因。

### 坑 3:⚠️ Vite HMR 只热更 renderer

**这条骗过一次,浪费了整轮排查。**

日志里 `[vite] hmr update .../AccountPanel.tsx` 看起来像"改动生效了",
但同时报 `No handler registered for 'mail.account-set-password'` ——
主进程跑的还是旧代码,新加的 IPC handler 根本不存在。

**主进程改动(`src/platform/main/**`)必须 Cmd+Q 完全退出重启**,
关窗口 / 刷新窗口都不行。

---

## 4. 架构决策(已拍板,别推翻重议)

| # | 决策 | 出处 |
|---|---|---|
| D1 | webview 给人用(看信发信复杂操作),IMAP 给机器用(结构化数据喂 Gemma) | 设计文档 |
| D2 | 两条通路**不做同步**,IMAP 的 UID+flags 就是对账机制 | 设计文档 |
| D3 | 第一版**不依赖 OAuth**,用应用专用密码(零外部依赖) | 用户 2026-08-26 |
| D4 | 邮件是独立实体,显式归档到 note(不全量 block 化) | 用户 2026-08-26 |
| D5 | 账号配置放 **toolbar ⚙ 弹窗**,不放 navSide(窄栏放不下表单) | 用户 2026-08-27 |
| D6 | `activeService` 保持 **per-ws**,不 per-slot(双开不同邮箱经确认不需要) | 用户 2026-08-27 |
| D7 | 归档走 Defuddle→markdown→`import-orchestrator`,**不造第四个转换器** | 对齐 markdown-import-unify |

### 用户明确提过但押后的

- **邮件专有 note 格式(mailBlock)**:用户说「我再思考」。押后理由 = 阶段 0 的
  DOM innerText 是半成品,阶段 1 IMAP 拿到完整 MIME 会改变输入形态,
  现在设计块结构大概率重做。立项时机 = IMAP 落地 + mail 表字段稳定后。

---

## 5. 代码地图

### 新增文件

```
src/shared/types/mail-service-types.ts     Profile + detectMailServiceByUrl(URL 判定唯一来源)
src/shared/types/mail-types.ts             MailAccount / MailRecord / MailSyncResult 等

src/platform/main/mail/
  ├── webview-registry.ts                  createWebviewServiceRegistry 实例(只导 track)
  ├── webview-hook.ts                      did-attach-webview + 右键菜单
  ├── mail-webcontents.ts                  按 ws 定向取 guest(fail loud,不回退全局)
  ├── mail-extract.ts                      阶段 0:坐标定位 + 抓单封
  ├── imap-client.ts                       阶段 1:连接 + 错误分类
  ├── mail-sync.ts                         阶段 1:增量同步
  ├── credential-store.ts                  safeStorage 加密(密码不入 DB)
  ├── handlers.ts / handlers-sync.ts       IPC handlers
  └── index.ts
src/platform/main/db/mail-repo.ts          三表 CRUD

src/capabilities/mail-service/             renderer 门面(Host + API alias)
src/views/mail/                            MailView + 命令 + ⚙ 账号弹窗
```

### 改动的既有文件(6 处接线)

1. `web-shared/should-handle.ts` — **加了邮箱 URL 排除**(不加会双右键菜单)
2. `main/index.ts` — `setPerWindowWebviewHooks` 加 `registerMailWebviewHook`
3. `main/ipc/ipc-bus.ts` — 注册 handlers
4. `shared/ipc/channel-names.ts` — MAIL_* 通道
5. `main/preload/main-window-preload.ts` + `shared/ipc/electron-api.d.ts`
6. `platform/renderer/index.tsx` — capability / view / commands 三处 import

---

## 6. 阶段 1 跑通后的验收清单

⚠️ **先 Cmd+Q 完全退出 app 再 `npm start`**(坑 3:主进程改动不走 HMR)。
启动日志应看到 `[storage/migrations] applying 1.8.8:` 且其后**无**报错。

然后按顺序验:

1. **添加账号** → 填 Gmail + 应用专用密码(空格随便粘,代码会去掉)
2. **测试连接** → 期望「连接正常,共 N 个文件夹」
3. **同步** → 期望「本次新增 N 封 · 本地共 M 封」
4. **删除账号** → 期望能删掉(现在已容错,不会被表不存在阻断)

已知限制(设计如此,非 bug):
- 单次同步上限 **200 封**(防首次同步卡死),你的收件箱 1341 封需点多次
- 只同步 **INBOX**,多文件夹选择留阶段 2

---

## 7. 后续阶段(未开工)

- **阶段 2**:原生邮件列表 view(基于 mail 表)。⚠️ 写 `handleClose` 前先看
  memory「别猜自己在哪一栏」——必须用 `ViewComponentProps.slot`,不许反推
- **阶段 3**:SMTP 发信 + 归档到 note(走 D7 那条链路)
- **阶段 4**:Gemma 接入。⚠️ `mail_verdict` 的 `ai_verdict` 快照字段**第一天就要有**
  ——直接抄 `tweet_feedback` 1.8.7 的教训,别等人工标注覆盖了 AI 原判再补
