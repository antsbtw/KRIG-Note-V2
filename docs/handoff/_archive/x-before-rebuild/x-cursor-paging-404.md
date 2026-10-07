# 交接:X 游标翻页在 followers 页恒 404

> 2026-09-18。上一轮对话上下文过长、连续四次修复都没解决,用户要求换新对话。
> **先读完这份再动代码**,尤其是「已排除」那一节 —— 别重走。

## 一句话现状

游标翻页在 **verifiedFollowers 页跑通**(40 页 / 1041 人 / 零 404),
在 **followers 页恒定 404**(翻页#1 就失败)。同一份代码,两页表现不同。

## 目标(用户原话)

> 「① 用游标直接翻页 —— 不滚动,直接重放 GraphQL 请求带 cursor。快几十倍。」

滚动采集实测 30 轮 76 秒只拿 201/2604 = 7.7%,全量要 ~390 轮 16 分钟。
游标翻页一页 ~26 人(verifiedFollowers 实测),40 页 1041 人 83 秒。

## 关键代码

| 文件 | 作用 |
|---|---|
| `src/platform/main/x/x-timeline-harvester.ts` | 抄请求(~L432)、翻页循环(~L716) |
| `src/platform/main/x/x-people-harvester.ts` | `withCursor` / `buildRefetchScript` |
| `tests/x/cursor-paging.test.ts` | 29 条守卫,全部注入验证过能变红 |

做法:**不自己拼请求**,复用 X 刚发过的 `Followers` 请求(URL+headers+method),
只换 `variables.cursor`,在页面上下文 `fetch` 重放。
理由见 `x-article-replies.ts:285`(queryId/features 会随版本变,那边为此放弃重发)。

## ⚠️ 已排除 —— 别重走这四条

1. **不是"抄不到请求"** —— 报告里 `📋 抄到的请求` 有完整 URL。
2. **不是"抄错了对象"** —— 曾抄到 `ViewerBadgeCounts`(杂项把 Followers 覆盖),
   已用 `isPeopleOp` 挑选修掉。修完 404 依旧。
3. **不是"模板带了过期游标"** —— 曾抄到带 `cursor` 的深页请求,
   已改「留第一条」修掉。**最新一跑抄到的 variables 已经不含 cursor**:
   `{userId,count,includePromotedContent,withGrokTranslatedBio}`
   与成功那页**形状完全一致**。仍然 404。
4. **不是 method** —— 已改为抄 X 自己的(原写死 GET)。

## ⭐ 最有价值的线索:两页的 queryId 不同

```
followers       fVGYs5W9kNUuoUrZwYZQpQ/Followers              → 404
verifiedFollowers DWeIe6l1rsZMqHPbbWXtig/BlueVerifiedFollowers → 200 ✅
```

variables 形状一样、headers 同源、method 同为 GET,**差别落在 queryId 与 endpoint 上**。

### 建议的下一步(按性价比排序)

1. **拿 ❌ 失败的那条 URL 在 X 页面 devtools 里手动 fetch 一次**。
   这一步能一刀切开两种可能:
   - 手动也 404 → 是**这条 URL 本身**不被接受(queryId 过期/不匹配/features 与该 endpoint 不配)
   - 手动 200 → 是**我们的重放方式**有问题(headers 漏了什么、执行上下文不对)

   ⚠️ 这一步**一直没做**,是当前最大的信息缺口。别再靠读代码推断。

2. 若手动也 404:对比 X 自己发的 `Followers` 请求与我们重放的,
   **逐个 header 比对**(CDP `Network.requestWillBeSent` 里有完整 headers,
   但 `buildRefetchScript` 剔掉了 `content-length|host|connection|:.*`,
   ⚠️ 注意 HTTP/2 的伪头 `:authority` 等也被剔了,可能剔多了)。

3. 若 1、2 都排除:考虑 **X 对 `Followers` 有额外校验**(如 `x-client-transaction-id`
   这类每请求一次性签名头)。若证实如此,**重放路线对 followers 页走不通**,
   应老实告诉用户,并退回「滚动 + 加大轮数」或改走别的入口,
   **不要继续打补丁**。

## 🔴 本轮反复栽的坑(务必避免)

- **一次成功不能当作链路正确的证据**。栽了两次:
  ① 第 1 页成功、第 2 页才暴露;② verifiedFollowers 通了、followers 仍挂。
  验证必须**两个页面都跑**。
- **不给 URL 就只能猜**。前三次修复都是猜,因为报告里只有「请求失败(404)」。
  现已补 `capturedUrl` / `failedUrl` 到面板 —— 用它们,别猜。
- 守卫容易假绿(本仓同族第三/第五刀):整文件 `toMatch` 会被类型声明兜住;
  `void 0 && f()` 文本在行为没了。**写完守卫必须注入违规看它变红**。

## 附:这一轮真正修好的东西(别回退)

- ✅ 游标翻页主链路(verifiedFollowers 实测 40 页 1041 人,字段近乎满分)
- ✅ `pagingSkipped` —— 四个入口条件逐条报原因(原来静默跳过)
- ✅ `capturedUrl`/`failedUrl` —— 404 时交出真实 URL
- ✅ `list_memberships`(migration 1.2.4)—— 一个人可同时在多个名单,
  累加不覆盖。修的是「采完蓝V后 followers 从 308 掉到 28」的证据覆盖。
  实测 1092 行已带上,followers 现稳定在 300。
- ✅ `pageBudget` 参数(面板第 4 个框,默认 40)。
  ⚠️ 1041 人那跑是**被 40 页闸门拦住**的,不是采完 —— 调大即可继续。

## 基准

`@OTun_MyVPN` 粉丝 2604 / 关注 2553(X 首页自报,出入 10% 内即可)。
当前 followers 采到 300 = 11.5%。
