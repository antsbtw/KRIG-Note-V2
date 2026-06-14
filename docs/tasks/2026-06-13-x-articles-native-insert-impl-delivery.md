# 交付说明：X Articles 发布 — 驱动 X 原生 Insert（终态实现）

> 实施日期：2026-06-13
> 实施人：Claude｜验收人：总指挥
> 分支：`docs/x-integration-design`（基线 commit `f9ae13ab`）
> 任务来源：`docs/tasks/2026-06-13-x-articles-native-insert-impl-prompt.md`
> 性质：**实现 + 单测**。纯逻辑层全绿可断言；**X 真实 DOM 交互（selector / 模态时序）全部「待总指挥实机」**，本文逐条列出。

---

## 0. 一句话

note 整篇 → `buildArticlePlan`（纯逻辑，产有序 InsertStep）→ IPC 送 main → `driveArticlePlan` 逐 step 驱动 X 原生 Insert（LaTeX/Table/Code/Posts/Media/Divider），Mermaid/mathVisual 渲图兜底走 Media。**全程只插内容，绝不程序点 Publish。** selector 与驱动时序待实机 spike。

---

## 1. 改动清单（文件级）

### 新增
| 文件 | 作用 |
|------|------|
| `src/drivers/text-editing-driver/serializers/note-to-article-plan.ts` | **纯逻辑层**：note doc → `ArticlePlan`（title + 有序 `ArticleInsertStep[]`）。连续可粘贴块批量成 html step，native 块各成 latex/code/table/posts/divider/media step。IPC 可序列化纯数据。 |
| `tests/x/note-to-article-plan.test.ts` | 纯逻辑层单测（15 例）：各 block→step 映射、文档顺序穿插、标题抽取、mediaMap 兜底、空/降级。 |
| `src/platform/main/x/x-article-driver.ts` | **main 侧驱动器** `driveArticlePlan`：消费计划逐 step 驱动 X DOM（点 Insert→选项→等模态→填→Update→等关闭）。fail-loud 单步失败记 warning 继续；**绝不点 Publish**。 |
| `docs/tasks/2026-06-13-x-articles-native-insert-impl-delivery.md` | 本交付说明。 |

### 修改
| 文件 | 改动 |
|------|------|
| `src/shared/types/x-service-types.ts` | 加 `XArticleSelectors` 类型 + `selectors.article` 段（Article 编辑器全套 selector，与发推那组独立）。**全部待 spike**。 |
| `src/drivers/text-editing-driver/serializers/pm-to-markdown.ts` | 导出 `serializeTableToMarkdown(node)`（公开包装现有私有 `serializeTable`）—— Table 模态填的 markdown。 |
| `src/drivers/text-editing-driver/api.ts` | 加 `getDocArticleFallbackBlocks`（取 Mermaid/mathVisual 兜底块）+ `buildDocArticlePlan(instanceId, rendered)`（从 live doc 构计划）。 |
| `src/platform/main/web-service-base/webview-input.ts` | `pasteTextToWebview` 加可选 `htmlText` 参 —— 合成 paste 额外带 `text/html`（X Article 正文认富文本）。**不传 = 纯文本行为零变化（防回归）**。 |
| `src/platform/main/x/handlers.ts` | 加 `X_DRIVE_ARTICLE` IPC handler。 |
| `src/shared/ipc/channel-names.ts` | 加 `X_DRIVE_ARTICLE` 通道。 |
| `src/platform/main/preload/main-window-preload.ts` | 加 `xDriveArticle` 桥。 |
| `src/shared/ipc/electron-api.d.ts` | 加 `xDriveArticle` 类型。 |
| `src/capabilities/x-extraction/types.ts` + `index.ts` | 加 `driveArticle` capability 方法 + `XDriveArticleResult` 类型。 |
| `src/views/x/send-to-x.ts` | 加 `publishToXArticle()`：取整篇→渲兜底图→构计划→ensureXVisible→driveArticle→fail-loud 提示。 |
| `src/views/x/x-commands.ts` | 注册 `x-view.publish-article` 命令。 |
| `src/views/note/context-menu-content.ts` | 加 note 右键「𝕏 发布为 X 文章」（order 193，紧挨「发到 X」）。 |

---

## 2. spike 出的 Article selector 全集（**全部待总指挥实机校对**）

进 `x-service-types.ts` 的 `selectors.article`，与发推/回复那组**完全独立**（不污染）。
⚠️ **红线遵守**：下面多用 **§6 实测可见 placeholder 文本**（真实证据）作主候选 `[placeholder="..."]`，辅以 aria-label/role。**这些不是抓到的 `data-testid`** —— 本地 devtools 逐个核对后，把更稳的 data-testid 加到候选最前。失效时驱动器 fail loud。

> ★ 2026-06-13 devtools spike 已抓到一批真实 `data-testid`（下表「证据强度」标 ✅spike 的）。

| 字段 | 当前值 | 证据强度 |
|------|------------------|---------|
| `newArticleButton` | `button[aria-label="create"], ...` | **✅spike**（列表页右上角铅笔=`<button aria-label="create">`） |
| `body`（正文区） | `[data-testid="composer"], div[data-testid="composerRichTextInputContainer"] [contenteditable="true"], ...` | **✅spike**（`composer` div role=textbox contenteditable） |
| `titleInput` | `textarea[placeholder="Add a title"], ...` | **✅spike**（★更正：真标题框是这个 textarea；`twitter-article-title` 是展示 div 非输入框） |
| `mediaFileInput` | `input[type="file"][accept*="image"], input[data-testid="fileInput"]` | **✅spike**（编辑器内确有 `input[data-testid="fileInput"]`） |
| `insertTrigger` | `button[aria-label="Add Media"], ...` | **✅spike**（Insert 钮无 testid，是 `aria-label="Add Media"`+文本"Insert" 的 button） |
| `menuItem`（容器） | `[role="menuitem"], ...` | **✅spike**（点 Insert 弹 7 个 `role="menuitem"`：Media/GIF/Posts/Divider/Code/LaTeX/Table，与 menuLabels 完全吻合） |
| `menuLabels` | `{latex:'LaTeX', table:'Table', code:'Code', posts:'Posts', media:'Media', divider:'Divider'}` | **强**（§6 实测菜单文本） |
| `latexInput` | `textarea:not([placeholder])` | **✅spike★更正**（模态 textarea **无 placeholder**！占位文字是浮层非属性 → 旧 `[placeholder="Add a LaTeX..."]` 永久落空。模态内唯一无 placeholder 的 textarea） |
| `codeLangInput` | `input[data-testid="programming-language-input"]` | **✅spike**（真 testid！） |
| `codeInput` | `textarea:not([placeholder])` | **✅spike★更正**（同 latex，模态 textarea 无 placeholder） |
| `tableGridCellLabel` | `'Insert a {rows} by {cols} table'` | **✅spike★重大更正**（Table **不是填 markdown**！是网格选行列：button `aria-label="Insert a N by M table"`，1×1..10×10） |
| `modalButtonLabels.update` | **`'Insert'`** | **✅spike★更正**（模态确认钮文本是 "Insert" 不是 "Update"；与工具栏 Insert 触发钮碰撞 → confirmModal 用 excludeAria="Add Media" 排除） |
| `postsUrlInput` | `input[placeholder*="post URL" i], ...` | 🟡待 spike（本轮没点到 Posts） |
| `mediaInsertedThumb`（喂图成功判据） | `article img, figure img` | 弱（可空，空则只 warn） |

