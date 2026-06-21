# 网页剪藏（Defuddle 通用正文提取 → Note）— 实施计划 / 设计文档

> 文档类型：实施设计 + 分阶段任务 Prompt
> 创建日期：2026-06-01 | 版本：v0.2（2026-06-02 按用户三点目标 + 分层/注册审计整改）
> 蓝本：mirro-desktop 生产实现（`/Users/wenwu/Documents/VPN-Server/mirro-desktop`）
> 权威依据：
> - 业务蓝本：`KRIG-Note/docs/web/browser-capability/Defuddle-vs-Browser-Capability-对比分析.md`
> - 分层/注册基准：`docs/00-architecture/charter.md` §1.1/§1.2/§1.3/§1.4 + §3.2、`docs/RefactorV2/audit/2026-05-08-register-and-layer-audit.md`

---

## 0. 一句话目标

**这是 Web View 的功能，与 AI View 无关。** 在 V2 的普通浏览 webview 上**右键 →「📥 提取到笔记」**，
用 Defuddle 自动识别网页正文（去导航/广告/侧栏），连同正文图片 / 视频 / 音频 / YouTube 字幕一并落成一篇 Note。
**全量对齐 mirro-desktop 体验。**

**与 AI 对话提取彻底独立**：那套（`ai-view.extract-conversation` / `capabilities/ai-extraction`）只服务 AI View，
本功能只服务 Web View，两者不共用代码、不共用入口、不共用 capability。

---

## 1. 范围拍板（用户已定）

| 维度 | 决策 |
|---|---|
| 归属 | **Web View 功能**，与 AI View 无关（目标 1） |
| 提取引擎 | **Defuddle**（`defuddle@^0.8.0`，UMD bundle 运行时注入，不进 preload / 不进 renderer） |
| 首版范围 | **全量对齐 mirro**：正文 + 图片本地化 + 视频块 + 音频块 + YouTube 字幕 |
| 触发入口 | **仅 Web webview 右键菜单**，**不做 toolbar button**（目标 2，明确排除工具栏） |
| 媒体落位 | 图片/视频/音频各落到**对应的 block 或 inline**；其中**图片直接提取到 note 并本地化**（目标 3） |
| 能力归属 | 新建 `capabilities/content-extraction`（charter §3.2 既定能力，首个实现），**不是裸函数**（审计整改 1） |

---

## 2. 总体数据流（关键：复用已就绪的下游 + 走 capability 门面）

> 整改要点：网页剪藏是 charter §3.2 既定的 **`content-extraction` 互操作能力**（"任意来源 → atom"）的首个实现。
> 因此 main 侧实现 + renderer 侧编排都收口到 `capabilities/content-extraction` 门面，
> 不在 `platform/main/web-clip` + `views/web` 散落裸函数（见 §4.5 注册闭环）。

```
[用户右键普通浏览 webview]
        │  在既有 web-context-menu/handler.ts 的 template 里 **追加** 一个菜单项「📥 提取到笔记」
        │  （不新开第二个 context-menu 监听 —— 该 handler:48 是全仓唯一 context-menu 收口）
        │  shouldHandle(guest) 过滤（排除 AI / 翻译 webview）
        ▼
[main: content-extraction 实现半] platform/main/content-extraction/
        │  对 guest.executeJavaScript 注入 Defuddle bundle + DOM 预处理脚本
        │  ← 移植自 mirro fullpage-capture.ts generateDefuddleScript()
        ▼
FullPageResult { content: markdown, title, author, contentImages[],
                 contentVideos[], extractedAudioUrl, youtubeTranscript, ... }
        │  main 侧 sanitizeDefuddleMarkdown(content)
        │  main 侧 YouTube 字幕（youtube-transcript 库，仅 main 能跑）
        ▼
[main → renderer] IPC 推回渲染进程（WEB_CLIP_RESULT，新 channel，登记到 channel-names.ts）
        ▼
[renderer: content-extraction 门面] capabilities/content-extraction/index.ts
        │  capabilityRegistry.register({ id:'content-extraction', api })
        │  Web View 通过 requireCapabilityApi('content-extraction') 间接路由（不裸 import）
        ▼
[renderer: 编排] content-extraction 内部 import-pipeline（或 web view 命令回调）
        │  ① 媒体本地化（目标 3）：
        │     - 图片：contentImages + markdown 内嵌图 → mediaDownload('image') → media:// → image block / inline
        │     - 视频：contentVideos → video block（embed 远程为主，见 D3）
        │     - 音频：extractedAudioUrl → audio block（本地化）
        │  ② content-ingest.markdownToAtoms(md, {titleHint: title, from}) → PmAtomDraft[]（正文）
        │  ③ 追加 video/audio block 的 PmAtomDraft；图片 draft 的 src 改写为 media://（见 D2）
        │  ④ noteCap.createNotesBatch({ items:[{atoms, folderId:null, titleHint}] })
        ▼
[main: note capability] PmAtomDraft[] → realId → storage（atom + 三类边）单事务
        ▼
[renderer] note-view.set-active(newNoteId) 打开新 note
```

