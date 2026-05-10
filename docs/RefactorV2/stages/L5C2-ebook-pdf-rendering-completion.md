# L5-C2 ebook-rendering capability + EBookView 接 Host(PDF) 完成报告

> 阶段:L5-C2 — V1 → V2 ebook 迁移第 2/5 段
> 分支:`feature/L5C2-ebook-pdf-rendering`
> 起草日期:2026-05-09
> 设计:[../v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.3 § 5 C2

---

## 0. 完成清单

### Commit 1 — feat(capabilities):ebook-rendering capability(55df7bf)

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/capabilities/ebook-rendering/types.ts`(NEW)— V1 215→204,加 EBookRenderingApi | 204 行 | ✅ |
| `src/capabilities/ebook-rendering/pdf/index.ts`(NEW,V1 直迁)| 335 行 | ✅ |
| `src/capabilities/ebook-rendering/fixed-page-content/index.tsx`(NEW,V1 改写,砍 AnnotationLayer)| 312 行 | ✅ |
| `src/capabilities/ebook-rendering/Host.tsx`(NEW,forwardRef)| 338 行 | ✅ |
| `src/capabilities/ebook-rendering/index.ts`(NEW,Registry 注册)| 66 行 | ✅ |
| `src/capabilities/ebook-rendering/styles.css`(NEW,从 V1 拆出)| 116 行 | ✅ |
| `src/capabilities/ebook-rendering/DESIGN.md`(NEW)| 111 行 | ✅ |
| `package.json` + `package-lock.json`:加 `pdfjs-dist@^4.9.155` | 264 行(lock)| ✅ |

### Commit 2 — feat(view):EBookView 接 Host + EBookToolbar(3d1848a)

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/views/ebook/EBookToolbar.tsx`(NEW,V1 305→158 简版)| 158 行 | ✅ |
| `src/views/ebook/EBookView.tsx`(改:81 → 213,接 Host + Toolbar)| +132 / -54 | ⚠️ 略超 LOC 红线(详见 § 1.2)|
| `src/views/ebook/index.ts`(改:install 加 `'ebook-rendering'`)| +3 / -3 | ✅ |
| `src/views/ebook/ebook.css`(改:加 Toolbar + body 布局)| +97 / -16 | ✅ |
| `src/platform/renderer/index.tsx`(改:加 `import '@capabilities/ebook-rendering'`)| +1 | ✅ |

### Commit 3 — docs(L5-C2):completion + state-snapshot 入表(本)

总:**~2207 行新增 + ~57 行重写**(对齐设计 v0.3 § 5 C2 估算 "~1200 driver + ~300 CSS";实际偏多因 Host.tsx 完整命令式 API 比预想 + EBookView 接入逻辑充分含 debounce + per-ws state 同步)。

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **pdfjs-dist 锁版 ^4.9.155**(EBookView 设计 v2 § 5 #10:5.x 与 Electron 40 不兼容)
- **PDFRenderer 直迁** V1 实现(虚拟 / 渲染队列去重 / Canvas DPR / Text Layer / outline / search)
- **fixed-page-content 砍 AnnotationLayer + viewAPI 调用**(C5 真做)
- **Host forwardRef + 命令式 API**(对齐 web-rendering Host 模板)
- **订阅模式**:view 订阅 onBookOpened,Host 不订阅 — 防重复加载(详见 DESIGN.md § "订阅模式约定")
- **W5 严格态 A 边界**:view 走 `requireCapabilityApi('ebook-rendering')` 间接路由;Host 内部调 `requireCapabilityApi('ebook-library')` 拿 library
- **NoteToolbar 简版**:V1 305 行 → V2 158 行,砍 sidebar / annotation / bookmark / extract / SlotToggle / OpenFilePopup / 锚定锁 / reflowable

### 1.2 微调 / 已知细节

| 项 | 设计 | 实际 | 理由 |
|---|---|---|---|
| EBookView LOC | 红线 ≤150~200 | **213 行(超 13 行)** | 含完整 toolbar/host callbacks + 持久化 debounce + per-ws state 同步 + 双 capability route 拿 + early return 空状态。后续若觉得满,可拆 `use-ebook-progress.ts` hook 进一步瘦身,**机会主义瘦身留 C5 后**。属于 charter § 1.4 软指标超过红线但脱离 3-4× 区间(对齐 closure § 5.4 NoteView 111 / WebView 192)。|
| Host.tsx LOC | 设计未指定 | 338 行 | capability 内部组件,无 LOC 红线;封装完整生命周期是合理 |
| 适应宽度 toolbar 行为 | toggle 切换 | 通过 select "适应宽度" 选项触发 + 缩放变化时退出 fitWidth | 跟 V1 一致 |
| Host EBookHostHandle | 单一 loadFromInfo | + 6 个命令式方法(goToPage / setScale / setFitWidth / goToCFI / getRenderMode / getTotalPages)| view 命令式驱动需要;goToCFI 留 C3 EPUB 用 |

### 1.3 砍掉 / 推迟

| 项 | 留给 |
|---|---|
| Outline panel(TOC 树)| C3(在 ebook-rendering capability 内追加 outline-panel/)|
| Cmd+F 搜索栏(SearchBar)| C3 |
| 书签 hooks(useBookmarks)| C4 |
| EPUB 文本选择高亮(useEpubAnnotation)| C4 |
| PDF 空间标注(rect/underline + AnnotationLayer)| C5 |
| OCR | D-12=A 砍出,留独立 epic |
| EPUB 渲染(foliate-js)| C3 |
| 锚定同步(anchor-sync)| D-9=B 单独阶段 |
| 提取按钮(handleExtract)| D-8=A 不在本迁移 |

---

## 2. 完成判据

- ✅ `npm run typecheck` 全绿(0 error)
- ✅ `npm run lint --max-warnings 0` 全绿(0 error 0 warning)
- ✅ 屏障验证:view + shell + workspace + slot 0 处 import pdfjs-dist / foliate-js
- ✅ view 端 import `@capabilities/*` 全是 `import type` only(W5 严格态 A 边界)
- ✅ Host.tsx 内通过 `requireCapabilityApi('ebook-library')` 间接路由(capability 间不互相直 import 运行时值)
- ⚠️ `npm start` UI 验收:**需要用户实跑**(详见 § 3 验收清单)

---

## 3. C2 验收清单

按 v0.3 § 5 C2 工作流约定,本段不单独验收,C5 后给完整清单。本节是建议性自查清单。

### 3.1 启动 + 视图切换

1. `npm start` → console 无报错
2. NavSide ViewSwitcher 仍 4 个 tab(Note / **eBook** / Web / 翻译预览)
3. console install-coverage:`4 views × 13 capabilities`,缺失 0
4. capabilityRegistry.count = 13(原 12 + ebook-rendering)

### 3.2 打开 PDF(C2 核心)

5. 切 ebook view,从书架点击 C1 已导入的 PDF
6. **主区不再显占位 "已加载: xxx",而是显示 PDF Canvas 渲染** ✨
7. Toolbar 显:文件名(左)+ ‹ 1 of N › 页码导航(中)+ − [适应宽度] + 缩放(右)
8. 默认状态:适应宽度,首页可见
9. 滚动 → toolbar 页码同步变化(取占可视区域最多的页面作 currentPage)

### 3.3 导航

10. 点 Toolbar `›` → 下一页 + 滚动到该页
11. 点 ‹ → 上一页
12. 点页码 input → 显示当前页 + 全选 → 改成 42 → Enter / blur → 跳到 42
13. 输入超出范围(0 / 999999) → blur 时不跳,保留显示当前页
14. 在 PDF 内容区滚动 → toolbar 不跟随更新?(预期:跟随)

### 3.4 缩放

15. 默认 select 显"适应宽度"
16. 点 select 选 "100%" → fitWidth=false,scale=1.0,canvas 重渲染
17. 点 + → scale +0.25(到 1.25 / 1.5 / ...)
18. 点 − → scale -0.25
19. 切回 "适应宽度" → 重新按 container 宽度计算 scale,fitWidth=true
20. **Cmd+= / Cmd+- / Cmd+0** → 直接缩放(快捷键由 fixed-page-content 接管)
21. **Cmd + 滚轮** → 步进 0.1 缩放(同上)

### 3.5 持久化阅读位置(D-2 + saveProgress)

22. 滚到第 5 页,缩放 1.5
23. 等 500ms(debounce)
24. 切到 Note view,再切回 ebook → 页码应保留 5,缩放 1.5
25. **完全重启 app**(Cmd+Q + 重启)→ 切到 ebook → 自动加载该书 → 页码恢复 5,缩放 1.5
   (对应 V1 ebook 设计 v2 § 9 多 ws 隔离)

### 3.6 Text Layer(文本选择 + Cmd+C)

26. 在 PDF 文字上拖拽选择 → 应高亮(透明 textLayer 在 canvas 上)
27. Cmd+C → 复制选中文本到剪贴板(Electron 默认行为,无需额外代码)
28. 滚动到下一页时,前面页的 textLayer 仍存在(虚拟化范围内)

### 3.7 多 Workspace 隔离

29. ws-1 打开书 A,翻到第 10 页
30. 创建 ws-2 → 切到 ebook → 看到同一书架(全局共享)
31. ws-2 打开书 B → ws-1 切回 → ws-1 仍在书 A 第 10 页(activeBookId per-ws)
32. ws-2 切到 ebook → ws-2 仍在书 B(各自独立)

### 3.8 其他

33. 大 PDF(几百页)滚动流畅(DOM 虚拟化生效)— 检查 console 不卡顿
34. **不应** 出现 `pdfjs-dist not found` 等 import 错误
35. EPUB 导入 → 显占位"EPUB 渲染留 C3 段(foliate-js 接入)"(C3 才接)

### 3.9 工程纪律

36. `npm run typecheck` 0 error
37. `npm run lint --max-warnings 0` 0 error 0 warning
38. `grep -rn "from 'pdfjs-dist" src/views/ src/shell/ src/workspace/ src/slot/` 应 0 命中
39. `grep -rn "from '@capabilities/[^/]*'$" src/views/ebook/` 应 0 命中(view 不直 import capability 运行时,只允许 `/types`)

---

## 4. 已知短板

### 4.1 console getSnapshot warning(C1 残留,未修)

C1 实测有 `The result of getSnapshot should be cached to avoid an infinite loop` 警告,1 次,不影响功能。

**根因**:不在 ebook view 代码内,跟 V2 既有 `useSyncExternalStore` 预存 bug 一致(audit closure § 6.4 条目 + memory `feedback_use_sync_external_store_stable_ref`)。

**决策**:本段不修;留独立 issue 跟进。如 C5 段还存在,集中一次清理。

### 4.2 EPUB 不可用

C2 仅 PDF。导入 EPUB 后 Host 显占位"EPUB 渲染留 C3 段(foliate-js 接入)"。**预期行为**,不是 bug。C3 阶段实施。

### 4.3 重启自动恢复阅读位置 — 仍依赖 view useEffect 主动 open

C2 修复了 C1 § 4.2 的"重启不触发 onBookOpened"短板:view 的 `useEffect (activeBookId)` 在切到 ebook view 时检测到 activeBookId 后主动调 `library.open(activeBookId)`,触发 main 推 EBOOK_LOADED → view 端 onBookOpened → loadFromInfo。

但**有一个边界**:当书的源文件丢失(link 模式,Finder 删了)时,library.open 返回 `{success:false, error:'File not found'}`,view 端 catch 但不 toast(toast 只在 NavSide 点击时触发)。建议:补一个"切到 ebook view 后失败时的全局 toast"——**留 C5 验收前修**。

### 4.4 EBookView 213 行 略超 LOC 红线

charter 软指标 ≤150~200 行,本组件 213 行(超 13)。脱离了"3-4× 红线"区间,可接受。后续可拆 `use-ebook-progress.ts` hook 持久化 debounce 部分,机会主义瘦身。

### 4.5 fitWidth 状态由 view 单独维护(跟 Host 内 fitWidth ref 不完全同步)

view 维护 fitWidth state 给 toolbar 显示;Host 内部维护 fitWidthRef 给 resize 监听。两者通过 `setFitWidth` 命令同步,但若 Host 内某些路径自己改 fitWidthRef 而不通过 setFitWidth,view 端会失步。**当前路径**:Host setScale 内部主动 setFitWidth=false ✅;Host onResize 不 setFitWidth(只重算 scale)✅。**实测**如有问题再加 `onFitWidthChange` 推送回调。

### 4.6 Host.tsx 内 4 个 `any` 类型(从 V1 直迁)

V1 PDFRenderer 用 `any[]` / `any` 处理 pdfjs-dist outline / item 类型(pdfjs-dist 类型定义不完整)。V2 沿用,eslint 不强制 no-explicit-any 通过。

### 4.7 toolbar 不显示 PDF outline

V1 toolbar 有 sidebar toggle 显 OutlinePanel;C2 砍出留 C3。

---

## 5. C2 段落总结

| 模块 | LOC | V1 → V2 迁移度 |
|---|---|---|
| capabilities/ebook-rendering | 1482 行(driver + CSS + DESIGN) | V1 ~983(types+pdf+FixedPageContent+CSS 分量)→ V2 同等量级,+ Host 完整命令式 API |
| views/ebook 增量 | +540 / -57 | EBookView 81→213(接 Host + Toolbar);新建 EBookToolbar 158 |
| **C2 段总计** | **~2207 LOC 新增** | 直迁约 70%,余 30% 是 Host + 接入 + 简化 |

---

## 6. 下一步(C3)

按 v0.3 § 5 C3 切片:

- 加 `capabilities/ebook-rendering/epub/`(foliate-js 封装,V1 直迁 365 行)
- 加 `capabilities/ebook-rendering/reflowable-content/`(iframe 注入 + onResize + onRelocate)
- 加 `capabilities/ebook-rendering/outline-panel/`(TOC 树侧栏)
- 加 `capabilities/ebook-rendering/search-bar/`(Cmd+F UI)+ hooks/use-search
- 加 `views/ebook/EBookToolbar.tsx` sidebar toggle + 章节导航(EPUB)+ 字号控件(EPUB)

工作量预估:~900 driver + ~150 CSS,直迁约 85%。

C3 段完成后,EPUB 也可读了 + Outline + Cmd+F 搜索就位。

---

## 7. 工作流约定

按 B3.19 / 总设计沿用模式:**段间不单独 user 验收**(本 § 3 是建议性自查清单),
C5 段后给完整 C1~C5 整体验收清单。

**特别强调**:本段是 ebook view 第一次能渲染真内容,如启动后无法显示 PDF
(白屏 / 报错 / pdfjs-dist worker 加载失败等),**应立即停下来**走 fix branch,
不进 C3。
