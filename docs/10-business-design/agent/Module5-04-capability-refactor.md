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
| 2 | **能力契约 + 执行器 + 统一结果 + `krig_flow`**;先接 3 个形状差最大的:`x.engage.prepare`(占网页)、`x.vpn.find`(花搜索额度)、`x.engage.overview`(纯读库) | 三个入口各调一次,检查 / 锁 / 记录 / 结果一致;`flow_step_run` 有行(含 refused) |
| 3 | **按批迁移其余能力**(读库类 → 采集类 → 输出类);收件箱改成「调任意能力」(白名单退役);定时器改走执行器 | x-data-ipc 的 switch 只剩转发;收件箱能调目录里任意能力 |
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
