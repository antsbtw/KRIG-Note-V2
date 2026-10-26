# Module5-04 · 能力层重构:资源锁 / 能力契约 / 统一结果 / 流程(2026-10-23)

> 状态:**已定方案,未开工**。这是 [Module5-03](Module5-03-ai-workbench-framework.md) P1 的细化,也是交接文档 ——
> 新对话只读本文即可接着做,不需要回看原对话。
> 执行记录按 [Module5-01 §6](Module5-01-workflow-model.md) 9 月的决定:独立库 `krig_flow`。
> 分支:`feature/x-blue-mutual-phase4`(截至 ed7d47fd 之后)。

## 0. 用户原话(定方向)

- 看到「三个入口」时:「这是一个大问题,请再仔细分析一下。」
- 看完分析:「我觉得要做抽象吧,这么乱的代码很麻烦的呀,对吗?」
- 「同意,按照9月的决定来优化,是否先出一个优化文档,这样不会因为对话的长度而导致第二个对话由乱了。」
- 前情(Module5-03):「先构建基础组件,让AI可以调用工作台的任何功能,从输入、控制、输出三个内容」;「先一切皆可为,后面才收紧」。

## 1. 现状诊断(2026-10-23 逐行核对,路径相对 `src/modules/x/`)

### 1.1 四条调用路(不是三条)

| 路 | 在哪 | 规模 |
|---|---|---|
| ① 界面 → 主进程 | `x-data-ipc.ts` 一个 `switch (p.op)` | 75 个 op |
| ② 开发收件箱 | `x-dev-inbox.ts` 自己的 `validate()` 白名单 + 自己的分发 | 16 个 op |
| ③ 主进程定时器 | `x-bg-runner.ts`(120s)· `x-daily-upkeep.ts`(10min)· `x-follow-queue.ts`(2s)· 收件箱轮询(3s) | 4 个 |
| ④ **界面组件自己干活** | React 里直接 `window.electronAPI.webDomInvoke`、自己串流程 | 主进程**调不到** |

④ 里的业务逻辑(主进程 / 定时器 / 以后的 AI 一概够不着):
- 取关 `x-unfollow-run.ts:47 unfollowOnce`、点人核对 `:86 readProfileAndRefresh`、三处合一的忙检查 `:23 xPageBusy`
- 互动前先过一轮 `XTaskEngage.tsx startEngage`;求助帖判断循环 `XTaskVpn.tsx judgeAll`;「找蓝V → 扫互关倾向」`XTaskBlueMutual.tsx findOnce`
- 采一个人主页的整套重试 `XOpsPeople.tsx collectTweets`;取关异常即停(只是 React 状态)
- 求关 / 互动 / 求助回复卡的整个流程 `XTaskAsk.tsx`(准备 → 草拟 → 发送 → 自动下一个 → 跟着左边走)

### 1.2 前提检查写在调用方 → 每条路不一样

| 同一个功能 | 走界面 | 走收件箱 / 定时器 |
|---|---|---|
| 读左边那条 `readLeftTweet` | 查忙(`x-data-ipc.ts:539`),不查后台采集 | 收件箱**不查忙也不查后台**,还能先跳转(`x-dev-inbox.ts:188-194`) |
| 采主页 `collectPersonTab`(本身只有一个会抛错的 live 锁 `x-person-collect.ts:54`) | 界面组件查忙并在 **renderer** 标忙 | 收件箱查了**不标忙**(`x-dev-inbox.ts:111-117`);同文件 userList 却标(:133) |
| 搜索 `collectSearchByScroll` | 界面「再找一轮」**不查额度** | 采互动 / 找求助帖查额度(`x-engage-collect.ts:25`、`x-vpn-run.ts:38`) |
| 参数校验 | 校验数字 id、limit 范围 | 收件箱 engage / vpn 一组只校验 wsId(`x-dev-inbox.ts:75-77`) |
| 留痕 | traceRecorder | 收件箱只写结果文件;定时器只 console |

### 1.3 两个真 bug

1. **「忙」被别人删掉**:主进程一个网页只记一个原因(`x-host-registry.ts:86-94`),renderer 的忙经 `syncBusy` 同步过来**直接覆盖 / 清除**(`x-data-ipc.ts:688-691`,`x-host-sync.ts` 单向且自己缓存已发)。例:后台查回关标了忙 → 操作台点采集盖掉 → 操作台结束清掉 → 查回关还在跑,后台采集 / 关注队列看不见忙,可能抢网页。
2. **卡片采主页时不标忙**:`prepareAsk` / `prepareEngage` / `screenEngage` / `prepareVpn` 只查别人忙不忙,自己采的那几秒不登记 → 巡检(查回关 / 关系采集 / 采互动)或后台采集到点就可能把网页带走,卡片采到的不是这个人。

### 1.4 重复实现

- 关注:主进程两份(`x-follow-queue.ts:97-121` 等歇完 / `x-ask-run.ts:150-160` 只提醒),取关第三份在 renderer(`x-unfollow-run.ts`)
- 刷新一个人资料三份:IPC `refreshPerson`(留痕 + 采集账)/ `x-relation-task.ts:71-84`(都没有)/ `x-account-repo.ts:106-116`
- 存人存推的采集账有的写有的不写、有的抛有的吞(`x-save-page.ts:28` 抛;`x-follow-check.ts:79`、`x-person-list-collect.ts:115` 不写)

### 1.5 结果格式十几种

