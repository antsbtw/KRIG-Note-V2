# Module5-04 第 1 步「资源锁」回归测试(2026-10-23)

> ✅ **2026-10-23 已在 Windows 测试机(win-desktop)跑完 B1,全部通过** —— 结果见文末「执行记录」。

> 给新对话的交接文档。改动内容见 [Module5-04 §7](Module5-04-capability-refactor.md)。分支 `feature/x-blue-mutual-phase4`。
> 用户 10-23:「前面这些功能都测试过了,现在代码调整再测试太辛苦了」—— **真机回归由 AI 自己跑,不叫用户点**。

## 这一步要证明的只有一件事

**左边那个 X 网页,同一时刻只有一个任务在用;别的任务要么等,要么让路,不会去抢。**

原来的毛病:后台查回关正在用网页时,操作台点采集会把「忙」的标记盖掉,结束时再清掉 ——
查回关还在跑,别的任务却以为网页空着;求关卡 / 互动卡准备时也不标「忙」。

---

## A. 用户要做的

1. 重启一次 app(改了主进程)。
2. 告诉新对话「开始回归」;跑的 15 分钟左右**别用左边的 X 网页**(AI 会带着它跳来跳去,只读不发)。

---

## B1. 真机回归(AI 在用户这台 Mac 上跑,用开发收件箱驱动正在运行的 app)

### 怎么发指令

- 收件箱:`~/Library/Application Support/KRIG Note V2/krig-data/x-dev/inbox/`,放一个 `NN-名字.json`;
  结果出现在同级 `outbox/NN-名字.json`(3 秒轮询一次,一次处理一个文件)。
- 指令说明见 `src/modules/x/x-dev-inbox.ts` 的类型定义。本次新增:
  - `{"op":"holdPage","wsId":"ws-1","ms":20000,"purpose":"模拟操作台正在采集"}` —— 占着网页 ms 毫秒,什么也不做
  - `{"op":"parallel","staggerMs":2000,"cmds":[A,B]}` —— 同时跑;第 2 条晚 2 秒开跑(让第 1 条先占住)
- 每一步都看两样:outbox 里的结果 + `node scripts/logs.mjs --since 5m --src main --grep "\[lock\]|\[x\.dev\]"`。
- ⚠️ 只用读 / 采的指令。**不要**发 `askDraft` 之外任何会在 X 上动手的东西(收件箱本来也没有发帖 / 点赞 / 关注指令)。

### 第 0 步:前置

1. `grep` 终端日志确认 app 是新代码:`node scripts/logs.mjs --since 30m --src main --grep "开发测试收件箱已启动"` 有一行,
   且 `node scripts/lock-report.mjs --since 30m` 不是「0 行」(用户启动后通常会有一两次占用)。没有 → 请用户重启 app。
2. 记下开始时刻 T0(最后对账用)。
3. 找一个**互关、最近 2 小时有发推**的人当样本:发 `{"op":"engageOverview","wsId":"ws-1"}`,从结果里挑一个(要数字 id + handle)。

### 第 1~5 步:场景(每步一个文件,等结果出来再发下一个)

| # | 发什么 | 期望 | 证明什么 |
|---|---|---|---|
| 1 | `parallel` staggerMs 3000:`followCheck` + `holdPage` 20000 | followCheck `ran: true`;holdPage `ok:false`,why 含「查回关」 | 后台查回关在用时,别人(操作台)申请被拒 —— **原 bug 1** |
| 2 | 第 1 步跑完后 `lock-report --since 3m` | ✓;「让路」里有「开发测试 … 让给 任务:查回关」;查回关那次从占住到放掉是连续一段 | 被拒的一方没把查回关的锁放掉 |
| 3 | `parallel` staggerMs 2000:`holdPage` 30000(purpose「模拟操作台正在采集」)+ `engagePrepare`(样本人) | engagePrepare `ok:false`,why 含「模拟操作台正在采集」;没去采(`lock-report --since 2m` 里这期间只有「模拟操作台正在采集」一段占用,没有「互动卡:准备」的占住,只有它的让路) | 网页被占时,卡片准备不抢 |
| 4 | `parallel` staggerMs 1500:`engagePrepare`(样本人)+ `holdPage` 5000 | engagePrepare `ok:true`;holdPage `ok:false`,why 含「互动卡:准备」 | 卡片准备期间自己占着网页 —— **原 bug 2** |
| 5 | 同第 4 步,把 `engagePrepare` 换成 `engageScreen` | holdPage why 含「互动:先过一轮」 | 「先过一轮」也占着 |

(求关卡 `prepareAsk`、求助回复卡 `prepareVpn` 收件箱调不到;它们和第 4 步是同一种写法,单测已逐个覆盖,不必真机。)

### 第 6 步:后台采集也让路(有后台任务才做)

