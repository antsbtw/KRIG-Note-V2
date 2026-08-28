# 群发通道调研 —— Gmail 走不通,该走哪条

> 2026-08-28 · 调研,未开工
> 触发:用户提出「原生版要支持群发/群组发,给产品注册用户」
> 相关:[module-design.md](./module-design.md)、[contact-sync-options.md](./contact-sync-options.md)

## 一句话

**用 Gmail / Workspace 的应用专用密码 + SMTP 做群发,不可行** —— 不是"限额紧",
是三堵墙同时挡路,其中一堵是**合同层面的封号风险**。群发必须走独立的 ESP
(邮件服务商)HTTP API,与个人收发信的 IMAP/SMTP 通道**物理分离**。

⚠️ **本文结论按「小规模经营」修订**(用户 2026-08-28 明确:不会群发很多)。
大规模场景的数据保留在 §4 备查。

---

## 1. 三堵墙(已查证)

### 墙 1:SMTP 每封最多 100 收件人

| 项目 | Workspace | 免费 Gmail |
|---|---|---|
| 每日发信数 | 2,000(试用 500) | 500 |
| **SMTP/IMAP 每封收件人上限** | **100** | **100** |
| Gmail API 每封收件人上限 | 500 | — |
| 每日唯一外部收件人 | 2,000 | — |

**收件人怎么算**(Google 原文):

> "Email addresses (recipients) count each time a message is sent;
> 5 messages sent to 10 addresses count as 50 total recipients"

即**一封发给 50 人 = 吃掉 50 个配额**,不是 1 封。To/Cc/Bcc 合并计算。
超限后果:24 小时内无法发信。

来源:https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace

### 墙 2:Workspace AUP 明文禁止 mass email ⚠️ 最致命

> "generate, distribute, publish or facilitate unsolicited **mass email**,
> promotions, advertisements, or other solicitations ("spam")"
>
> "Your failure to comply with the AUP may result in **suspension or
> termination**, or both, of the applicable Services"

**这是合同禁止,不是速率限制。** 理论上给自己产品的注册用户发信(注册时已同意)
不算 "unsolicited",但 Google 的自动化滥用检测看的是**行为特征**
(短时间大量相似邮件 + 投诉率),不看你的合规论证。一旦被判定,
**整个 Google 账号可能无预警永久停用** —— 含邮箱、文档、日历。

用主力办公账号承担这个风险,代价极不对称。

来源:https://workspace.google.com/terms/use_policy/

### 墙 3:改用 Gmail API 也绕不开

单封收件人上限从 100 放宽到 500,但**日总量配额两条通道共享**,
且 **AUP 对两者一视同仁**。这条路是死的。

来源:https://developers.google.com/workspace/gmail/api/reference/quota

---

## 2. ESP 选型(小规模场景)

用户量级:**小规模经营**,月发信量预计在数百到数千封。

| 服务 | 3,000/月 | 10,000/月 | 免费额度 | 上手门槛 |
|---|---|---|---|---|
| **Amazon SES** | **$0.30** | **$1.00** | $200 AWS 通用额度 | **高** — 沙箱 |
| **Resend** | **$0** | $20 | 3,000/月(**日限 100**) | 低 |
| **Mailgun** | $15(或免费版) | $15 | **100/天,含 1 自定义域名** | 低 |
| **Postmark** | $15 | $15 | 100/月(仅测试) | 中 — 人工审核 |
| **SendGrid** | $19.95 | $19.95 | **无**(60 天试用) | 差 |

### ⚠️ 两个流传很广的过时信息(本次查证纠正)

1. **SendGrid 永久免费版已于 2025-07-26 取消** —— 只剩 60 天试用。
   照旧教程选型会落空。
2. **SES 定价已重构**,常见的 "$0.10/千封" 仍是 à la carte 价,
   但**按收件人计费**(1 封发 100 人 = 100 次计费);另有 Essentials
   $0.16/千封等套餐档。

### 小规模场景的推荐:Resend 免费版起步

**理由**:小规模经营下,月发信量大概率在 3,000 封以内 → **Resend 免费版 $0 够用**。

⚠️ **但有个坑必须知道**:Resend 免费版是 **100 封/天**上限。
「一次性群发 500 人」会直接违反日限。小规模场景下这通常不是问题
(发几十上百人没事),但如果某次要一口气发几百人,要么分批发,要么临时上 Pro($20/月)。

**备选**:
- 若某次群发人数会超过 100,又不想上 Pro → **Mailgun 免费版**也是 100/天,
  没有优势;直接看 **SES**($0.30/月,几乎免费,但要过沙箱)
