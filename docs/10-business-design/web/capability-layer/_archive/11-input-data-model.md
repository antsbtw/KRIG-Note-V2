# 11 · `web.input` 数据模型(先模型,后代码)

> 属于 **Web 能力层**(`01-web-capability-contract.md` 是总纲)。
> 承接 `10` §3(输入规格)。用户 2026-09-09 定:
> 「**先完善数据模型,然后再完善代码。**」
>
> **本文只定模型,不含实现。**

---

## 0. 这个模块管什么、不管什么

用户已裁定:**格式不能统一**(不同网站、不同输入框各有格式,
强行统一反而增加复杂性)。由此确定边界:

| 管(动作) | 不管(内容) |
|---|---|
| 怎么把文本**真的放进框里** | 这段文本该是什么格式 |
| 怎么确认**真的落地了** | 落地的内容对不对 |
| 怎么把文件**真的喂给上传控件** | 该喂哪个文件 |
| 往**哪个作用域**填(主/frame/模态) | 哪个模态是「对的」 |

> ⭐ **它是「怎么放进去」的能力,不是「放什么」的能力。**
> 与输出层对称:输出管「怎么拿到 bytes」不管「bytes 什么意思」;
> 输入管「怎么放进 DOM」不管「放的是什么格式」。

**markdown 的位置**:业务侧以 markdown 为源,由 **adapter** 转成目标格式
(X 发推要纯文本、X 长文要 HTML、AI 提问要纯文本)。
**底座只收最终形态,不认识 markdown。**

---

## 1. 复用已有类型,不另造

`web.dom/types.ts` 已定义,**直接复用**:

| 已有 | 用途 |
|---|---|
| `AnchorName` | 锚点语义名(由 adapter 解释成 selector) |
| `Rect` | 几何 |
| `ScriptId` / `ScriptParams` | 预注册脚本 |

`result.ts` 已定义,**直接复用**:`Ok` / `Failed` / `Degraded` / `Result<T>`。

`web.page/types.ts` 已定义:`PageId`。

> ⚠️ **不新造 selector 类型** —— 输入层一律用 `AnchorName`,
> 让「selector 单一来源」这条(`01` §7)在类型层面成立。

---

## 2. ⭐ 作用域模型(本模块的核心新增)

### 2.1 为什么必须有

X 的实际情况(`x-article-driver` 19 处注入大半在处理这个):

| 场景 | 在哪 |
|---|---|
| 发推 compose 框 | 弹出层(模态) |
| 长文 Insert 菜单 → 弹模态 → 填内容 → 点 Update | **模态里的模态** |
| 回复框 | 有时内联、有时弹层 |

**没有作用域,`type` 只能「往页面上第一个匹配的框填」—— 模态叠模态时会填错地方。**

### 2.2 模型

```ts
export type InputScope =
  | { readonly kind: 'main' }
  | { readonly kind: 'frame'; readonly frameId: string }
  | { readonly kind: 'within'; readonly container: AnchorName };
```

| 形态 | 含义 | 典型场景 |
|---|---|---|
| `main` | 主文档(**缺省**) | 普通输入框 |
| `frame` | 某个 iframe | 嵌入式编辑器 / widget |
| `within` | **某容器内部** | ⭐ 模态、抽屉、下拉面板 |

**`within` 可嵌套表达**:模态里的模态 = 调用方先 `ready` 确认外层模态在场,
再以内层容器锚点作 `within`。

> ⚠️ **底座不判断「哪个模态是对的」** —— 它只按给定容器作用。
> 「Insert 模态开着时该往哪填」是 adapter 的知识。

### 2.3 作用域解析失败必须 fail loud

```ts
export type ScopeResolution =
  | { readonly ok: true; readonly scopeDesc: string }
  | { readonly ok: false; readonly reason: 'frame-not-found' | 'container-not-found' | 'ambiguous' };
```

⚠️ `ambiguous`(容器锚点命中多个)**必须报错,不许挑第一个** ——
这与 `web.page` 的 `find` 同源:**底座不替调用方挑**(`06` §2.2)。

---

## 3. 落地确认模型

### 3.1 为什么它是模型的一部分,不是实现细节

可靠性纲领铁律四:**成功要对账**。
现有 `pasteTextToWebview` 的注释写着:

> 校验内容是否真落地 —— **不只看 length>0**(那会把「粘歪了但有内容」误判成功)

**「填了」和「填对了」是两件事**,模型必须能表达。

### 3.2 模型

```ts
export type LandingCheck =
  | { readonly kind: 'none' }                                  // 显式声明不校验
  | { readonly kind: 'contains'; readonly fragment: string }    // 含某片段
  | { readonly kind: 'exact' }                                 // 与输入完全一致
  | { readonly kind: 'anchorAppears'; readonly anchor: AnchorName }  // 出现某元素(如缩略图)
  | { readonly kind: 'custom'; readonly script: ScriptId };
```

```ts
export type LandingReport = {
  readonly checked: boolean;
  readonly landed: boolean;
  /** 走了哪条路径落地的 —— 排查时的关键线索 */
  readonly via: 'synthetic-paste' | 'exec-command' | 'native-setter' | 'os-paste' | 'unchecked';
  readonly attempts: number;
};
```

> ⭐ `via` 字段是**现有代码踩出来的**:合成 paste 是主路径,
> 但有三级兜底。**出问题时「走了哪条路」是第一条线索** ——
> 现在这个信息只在 console,没进返回值。

