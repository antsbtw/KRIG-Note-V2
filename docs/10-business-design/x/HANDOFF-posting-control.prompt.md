# 交接:推文的发文控制(2026-10-26)

> 新对话先读本文。上一个对话做完 Module5-04(能力层重构六步 + 收尾,五条判据全满足,已合 main `1d4770be`),
> 太长了,用户同意另起对话做这一块。

## 0. 用户定的顺序(10-26 原话)

> 「关于原来提出来的同一个功能,多个地方有重复的执行代码的问题解决完毕了吗?如果完毕了,先考虑推文的发文控制问题。最后才考虑AI的接管流程,对吗?」

- 去重 ✅(Module5-04 收尾)→ **现在:发文控制** → 最后才是 AI 接管(Module5-03 P3 提案批复)。
- ⚠️ 别跳去做 AI 提案批复 —— 上一个对话我抢跑过一次,用户说「这一步走快了」。

## 1. 现状(10-26 查实,别重新猜)

- **发推现在没有实现。** 9-29 按用户「删除所有的 x 代码,再按照能力控制台的要求能力,重构测试一遍」删了整个 X 业务
  (提交 `14aec836`),发推相关的这些**删了一直没重建**:
  - `src/views/x/send-to-x.ts`(507 行,note 选区 / 整篇 → 发普通推 / 回复)
  - `src/platform/main/x/x-article-driver.ts`(1308 行,X 文章:驱动 X 原生 Insert,只插内容,人点 Publish)
  - `src/platform/main/x/x-drag-drop.ts`(拖 note block 到 X)
  - `src/views/x/send-confirm-popup/*`(发出前确认弹窗,阶段 2.5-a)
  - 要参考旧做法:`git show 14aec836^:<路径>`(旧代码是知识来源,不是照搬 —— 它不走执行器)
- ⚠️ **note 右键菜单还留着**「𝕏 发到 X」(`x-view.send-to-x`)、「𝕏 发布为 X 文章」(`x-view.publish-article`),
  命令**没人注册** → 点了只在 DevTools 打一行 `command not registered`,界面上什么都没有(「看着能用实际没有」那一族)。
  位置:`src/views/note/context-menu-content.ts:67-84`。
- 现在**唯一能往 X 写的**:卡片里的回复(`x-ask-run.ts`:点赞 / 留言 / 关注,能力 `x.ask.run`)。

## 2. 还在、可复用的零件

| 零件 | 在哪 | 说明 |
|---|---|---|
| 往 X 输入框写字 | `inputEngine.type`(`platform/main/web-capability/input`) | 合成 paste,DraftJS 不丢行;`x-ask-run.ts` 回复框在用(记忆 project-x-inject-synthetic-paste) |
| 发推页 | `x-pages.ts` 的 `x.compose`(`/compose/post`)、`x.composeArticles` | 直达,不依赖首页布局 |
| note → markdown | `drivers/text-editing-driver/serializers/pm-to-markdown.ts` | 注释里写着 send-to-x 是消费方(视频块缺失要 fail loud) |
| 长文计划类型 | `shared/ipc/article-plan-types.ts` | 旧 article 链路留下的类型 |
| 发布期间冻结 X 区 | `shell/global-progress-overlay/XPublishOverlay.tsx`(scope `x-view`) | 旧的遮罩还在 |
| 不支持格式转图 | 记忆 project-x-unsupported-block-to-image | 公式 / 代码 / Mermaid 渲染成图 |
| X 文章走 HTML 粘贴 | 记忆 project-x-articles-impl | X 认富文本不认 markdown |
| 拖拽发推 | 记忆 project-x-drag-to-post-method | 原生 drag 进不了 webview,改 guest 自报坐标 |

## 3. 必须守的规矩(Module5-04 之后的底座)

- **每个动作登记成能力**(`xCap('output', …)`,`x-capabilities-*.ts`),界面 / 收件箱 / AI 都走 `execute`。
  `output` 类对 AI / 收件箱调用一律 refused「要人批复」(P3 之前);界面人点、定时器照做。
- **占网页由执行器做**:能力声明 `page: (i) => '用途'`;函数里不许自己 `acquirePage`
  (守卫 `tests/modules/x-close-out.test.ts` 会红:自己占锁只许 锁本身 / 开发收件箱工具 / 认号)。
- **界面组件不许直接驱动网页**(没有 `webDomInvoke`;同一守卫)。界面只显示和让人确认。
- **发出去要核对**:像 `sendReply` 那样等推真的出现在页面上(我的号发的、正文对得上)才算成;没成停在哪一步、如实说。
- **动作留痕**:`appendAction`(成败都记);执行记录 `krig_flow` 自动有一行。
- **发布由人点**(用户反复确认过;X 文章「只插内容,用户在 X 手动点 Publish」)。写方向红线 10-10 已取消,
  但 节奏限制 / 异常即停 / 动作留痕 / 执行后核对 是前提(记忆 project-x-write-redline-cancelled)。
- 先写会失败的测试再改代码;守卫要注入违规看它变红;改主进程要重启 app;每步真机过才打 ✅。

## 4. 建议的第一步

1. **先补口子**:两个菜单项点了要有明确反馈(不能静默),在重建前说清楚「发推正在重建」。
2. **再问用户要什么效果** —— 按用户习惯「给效果不给修法」(记忆 feedback-give-effect-not-implementation-choices):
   配 ASCII 示意问 发哪些(短推 / 长推 / 带图 / X 文章)、从哪发(note 右键 / 拖拽)、
   发前看到什么确认什么、发后怎么告诉人成没成。不要让用户在实现方案里二选一。
3. 定了效果再出设计(能力清单 + 每个能力的前提 / 占锁 / 核对 / 留痕),用户确认后开工。

## 5. 回归

- Windows 测试机 `ssh win-desktop`(做法见记忆 feedback-debug-on-mac-not-windows;单分支克隆要 `git fetch origin <分支>:<分支>`)。
  测试机现在在 `feature/module5-04-close`(= main 1d4770be)。
- ⚠️ 测试机上**真发推 = 对外动作**,发之前必须问用户;能验的先验拒绝路径 / 填框不发。
- 给用户的测试步骤要短(记忆 feedback-test-steps-for-user-short)。