- 若在意**合规兜底** → **Postmark $15/月**(见下)

### Postmark 的独有价值:强制退订

Postmark 是五家里**唯一**在 Broadcast(群发)流上**强制**加退订链接和
RFC 8058 一键退订头的服务 —— 你忘了配它也帮你加上。

其余四家(SES / Mailgun / SendGrid / Resend 的 transactional 流)
退订都是**可选配置,会忘**。而 Gmail/Yahoo 的批量发件人规则是强制的,忘配就进垃圾箱。

一句话取舍:**SES 省钱但合规靠自觉,Postmark 花 $15/月买"不会忘"。**

来源:https://postmarkapp.com/support/article/1217-why-broadcasts-require-an-unsubscribe-link

---

## 3. 合规硬要求(影响客户端设计)

### ⛔ 中国:营销邮件主题必须标「广告」/「AD」

《互联网电子邮件服务管理办法》:未经明确同意不得发商业广告邮件,
且**即使事先已征得同意,主题前仍必须标注「广告」或「AD」**。

**注意**:纯通知类(服务变更、账号安全、交易确认)**不属商业广告**,不需标注。

来源:https://www.isc.org.cn/article/15530.html

### Gmail 发件人规范(技术门槛,等同强制)

- 批量发件人定义:24 小时内向个人 Gmail 发 **5,000 封以上**
- 要求 SPF + DKIM + DMARC(至少 `p=none`),From 域与 SPF 或 DKIM 对齐
- **一键退订(RFC 8058)**:营销邮件强制,事务性豁免;退订须 **48 小时内**处理
- 投诉率须 < 0.1%
- 小规模场景低于 5,000 阈值,但**仍建议照做**(利于送达率)

来源:https://support.google.com/a/answer/14229414

### CAN-SPAM(美国)

- **不要求事先同意**(与 GDPR/中国法的关键差异)
- 要求:真实发件人、不误导的主题、**有效物理邮寄地址**、清晰退订
- 退订须 10 个工作日内处理
- **纯事务性邮件豁免**大部分条款
- 罚则:每封违规最高约 $53,000

### GDPR + ePrivacy(欧盟)

- 「软性选择加入」:可向**已有客户**发**同类产品**营销,
  前提是收集时给过退出机会 + 每封含便捷退订

---

## 4. 对客户端架构的影响 ⭐

### 两条通道必须分离

```
个人收发信 → IMAP/SMTP + 应用专用密码(现有,保留)
群发/营销  → ESP HTTP API(新增,独立)
```

混在一起会让群发把个人邮箱的信誉和账号一起拖下水。

### 模板必须分「通知型 / 营销型」两类

| | 通知型 | 营销型 |
|---|---|---|
| 例 | 服务变更、账号安全、交易确认 | 产品推广、新功能宣传、newsletter |
| 退订链接 | 可不要 | **必须** |
| 中国「广告」前缀 | **不需要** | **必须** |
| CAN-SPAM | 豁免多数条款 | 全部适用 |

**这是客户端要实现的**:发送前按类型自动套用规则,别指望人记得。

### 必须有退订状态表

发送前过滤已退订地址。退订须在 10 个工作日(美)/ 48 小时(Gmail 规范)内生效。

### 自有域名发信的最小路径

1. 持有域名,推荐用**子域**发信(如 `mail.example.com`)隔离主域信誉
   —— 注意主域 SPF **不会自动覆盖子域**
2. 注册 ESP,添加发送域名
3. 配 3 条 DNS:SPF(TXT)、DKIM(ESP 给的公钥)、DMARC(`_dmarc`,起步 `p=none`)
4. 渐进收紧:`p=none` 观察约 30 天 → `p=quarantine` → `p=reject`
5. SES 用户额外一步:提交 production access 申请退出沙箱

注:SPF 与 DKIM 只需**其一**对齐即可通过 DMARC。

---

## 5. 未查证/存疑项(别当结论用)

- SES 旧免费额度(3,000/月×12月)的 2025-06-01 资格截止日 —— 二手源,AWS 官网未见
- SendGrid / Mailgun 新账号人工审核政策 —— 未找到官方页面
- Postmark 的 DKIM/Return-Path DNS 具体要求、购买名单禁令 —— 未在支持页找到
- CAN-SPAM 细节:FTC 官网拒绝程序化抓取,经多个二手源交叉验证。
  **正式合规前建议法务复核原文。**
