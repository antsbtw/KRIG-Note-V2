# 交付说明：X 集成 阶段 2（发普通推 / 回复 — 写方向）

> 交付日期：2026-06-10
> 实施人：本对话
> 验收人：总指挥
> 对应 prompt：[`2026-06-09-x-integration-phase2-prompt.md`](./2026-06-09-x-integration-phase2-prompt.md)
> 前置：阶段 0/1（commit `50c01d58`）

---

## 0. 质量门禁（全绿）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **0 错** ✅ |
| `npm run lint` | **无新增**（基线 10 = 4 error + 6 warning 全部 pre-existing，均不在本期文件；本期 18 个源文件 0 告警）✅ |
| `npm run test` | **228 passed**（基线 207 + 本期新增 21 个 markdown→tweet 单测）✅ |

> lint 基线澄清：prompt 说基线"全在 src/views/note/* 与 ThoughtCard.tsx"，实际全量 lint 还含
> `electron-api.d.ts:18`（旧 import-restriction）与 `PDFViewerCanvas.tsx`（旧 unused/rule-not-found），
> 均与本期无关。已单独对本期 18 个源文件跑 eslint，0 error 0 warning。

---

## 1. 改动文件清单

### 新增
| 文件 | 职责 |
|---|---|
| `src/platform/main/web-service-base/webview-input.ts` | **公共发布原语**（铁律 1）：`focusInputBox` / `pasteTextToWebview` / `locateSendButton`，AI 与 X 共用 |
| `src/platform/main/x/x-write.ts` | X 写方向注入编排：`pasteTweet`（发推）/ `pasteReply`（回复），调公共原语 + fail loud |
| `src/shared/x/markdown-to-tweet.ts` | markdown → 推文纯文本降级（去标记符保文字）+ `checkTweetLength` 超长校验 |
| `src/views/x/send-to-x.ts` | 渲染端「发到 X」业务：取选区/整篇 → 降级 → 超长提示 → 注入 / 剪贴板降级；回复草稿 `startReplyDraft` |
| `src/views/x/pending-reply.ts` | X 回复目标 pending 缓存（仿 AI pending-thought 模式） |
| `tests/x/markdown-to-tweet.test.ts` | markdown→tweet 降级 + 长度校验单测（21 个） |

### 修改
| 文件 | 改动 |
|---|---|
| `src/platform/main/ai/writer.ts` | `focusInput`/`pasteTextToAI` 改为调公共原语的薄包装（逻辑下沉，行为不变）；`clickSendButton` 保留 AI 专属 |
| `src/platform/main/web-service-base/index.ts` | 导出新增公共原语 |
| `src/shared/types/x-service-types.ts` | 填写方向 selector（composeBox/replyBox/publishButton）+ 新增 `composeUrl` 字段 |
| `src/platform/main/x/handlers.ts` | 加 `X_PASTE_TWEET` / `X_PASTE_REPLY` 两个 invoke handler |
| `src/platform/main/x/webview-hook.ts` | 右键菜单加「✍️ 在 note 里写回复」项（广播 `X_WRITE_REPLY_REQUEST`） |
| `src/shared/ipc/channel-names.ts` | 加 `X_PASTE_TWEET` / `X_PASTE_REPLY` / `X_WRITE_REPLY_REQUEST` 三个 channel |
| `src/platform/main/preload/main-window-preload.ts` | 加 `xPasteTweet` / `xPasteReply` / `onXWriteReplyRequest` |
| `src/shared/ipc/electron-api.d.ts` | 对应类型声明 |
| `src/capabilities/x-extraction/{types,index}.ts` | 加 `pasteTweet` / `pasteReply` / `onWriteReplyRequest` 到 `XExtractionApi` |
| `src/drivers/text-editing-driver/api.ts` | 加 `getDocMarkdown(instanceId)`（整篇导出，复用现成 `docNodeToMarkdown`） |
| `src/views/ai/AIView.tsx` | 订阅 `x.activate-launcher` 总线消息 → `setActiveLauncher('x')`（注入前显示 X webview） |
| `src/views/note/context-menu-content.ts` | note 右键加「𝕏 发到 X」项 |
| `src/views/x/x-commands.ts` | 注册 `x-view.send-to-x` / `x-view.write-reply` 命令 + `X_WRITE_REPLY_REQUEST` 模块级单订阅 |

---

## 2. 公共发布原语抽取方案（铁律 1）

**抽了 3 个**（`web-service-base/webview-input.ts`）：

