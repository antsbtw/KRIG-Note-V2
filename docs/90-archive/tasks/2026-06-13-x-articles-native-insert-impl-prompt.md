# 实施 Prompt：X Articles 发布 — 驱动 X 原生 Insert（终态方案）

> 交接日期：2026-06-13
> 交接人：总指挥（实测 X Article Insert 菜单后定终态）｜验收人：总指挥
> 当前分支 `docs/x-integration-design`（已含 Articles 纯逻辑层 `9a16fa20`：doc-to-article-doc / article-doc-to-html）。
> 演化记录（背景，不必全读）：格式矩阵 `*-format-matrix.md`、Insert 调研 `*-image-insert-spike.md`、旧"呈现态"prompt `*-x-articles-prompt.md`（**已被本方案取代**）。

---

## 0. 终态方案（总指挥逐项实机后拍板）

总指挥在真实 X Article 编辑器实测了 Insert 菜单全部项，结论颠覆之前所有设想：

> **X Article 原生支持 LaTeX / Table / Code / Posts / Media，且交互模式高度统一：点 Insert → 选项 → 弹模态 → 往文本框填内容 → 点 Update。**

所以**终态方案 = 驱动 X 自己的原生 Insert，几乎不渲图**（质量最高、全保真、可搜索可复制）：

| note block | X 原生 Insert | 填什么（note 源数据已全有） | 实测证据 |
|---|---|---|---|
| 文字/标题/列表/引用/链接/粗斜删 | （直接粘贴 HTML） | article-doc-to-html 产出的 HTML（已验 #7 X 保留富格式） | 已验 |
| mathBlock / mathInline | **LaTeX** | `attrs.latex` 源码 → 填模态文本框 → Update | 图1 ✅ 渲成公式 |
| table | **Table** | **`serializeTable` 产出的 markdown 表格**（`\| a \| b \|` + `\| --- \|`）→ 填模态 → Update | 图2 ✅ 渲成表格 |
| codeBlock（普通语言） | **Code** | `attrs.language` 填语言搜索框 + 源码填 code 框 → Update | 图4 ✅ 高亮代码 |
| tweetBlock | **Posts** | `attrs.tweetUrl` 填 "Paste post URL" → 自动嵌 | 图5 ✅ 嵌真实推 |
| image | **Media** | media:// → 真实文件喂（网页内 Crop media，非 OS 框）→ feedFilesToInput | 图3 ✅ 网页内上传 |
| horizontalRule | **Divider** | 仅点击 | （Insert 有 Divider） |

**渲图（render-blocks-to-media）退成极少数兜底**：只剩 X 无原生对应的 —— **Mermaid**（X Code 不渲 mermaid 图）、**mathVisual**（函数图）。这俩才转图，其余全走原生。

**不做单独「呈现态」**（总指挥拍板）：**X Article 编辑器本身就是所见即所得的预览 + 可调**（图6 全插好的成品为证；连 table 都能在 X 里调）。驱动完，用户在 X 编辑器里看成品、调整、手动点 Publish。

---

## 1. 核心工程：block 序列「原生 Insert 驱动器」

遍历 note doc，按 §0 表逐 block 驱动 X Article 编辑器。每类驱动的统一套路（已验交互模式一致）：

```
聚焦正文目标位置 → 点 Insert 按钮 → 点对应项(LaTeX/Table/Code/Posts/Media) →
  等模态出现 → 往模态的文本框填内容(合成 paste / input setter) →
  点 Update/确认 → 等模态关闭 + 块插入完成 → 下一个 block
```

技术底座**全部已验证可用**（调研 `*-image-insert-spike.md` §1 列了生产先例）：
- `executeJavaScript` 查/点/填 X DOM（AI extractors 范式）
- `btn.click()` 点 Insert/项/Update（x-drag-drop.ts:184 点 reply 按钮先例）
- 合成 paste 填模态文本框（webview-input.ts:90，已验认 DraftJS）
- CDP `feedFilesToInput` 喂图（webview-file-input.ts，2.5-b 已验）
- 按 ws 定向 `requireXWebContents`

