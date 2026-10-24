# Module5-04 第 1 步「资源锁」回归测试(2026-10-23)

> 给新对话的交接文档。改动内容见 [Module5-04 §7](Module5-04-capability-refactor.md)。
> 分支 `feature/x-blue-mutual-phase4`。

## 这一步要证明的只有一件事

**左边那个 X 网页,同一时刻只有一个任务在用;别的任务要么等,要么让路,不会去抢。**

原来的毛病:后台查回关正在用网页时,操作台点采集会把「忙」的标记盖掉,结束时再清掉 ——
查回关还在跑,别的任务却以为网页空着,可能把网页带走;求关卡 / 互动卡准备时也不标「忙」。

---

## A. 用户要做的(就两步)

1. **重启一次 app**(改了主进程,不重启跑的还是旧代码)。
2. **照常用**:求关卡、互动卡、求助回复卡、人卡核对,每天巡检让它自己跑。不用专门测什么。

用了一段时间(比如半天)后,对新对话说一句「对账」就行。

---

## B. 新对话要做的

### B1. 真机对账(在用户这台 Mac 上)

```bash
node scripts/lock-report.mjs --since 12h      # 时间按用户用了多久调
node scripts/health-report.mjs 1              # 看 x.page-lock:此刻谁占着网页
```

`lock-report` 怎么读:
- 「用过网页的 N 次」—— 每次谁占、占了几秒。应该能看到用户用过的那几类(求关卡准备、互动卡准备、核对、查回关、后台采集 …)。
- 「让路 N 次」—— 有人在用、另一个没去抢。**有让路是好事**,说明锁在起作用。
- 「结论」只有两种:`✓ 没有两个任务同时用同一个网页;用完的都放了`,或列出 `✗` 行(退出码 1)。

判据:
| 看到 | 说明 |
|---|---|
| 结论 ✓,且「用过网页」里有用户实际用过的那几类 | 通过 |
| `[lock] 日志 0 行` | app 没重启,跑的是旧代码 —— 请用户重启 |
| ✗ 两个人同时占着 | 锁失效,真 bug |
| ✗ 超时收回 / 占着很久没放 | 有地方漏了放锁,按 purpose 找是谁 |
| ✗ 拿着不是自己的锁去放 | 某处放锁的 token 传错了 |

有 ✗ 时:用 `node scripts/logs.mjs --around <时刻> --window 3m --src main` 看那一刻前后在干什么,定位后报给用户。
**不要叫用户去点按钮复现**(用户 10-20:做完整任务自己验)。

还要顺手确认用户在用的功能没坏(看日志里有没有对应的成功行,不问用户):
求关卡 / 互动卡 / 求助回复卡准备成功(`[x.ask]` / `[x.engage]` 行)、每天巡检(`[x.daily]` / `[x.follow-check]`)、后台采集(`[x.bg] 开跑一段`)。

### B2. 独立复核代码(可以在 `regression-testing-nj`,只能跑测试、不能起 app)

```bash
npx tsc --noEmit -p .
npx vitest run tests/modules/ tests/platform/main/lock-audit.test.ts
```
已知:`x-bg-runner.verify.test.ts` 依赖本机真库,连不上库会挂,属环境。

然后**自己注入违规**,看测试会不会红(不要只信写代码那一方的测试):
1. 四个准备函数(`x-ask-prepare.ts prepareAsk`、`x-engage-prepare.ts prepareEngage / screenEngage`、`x-vpn-run.ts prepareVpn`)任挑一个,去掉 `acquirePage` → `x-page-lock.test.ts` 应红。
2. `resource-lock.ts releaseLock` 改成不核对 token → 应红。
3. `x-bg-runner.ts tickOnce` 不占锁 → 应红。
4. `resource-lock.ts` 改一下「占住」那行日志的措辞 → `lock-audit.test.ts` 应红(对账脚本靠这个格式)。

再复核这几个判断本身对不对:
- 只跳一下网页的 `show / showInX`(XTaskEngage / XTaskAsk / XTaskVpn)没上锁 —— 写代码的一方认为「一次跳转,留到第 4 步」。是否会造成真问题?
- `unfollowOnce` 的顺序改成「先查取关闸门、再占网页」(原来先查忙)—— 有没有副作用?
- 锁的兜底超时 1 小时、占着超过 30 分钟报 ✗ —— 有没有正常任务会超过(查回关最多翻几页 / 关系采集)?

### 报告格式

先说哪些属实,再说漏了什么:「你说的 X 件事都属实,另有 …」。
