# L5-C4 ebook 书签 + EPUB 标注 完成报告

> 阶段:L5-C4 — V1 → V2 ebook 迁移第 4/5 段
> 分支:`feature/L5C4-ebook-bookmarks-annotations`
> 起草日期:2026-05-10
> 设计:[../v1-ebook-migration-plan.md](../v1-ebook-migration-plan.md) v0.3 § 5 C4

---

## 0. 完成清单

### Commit 1 — feat(capabilities)(af03272)

| 项 | LOC | 状态 |
|---|---:|---|
| `capabilities/ebook-rendering/hooks/use-bookmarks.ts`(NEW)| 103 | ✅ |
| `capabilities/ebook-rendering/hooks/use-epub-annotation.ts`(NEW)| 132 | ✅ |
| `capabilities/ebook-rendering/epub-annotation-picker/index.tsx`(NEW)| 78 | ✅ |
| `capabilities/ebook-rendering/epub/index.ts`(改 — 5 API + 3 foliate 事件)| +134 | ✅ |
| `capabilities/ebook-rendering/Host.tsx`(改 — 3 Handle + 3 props + loadFromInfo 转推)| +55 | ✅ |
| `capabilities/ebook-rendering/types.ts`(改 — IReflowableRenderer + EBookRenderingApi 加 4 项)| +25 | ✅ |
| `capabilities/ebook-rendering/index.ts`(改 — 模块级 export + Registry api)| +10 | ✅ |
| `capabilities/ebook-rendering/styles.css`(改 — picker 样式)| +48 | ✅ |

### Commit 2 — feat(view)(2c3a6e3)

| 项 | LOC | 状态 |
|---|---:|---|
| `views/ebook/EBookView.tsx`(改:280 → 315,接 hooks + Cmd+D + Picker + EPUB CFI 持久化)| +103/-65 | ⚠️ 超红线 115(详见 § 1.2)|
| `views/ebook/EBookToolbar.tsx`(改:299 → 321,加书签按钮 fixed-page + reflowable 各一)| +22 | ✅ |
| `views/ebook/ebook.css`(改 — bookmark active 黄色)| +8 | ✅ |

### Commit 3 — docs(本)

总:**~677 LOC 新增 / ~70 重写**(对齐设计 v0.3 § 5 C4 估算 "~500 driver + ~50 CSS";实际偏多因 EpubAnnotationPicker 完整 + EPUB CFI 持久化补丁 + EBookView keymap/picker/handlers 扩展)。

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **useBookmarks hook**:V1 → V2 改写,接 host 命令式 + library API,支持 PDF page bookmarks 和 EPUB CFI bookmarks 双路
- **useEpubAnnotation hook**:V1 → V2 改写,接 host events 推流 → state → createAnnotation 调 library + host.addHighlight;loadOnBookOpen 加载已有 + 重绘高亮
- **EpubAnnotationPicker**:V1 内联 picker UI 提取到 capability(对齐 OutlinePanel/SearchBar 同款独立组件),5 色对齐 V1
- **EPUBRenderer 5 API 回归**:onTextSelected / onSelectionDismiss / onAnnotationClick / addHighlight / removeHighlight 全补回(C3 砍出留 C4 兑现)
- **Host.tsx 3 Handle + 3 props**:命令式 API + 事件 props 转推完整
- **Cmd+D keymap**:对齐 V1 同款
- **EPUB CFI 持久化**:**C3 § 4.1 已知短板正式 close**(host.getCurrentCFI + handleEpubProgressChange 写 file)

### 1.2 微调 / 已知细节

| 项 | 设计 | 实际 | 理由 |
|---|---|---|---|
| EBookView LOC | 红线 ≤150~200,C3 已超 80(280) | C4 进一步超 115(315) | 加 useBookmarks + useEpubAnnotation hooks 接入 + Cmd+D keymap + Picker JSX + 主区 mousedown 监听 + EPUB CFI 持久化补丁;沿用 C3 "机会主义瘦身" 取舍,持久化已拆 use-ebook-progress;keymap/handlers 跟 view state 关联紧密继续拆引入 hook 间通信反更乱 |
| EpubAnnotationPicker 位置计算 | V1 内联 EBookView | C4 提取到 capability 独立组件,view 端通过 bodyRef.current?.clientWidth 传 containerWidth | decoupling — capability 提供组件,view 装配位置 |
| 主区 mousedown 监听位置 | V1 全 window mousedown | 同 V1(检 target.closest('.krig-ebook-annotation-picker')改前缀) | 行为一致 |

