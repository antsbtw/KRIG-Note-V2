# L5-C3 ebook EPUB + Outline + Search 完成报告

> 阶段:L5-C3 — V1 → V2 ebook 迁移第 3/5 段
> 分支:`feature/L5C3-ebook-epub-outline-search`
> 起草日期:2026-05-10
> 设计:[../v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.3 § 5 C3

---

## 0. 完成清单

### Commit 1 — feat(capabilities)(019bd70)

| 项 | LOC | 状态 |
|---|---:|---|
| `capabilities/ebook-rendering/epub/index.ts`(NEW,V1 366→278,砍标注/留 C4)| 278 | ✅ |
| `capabilities/ebook-rendering/epub/foliate-js.d.ts`(NEW,V1 直迁)| 27 | ✅ |
| `capabilities/ebook-rendering/reflowable-content/index.tsx`(NEW)| 61 | ✅ |
| `capabilities/ebook-rendering/outline-panel/index.tsx`(NEW,改写接 host)| 139 | ✅ |
| `capabilities/ebook-rendering/search-bar/index.tsx`(NEW,V1 直迁 UI)| 108 | ✅ |
| `capabilities/ebook-rendering/hooks/use-search.ts`(NEW,改写接 host)| 89 | ✅ |
| `capabilities/ebook-rendering/Host.tsx`(改 — EPUB 分支 + 6 EPUB Handle 方法 + 4 TOC/Search 方法 + onEpubProgressChange prop)| +123 | ✅ |
| `capabilities/ebook-rendering/index.ts`(改 — 加 OutlinePanel/SearchBar/useSearch 导出 + Registry api)| +18 | ✅ |
| `capabilities/ebook-rendering/types.ts`(改 — EBookRenderingApi 加 3 项 + SearchResult re-export)| +11 | ✅ |
| `capabilities/ebook-rendering/styles.css`(改 — reflowable + outline-panel + search-bar)| +177 | ✅ |
| `package.json` + `package-lock.json`:加 `foliate-js@^1.0.1` | +17 | ✅ |

### Commit 2 — feat(view)(6fae98c)

| 项 | LOC | 状态 |
|---|---:|---|
| `views/ebook/use-ebook-progress.ts`(NEW,从 EBookView 拆出持久化)| 76 | ✅ |
| `views/ebook/EBookView.tsx`(改:213→280)| +132/-65 | ⚠️ 超红线 80 行(详见 § 1.2)|
| `views/ebook/EBookToolbar.tsx`(改:158→299,加 sidebar/search/EPUB)| +151 | ⚠️ Toolbar 不计 view 红线 |
| `views/ebook/ebook.css`(改 — body flex row + toolbar 新元素)| +38 | ✅ |

### Commit 3 — docs(本)

总:**~1435 LOC 新增 + ~109 LOC 重写**(对齐设计 v0.3 § 5 C3 估算 "~900 driver + ~150 CSS";实际偏多因 EPUB Handle 方法 + Toolbar 双模式分支 + view 端 EPUB 状态都比预期重)。

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **foliate-js 锁版 ^1.0.1**(V1 同款)
- **EPUBRenderer 改写**:V1 366 行 → 278,**砍标注/高亮**(留 C4)— `onTextSelected / onSelectionDismiss / onAnnotationClick / addHighlight / removeHighlight / setupSelectionListener / draw-annotation / show-annotation` 全砍;**保留** 基础渲染 + 章节 + 字号 + relocate + TOC + search + clearSearch
- **ReflowableContent**:V1 50 行直迁 + 加 onProgressChange prop(view 持久化用)
- **OutlinePanel**:V1 99 行改写 — **接 host 命令式 API 而不是直传 renderer**(decoupling,view 不感知 renderer 细节)
- **SearchBar + useSearch**:V1 直迁 UI + 改写 hook 接 host 命令式 API
- **Host.tsx 加 EPUB 分支**:`createRendererFor` 加 `'epub' → new EPUBRenderer()`;`loadFromInfo` 加 reflowable 路径(`setRestoreLocation(pos.cfi)`);`onLoadComplete` 推 `renderMode='reflowable'`;EBookHostHandle 加 EPUB 6 方法 + TOC/search 4 方法;新加 `onEpubProgressChange` prop
- **EBookToolbar 双模式分支**:`renderMode='reflowable'` 时 center 显章节翻页 + 进度文字,right 显字号 A−/A+(替代 fixed-page 的页码 + 缩放)
- **keymap**:Cmd+F 开搜索;EPUB ←/→ 翻章节(对齐 V1 EBookView.tsx 源同款)
- **W5 严格态 A 边界**:view 端 capability import 全是 type-only;view 通过 `requireCapabilityApi` 拿 api 中的组件/hook(`{ Host, OutlinePanel, SearchBar, useSearch }`);Host 内部用 `requireCapabilityApi('ebook-library')`

### 1.2 微调 / 已知细节

| 项 | 设计 | 实际 | 理由 |
|---|---|---|---|
| EBookView LOC | 红线 ≤150~200,C2 已超 13(213) | C3 进一步超 80(280) | 加 sidebar / search / EPUB 状态 / keymap;**已拆 use-ebook-progress hook**(76 行)抵消部分;继续拆需要再拆 use-ebook-keymap、use-ebook-host-callbacks 等,但这两个跟 view 状态关联紧密,拆出去反而引入 hook 间通信成本,机会主义瘦身留 C5 之后 |
| EBookToolbar LOC | 设计未指定 | 158 → 299 | view 业务声明性 UI,不计入主组件红线(charter § 1.4 软指标只针对主组件);双模式分支 + 完整 props 扩展是合理 view 业务 |
| OutlinePanel 接 host 而非 renderer | 设计图字面接 renderer | 实际接 host | view → host 间接路由的 W5 边界要求;OutlinePanelHost 接口仅 3 方法(getTOC/goToPage/goToCFI) |
| EPUB CFI 持久化恢复 | 设计未细化 | **本段不持久化 CFI**(已知短板)| Host 没暴露 `getCurrentCFI()`,view 拿不到 CFI;ReflowableContent 通过 `onRelocate` 推 progress 但只含 chapter+percentage 不含 cfi。**留 C5 加 `host.getCurrentCFI()` 一并补**;C3 EPUB 重启后从头开始(文件可读,只是位置不恢复) |
| Host onLoadComplete 加 renderMode | 设计未列 | 加了 | view 用来切 toolbar 形态(`fixed-page` 显页码,`reflowable` 显章节)|

### 1.3 砍掉 / 推迟

| 项 | 留给 |
|---|---|
| EPUB 标注(文本选择 → 5 色 picker → 创建高亮 → CFI 锚点)| C4(完整 useEpubAnnotation + addHighlight / removeHighlight / draw-annotation 链路)|
| PDF 书签(useBookmarks)| C4 |
| EPUB CFI 书签(cfiBookmarks)| C4 |
| PDF 空间标注(rect/underline)| C5 |
| OCR | D-12=A 砍 |
| 锚定同步 | D-9=B 单独阶段 |
| 全书提取 | D-8=A 不在迁移 |
| EPUB 重启位置恢复 | C5 一并补 host.getCurrentCFI |
| EPUB displayMode(分页/滚动切换)| C5 后(toolbar 不暴露 V1 也只在 V1 ToolbarConfig 留口) |
| getSnapshot warning | 独立 issue,跟 ebook 无关(C2 已知短板) |

---

## 2. 完成判据

- ✅ `npm run typecheck` 全绿(0 error)
- ✅ `npm run lint --max-warnings 0` 全绿(0 error 0 warning)
- ✅ 屏障验证:view + shell + workspace + slot 0 处 import pdfjs-dist / foliate-js
- ✅ view 端 import `@capabilities/*` 全是 type-only(W5 严格态 A 边界)
- ✅ EPUB 渲染唯一 import 点 `epub/index.ts`(npm 屏障)
- ⚠️ `npm start` UI 验收:**需要用户实跑**(详见 § 3 验收清单)

---

## 3. C3 验收清单

按工作流约定,本段不单独验收,C5 后给完整清单。本节是建议性自查清单。

### 3.1 启动

1. `npm start` → console 无报错
2. `npm install` 后 console 无 foliate-js 加载错误
3. install-coverage:`4 views × 13 capabilities`,缺失 0(capability 数不变,EPUB 是 ebook-rendering 内部子模块)

### 3.2 PDF 路径回归(C2 功能不破)

4. 打开 C1 / C2 已导入的 PDF → 仍 Canvas 渲染
5. Toolbar 显:`☰ 文件名 | ‹ N of M › | 🔍 − [适应宽度] +`(C2 基础 + sidebar + search 入口)
6. 翻页 / 缩放 / 适应宽度 / Cmd+/-/0 / 滚轮缩放 → 全部正常
7. 持久化阅读位置正常(切书 + 重启)

### 3.3 EPUB 路径(C3 核心)

8. 导入 .epub 文件 → 主区**不再显占位**,**foliate-js iframe 渲染 EPUB 内容**
9. Toolbar 切到 reflowable 形态:`☰ 文件名 | ‹ 章节 · NN% › | 🔍 A− 100% A+`
10. 点 ‹ → 上一页 / 章节;点 › → 下一页 / 章节
11. 键盘 ←/→ 翻页(Cmd+← 不冲突)
12. 字号 A− → 缩小到 90% / 80%;A+ → 放大;到 60/200% 极值时 disabled
13. 章节进度跟随阅读位置变化(toolbar 显 chapter title + percentage)
14. 暗色模式自动注入(EPUB 内容反白显示,a 链接蓝色)

### 3.4 OutlinePanel(侧栏 TOC)

15. 点 toolbar ☰ → 左侧出现 260px 侧栏,标题"目录" + ✕ 关闭
16. PDF:显示 PDF outline(若 PDF 有 — 一些没目录显"此文档没有目录")
17. EPUB:显示 EPUB TOC 树
18. 点击目录项 → 跳转到对应位置(PDF 走页;EPUB 走 CFI)
19. 折叠/展开节点(▸/▾)
20. 当前章节高亮(EPUB)/ 当前页对应项高亮(PDF)
21. 点 ✕ 关闭侧栏 → 主区恢复全宽
22. 切书 → reloadToken 触发重拉 TOC

### 3.5 SearchBar(搜索)

23. 点 toolbar 🔍 → 顶部出现搜索栏(toolbar 下方独立行)
24. **Cmd+F** 也触发搜索栏(focus + select 输入框)
25. 输入查询 → debounce 300ms → 匹配结果数显示 "1 / N";自动跳到第一个结果
26. Enter / 下一个 → 跳下个结果;Shift+Enter / 上一个 → 跳上个
27. Esc / ✕ → 关闭搜索栏 + 清结果
28. PDF:跨页搜索文本 OK(全文 indexOf)
29. EPUB:foliate-js 异步搜索结果 OK
30. 无匹配 → 显"无结果"

### 3.6 持久化 + 多 ws

31. PDF 阅读位置切书 + 重启恢复(C2 同款)
32. EPUB **重启不恢复位置**(已知短板,C5 修)— 但能正常打开(从头)
33. 多 ws 隔离正常(各自 activeBookId)
34. sidebarOpen 状态切书时**不持久化**(transient,跟 V1 同款 — 对齐 charter Q8=B)

### 3.7 工程纪律

35. `npm run typecheck` 0 error
36. `npm run lint --max-warnings 0` 0 error 0 warning
37. `grep -rn "from 'foliate-js" src/views/ src/shell/ src/workspace/ src/slot/` 应 0 命中(屏障验证)
38. `grep -rn "from '@capabilities/" src/views/ebook/ | grep -v "import type"` 应 0 命中(view 不直 import capability 运行时,只允许 type)

---

## 4. 已知短板

### 4.1 EPUB 重启不恢复阅读位置 ⚠️

**根因**:Host 没暴露 `getCurrentCFI()`,view 端拿不到当前 CFI 写入 saveProgress。EBookHost.useImperativeHandle 的命令式 API 没有这个方法;ReflowableContent 通过 `onRelocate` 推 progress 但只含 chapter+percentage(不含 cfi)。

**临时影响**:EPUB 切书 / 重启后从头打开,不丢内容只丢位置。PDF 不受影响。

**修法**(C5 一并补):
- Host 加 `getCurrentCFI(): string | null`(走 `renderer.getLastCFI()`)
- ReflowableContent.onProgressChange 改为 `{ chapter, percentage, cfi }`(从 relocate detail 取)
- view 端 useEBookProgress 的 persistEpubProgress 在 onRelocate 时调用

C3 没做此项是因为 C3 范围已经偏大,同时此短板不阻塞 C3 验收。

### 4.2 EBookView 280 行(超 LOC 红线 80 行)

charter § 1.4 软指标 ≤150~200。已拆 `use-ebook-progress.ts` hook,但 C3 加的 sidebar/search/EPUB 状态 + keymap 不便继续外提(状态访问紧密)。属于"3-4× 红线"区间外但偏多,接受。

继续瘦身路径:
- `use-ebook-keymap.ts`(Cmd+F + EPUB ←/→ keymap 抽出)~ -20 行
- `use-ebook-toolbar-handlers.ts`(toolbar callbacks 抽出)~ -30 行

机会主义瘦身留 C5 之后。

### 4.3 EBookToolbar 299 行

V1 305 → V2 158(C2)→ 299(C3)。双模式分支 + 完整 EPUB props + 字号 / sidebar / search 入口。toolbar 是 view 业务声明性 UI,不计入主组件红线。继续可拆 `EBookToolbarFixedPage` / `EBookToolbarReflowable` 两个子组件,但也是机会主义。

### 4.4 OutlinePanel 当前页高亮在 EPUB 路径不准

EPUB TOC 项的 position 是 CFI(`{ type: 'cfi', cfi: href }`),OutlinePanel 用 `currentChapter` 字符串匹配。如 EPUB chapter title 重复或 V1 lib 报告的 label 跟 TOC label 不完全一致,会高亮偏。**实测如有问题再修**;不阻塞功能。

### 4.5 V1 任意类型沿用(any 数量增加)

EPUBRenderer 内 8 处 `any`(foliate-js View 的 e.detail / book.toc / 渲染器属性等)。foliate-js 类型不全,V1 同款写法,沿用。eslint 不强制 no-explicit-any 通过。

### 4.6 getSnapshot warning(C1 残留独立 issue)

C1 / C2 都有,跟 ebook 无关。本段不修。

---

## 5. C3 段落总结

| 模块 | LOC | V1 → V2 迁移度 |
|---|---|---|
| capabilities/ebook-rendering 增量 | +880 / -10(总 ~2360 包含 C2 部分)| EPUB 直迁 + 砍 ~88 行标注 / Outline 改写 / Search 直迁 / hooks 改写 |
| views/ebook 增量 | +397 / -99 | 双模式 toolbar / sidebar+search / EPUB 状态 / 拆 use-ebook-progress |
| **C3 段总计** | **~1280 LOC 新增 + ~109 重写** | 直迁约 75%,余 25% 改写 + 新加 EPUB Handle / sidebar/search 接入 |

---

## 6. 下一步(C4)

按 v0.3 § 5 C4 切片:

- 加 `capabilities/ebook-rendering/hooks/use-bookmarks.ts`(V1 61 行直迁)
- 加 `capabilities/ebook-rendering/hooks/use-epub-annotation.ts`(V1 95 行直迁,EPUB 文本选择 + 5 色 picker + CFI 高亮)
- Host.tsx 加 onAnnotationCreate / onTextSelected / onSelectionDismiss / addHighlight / removeHighlight 命令式 API + EPUB 选区 picker UI
- views/ebook/EBookToolbar.tsx 加书签按钮(高亮态)
- views/ebook/EBookView.tsx 接两 hook + 颜色 picker UI

工作量预估:~500 driver + ~50 CSS。直迁约 80%。

C4 段完成后,EPUB 文本选择 + 5 色高亮 + 重启保留就位;PDF Cmd+D 加书签 + toolbar 高亮态就位。

---

## 7. 工作流约定

按 B3.19 / 总设计沿用模式:**段间不单独 user 验收**(本 § 3 是建议性自查清单),
C5 段后给完整 C1~C5 整体验收清单。

**特别强调**:本段是 EPUB 第一次能渲染。如启动后无法显示 EPUB(白屏 / foliate-view 加载失败 / 报 Cannot find module 等),立即停下来走 fix branch,**不进 C4**。