**已就绪、不用动的下游**：
- `capabilities/content-ingest` 的 `markdownToAtoms(md, {titleHint, from}) → PmAtomDraft[]`
  （`src/capabilities/content-ingest/internal/markdown-to-atoms.ts`）—— 注意 content-ingest（格式→atom 转换）
  与 content-extraction（源抓取 + 编排）是**两个不同能力**，剪藏能力 *消费* content-ingest，不合并。
- `noteCap.createNotesBatch(CreateNoteBatchInput)`（`src/platform/main/note/capability-impl.ts:749`）
- media 存储：`mediaDownload(url, 'image'|'video'|'audio')` / `mediaPutBase64(...)`
  （`src/capabilities/media-storage/index.ts`；main `media-store-impl.ts` 用 `net.fetch` 代抓，URL 级去重）
- 右键菜单 + 过滤 + IPC 回渲染范式：`web-context-menu/handler.ts`、`web-shared/should-handle.ts`、
  preload 桥（仿 `onWebContextMenuAction`）
- **门面范式先例**：`capabilities/tweet-fetcher`（门面 + Registry 注册）+ `platform/main/tweet-fetcher`（实现半），
  本能力与之**完全同构** —— 即"外部抓取 → note"在 V2 的既定结构。

---

## 3. 关键对接点（调研已确认，附文件:行）

### 3.1 右键菜单加项（钉死：进既有 handler，不新开监听）
- `src/platform/main/web-context-menu/handler.ts:48` 是**全仓唯一** `guest.on('context-menu')` 收口
  （复制链接/查词/翻译/导航都在这里 `shouldHandle(guest)` 过滤后 push 进 `MenuItemConstructorOptions[]`）。
- **菜单项「📥 提取到笔记」必须 push 进这个既有 template**，绝不在 content-extraction 模块里新开
  第二个 `did-attach-webview`/`context-menu` 监听（否则两套菜单逻辑竞争同一事件 —— 审计整改 3）。
- click 回调里 `guest`（WebContents）由闭包捕获 → 调 content-extraction 的 main 实现
  `captureFullPage(guest)`（范例 `drivers/web-translate-driver/translate-driver.ts:38-98` 的 `await guest.executeJavaScript`）。
- 过滤复用 `src/platform/main/web-shared/should-handle.ts:27-37`（排翻译 partition + AI URL）—— 天然保证
  "只在普通浏览 webview 出现，AI View 不出现"，对齐目标 1。
- **职责切分**：`web-context-menu/handler.ts` 只负责"加 menu item + 调 captureFullPage"；
  Defuddle 注入/抓取/sanitize/字幕/IPC 推回的执行逻辑全在 `platform/main/content-extraction/`。

### 3.2 定位 node_modules/defuddle（dev + 打包）
- 范式：`src/platform/main/ytdlp/downloader.ts:79-97` 用 `app.getAppPath()` + 候选路径 fallback。
- 读 `node_modules/defuddle/dist/index.full.js`；打包后回退 `app.asar` → `app.asar.unpacked`。
- **forge.config.ts:10-12** asar.unpack 现仅 `ffmpeg-static`，需扩成
  `**/node_modules/(ffmpeg-static|defuddle)/**`（bundle 要能被 readFileSync 读到）。

### 3.3 IPC 回渲染进程（钉死：新 channel + 统一登记）
- **新增 channel `WEB_CLIP_RESULT: 'web.clip-result'`，登记到 `shared/ipc/channel-names.ts`**，
  **不在模块里硬编码 channel 字符串**（注册原则：IPC channel 走统一登记 —— 审计整改 2）。
- preload 加 `onWebClipResult(cb)`（仿 `main-window-preload.ts:354` 的 `onWebContextMenuAction` 桥）。
- 渲染侧由 `content-extraction` 门面订阅该 channel（不在 view 里裸订阅 ipcRenderer）。
- **不复用** `WEB_CONTEXT_MENU_ACTION`：剪藏 payload 重（整页 markdown + 媒体清单），与查词/翻译的轻
  payload 不同质，独立 channel 更干净。