`{status}`(IPC)· `{ok, why}` · `{ran}`(查回关)· `{blocked}`(求关 / 取关)· `{kind: miss|same|changed|new}`(核对)· `{reached}` 或抛错(采主页)· `{kind: ok|needIdentify|error}`(认号)· 哨兵 `left: -1`(判断在跑)· 直接抛错 ……
IPC 层有时把 `ok:false` 转成 failed、有时包在 ok 里;定时器把「被拒」当「做过了」(`x-daily-upkeep.ts:36-44`,网页忙没跑也占掉 10 分钟)。

### 1.6 根因

**没有「能力」这一层。** 函数只是零件;「做之前要满足什么、做时要占住什么、做完记什么、结果长什么样」靠每个调用方自觉 —— 入口越多抄漏越多;再加上流程写在界面里,后台和 AI 够不着。

## 2. 目标与判据

**目标**:AI 能做的 = 你能点的,且每一步可查(谁、何时、输入、结果、依据)。

**判据**(全部满足才算 P1 完成):
1. 任何功能从界面 / 定时器 / 收件箱 / AI 调,**前提检查、占锁、留记录、结果格式完全一样**(行为测试对三个入口各调一次断言一致)。
2. 左边网页同一时刻只有一个占用者;别人放不掉它的锁(测试模拟「查回关中操作台点采集」)。
3. 界面组件里不再有业务流程(没有 `webDomInvoke` 直调,没有循环调能力的逻辑);界面只显示和让人确认。
4. 每次执行在 `krig_flow.flow_step_run` 有一行,含被拒 / 失败的。
5. 关注 / 取关 / 刷新资料各只有一份实现。

## 3. 四个抽象 + 执行记录

### 3.1 资源锁(先做,修 §1.3)

- 主进程一份,资源键如 `page:<wcId>`、`search`(额度另算,见 3.2);锁记录 `{ owner: callId, purpose, since, caller }`。
- `acquire(resource, purpose, caller) → token | refused(被谁占着、干什么、多久了)`;`release(token)` 只有持有者能放;超时兜底要**响**(记日志 + 执行记录),不能静默过期。
- renderer **不再写忙**:界面要占网页 → 走能力 / 执行器(或过渡期一个 `acquire` op);`syncBusy` 退役。
- 后台采集的 `runningWc`(`x-bg-runner.ts:45-47`)并进这把锁。

### 3.2 能力契约 + 执行器

```ts
defineCapability({
  id: 'x.engage.prepare',          // 模块.对象.动作
  kind: 'input' | 'control' | 'output',
  describe: '给 AI 读的一句话',
  input: schema,                   // 校验在执行器做,调用方不做
  needs: ['page'],                 // 执行器上锁 / 放锁
  cost?: { searchPages?: number }, // 执行器查搜索额度账本(x-search-budget.ts)
  account?: 'read' | 'write',      // 执行器认号(统一一个函数)
  run: async (ctx, input) => ...,  // 只干活:不查忙、不记日志、不管结果格式
});
const r = await execute(id, input, { caller: 'ui' | 'timer' | 'inbox' | 'ai', subject_ref? });
```

- 执行器固定顺序:校验 → 认号 → 查额度 → 占锁 → run → 放锁 → 写 `flow_step_run` → 返回统一结果。
- 能力目录是平台层通用件(放 `src/platform/main/` 下,不认识 X);X 模块往里登记(删 X 目录即卸载,可装卸原则)。
- **先全开放**:网页能力层的通用操作(打开 / 读 / 滚 / 点 / 输入)也登记,不限 X(用户 10-22「先一切皆可为」)。
- 登记表要能列出来给 AI 读(id / kind / describe / input)。

### 3.3 统一结果

```ts
type Result<T> =
  | { ok: true; value: T; callId: string }
  | { ok: false; kind: 'refused' | 'failed' | 'invalid'; why: string; callId: string };
// refused = 没动手(网页被占 / 额度不够 / 号没认出);failed = 做了没成;invalid = 参数不对
```
定时器只在 `ok` 时算「做过了」;`refused` 下一轮再来。

### 3.4 流程(最后搬)

- 把 §1.1 ④ 的流程搬到主进程:步骤 = 能力调用;「等你确认」也是一种步骤(停住,界面显示,你点了才继续)。
- 沿用 Module5-01 定的「可重组步骤、不做分支」;要判断走哪条的交给 AI 层(Module5-03 ③)。

### 3.5 执行记录(9 月决定:独立库 `krig_flow`)

- 必须显式 `DEFINE DATABASE IF NOT EXISTS krig_flow`(connect 不会建库,9-01 在 krig_x 踩过)。
- `flow_step_run`:一次能力调用一行 —— `call_id / run_id?(属于某个流程时)/ capability / caller / input / output 摘要 / status(ok|refused|failed|invalid)/ why / ts / duration_ms / subject_ref`。
- `flow_run`:一次流程执行;`flow_template`:流程定义(第 4 步才用)。
- 跨库只存字符串 `subject_ref`(如 `x_tweet:<id>`),**不做跨库外键**;查询分两步。
- 被拒 / 被跳过的也记(Module5 §7)。
- 和 `x_action_log` 的关系:`x_action_log` 是「对 X 做了什么」的业务留痕(继续写);`flow_step_run` 是「系统跑了什么」—— 两张表(Module5-01 §6.4 的方法论:先问谁在用)。