先看有没有在跑的后台任务:`node scripts/health-report.mjs 1` 里 `x.bg` 的 running / waiting。
有的话发 `holdPage` 150000(长过后台 2 分钟一轮),期间日志应出现 `[x.bg] ws-1 让路:X 网页正忙(开发测试…)`,
且这 150 秒内没有 `[x.bg] … 开跑一段`。没有后台任务就跳过,在报告里写明「没有后台任务,未验」。

### 第 7 步:平时功能没坏

单独各发一次,都应正常返回(不是被拒、不是报错):
`leftTweet`、`engageOverview`、`engageScreen`(样本人)、`personTab`(样本人,`x.profile`,pageCap 1)。

### 第 8 步:总对账

```bash
node scripts/lock-report.mjs --from "<T0>"
node scripts/health-report.mjs 1     # x.page-lock.held 应为空(测完没人占着)
```
结论必须是 `✓ 没有两个任务同时用同一个网页;用完的都放了`。有 ✗ → 用 `node scripts/logs.mjs --around <时刻> --window 3m --src main` 定位。

### 给用户的报告(人话,一张表)

| 场景 | 结果 |
|---|---|
| 查回关在跑时,有人来抢网页 | ✓ 被挡下了,查回关照常跑完 |
| 网页被占着时,准备互动卡 | ✓ 没去抢,说了「网页正忙:…」 |
| 准备互动卡时,有人来抢网页 | ✓ 被挡下了 |
| 后台采集让路 | ✓ / 没有后台任务,未验 |
| 平时功能 | ✓ 读左边那条 / 互动名单 / 采主页都正常 |
| 总对账 | ✓ 没有两个任务同时用网页,用完都放了 |

有 ✗ 的写清是哪一步、日志里哪一行,先别改代码,报给用户。

---

## B2. 独立复核代码(可以在 `regression-testing-nj`;那台只能跑测试、起不了 app)

```bash
npx tsc --noEmit -p .
npx vitest run tests/modules/ tests/platform/main/lock-audit.test.ts
```
已知:`x-bg-runner.verify.test.ts` 依赖本机真库,连不上会挂,属环境。

**自己注入违规**,看测试会不会红(不要只信写代码那一方的测试):
1. 四个准备函数(`prepareAsk` / `prepareEngage` / `screenEngage` / `prepareVpn`)任挑一个去掉 `acquirePage` → `x-page-lock.test.ts` 应红。
2. `resource-lock.ts releaseLock` 改成不核对 token → 应红。
3. `x-bg-runner.ts tickOnce` 不占锁 → 应红。
4. `resource-lock.ts` 改「占住」那行日志的措辞 → `lock-audit.test.ts` 应红(对账脚本靠这个格式)。

**复核这几个取舍本身对不对**:
- 只跳一下网页的 `show / showInX`(XTaskEngage / XTaskAsk / XTaskVpn)没上锁 —— 写代码一方认为「一次跳转,留到第 4 步」。会不会造成真问题?
- `unfollowOnce` 改成「先查取关闸门、再占网页」(原来先查忙)—— 有没有副作用?
- 锁兜底超时 1 小时、对账脚本占着超过 30 分钟报 ✗ —— 有没有正常任务会超过(查回关最多翻几页 / 关系采集)?

报告口径:先说哪些属实,再说漏了什么 ——「你说的 X 件事都属实,另有 …」。

---

## 执行记录

### 2026-10-23 · win-desktop(Windows 11,源码运行 3f204fe3,新空库)

| # | 场景 | 结果 |
|---|---|---|
| 1 | 查回关在跑时模拟操作台来抢 | ✓ 被拒「X 网页正忙:任务:查回关」;查回关照常跑完 20 页 |
| 2 | 对账 | ✓ 查回关连续占用 48 秒,对方只有让路 |
| 3 | 网页被占时准备互动卡 | ✓ 被拒「网页正忙:模拟操作台正在采集」,没去采 |
| 4 | 准备互动卡期间来抢 | ✓ 被拒「网页正忙:互动卡:准备 @antsbtw」 |
| 5 | 「先过一轮」期间来抢 | ✓ 被拒「网页正忙:互动:先过一轮 @antsbtw」 |
| 6 | 后台采集 | ✓ 后台在采时来抢被拒;占着网页 150 秒时后台到点「让路」 |
| 7 | 平时功能 | ✓ 互动名单 / 采主页(逐页账对)/ 读左边那条 都正常 |
| 8 | 总对账 | ✓ 15 分钟 12 次占用、6 次让路,没有两个任务同时用,用完都放;体检 held 为空 |

额外:18:45:29 巡检的「关系采集读现状」(timer)正好撞上互动卡准备,**自然发生了一次让路** —— 就是原 bug 2 的场景。
样本人用的是自己的号(新库关系不全);`prepareAsk` / `prepareVpn` 收件箱调不到,未真机(单测覆盖)。

环境备注:那台旧库打开即卡死(9-25 强杀所致),已改名 `surreal.bak-20261023` 保留,用新空库跑。
