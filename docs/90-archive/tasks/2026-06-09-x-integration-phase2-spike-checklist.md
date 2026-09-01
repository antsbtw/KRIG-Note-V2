# X 集成 阶段 2 — selector spike 图文 checklist

> 给总指挥的实机核对指南。目的:确认 X 网页里「发推框 / 回复框 / 发布按钮」的真实
> `data-testid`,核对/替换 `X_PROFILE.selectors`。
> 关联:[交付说明 §3](./2026-06-09-x-integration-phase2-delivery.md)、记忆「别猜、看真实数据」。

---

## 0. 先理解:selector 是怎么被用的(决定了你要看什么)

我的注入代码做的事 = **在 X 网页里找到那个框 → 把 note 内容塞进去**。
代码靠 **CSS 选择器(selector)** 当门牌号去定位元素。所有 selector 集中存在一处:

`src/shared/types/x-service-types.ts` → `X_PROFILE.selectors`

```
composeBox     发推输入框      → pasteTweet 往这里塞
replyBox       回复输入框      → pasteReply 往这里塞
publishButton  发布/回复按钮   → 只「定位校验」,绝不程序点击(写方向红线)
composeUrl     发推页 URL      → 当前页没发推框时,先 loadURL 到这里
```

**整条注入链路(发推为例)**,你看了就知道每个 selector 卡在哪一步:

```
1. 找当前 X 页有没有 composeBox 框?(waitForSelector 1.2s)
      └─ 没有 → loadURL 到 composeUrl(x.com/compose/post)→ 再等框出现(8s)
2. 框出现 → pasteTextToWebview(composeBox) 把文字 OS 级 Cmd+V 粘进去
3. 校验内容真落进框了吗?(框 textContent 非空)
4. locateSendButton(publishButton):发布按钮出现了吗?(只确认,不点)
5. 成功 → 弹「内容已填入,请手动点发布」
   任一步失败 → 弹「注入失败,已复制剪贴板,请手动粘贴」(fail loud 降级)
```

> 所以你要核对的就是 **composeBox / replyBox / publishButton 这三个门牌号对不对**,
> 外加确认 composeUrl 能打开发推框。**selector 错 = 卡在第 1 或第 4 步 → 走剪贴板降级**
> (不会静默坏,但就不是「直接填进框」的顺滑体验了)。

---

## 1. 工具准备:打开 devtools 看真实 DOM

X webview 跑在应用里(右栏 X 入口)。两种方式打开 devtools:

- **方式 A(推荐,直接看 webview)**:在 X 页面上右键 → 若有「检查元素 / Inspect」直接点;
  没有的话用方式 B。
- **方式 B(开发者菜单)**:应用菜单栏 View → Toggle Developer Tools,或快捷键
  `Cmd+Option+I`(Mac)。注意:这可能开的是**外层应用**的 devtools,要在 devtools 里
  切到 X webview 的上下文(Elements 面板顶部有 frame/context 下拉,或 Console 顶部的
  「top ▾」下拉里选 x.com 的那个 frame)。
- **方式 C(浏览器对照)**:你也可以直接用 Chrome 登录 x.com,在普通浏览器里 spike——
  X webview 和 Chrome 渲染的是同一套页面,`data-testid` 一致。这个最省事。

---

## 2. 核对 ① composeBox(发推框)

**操作**:
1. 打开发推框 —— 点 X 左侧「Post / 发帖」按钮,或直接访问 `x.com/compose/post`(会弹出
   独立发推弹窗)。
