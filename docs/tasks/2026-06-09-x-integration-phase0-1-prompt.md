# 实施 Prompt：X 集成 阶段 0 + 阶段 1（骨架 + 提取推文）

> 交接日期：2026-06-09
> 交接人：总指挥（上一对话）
> 验收人：总指挥（由用户在新对话产出后回到验收对话）
> 完整设计：**先通读** [`docs/tasks/2026-06-09-x-integration-design.md`](./2026-06-09-x-integration-design.md)

---

## 0. 你的任务边界（只做阶段 0 + 1，不要碰 2/3）

本次只交付一个**可验收闭环**：
- **阶段 0**：X 作为右 slot 的一个 webview 服务能开出来、能登录刷推、走对 per-ws 代理。
- **阶段 1**：在右边 X webview 里右键某条推 → 提取成 **tweet block** 写回左边 note。

**不要做**：发推/回复（阶段 2）、Article 长文注入（阶段 3）。看到相关 TODO 留注释即可，别提前实现。

---

## 1. 背景与最高原则（违反即返工）

整体方案：**X = "AI view 左 note / 右 slot" 模式里的一个新服务**，复用 AI view 已经实战打磨的 webview 底座。但 X 与 AI 语义不对称，必须分层（设计文档 §2）：

> **【铁律 1｜底座复用，语义分流】**
> - webview 加载 / URL 识别 / 注册 / partition / per-ws 代理 / OS 级粘贴原语 → **抽公共部分复用** AI view 现有实现。
> - X 自己的东西（profile 类型、提取产物、命令、菜单文案）→ **走独立 X 代码路径**，不得塞进 AI 的问答语义里。

> **【铁律 2｜提取产物是 tweet block，不是 toggle】**
> AI view 的 extract 把内容包成 `toggleList`（问—答语义）。**X 提取必须构造 `tweetBlock` 节点**（schema 见 `src/drivers/text-editing-driver/blocks/tweet-block/spec.ts:25-55`），绝不能复用 toggle 包装。

> **【铁律 3｜profile 独立】**（用户已拍板）
> 不要扩展 `AIServiceId`/`AIServiceProfile`。AI 的 profile selectors 是问答语义（`messageList/userMessage/assistantMessage`）、`AIServiceId` 写死三家、intercept 是 SSE 策略——X 全用不上。**新建独立 `XServiceProfile` 类型**，selector 语义为 `tweetElement` / （阶段 2 才用的 `composeBox/replyBox/publishButton`）。把 AI 与 X 都需要的 webview 生命周期/注册/代理逻辑抽成**服务无关的公共底座**，两边共用。

> **【铁律 4｜fail loud，不静默兜底】**（项目长期约定）
> 提取失败（selector 没命中、不是推文页、抓到空）→ 明确 toast 告知用户失败原因，**不要**静默吞掉、不要塞个空 block 假装成功。

> **【铁律 5｜多 ws 扇出守卫】**
> X webview 的注册/IPC 监听必须加 `getActiveId` 守卫——本项目踩过"宿主广播被 N 个并存 view 实例各消费一次"的坑（一次事件做 N 次）。参考现有 AI/web 监听里的 activeId 判断。

---

## 2. 必读的现有代码（照搬模板，先读后写）

按这个顺序读，建立心智模型：

| 看什么 | 文件 | 学到什么 |
|---|---|---|
| AI view 主组件 | `src/views/ai/AIView.tsx` | view 怎么组合 Host + toolbar + 命令订阅；`isInRightSlot` 怎么判断 |
| webview 容器 | `src/capabilities/ai-extraction/Host.tsx` | `<webview>` 生命周期、dom-ready、pending flush、命令式 ref API |
| **URL 识别 + 注册** | `src/platform/main/ai/webview-registry.ts` | `did-attach-webview`→`did-navigate`→`detectByUrl`→`setActive` 全链路（阶段 0 照搬） |
| **右键菜单 hook** | `src/platform/main/ai/webview-hook.ts` | 原生右键菜单注册 + 广播坐标到 renderer（阶段 1 照搬） |
| **提取命令** | `src/views/ai/ai-commands.ts:70-181` | extract-turn 命令：拿坐标→IPC 主进程抓→`append-pm-nodes` 写回（阶段 1 照搬骨架） |
| **提取实现（坐标定位）** | `src/platform/main/ai/extractors/claude-extract-turn.ts` | `elementFromPoint(x,y)` 定位 + DOM 抓取的写法 |
| **推文抓取选择器（复用）** | `src/platform/main/tweet-fetcher/extract-script.ts:16-137` | 推文 DOM 全字段选择器，阶段 1 直接复用这套抓取逻辑 |
| profile 类型 | `src/shared/types/ai-service-types.ts` | 看 AI profile 长什么样，**对照**写独立 XServiceProfile |
| slot 控制 | `src/slot/workspace-bus/slot-control.ts` | `openRight(viewId, payload)` |
| 写回 note | `note-view.append-pm-nodes`（在 note-commands.ts） | 把 PM 节点插进左 note |
| tweet block schema | `src/drivers/text-editing-driver/blocks/tweet-block/spec.ts:25-55` | 提取产物要填的 attrs 全集 |
| per-ws 代理 | `src/platform/main/web-proxy/handler.ts:32-34` | `session.fromPartition(...).setProxy()` |

---

## 3. 阶段 0：X 服务骨架

**目标验收**：右 slot 能开出 X webview，能登录、刷推、保持登录态，走对 per-ws 代理出口。

