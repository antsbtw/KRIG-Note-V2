# 活动爬虫 · Windows 部署与联调

> 立于 2026-09-03。代码在 macOS 完成并通过编译与测试,**待 Windows 联调**。
> 接口定义见 [X爬虫同步契约.md](X爬虫同步契约.md),本文只讲部署。

## 1. 部署前:两项必须线下配置

契约 §1 明确密钥**不得出现在对话、issue、代码里**,故代码里零默认值,
缺失即拒绝启动推送(不会用空串兜底 —— 空密钥会被对方 401,却看着像网络故障)。

### 方式 A:配置文件(推荐,重启不丢)

Windows 路径:`%APPDATA%\KRIG Note V2\campaign-config.json`

```json
{
  "importUrl": "http://100.96.107.7:8790/x-replies/import",
  "secret": "<32 字节 hex,由 campaign-tasks 侧生成后线下交付>",
  "refreshBind": "100.96.122.49",
  "refreshPort": 8791
}
```

### 方式 B:环境变量(优先级更高,适合临时覆盖)

```
CAMPAIGN_TASKS_IMPORT_URL=http://100.96.107.7:8790/x-replies/import
X_SCRAPER_SECRET=<同一个值>
REFRESH_BIND=100.96.122.49
REFRESH_PORT=8791
```

> ⚠️ `refreshBind` **不能是 `127.0.0.1`**(契约 §6)——
> 那样 campaign-tasks 从别的机器敲不到。填 tailnet IP 或 `0.0.0.0`。
> 代码默认已是 `0.0.0.0`,但显式填 tailnet IP 更安全(不对公网暴露)。

## 2. Windows 侧的三件事

1. **防火墙**:入站放行 8791,**只对 Tailscale 网卡**,不要对所有网络
2. **休眠**:代码已用 `powerSaveBlocker` 阻止应用挂起,但**系统电源计划**仍需设为
   「从不睡眠」——powerSaveBlocker 挡不住用户主动合盖/系统策略强制休眠
3. **Tailscale ACL**(管理台改,契约 §6):
   ```jsonc
   "hosts": { "scraper": "100.96.122.49" },
   "acls": [
     { "action": "accept", "src": ["scraper"],   "dst": ["tag:tasks:8790"] },
     { "action": "accept", "src": ["tag:tasks"], "dst": ["scraper:8791"] }
   ]
   ```

## 3. 启动后的自检顺序

按这个顺序验,**每步都有明确判据**,不通过就别往下走:

| # | 动作 | 通过判据 |
|---|---|---|
| 1 | 看主进程日志 | 出现 `[campaign-server] 监听 100.96.122.49:8791`。若显示「未启动:未配置…」= 配置没读到 |
| 2 | 本机 `curl` /health | `{"success":true,"data":{"ok":true,"logged_in":true,...}}` |
| 3 | 故意用错密钥 curl | 返回 **401 UNAUTHORIZED** —— 证明鉴权真的在起作用 |
| 4 | 从 campaign-tasks 那台机 curl /health | 同 2。失败 = 防火墙或 ACL 没通,与代码无关 |
| 5 | X Inbox →「⚙ 活动配置」 | 显示本 ws 登录的账号;角色设为 `campaign`,粘贴帖子链接 |
| 6 | 点「试抓(只抓不推送)」 | 「属于本文章 N 条」与 X 页面上的回复数接近;`problems` 为空 |
| 7 | 对方调 POST /refresh | 返回 `{fetched,pushed,hint_found,elapsed_ms,partial}`;30s 内重复应得 **429** |

自检命令(Windows PowerShell):

```powershell
$H = @{ "X-Scraper-Secret" = $env:X_SCRAPER_SECRET }
Invoke-RestMethod -Uri "http://100.96.122.49:8791/health" -Headers $H
```

## 4. 已知边界(联调时别当成 bug)

| 现象 | 原因 |
|---|---|
| `logged_in:false` / 503 | 该 ws 的 X 登录态失效,需重新登录并点「识别我的账号」 |
| 30s 内重复 /refresh 得 429 | 契约 §3.2.4 的冷却,双保险,**是预期行为** |
| `partial:true` | budget_ms 用尽,没抓完。此时**不会**标记「消失=已删除」(避免误标) |
| 转发名单为空 | 实测样本里没见过转发 icon,映射未实机验证 —— 见到真样本才能确认 |
| 「第三方对第三方」的点赞拿不到 | X 2024-06 移除该能力,与爬虫无关,任何方案都做不到 |

## 5. 联调失败时的分辨方法

**先分清是「网络不通」还是「代码问题」**:

- `/health` 本机通、外机不通 → 防火墙 / ACL,不用看代码
- 推送一直 401 → 两侧密钥不一致(注意末尾空格、换行)
- 推送 5xx → 对方内部错,爬虫侧会按 2s→8s→30s→2min 退避重试,**幂等无副作用**
- 「属于本文章 0 条」且 problems 里有「未捕获到 TweetDetail」
  → **不是没人回复**,是页面没加载/登录态失效/该帖不可见