### 3.4 媒体本地化 API（渲染进程）
- `window.electronAPI.mediaDownload(url, 'image'|'video'|'audio')` → `{success, mediaUrl, mediaId}`
- `window.electronAPI.mediaPutBase64(dataUrl, mime?, filename?)` → 同上
- 大小限额：image/files 20MB、audio 50MB、video 200MB（超限返回 error，需容错跳过）。

### 3.5 Block / inline 形态（落 atom 时对齐 —— 目标 3：各落对应 block 或 inline）
- image：`{ src, alt, title, width, height, alignment, ... }`，src 吃 `media://`。
  - **正文内嵌图（`![]()`）→ image block 或 inline image**，src 必须改写为本地 `media://`（目标 3：图片直接提取到 note）。
  - 行内小图（emoji 级、随文字流）走 inline；独立大图走 block。由原 DOM 位置/尺寸判定（mirro 已有启发式可参考）。
- video：`{ src, embedType, title, mimeType, duration, transcriptText, ... }` → **video block**，字幕进 `transcriptText`。
- audio：`{ src, title, mimeType, duration, ... }` → **audio block**。
- **markdown 表达力边界**：markdown 只天然表达图片（`![]()`）。视频/音频/字幕无 markdown 原生语法，
  故 renderer 拿到 `markdownToAtoms` 的正文 `PmAtomDraft[]` 后**追加** video/audio block draft（见 D2）。

### 3.6 markdown → note 编排范本
- 完整链路范本：`src/views/note/markdown-import.ts:472-771`（`importMarkdownBatch`）
  → 逐文件 `markdownToAtoms` → `CreateNoteBatchItem[]` → `noteCap.createNotesBatch`。
- 打开 note：`note-view.set-active` / `set-active-in-right` 命令（`views/note/note-commands.ts:131-161`）。

---

## 4. 移植清单（从 mirro 搬什么）

> 落点统一到 `content-extraction` 能力的两个半：main 实现半 `platform/main/content-extraction/`、
> renderer 门面半 `capabilities/content-extraction/`。**不再用 `web-clip` 这个名**（它不是 charter 既定能力名）。

| mirro 源 | 行数 | 搬到 V2 | 改动 |
|---|---|---|---|
| `modules/web-extraction/fullpage-capture.ts` `generateDefuddleScript()` | ~520 | `platform/main/content-extraction/defuddle-script.ts` | DOM 预处理脚本**逐字搬**（懒加载图/非正文移除/代码块·表格·admonition 保护/`__PRELOADED_STATE__` 音频/补充 image·video 收集） |
| 同文件 `getDefuddleBundle()` | ~15 | `platform/main/content-extraction/defuddle-bundle.ts` | 路径解析改用 §3.2 的 `app.getAppPath()` + asar.unpacked fallback |
| 同文件 `sanitizeDefuddleMarkdown()` | ~50 | `platform/main/content-extraction/sanitize.ts` | 纯字符串处理，**直接搬** |
| 同文件 `fullPageCapture()` 入口 + YouTube 字幕 | ~50 | `platform/main/content-extraction/capture.ts` | `WebContentsView` → V2 的 guest `WebContents`；`youtube-transcript` 依赖照装 |
| `FullPageResult` / `ContentImage` / `ContentVideo` 类型 | ~45 | `platform/main/content-extraction/types.ts` | 直接搬 |

**新写（V2 特有，无 mirro 对应）**：
- `src/capabilities/content-extraction/index.ts` —— **能力门面 + `capabilityRegistry.register`**（§4.5）
- `src/capabilities/content-extraction/types.ts` —— `ContentExtractionApi` 类型契约
- `src/capabilities/content-extraction/internal/import-pipeline.ts` —— renderer 编排：媒体本地化 + markdownToAtoms + 追加 video/audio drafts + createNotesBatch + 打开
- `platform/main/content-extraction/handlers.ts` —— IPC handler（捕获请求 → captureFullPage → 推回）+ preload 桥
- **既有文件改动**：`web-context-menu/handler.ts` 追加菜单项（§3.1）；`channel-names.ts` 加 `WEB_CLIP_RESULT`；
  `main-window-preload.ts` 加 `onWebClipResult`；`forge.config.ts` asar.unpack 加 defuddle。

---

## 4.5 注册闭环（审计整改 1：必须建 capability，不留裸函数）

charter §3.2 已把 **`content-extraction`（任意来源 → atom）** 列为既定互操作能力（与 `ai-conversation`、
`browser-capability` 并列），目录尚不存在 —— 网页剪藏是它的**首个实现**。结构对齐 `tweet-fetcher` 先例：

