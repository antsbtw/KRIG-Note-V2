# 交接 Prompt — X 通知采集丢数据问题

> 生成于 2026-09-03。**交给新对话执行。**
> 分支 `feature/x-phase-b`,已全部推送(73 个 commit 未合 main)。

---

## 0. 一句话任务

**通知采集会丢数据。** 找出丢在哪、为什么,修掉。

用户原话:「目前发现获取 notification 还有问题,会丢数据。」

---

## 1. 必读(按顺序)

| 文档 | 为什么 |
|---|---|
| [`data-acquisition-capability-survey.md`](data-acquisition-capability-survey.md) §3.1 | 通知页载荷的**实测结构**,含与社区库(twikit)的关键差异 |
| [`X爬虫同步契约.md`](X爬虫同步契约.md) | 对接方契约。§2.1 字段定义、§4 判定规则 |
| [`campaign-deploy-windows.md`](campaign-deploy-windows.md) | Windows 部署与联调,含交叉编译的坑 |

**记忆条目**(自动加载):`feedback-check-sample-contains-phenomenon`(⚠️ 本轮反复踩)、
`feedback-dont-guess-look-at-real-data`、`feedback-verify-guard-can-fail`、
`feedback-fail-loud-no-fallback`、`project-x-integration-status`

---

## 2. 当前架构(已实测跑通的部分)

```
X 通知页(webview,per-ws 登录)
  ↓ CDP Network 拦截 NotificationsTimeline 载荷
x-notifications.ts     extractInteractions() 解析
  ↓
x_interaction 表       幂等键 (kind, actor_uid, target_id)
  ↓
verifyListForArticle() 按三条判据归属到活动文章
  ↓
x-campaign-push.ts     推给 campaign-tasks(契约接口 A)
```

**主循环**:`x-campaign-loop.ts`,每 3 分钟一轮,通知页驱动。
**实时监听**:`x-notification-watch.ts`,给人核对用(不导航、不滚动)。

### 2.1 已验证可用

- 通知页给**具名**互动:`from_users[]` 带 rest_id + handle
- `target_objects[]` 带**完整推文对象**(conversation_id / extended_entities / quoted_status_id)
- 四种行为实测到:like / retweet / follow / reply
- 归属三判据:`target_id` == 文章 / `conversation_id` == 文章 / **`quoted_status_id` == 文章**
- 接口 A/B 实测通过(401/429/health 都对)

---

## 3. ⚠️ 丢数据的**已知嫌疑**(未定论,按优先级)

### 3.1 聚合通知只给一条代表推 ← **最可疑**

实测文案与实际条数对不上:

```
「KRIG Note liked 4 of your posts」→ target_objects 只有 1 个
「KRIG Note reposted 2 of your posts」→ target_objects 只有 1 个
```

用户当时说「点赞就以爬下来 item 就可以了」,故**暂未处理**。
但如果现在的丢数据指的是这个,就必须解决 ——
可能要点开单条通知拿完整列表,或找别的接口。

### 3.2 滚动/等待参数可能过早收工

`x-notifications.ts` 里三个数,都没有实测依据:
- `maxRounds = 20`
- `noGrowth >= 4` 就 break
- 首个载荷等待 `10~15s`

**⚠️ 本轮在时间线采集上栽过完全一样的坑**:
「连续 N 轮无新数据就停」把 83% 的数据判没了(见 commit `a9d9bc75`)。
通知页很可能重蹈覆辙 —— **优先查这个**。

### 3.3 幂等键可能过严

`(kind, actor_uid, target_id)`。若同一人对同一推**多次**互动
(取消赞再赞),第二次会被判成"已存在"而丢弃。

### 3.4 主循环与手动操作抢 webview

已加 45s 暂停(commit `2b36a31e`),但**暂停期内的通知是否补得回来**没验证过。

---

## 4. 排查方法(务必按此,别猜)

### 4.1 先看原始载荷,不要读代码猜

每次抓取都会落盘:
```
%APPDATA%\KRIG Note V2\x-payload-survey\notif-<时间>.json
```

拉回本地对照:
```bash
scp win-desktop:"C:/Users/ants.btw/AppData/Roaming/KRIG Note V2/x-payload-survey/notif-*.json" /tmp/
```

**判据**:载荷里有 N 条,库里有 M 条,N ≠ M 就是解析丢了;
N 本身就少,则是采集(滚动/等待)丢了。**这两者必须分开定位。**

### 4.2 用实时监听面板看过程

X Inbox → ⚙ 活动配置 → **👁 实时监听通知**。

它显示每条通知的:原始文案 / 操作者 / 目标推 / 归属判定与理由 /
「上次收到载荷 N 秒前」。

**这是用户明确要求的核对方式** ——
「作为人类是无法通过肉眼来识别你给出的结果是否正确」。
不要再只给算好的结论,要给过程。

### 4.3 查库

```bash
ssh win-desktop '$pw=(Get-Content "$env:APPDATA\KRIG Note V2\.db-credentials" -Raw|ConvertFrom-Json).password;
$b64=[Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("root:$pw"));
$h=@{Accept="application/json";"surreal-ns"="krig";"surreal-db"="krig_x";Authorization="Basic $b64"};
$r=Invoke-RestMethod -Uri "http://127.0.0.1:8533/sql" -Method Post -Headers $h -Body "SELECT * FROM x_interaction;";
foreach($x in @($r.result)){Write-Output ($x|ConvertTo-Json -Compress)}'
```

---

## 5. 本轮反复踩的三个坑(别再犯)

| 坑 | 教训 |
|---|---|
| **拿不含该现象的样本论证现象缺失** | 我据几天前的旧载荷断言「转发未验证」,而活库里就有。**先查活库**。犯了至少 3 次 |
| **「连续 N 轮无新数据就停」** | 时间线采集因此丢 83%。滚动类判据必须实测覆盖率,不能想当然 |
| **采集层过滤 = 永久丢数据** | 用户:「不要过滤,入库后前端就可以请求了」。取舍交给查询层 |

还有一条方法论,用户说得很直接:
> 「按照你给出的方法,作为人类是无法通过肉眼来识别你给出的结果是否正确。」

→ 给**过程**,不要只给结论。守卫要能真的失败(反向注入验证)。

---

## 6. 工作方式

- **分支**:`feature/x-phase-b`(已推送,勿合 main)
- **构建**:`KRIG_TARGET_PLATFORM=win32 npx electron-forge make --platform=win32 --arch=x64`
  ⚠️ 那个环境变量**不能省**,否则 surreal.exe 不进包(见部署文档 §0)
- **部署**:scp 到 `win-desktop`,解压到 `%USERPROFILE%\KRIG-Note`,
  **每次用 SHA256 核对本地与远程 app.asar 一致**
- **测试**:`npx vitest run tests/x/`(当前 296 项全绿)
- 改完守卫必须**反向注入**验证能变红

---

## 7. 起手第一句

建议新对话这样开场:

> 读 `docs/10-business-design/x/HANDOFF-notification-capture.prompt.md`,
> 先拉最新的 notif-*.json 原始载荷,对比载荷条数与库里条数,
> 定位丢数据发生在采集层还是解析层。先给结论再改代码。
