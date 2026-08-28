# 邮箱模块 阶段 1 — ✅ 全部验收通过(2026-08-28)

> 2026-08-27 立 · 2026-08-28 阶段 1 收工
> 分支 `feature/mail-module`(未合 main)
> 设计总纲见 [2026-08-26-mail-module-design.md](./2026-08-26-mail-module-design.md)

## 一句话

**阶段 0(webview)与阶段 1(IMAP 只读同步)均已真机验收通过。**
真机实测:2074 封邮件与服务端完全对平、删账号三处孤儿清净。可以开阶段 2。

---

## 1. 本轮修掉的五个 bug(2026-08-27 → 08-28)

排查从「migration 看着没跑」开始,一层层剥出五个独立缺陷。**共同教训:
每一个都是"看起来成功了"而实际没有** —— 详见每条的判据。

| # | 症状 | 真因 | commit |
|---|---|---|---|
| 1 | 三张表一张没建,像 migration 没跑 | `option<array> FLEXIBLE` 是 **parse error** → **整段 DDL 被服务端拒收**(不是只跳过这一条)。放大器:`main/index.ts` 对 initStorage 的 catch 只 console.error 就放行 | `b7779894` |
| 2 | 点「同步」屏幕毫无反应 | 同步/测试/改密码三个结果块并列渲染、互不排斥,各自只清自己那格 → 上次「连接正常」一直挂着 | `86e59a2f` |
| 3 | 整批 INSERT 全挂,一封落不了库 | `option<T>` 只认 `NONE` 不认 `NULL`;SDK 绑定 `undefined→NONE`、`null→NULL`。9 处 `?? null` 全是 bug | `2bafd96b` |
| 4 | 附件带 cid 写不进 | `DEFINE FIELD` 自动派生的 `attachments.*` **不继承 FLEXIBLE**;且它已占位,`IF NOT EXISTS` 会被**静默跳过** → 必须 REMOVE 再 DEFINE | `bb305a88` |
| 5 | 2074 封只同步到 201 封就不动,UI 却报成功 | 取「最新 N 封」+ 游标只向上推进 = 更旧的邮件**永远够不着**(静默丢数据) | `7d02556a` |
| 5b | 拉完了仍提示「可继续同步」 | 触底判据假设服务端最小 UID=1,但删信会留 UID 空洞(真机最小是 2) | `ec1cd4be` |

### 排查捷径(以后同类问题直接用)

**app 在跑时直接打 HTTP 问库,别靠读代码脑补**:

```bash
PW=$(python3 -c "import json;print(json.load(open('$HOME/Library/Application Support/KRIG Note V2/.db-credentials'))['password'])")
curl -s -X POST http://127.0.0.1:8533/sql -u "root:$PW" \
  -H 'Accept: application/json' -H 'surreal-ns: krig' -H 'surreal-db: krig_note_v2' \
  -d 'INFO FOR DB;'
```

- `INFO FOR DB` — 表在不在
- `INFO FOR TABLE mail` — 字段/索引(**0 字段 = 业务 INSERT 自动建的 schemaless 表,
  不是 migration 建的**;本轮就因这个假象被带偏一轮)
- 整段 DDL 用 `--data-binary @file` 打过去,服务端会报出第几行第几列错
- JS 侧行为(如 `undefined` vs `null` 怎么绑定)写个 .mjs 连 ws:// 实测,
  **脚本必须放仓库内**否则模块解析不到

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

### 阶段 1(IMAP 只读同步)—— 真机全部验收通过 ✅

| 验收项 | 结果 |
|---|---|
| 添加账号 | ✅ |
| 测试连接 | ✅ 连接正常,共 9 个文件夹 |
| **同步** | ✅ **本地 2074 / 服务端 2074 完全对平**,零重复(2074 行 = 2074 个唯一 UID) |
| 删除账号 | ✅ 三处孤儿全清:mail 2074→0、游标 1→0、账号 1→0、safeStorage 凭据 1→空 |

数据质量(2074 封全量抽查):标题 / 发件人 / 正文 / 日期 **零缺失**;
33 封带附件、40 个附件明细,**其中 3 个带 cid**(即坑 4 那个修复的真机验证)。

回填收敛轨迹:游标 1881→1575→1132→789→540→321→75→2,最后一轮 +74 收尾。

⚠️ **2074 不是 1341**:Gmail 网页按**会话**折叠显示 1341,IMAP 按**单封**计。
服务端 EXISTS 就是 2074,别再拿网页上的数字当对账基准。

UID 有 624 段空洞、共 1046 个空缺 —— 那是**删信留下的**(UID 只增不复用),
不是回填漏批。判据:漏批会是少数几个连续 200 长的大段,不是几百个小段。

已写完的模块:
- `migration 1.8.8/1.8.9/1.9.0`:三张表 + attachments 元素放行 + 回填游标
- `imap-client.ts`:连接 + 错误分类 + fetchSince/fetchBefore(共用 fetchRange)
- `mail-sync.ts`:双向游标同步(追新 + 回填)+ 与服务端 EXISTS 对账
- `credential-store.ts`:safeStorage 加密,密码不入 DB
- `mail-repo.ts`:三表 CRUD
- 账号面板 UI(⚙ 弹窗):新建 / 测试连接 / 同步 / 改密码 / 删除

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

## 6. 已知限制(设计如此,非 bug)

- 单次同步上限 **200 封**(`MAIL_SYNC_BATCH_LIMIT`,唯一来源在 `shared/types/mail-types.ts`
  —— renderer 也要显示这个数字,别在主进程侧另立常量)。2074 封约需 10 轮。
- 只同步 **INBOX**,多文件夹选择留阶段 2。
- 已归档到 note 的邮件:删账号只删 `mail` 表记录,**不删 note**(符合 D4,
  note 一旦生成就是用户的笔记)。

## 7. 后续阶段(未开工)

- **阶段 2**:原生邮件列表 view(基于 mail 表)。⚠️ 写 `handleClose` 前先看
  memory「别猜自己在哪一栏」——必须用 `ViewComponentProps.slot`,不许反推
- **阶段 3**:SMTP 发信 + 归档到 note(走 D7 那条链路)
- **阶段 4**:Gemma 接入。⚠️ `mail_verdict` 的 `ai_verdict` 快照字段**第一天就要有**
  ——直接抄 `tweet_feedback` 1.8.7 的教训,别等人工标注覆盖了 AI 原判再补