**复用 note 侧现成产出**：
- `serializeTable`（pm-to-markdown.ts:368）→ Table 模态填的 markdown（实测就是这格式！）
- `article-doc-to-html`（`9a16fa20`）→ 文字段落 HTML 粘贴
- block 源数据：codeBlock.language、mathInline.latex、tweetBlock.tweetUrl 全现成

## 2. spike（动手前，对真实 X Article 抓 selector）
实测已确认交互**模式**，但每个模态/按钮的精确 selector 仍要 spike 抓（X 改版会变，进 profile，失效 fail loud）：
- Insert 触发钮、菜单各项（LaTeX/Table/Code/Posts/Media/Divider）的 selector
- 各模态的：输入框 selector、Update/确认按钮 selector、模态出现/关闭的判据
- Code 的语言搜索框、Media 的 Crop media → Save 流程 selector
- 全部进 `x-service-types.ts` 的 Article selector 段（别污染发推那组）

## 3. 红线
- ❌ **驱动完程序自动点 Publish**（写方向最高红线 —— 只插内容，用户手动发）
- ❌ 重新造渲图/注入原语（复用 executeJavaScript/click/合成paste/feedFilesToInput/serializeTable/article-doc-to-html）
- ❌ 凭记忆写 X selector —— 先 spike（交互模式已知，但 selector 要抓真实 DOM）
- ❌ 某 block 驱动失败就整篇中断 —— fail loud：单块失败降级（退文本/退源码/提示），其余继续
- ❌ 做单独呈现态（X 编辑器即预览）
- ❌ 改坏发推/回复/媒体（回归）
- ❌ 顺手做 Canvas 长图（独立工程）

## 4. 需总指挥拍板
1. **入口**：note 命令「发布为 X 文章」整篇 → 驱动。确认？
2. **标题**：note isTitle 首块 → Article 标题字段（驱动填）。封面本期不自动设。确认？
3. **驱动时序健壮性**：每步要等模态出现/关闭（poll），别赶在 X 动画/异步前操作 —— 这是驱动器最易出 bug 处，spike 重点验等待判据。
4. **Mermaid/mathVisual 兜底**：转图 + 走 Media 喂进去？还是降级文本？建议转图走 Media（与 image 同路）。

## 5. 验收清单
**门禁**：typecheck 0 / lint 无新增（基线10）/ vitest 全量如实报数（基线 296；bulk-delete 8 flaky 单列）+ 补单测（驱动器的纯逻辑部分：block→填充内容映射）/ 启动无新增报错。
**功能**（无 GUI 列待实机验）：note 整篇 → 驱动出含 公式/表格/代码/嵌推/图/文字格式 的 X Article（对标图6）；各 block 走对原生 Insert；Mermaid/mathVisual 兜底转图；单块失败 fail loud 不中断；**不自动 Publish**；发推/回复不回归。
**架构**：驱动复用现成原语无重复造；serializeTable/article-doc-to-html 复用；selector 进 Article 段；按 ws 定向。
**交付附**：改动清单 / spike 出的 Article selector 全集 / 各 block 驱动方式逐条 / 驱动时序怎么处理 / 回归与实机验点 / 如实测试报数。

## 6. 实机验证素材（总指挥已实测，供参考）
- LaTeX 模态：标题 Insert，文本框 placeholder "Add a LaTeX expression here"，Preview/Update 按钮
- Table 模态：Markdown/Preview 两 tab，placeholder "Add markdown here"，填 md 表格，Update 按钮（底部整条蓝按钮）
- Code 模态：语言搜索框 placeholder "Search programming language"，代码框 "Add code here"，Preview/Update
- Posts 模态：placeholder "Paste post URL" + "Show: Liked posts" 下拉
- Media：网页内 "Crop media" 界面（Crop/ALT tab + Save），非 OS 框
- Insert 菜单项：Media / GIF / Posts / Divider / Code / LaTeX / Table
（以上 placeholder 是实测可见文本，可辅助 spike 定位，但 selector 仍要抓真实 data-testid）

有架构判断拿不准（驱动时序、Insert selector、Mermaid 兜底）—— **停下来在交付说明列问题**让总指挥定。