## 4. 迁移顺序(每步单独可用;旧路先留着,迁一个删一个)

| 步 | 做什么 | 判据 |
|---|---|---|
| 1 ✅(10-23,Windows 测试机真机回归全过,见 step1-regression) | **资源锁**;4 个准备函数在采主页时上锁;`syncBusy` 退役;后台 `runningWc` 并入 | 测试:查回关持锁时操作台申请 → refused,且查回关的锁没被放掉;卡片准备期间巡检到点 → 让路 |
| 2 ✅(10-24,Windows 测试机真机全过,见 §7) | **能力契约 + 执行器 + 统一结果 + `krig_flow`**;先接 3 个形状差最大的:`x.engage.prepare`(占网页)、`x.vpn.find`(花搜索额度)、`x.engage.overview`(纯读库) | 三个入口各调一次,检查 / 锁 / 记录 / 结果一致;`flow_step_run` 有行(含 refused) |
| 3 ✅(10-25,四批都在 Windows 测试机真机过,见 §7) | **按批迁移其余能力**(读库类 → 采集类 → 输出类);收件箱改成「调任意能力」(白名单退役);定时器改走执行器 | x-data-ipc 的 switch 只剩转发;收件箱能调目录里任意能力 |
| 4 | **流程搬回主进程**:取关(+ 异常即停)、点人核对、互动前过一轮、求助帖判断循环、找蓝V+扫倾向、采主页重试、卡片流程 | 界面组件里没有 `webDomInvoke` 直调和能力循环 |
| 5 | **合并重复**:关注 / 取关 / 刷新资料各留一份;采集账写法统一 | grep 只剩一份实现 |
| 6 | **AI 网页一问一答**登记成能力(`platform/main/ai/ask-orchestrator.ts askAI` 先真机跑通;顺手修 `handlers.ts` 两个不传 wcId 恒空的接口) | 真机在已登录的 Claude 网页问答一次拿到完整回答 |

## 5. 规矩

- **不停用户在用的功能**:一个一个迁,迁完那个功能的三条入口一起改,旧代码删掉;不做一次性大重写。
- **先用真东西试形状**(第 2 步只接 3 个),形状定了再铺 —— 9 月那版设计一行代码没写、X 业务自己长出另一套,是前车之鉴。
- 守卫写完必须注入违规看它变红(记忆 feedback-verify-guard-can-fail);行为测试优先于源码扫描。
- 模块级状态每进程一份:锁只在主进程,renderer 只申请(记忆 feedback-per-process-module-state)。
- 先全开放后收紧;故障必响;外发动作(发帖 / 点赞 / 留言 / 关注)仍由人批复或在批过的规则内。
- 改主进程必须重启 app 再验(记忆 project-running-code-vs-source)。

## 6. 交接:新对话从哪开始

1. 读本文 + Module5-03 + Module5-01 §6。
2. 从第 1 步「资源锁」开始;先写失败的测试(查回关持锁时被操作台抢)再改。
3. 每步完成:跑 `npx vitest run tests/modules/`(`x-bg-runner.verify.test.ts` 依赖本机真库,失败属环境)、真机用开发收件箱自测、提交;本文对应步打 ✅ 并记真机结果。
4. 用户在用:求关卡 / 互动卡 / 求助回复卡 / 每天巡检 —— 每步都要确认这几样没坏。

## 7. 执行记录

### 第 1 步 资源锁 —— 2026-10-23 ✅ 完成(单测绿 + Windows 测试机真机回归全过)

**做了什么**
- 平台层通用锁 `src/platform/main/flow/resource-lock.ts`(不认识 X):`acquireLock / releaseLock(token) / lockHolder / holdsLock / revokeLocks / listLocks`。
  只有持有者能放;默认 TTL 1 小时,超时收回 `console.error`(执行记录等第 2 步)。
- X 薄壳 `src/modules/x/x-page-lock.ts`:资源键 `page:<wcId>`;`acquirePage / releasePage / pageBusy / holdsPage / revokePage / withPage`。
  被拒文案统一 `X 网页正忙:<在干什么>(<谁>,已 N 秒)`。
- 主进程全部占用者改走锁:查回关、关系采集读现状、关注队列、求关 / 互动 / 求助发送、认号、搜索滚动、收件箱(personTab / userList / leftTweet 原来查了不标或不查)、互动卡读来龙去脉。
- **4 个准备函数**(`prepareAsk / prepareEngage / screenEngage / prepareVpn`)采主页 / 读来龙去脉期间持锁(bug 2)。
- 后台 `runningWc` 并进锁(开跑一段时占 `后台正在采 @x`);`bgRunningOn` 删除,各处「后台在不在采」的单独检查一并去掉。
- renderer 不再写忙:`x-host-registry` 的忙表删除,`syncBusy / mainBusy / bgBusy` 三个 op 退役,
  换成 `pageAcquire / pageRelease / pageBusy`;renderer 封装 `acquireXPage / releaseXPage / xPageBusy`(x-unfollow-run.ts)。
  申请方窗口关掉 → 主进程收回它的锁;X 网页销毁 → 收回该网页的锁。
- 操作台:开采前申请,被占着不开采并在按钮旁说出是谁;搜索滚动带着自己的 token(`ownToken`)进去。