### 3.3 `kind: 'none'` 为什么要显式

按铁律「不要静默兜底」:**不校验必须是明确的选择,不能是默认**。
写 `{ kind: 'none' }` 的人知道自己在放弃校验;省略参数的人可能只是忘了。

---

## 4. 输入动作模型

### 4.1 文本输入

```ts
export type TypeInput = {
  readonly pageId: PageId;
  readonly anchor: AnchorName;
  readonly text: string;
  /** 富文本目标可选(X 长文认 HTML)。⚠️ 由 adapter 决定给不给,底座不转换 */
  readonly html?: string;
  readonly scope?: InputScope;          // 缺省 main
  readonly check?: LandingCheck;        // 缺省 contains(片段)
};
```

### 4.2 喂文件

```ts
export type FeedInput = {
  readonly pageId: PageId;
  readonly anchor: AnchorName;          // <input type=file>
  readonly files: readonly string[];    // 磁盘绝对路径
  readonly scope?: InputScope;
  readonly check?: LandingCheck;        // 图:缩略图出现;视频:转码完成
  readonly timeoutMs?: number;          // ⚠️ 视频转码要 60s+
};
```

> ⚠️ **图和视频的判据不同**(现有代码已踩出来):
> 图是「缩略图出现」(秒级),视频是「**转码完成**」(可能 60s+)。
> 模型用同一个 `check` 表达,**由 adapter 给不同判据**。

### 4.3 交互动作

```ts
export type TapInput = {
  readonly pageId: PageId;
  readonly anchor: AnchorName;
  readonly scope?: InputScope;
  /** 点完等什么(如等模态关闭)—— 不给就只点不等 */
  readonly settle?: { readonly anchorGone?: AnchorName; readonly anchorAppears?: AnchorName };
};

export type PressInput = { pageId; key: string; scope?: InputScope };
export type HoverInput = { pageId; anchor: AnchorName; scope?: InputScope };
export type FocusInput = { pageId; anchor: AnchorName; scope?: InputScope };
```

🔴 **`tap` 是中立原语** —— 不分等级、不设危险词表、不拒绝任何目标(`06` §8.2)。
「绝不程序点发布」是**业务层**的规则。

> ⭐ `settle` 是现有代码的血泪(`x-article-driver.ts:377`):
> 某 step 中途失败(模态没关)→ 下一 step 在**脏态**上启动 → 连环失败。
> 把「点完等什么」放进模型,**让脏态在类型层面可被表达**。

---

## 5. 返回值

统一走 `Result<T>`(`result.ts`),三态:

| 动作 | Ok 时带什么 |
|---|---|
| `type` / `feed` | `LandingReport` |
| `tap` | `{ settled: boolean }` |
| `focus` / `press` / `hover` | `void` |

**`Degraded` 的用法**(本仓特有,`06` §4.2):

| 场景 | 为什么是 Degraded 不是 Ok/Failed |
|---|---|
| 喂图成功但 `uploadedMediaThumb` 未配 → **没校验成** | 动作做了,但**没证据**。当 Ok 是撒谎,当 Failed 是冤枉 |
| 多文件喂了 3/5 | 部分成功,调用方**必须显式处理** |

---

## 6. 模型自检:能不能表达真实场景

| 场景 | 表达 |
|---|---|
| 往 X 发推框填字 | `type({ anchor: 'composeBox', check: { kind:'contains' } })` |
| 往**长文模态**里填 | `type({ anchor:'modalInput', scope:{ kind:'within', container:'insertModal' } })` |
| 点 Insert **并等模态弹出** | `tap({ anchor:'insertBtn', settle:{ anchorAppears:'insertModal' } })` |
| 点 Update **并等模态关闭** | `tap({ anchor:'updateBtn', settle:{ anchorGone:'insertModal' } })` |
| 喂视频等转码 | `feed({ files:[...], check:{ anchorAppears:'transcodeDone' }, timeoutMs: 90000 })` |
| AI 提问框 | `type({ anchor:'inputBox' })` —— 同一套,只换锚点 |

> ✅ 六个场景全部可表达,**且不需要底座知道任何站点知识**。

---

## 7. ⚠️ 模型定稿前的两个开放问题

1. **`within` 嵌套要不要显式支持?**
   现在靠「先 ready 外层、再以内层作 container」表达。
   若出现「必须同时限定两层」的场景,模型要改成 `container: AnchorName[]`。
   **暂不加** —— 等真实场景逼出来(避免过度设计)。

2. **`frame` 的 frameId 从哪来?**
   `web.page` 的 `PageFacts` 现在**没有 frame 列表**。
   若确需 frame 作用域,`web.page` 要补 `frames()`。
   ⚠️ **实测:X / AI 现有代码零处操作 iframe** —— 所以本轮**可先不实现 frame 分支**,
   保留类型位置即可。

---

## 8. 待用户确认

1. **作用域三态**(main / frame / within)+ `ambiguous` 必须报错 —— 认可吗?
2. **`LandingReport.via`**(记录走了哪条兜底路径)—— 这是新增的,现在只在 console。认可吗?
3. **`tap.settle`**(点完等什么)—— 把脏态防护放进模型,认可吗?
4. §7 那两个开放问题:**frame 分支先不实现**,认可吗?