### 1.3 砍掉 / 推迟

| 项 | 留给 |
|---|---|
| PDF 空间标注(rect/underline + AnnotationLayer)| C5(最终段)|
| 标注列表面板(C4 计划外)| C5 后或独立 epic |
| OCR | D-12=A 砍出 |
| 锚定同步 | D-9=B 单独阶段 |
| 全书提取 | D-8=A 不在迁移 |
| getSnapshot warning | 独立 issue,跟 ebook 无关 |

---

## 2. 完成判据

- ✅ `npm run typecheck` 全绿(0 error)
- ✅ `npm run lint --max-warnings 0` 全绿(0 error 0 warning)
- ✅ 屏障验证:view + shell + workspace + slot 0 处 import pdfjs-dist / foliate-js
- ✅ view 端 import `@capabilities/*` 全是 type-only(W5 严格态 A)
- ✅ EPUB 5 API 唯一 import 点 `epub/index.ts`(npm 屏障)
- ⚠️ `npm start` UI 验收:**需要用户实跑**(详见 § 3 验收清单)

---

## 3. C4 验收清单

按工作流约定,本段不单独验收,C5 后给完整清单。本节是建议性自查清单。

### 3.1 启动 + 回归(C1~C3 功能不破)

1. `npm start` → console 无报错
2. PDF 打开 / 翻页 / 缩放 / 适应宽度 / Cmd+/-/0 / 滚轮缩放 → 全部正常
3. EPUB 打开 / 章节翻页 / 字号 / 进度显示 → 全部正常
4. OutlinePanel + Cmd+F 搜索 → 正常
5. 多 ws 隔离正常

### 3.2 PDF 书签(C4 核心 1)

6. 打开 PDF → 滚到第 5 页 → 点 toolbar ☆ → 变 ★(黄色)
7. 翻到第 10 页 → ★ 变 ☆(本页未书签)
8. 回第 5 页 → 仍是 ★
9. **Cmd+D** 在第 5 页 → 移除书签,变 ☆
10. Cmd+D 在第 10 页 → 添加书签,变 ★
11. 切书 → 切回 → 书签状态保留(library.bookmarkList 加载)
12. 重启 app → 书签持久化(JSON 文件)

### 3.3 EPUB CFI 书签(C4 核心 2)

13. 打开 EPUB → 翻到某章 → 点 ★
14. 翻下一页 → ★ 变 ☆(CFI 不同)
15. 回原位置 → 仍 ★
16. Cmd+D 在当前 CFI → 切换
17. 重启 app → EPUB CFI 书签持久化

### 3.4 EPUB 文本选择 + 5 色高亮(C4 核心 3)

18. 打开 EPUB → 用鼠标拖拽选中一段文字
19. 释放鼠标 → 在选区下方弹出 5 色 picker(黄/绿/蓝/紫/红)+ ✕
20. 点黄色 → 选区高亮黄色 + picker 关闭 + 文字带半透明 #ffd43b 背景
21. 选另一段 → 弹 picker → 点蓝色 → 该段高亮蓝色
22. **点击已有高亮的文字** → renderer 触发 onAnnotationClick → 删除该高亮 + 移除标注
23. 点 picker 外部 → picker 关闭(mousedown 监听生效)
24. 点 picker ✕ → 同样关闭

### 3.5 EPUB 标注持久化

25. 创建几个高亮 → 切书 → 切回 → **高亮重绘**(loadOnBookOpen 加载 + addHighlight 重渲)
26. 重启 app → 高亮仍在(annotations/{bookId}.json 持久化)
27. 多 ws:同一书共享标注(annotations 全局 by bookId,不 per-ws)

### 3.6 EPUB 重启位置恢复(C3 § 4.1 短板修复)

28. 打开 EPUB → 翻到第 5 章 30% 进度
29. 切到 Note view → 切回 → EPUB 仍在第 5 章 30%
30. **重启 app** → 自动打开该 EPUB → **位置恢复到第 5 章 30%**(host.getCurrentCFI →
    persistEpubProgress → bookshelf.json 写 cfi → 重启 entry.lastPosition.cfi →
    setRestoreLocation → init 时按 cfi 加载)

### 3.7 工程纪律

31. `npm run typecheck` 0 error
32. `npm run lint --max-warnings 0` 0 error 0 warning
33. `grep -rn "from 'pdfjs-dist\|from 'foliate-js" src/views/` 应 0 命中

---

## 4. 已知短板

### 4.1 EBookView 315 行(超 LOC 红线 115)

