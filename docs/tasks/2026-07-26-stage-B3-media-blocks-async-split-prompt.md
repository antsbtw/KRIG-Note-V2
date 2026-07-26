# 阶段 B3 — 合并媒体类 block（image/video/audio/file/externalRef/html），async 本地化剥离到外壳

> 指挥交接 prompt。完成后由指挥（另一对话）验收。**依赖 B2 已合并。风险高——核心是 async 剥离，最易犯的错是把媒体本地化塞进纯 sync 核。**

## 背景（必读）

- `docs/00-architecture/import-to-note-convergence.md`（阶段 B「异步分层」硬骨头）
- `docs/00-architecture/krig-markdown-dialect-spec.md`（image/video/audio/file 的方言语法 + 降级）

这批 block 的共性：**都涉及 async 媒体本地化**（base64→media:// 走 `mediaPutBase64` IPC）。B1 铁律=**核纯 sync**，所以本任务的关键是**分层**：纯解析进核、async 本地化留外壳。

**两套现状（调研确认）**：
- **image**：① 三格式（`<<IMAGE:pageN|caption|desc>>`占位 / `image:pageN:x,y,w,h`带bbox / 标准URL，`result-parser.ts:368-407`）**但 bbox 转 PM 时丢弃**；② 单格式标准 markdown + **async base64→media://**（`md-to-pm.ts:191-229`,`:457-470` resolvePMImageSrc）。
- **video/audio/htmlBlock**：① 独有（HTML `<video>/<audio>/<iframe>` 标签 + Obsidian `![[]]` + `!html[]()`，`result-parser.ts:953-993`,`:254-265`）；② **完全没有**。
- **fileBlock/externalRef**：② 更完整（`md-to-pm.ts:232-270`，带 mediaId/mimeType/href normalize + async 本地化）；① 的 file 降级成 paragraph 占位。

## 目标

1. 这批 block 的**纯解析**进核：markdownCore 识别各格式、产 canonical 节点，**src 原样保留**（base64/远程URL/`image:pageN` 都原样，不本地化）。image 的 bbox/pageRef **映射进 attrs**（顺带修复调研发现的「bbox 落库前被丢弃」——但先确认 image schema 是否有 bbox attr，无则按方言规范加或留 TODO）。
2. **async 本地化留外壳**：② 的 `resolvePMImageSrc`/`resolvePMAttachmentSrc`（base64→media://）、externalRef 的 `file://` normalize，全部**留在 ② 外壳做 async 后处理**，核不碰。① 侧同理，若①要支持本地化则在①外壳做。
3. ①② 这批 block 都改调核解析 + 各自外壳做本地化。

## 铁律边界（违反即验收不过）

1. **核绝对纯 sync**。grep 核内不得有 `await`/`async`/`mediaPut`/`resolvePM`/IPC。base64→media:// **只能在外壳**。这是本任务第一红线，验收重点查。
2. **只碰 image/video/audio/htmlBlock/fileBlock/externalRef**。table/callout（B2 已做）、blockquote/list（B4a）不碰。
3. **核输出 src 原样**：核产的 image/file 节点 src 是**原始值**（base64/URL/`image:pageN`）；本地化是外壳后处理的事。这样核可测（纯 sync 无 IPC）、外壳负责把 src 换成 media://。
4. **② 现有 async 本地化行为不变**：文件导入/剪藏的 base64 图片仍要正确本地化成 media://（外壳逻辑保留，只是解析部分改调核）。这是回归红线——实机验一张 base64 图导入后是不是 media://。
5. **① 独有的 video/audio/htmlBlock 输出不变**：AI 提取里这些 block 的节点结构（含 duration/author/domain 等元数据 attrs）迁移后一致。

## 实施步骤

1. 核加这批 block 的 canonical 解析（src 原样）。image 三格式识别 + bbox→attrs。
2. ② `md-to-pm.ts`：image/fileBlock/externalRef 解析改调核；**保留** `resolvePMImageSrc`/`resolvePMAttachmentSrc` async 后处理（核产原始 src → 外壳本地化）。补 video/audio/htmlBlock（从①移植识别逻辑，② 以前没有）。
3. ① 侧：这批 block 改调核 canonical 构造；① 若有本地化需求在①外壳做。
4. **契约测试**：核的解析测试（sync，断言 src 原样、bbox 进 attrs、各格式识别）；**外壳的本地化测试单独写**（可 mock mediaPutBase64），不混进核测试。

## 验收标准（交给指挥核对）

- [ ] **核纯 sync**：grep `src/shared/markdown-core/` 无 `await`/`async`/`mediaPut`/`resolvePM`/`electronAPI`（注释除外）。← 第一验收点
- [ ] 核产的 image/file 节点 **src 原样**（契约测试断言 base64 进去 base64 出来，不变 media://）。
- [ ] image bbox/pageRef 映射进 attrs（或明确 TODO 说明 schema 未加 attr）。
- [ ] ② 的 base64 本地化**行为不变**：外壳仍把 base64→media://（实机验 + 外壳测试）。
- [ ] ① 独有 video/audio/htmlBlock 输出结构不变。
- [ ] 只碰这批 block；table/callout/blockquote/list 未动。
- [ ] tsc 干净；核契约测试 + 外壳本地化测试全绿。
- [ ] 分支 `feat/markdown-core-b3`（从 feat/multi-window-step2，**B2 合并后再拉**）；提交规范 + Co-Authored-By；**不要 push**。

## 给指挥的验收自检点

- **核纯度是头号验收点**：grep 核目录禁词，一个 `await`/`mediaPut` 都不能有。这批最容易把 async 塞进核。
- src 原样吗（核不该产 media://，那是外壳的事）。
- ② 的 base64 图导入实机是否仍变 media://（本地化行为没丢）。
- ① 的 video/audio 元数据 attrs（duration/author/domain）迁移后还在吗。
- 有没有越界碰 blockquote/list（B4a 范围）。