2. devtools 左上角点「元素选取器」图标(⬚ 带箭头,快捷键 `Cmd+Shift+C`)。
3. 点页面上**正文输入区**(那个写「有什么新鲜事 / What's happening」的大框)。

**你要看的**:Elements 面板高亮到的元素上,找 `data-testid="..."`。预期长这样:

```html
<div data-testid="tweetTextarea_0"
     contenteditable="true"
     role="textbox"
     ...>
```

**记下** `data-testid` 的值。对照下表(我填的初值):

| 字段 | 我填的初值 | 你看到的 | 一致? |
|---|---|---|---|
| composeBox | `tweetTextarea_0` | _____ | ☐ |

> 小贴士:X 的发推框是 `contenteditable` 富文本(不是普通 `<textarea>`)。多写几条/开
> thread 时框 id 会变 `tweetTextarea_1`、`_2`…… 我的兜底 selector 用了
> `[data-testid^="tweetTextarea_"]`(前缀匹配)覆盖这种情况,所以你主要确认**第一个框**
> 是不是 `tweetTextarea_0` 即可。

---

## 3. 核对 ② replyBox(回复框)

**操作**:
1. 随便打开一条推的详情页(点某条推进去,URL 形如 `x.com/<用户>/status/<数字>`)。
2. 用元素选取器点该推下方的**回复输入框**(写「Post your reply / 发布你的回复」那个)。

**你要看的**:同样找 `data-testid`。X 上**回复框通常和发推框是同一个** `tweetTextarea_0`。

| 字段 | 我填的初值 | 你看到的 | 一致? |
|---|---|---|---|
| replyBox | `tweetTextarea_0` | _____ | ☐ |

> 关键确认点:**详情页一进去,回复框是不是直接就在(可见)**?
> - 如果**直接可见** → 我的 `pasteReply` 直接就能塞(导航到详情页 → 等框 → 粘贴)。
> - 如果**要先点一下「回复」才展开输入框** → spike 时记下来告诉我,我可能要在注入前
>   加一步「先 focus/点击激活回复框」。目前代码:框 8s 没出现就 fail-loud 提示你
>   「请在 X 手动点开回复框后重试」——能用但不够顺,看你实测哪种情况。

---

## 4. 核对 ③ publishButton(发布 / 回复按钮)

> ⚠️ 这个 selector **只用来「确认按钮出现了」**(辅助判断内容落进了正确的框),
> **代码绝不会去点它**——发布永远是你手动点。这是写方向最高红线。

**操作**:在发推框 / 回复框里随便打几个字(让按钮从灰变蓝可点),用元素选取器点那个
蓝色的「Post / 发布」或「Reply / 回复」按钮。

**你要看的**:`data-testid`。X 有两种:

| 场景 | 预期 testid |
|---|---|
| `/compose/post` 独立发推弹窗 | `tweetButton` |
| 首页内联 / 详情页回复 | `tweetButtonInline` |

| 字段 | 我填的初值(两个都写,顺序命中) | 你看到的 | 一致? |
|---|---|---|---|
| publishButton | `tweetButtonInline`, `tweetButton` | _____ | ☐ |

---

## 5. 核对 ④ composeUrl(发推页能直达发推框吗)

**操作**:在 X webview 地址直接访问 `https://x.com/compose/post`。
**确认**:是否弹出/跳到一个**带发推框的页面**(而不是首页或报错)。

| 字段 | 我填的值 | 能直达发推框? |
|---|---|---|
| composeUrl | `https://x.com/compose/post` | ☐ |

---

## 6. 核对完怎么改(只动一处,其它代码不碰)

打开 `src/shared/types/x-service-types.ts`,找到 `X_PROFILE.selectors`,只改这几行:

```ts
selectors: {
  tweetElement: 'article[data-testid="tweet"]',   // 读方向,别动
  composeBox:    '[data-testid="tweetTextarea_0"], [data-testid^="tweetTextarea_"][contenteditable="true"], ...',
  replyBox:      '[data-testid="tweetTextarea_0"], ...',
  publishButton: '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]',
},
// ↓ 同文件稍下
composeUrl: 'https://x.com/compose/post',
```

- **一致** → 什么都不用改,直接验收。
- **不一致** → 把对应那行的 `data-testid="xxx"` 换成你看到的真实值即可。
- selector 支持**逗号分隔多候选**(顺序命中),所以你可以「保留我的初值 + 补一个你看到的」,
  容错更强,例如:`'[data-testid="新值"], [data-testid="tweetTextarea_0"]'`。

改完跑一次 `npm run typecheck`(应仍 0 错,改字符串不影响类型)。

---

## 7. 这套机制对你「构思新功能」意味着什么(你关心的重点)

你说想了解这个过程方便构思功能,这里点几个**可扩展性事实**:

1. **selector 是纯配置,加新动作不用碰注入逻辑**。
   注入引擎(focus + OS 粘贴 + 定位按钮)已抽成服务无关的公共原语
   (`web-service-base/webview-input.ts`),AI 和 X 共用。将来要支持「X 引用转推」「编辑
   推文」等新写动作,基本就是「在 profile 加个 selector + 在 x-write 加个编排函数」。

2. **任何「往某网页框里塞内容」的需求都能套这套**。
   比如将来接 Mastodon / Bluesky / LinkedIn 发帖,模式完全一样:加一个 service profile
   (URL 识别 + selector)+ 复用同一套 `pasteTextToWebview`。`XServiceId` 当初留成 union
   形态(`'x'`)就是为这个。

3. **红线是硬约束:永远「填内容,人点发布」**。
   `locateSendButton` 只定位不点击。如果你的新功能构思里有「自动连发」「定时发」「批量发」
   这类**程序替用户点发布**的诉求,那会撞这条反自动化红线——需要单独和我确认怎么处理
   (通常是改成「排队 + 每条都等用户确认」,而不是真后台自动发)。

4. **降级永远 fail-loud**。
   注入不可靠时一律退「复制到剪贴板 + 弹窗告知」,绝不静默假装成功。新功能也应守这条。

5. **note → X 的内容降级是可调的**。
   `src/shared/x/markdown-to-tweet.ts` 是纯函数 + 21 个单测。你若想改降级规则(比如
   「列表用 ▪ 而不是 •」「保留 #标签 不去井号」),改这一个文件 + 补测即可,不影响注入。

---

## 8. 一句话流程图(贴墙速查)

```
       [核对 selector]                    [日常使用]
  X 网页 + devtools 元素选取器        note 选区/整篇 → 右键「𝕏 发到 X」
        ↓ 点框/按钮                            ↓
   看 data-testid 值                  markdown → 推文纯文本(去标记)
        ↓                                      ↓
  对照 §2~5 表格                       切到 X webview + 找 composeBox/replyBox
        ↓                                      ↓
  不一致 → 改 X_PROFILE.selectors      OS 级 Cmd+V 塞进框 → 校验落地
        ↓                                      ↓
   typecheck 0 错 → 验收              成功:弹「请手动点发布」/ 失败:复制剪贴板
```
```
回复专属:X 某推右键「✍️ 在 note 里写回复」→ 记下该推 URL(pending)
         → 回 note 写 → 右键「𝕏 发到 X」→ 自动导航到该推详情页 → 塞进 replyBox
```