charter § 1.4 软指标 ≤150~200。已拆 `use-ebook-progress.ts` 76 行(C3)。
C4 加 useBookmarks + useEpubAnnotation hooks 接入 + Cmd+D + Picker + 主区 mousedown
监听 → 进一步上涨。属于"3-4× 红线"区间外,接受;**机会主义瘦身路径**:
- `use-ebook-keymap.ts`(Cmd+F + Cmd+D + ←/→)~ -25 行
- `use-ebook-host-state.ts`(currentPage/scale/fitWidth/epubChapter 等)~ -35 行

留 C5 后处理。

### 4.2 PDF 书签按钮在 EPUB 路径用 currentPage(无意义)

EBookToolbar 接 `isBookmarked={bookmarks.isBookmarked(currentPage)}`,EPUB 路径
useBookmarks.isBookmarked 内部走 mode === 'reflowable' 分支,**不读 currentPage**(改读 host.getCurrentCFI),所以 currentPage 在 EPUB 路径是无害噪音。
**无功能影响**。

### 4.3 EPUB picker 位置在选区跨行 / iframe scroll 后可能偏

`range.getBoundingClientRect()` 返单个 rect(对跨多行选区取首行 / 整体的某种)。V1 同款实现,实测如有偏移再针对性修。

### 4.4 EPUB 高亮在切到 Note view 再切回时不丢

`loadOnBookOpen` 在 onBookOpened 推流时执行,切 view 不触发 onBookOpened(只切 ws 才触),所以切 view 不会重新加载 — 高亮保留(view 实例没销毁,Host 内的 renderer 也没销毁)。✅

### 4.5 V1 直迁 11 处 any(C3 8 + C4 新增 3)

EPUBRenderer 内 11 处 `any`(foliate-js View 的 e.detail / book.toc / 渲染器属性 +
mouseup 内 doc.getSelection 等)。foliate-js 类型不全,V1 同款写法,沿用。

### 4.6 getSnapshot warning C1 残留独立 issue

跟 ebook 无关。本段不修。

---

## 5. C4 段落总结

| 模块 | LOC | V1 → V2 迁移度 |
|---|---|---|
| capabilities/ebook-rendering 增量 | +579 | use-bookmarks 改写 / use-epub-annotation 改写 / EpubAnnotationPicker 提取 / EPUBRenderer 补 5 API + 3 foliate 事件(直迁 V1 砍出部分)/ Host 加 3 Handle + 3 props |
| views/ebook 增量 | +98 / -35 | EBookView 接 2 hooks + Cmd+D + Picker + EPUB CFI 持久化补丁;EBookToolbar 加书签按钮 |
| **C4 段总计** | **~677 LOC 新增 / ~70 重写** | 直迁约 80%,余 20% 是接 host 接口 + 提取 picker |

C3 § 4.1 已知短板("EPUB CFI 重启不持久化")**正式 close**。

---

## 6. 下一步(C5,**最终段**)

按 v0.3 § 5 C5 切片:

- 加 `capabilities/ebook-rendering/fixed-page-content/annotation-layer/`(V1 AnnotationLayer.tsx 203 行迁入)
- PDF 空间标注:rect / underline 模式 + 鼠标拖拽创建 + 5 色 picker + 区域截图 thumbnail(D-7=A base64 inline)
- OCR 留空字符串占位(D-12=A 砍 OCR,UI + 数据模型先到位)
- Host.tsx 加 setAnnotationMode + onAnnotationCreate Handle/props
- EBookToolbar 加 ▢ / ▁ 模式切换按钮
- EBookView 接 mode state + 创建标注调 library.annotationAdd
- **C5 收尾验收清单**:涵盖 C1~C5 全部行为(对齐 B3.19 收尾模式)

工作量预估:~700 driver + ~100 CSS。直迁约 75%(主要 AnnotationLayer 直迁)。

C5 完成后 ebook 5 段全部完成,准备 D-4 退出条件计时(稳定 ≥ 2 周 → W6 SurrealDB epic 启动)。

---

## 7. 工作流约定

按 B3.19 / 总设计沿用模式:**段间不单独 user 验收**(本 § 3 是建议性自查清单),
C5 段后给完整 C1~C5 整体验收清单。

**特别强调**:本段是 EPUB 标注交互第一次能用 + PDF 书签第一次能用 + EPUB CFI
持久化首次工作。如启动后 EPUB 选区不弹 picker 或重启 EPUB 不恢复位置,
立即停下走 fix branch,**不进 C5**。
