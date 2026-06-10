# 实施 Prompt：X 集成 阶段 2（发普通推 / 回复 — 写方向）

> 交接日期：2026-06-09
> 交接人：总指挥（上一对话）
> 验收人：总指挥（用户在新对话产出后回验收对话）
> 完整设计：**先通读** [`docs/tasks/2026-06-09-x-integration-design.md`](./2026-06-09-x-integration-design.md)
> 前置已完成：阶段 0/1（commit `50c01d58`，已验收通过、已 push 到分支 `docs/x-integration-design`）

---

## 0. 你的任务边界（只做阶段 2，不要碰阶段 3）

本次交付一个**可验收闭环：写方向**——
- **发普通推**：note 选区 / 整篇 → 注入 X 发推框（compose）→ 用户点发布。
- **回复**：在 X 某条推下右键「在 note 里写回复」→ 写完注入到那条推的 reply 框 → 用户点发布。

**不要做**：阶段 3 的 Article 长文逐块注入 / 富文本映射 / 截图兜底。那是单独立项，看到相关需求留 TODO 注释即可。

**写方向的红线（最高优先级）**：
> **永远是"填充内容，用户点发布"，绝不程序自动点发布。** 这是反自动化风险的核心防线。可以 focus+粘贴把内容塞进 compose/reply 框，但发布那一下（Publish/Reply 按钮）留给人。阶段 2 的 `publishButton` selector 只用于"定位框/校验内容落地"，**不要程序 click 它**。

---

## 1. 在阶段 0/1 基础上你能直接复用什么（已核实存在）

| 已有资产 | 文件 | 阶段 2 怎么用 |
|---|---|---|
| X profile 写方向字段（已预留 undefined 占位） | `src/shared/types/x-service-types.ts:30-34`（`composeBox/replyBox/publishButton?`） | 填上真实 selector（来自本阶段 spike） |
| X 活跃 webContents | `getActiveXWebContents`（`src/platform/main/x/webview-registry.ts`） | 注入目标就是它 |
| X 右键菜单底座 | `web-service-base/webview-context-menu-base`（已被 X webview-hook 复用） | 加「在 note 里写回复」菜单项 |
| X 命令注册入口 | `src/views/x/x-commands.ts`（`registerXCommands`，模块级单订阅） | 加发推/回复命令 |
| X IPC 命名约定 | `src/shared/ipc/channel-names.ts:246-248`（`X_*`） | 加 `X_PASTE_TWEET` 等新 channel |
| note 取选区 markdown | `getSelectionMarkdown(instanceId)`（`src/drivers/text-editing-driver/api.ts:1846`） | 取要发的内容 |
| note 整篇导出 | `serializeDoc`（`schema-builder.ts:71`）→ 需要时转 markdown/纯文本 | 发整篇推时取全文 |

---

## 2. 铁律（沿用阶段 0/1，违反即返工）

> **【铁律 1｜底座复用，语义分流】** —— 本阶段有**新动作**见 §3：
> AI 的发布原语 `focusInput / pasteTextToAI / clickSendButton`（`src/platform/main/ai/writer.ts`、`ask-orchestrator.ts:pasteAndSend`）**逻辑本身是服务无关的**（focusInput 整段就是 querySelector+focus+光标移末尾，只有 `profile.selectors.inputBox` 是参数）。**本阶段必须把这套"focus 输入框 + OS 级 Cmd+V 粘贴 + （仅定位不点击的）发送按钮校验"原语抽进 `web-service-base`，AI 与 X 共用。** 不许把 AI 的 writer 复制一份改成 X 版。

> **【铁律 3｜profile 独立】** 已落地，X 用 `XServiceProfile`，别动 `AIServiceProfile`。

> **【铁律 4｜fail loud】** 注入失败（compose 框没找到 / 粘贴后内容没落地 / 不是 X 页 / 没有活跃 X webview）→ 明确 toast 报错。
> **fallback（设计文档已定）**：注入不可靠时降级为"已复制到剪贴板，请手动粘贴" + toast 明示走了降级——**不要静默假装成功**。

> **【铁律 5｜多 ws 扇出守卫】** 新增的 X 广播（右键回复）按 `x-commands.ts` 现有模式：模块级单订阅 + 命令体内 `getActiveId` 守卫。照抄阶段 1 `X_EXTRACT_TWEET_REQUEST` 的写法（`x-commands.ts:126-135`）。

---

## 3. 本阶段核心工程：抽公共发布原语 + X 注入

### 3.1 抽公共发布原语（铁律 1，先做这个）
把 `src/platform/main/ai/writer.ts` 里**服务无关**的三段抽到 `web-service-base`：
- `focusInputBox(webContents, inputSelector)` —— 现 `focusInput` 去掉 `getAIServiceProfile`，selector 直接传入。
- `pasteTextToWebview(webContents, inputSelector, text)` —— 现 `pasteTextToAI` 的 clipboard 备份→writeText→`sendInputEvent` Cmd+V→**验证内容落地**→clipboard 还原。
- （可选）`locateSendButton(webContents, sendSelector)` —— **只定位/校验，不 click**（写方向红线）。

然后：
- AI 侧 `writer.ts` 改成调用这些公共原语（薄包装，传 AI profile 的 selector），**保证 AI 现有问答行为不回归**（这点验收会重点测）。
- X 侧新建 `src/platform/main/x/x-write.ts`，调用公共原语，传 X profile 的 `composeBox`/`replyBox`。