1. **`focusInputBox(webContents, inputSelector)`** —— 原 `writer.focusInput`，把 `getAIServiceProfile().selectors.inputBox` 改成入参 `inputSelector`。逻辑（querySelector 多候选 → scrollIntoView → focus → contenteditable 光标移末尾）一字未改。
2. **`pasteTextToWebview(webContents, inputSelector, text)`** —— 原 `writer.pasteTextToAI`，同样只把 selector 提成入参。完整保留：备份剪贴板 → writeText → `sendInputEvent` OS 级 Cmd+V → 等 400ms → 验证落地 → execCommand/native-setter 兜底 → finally 还原剪贴板。
3. **`locateSendButton(webContents, sendSelector)`** —— **新增，只定位不 click**（写方向红线）。返回 `{ found, enabled }`，供 X 侧校验"内容落进了正确的框"，绝不点击。

**AI writer 怎么改的**：`focusInput` / `pasteTextToAI` 退化为「取 AI profile 的 inputBox selector → 委托公共原语」的两行薄包装。`clickSendButton`（AI 问答的**自动发送**语义）**保留在 writer.ts 不动**——X 写方向绝不自动点发布，不复用它。

**怎么确认 AI 没回归**：
- 逻辑等价性：抽取是「把字符串字面量提成同名入参」的纯机械重构，粘贴/验证/兜底/还原四段代码逐行对照一致；调用链 `ask-orchestrator.pasteAndSend → writer.pasteTextToAI → pasteTextToWebview` 入参与原 `profile.selectors.inputBox` 完全相同。
- typecheck 0 错、test 228 全过（含原有 AI 相关用例）。
- ⚠️ **仍需总指挥实测一次**：开 AI（Claude）、Note 选区右键「🤖 问 AI」→ 确认仍能正常 paste+send（录屏见 §5 待补）。这是 prompt 点名要测的回归项，我无 GUI 无法自测。

---

## 3. X compose/reply/publish selector 清单（⚠️ spike 待总指挥确认）

**重要前提**：本环境无 GUI / 无法开 X 登录态用 devtools 做实机 spike。总指挥已在提问中选择「我先本地 spike 给你 selector」——故以下是**待你核对/替换的初值**，取自 X 官方常用且本仓 read 方向 `extract-script.ts` 已在用的同体系 `data-testid`（稳定性与 `tweetText`/`User-Name` 同级）。写在 `src/shared/types/x-service-types.ts` 的 `X_PROFILE.selectors`，支持逗号分隔多候选、运行时顺序命中：

| 用途 | 当前 selector（待确认） | 说明 |
|---|---|---|
| compose 框 | `[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"][contenteditable="true"], div[role="textbox"][data-testid^="tweetTextarea_"]` | X 发推/回复输入框同为 contenteditable，testid 通常 `tweetTextarea_0` |
| reply 框 | 同 compose（X reply 框点开后也是 `tweetTextarea_0`） | 保留独立字段，将来 X 若区分只改这里 |
| publish 按钮 | `[data-testid="tweetButtonInline"], [data-testid="tweetButton"]` | 内联（详情页 reply）用 `tweetButtonInline`，弹窗用 `tweetButton`。**仅定位校验，不 click** |
| composeUrl | `https://x.com/compose/post` | 「发到 X」时若当前页无 compose 框则 loadURL 到此 |

**容错设计**：selector 为空 → fail loud（"selector 未配置，需 spike"）；多候选顺序命中；compose 框 6-8s poll 等待；找不到 / 粘贴没落地 → 降级剪贴板 + toast。X 改版失效不会静默假装成功。

**核对步骤**（建议）：开 X →（a）首页发推框、（b）某推详情页 reply 框、（c）发布按钮 三处 devtools 看真实 `data-testid`，与上表对齐；不一致就替换 `X_PROFILE.selectors`（其它代码不用动）。

---

## 4. §4 三个策略点的决定（总指挥已拍板）