```
capabilities/content-extraction/          ← 能力门面（renderer 侧）
  index.ts        capabilityRegistry.register({ id:'content-extraction', api })
  types.ts        ContentExtractionApi（clipCurrentPage 等）
  internal/import-pipeline.ts   媒体本地化 + markdownToAtoms + drafts + createNotesBatch
platform/main/content-extraction/         ← 实现半（main 侧，npm 依赖住这里）
  defuddle-bundle.ts / defuddle-script.ts / sanitize.ts / capture.ts / types.ts / handlers.ts
```

**注册纪律**：
1. 能力通过 `capabilityRegistry.register({ id:'content-extraction', api })` 注册（不裸 export 给 view 直 import）。
2. Web View 消费走 `requireCapabilityApi<ContentExtractionApi>('content-extraction')`，不硬编码绕过 Registry。
3. IPC channel 走 `channel-names.ts` 统一登记，不在模块里写裸字符串（§3.3）。
4. 菜单项进既有 `web-context-menu/handler.ts` 唯一收口，不新开监听（§3.1）。

**能力边界澄清**：`content-extraction`（源抓取 + 编排）**消费** `content-ingest`（格式→atom 转换）与
`media-storage`、`note`，三者是被调用的下游能力。能力层间"禁止互相 install"（charter:293）指的是
不建双向依赖图；单向调用下游能力的 API 是允许且必要的（与 markdown-import 调 content-ingest 同理）。

## 5. 设计决策（D1~D3 已按用户三点目标 + 分层原则定；D4/D5 仍待拍板）

### D1. Defuddle 脚本执行位置 → **定：main 注入（方案 A）**
- main 侧 `guest.executeJavaScript(bundle + script)`。bundle 读盘、YouTube 字幕（youtube-transcript）、
  media `net.fetch` 都在 main 权限齐全，且与右键菜单 click 回调同进程。
- **这也是 charter §1.3 npm 屏障的要求，不只是工程偏好**：Defuddle bundle + youtube-transcript 是业务 npm 包，
  §1.3 屏障禁止可视化层（renderer）import 业务 npm 包。放 `platform/main/content-extraction/`（主进程）天然合规
  （与 `ytdlp/fetch-transcript.ts` 在 main 用 youtube-transcript 同理）。方案 B（renderer 注入）反而要把 bundle
  字符串拖进 renderer，逼近屏障违规 —— 故 A 是分层正解。

### D2. 视频/音频/字幕怎么进 note → **定：markdownToAtoms 正文 + 追加 block draft（方案 A）**
- renderer 先 `markdownToAtoms(content)` 得正文 `PmAtomDraft[]`（含图片，src 改写 media://），
  再把 `contentVideos`/`audio` 各构造成 video/audio block 的 `PmAtomDraft` 追加，字幕填 video draft 的
  `transcriptText`，一次 `createNotesBatch`。
- **Stage 1 必须先 spike**：手搓 image/video/audio block 各一个 `PmAtomDraft` 走 createNotesBatch 建出并打开，
  验证 `Atom<'pm'>` 形态（V2 SSOT 收敛后形态严格，形态不对会落库失败）。产出"构造 helper 或模板"。

### D3. 媒体本地化降级 → **定：图片必本地化、视频默认远程/embed、音频本地化（对齐目标 3）**
- **图片（目标 3 硬要求"直接提取到 note"）**：内嵌图 + contentImages 全部 `mediaDownload('image')` → media://。
  下载失败或超 20MB → 降级保留远程 URL（不阻断整篇），但默认尽力本地化。
- 视频：超 200MB 很常见，默认**不下载**，video block src 存远程 URL + embedType（YouTube 等本就是 embed），对齐 mirro。
- 音频：本地化（通常不大、站点易失效），失败降级远程。

### D4. 落到哪个文件夹 / 是否去重（待拍板）
- 首版倾向：`folderId: null`（根级），不做 URL 去重。后续可加"剪藏专用文件夹"+ 同 URL 去重。

### D5. 触发态反馈（待拍板）
- 提取异步且可能慢（注入 + 解析 + 字幕 10s 超时）。需轻量"剪藏中…"提示。
  首版可先完成后直接打开 note；正式版接 V2 进度/通知机制（待查有无现成 toast/通知 capability）。

---

## 6. 分阶段实施（建议拆成独立子会话 prompt）

### Stage 1 — 依赖 + 形态 spike（最小可验证）
1. `npm i defuddle@^0.8.0 youtube-transcript`；forge.config asar.unpack 加 defuddle。
2. spike：main 写死一段 markdown + 手搓 image/video/audio block 各一个 `PmAtomDraft`，
   走 `createNotesBatch` 建出 note 并打开 —— **验证 D2 的 atom 形态正确**。