### 3.2 spike：摸清 X compose / reply 框 selector
动手注入前**先 spike**（项目教训：别猜 selector，看真实 DOM）：
- 打开 X 发推框（首页 compose / `/compose/post`）、某条推的 reply 框，用 devtools 找稳定 selector（优先 `data-testid`，X 常用 `[data-testid="tweetTextarea_0"]` 类）。
- 记录：compose 框 selector、reply 框 selector、发布按钮 selector（仅校验用）、compose 是 contenteditable 还是 textarea（影响光标/粘贴）。
- 把结论填进 `x-service-types.ts` 的 profile，并在 prompt 交付说明里附 selector 清单（X 改版会失效，要可查）。

### 3.3 发普通推
1. 入口：note 侧加命令/菜单「发到 X」（取当前选区 `getSelectionMarkdown`，或整篇 `serializeDoc`→文本）。
2. 内容转换：markdown → X 能吃的纯文本（注意 §4 字数/thread）。
3. 确保右栏 X view 打开且在 compose 态（或先 `loadURL` 到 compose）。
4. 经新 IPC（如 `X_PASTE_TWEET`）→ main `x-write` → `getActiveXWebContents` → 公共原语 focus compose + 粘贴。
5. **停在这里**——toast 提示"内容已填入 X，请检查后点发布"。不程序点发布。

### 3.4 回复
1. 入口：X webview 某条推右键「在 note 里写回复」→（仿 `X_EXTRACT_TWEET_REQUEST`）带被回复推文的坐标/URL 广播到 renderer。
2. 在 note 里开一个回复草稿区（形式你定：临时 note / 选区），并记住"这是对哪条推的回复"（pending 关联，仿阶段 0/1 的 pending 模式）。
3. 写完触发注入 → 定位到那条推的 reply 框（可能需先在 X 点开该推的回复输入态，spike 时确认交互）→ 公共原语粘贴。
4. 同样**停在填充**，用户点发布。

---

## 4. 本阶段需你定的策略点（拿不准就在交付说明里列出来问总指挥，别硬写）

- **字数限制**：普通推 280 字（X Premium 更长）。超长怎么办？截断？提示用户？还是自动拆 thread？
- **thread 拆分**：长内容自动拆成多条串推 vs 只发一条。阶段 2 建议**先不自动拆 thread**（标 TODO），只做单条 + 超长 fail loud 提示，把 thread 留到后续。除非 spike 发现拆 thread 注入很简单。
- **markdown→纯文本降级**：推文是纯文本，note 的粗斜/链接/列表怎么降级（X compose 不吃 markdown 语法，`**x**` 会原样显示）。建议：链接保留 URL、列表转换行、去掉 `**`/`#` 等标记符。

---

## 5. 交付物与验收清单（你做完自检，总指挥据此验收）

**质量门禁（必须全绿，与阶段 0/1 同标准）**：
- [ ] `npm run typecheck` 0 错
- [ ] `npm run lint` 无新增告警（基线是 pre-existing 10 个：4 error + 6 warning，全在 `src/views/note/*` 与 `src/views/thought/ThoughtCard.tsx`，本阶段不得新增）
- [ ] `npm run test`（vitest）全过（基线 207）
- [ ] 应用启动无新增控制台报错（WebRTC 噪音日志无害，勿清）

**功能自检**：
- [ ] 发普通推：note 选区 + 整篇两种入口，内容正确落进 X compose 框
- [ ] 回复：右键某条推 → note 写 → 注入到该推 reply 框
- [ ] 超长内容按 §4 定的策略正确处理（fail loud 或拆）
- [ ] 注入失败时 fallback 复制到剪贴板 + toast 明示降级
- [ ] **全程没有任何程序自动点发布**（写方向红线）

**架构自检（对照铁律）**：
- [ ] 发布原语已抽进 `web-service-base`，AI 与 X 共用（铁律 1）；**AI 问答发送行为未回归**（实测问一次 AI 仍能正常 paste+send）
- [ ] 没动 `AIServiceProfile`（铁律 3）
- [ ] 失败/降级 fail loud（铁律 4）
- [ ] 新 X 广播有模块级单订阅 + getActiveId 守卫（铁律 5）

**交回总指挥时请附**：
1. 改动文件清单（新增/修改 + 一句话职责）
2. **公共发布原语抽取方案**：抽了哪几个、放哪、AI writer 怎么改的、怎么确认 AI 没回归
3. **X compose/reply selector 清单**（spike 结论）
4. §4 三个策略点你的决定（或留给总指挥的问题）
5. 自验录屏：发普通推 + 回复 + 一个失败降级场景
6. 已知问题 / 偷懒处 / 待阶段 3 衔接的 TODO 位置

---

## 6. 红线（踩了直接返工）

- ❌ **程序自动点发布按钮**（写方向最高红线）
- ❌ 复制 AI writer 一份改成 X 版，而不抽公共原语（违反铁律 1）
- ❌ 抽原语时改坏 AI 问答的 paste+send（回归）
- ❌ 改 `AIServiceProfile` 塞 X（违反铁律 3）
- ❌ 注入失败静默吞错 / 假装成功（违反铁律 4）
- ❌ 凭记忆写 X selector——**先 spike 看真实 DOM**
- ❌ 超范围做阶段 3（Article 富文本/截图）

有**架构判断**拿不准（公共原语边界、回复草稿区形式、字数/thread 策略）——**停下来在交付说明里列问题**让总指挥定，别自己拍板硬写。