**测试** `tests/modules/x-page-lock.test.ts`(13 条):查回关持锁时操作台申请被拒、乱放一把放不掉、查完才空;
四个准备函数准备中巡检查回关让路、后台不开跑;抛错也放锁;后台在采时准备被拒。
先对旧代码跑过(接旧忙表)—— 9 条红;注入四种违规(prepareVpn 不上锁 / 谁都能放锁 / 后台不占锁 / 查回关不上锁)各自变红。
旧的源码守卫 8 个文件改钉新写法;x-task-view 里一处找不到时 -1 仍 `toBeLessThan` 的假绿顺手补了 `> -1`。

**没覆盖(留给后面几步)**
- 只跳一下的 `show / showInX`(XTaskEngage / XTaskAsk / XTaskVpn)仍是「先问 xPageBusy 再 goto」,不占锁 —— 第 4 步流程搬回主进程时一起收。
- IPC `leftTweet` 只问不占(只读 DOM,不跳转)。
- 定时器把「被拒」当「做过了」(`x-daily-upkeep.ts` 查回关让路也 return)—— 第 2 步统一结果后改。
- 锁超时 / 收回只打终端,还没进 `flow_step_run`(第 2 步)。

**留痕 + 对账(10-23 补)**:锁的占住 / 放掉 / 拒绝各打一行 `[lock]`;`node scripts/lock-report.mjs` 自动对账
(有没有两个任务同时占、有没有占了不放);体检报告多了 `x.page-lock`。
**真机回归**按 [Module5-04-step1-regression.md](Module5-04-step1-regression.md) 做 —— 用户只需重启 app 照常用,对账由 AI 读日志。

### 第 2 步 能力契约 + 执行器 + 统一结果 + krig_flow —— 2026-10-24 ✅ 完成

**做了什么**
- 平台层 `src/platform/main/capability/capability.ts`(不认识 X):`defineCapability / listCapabilities / execute`。
  固定顺序:校验 → 前提检查(prepare)→ 占锁(needs)→ run → 放锁 → `recordCall` → 统一结果(ok / refused / failed / invalid)。
  run 里没做成 `throw capFailed(why)`、不该做 `throw capRefused(why)`;别的异常算 failed 并响。被拒时资源叫什么由模块给(Need.label)。
- `krig_flow` 1.1.0:`flow_step_run` 加 `caller / call_id`;单次调用 run_id = call_id、seq = 1、step_type = 能力类别。写仍只在 `flow-run-repo.ts`。
- X:`src/modules/x/x-capabilities.ts` 登记 `x.engage.prepare`(占网页)、`x.vpn.find`(认号 + 额度 + 配方 + 整轮占网页,搜索带同一把锁 ownToken)、
  `x.engage.overview`(纯读库)。旧 `prepareEngage / findVpnPosts` 删除,只剩「只干活」的 `prepareEngageOn / findVpnPostsWith`。
- 入口:IPC 三个 op 只转发(`fromCap` 把统一结果转成 renderer 现在认的形状 —— 过渡);收件箱老 op 也走执行器,新增 `call`(调任意能力)/ `capabilities`(列目录)。
- 平台能力 `flow.calls.recent`:按能力 / 调用方 / 结果读最近的调用 —— AI 自己回看「系统跑了什么」。

**测试**:执行器 11 条 + X 三能力 11 条;注入 7 种违规各自变红(不放锁 / 被拒不记录 / 不查额度 / 搜索不带锁 / IPC 又自己认号 / 准备不占网页 / 没配方仍占网页);
DDL 在临时内存库实测(加字段 + 真写一行读回)。

**真机(Windows 测试机,2026-10-24)**:迁移 1.1.0 在真库跑成功;经收件箱 8 种调用结果都对;`flow.calls.recent` 读回 8 行,一次不少,含 refused / failed / invalid;锁对账 ✓。
真机发现并修了两处:没配方时先占网页才失败 → 改成 refused 不占网页;采互动的搜索锁上记 main → 带上真实调用方(巡检 = timer)。

**没覆盖 / 留给后面**
- 界面(ui)这条入口真机没点到(AI 点不了界面),靠单测 + 接线守卫;用户下次正常用互动卡后用 `flow.calls.recent` 看有没有 caller = ui 的行。
- renderer 还认旧 IPC 形状(`fromCap` 过渡);第 3 步铺开时一起改成认统一结果。
- 定时器还没走执行器(这三个能力都不在定时器上),第 3 步改。

### 第 3 步第 1 批 读库类(26 个)—— 2026-10-24 ✅ Windows 测试机真机过

- `x-capabilities-read.ts`:26 个纯读 op 登记成能力;IPC 用 op → 能力对照表 `CAP_OF_OP` 统一转发(连第 2 步的 3 个共 29 个 case 删掉)。
- 状态轮询(7 个:后台状态 / 后台任务 / 关系进度 / 节奏 / 名单 / 关注队列 / 采集进度)标 `probe`:记录照记、只留 7 天(用户 10-24 选「全记,只留 7 天」),
  成功不打终端(我的判断);`krig_flow` 1.2.0 加 `keep_days`,`flow-retention` 启动后清一次、每 6 小时一次。
- 真机:迁移 1.2.0 跑成功;26 个经收件箱各调一次,25 个 ok;**发现 1 个**:`x.people.query` 筛选条件不校验,跑进去才抛「不认识的分组」被记成 failed
  → 改成 parse 里校验(分组 / 范围 / 排序),没给的字段用默认值。
