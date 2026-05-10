# L5-C5 ebook PDF 空间标注 + C1~C5 整体收尾 完成报告

> 阶段:L5-C5 — V1 → V2 ebook 迁移第 5/5 段(**最终段**)
> 分支:`feature/L5C5-ebook-pdf-spatial-annotations`
> 起草日期:2026-05-10
> 设计:[../v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.3 § 5 C5

---

## 0. 完成清单

### Commit 1 — feat(capabilities)(c4b60a4)

| 项 | LOC | 状态 |
|---|---:|---|
| `capabilities/ebook-rendering/fixed-page-content/annotation-layer.tsx`(NEW,V1 直迁)| 252 | ✅ |
| `capabilities/ebook-rendering/fixed-page-content/index.tsx`(改 — 挂 layer + 4 props 透传)| +20 | ✅ |
| `capabilities/ebook-rendering/Host.tsx`(改 — 4 PDF annotation props 透传)| +24 | ✅ |
| `capabilities/ebook-rendering/types.ts`(改 — re-export PageAnnotation + AnnotationDraft)| +5 | ✅ |
| `capabilities/ebook-rendering/index.ts`(改 — re-export)| +1 | ✅ |
| `capabilities/ebook-rendering/styles.css`(改 — annotation layer + picker 样式)| +76 | ✅ |

### Commit 2 — feat(view)(426c891)

| 项 | LOC | 状态 |
|---|---:|---|
| `views/ebook/use-pdf-annotations.ts`(NEW,view 端协调 hook)| 89 | ✅ |
| `views/ebook/EBookView.tsx`(改:315 → 325,接 hook + 4 props 传 Host)| +9/-0 | ⚠️ 超红线 125(详见 § 1.2)|
| `views/ebook/EBookToolbar.tsx`(改:321 → 348,加 ▢/▁ 模式按钮)| +27 | ✅ |

### Commit 3 — docs(本)

总:**~512 LOC 新增 / ~3 重写**(对齐设计 v0.3 § 5 C5 估算 "~700 driver + ~100 CSS";实际偏低因 OCR 砍出 + 缩略图截图砍出 + view 端 hook 拆得克制)。

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **AnnotationLayer V1 直迁**:鼠标拖拽 rect / underline + 5 色 picker + 已有标注右键删除 + 最小尺寸防误触 + 坐标系 scale=1
- **5 色对齐 V1**:`#ffd43b/#69db7c/#74c0fc/#b197fc/#ff6b6b`(黄/绿/蓝/紫/红)
- **Host 4 props 透传**:`pdfAnnotationMode / pdfAnnotations / onPdfAnnotationCreate / onPdfAnnotationDelete`(reflowable 路径不消费,EPUB 用文本选择 picker)
- **Toolbar ▢/▁ 模式按钮**:fixed-page 路径专享,reflowable 路径不暴露(EPUB 不需 spatial 模式)
- **同模式再点 = 关闭**(toolbar 内 `mode === current ? 'off' : mode`)
- **PDF 标注持久化**:走 ebook-library.annotationAdd / annotationRemove(C1 已建好的 annotations/{bookId}.json 双路过滤 — pageNum>0 走 PDF 路径)
- **重启加载**:onBookOpened 推流时调 pdfAnn.loadOnBookOpen,Host 拿到 annotations[] 后 layer 内重渲已有标注

### 1.2 微调 / 已知细节

| 项 | 设计 | 实际 | 理由 |
|---|---|---|---|
| EBookView LOC | 红线 ≤150~200,C4 已超 115(315) | C5 进一步超 125(325) | 仅 +9 行(hook 接入 + Host 4 props + Toolbar 2 props),没失控;沿用 C3/C4 "机会主义瘦身" 取舍 — 持久化已拆 use-ebook-progress;PDF 标注拆了 use-pdf-annotations(89 行);view 主组件保留协调权 |
| EBookView 仍超线 | 设计预期 C5 后机会主义瘦身 | 维持现状,**不再追加 hook 拆分** | 继续拆 use-ebook-keymap / use-ebook-host-state 会引入 hook 间通信 + 状态共享成本,得不偿失;ebook 模块整体收尾,留作未来重构候选 |
| AnnotationDraft 类型 | 设计未明确(`Omit<PageAnnotation, 'id'>` 还是 `Omit<..., 'id'\|'pageNum'>`)| 选 `Omit<..., 'id'\|'pageNum'>` | layer 在 onAnnotationCreate(pageNum, draft) 时 pageNum 由 layer 注入,id 由 main 生成,layer 内部不持有 pageNum;统一类型签名 |
| use-pdf-annotations 不和 use-epub-annotation 合并 | 设计未指定 | 拆两个 hook | 数据流不同(host 推流选区 vs layer 拖拽)+ 锚点不同(CFI vs spatial rect)+ 持久化字段不同;合并会增加 if-else 分支 |
| OCR + thumbnail | 设计 D-12=A 砍 OCR + D-7=A thumbnail base64 | 都砍出 | annotation-layer 创建标注时 ocrText 字段不传(undefined),thumbnail 字段不传;StoredAnnotation 数据模型这两字段是 optional,无需空字符串占位 |

### 1.3 砍掉 / 推迟(C5 范围外永久不在 ebook 段做)

| 项 | 处置 |
|---|---|
| OCR(本地 macOS Vision / Windows WinRT / Tesseract.js)| D-12=A 砍出,留独立 OCR epic;annotation 数据模型 `ocrText?` 字段保留供后续填充 |
| 标注区域截图 thumbnail | D-7=A 决策已转方向(原推荐 base64 inline,实施时砍 — 截图需要 OCR 类似平台耦合);留 OCR epic 一并 |
| 标注列表面板(展示所有 annotation 缩略图 + ocrText 预览)| 不在本迁移范围,留 UI 增强 epic |
| 锚定同步(NoteView ↔ EBookView 页码联动) | D-9=B 单独阶段 |
| PDF 全书提取(WebView 'extraction' 变种)| D-8=A 不在本迁移,需 KRIG Knowledge Platform 后端就绪 |
| getSnapshot warning | 独立 issue,跟 ebook 无关(C1 残留) |

---

## 2. 完成判据

- ✅ `npm run typecheck` 全绿(0 error)
- ✅ `npm run lint --max-warnings 0` 全绿(0 error 0 warning)
- ✅ 屏障验证:view + shell + workspace + slot 0 处 import pdfjs-dist / foliate-js
- ✅ view 端 import `@capabilities/*` 全是 type-only(W5 严格态 A)
- ⚠️ `npm start` UI 验收:**需要用户实跑**(详见 § 3 整体验收清单)

---

## 3. C1~C5 整体验收清单 ⭐(收尾)

C5 是 ebook 段最终段,本节涵盖 C1~C5 全部行为,对齐 B3.19 收尾模式。建议用户照单点检。

### 3.1 启动 + ViewSwitcher

1. `npm start` → console 无报错
2. ViewSwitcher 4 个 tab:📝 Note / **📕 eBook**(C1)/ 🌐 Web / 翻译预览
3. install-coverage:`4 views × 13 capabilities`,缺失 0
4. capabilities 13 个(原 11 + ebook-library + ebook-rendering)

### 3.2 NavSide 书架(C1)

5. 切 ebook view → NavSide 显「书架」+「+ 文件夹 / + 导入」
6. 搜索框 placeholder「搜索书库...」(C1 不实施过滤,visual 占位)
7. 点 + 导入 → 文件对话框选 PDF / EPUB → ImportModal 弹(默认"拷贝到 KRIG 管理")
8. 选模式 → 导入 → 书架出现条目;**主区直接显示真内容**(PDF Canvas / EPUB foliate-view)

### 3.3 文件夹 + 拖拽 + 右键(C1)

9. 点 + 文件夹 → 根目录新建文件夹 + 自动 inline rename
10. 拖书条目到文件夹 → 落入文件夹下(自动展开)
11. 右键空白 / 文件夹 / 书项 → 显对应菜单(8 项右键)
12. 双击文件夹 / 书项 → 打开
13. 重启 app → 书架持久化(bookshelf.json + library/{uuid}.{ext})

### 3.4 PDF 渲染(C2)

14. 打开 PDF → Canvas 渲染 + Toolbar 显:文件名 + ‹ N of M › + ▢ ▁ ★ 🔍 − [适应宽度] +
15. 翻页 / 页码输入跳转 / 上下页按钮 → OK
16. 缩放 select(50/75/100/125/150/200% + 适应宽度)+ Cmd+/-/0 + 滚轮缩放 → OK
17. 滚动 → toolbar 页码同步(取占可视区域最多的页面)
18. Text Layer:鼠标拖选文字 + Cmd+C 复制 → OK
19. **大 PDF(几百页)滚动流畅**(DOM 虚拟化生效)

### 3.5 EPUB 渲染(C3)+ Toolbar 双模式

20. 打开 EPUB → foliate-js 渲染 + Toolbar 切到 reflowable 形态
21. Toolbar 显:☰ 文件名 + ‹ 章节·NN% › + ★ 🔍 A− 100% A+(无 ▢ ▁,EPUB 不暴露)
22. 章节翻页 ‹ / › → OK
23. 字号 A− / A+ → 60~200% 范围,极值 disabled
24. **Cmd+F 搜索**(PDF + EPUB 通用):弹搜索栏 + 输入 → debounce 300ms → 高亮结果 + 跳转
25. **Cmd+D 切书签**(PDF page / EPUB CFI 双路)→ Toolbar ★ ↔ ☆ 黄色高亮态
26. **EPUB ←/→ 翻章节**(键盘)
27. **EPUB trackpad 双指水平 swipe**(C4 fix)→ 一次手势 = 翻一页(macOS Books 同款)

### 3.6 OutlinePanel(C3)

28. 点 ☰ → 左侧 260px 侧栏显 PDF outline / EPUB TOC
29. 点目录项 → 跳转(PDF goToPage / EPUB goToCFI)
30. 折叠/展开节点(▸/▾)
31. 当前章节高亮(EPUB)/ 当前页对应项高亮(PDF)
32. 点 ✕ 关闭

### 3.7 EPUB 文本选择 5 色高亮(C4)

33. EPUB 内拖选文字 → 弹 5 色 picker(下方,#ffd43b/#69db7c/#74c0fc/#b197fc/#ff6b6b)
34. 选色 → 文字高亮 + picker 关闭 + 标注持久化
35. 点击已有高亮 → renderer onAnnotationClick → 删除该标注 + 移除高亮
36. 点 picker 外部 / ✕ → 关闭(全屏 mousedown 监听)
37. 重启 → 高亮重绘(loadOnBookOpen 加载 + addHighlight 重渲)

### 3.8 EPUB 重启位置恢复(C4 fix close C3 短板)

38. EPUB 翻到第 5 章 30% → 切 view + 切回 → 仍在第 5 章 30%
39. **重启 app** → EPUB 自动恢复到第 5 章 30%(host.getCurrentCFI → bookshelf.json
    lastPosition.cfi → setRestoreLocation → init 按 cfi 加载)

### 3.9 PDF 空间标注(C5)⭐ 本段核心

40. PDF Toolbar 点 ▢ → 模式高亮 + 鼠标变十字
41. PDF 内拖拽画矩形 → 松手弹 5 色 picker(在矩形下方)
42. 选色 → 矩形半透明背景(20% 不透明)+ 边框 → 标注持久化
43. 点 ▢ 再次 → 关闭模式(rect → off)
44. ▁ 横线模式同款:拖拽画线 → 5 色 picker → 横线纯色填充(高度 3px,scale=1)
45. **右键已有标注** → 删除
46. 标注随 scale 缩放(放大 / 缩小 PDF,标注位置同步)
47. **重启** → PDF 标注重绘(loadOnBookOpen 拉 → 传 layer)
48. 切书 / 切 ws → 标注全局共享(annotations/{bookId}.json,不 per-ws)

### 3.10 多 ws 隔离(C1)

49. 创建 ws-2 → 切到 ebook → 同一书架(全局共享)
50. ws-2 打开另一书 → ws-1 切回 → ws-1 仍在原书原位置(activeBookId per-ws)

### 3.11 工程纪律

51. `npm run typecheck` 0 error
52. `npm run lint --max-warnings 0` 0 error 0 warning
53. `grep -rn "from 'pdfjs-dist\|from 'foliate-js" src/views/ src/shell/ src/workspace/ src/slot/` 应 0 命中
54. 启动 console install-coverage:`4 views × 13 capabilities` ✅

---

## 4. 已知短板(C1~C5 累计)

| # | 项 | 阶段 | 处置 |
|---|---|---|---|
| 1 | console getSnapshot warning(`useSyncExternalStore` 引用稳定性) | C1 残留 | V2 既有预存 bug,跟 ebook 无关;留独立 issue,如 ebook 段实测体验有问题再修 |
| 2 | EBookView 325 行(超 LOC 红线 125)| C2~C5 累积 | charter 软指标;已拆 use-ebook-progress + use-pdf-annotations;继续拆 use-ebook-keymap 等 ROI 低,留作未来重构候选 |
| 3 | EBookToolbar 348 行 | C3~C5 累积 | view 业务声明性 UI,charter 不计主组件红线;按 fixed-page / reflowable 双模式分支拆需要等 V1 整体节奏稳定 |
| 4 | V1 直迁 11+ 处 `any`(foliate-js + pdfjs-dist 类型不全) | C2~C4 累积 | V1 同款写法,sdk 类型定义不完整,沿用 |
| 5 | EPUB picker 跨行选区位置可能偏 | C4 | V1 同款实现,实测无问题留;有问题再调 range bbox |
| 6 | PDF 空间标注无 OCR + thumbnail | C5 | D-12=A / D-7=A 决策砍出,留独立 OCR epic;annotation 数据模型字段保留供后续填 |
| 7 | DjVu / CBZ 不渲染 | 全段 | 设计 v2 § 6 列为 P2,V1 也未实现,Host 显占位"留作未来"(infra 已就位 — IFixedPageRenderer 接口可直接扩) |
| 8 | 锚定同步(NoteView ↔ EBookView 页码联动) | 全段 | D-9=B 决策单独阶段做 |
| 9 | PDF 全书提取(WebView 'extraction' 变种) | 全段 | D-8=A 不在迁移,等 KRIG Knowledge Platform 后端就绪独立 epic |

---

## 5. C1~C5 段落总结(ebook 模块整体收尾)

| 段 | 主题 | 增量 LOC(driver + CSS)| Merge commit |
|---|---|---|---|
| C1 | 平台基座 + library + view 骨架 | ~2747 | ca45ce4 |
| C2 | PDF 渲染就绪(pdfjs-dist + Host + 虚拟滚动) | ~2207 | 7613211 |
| C3 | EPUB + Outline + Search(foliate-js) | ~1435 | 12361e7 |
| C4 | 书签 + EPUB 标注 + EPUB CFI 持久化(+ CSP fix + swipe 翻页 fix) | ~677 + 91 fix | 85a93cf |
| C5 | PDF 空间标注 AnnotationLayer | ~512 | (待 merge) |
| **合计** | | **~7669 LOC** | |

**V1 → V2 完整对照**:
- V1 ebook 模块:5300 行(plugins/ebook 4300 + main/ebook 955)
- V2 ebook 模块:~7669 行(分散到 capability/view/platform 三层 + 完整命令式 API + 双导出 W5 严格态 + 6 个 hook + 3 个内嵌组件 + 完整 fix)
- V2 多出的 ~2369 行主要是:Host.tsx 命令式 API 完整化、capability index/types/styles 多重导出、6 个 view 端协调 hook、独立组件提取(OutlinePanel/SearchBar/EpubAnnotationPicker/AnnotationLayer 不再内联在 view)、CSP fix + swipe fix、completion + DESIGN 文档

**架构合规**:
- 0 处 view import 业务 npm(pdfjs-dist + foliate-js 全在 capability 内部)
- 0 处 view 运行时直 import capability(全走 `requireCapabilityApi`)
- W5 严格态 A 边界全程合规
- 持久化全走 ebook-library capability(view 不直触 storage)

---

## 6. 下一步(ebook 段后续)

按 v0.3 D-4 退出条件:**C5 验收 + 稳定 ≥ 2 周**(2026-05-24 起)+ **W6 SurrealDB 客户端 epic 落地** → 启动整体迁移:
- JSON store → SurrealDB
- `platform/main/ebook/` → `src/storage/ebook/`
- 候选阶段编号 W6(charter v0.5+ 修订时分配)

中间期(2 周窗口)处理:
- 用户使用反馈 / 实测 bug 修复
- v0.3 § 9 决策清单全部已落地
- 可选地把 OCR / 标注列表面板 / DjVu/CBZ / 全书提取 单独立项

非 ebook 后续:
- L5-D 阶段候选(per v2-state-snapshot § 3.1):graph view / thought view / ai-note-bridge / web-bridge
- L5-B3.x 余下 block(per v1-block-migration-checklist):page-anchor / file-link / column-list 等

---

## 7. 工作流约定

ebook 段**整体收尾**。C5 merge 到 main 后:
- 用户按 § 3 整体验收清单点检 C1~C5 全部行为
- 验收通过 → ebook 段宣告完成,启 D-4 过渡态计时(稳定 ≥ 2 周)
- 严重 bug → fix branch 修补;架构问题 → 回退后修订 v0.4 文档

未通过项可在 fix branch 单独修(对齐 C4 CSP fix + swipe fix 模式),不需要回退已 merge 段。

---

## 8. ebook 段交付亮点

- ✅ **5 段切片完整执行,12 决策点全 A 默认**(D-3 v0.3 修订 B JSON 起步)
- ✅ **0 业务 npm 屏障违反**(pdfjs-dist + foliate-js 唯一 import 点 capability 内部)
- ✅ **W5 严格态 A 全程合规**(view 全部 type-only import + requireCapabilityApi 间接路由)
- ✅ **6 个 view 端协调 hook**(use-ebook-progress / use-search / use-bookmarks / use-epub-annotation / use-pdf-annotations + Host useImperativeHandle 命令式 API)
- ✅ **3 个独立 capability 组件**(OutlinePanel / SearchBar / EpubAnnotationPicker / AnnotationLayer)— 取代 V1 内联在 EBookView 的形态
- ✅ **2 次实测 fix 闭环**(C4 CSP frame-src blob: + swipe 翻页 — 工作流"段间 fix branch"模式跑通)
- ✅ **C3 § 4.1 短板正式 close**(EPUB CFI 重启位置恢复)
- ✅ **D-4 过渡态钉死**(C5 验收 + 稳定 ≥ 2 周 + W6 SurrealDB 客户端 epic 后整体迁 storage)
