# 邮箱模块 阶段 1 交接 — IMAP 同步卡在 migration

> 2026-08-27 · 分支 `feature/mail-module`(11 commits,未合 main)
> 设计总纲见 [2026-08-26-mail-module-design.md](./2026-08-26-mail-module-design.md)

## 一句话

**阶段 0(webview)已全部验收通过;阶段 1(IMAP)代码写完但跑不通 —— 卡在
migration 1.8.8 没生效,三张表没建出来。** 下一步是定位 migration 为什么没跑。

---

## 1. 当前卡点(接手第一件事)

### 症状

删除邮箱账号时弹窗报:

```
删除失败:The table 'mail' does not exist
```

### 已知

- `migration_1_8_8` **代码是对的**:`schema.ts:717` 定义了 up 函数,
  `SCHEMA_VERSION_1_8_8`(schema.ts:667)确实 DEFINE 了三张表,
  末尾也 UPSERT 了 schema_version(这两条是历史上最常漏的,已排除)
- `runner.ts:8` import 了、`runner.ts:103-106` 注册进 MIGRATIONS 数组了
- 但运行时表不存在 → **migration 没被执行**

### 三个待验假设(按可能性排序)

**假设 A:库版本已 ≥ 1.8.8,migration 被跳过**
`runner.ts` 的逻辑是 `compareVersions(currentVersion, mig.version) < 0` 才跑。
若 schema_version 表里已有一条 1.8.8(比如某次跑到一半、表没建成但版本先写了),
之后永远不会重跑。

验证方法(app 运行时,DevTools console 或加临时 IPC):
```sql
SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 5
```
若已有 1.8.8 → 删掉那条记录重启,或临时把版本号改 1.8.9 重跑。

**假设 B:migration 执行时抛错被吞**
`runMigrations` 外层有 catch。若 `SCHEMA_VERSION_1_8_8` 里某条 DDL 语法错
(SurrealDB 3.x 对 `DEFINE FIELD ... TYPE option<array>` 之类挑剔),
会 throw → 表建了一半 → 但错误可能只 warn 没 fail loud。

验证方法:启动时看主进程日志有没有
`[storage/migrations] applying 1.8.8:` 这一行,以及紧随其后的报错。

**假设 C:app 跑的是旧代码**
⚠️ 这个已经骗过一次(见 §3 坑 3)。Vite HMR 只热更 renderer,
主进程改动必须 **Cmd+Q 完全退出重启**。若上次没真正重启,
migration 代码根本没进主进程。

### 建议排查顺序

1. 完全退出 app(Cmd+Q),重新 `npm start`
2. 看主进程日志有没有 `applying 1.8.8`
3. 有 → 看紧随的报错(假设 B);没有 → 查 schema_version 表(假设 A)

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

### 阶段 1(IMAP)—— 代码完成,链路未跑通 ⚠️

已写完:
- `migration 1.8.8`:mail_account / mail / mail_sync_state 三表
- `imap-client.ts`:连接 + 六类错误分类文案
- `mail-sync.ts`:增量同步(UIDVALIDITY 校验 + UID > last_seen_uid)
- `credential-store.ts`:safeStorage 加密,密码不入 DB
- `mail-repo.ts`:三表 CRUD
- 账号面板 UI(⚙ 弹窗):新建 / 测试连接 / 同步 / 改密码 / 删除

**从没成功连上过 Gmail** —— 卡在上面的 migration 问题。

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

migration 修好后按顺序验:

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