- ⭐ 界面入口真机验到了:那台底部后台状态条每 3 秒刷一次 → 记录里 23 行 `x.bg.status · ui · ok · keep_days 7`(第 2 步留的「ui 没真机点到」补上)。
- 教训:第一次提交只跑了新测试,7 条旧守卫(还在找已删的 case)红着就推了 → 加 `tests/modules/_x-ipc-wiring.ts`(ipcHandles / capOfOp / readCapBlock)修好;以后提交前跑全套。

### 第 3 步第 2 批 改自己的库(15 个,control)—— 2026-10-24 ✅ Windows 测试机真机过

- `x-capabilities-write.ts`:配方增删 / 游标存清 / 排除 / 标签 / 互关倾向 / 求助帖标注 / 放一放 / 草拟规则开关 / 后台任务建-停-续-删 / 改设置。
  `x-capabilities-common.ts`:认号 + 参数小工具 + `xCap` 构造器(读库 / 改库共用)。
- 改设置原来不校验就写(写进去才抛)→ 校验进 parse(invalid);暂停已完成的 / 继续没暂停的 / 任务不存在 → refused 不动库;改人 / 帖 / 任务 / 配方的记录带 subject。
- **不在这批**:关注队列(加了就去 X 上点关注 = 对外动作,放输出类那批过「人批复」的关);界面流程上报 `logAction / logPersonProgress / logPersonCollect`(第 4 步整个去掉)。
- 真机(新库,只改测试库):第 1 批修复生效(不带分组能查、分组写错 invalid);一轮 19 个 + 二轮 8 个调用结果都对
  (建配方→删、游标存→读→清→读空、标签打→目录里有→清、后台任务 建→停→再停 refused→续→取消→再停 refused、设置原值写 ok / 越界 invalid / 不认识 invalid);记录带 subject、不带 keep_days。
- 小不一致(记下,先不改):「目标不存在」有两种结果 —— 后台任务不存在是 refused(能力里先读),
  求助帖不在名单 / 草拟规则不存在是 failed(repo 里抛)。都不会重试成功;要统一时在能力里先读再判。
- 第二次又是改 IPC 时正则剪坏了文件(注释匹配跨过代码)→ 恢复后用「只匹配单个注释块」的正则重做,并核对删掉的 case 名单正好 15 个。

### 第 3 步第 3a 批 用网页的(9 个)+ 每天巡检走执行器 —— 2026-10-24 ✅ Windows 测试机真机过(巡检那条待自然到点)

- `x-capabilities-page.ts`:认号 / 查回关 / 关系采集 / 求关卡准备 / 求助卡准备 / 互动先过一轮 / 读来龙去脉 / 读左边那条(可先 open)/ 采互动。
  占网页从函数内部挪到执行器(`xCap` 加 `page` / `preflight`);函数只干活(`checkFollowBackOn / startRelationTaskOn / prepareAskOn / prepareVpnOn / screenEngageOn / collectEngagementWith`)。
- 认号例外:不声明占网页(多半只读页面就认出来);IPC 按徽章认的形状转 pending / failed。
- 查回关 / 关系采集分清 refused(正在查 / 认不出号)和 failed(跑了出错);定时器调 = auto。
- 每天巡检三件事 `execute(…, { caller: 'timer' })`;**被拒不再算做过**(§1.5),说「让路」接着看下一件。
- 真机:9 个各调一次都对(读左边先打开 / 来龙去脉 / 先过一轮 / 求关卡 / 关系采集 / 采互动 / 查回关;求助卡因新库没有名单 → failed「名单里这条没有作者」,对);
  冲突:模拟操作台占着 → 查回关 refused;求关卡准备中 / 采互动整段中 → 别人被拒(锁上写着「求关卡:准备 @…」「采互动(搜索)」);锁对账 ✓。
  界面入口:徽章启动时自动认号 3 次(网页没登记 → 页面在加载 → 认出)都走了执行器,caller = ui。
- 真机发现 1 个:认号时网页没开被 identifyAccount 判成 failed(别的能力都是 refused)→ 能力加 preflight,已修(32596977)。
- ⚠️ 巡检走执行器这条**真机没验到**:回归时三件事已经从收件箱做过,巡检到点都不需要做(一行不打,也对)。单测覆盖(含被拒接着看下一件);
  明天自然到点后用 `flow.calls.recent { caller: 'timer' }` 看。

### 第 3 步第 3b 批 采集流水线(10 个)+ 执行器「带锁进来」—— 2026-10-24 ✅ Windows 测试机真机过(带锁那条待界面触发)

- 执行器 `Need.reuse`:界面先占住网页再请主进程干活时带 token —— 只核对是持有者(不是 refused),不申请,不替它放。
- `x-capabilities-collect.ts`:搜索截获 / 人卡采主页 / 停止采集 / 刷新资料 / 存推文 / 存人 / 核对落库 / 抽查轮询(probe)/ 抽查查库 / 扫互关倾向。
- `x-save-batch.ts`:存推文 / 存人 / 记账本一份(原样从 IPC 搬出);核对落库不再绕回 IPC。搜索函数只接受带锁调用(ownToken 必填)。
- IPC switch 只剩 12 个:对外动作 3(askRun / followQueueAdd / followQueueControl)/ AI 2(vpnJudge / askDraft)/ 底座 4(syncHost / pageAcquire / pageRelease / pageBusy)/ 界面流程上报 3(log*)。
- 真机:搜索截获、采主页(不带锁 → 自己占自己放)都跑通;编的 token → refused「带来的锁不是它现在的持有者」;模拟操作台占着 → 搜索让路;
  采主页中别人被拒(锁上「采 @antsbtw x.profile」);老收件箱 searchScroll 指令走执行器;抽查 / 扫互关倾向(7813 人)/ 停止采集 ok;空记录 / 有人没 listSource → invalid;锁对账 ✓。