任务：
1. **抽公共底座**（铁律 1/3）：把 AI 的 webview 注册/识别/生命周期里**与服务无关**的部分抽成共享模块（例如 `src/platform/main/web-service-base/` 或就近抽函数），AI 与 X 共用。命名你定，但要让"加第三种服务"时不必再抄一遍。
2. **新建 `XServiceProfile` 类型**（独立文件，如 `src/shared/types/x-service-types.ts`）：
   - `urlPattern`：匹配 `x.com` / `twitter.com`
   - `homeUrl`：`https://x.com/home`
   - `selectors`：本阶段先放 `tweetElement`（推文 article 容器，参考 extract-script 里的 `article[data-testid="tweet"]`）；`composeBox/replyBox/publishButton` 字段先留好（阶段 2 用），可空。
3. **X webview 加载 + 识别注册**：仿 webview-registry，x.com/twitter.com 导航时识别并注册为 active X webview（加 getActiveId 守卫，铁律 5）。
4. **partition + 代理**：X 用**独立 partition**（建议 `persist:webview-x-${workspaceId}`，别和 AI 的 `persist:webview` 混，避免 cookie 污染），并接入 per-ws 代理（复用 web-proxy 的 `setProxy`）。
5. **right slot 开出 X view**：注册一个 X view（viewId 如 `'x-view'`），能 `openRight('x-view')`。可加一个入口（note 工具栏/菜单或命令）打开。

**阶段 0 自验**：打开 X view → 登录 x.com → 刷新后仍登录 → 若该 ws 选了代理，确认走代理出口（可在 X 看到的 IP/地区或抓包确认）。

---

## 4. 阶段 1：提取推文 → tweet block

**目标验收**：在右边 X webview 里右键任意一条推 → 左边 note 出现一个数据完整的 tweet block。

任务：
1. **右键菜单**：仿 webview-hook，给 X webview 注册原生右键菜单项「提取此推文到笔记」，点击时把光标坐标 `(x,y)` 广播到 renderer（带 getActiveId 守卫）。
2. **坐标定位 + 抓取**（铁律 1：直接抓当前 webview，不开隐藏窗口）：
   - 主进程对 active X webContents `executeJavaScript`：`elementFromPoint(x,y)` 向上找到最近的 `article[data-testid="tweet"]`。
   - 在该 article 范围内复用 `src/platform/main/tweet-fetcher/extract-script.ts:16-137` 的选择器抓全字段（author/handle/avatar/text/createdAt/lang/media/metrics/quotedTweet/inReplyTo/tweetUrl/tweetId）。
   - **复用而非复制**：尽量把 extract-script 的抓取逻辑提成可在"给定根元素"上运行的函数，X 提取和旧的 tweet-fetcher 都调它。
3. **构造 tweetBlock 节点**（铁律 2）：把抓到的数据填进 `tweetBlock` 的 attrs（对照 spec.ts:25-55），activeTab 默认 `'data'`（离线卡片，所见即所得）。产出 PM 节点 JSON。
4. **写回左 note**：仿 ai-commands 的 extract-turn——若左 note 在场用 `note-view.append-pm-nodes`（mode: 'cursor-or-end'）插入；slot 组合判断参考 ai-commands.ts:70-181。
5. **fail loud**（铁律 4）：不是推文页/没点中推文/抓到空 → toast 明确报错，不插空 block。

**阶段 1 自验**：右键 X 上不同形态的推（纯文/带图/带视频/引用推/回复）→ 左 note 各出现一个 tweet block，Data Tab 字段正确（作者、正文、媒体、metrics）。

---

## 5. 交付物与验收清单（你做完要自检，总指挥据此验收）

**代码自检（必须全绿）**：
- [ ] `npm run typecheck`（或项目对应的 TS 检查命令）零错误
- [ ] `npm run lint` 零新增告警
- [ ] 应用能正常启动，无控制台报错（WebRTC 噪音日志无害，见设计文档关联记忆，勿清）

**功能自检**：
- [ ] 阶段 0 五条自验全过
- [ ] 阶段 1 五种推文形态都能正确提取
- [ ] 失败场景 toast 正确（非推文页右键、点空白处）

**架构自检（对照铁律）**：
- [ ] X 没有污染 AI 的 profile/类型/命令（铁律 3 独立 XServiceProfile）
- [ ] 提取产物是 tweetBlock 不是 toggle（铁律 2）
- [ ] 公共底座已抽出、AI 与 X 共用，加第三种服务不需再抄（铁律 1）
- [ ] 所有 X webview 监听有 getActiveId 守卫（铁律 5）
- [ ] 失败路径 fail loud（铁律 4）

**交回给总指挥时，请附**：
1. 改动文件清单（新增 / 修改，一句话说明各自职责）
2. 公共底座抽取方案（抽了哪些、放哪、AI 侧怎么改的）
3. 自验录屏或截图（阶段 0 刷推 + 阶段 1 五种推提取）
4. 已知问题 / 偷懒处 / 待阶段 2 衔接的 TODO 位置

---

## 6. 红线（踩了直接返工）

- ❌ 改 `AIServiceId` / `AIServiceProfile` 去塞 X（违反铁律 3）
- ❌ 提取产物用 toggleList（违反铁律 2）
- ❌ 失败时静默吞错 / 插空 block（违反铁律 4）
- ❌ 复制粘贴 AI webview 注册代码到 X 而不抽公共底座（违反铁律 1）
- ❌ 超范围实现阶段 2/3
- ❌ 凭记忆/脑补写 selector 或文件路径——**先读真实代码**（项目长期教训：别猜，看真实数据）

有任何**架构判断**拿不准（公共底座边界怎么切、X view 入口放哪、partition 命名），**停下来在交付说明里列出问题**让总指挥定，别自己拍板硬写。