3. 产出：确认 image/video/audio block PmAtomDraft 的构造方式（helper 或模板）。

### Stage 2 — main 侧 Defuddle 提取链路 + capability 实现半
1. 建 `platform/main/content-extraction/`，移植 `defuddle-bundle.ts` / `defuddle-script.ts` / `sanitize.ts` /
   `capture.ts` / `types.ts`；`handlers.ts` 暴露 `captureFullPage(guest)` + IPC 推回。
2. `channel-names.ts` 加 `WEB_CLIP_RESULT`；preload 加 `onWebClipResult`。
3. 在**既有** `web-context-menu/handler.ts` template 追加「📥 提取到笔记」项（复用 shouldHandle）→ click 调 captureFullPage。
4. 验证：右键任意文章页，main 控制台打出干净 markdown + 图片/视频清单。

### Stage 3 — capability 门面 + renderer 编排 + 媒体本地化 + 建 note
1. 建 `capabilities/content-extraction/`：`index.ts`（Registry 注册）+ `types.ts` + `internal/import-pipeline.ts`。
2. import-pipeline：订阅 `WEB_CLIP_RESULT` → 媒体本地化（D3：图片必本地化）→ markdownToAtoms +
   追加 video/audio drafts（D2）→ createNotesBatch → `note-view.set-active` 打开。
3. Web View 接线：install / requireCapabilityApi('content-extraction')，触发由右键菜单走通。
4. 验证全链路：右键文章 → 生成 note，正文/图片(本地 media://)/视频/音频/字幕齐全；AI View 右键无此项。

### Stage 4 — 体验打磨
- 「剪藏中…」反馈（D5）、失败提示、YouTube 页面字幕验证、几个真实站点回归（含 mirro 测过的 WIRED/Wikipedia/Medium/YouTube）。

---

## 7. 风险 / 注意

- **Defuddle bundle 体积**：`index.full.js` 含所有 extractor，注入字符串较大；首次读盘后缓存（mirro 做法）。
- **CSP / 注入限制**：部分站点 CSP 严格，但 `executeJavaScript` 在主世界跑、不受页面 CSP 限制（与 V1/mirro 一致）。
- **打包路径**：asar.unpacked 没配好 → production 读不到 bundle。Stage 1 就要在 packaged 构建上验证一次。
- **atom 形态漂移**：V2 的 PmAtomDraft / Atom<'pm'> 是 SSOT 收敛后的形态（见 stage-5B-impl-7），
  video/audio block draft 必须精确同型，否则 createNotesBatch 落库报错 —— 故 Stage 1 先 spike。
- **不要引入 V1 的 ExtractedBlock / createAtomsFromExtracted 中间层**：V2 已物理删除 V1 import 类型，
  统一走 markdown → markdownToAtoms。视频/音频用 PmAtomDraft 直构，不复活 ExtractedBlock。

---

## 8. 参考文件索引

**mirro 蓝本**：
- `mirro-desktop/src/modules/web-extraction/fullpage-capture.ts`（707 行，核心）
- `mirro-desktop/src/modules/web-extraction/index.ts`

**V2 对接点**：
- `src/platform/main/web-context-menu/handler.ts:48`（唯一 context-menu 收口）/ `web-shared/should-handle.ts:27-37`
- `src/capabilities/content-ingest/internal/markdown-to-atoms.ts` + `types.ts`（被消费的下游能力）
- `src/platform/main/note/capability-impl.ts:749`（createNotesBatch）+ `src/capabilities/note/types.ts`
- `src/capabilities/media-storage/index.ts` + `src/platform/main/media/media-store-impl.ts`
- `src/views/note/markdown-import.ts`（编排范本）
- `src/semantic/types/pm-atom-draft.ts`（PmAtomDraft 形态）
- `src/platform/main/ytdlp/downloader.ts:79-97`（node_modules 路径范式）+ `ytdlp/fetch-transcript.ts`（main 用 npm 包先例）
- `src/platform/main/ytdlp/`、`src/capabilities/tweet-fetcher/` + `src/platform/main/tweet-fetcher/`（门面+实现半同构先例）
- `forge.config.ts:10`（asar.unpack）

**权威设计 / 审计基准**：
- 业务蓝本：`KRIG-Note/docs/web/browser-capability/Defuddle-vs-Browser-Capability-对比分析.md`
- 分层/注册：`docs/00-architecture/charter.md` §1.1/§1.2/§1.3/§1.4 + §3.2（content-extraction 既定能力）
- 严格态定义：`docs/RefactorV2/audit/2026-05-08-register-and-layer-audit.md`