- ⚠️ 「带锁进来」**真机没验到**:要从界面发起(人卡「采推文」/ 操作台「采这一页」),收件箱拿不到界面的锁;靠单测(含编的 token 被拒的真机验证)。
  用户下次在人卡点采推文后,`flow.calls.recent { capability: 'x.person.collectTab', caller: 'ui' }` 看。

### 第 3 步第 4 批 AI 类 + 对外动作 —— 2026-10-25 ✅ Windows 测试机真机过

- 执行器:`kind: 'output'`(对外动作)只接受 ui / timer;AI / 收件箱 → refused「要人批复」(批复入口 P3,到时在执行器这一处放开)。
  `capFailed(why, partial)`:做了一半(求关:赞成了留言没成)→ 记 failed,卡片照样拿到哪步成了(IPC 把 partial 原样给它)。
- `x-capabilities-act.ts`:判求助帖(「已经有一轮在判」→ refused)/ 草拟留言(只给帖子 id 到库里读正文)/ 求关发送 / 关注队列 加入 / 继续(output)/ 暂停 / 清空(control);
  另补 `x.vpn.prune`。求关发送(runAsk)里的保护(网页锁 / 关注队列在不在动 / 每步核对)原样留在函数里 —— x-ask-run.test 钉着,没拆。
- IPC:switch 只剩底座 4(syncHost / pageAcquire / pageRelease / pageBusy)+ 界面流程上报 3(log*,第 4 步去掉);851 → 276 行。对照表值可为函数(关注队列按 action 分)。
- 收件箱:老指令全走执行器,`call` 可调目录里任意能力(白名单退役);userList / holdPage / parallel 留作开发工具。
- 真机:收件箱调求关发送 / 加关注队列 / 继续队列 → 全 refused「是对外动作,inbox 调用要人批复」,锁对账无任何网页占用(没碰 X);
  暂停 / 清空 / 状态 / 清过期 / 判(新库 0 条)ok;草拟如实 failed「本机还没装 gemma4:12b」(那台没装模型;只给 id 那条走到调模型这一步 = 读正文通)。
- 能力目录:**71 个**(input 43 / control 25 / output 3)。

### 第 3 步小结(2026-10-25)

- 判据「x-data-ipc 的 switch 只剩转发」✅;「收件箱能调目录里任意能力」✅;每天巡检走执行器 ✅(真机待自然到点)。
- 还在执行器外的定时器:后台采集(`x-bg-runner` 每段)、关注队列(`x-follow-queue` 每 2 秒)—— 它们自己占锁、只执行人排进来的事;
  要不要每段 / 每次关注也进执行记录,留到第 4 步和流程一起定。
- 真机没验到、待自然触发的三条:巡检走执行器(caller timer)、界面「带锁进来」(人卡采推文 / 操作台采集)、界面求关发送。

### 第 4 步 4a 业务界面不再直接驱动网页 —— 2026-10-26 ✅ Windows 测试机真机过

- `x-person-act.ts`(主进程):`verifyPersonOn` / `unfollowOn`,从 renderer 的 `x-unfollow-run.ts` 搬过来;renderer 那个文件只剩薄壳(verifyPerson / unfollowPerson / openInLeft / 占网页)。
- 能力:`x.page.open`(control)/ `x.person.verify`(input)/ `x.person.unfollow`(output)/ `x.unfollow.halt` / `x.unfollow.resume`。
- 修两个旧问题:① 任务页取关后的核对没占网页 → 同一把锁里做完;② 「异常即停」人卡和任务页各管各的 → 主进程按 workspace 一份。
- 判据之一「界面组件里没有 webDomInvoke 直调」:X 界面文件里只剩**操作台**(XConsole,13 处)——
  操作台是测试后台、将来隐藏(记忆 feedback-x-console-is-dev-backend),不在第 4 步范围(我的判断,用户可推翻)。
- 真机:左边打开推文 / 主页、核对 ok;有人占着 → 核对 refused;核对中别人被拒(锁上「核对 @…」);收件箱调取关 refused(对外动作);
  暂停 / 恢复能查能调;界面认号碰上网页没开 → refused(32596977 的修复真机确认)。⚠️ 界面取关 / 核对真机没点到,待日常使用。

### 第 4 步 4b 界面循环搬成流程 —— 2026-10-26 ✅ Windows 测试机真机过

- 平台层 `capability/flow.ts`:`defineFlow`(流程 = 能力,`f.call` 调别的能力,记录 run_id = 流程那次的 callId);
  进度 / 叫停(`flow.runs` probe / `flow.stop`);同一流程同一范围一次一份(资源锁 `flow:<id>:<scope>`,锁对账里看得见);
  步骤调用方 = 流程调用方(AI 起的流程里对外动作照样被拒)。
