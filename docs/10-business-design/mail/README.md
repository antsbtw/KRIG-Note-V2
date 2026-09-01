# 邮箱模块 —— 文档索引

> 最后更新 2026-08-28

## 现状一句话

**阶段 0(webview 内嵌网页版 + 右键提取到 note)与阶段 1(IMAP 只读同步)
均已真机验收通过并合入 main。** 阶段 2 方向正在讨论中,尚未开工。

---

## 文档

| 文档 | 内容 | 状态 |
|---|---|---|
| [module-design.md](./module-design.md) | **设计总纲**。D1-D7 架构决策、四个阶段的路线图 | 阶段 2 及之后待修订 |
| [phase1-imap-sync-handoff.md](./phase1-imap-sync-handoff.md) | 阶段 0/1 验收结论 + 本轮修掉的 5 个 bug 的判据 | ✅ 已收工 |
| [bulk-send-channel-research.md](./bulk-send-channel-research.md) | 群发通道调研:**Gmail 不可行**,该走哪条 ESP | 📋 调研完成,未拍板 |
| [contact-sync-options.md](./contact-sync-options.md) | 通信录同步四方案 + 推荐 | 📋 方案待拍板 |
| [gmail-login-backend-asks.md](./gmail-login-backend-asks.md) | (2026-06)Gmail OAuth 登录的后端需求 | 历史,已被 D3 取代 |
| [gmail-login-client-impl-handoff.md](./gmail-login-client-impl-handoff.md) | (2026-06)同上,客户端侧 | 历史 |

⚠️ 后两份是 **6 月**做 Gmail OAuth 登录时的文档,与现在的邮箱模块**不是一回事**
(现在走 D3:应用专用密码,零 OAuth 依赖)。留档备查,别当现行方案。

---

## 已拍板的架构决策(别推翻重议)

见 [module-design.md](./module-design.md) §4 完整版。要点:

| # | 决策 |
|---|---|
| D1 | webview 给人用,IMAP 给机器用(⚠️ 用户 2026-08-28 提出可能取消网页版,**待重议**) |
| D2 | 两条通路不做同步,IMAP 的 UID+flags 就是对账机制 |
| D3 | 第一版不依赖 OAuth,用应用专用密码 |
| D4 | 邮件是独立实体,显式归档到 note |
| D5 | 账号配置放 toolbar ⚙ 弹窗,不放 navSide |
| D6 | `activeService` per-ws,不 per-slot |
| D7 | 归档走 Defuddle→markdown→import-orchestrator,不造第四个转换器 |

---

## 阶段 2 的讨论现状(2026-08-28,未定)

用户提出的新方向 —— **原生邮件工作台**,重点是:

1. **写作体验**:Gmail 的写信框太小、编辑功能弱
   → 用 note 的 PM 编辑器写邮件(地基现成,**不依赖任何未定项,可立即开工**)
2. **群发 / 群组发** → 见 [bulk-send-channel-research.md](./bulk-send-channel-research.md)
3. **通信录管理 + 后台用户关联** → 见 [contact-sync-options.md](./contact-sync-options.md)
4. 深度归档(标签/关联)
5. AI 辅助
6. 用户表示「还有其他尚未清晰的想法」

### 已澄清的技术点

- **「IMAP 支持离线同步」的说法不准确**:IMAP 只提供在线命令
  (`STORE`/`MOVE`)和 UID/flags **对账机制**,离线队列与冲突合并要客户端自己实现。
  163/Outlook 客户端的离线能力都是各自实现的。
  → 但公司邮箱运营基本在线,**离线可写的优先级可下调**。
- **现状是纯只读**:代码里没有任何 `STORE`/`EXPUNGE`/`append`,`nodemailer` 未安装。
- **附件内容其实已被解析出来**(`simpleParser` 的 `a.content`),
  只是同步时主动丢弃了只留元数据 → 要支持附件**不用重拉 IMAP**,改存储即可。
- **`media://` 协议 + mediaStore 已存在**,附件和内联图可直接复用。

### 三个待用户拍板的岔路口

1. **通信录真源在哪** → 推荐方案 D,见 contact-sync-options.md
2. **群发走哪条通道** → Gmail 已排除;小规模场景推荐 Resend 免费版起步
3. **单人用还是团队用** → 决定数据放本地还是服务端,**尚未回答**

---

## 后续阶段(原路线图,阶段 2 之后待修订)

- **阶段 3**:SMTP 发信 + 归档到 note(走 D7 链路)
- **阶段 4**:Gemma 接入。⚠️ `mail_verdict` 的 `ai_verdict` 快照字段**第一天就要有**
  —— 抄 `tweet_feedback` 1.8.7 的教训,别等人工标注覆盖了 AI 原判再补