| 策略点 | 决定 |
|---|---|
| **超长（>280）** | **fail loud + 仍填入**：`window.confirm` 明示"约 N 字超 280，X 会标红不让发，可精简或留作 thread"，用户确认后仍填入。**不截断、不自动拆 thread**（thread 留 TODO）。 |
| **thread 拆分** | 本期**不做**（标 TODO，见 §6）。只做单条 + 超长提示。 |
| **markdown→纯文本** | **去标记符保文字**：粗斜/删除线/行内代码去标记留字；链接 `[label](url)`→`label (url)`（label==url 或空→仅 url）；图片→url；标题去 `#`；无序列表→`•`；有序列表保序号；引用去 `>`；代码围栏去 ` ``` ` 保原文；水平线删。21 个单测覆盖。 |

**另一处我自行决定的架构点（请确认）——回复草稿区形式**：
prompt 说「回复草稿区形式你定，拿不准就问」。我选了**最小复用**方案而非新造 UI：
- 右键某推「✍️ 在 note 里写回复」→ 抓该推 URL+预览 → 记 pending 回复目标 → 提示用户「去 Note 选中回复内容，再右键『𝕏 发到 X』」。
- **「𝕏 发到 X」是统一入口**（note 右键单项）：有 pending 回复目标 → 注入该推 reply 框；无 → 发普通推。与「问 AI 从选区」同源（都靠 note 选区 markdown 起手），不新造草稿编辑器。
- **取舍**：省了一套草稿 UI、与现有「选区→动作」心智一致；代价是"写回复"和"发普通推"复用同一个 note 选区，没有专门的回复草稿框。若你想要独立草稿区（如临时 note / 专用 popup），这是可迭代点。

---

## 5. 自验录屏（⚠️ 待总指挥实机补；本环境无 GUI）

本环境无法启动 Electron app / 无 X 登录态，**无法产出录屏**。以下为**待验收脚本**（建议你按此走一遍）：

1. **发普通推（选区）**：Note 选一段含粗体/链接/列表的文字 → 右键「𝕏 发到 X」→ 右栏切到 X 且 compose 框被填入降级后的纯文本 → toast「请检查后点发布」→ **确认程序没自动发布**。
2. **发普通推（整篇）**：光标在 Note 内但不选任何文字 → 右键「𝕏 发到 X」→ 整篇降级后填入 compose 框。
3. **回复**：X 某推右键「✍️ 在 note 里写回复」→ 提示已记下目标 → 回 Note 选回复内容 → 右键「𝕏 发到 X」→ 导航到该推详情页 + reply 框被填入 → **确认没自动发布**。
4. **超长**：Note 选 >280 字 → 「𝕏 发到 X」→ confirm 弹窗提示超长 → 确认后仍填入。
5. **失败降级**：（模拟）把 `X_PROFILE.selectors.composeBox` 临时清空 → 「𝕏 发到 X」→ 应弹「注入失败…已复制到剪贴板」且内容真的进了剪贴板。
6. **AI 回归**：开 Claude → Note 选区「🤖 问 AI」→ 仍正常 paste+send（验证公共原语抽取没改坏 AI）。

---

## 6. 已知问题 / 偷懒处 / 阶段 3 衔接 TODO

- **selector 未实机 spike**（§3）：最大风险点，等总指挥实机核对。代码对失效已 fail-loud 降级。
- **超长不拆 thread**：`markdown-to-tweet.ts` 顶部注释 + `send-to-x.ts` confirm 文案均标注。**TODO（阶段后续）**：自动拆 thread 注入器。
- **字数计数近似**：`checkTweetLength` 用 Unicode 码点数，非 X 真实 weighted 计数（URL 固定 23、CJK 算 2）。仅用于"超长提示"足够,精确计数 **TODO**。
- **回复定位依赖详情页 inline reply 框**：`pasteReply` 导航到推文 status 页等 `tweetTextarea_0`。若 X 该页改为需先点「回复」激活，poll 超时后 fail-loud 提示用户手动点开再重试（已处理，但交互可能需 spike 时确认）。
- **回复草稿区形式**：见 §4，最小复用方案，若要独立草稿区可迭代。
- **阶段 3 衔接**：本期注入是「单次整块文本进一个框」。阶段 3 Article 是「逐块构造富文本」的**块序列注入器**，只能复用本期的 `focusInputBox` + `pasteTextToWebview` 原语，注入编排是新工程。相关 selector 留 spike。代码内无阶段 3 占位（按 prompt「看到留 TODO 注释即可」，本期未触及 Article 路径故无新增 TODO 注释）。

---

## 7. 红线自查

- ✅ **绝无程序自动点发布**：`x-write.ts` 只用 `locateSendButton`（查存在，不 click）；全链路无任何 `.click()` 发布按钮。
- ✅ **没复制 AI writer**：抽公共原语，AI/X 共用。
- ✅ **没改坏 AI paste+send**：纯机械重构 + typecheck/test 全过（实机回归待补，见 §2/§5）。
- ✅ **没动 `AIServiceProfile`**：X 全走 `XServiceProfile`。
- ✅ **fail loud 不静默**：注入失败 → 剪贴板降级 + alert 明示。
- ✅ **selector 没凭记忆硬写**：明确标注「待 spike 确认」+ 取自本仓已用同体系 testid + 失效 fail-loud。
- ✅ **多 ws 扇出守卫**：`X_WRITE_REPLY_REQUEST` 模块级单订阅（`x-commands.ts` `writeReplyUnsub`）+ 命令体内走 `getActiveId`（`sendToX`/`startReplyDraft` 经 `workspaceManager.getActiveId()`）。
- ✅ **未超范围做阶段 3**。