- `x-flows.ts`:`x.engage.screenBatch` / `x.vpn.judgeAll` / `x.blueMutual.find` / `x.person.collectRange`;界面四处改成 `runFlow`(x-flow-ui.ts)。
- IPC:`logAction / logPersonProgress / logPersonCollect` 退役(主进程当场记);**switch 只剩底座 4 个**(syncHost / pageAcquire / pageRelease / pageBusy),256 行。
- 真机(收件箱起流程):判到判完(新库 0 条)ok;找蓝V 没配方 → 如实「找不到配方」;先过一轮(自己的号:15 小时前 → 放一放)ok;
  人卡采一个月:帖子 10 页 258 / 回复 31 页 1231(到上限交后台)/ 转发 3 页 125,184 秒;中途 flow.runs 看到「第 1/3 · 帖子第 1 页 · 他自己 35 条…」;
  叫停 → 4 秒后停在「回复:人点了停止」;同号再起一份 → refused「已经在跑」;锁对账 ✓。
- 回归时撞了一次 X 限流(三遍连着采一个月,回复页第 16 页 429)→ 原有的「等 15 分钟再试」,流程把这句抄进进度,界面看得见(不是卡死);
  等的时候网页一直占着,别的任务让路(与原来人卡一样)。
- 剩 4c:求关 / 互动 / 求助回复卡的流程(准备 → 草拟 → 人确认 → 发送 → 下一个)。

### 第 4 步 4c 卡片队列搬到主进程 —— 2026-10-26 ✅ Windows 测试机真机过

- 用户 10-26 选「现在就把卡片队列搬到主进程」+「发完这张再准备下一张」。
- `x-card-queue.ts`:`x.cards.start / state / advance / end`;一个号一种卡一份(ask / engage / vpn),进库 `x_card_queue`(迁移 1.2.41,
  临时内存库验过:写 / 读 / 删 ok,mode 不在三种里被库拒收)。
  - advance 带「刚做完第几张」:不是现在那张 → refused(连点 / 两个窗口开着同一批不会重复往下走);最后一张做完 → 删掉这批,返回每张结果。
  - start 盖掉没做完的那批:照做(不拦),主进程 warn + 返回 `replaced`,界面说「⚠️ 盖掉了没做完的那一批(还剩 N 张)」。
  - 库里存坏 → failed(不当成「没有」悄悄丢掉)。
- 界面:AskRun 拿主进程那份(`initial`,第几张只在主进程答复后变);三个任务页 + 人卡「名单」一打开先 `readCards`(重启后接着那一张)。
  卡片里的准备 / 草拟 / 选推文 / 发送没动(本来就是单个能力调用,发送还是人点)。
- x_defer.mode 早在 1.2.40 已加 vpn(之前怀疑「回复求助卡放一放会被库拒」—— 已排除)。
- 守卫注入违规变红:next 不报主进程 / 任务页不问主进程 → 各红一条。
- 真机(收件箱):起一批 → 走到第 2 张;对第 1 张再报一次 → refused;盖掉没做完的 → `replaced: 1`;mode 错 → invalid;
  **关窗口重启后** state 还是第 2 张、第 1 张结果还在;做完最后一张 → finished,库里删掉(state = null)。

### 第 5 步 合并重复 —— 2026-10-26 ✅ Windows 测试机真机过(关注那条只有单测,真关注没在测试机点)

- **关注一份**:`x-person-act.ts followOn`(去主页 → 点 → 按钮变 Following 才算 → 写关系 → 记动作;本来就关注的不记动作)。
  关注队列(等歇完 / 异常即停)和求关卡第 ③ 步(只提醒)都调它;闸门 / 节奏归调用方。
  顺带统一:求关卡关注失败时动作里的 detail 原来只记 state,现在和队列一样记完整原因。
- **取关一份**:4a 已收在 `unfollowOn`(本步只加守卫)。
- **读主页资料一份**:`x-person-profile.ts readProfileOn`(只读不写、不碰锁)—— 点人核对 / 关系采集 / 认号原来各抄一遍。
- **刷新落库一份**:`x-save-batch.ts savePersonRefresh`(写库 + 留痕 + 新人记账)—— 核对 / `x.person.refresh` / 关系采集;关系采集原来不留痕不记账。
- **采集账统一**:存推 / 存人 / 记账只在 `x-save-batch`。
  - 逐页存推 `saveTweetPage` = `saveTweetBatch` + 回读;原来直接写账本,账本记不上整页报失败(推文其实已进库)→ 现在响 + 留痕、不报失败。
  - 查回关 / 名单采集 / 后台整批补存原来不记账(补出来的长文新增会让账本合计 ≠ 表行数)→ 现在都记。
  - `saveUserBatch` 可直接给 account(调用方已认过号);`saveTweetBatch` 可直接给 recipeName。
- 判据「grep 只剩一份」:守卫 `x-step5-one-impl.test.ts` 从全仓文件推(不写死清单),注入三处违规(复制点关注 / 绕过刷新落库 / 直接写账本)各红一条。
- 真机(用户界面 + 收件箱):
  - 点人核对 @whyyoutouzhele 两次 → ok「刚核对,与库里一致」(readProfileOn + savePersonRefresh)。
  - 人卡采一个月 @whyyoutouzhele(6.3 万帖):帖子 31 页 781 条(新 774,到单次 30 页上限交后台)/ 回复 6 页 297(新 184)/ 转发 3 页 134(新 128),165 秒;
    每 30 页歇 20 秒(原有节奏,用户以为停了);**推文表 6168 = 账本新增合计 6168**。
  - 查回关:3 页 114 人、新关注 57 → **人表 8000→8055、人账本 160→215,各 +55**(改前查回关存人不记账;8000 vs 160 的旧差额是改前采的,补不回)。
  - 日志无「账本没记上」、无 429。
