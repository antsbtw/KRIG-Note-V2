# L5-C6 PDF 提取 → Note 完成报告

> 阶段:L5-C6 — V1 → V2 ebook 迁移补段(C1~C5 之后追加)
> 分支:`feature/L5C6-pdf-extraction`
> 起草日期:2026-05-10
> 设计:[../v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.3 § 6 D-8(原标 "不在迁移";补做)
> 契约:[../../10-business-design/ebook/PDF-Note-Atom数据契约-v2.md](../../10-business-design/ebook/PDF-Note-Atom数据契约-v2.md)

---

## 0. 背景

C1~C5 完成 ebook 迁移基本盘(书架 / PDF 渲染 / EPUB 渲染 / 大纲搜索 / 书签 / 标注)。
"PDF → Note 提取" 在原计划 D-8 标 "不在迁移"。用户决议:

> **目的是能够导入提取的 pdf 到 note,如果不完整实现,哪什么时候实现呢?参考 V1 就好了,这个功能在 V1 是完整工作的。**

故新增 C6 段把链路接通:打开 PDF → 📤 上传到 KRIG Knowledge Platform → Platform UI 装载到右栏 web-view → 用户在 Platform 操作提取 + 下载 → 主进程拦截下载 → 推 atom JSON → renderer 落 noteStore。

---

## 0.1 完成清单

### Commit 1 — feat(platform)(7edbecb)

| 项 | LOC | 状态 |
|---|---:|---|
| `platform/main/extraction/config.ts`(NEW)| 19 | ✅ Platform URL + 默认凭证 |
| `platform/main/extraction/upload-service.ts`(NEW,V1 直迁)| 168 | ✅ multipart + JWT 缓存 + 401 自刷 |
| `platform/main/extraction/extraction-handler.ts`(NEW,V1 直迁)| 138 | ✅ download intercept JS 注入(blob: → fetch → console.log) |
| `platform/main/extraction/handlers.ts`(NEW)| 143 | ✅ EXTRACTION_UPLOAD/IMPORT IPC + did-attach-webview hook |
| `shared/ipc/channel-names.ts`(改)| +5 | ✅ 3 channel(UPLOAD/IMPORT/NOTE_CREATE)|
| `shared/ipc/electron-api.d.ts`(改)| +8 | ✅ extractionUpload/Import + onExtractionNoteCreate |
| `platform/main/preload/main-window-preload.ts`(改)| +16 | ✅ |
| `platform/main/index.ts`(改)| +5 | ✅ registerWebviewExtractionHook 挂载 |
| `platform/main/ipc/ipc-bus.ts`(改)| +2 | ✅ |

### Commit 2 — feat(text-editing)(97e7e64)

| 项 | LOC | 状态 |
|---|---:|---|
| `capabilities/text-editing/converters/atoms-to-pm.ts`(NEW)| 482 | ✅ 13 atom type + 5 inline + list tree builder |
| `capabilities/text-editing/converters/sanitize-atoms.ts`(NEW)| 157 | ✅ 契约 § 9 八条容错 |

### Commit 3 — feat(ebook,note)(b9bfcec)

| 项 | LOC | 状态 |
|---|---:|---|
| `views/note/extraction-import.ts`(NEW)| 178 | ✅ batch → folder + 多 Note 落地 |
| `views/note/use-extraction-import.ts`(NEW)| 28 | ✅ subscribe IPC + 调导入 |
| `views/note/NoteView.tsx`(改)| +5 | ✅ 挂 useExtractionImport |
| `views/ebook/EBookView.tsx`(改)| +28 | ✅ handleExtract 调 IPC + 命令路由 |
| `views/ebook/EBookToolbar.tsx`(改)| +16 | ✅ 📤 按钮(fixed-page only)|
| `capabilities/text-editing/index.ts`(改)| +4 | ✅ 暴露 atomsToProseMirror / sanitizeAtoms |
| `capabilities/text-editing/types.ts`(改)| +40 | ✅ AtomInput / PMDocNode 共享类型 + API 字段 |
| `capabilities/text-editing/converters/atoms-to-pm.ts`(改)| -1/+1 | id 改 optional |
| `capabilities/text-editing/converters/sanitize-atoms.ts`(改)| -1/+3 | id 改 optional + filter guard |

### Commit 4 — docs(本)

总:**~1442 LOC 新增 / ~13 重写 / 18 文件**(对齐设计 § 6 D-8 估算 "~600 + 转换器 ~500"),实际偏高因:
- atoms-to-pm 完整覆盖 13 type + 5 inline(V1 散布在多处现合并到一个文件)
- sanitize-atoms 单独一个文件(V1 在 src/shared/sanitize-atoms.ts)
- main 侧拆 4 个文件(config / upload-service / extraction-handler / handlers)而不是混一个

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **Platform URL / 凭证**:`http://192.168.1.240:8090/api/v1` + `8091` Web UI + `admin/123456`(对齐 V1 硬编码)
- **upload-service**:`net.request` multipart + JWT 缓存 + 401 自动刷新(V1 直迁)
- **download intercept JS**:覆盖 `<a>` click,blob URL → fetch → `console.log('KRIG_IMPORT:' + JSON)`,1500ms flush 防多文件乱序(V1 直迁)
- **webview attach hook**:`mainWindow.contents.on('did-attach-webview', ...)` + `did-navigate` URL prefix 过滤 + WeakSet 防重(对齐 V1 模式)
- **EXTRACTION_NOTE_CREATE 广播**:不是 reply,所有 webContents 都收到(view 端去重)
- **Atom 契约严格**:13 atom type 全覆盖 + 5 InlineElement(text / link / math-inline / code-inline)+ kebab→camelCase 归一(契约 § 5.4)
- **sanitizeAtoms 八条容错**:契约 § 9 完整实现(v1→v2 类型迁移 / document root 过滤 / parentId 清理 / sourcePages 迁 from / 空 text 过滤 / mathInline 归一 / tiptapContent 递归 / 空容器补占位)
- **import 流程**:bookName → folder 找/建 → 每章 atoms = `[noteTitle, ...flatten(pages.atoms with from.pdfPage)]` → sanitizeAtoms → atomsToProseMirror → DriverSerialized → noteStore.create(对齐 V1 src/main/extraction/import-service.ts)
- **同名同文件夹章节去重**:跳过已存在 title(V1 同款逻辑)

### 1.2 微调 / 架构对齐

| 项 | V1 / 设计 | V2 实际 | 理由 |
|---|---|---|---|
| 转换器位置 | V1 散布(src/main/extraction/import-service.ts + src/shared/sanitize-atoms.ts + src/plugins/note/converters/registry.ts) | 全部移到 `capabilities/text-editing/converters/` | V2 三大原则:转换器是 text-editing 能力的内部实现细节,view 通过 capability registry 间接路由 |
| 转换器执行环境 | V1 在 main(因为 noteStore 在 main)| V2 全在 renderer | V2 noteStore 在 renderer(localStorage),main 只 broadcast atom JSON,view 端转换 + 调 store |
| 提取入口 | V1 `extractionOpen` 一个 IPC 同时 upload + 切右栏 | V2 拆开:`extractionUpload` IPC 只上传,view 拿 platformUrl 后调 `commandRegistry.execute('web-view.open-url')` | V2 严守"view 不直 import @views/web/data-model"原则;命令路由是已建好的跨 view 通信通道 |
| extraction-import 文件位置 | V1 在 `src/main/extraction/import-service.ts`(main)| V2 在 `src/views/note/extraction-import.ts`(renderer / note view 内)| 只有 note view 能直访问 noteStore / folderStore;ebook view 不写 note 数据;import 是"创 note"业务,归 note view |
| useExtractionImport 挂载点 | V1 ExtractionView 内 `console-message` 监听(右栏 view 内) | V2 在 NoteView 内挂 hook | V2 使用 main 全局拦截 + 广播,无需依赖 right-slot 装的是哪个 view;NoteView 一直常驻(workspace 至少有 left = note-view 是默认),挂一处即够 |
| atoms-to-pm 异步 | V1 同步(main 内) | V2 异步(`Promise<PMNode[]>`) | image base64 → mediaPutBase64 走 IPC 异步 |
| Graph 关系建立 | V1 graphStore.relateNoteToEBook | V2 不做 | V2 graph 是 view-only 视图;关系语义在 atom.from.pdfPage(已附);真要关联到 ebookId 留 graph 阶段做 |
| listItem 处理 | V1 sanitizeAtoms 把 listItem→paragraph 展开(V1 PM schema 没 listItem) | V2 不展开,atoms-to-pm tree builder 处理 flat + parentId → nested | V2 PM schema 含 listItem 中间层 |
| TextEditingApi 暴露 | (V1 无 capability 概念) | 新增 `atomsToProseMirror` + `sanitizeAtoms` 两个字段 + `AtomInput` / `PMDocNode` 共享类型 | W5 严格态:view 通过 capability registry 间接路由,不直 import converters/* 运行时 |

### 1.3 砍掉 / 推迟

- **OCR 文本**:contract atom 没这个字段(契约不要求);Platform 自己处理,KRIG 只接 atom JSON
- **Graph 关系建立(note → sourced_from → ebook)**:留 graph 阶段做(语义在 atom.from 内已有)
- **import 进度反馈**:目前用 console.log(`[extraction-import] folder=${id} created=${n} skipped=${m}`),无 UI;后续可接 toast / banner — 留 UX 完善阶段

---

## 2. 数据流

```
用户在 EBookView 打开 PDF
    ↓ 点 📤 按钮
window.electronAPI.extractionUpload()
    ↓ IPC EXTRACTION_UPLOAD
main:upload-service.ts(net.request multipart + JWT)
    ↓ 上传成功返 { uploaded, md5, platformUrl }
view:commandRegistry.execute('web-view.open-url', platformUrl)
    ↓ 命令路由
WebView Host(右栏)装 Platform 详情页
    ↓ main:registerWebviewExtractionHook 监听 did-navigate
URL 匹配 Platform 域 → attachExtractionToWebContents
    ↓ 注入 download intercept JS + 监听 console-message
用户在 Platform 操作提取 → 触发 JSON 下载
    ↓ 拦截 <a download> → fetch blob → console.log('KRIG_IMPORT:'+JSON)
main:console-message 监听 → 解析 → broadcastImport
    ↓ EXTRACTION_NOTE_CREATE 广播给所有 renderer
NoteView:useExtractionImport hook 收到
    ↓ importExtractionBatch(data)
folderStore.find/create(bookName)
每章:
    ├── atoms = [noteTitle, ...flatten(pages.atoms with from.pdfPage)]
    ├── tea.sanitizeAtoms(atoms)
    ├── tea.atomsToProseMirror({atoms}) → PMDocNode[]
    ├── DriverSerialized 信封 { format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: ... } }
    └── noteStore.create(doc, title, folderId)
```

---

## 3. 测试清单

### 3.1 功能验证

| 项 | 步骤 | 期望 |
|---|---|---|
| 启动 + 打开 PDF | `npm run dev` → 右上角 + 导入 PDF → 双击打开 | EBookView 渲染 PDF 第 1 页 |
| 📤 按钮显示 | toolbar 右段(fixed-page 路径) | 📤 按钮可见(EPUB 路径不显)|
| 上传 PDF | 点 📤 | 控制台无 error;Platform 域名(192.168.1.240:8091)在右栏 webview 装载 |
| 上传中按钮 disabled | 上传期间再点 📤 | 按钮 disabled,无重复请求 |
| Platform 已存在(去重)| 重复点 📤 已上传过的 PDF | 上传 OK,Web UI 直接跳书籍详情页(平台后端去重)|
| 提取并下载 atom JSON | 在 Platform Web UI 操作提取 → 下载章节 JSON | NavSide 笔记列表自动出现 PDF 文件名同名文件夹 + 章节 Note |
| Atom 内容正确 | 打开新创建的 Note | heading / paragraph / mathBlock / codeBlock / image / table / blockquote / list / horizontalRule / callout 渲染正确 |
| 同名章节去重 | 重复触发 import 同章节 | 不重复创建 Note |
| 异常容错 | 关 Platform 服务后点 📤 | 上传失败,console.warn,UI 不卡 |

### 3.2 架构验证

- ✅ `npm run typecheck` 全绿
- ✅ `npm run lint` 全绿(0 error,0 warning)
- ✅ EBookView 不直 import @views/note/* 或 @views/web/*(走命令路由 / IPC)
- ✅ atoms-to-pm 不直 import @capabilities/media-storage/* 运行时(走 capability registry)
- ✅ extraction-import 不直 import @capabilities/text-editing/converters/*(走 capability registry)
- ✅ main 侧 EXTRACTION_NOTE_CREATE 广播,不依赖右栏装的是哪个 view

---

## 4. 已知短板 / 后续

### 4.1 短板

1. **import 进度无 UI 反馈**:console.log 起步,失败 / 成功用户看不到。后续 UX 完善阶段加 toast / banner。
2. **Platform URL 硬编码**:`192.168.1.240` 是局域网内网。后续应改为配置项(用户 Settings)或环境变量。
3. **认证凭证硬编码**:`admin/123456` 写在 config.ts。生产环境应做用户登录流程。
4. **图片重导入 mediaPutBase64 失败**:atoms-to-pm 内 image base64 转换,如果 Platform 返回 dataURL 巨大可能超 IPC 阈值;实际可能需要"先返回 unknown 占位,再异步 upload"流程(留观察)。

### 4.2 ebook 段全部完成(C1~C6)

至此 V1 → V2 ebook 迁移完整闭环:
- C1 书架 + 文件夹 + 标注存储基建
- C2 PDF 渲染(pdfjs-dist)
- C3 EPUB 渲染 + 大纲 + 搜索(foliate-js)
- C4 书签 + EPUB 文本标注
- C5 PDF 空间标注(▢/▁)
- C6 PDF 提取 → Note(本段)

ebook 模块进入维护态。后续若需扩展(如 PDF OCR 反向写回 / EPUB CFI 标注分组 / 自定义阅读字体),按需起新 stage。

---

## 5. 文件清单(改动总览)

### 新增(11 个文件,~1414 LOC)

```
src/platform/main/extraction/config.ts               (19)
src/platform/main/extraction/upload-service.ts       (168)
src/platform/main/extraction/extraction-handler.ts   (138)
src/platform/main/extraction/handlers.ts             (143)
src/capabilities/text-editing/converters/atoms-to-pm.ts   (482)
src/capabilities/text-editing/converters/sanitize-atoms.ts (157)
src/views/note/extraction-import.ts                  (178)
src/views/note/use-extraction-import.ts              (28)
docs/RefactorV2/stages/L5C6-pdf-extraction-completion.md  (本)
docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md  (前期已有,本段使用)
```

### 改动(~28 LOC)

```
src/shared/ipc/channel-names.ts                      (+5)
src/shared/ipc/electron-api.d.ts                     (+8)
src/platform/main/preload/main-window-preload.ts     (+16)
src/platform/main/index.ts                           (+5)
src/platform/main/ipc/ipc-bus.ts                     (+2)
src/capabilities/text-editing/index.ts               (+4)
src/capabilities/text-editing/types.ts               (+40)
src/views/ebook/EBookToolbar.tsx                     (+16)
src/views/ebook/EBookView.tsx                        (+28)
src/views/note/NoteView.tsx                          (+5)
```

---

## 6. 验收

- [x] `npm run typecheck` 全绿
- [x] `npm run lint` 全绿(0 error / 0 warning)
- [x] 设计文档 v0.3 § 6 D-8 范围完整覆盖(原标 "不在迁移";本段补做)
- [x] V2 三大原则全部符合(分层 / 注册 / 抽象)
- [x] 跨 view 调用走命令路由 / capability registry,无 view 间直 import
- [ ] 用户实操功能验证(待用户跑 npm start 走 § 3.1 测试清单)
