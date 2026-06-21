# 网页剪藏（Defuddle → Note）实施 — 任务 Prompt

> 这份 prompt 给独立子会话执行。
> 调用方（总指挥）：把整份文档作为 user message 发给新对话。

---

## 你的身份

你是 KRIG-Note V2 的**实施工程师**。本次任务：把「Web View 网页剪藏（Defuddle 通用正文提取 → Note）」
按既定设计字面落地为 TypeScript 代码。

**设计文档（必读，权威）**：`docs/tasks/2026-06-01-web-clip-defuddle-design.md`（v0.2）。
本 prompt 是它的**执行细化**，两者冲突时**以设计文档 + 本 prompt 的明确指令为准**，不要自由发挥。

**Agent 类型**：`general-purpose`（需要 Write/Edit/Bash，不是 Plan）。

---

## 上下文（必读，不要在产出里复述）

### 仓库 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **第一步守门**：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git branch --show-current && git status --short | head`
- 当前在 `main`。**先开实施分支**：`git checkout -b feature/web-clip-defuddle`（main 上有一堆未跟踪的 docs/tasks/*.md，
  那是别的任务的产物，**不要动、不要提交它们**；只提交你自己新增/修改的文件）。

### 蓝本（照搬来源，本机存在）

- `/Users/wenwu/Documents/VPN-Server/mirro-desktop/src/modules/web-extraction/fullpage-capture.ts`（707 行，核心）
  - `generateDefuddleScript()`：注入脚本（DOM 预处理 + Defuddle.parse + 补充媒体收集）— **逐字搬**
  - `sanitizeDefuddleMarkdown()`：markdown 清洗 — **直接搬**
  - `fullPageCapture()` + YouTube 字幕 — 改 webview 句柄类型后搬
  - `FullPageResult` / `ContentImage` / `ContentVideo` 类型 — 直接搬
- 先 `Read` 这个文件全文，再开始移植。

### 三条铁律（违反即返工，源自设计 §4.5 + 分层/注册审计）

1. **这是 Web View 功能，与 AI View 无关**。入口**只在普通浏览 webview 右键菜单**，**不做 toolbar button**。
2. **必须建 `content-extraction` capability，不留裸函数**。结构：
   - 门面（renderer 侧）：`src/capabilities/content-extraction/`（`index.ts` 做 `capabilityRegistry.register`）
   - 实现半（main 侧，npm 依赖住这里）：`src/platform/main/content-extraction/`
   - 对齐 `tweet-fetcher` 先例（门面 + `platform/main/tweet-fetcher` 实现半）。
3. **菜单项进既有唯一收口**：`src/platform/main/web-context-menu/handler.ts`（`guest.on('context-menu')` 是全仓唯一
   context-menu 监听）。在它的 `template` 里 **push 一个新 item**，**绝不新开第二个 `context-menu` / `did-attach-webview` 监听**。

### 已确认的真实签名 / 接线点（别再去猜，直接用）

- `content-ingest`：`markdownToAtoms(md: string, options?: { titleHint?, from? }): Promise<{ atoms: PmAtomDraft[]; warnings }>`
  （`src/capabilities/content-ingest/types.ts:59`；通过 `requireCapabilityApi('content-ingest')` 拿）
- `note`：`createNotesBatch(input: { items: CreateNoteBatchItem[]; broadcastMode? }): Promise<{ notes, failures }>`
  （`src/capabilities/note/types.ts:76`）；`CreateNoteBatchItem = { atoms: PmAtomDraft[]; folderId: string|null; titleHint?; importToken? }`（:27）
- `media-storage`（renderer，`src/capabilities/media-storage/index.ts`）：
  - `mediaDownload(url, 'image'|'video'|'audio'): Promise<{ success, mediaUrl?, mediaId?, error? }>`（:66，main 用 `net.fetch` 代抓 + URL 去重）
  - `mediaPutBase64(input, mime?, filename?)`（:48）
- IPC 注册入口：`platform/main/ipc/ipc-bus.ts` 的 `initIpcBus()`（仿 `registerTweetFetcherHandlers` 在这里挂）。
- preload：`src/platform/main/preload/main-window-preload.ts`，仿其中 `onWebContextMenuAction(:354)` 加桥。
- channel：`src/shared/ipc/channel-names.ts`，现有 `WEB_*` 一堆；**新增 `WEB_CLIP_RESULT: 'web.clip-result'`**（main → renderer 推送）。
- 过滤：`src/platform/main/web-shared/should-handle.ts` 的 `shouldHandle(guest)`（排翻译 partition + AI URL）。
- 打开 note：`commandRegistry.execute('note-view.set-active', noteId)`（`views/note/note-commands.ts`）。
- node_modules 路径范式：`src/platform/main/ytdlp/downloader.ts:79-97`（`app.getAppPath()` + asar.unpacked fallback）。
- PmAtomDraft 形态：`src/semantic/types/pm-atom-draft.ts`（`{ tmpId, parentTmpId?, payload: Atom<'pm'>, from? }`）。

---

## 已拍板的设计决策（直接执行，不要再问）

- **D1 = main 注入**：`guest.executeJavaScript(bundle + script)` 在主进程跑（Defuddle bundle / youtube-transcript /
  media `net.fetch` 都在 main，且符合 charter §1.3 npm 屏障 —— 业务 npm 包不进 renderer）。
- **D2 = markdownToAtoms 正文 + 追加 block draft**：先 `markdownToAtoms(content)` 得正文 drafts（含图片，
  src 改写 `media://`），再把视频/音频各构造成 video/audio block 的 `PmAtomDraft` 追加到尾部，字幕填 video draft 的
  `transcriptText`，一次 `createNotesBatch`。
- **D3 = 图片必本地化 / 视频默认远程 / 音频本地化**：
  - 图片（含正文内嵌 `![]()` + `contentImages`）：`mediaDownload('image')` → `media://`；失败或超 20MB → 降级保留远程 URL（不阻断整篇）。
  - 视频：默认**不下载**（多数超 200MB），video block src 存远程 URL + `embedType`。
  - 音频：`mediaDownload('audio')`，失败降级远程。
- **D4 = 根级、不去重**：`folderId: null`。
- **D5 = 首版完成即打开 note**：先不做"剪藏中…" toast（留 TODO 注释），完成后 `note-view.set-active` 打开。

---

## 分阶段执行（每个 Stage 结束做该 Stage 的验证，再进下一个；每 Stage 一个 commit）

> 提交规范：commit message 用 `feat(web-clip): ...`；只提交你新增/改的文件，别碰 main 上别人未跟踪的 docs。
> commit message 结尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

### Stage 1 — 依赖 + atom 形态 spike（最小可验证，**最先做、最关键**）

目的：在写任何提取逻辑前，先确认 image/video/audio block 的 `PmAtomDraft` 形态能被 `createNotesBatch` 成功落库并打开
（V2 SSOT 收敛后形态严格，形态不对会落库报错）。

1. `npm i defuddle@^0.8.0 youtube-transcript`。
2. `forge.config.ts` 的 `asar.unpack` 从 `'**/node_modules/ffmpeg-static/**'` 改成
   `'**/node_modules/(ffmpeg-static|defuddle)/**'`。
3. **先研究形态**：Read `src/drivers/text-editing-driver/blocks/{image,video-block,audio-block}/spec.ts`
   拿到三种 block 的 attrs 字段；Read `src/views/note/markdown-import.ts` 看它怎么把 `markdownToAtoms` 产物拼成
   `CreateNoteBatchItem` 调 `createNotesBatch`（这是你的编排范本）。
4. **spike 验证**：写一个临时命令（或临时测试入口），手搓 3 个 `PmAtomDraft`（image / video / audio block 各一）
   + 一段正文段落 draft，调 `createNotesBatch` 建出一个 note，`note-view.set-active` 打开，肉眼确认三种 block 都渲染正确。
5. **产出**：在 `capabilities/content-extraction/internal/` 下落一个 `draft-builders.ts`（或类似），
   把"image/video/audio block → PmAtomDraft"的构造固化成 helper 函数（spike 用的就是它，不要写完即弃）。
6. spike 临时入口验证通过后删除，保留 helper。

**Stage 1 验证标准**：app 跑起来，触发 spike，能看到一个含 image+video+audio+段落的 note 正常打开渲染。
**没通过不要进 Stage 2。**

### Stage 2 — main 侧 Defuddle 提取链路 + 右键菜单接入

1. 建 `src/platform/main/content-extraction/`，从 mirro 移植：
   - `defuddle-bundle.ts`：`getDefuddleBundle()`，路径解析改用 ytdlp downloader 的 `app.getAppPath()` + asar.unpacked fallback + 读盘缓存。
   - `defuddle-script.ts`：`generateDefuddleScript()`，**注入脚本逐字搬**（懒加载图激活 / 非正文移除 / 代码块·表格·admonition 保护 / `__PRELOADED_STATE__` 音频 / 补充 image·video 收集 / Schema.org）。
   - `sanitize.ts`：`sanitizeDefuddleMarkdown()` 直接搬。
   - `capture.ts`：`captureFullPage(guest)` —— 入参从 mirro 的 `WebContentsView` 改成 V2 的 guest `WebContents`
     （`guest.executeJavaScript(...)` + 10s 超时 race）；YouTube 字幕走 `youtube-transcript`；返回 sanitize 后的 `FullPageResult`。
   - `types.ts`：`FullPageResult` / `ContentImage` / `ContentVideo` 直接搬。
   - `handlers.ts`：`registerContentExtractionHandlers()`（仿 tweet-fetcher）；在 `ipc-bus.ts.initIpcBus()` 注册。
2. `channel-names.ts` 加 `WEB_CLIP_RESULT`。
3. **改既有** `web-context-menu/handler.ts`：在 `shouldHandle(guest)` 通过后构建的 `template` 里 **push**
   `{ label: '📥 提取到笔记', click: async () => { const r = await captureFullPage(guest); mainWindow.webContents.send(IPC_CHANNELS.WEB_CLIP_RESULT, r); } }`
   （位置：放在导航项之前/合适处；保持既有项不变）。

**Stage 2 验证标准**：右键任意文章页点「📥 提取到笔记」，main 进程控制台能打出干净 markdown + 图片/视频清单（先 console 看结果，renderer 接线在 Stage 3）。AI 站点 / 翻译 webview 右键**不出现**该项。

### Stage 3 — capability 门面 + renderer 编排 + 媒体本地化 + 建 note

1. 建 `src/capabilities/content-extraction/`：
   - `types.ts`：`ContentExtractionApi`（至少 `init()` / 订阅入口；本期触发由右键菜单 → IPC 推，门面负责订阅 `WEB_CLIP_RESULT` 并跑 pipeline）。
   - `index.ts`：`capabilityRegistry.register({ id: 'content-extraction', api })`（仿 tweet-fetcher/content-ingest）。
   - `internal/import-pipeline.ts`：收 `FullPageResult` →
     ① 媒体本地化（D3）：正文内嵌图 + contentImages 走 `mediaDownload('image')` 改写 src 为 `media://`；音频本地化；视频留远程。
     ② `requireCapabilityApi('content-ingest').markdownToAtoms(content, { titleHint: title, from: { extractionType: 'web-clip', extractedAt } })` → 正文 drafts。
     ③ 用 Stage 1 的 `draft-builders` 追加 video/audio block drafts（字幕进 video `transcriptText`）。
     ④ `requireCapabilityApi('note').createNotesBatch({ items: [{ atoms, folderId: null, titleHint: title }] })`。
     ⑤ `commandRegistry.execute('note-view.set-active', notes[0].id)` 打开。
   - `internal/draft-builders.ts`：Stage 1 的 helper（这里复用）。
2. preload 加 `onWebClipResult(cb)`（仿 `onWebContextMenuAction`）。
3. **门面订阅**：在合适的 capability 初始化时机（仿现有 capability register 流程）让 content-extraction
   订阅 `WEB_CLIP_RESULT` → 跑 import-pipeline。Web View install 该 capability（仿 AI View install ai-extraction 的方式）。

**Stage 3 验证标准**（全链路）：右键任意文章 → 生成一篇 note：正文结构完整、图片是本地 `media://`、视频/音频各成 block、
YouTube 页面有字幕。AI View 右键**无**此项。

### Stage 4 — 真实站点回归 + 收尾

1. 回归测试（手动）：Wikipedia / Medium / 一个新闻站 / 一个 YouTube 视频页 各剪一次，确认正文/图片/视频/字幕。
2. **打包路径验证**：`npm run package`（或项目既定打包命令）跑一次，在打包产物里确认 defuddle bundle 能被读到
   （asar.unpacked 生效）。如读不到 → 修 §Stage1.2 的 unpack glob。
3. 失败降级核对：断网 / 超大图 / 无字幕视频，确认不崩、降级合理（保留远程 URL / 跳过）。
4. 清理：删 Stage 1 的临时 spike 入口（若还残留）、补必要注释、`tsc`/lint 过。

---

## 验收清单（交付前自查，逐条对照）

- [ ] 三铁律：仅 Web View 右键入口（无 toolbar button）；建了 `content-extraction` capability 且 `capabilityRegistry.register`；菜单项进既有 `web-context-menu/handler.ts`，无新增 context-menu 监听。
- [ ] `WEB_CLIP_RESULT` 登记在 `channel-names.ts`，模块内无裸 channel 字符串。
- [ ] 业务 npm 包（defuddle / youtube-transcript）只在 `platform/main/content-extraction/`，renderer 侧零 import。
- [ ] content-extraction 单向消费 content-ingest / media-storage / note，未与它们互相 install。
- [ ] 图片本地化为 `media://`（失败降级远程）；视频远程 + embedType；音频本地化。
- [ ] 全链路：右键文章 → note 正确生成并打开；AI/翻译 webview 右键无此项。
- [ ] 打包产物能读到 defuddle bundle。
- [ ] 未引入 V1 的 `ExtractedBlock` / `createAtomsFromExtracted`（统一走 markdown → markdownToAtoms）。
- [ ] `tsc` 无新增报错；只提交本任务相关文件。

---

## 卡住时的升级路径（不要自行拍架构决策）

遇到下列情况**停下来报告给总指挥**，不要自创方案：
- Stage 1 spike 反复落库失败（block attrs 形态对不上 SSOT）；
- 设计文档 / 本 prompt 与实际代码出现**结构性**矛盾（不是行号小漂移，而是接口根本不存在/已改名）；
- 需要新建一个本 prompt 未授权的 capability 或新 IPC 模式；
- Defuddle 注入在 V2 webview 下被 CSP/sandbox 拦截，main 注入路径不通。

行号/小签名漂移：自行核对真实代码为准（本 prompt 行号截至 2026-06-02，可能小漂），**不必为此停下**。