- 顺手修:X 面板在 Windows 浅色主题下白底淡灰字看不清(用户截图)—— X 模块用的 6 个颜色变量名 theme.css 里没定义,
  落到给深色配的兜底色;只在浅色段补上(Mac 深色不变),守卫 `x-theme-vars.test.ts` 从源码扫变量名。

### 第 6 步 AI 网页一问一答 —— 2026-10-26 ✅ Windows 测试机真机过

- `platform/main/ai/ai-capabilities.ts`:
  - `ai.web.ask`(control,我的判断:会在自己的 AI 对话里多一条,不发公开平台 → AI / 收件箱都能调)。
    主进程自己按 ws 找 AI 网页:同 ws 共用分区 `persist:webview-<ws>`,按「分区 + 网址是这个服务」认;
    没开 / 一个 ws 开着两个同服务的页 → refused 不猜(可给 wcId 指定);问的那一下占锁 `ai:<wcId>`;
    超时默认 2 分钟(10 秒–10 分钟);没拿到回答 → failed 带原因。
  - `ai.web.pages`(input):开着哪些 AI 网页(服务 / wcId / 网址)。
- 顺手修:`ai.sse-status` / `ai.get-latest-response` 原来不传 wcId(下面一见没有就返回空 → 恒空)→ 透传 targetWcId(preload / 类型 / renderer API 一起改)。
- 守卫注入违规变红:不按 ws 筛 / 接口不传 wcId。
- 没动:界面「问 AI」(pasteAndSend)不占 `ai:<wcId>` 锁 —— 人在界面问的同时后台也问同一个页会撞;要不要收紧等真遇到再定(先全开放)。
- 真机(收件箱,用户在 ws-1 打开已登录的 Claude):
  - `ai.web.pages` → `[{ wcId: 3, service: claude, url: claude.ai/new }]`(没开时返回 [])。
  - 问「一句话说说你是谁 + 1/2/3 各一行」→ ok,3 秒,完整回答(含换行)。
  - 紧接着第二问「17×23」→ `391`(新回答,不是上一条缓存),2 秒;同时发的第三句 → refused「claude 网页正忙」,没发出去。
  - 判据「真机在已登录的 Claude 网页问答一次拿到完整回答」✅。两个 IPC 修复只有单测(renderer 现在没人调这两个接口)。

### ~~Module5-04 收口(2026-10-26)~~ —— 说早了

当时说「六步都完成」,用户追问「同一个功能多个地方有重复的执行代码的问题解决完毕了吗?」→ 回到 §2 五条判据逐条对,
**三条有缺口**:六步各自做完 ≠ 判据全满足。补在下面「收尾」。

### 收尾:补齐五条判据 —— 2026-10-26(代码 + 单测完成,待 Windows 真机)

| # | 判据 | 缺口 | 补法 |
|---|---|---|---|
| 1 / 4 | 各入口一样;每次执行有一行 | 后台采集每段、关注队列每关一个人 = 定时器自己占锁自己干,不进执行器、执行记录里没有(第 3 步小结写了「留到第 4 步定」,第 4 步漏了) | 新能力 `x.bg.segment` / `x.person.follow`(`x-capabilities-timer.ts`);`tickOnce` 默认 drive = 调执行器,自己不再占锁;关注队列每拍调 `x.person.follow`(refused = 让路留在队里;invalid / failed = 出队 + 异常即停) |
| 1 | 占锁一样 | 求关卡发送在 `runAsk` 里自己占锁,占锁人写死「界面」;认号同样写死 | `x.ask.run` 声明 `page`,执行器占;`runAsk(p, wcId)` 不碰锁。认号多半只读页面 → 保留「按需占锁」,占锁人改记真实调用方 |
| 2 / 3 | 网页一个占用者;界面无业务流程 | 操作台(XConsole)界面里直接驱动网页 13 处 + 在界面进程跑整套采集(`runCollect`) | **拆**(用户 10-26 同意):删 `XConsole.tsx` / `XWorkbenchView.tsx` / 「🛠 操作台」按钮 / view 登记;配方搬到「任务 → 搜索配方」(用户:「运营」= dashboard,「任务」才是执行者);「按它搜索」改调 `x.page.open`(加了 `page: 'search'`);只给操作台用的 `x-audit-export` / `x-payload-shape` / `x-run-report` 一并删 |
| 2 | 同上 | 界面「自带锁」IPC `pageAcquire` / `pageRelease`(只有操作台用) | 拆。界面只能问 `pageBusy`;要用网页调能力 |

- 守卫 `x-close-out.test.ts`:自己占锁的地方从源码推,只许 锁本身 / 开发收件箱占网页工具 / 认号按需 三处;tickOnce 不占锁、默认调 `x.bg.segment`;关注队列调 `x.person.follow`;
  求关发送不占锁;界面 tsx 无 `webDomInvoke`;配方增删在 `XTask*`。`x-task-recipes.test.ts`:配方页守卫(从操作台那组挪来)。注入 4 处违规 → 6 条红。
- 旧守卫:操作台专属的删(`x-console-symmetry` 整个文件 + 各文件里读 XConsole 的块);混着别的断言的只删操作台那几行。
- 丢掉的(说清楚):在界面上手动采「任意一页」、手动点滚动 / 跳转、把采到的数据导成文本一条条对。业务上目前没用到;要用就登记成能力从收件箱调。