**为什么菜单项/按钮要靠「文本」而非纯 CSS**：`document.querySelector` 不支持 `:has-text()`，所以驱动器对菜单项/确认按钮用 `querySelectorAll(容器) + textContent 匹配 menuLabels/modalButtonLabels`（见 `x-article-driver.ts` `clickByText`）。这套对 X 改版更鲁棒（文本比 testid 稳）。

---

## 3. 各 block 驱动方式（逐条）

| note block | InsertStep | 驱动步骤（x-article-driver.ts） |
|---|---|---|
| 段落/标题/列表/引用/链接/粗斜删/**普通 image** | `html` | 连续块批量序列化成 X 支持 HTML（复用 `transformDocToArticleDoc` + `articleDocToHtml`）→ 在正文 `body` 合成 paste（`text/plain` + `text/html` 双 MIME）。 |
| mathBlock | `latex` | 点 Insert→LaTeX→等 `latexInput`→填裸 latex（`attrs.latex`/textContent）→点 Update→等模态关。 |
| codeBlock（普通） | `code` | 点 Insert→Code→等 `codeInput`→填语言搜索框（有则）+ 填源码→Update→等关。 |
| table | `table` | 点 Insert→Table→等 `tableInput`→填 `serializeTableToMarkdown` 产的 markdown→Update→等关。 |
| tweetBlock | `posts` | 点 Insert→Posts→等 `postsUrlInput`→填 `attrs.tweetUrl`→等 URL 框消失（自动嵌）/兜底点 Update。 |
| horizontalRule | `divider` | 点 Insert→Divider（仅点击，无填值）。 |
| **Mermaid / mathVisual** | `media`（兜底） | 渲图（`renderBlocksToMedia`）→media://→点 Insert→Media→喂文件（`feedFilesToInput` CDP）→（待实机：点 Crop Save）。 |
| codeBlock(mermaid) 未渲成图 | `code`（degraded） | 降级当普通 code 块原生插（源码可读可复制），标 `degraded`→提示用户。 |

**标题**：note `isTitle` 首块 → Article 标题框（驱动填 `titleInput`），不进正文。封面本期不自动设（§4-2 确认）。

**源数据全现成**（无需新解析）：`codeBlock.language`/textContent、`mathBlock` latex、`table` 结构（serializeTable）、`tweetBlock.tweetUrl`、`image.src`。

---

## 4. 驱动时序怎么处理

### 4.0 先打开 Article 编辑器（2026-06-13；含实机修正 false-negative）
驱动填内容前，`openArticleEditor` 先把目标 wc 导航到 Article 编辑器并等就绪：
- **入口 URL**：`https://x.com/compose/articles`（进 `selectors.article.composeUrl`，不硬编在驱动器）。
- **⚠️ 实机修正**：实测发现 `/compose/articles` **行为不稳定** —— 有时直达空白编辑器，**有时落 Articles 列表页**（"Drafts/Published/Your drafts live here"，右上角铅笔=「新建文章」）。**原逻辑只等编辑器、等不到就判无权限 → 落列表页时把有权限账号误判成无权限**（这次实机 bug）。
- **修正后流程**：
  1. 已在 `/compose/articles` 则不重载；否则 `loadURL(composeUrl)`。
  2. 先等编辑器就绪（8s）。直达 → 成功。
  3. 没直达（落列表页）→ 点 `newArticleButton`（列表页铅笔「新建文章」）→ 再等编辑器就绪。
  4. **只有「编辑器没出现 且 新建按钮也没有/点了也没进」才判无权限**（无权限账号既进不了编辑器、也没有写文章入口）。
- **就绪判据只 gate 正文区**（不 gate Insert 按钮）：body/insertTrigger 都是待 spike 猜测 selector，强 gate insertTrigger 会让有权限账号也被卡（false negative 教训）。Insert 真缺 → 留给逐 step 驱动 fail-loud 暴露，不在开编辑器这步一票否决。
- **无权限 fail loud**：提示 **「该 X 账号可能没有 Article(文章)发布权限,或 X 改版 —— 请确认账号有发文章权限」**。
- **红线**：`loadURL` / 点新建 进的都是 **draft 编辑器（非发布）**，不碰写方向红线。

### 4.1 逐 step 时序
每步「点→等→填→确认→等关」都用 poll，不赶在 X 动画/异步前操作（§4-3 驱动器最易出 bug 处）：
- `waitForSelector`：poll 等模态输入框/菜单项出现（150ms 步进，默认 6s / 模态 3-4s 超时）。
- `waitForSelectorGone`：以**输入框消失**为模态关闭判据（Update 后等其消失）。
- `STEP_SETTLE_MS=250ms`：每步之间喘息，等 X 异步渲染 + 光标复位。
- `clickByText` 在容器列表里按 textContent 匹配点击（菜单项/确认按钮）。

⚠️ **这些阈值/判据全待实机校准**（X 动画时长、模态真实关闭信号、语言下拉是否需二次选中、编辑器就绪超时是否够）。见 §6。

**fail loud（铁律 4）**：单 step 失败（selector 没命中 / 模态没出现 / 填值没落地 / Update 后没关）→ 记 warning **继续下一个 step**，整篇不中断；末尾汇总 warnings 弹给用户「请在 X 手动补」。阻断性问题（无 webContents / `article` selector 未配置 / 正文区没定位到）→ 整体 fail。

---

## 5. 红线落实（自查）

- ✅ **绝不程序点 Publish**：`driveArticlePlan` 全程无任何 publish/发布按钮交互；结尾注释明示「到此为止，用户手动 Publish」。`publishToXArticle` 成功提示也反复强调用户手动点。**+ 硬守卫（2026-06-13 spike 后加）**：实测 X Article 编辑器里 "Publish" 按钮与模态 "Update" 钮同在 DOM → `clickByText` 加 `FORBIDDEN=['publish','发布','post','发推','tweet']` 守卫，无论传什么 label，带发布语义文本/aria 的元素一律跳过（双保险，防误点）。
- ✅ **不重造原语**：复用 `pasteTextToWebview`（扩 htmlText 参，非重写）/ `feedFilesToInput` / `executeJavaScript` click 范式 / `serializeTableToMarkdown` / `articleDocToHtml` / `requireXWebContents`。
- ✅ **不凭记忆写 selector**：placeholder 文本是 §6 真实证据；testid 一律标「待 spike」。
- ✅ **单块失败不中断**：per-step fail-loud 收集 warnings。
- ✅ **不做单独呈现态**：无任何呈现态代码；X 编辑器即预览。
- ✅ **不改坏发推/回复/媒体**：`pasteTweet`/`pasteReply` 零改；`pasteTextToWebview` 新增可选参，旧调用零影响（见 §7 回归）。
- ✅ **不顺手做 Canvas 长图**。

---

## 6. 待总指挥实机验证点（无 GUI 无法自测，必须实机）

> 全部要在真实 X Article 编辑器开 devtools 验。验完把真实 `data-testid` 替进 `selectors.article`。

### 6.1 selector 校对（§2 全表）
- **G1** Insert 触发钮真实 selector？`insertTrigger` 现值是猜测。
- **G2** 菜单项容器真实是 `[role="menuitem"]` 吗？`menuItem` 待证。
- **G3** 正文区 `body` / 标题框 `titleInput` 真实 selector？现值最弱。

### 6.2 各模态交互/时序
- **L** LaTeX：填 latex 后是即时渲染还是要点 Update？Update 按钮真实文本/selector？模态关闭信号是不是「输入框消失」？
- **C** Code：①语言搜索框填了之后**是否需从下拉选中**（现仅填搜索框，未点选项 —— 大概率要补一步点首选项，待实机）？②X 支持的语言名集合（建 `language`→X 名映射表）？③多行代码合成 paste 是否丢行（DraftJS 风险）？
- **T** Table：markdown 填进去是否即渲表？X 支不支持 colspan/rowspan（note 合并表要降级）？
- **P** Posts：填 URL 后**自动嵌**还是要点确认？现逻辑「等 URL 框消失 / 兜底点 Update」是否对？
- **M** Media：①点 Media 弹的是**网页内 Crop media**（§6 说是）还是 OS 框？若 OS 框则 `feedFilesToInput` 不通。②Crop media 是否**需点 Save 落图**（现尝试点 Save，但 selector 待证）？③喂图成功判据 `mediaInsertedThumb` 真实形态？
- **D** Divider：点 Divider 插光标处还是固定位？（容错高，非阻断）

### 6.3 富文本 HTML 粘贴（关键）
- **H** `driveHtml` 现走 `pasteTextToWebview(plain, html)` 双 MIME 合成 paste。**待验：X Article 正文是否认 `text/html` 富格式**（实测 #7 验过富格式保留，但那是整篇剪贴板路；本驱动逐段 paste 进 `body` selector 的合成 paste 是否同样保留富格式，需实机看粗体/标题/列表是否还在）。若富格式没保留 → 可能需改走整篇剪贴板 + 单次 paste，或调 body selector。

### 6.4 整体编排
- **O1**（已实现 + 实机修正 false-negative + 列表页铅笔诊断，2026-06-13）驱动器**自动导航到 Article 编辑器** + 处理「落列表页→点新建」分支（见 §4.0）。实机确认 `/compose/articles` **常落 Articles 列表页**（"Your drafts live here"），右上角铅笔=「新建文章」要点它才进编辑器。**待实机校（关键，因这次就是这里出 bug）**：
  - ① `newArticleButton` selector 能否真命中列表页右上角「新建文章」铅笔（已拓宽候选：testid/aria-label「Write/Compose/撰写/新建文章」中英/href，但**仍待 spike 真实值**）。**已加诊断**：找不到该按钮时驱动器 `dumpTopRightClickables` 把列表页右上角所有可点元素的 `testid/aria-label/href/text` dump 到主进程日志 —— **一次真实运行就能从日志挑出铅笔的真实 selector**（别再猜，看真实数据），填进 `profile.article.newArticleButton` 即收敛。
  - ② `body` selector 能否真命中编辑器正文区（就绪只 gate 它；猜错则有权限账号仍误判无权限）。
  - ③ 直达编辑器 / 落列表页两条路径都验一遍（X 行为不稳定，两种都会遇到）。
  - ④ **有权限账号**实测走通（这次的 bug 账号）；**无权限账号**实测确实走到「无权限」提示。
- **O2** 驱动多 step 期间 X 有无「自动保存草稿」干扰焦点/光标？`STEP_SETTLE_MS` 够不够？
- **O3** 正文 html step 与 native 块穿插时，native 块插入后光标位置 —— X 是否把新块插在正文末尾/光标处？影响最终顺序是否与 note 一致（现假设 X 在光标/末尾顺序追加）。
- **O4**（image→media 变更，2026-06-13）总指挥实测 `<img src=media://>` 粘不进 X（变 📷）→ 逻辑层已把**普通 image 也改走 Media 喂文件**（独立 media step，src 本身是 media:// 直接喂，不查 mediaMap）。**待实机校**：普通 note 图走 Media 喂文件能否成功落进 Article 正文（与 Mermaid/mathVisual 兜底图同路，验一次即覆盖两者）。

---

## 7. 回归与测试报数

### 测试（如实）
- **基线**：296 passed（32 files）。其中 `tests/storage/bulk-delete-perf-verify.test.ts` 的 **8 个 bulk-delete 性能测试是已知 flaky**（共享内存 SurrealDB fixture 撞 `atom:blk_0 already exists`，与本次改动无关 —— 是 storage 性能用例的隔离问题，非逻辑失败）。
- **本次后**：**312 tests**（新增 `note-to-article-plan.test.ts` 16 例 —— 含 image→media step 用例）。
  - **排除 8 flaky bulk-delete → 304 passed / 0 failed**（32 files 全绿，含新增 1 file；失败全部且仅在 `bulk-delete-perf-verify.test.ts`）。
  - 8 flaky bulk-delete 单列：本次未碰 storage，与改动无关，与基线同样 flaky。
- typecheck：**0 错**。
- lint：**基线 10 problems（4 error + 6 warning，全 pre-existing），本次后仍 10，无新增**。新增/改动源文件单独 lint 全绿。

### 本轮增量（2026-06-13 第二次实跑 + dump 后：模态结构全部对齐真实 DOM）
诊断 dump 立功，**模态其实都正确弹出了**（LaTeX 模态截图为证），是 selector 错。按 dump 真实 DOM 全部更正：
- **模态 textarea 无 placeholder**：占位文字 "Add a LaTeX expression here" / "Add code here" 是浮层元素，不在 textarea 的 `placeholder` 属性上 → 旧 `[placeholder="..."]` selector **永久落空**。改用 `textarea:not([placeholder])`（模态内唯一无 placeholder 的 textarea；标题框才有 `placeholder="Add a title"`）。
- **模态确认钮是 "Insert" 不是 "Update"**：`modalButtonLabels.update='Insert'`。**碰撞处理**：工具栏 Insert 触发钮文本也是 "Insert"（aria="Add Media"）→ `clickByText` 加 `excludeAria` 参，confirmModal 传 `'Add Media'` 排掉触发钮，只点模态确认钮。
- **Code 语言框真 testid**：`input[data-testid="programming-language-input"]`。
- **Table 是网格不是 markdown**（重大更正）：dump 显示 Table 模态是一堆 `aria-label="Insert a N by M table"` 网格按钮（1×1..10×10）。`driveTable` 重写：解析 markdown 拿行列数 → 点对应网格格（"N by M" 行列朝向待实机，两种都试）→ 逐格 Tab+paste 填内容（best-effort）；超 10×10 夹到 10 并 warn。
- **诊断 dump 已可关闭**：selector 对齐后正常应不再触发；保留以备 X 改版。

### 本轮增量（2026-06-13 ★ table 填成 12/12！但填完没提交就被打断 → 修「等提交+退出编辑态」）
实机 **table 终于填成 12/12**（settle+重试+直写 textContent 三修叠加生效）！但总指挥发现「编辑表格这步很快被淹没、没完成就关闭」—— 填完格后**没等内容提交进文档模型就进下一步** → 预览时表格内容跑到表格外/丢。
- **修**：填完格后 **`sleep(500)` 等 X 提交内容 + 校验「表格里有非空内容」(persisted) + `exitTableEdit`(点正文外+光标移正文末尾,退出编辑态) + `sleep(300)`** 再进下一块。确保填的内容真提交、编辑态真退出，后续内容不跑进表格。

### 上一轮（2026-06-13 table 网格点击 flaky:加 settle + 重试）
实机这次 `table 出现=false`（上次 true）—— 网格 humanClick 点了但表格没插入 = **flaky**。devtools 手动点（有自然停顿）能成 0→1；代码点太快、网格刚弹出在动画 → 坐标不稳打空。
- **修**：网格出现后**等 500ms 稳定**再 humanClick；网格点击→等表格出现加 **3 次重试**（没成就再点/重开模态再点，模拟人手「没成再点一下」）。
- 注：`wc` 在 driveArticlePlan 入口一次取定全程复用（排除了单次驱动内 wc 漂移）；多 X 实例 wc#2/wc#5 是不同 ws 的，本次驱动只打一个。
- 上轮已恢复 `fillTableCells` 的直写 textContent 兜底（91e0c63f 成功版做法）。

### 上一轮（2026-06-13 table 填格:误删了 91e0c63f 成功版的「直写 textContent」兜底）
总指挥「前面成功过，现在怎么不知道做了」点醒 —— git 对比发现：**91e0c63f（截图填成功那版）的 `fillTableCells` 有个关键兜底 `editable.textContent = text` 直写，被我后来重写时误删** → 表格填空（execCommand/合成 paste 进不去 X 表格 cell 时，靠直写 textContent 才真填上）。
- **修**：恢复「直写 textContent + dispatch input」兜底（execCommand/paste 都失败时）；count 查询统一用 `'table' + 'td,th'`（与逐格填一致，避免 `noTable` 不一致）+ retry 5×300ms 防表格渲染延迟。
- devtools 逐步验证确认：表格确实插进 composer（cell=12），cell 内层是 contenteditable DIV —— 直写其 textContent 可填（这正是成功版做法）。
- ⚠️ 待实机：恢复直写兜底后表格内容应回来；`waitForSelector(table)=true` 但 app 内 `noTable` 的疑似多实例(wc#2/wc#5)漂移仍需关注（devtools 单实例验证是好的）。

### 上一轮（2026-06-13 ★★ table 填格:嵌入块预览态需先点「Edit block」进编辑态）
总指挥「先点开编辑才行」点破最后一环，devtools 逐步验证：
- **插表**：网格按钮 `humanClick`（完整鼠标序列）→ 正文 table 数 0→1，插入成功（标准 `<table><tr><th>/<td>`，12 格）。
- **填格真因**：插入后表格是**预览态**——`<th>/<td>` 本身 `contenteditable=null` 不可编辑，直接点 cell 焦点跑回正文 composer（`焦点不在表格内`）。**必须先点 `<button aria-label="Edit block">` 铅笔进编辑态**，cell 才可填（X 嵌入块通用模式：表格/Mermaid/代码插入后都是预览态 + Edit block 铅笔）。
- **修**：profile 加 `editBlockButton: '[aria-label="Edit block"]'`；`driveTable` 表格出现后**先 humanClick Edit block 进编辑态**，再 `fillTableCells`；`fillTableCells` 每格改为**完整鼠标序列点 cell**（进编辑态）+ activeElement 输入。
- 方法论印证（总指挥定的）：**完整模拟人工每一步**——插表→点 Edit 铅笔→逐格点击+输入，跟人手填表一模一样;遇到「直接操作不行」先 devtools 逐步验证人工真实流程,而非猜。
总指挥「人工能做的机器就能做」+「先用 devtools 测」—— 验证了真因:
- **devtools 实测**:在 X 网格选择器上,对 `<button aria-label="Insert a 4 by 3 table">` 派发**完整人工鼠标序列**（pointerover→mouseover→mouseenter→mousemove→pointerdown→mousedown→pointerup→mouseup→click）→ **正文 table 数 0→1，插入成功！** 而之前代码用简单 `.click()` → 网格只进预览态不提交 → 闪现即消失（= noTable 真因）。
- **修**：新增 `humanClick`（完整鼠标序列,带真实坐标,跟人手一样），`driveTable` 网格点击从 `clickSelector`(简单 click) 改用 `humanClick`。selector `[aria-label="Insert a N by M table"]` 实测正确。
- 教训:X 的网格/hover 类交互**简单 `.click()` 不够**，需完整鼠标事件序列模拟真人；这类交互优先 devtools 实测验证再写代码。
table 改回原生网格后，日志 `fillTableCells: 表格 cell 数=0` + `{"noTable":true}` —— 点了网格但正文**没出现 `<table>`**（grid 点击没真插入表格，或插在别处）。但缺 driveTable 各步日志无法定位是哪步断的。**加全链路诊断**：`driveTable` 打印「开始 r×c / 模态已开 / 网格按钮出现 / 网格已点 / table 出现=true/false」逐步状态 —— 下次实跑即可定位是「网格按钮没找到」「点了没插表」还是「插了但 cell 没渲染」。其余功能（富文本/公式/代码/Mermaid字号/分割线/图）实机均正常。
诊断日志铁证 table 丢失真因，**总指挥判断对了「原来添加的方法有效」**：
- `driveHtml: len=375 hasTable=true` 但 `synthetic paste length:126` —— **X 不认 `<table>` 富文本粘贴**，把它剥成 126 字纯文本（表格塌成几行字）。我上轮「table 走 HTML 粘贴」的前提（以为 X 接受 `<table>`）是误判（之前 krig-pm-table 是量错 context = note 的表）。`driveDivider 成功` 证明分割线其实插了，是表格塌陷视觉上像没了。
- **改回**：table 算 native insert → 走 `driveTable`（点 Insert→Table→网格选行列→逐格填）。+ `fillTableCells` 重写为**逐格单独执行 + await 小停顿**（一次性同步填全格 React/DraftJS 来不及 settle 易丢 → 逐格给反应时间，稳得多）+ cell 数诊断日志。
- ★ **Mermaid 字号已解决**（上轮 SVG 留白系数 1.9，实机确认字号对了）。

### 已废弃（2026-06-13：table 走 HTML 粘贴）—— X 不认 `<table>` 富文本，已回退原生网格（见上）
- **★ Mermaid 字号解决（总指挥拍板「用 SVG 约定字号」是正解）**：字号真因 = X 文章图**一律 fit 到列宽**显示，显示字号 = 列宽 ×（字/图宽比例），与 PNG 像素无关（改 PNG 尺寸没用，已证）。唯一杠杆 = **把「字/图宽比例」做小**。实现：`renderMermaidToSvgString` 给 mermaid 图**两侧留白**——把图框进 `图宽 × MERMAID_FRAME_FACTOR(1.9)` 宽的画布居中，字/总宽比例缩到 1/1.9 → X fit 列宽时字 ≈ 编辑器观感。**实机确认字号对了**。留白系数是单一旋钮（大了加、小了减）。
- **table / divider 丢失（新问题，诊断中）**：实机 mermaid 后六级表格、七级分割线都没了。table 上轮改走 html 粘贴（`<table>` 富文本）—— 但「X 接受 `<table>`」的前提其实**从未真正确认**（之前 krig-pm-table 是量错 context = note 的表）。已加诊断日志：`driveHtml` 打印每段 html 的 `len/hasTable/preview/paste结果`，`driveDivider` 打印执行 —— 下次实跑即可定位 table HTML 是否产出、paste 成没成、divider 有没有执行。
看对 console（**宿主主窗口**，非 X webview）后真相全出：
- `[render-mermaid] 自然=253×369` —— **mermaid SVG 自然只有 253px（很小）**！之前以为 1500/3168 全错。`natural=3168` 是**旧草稿里旧代码的旧图**（content-hash 不同名 `img-e936669d`），一直被误量。
- **真 bug**：`Math.min(natW, 640)` 把 253px 的图**锁死在 253 没放大** → X 把小图放大到列宽 → 字大。改为**始终固定 640**（SVG 矢量放大不糊，字:图比例不变）。`[render-mermaid] 固定 SVG=640×931` 确认生效。
- **量图脚本一直跑错 context**：返回 `table0: krig-pm-table`（我们 note 的表）+ `img-e936669d`（旧图）= 脚本在**宿主主窗口**跑，不是 X webview → X 文章里 mermaid/table 的真实尺寸**至今没真正量到**。需在 devtools 的 context 下拉选中 x.com 那个 webview 再量。
- ⚠️ Mermaid 字号是**兜底功能的 cosmetic 问题**，且精确标定卡在「量不到 X webview 真实显示尺寸」；核心功能（各 block 插入）不受影响。建议优先级下调，先保功能。

### 上一轮（2026-06-13 Mermaid 尺寸:直接写死 SVG 宽,绕开 readSvgSize 量不准）
上轮「按 640 算 scale」没生效（实机 natural 仍 3168）—— 根因 = `readSvgSize` 读 mermaid SVG 的 width 不准（useMaxWidth 把 width 设成 "100%"/style，量到的不是真实渲染宽 → scale 算错）。**改法**：`renderMermaidToSvgString` 离屏量真实尺寸（viewBox/getBBox）后，**直接把 SVG 的 width/height 写死成目标宽 640 等比**（去掉 style 的 max-width/width/height 干扰），rasterScale 固定 1.5 → PNG ≈ 960px，X 列宽（~480）缩到 ~0.5、字号 ≈ 编辑器观感。加 `[render-mermaid] 自然=…→固定=…` 诊断日志。⚠️ 仍需实机 + **新草稿 + 重载 app** 验（上轮疑似旧草稿/未重载导致 natural 没变）。

### 上一轮（2026-06-13 devtools 真实数据：Mermaid 尺寸 / Table 改 HTML 粘贴）
盲改两轮失败 → 总指挥 devtools 抓真实数据，两个真相都颠覆之前判断：
- **Mermaid 字号**：真实数据 `naturalW=3168 × displayW=480` —— **X 是把图缩小显示，不是放大**！图本身 3168px 太大（mermaid SVG 自然宽 ~1500 × RASTER_SCALE 2），X 强缩到 480 → 字号失真。修：mermaid 按**目标显示宽 640** 算 scale（`scale = 640 / SVG自然宽`，clamp 0.3~2），PNG 宽 ≈ 640、X 几乎不缩，字号 = 编辑器观感。（编辑器配置照搬那版保留——同 SVG，只是出图尺寸对了。）
- **Table 改走 HTML 粘贴**（重大简化）：真实数据 `<table class="krig-pm-table"><th><p>序号</p></th>...内容全在>` —— 说明 **`<table>` 富文本粘贴 X 能接住带内容**！而我驱动的 X 原生网格反而是个**空表填不进**（极脆）。故 **table 不再走 driveTable 网格驱动**，改回 html step（`articleDocToHtml` 的 `tableToHtml` 产 `<table>`，随文字段一起粘）。驱动网格 + 逐格填那套（driveTable/parseMarkdownTable/fillTableCells）保留代码但计划不再产 table step（dead path，留作 revert 备份）。+ 更新单测（table → html step）。

### 已废弃（2026-06-13 commit 后：Mermaid htmlLabels / Table 网格 cell 等待）—— 见下方上一轮，已被本轮真实数据取代
- **Mermaid 字号还是大**：前两轮（htmlLabels:false + useMaxWidth:false）都没对齐 —— 因 `htmlLabels:false` 改变了文字度量（SVG text vs 编辑器 foreignObject HTML），字号天生对不上。**这轮换思路**：导出**完全照搬编辑器配置**（htmlLabels:true + useMaxWidth:true + 默认 fontSize）→ SVG 与编辑器里那张**一模一样**；靠 `svgToPngDataUrl` 的 **data URI** 解 canvas 污染（blob URL 才污染）。⚠️ 待实机验：若 foreignObject 引外部字体仍 tainted → svgToPng 抛错退源码，届时需内联字体。
- **Table 没填进内容**（空网格）：根因 = `table` 元素出现 ≠ cell 渲染好（X 异步建 cell），过早 fillTableCells → 填空。修：插表后**再 poll 等「表格里出现可编辑 cell」**（td/th/role=cell/contenteditable）+ 300ms 稳定，再填；等不到 cell → `dumpTableStructure` dump 真实 cell DOM 到日志供 spike（X 表格 cell 可能不是 td/th，待真实结构校 selector）。
- **七级黏连（疑受 table 影响）**（你的判断对）：table 插完光标卡在 cell 内 → 后面文字插进表格里/黏连。修：`ensureCleanState` 末尾**把光标归位到正文最外层末尾**（每步前），确保下一块从正文顶层开始，不卡在上一个块（表格/引用）里。

### 上一轮增量（2026-06-13 回退验证闭环 + 行内公式提示）
- **回退「正文验证重试闭环」**：实机暴露闭环的**验证信号本身不可靠** —— `measureBody`（querySelector composer 数 children + innerText）量不准 X 的异步/虚拟渲染正文，**执行明明成功也判「正文未见该块」** → 白重试 3 次 + 重复插（比开环更糟）。坏验证比不验更糟，故撤掉验证闭环。**保留可靠的部分**：`ensureCleanState`（防残留模态级联）+ 模态开/关的局部重试（基于 `modalOpenMarker` 这个**可靠**信号，不依赖正文验证）。
  - 教训：验证信号必须比执行更可靠才有意义；X 正文的 DOM 结构（虚拟渲染/嵌套容器）让「数正文块」这个信号不可靠 → 该方向若要重来，得先 spike 出可靠的「正文真插了块」判据（如特定 testid 计数），否则不如不验。
- **行内公式提示**（总指挥：监测到时提示）：`buildArticlePlan` 加 `docHasInlineMath` 检测 —— 文中有 mathInline 则 `warnings` 提示「X 文章不支持行内公式，会以 `$latex$` 纯文本发出，建议改块级 `$$...$$`」。发布前 confirm 弹出。+2 单测。

### 已废弃（2026-06-13 架构重构：执行-验证-重试闭环）—— 验证信号不可靠，已回退（见上）
总指挥点出病根：一直在「单向开火」（fire-and-forget）—— 点了/填了就假设成功，靠固定等待赌时序，**没有闭环反馈**。这才是「时好时坏」的架构病根，修修补补补不完。重构为**正反馈闭环**（类似 ACK 重传）：
- **`driveStepWithVerify`（核心新抽象）**：每块走「**执行 → 验证 → 不对就重试**」：
  1. `ensureCleanState`（干净态进入）→ `measureBody`（量正文：composer 子块数 + 全文）记 before；
  2. 执行该块操作；
  3. `pollVerify`：执行后反复量正文，验证 **块数增加 且/或 内容指纹出现**（`expectedFingerprint` 取源内容前 16 字规范化，在正文 innerText 里找）；
  4. 验证通过 → 成功；不通过 → 重试（最多 3 次，每次前 ensureCleanState 清残留）；
  5. 3 次仍不成 → 跳过该块 + fail loud 汇总（不污染后面）。
- **验证信号**（总指挥决策：块计数 + 内容指纹）：`verifyStepLanded` = 块数 `after>before` 或 正文含期望指纹。有文本的块（html/latex/code/table）验内容指纹；无文本的（divider/media/posts）只验块数增加。
- **重试失败处理**（总指挥决策：跳过 + fail loud）：单块重试耗尽 → 跳过继续，末尾汇总「重试 3 次仍失败:…」让用户手动补。
- ⚠️ 已知权衡：重试会重跑整块，若某次 attempt 插了「错块」（块数长了但指纹不对），重试可能叠一个 → 偶发重复块（比级联失败轻得多，用户可删）。待实机看是否需加「重试前撤销上次残留块」。

### 上一轮增量（2026-06-13 第九次实跑：根治串行可靠性「时好时坏」）
实机暴露**系统性可靠性问题**：同样操作时好时坏，且右下角残留一个**没关掉的空表格模态**——说明上一步失败的脏态拖垮了后面（级联失败）。三处根治：
- **`ensureCleanState`（核心）**：**每个 step 开始前**先清干净态 —— 若有残留模态（modalOpenMarker 在场）或残留菜单，先关掉（点 app-bar-close，兜底合成 Escape），等其消失再开干。让每步从干净态启动、彼此独立，**一步失败不拖垮后面**（孤儿模态级联失败根治）。
- **模态开/关加重试**：`openInsertItem` 点菜单项后模态没开 → 重开一次（重点 Insert→项）；`confirmModal` 点 Insert 后模态没关 → 重点一次。消除「那一下 click 偶发没命中」的假失败。
- **段落分段去双 paste**：上轮的「先 paste 空段再 paste 正文」双 paste 抢焦点扰乱时序（可靠性元凶之一）→ 改成**分隔符拼进同一次 paste**（text/html 前置 `<p><br></p>`、text/plain 前置 `\n`），单次 paste 搞定分段，不再抢焦点。

### 上一轮增量（2026-06-13 第八次实跑：修「段落/标题黏连」）
- **段落黏连**（实机：相邻 html 段/标题被黏成一坨，如「JavaScript 示例: 五级测试:Mermaid 六级测试:表格」连一起）：根因 = X 把 HTML 粘到正文**当前光标处**，光标在上一块行尾 → 粘进来的首块**并进那一行**。OS 级 Enter 在 webview 焦点隔离下不可靠（日志 "OS Cmd+V did not land"）→ 改走**合成 paste 自携分段**：每个 html step 粘正文前，先合成 paste 一个空段落（`<p><br></p>` / `\n`）把光标推到新空块，再粘正文。两段都走已验可靠的合成 paste，不依赖 OS 键。⚠️ 实机待验分段是否干净。

### 上一轮增量（2026-06-13 第六~七次实跑：Mermaid 渲图成功！时序可靠性 + 字号治本）
data URI 修复生效 —— **Mermaid 真渲成图了，图片上传也成了**。剩两点：
- **时序「时好时坏」（最高优，可靠性根子问题）**：根因 = 各步之间靠**固定 `sleep(250ms)` 喘息**，X 异步快慢不定 → 赌不准 → 时序竞态。**根治**：全改 **poll 等实际状态**：
  - profile 加 `modalOpenMarker = [data-testid="app-bar-close"]`（实测所有 Insert 模态顶部都有的关闭按钮）。
  - `openInsertItem`：点菜单项后**等 modalOpenMarker 出现**（模态真开）再填（Divider 无模态 → 等菜单收起）。
  - `confirmModal`：点 Insert 后**等 modalOpenMarker 消失**（模态真关）再返回 —— 确保本块插完才进下一步。
  - `driveTable`：点网格后**等模态关 + 等正文 table 真出现**再填格。
  - `driveMedia`：Save 后**等 Crop 模态关**。
  - 删掉所有「赌时间」的固定 sleep（保留几处填值后的小 settle）。→ 每步等上一步真完成才进下一步，时序稳定。
- **Mermaid PNG 字体偏大**（第七次实跑定真因）：**真因不是 fontSize，是整张图被撑大了** —— `useMaxWidth:true` + 离屏容器固定 720 宽 → mermaid 把图撑到 720 → ×2 光栅 = 1440 大图 → X 按大图显示，字也跟着大。**治本**：导出用 `useMaxWidth:false`（mermaid 出**内容自然尺寸**的 SVG，自带 px 宽高）+ 离屏容器不再固定 720 宽。→ ×2 后是「2倍清晰的原尺寸图」，节点/字号比例 = 编辑器一致。fontSize 回默认（不再压 12 治标）。

### 上一轮增量（2026-06-13 第五次实跑：Mermaid taint 真根因修掉 = data URI）
上轮 `htmlLabels:false` 没解决（还是源码块）。这轮定位到 **canvas taint 的精确机制**并根治：
- **根因**：`svgToPngDataUrl` 用 `URL.createObjectURL(blob)` 给 `<img>` 加载 SVG → 画进 canvas **污染 canvas** → `toDataURL()` 被拒（"Tainted canvases may not be exported"）。**对比**：编辑器里能成功导出 mermaid 图的 `MermaidPreviewPane.svgToPngBlob` 用的是 **`data:image/svg+xml;base64,` data URI**（同源不污染）—— 这就是「能导出 vs 不能导出」的唯一差别。
- **修**：`svgToPngDataUrl` 改用 base64 data URI（`btoa(unescape(encodeURIComponent(svg)))`）替代 blob objectURL。**根治 taint，且惠及所有 SVG→PNG 路（公式/代码/Mermaid 都受益）**。+ 上轮 `htmlLabels:false`（更干净 SVG）保留。→ Mermaid 现在能真渲成图走 Media 上传。
- **Table 列宽**：实测 cell 填对了但列宽挤左上。这是 **X 编辑器表格按内容自适应**的布局 —— Insert 流程无列宽控制项，X 也未必暴露 full-width/拖列宽。属 X 侧固有布局，驱动器无程序化杠杆（详见对总指挥回复）。

### 上一轮增量（2026-06-13 第四次实跑：公式/代码/表格 cell 全成，修 Mermaid 渲图 + 提示）
实跑确认：**公式/代码模态填充成功、Table cell 内容填进去了（序号/地区/出口数量 + 3 行全对）、之前的 Mermaid 渲成图**。剩两点：
- **Mermaid 没渲成图**（提示文案先改为列出 reason + 可操作）：实机暴露**真根因 = `Tainted canvases may not be exported`**（不是 width/height）。mermaid 编辑器渲染用 `htmlLabels:true` → 节点标签走 `<foreignObject>` 包 HTML（引外部样式/字体）→ 把 SVG 画进 canvas 时**污染 canvas** → `toDataURL()` 被安全策略拒。**修**：新增 `renderMermaidToExportSvg`（临时切 `htmlLabels:false` 渲纯 SVG `<text>` 标签、无 foreignObject、canvas 不污染，渲完恢复编辑器配置）；`render-blocks-to-media` 的 mermaid 路改用它（再补显式 width/height 兜 useMaxWidth）。→ Mermaid **直接渲染成图**，不再退源码让用户手动。
- **Table 列宽**：X Article 表格列宽是**X 编辑器自身行为**（Insert 流程只有网格选行列，无列宽控制项）—— 驱动器插入+填内容后，列宽由 X 自动/用户在 X 里手动调（X 是否支持拖列宽看 X 能力）。无程序化杠杆，属 X 侧。

### ★★ 最新增量（2026-06-14 实机【完整链路全链验证】—— Table 终于跑通,正解链路 + 多表格安全)

**正解链路(实机从零到带内容表格、一次跑通、退出重进不丢)**:
```
① Insert→Table        → 弹【网格模态】(N×M 选行列,不是 markdown!)
② 点 N×M 网格按钮      → 插入【空表】(预览态),<table> 数 +1
③ 点空表的铅笔 Edit block → 弹出【Markdown 编辑模态】(★ 真正的 markdown 输入口在这,不在 ①!)
④ 等模态 textarea      → 模态(dialog)内、可见、placeholder **空** 的 textarea(实测 ph=""，非"Add markdown here"；"Add a title"是标题框要排除)
⑤ 覆盖写整段 markdown  → 原生 value setter+input(直接 setter.call 即覆盖旧 | | | | 模板)
⑥ 点 Update            → X 渲原生表格 + 进文档模型(退出重进不丢)
```

**纠正前一条增量的错误判断**:上一版以为「Insert→Table 直接弹 markdown 模态」——**错**。实机 devtools 全链脚本(/tmp/x-table-create.js → fill.js → final.js)逐步验证铁证:Insert→Table 弹的是**网格模态**(100 个 `Insert a N by M table` 按钮,无 textarea);markdown 框是**点空表铅笔后**的编辑模态才出现。我之前手动"成功"过的 markdown 模态,正是手滑点到了铅笔编辑态,误以为是 Table 菜单直出。**教训(再次):半截验证害死人——必须验证「从点 Insert 到内容写入并持久化」的完整链路,任一步真实复现,才算数。**

**多表格安全(总指挥特别提醒)**:文档含 ≥2 表格时,`clickLastTablePencil` 只定位 `tables[tables.length-1]`(刚插的),铅笔从该 table 祖先作用域内找(退化才取全局最后一个可见铅笔),`<table>` 数 before→before+1 确认新表插入 —— 不会误点前面已填好表格的铅笔。

**改动**:`driveTable` 按上述六步重写;新增 `parseTableSize`(算行列点网格)、`mouseClickSelector`(完整鼠标序列点网格/铅笔)、`clickLastTablePencil`(多表格安全的铅笔定位);`tableInput` selector 校准为 `[role="dialog"] textarea:not([placeholder]), [role="dialog"] textarea[placeholder=""]`;`confirmModal` 加 `labelCandidates`(表格按钮文案 "Update")。门禁:typecheck 0 / lint 0 / X 测试 110 全绿。

### 上一轮增量（2026-06-14 实机:Table 方向性翻转 —— 网格逐格填 → Markdown 模态,根治"退出重进内容消失")

**症状链**:网格逐格填 cell 的方案,实机出三个连锁问题:① 五级/七级标题降级成正文、② 六级标题消失、③ 表格内容(`3PWK口数量区`碎片)泄漏到表格外;**且退出 Article 再重进,整个表格内容全部消失**。

**根因(devtools 实证,非脑补)**:逐格填 cell 走的是「humanClick 进编辑态 → 往 cell 的 contenteditable 直写 textContent/execCommand」。这套**只改了 DOM,没进 X 的文档模型(草稿存储)**——所以 DOM 上看着填上了(`填成 12/12`、`persisted=true` 都是查 DOM),但 X 持久化按文档模型走 → **保存/重进即丢**。文字泄漏则是 paste 焦点没真进 cell,内容落到了表格外。

**正解(总指挥截图发现 + devtools 逐步验证)**:X 的 `Insert→Table` 弹的是一个**「Markdown / Preview」两 tab 的模态**,Markdown tab 里一个 `placeholder="Add markdown here"` 的 `<textarea>`。把整段 markdown 表格用「原生 value setter + input 事件」(与 LaTeX/Code 同款 `fillModalInput`)写进去,再点底部 **Update** 按钮 → **X 自己渲成原生表格 + 进文档模型(退出重进不丢,实机三连验证✅:输入框变 markdown→Update 后正文出带内容 3×3 表→重进还在)**。

**改动**:
- `driveTable` **整段重写**:Insert→Table→`fillModalInput(tableInput, markdown)`→`confirmModal(['Update','Insert'])`。从 ~100 行(网格 3-retry + Edit block 铅笔 + 逐格 humanClick + persist 校验 + exitTableEdit)**砍到 ~20 行**。
- **删死代码**:`parseMarkdownTable` / `fillTableCells` / `humanClick` / `cssEscape` / `dumpTableStructure` / `exitTableEdit`(逐格填那套全废)。
- `x-service-types.ts`:`tableInput` selector 从 `textarea:not([placeholder])`(选不中,markdown 框有 placeholder)校准为 `textarea[placeholder="Add markdown here" i], textarea[placeholder*="markdown" i]`。
- `confirmModal` 加可选 `labelCandidates` 参(表格按钮文案是 "Update" 不是其他模态的 "Insert",传 `['Update','Insert']` 两者都试;"Finish update" 因长度超限不会误命中)。
- **教训**:X 这类受控编辑器,**任何"往输入区写内容"都必须走它认的输入事件(原生 value setter+input,或合成 paste 视控件而定),DOM 直写一律不进模型 → 持久化丢失**。这与发推/标题/LaTeX/Code 一脉相承,表格是最后一个踩这个坑的。

### 上一轮增量（2026-06-13 第三次实跑：核心跑通，修 5 个真问题）
实跑「已驱动 13 处」—— **代码块/Mermaid/表格网格/分割线/图/标题全渲进 X 了**（右侧截图为证）。修了 5 个问题：
- **公式/代码「确认后模态未关闭」假失败**：①根因 = 合成 paste 在模态纯 textarea 上不落地（日志 `synthetic paste did not land → 慢兜底 → 个别 Fallback failed 抛错`）；模态是普通受控 textarea 不是 DraftJS → 新增 `fillModalInput`（React 兼容 native value setter 直填 + dispatch input/change），LaTeX/Code 都改用它。②`confirmModal` 关闭判据放宽：点 Insert 后内容**已落地**，`textarea:not([placeholder])` 没消失会误报 → 改为点 Insert 即视为成功（不拿不可靠的关闭判据硬失败）。
- **Mermaid 没转图**：`publishToXArticle` 加诊断 log（兜底块/渲染成功/失败计数 + kinds）→ 下次实跑看日志定位（渲染失败？mediaMap 没匹配？）。
- **Article 不支持 block 多重嵌套**（callout 嵌图传不上）：逻辑层加 `flattenBlocks` —— 容器（blockquote/callout/list/column…）**内含 native 块**时拍平，把图/代码/表提到顶层各成 step（X 不支持深嵌套，拍平是正确降级）；纯文本容器不拍平（保富格式）。+3 单测。
- **Table 网格生效但 cell 没填**：`fillTableCells` 重写 —— 不再靠「焦点+Tab+合成paste」（不落地），改**定位正文里刚插入的 table 的各 cell**（td/th/[role=cell]）直填（execCommand insertText + 合成 paste + textContent 三级，contenteditable 友好）。
- **格式有问题的 note 发布前预检**：`ArticlePlan` 加 `warnings`（嵌套拍平 / Mermaid 降级 / 超 10×10 表）；`publishToXArticle` 发布前 `window.confirm` 列出来 → 用户选「取消先回 note 调整」或「确定接受降级继续」。

### 上一轮增量（2026-06-13 实跑后修：LaTeX 模态 + Media 校验 + 时序 + 诊断）
实跑「发布为 X 文章」结果：**核心链通了**（标题+文字段落进了编辑器，Insert 也点开了，"已驱动 2 处内容"），暴露两个真问题，已修：
- **LaTeX 模态没出现**：①`openInsertItem` 加时序喘息（聚焦正文→点 Insert→等菜单→**settle**→点项→**settle**），避免赶在 X 动画前 click 打空；②模态等不到时 `dumpModalControls` 把当前页所有 textarea/input/button dump 到日志 → 一次真实运行就暴露 LaTeX/Code/Table/Posts 模态真实输入框 placeholder + Update 钮（别猜，看真实数据）。
- **Media 喂图后校验失败**（"uploadedMediaThumb 失效"）：根因是用发推那套缩略图判据，但 X Article 喂图走「网页内 Crop media」流程图不立刻落正文。修：`feedFilesToInput` **不传 thumb selector**（只让 CDP 把文件喂进 input，setFileInputFiles 成功即文件已交）→ Crop→Save → 软校验正文有无图（没有只 warn 不判失败，文件已喂进）。
- **测试文档**：写了 `2026-06-13-x-articles-test-fixture.md`（全 block 覆盖：标题/列表/引用/富格式/公式/行内公式/代码/Mermaid/表格/分割线/图），可拖进 note 导入做全链路实测。

### 上一轮增量（2026-06-13：先打开 Article 编辑器 + 无权限检测 + 实机修 false-negative）
- `x-article-driver.ts`：加 `openArticleEditor`（导航 `composeUrl` + 等编辑器就绪）；`driveArticlePlan` 改为先调它。**实机修正**：`/compose/articles` 有时落 Articles 列表页而非直达编辑器 → 加「点 `newArticleButton`（列表页新建文章铅笔）→ 再等就绪」分支；就绪判据放宽为**只 gate 正文区**（不 gate insertTrigger，避免猜测 selector 误判有权限账号无权限）。只有编辑器+新建按钮都没有才判无权限。**未动已写的填内容驱动逻辑**。
- `x-service-types.ts`：`XArticleSelectors` 加 `composeUrl` + `newArticleButton`（列表页「新建文章」按钮，待 spike）。
- `send-to-x.ts`：`publishToXArticle` 失败提示改为直接透出 driver 的 error（含无权限文案），去掉旧的「请先手动开草稿」。
- （并行）逻辑层 `note-to-article-plan.ts` + 测试：普通 image 改走 media step（总指挥实测 img 粘不进 X）。

### 回归面（防改坏发推/回复/媒体）
- `pasteTweet` / `pasteReply` / `feedFilesToInput` / `x-write.ts`：**零改**。
- `pasteTextToWebview`：仅**新增可选第 4 参 `htmlText`**；所有现有调用（AI writer / 发推 / 回复）不传该参 → DataTransfer 不 set `text/html` → 行为与改前**逐字节一致**。已 typecheck 全绿确认无调用点破坏。
- `serializeTable`：仅加公开包装 `serializeTableToMarkdown`，原私有函数与现有 markdown 序列化路径零改。
- **待实机回归**：实机时顺带验发推/回复/拖块发推仍正常（本次未碰其链路，但同 X webview 内驱动 Article 后切回发推应无残留状态）。

---

## 8. 架构判断拿不准 / 需总指挥定（停下来列）

1. **§6.4-O1 是否自动开 Article 草稿页**：本期要求用户先手动在 X 开/新建 Article。要不要驱动器导航到 Article compose URL 自动开？（需确认 X Article 草稿入口 URL。）
2. **§6.3-H 富文本 paste 路径**：若实机发现逐段 `text/html` 合成 paste 不保留富格式，是否改回「整篇一次性剪贴板 paste」（但那样 native 块就不能穿插原位插入了 —— 富格式 vs 原位穿插的取舍）。
3. **§6.2-C 语言下拉选中**：Code 语言现仅填搜索框未点选项，几乎肯定要补「点下拉首选项」一步 —— 待实机确认交互后补（属 selector + 一步 click，不改架构）。
4. **Media 喂图落位**：本期 image 跟 html 段走 `<img>`（图随富文本粘贴）；只有 Mermaid/mathVisual 兜底走独立 Media step 喂文件。若实机发现 X Article **不认 `<img src=media://>` 粘贴**（之前发推压根不认），则普通 note 图也得改走 Media step 喂文件 —— 需把 image 从 html 段拆出来单独 media step（逻辑层 `isNativeInsertBlock` 加 image 即可，一行）。**这条强烈建议实机优先验**。

---

**结论**：纯逻辑层 + 全套管线 + 驱动器骨架已落地，typecheck 0 / 新增源文件 lint 全绿 / 纯逻辑层单测 15 全绿 / 全量 303 绿（8 flaky bulk-delete 单列）。**X 真实 DOM 交互（selector / 模态时序 / 富文本 paste / Media 落位）全部待总指挥实机 spike**（§6 逐条），实机校 selector + 时序后即可跑通。**全程绝不自动 Publish。**
