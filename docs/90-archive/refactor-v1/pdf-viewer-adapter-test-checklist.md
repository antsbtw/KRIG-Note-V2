# PDF Viewer Adapter — 验收测试清单

> v1.0 · 2026-05-25
> 配套:[pdf-viewer-adapter-plan.md](pdf-viewer-adapter-plan.md)
> 分支:`feature/pdf-viewer-adapter`(Stage 1-5 完成,合 main 前最终验收)

---

## 0. 准备

1. **从 main 切回最新**:
   ```bash
   cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
   git checkout feature/pdf-viewer-adapter
   git log --oneline | head -5  # 确认在最新 commit
   ```

2. **启动 app**:`npm start`

3. **DevTools 打开**(Cmd+Opt+I)

4. **准备测试文件**:
   - 一本英文 PDF(如 Thomas' Calculus,~1200 页大体积)
   - 一本中文或日文 PDF(测 cMap)
   - 一本小 PDF(~10 页)
   - 推荐已有书架中存在的 PDF

5. **flag 清理**:`localStorage.removeItem('krig.pdfViewerV2')`(Stage 4 已删 flag,无害但建议清)+ reload

---

## 1. 加载 / 渲染基础

| # | 操作 | 期望结果 | 备注 |
|---|------|---------|------|
| 1.1 | 从书架打开任意 PDF | 页面正常加载并渲染,左侧首页可见 | |
| 1.2 | Console 是否有 `Setting up fake worker` 警告? | **无**(workerPort 4.x 配置生效) | Stage 1 验收点 |
| 1.3 | Console 是否有其他 PDF 相关 error? | 无 | |
| 1.4 | 打开 1000+ 页大 PDF | 加载完成 ≤ 5s,无卡死,翻页流畅 | |
| 1.5 | 打开中文 / 日文 PDF | 字符正常显示,无方块 / 乱码 | cMap 验证(Stage 1) |
| 1.6 | 切换书架不同 PDF | 旧 PDF 销毁,新 PDF 加载,无内存泄漏(Activity Monitor 看进程占用) | |

---

## 2. 滚动 / 翻页

| # | 操作 | 期望结果 |
|---|------|---------|
| 2.1 | 鼠标滚轮上下滚动 | 平滑滚动,页面接续 |
| 2.2 | trackpad 双指上下滑动 | 平滑滚动(自然惯性) |
| 2.3 | 工具栏 ← / → 按钮 | 跳到上一页 / 下一页 |
| 2.4 | 工具栏页号输入 + 回车 | 跳到指定页 |
| 2.5 | 跳到最后一页 | 正常显示,无白屏 |
| 2.6 | 跳到第一页 | 正常显示 |

---

## 3. 缩放(核心 — 多次踩坑修正)

### 3.1 键盘缩放

| # | 操作 | 期望结果 |
|---|------|---------|
| 3.1.1 | Cmd+= 多次 | 放大,页面居中保持 |
| 3.1.2 | Cmd+- 多次 | 缩小,页面居中保持 |
| 3.1.3 | Cmd+0 | 回到 fit-width |
| 3.1.4 | 缩放到 5x+ | 不挂死(`maxCanvasPixels: 16MP` 保护) |

### 3.2 trackpad pinch(鼠标焦点缩放)

| # | 操作 | 期望结果 |
|---|------|---------|
| 3.2.1 | 鼠标停在 PDF **中间**某文字上,pinch 放大 | **鼠标位置那个文字保持在原位**(焦点缩放) |
| 3.2.2 | 鼠标停在 PDF **右下角**某文字上,pinch 放大 | 该文字保持在右下角附近,page 内容向左上展开 |
| 3.2.3 | 鼠标停在 PDF **左上角**,pinch 放大 | 该位置保持,page 内容向右下展开 |
| 3.2.4 | 连续 pinch 放大不松手 | 平滑跟随手指,不挂死 |
| 3.2.5 | 连续 pinch 缩小不松手 | 平滑跟随手指 |
| 3.2.6 | 放大后再缩小 | 缩小到 fit-width 时 page 自动居中(margin auto + min-width max-content) |

### 3.3 Cmd+滚轮缩放

| # | 操作 | 期望结果 |
|---|------|---------|
| 3.3.1 | Cmd+滚轮向上 | 放大,鼠标位置锚定 |
| 3.3.2 | Cmd+滚轮向下 | 缩小,鼠标位置锚定 |
| 3.3.3 | 快速连续 Cmd+滚轮 | 节流生效,不挂死 |

---

## 4. KRIG 自定义层(Stage 3 接入)

### 4.1 矩形标注(C5)

| # | 操作 | 期望结果 |
|---|------|---------|
| 4.1.1 | 工具栏 ✎ 切 rect 标注模式 | 鼠标变 crosshair |
| 4.1.2 | 在 PDF 页面上拖拽画一个矩形 | 矩形高亮显示,松手后弹 5 色 picker |
| 4.1.3 | 点 picker 任一颜色 | 颜色标注画到 PDF 上,picker 关闭 |
| 4.1.4 | 工具栏 ✎ 关掉标注模式 | 鼠标恢复 default,但已有标注仍可见 |
| 4.1.5 | 翻页后再翻回原页 | 标注仍在(持久化) |
| 4.1.6 | 缩放 PDF | 标注跟随缩放,位置正确(scale-factor 单位对齐验证)|
| 4.1.7 | 标注上右键 | 弹 L4 右键菜单(含删除等项) |

### 4.2 textLayer 选区 picker(文字模式)

| # | 操作 | 期望结果 |
|---|------|---------|
| 4.2.1 | 工具栏 ✎T 切文字选区模式 | 模式激活 |
| 4.2.2 | 在 PDF 文字上拖选 | 松手弹 PdfTextAnnotationPicker(5 色 + H/S markStyle 切换) |
| 4.2.3 | picker 选 highlight 颜色 | 文字流模式标注画到 PDF 上(跨行多 rect) |
| 4.2.4 | picker 选 strikethrough | 中线样式 |
| 4.2.5 | 跨多行选区 | 标注分行画,不连成一大块 |
| 4.2.6 | 选区扩散到第二页 | 不 emit(限单页,picker 不弹) |

### 4.3 vocab-highlight(生词高亮)

> 前提:learning capability 内已添加生词,且 PDF 内含相应单词

| # | 操作 | 期望结果 |
|---|------|---------|
| 4.3.1 | 翻到含生词的页 | 命中词带橘色高亮 |
| 4.3.2 | hover 高亮词 | 弹 tooltip(释义 + 🔊) |
| 4.3.3 | 翻页 → 翻回 | 高亮仍在(每页 textLayer render 后扫描) |
| 4.3.4 | 缩放后 | 高亮位置跟随缩放,与文字对齐 |

### 4.4 outline(侧栏 TOC)

| # | 操作 | 期望结果 |
|---|------|---------|
| 4.4.1 | 工具栏切 outline panel | 侧栏显示 TOC 树 |
| 4.4.2 | 点 TOC 任一项 | PDF 跳到对应章节 |
| 4.4.3 | TOC 树展开 / 折叠子项 | 正常展开折叠 |

### 4.5 PDF 内超链接

| # | 操作 | 期望结果 |
|---|------|---------|
| 4.5.1 | 文中有 internal link 时点击 | PDF 跳到目标页(LinkService 自跳) |
| 4.5.2 | 文中有 external URL 时点击 | 不触发浏览器整页跳转(LinkTarget.NONE 拦住)|

---

## 5. 搜索栏(若启用)

| # | 操作 | 期望结果 |
|---|------|---------|
| 5.1 | 工具栏点搜索 | 搜索栏弹出 |
| 5.2 | 输入关键词 + 回车 | 结果列表 |
| 5.3 | 点结果项 | PDF 跳到对应页 |
| 5.4 | 大 PDF 搜索常用词 | 不挂死(getTextContent 串行,可能慢但不卡)|

---

## 6. 状态持久化

| # | 操作 | 期望结果 |
|---|------|---------|
| 6.1 | 翻到第 N 页 → 关闭书 → 重开 | 恢复到第 N 页 |
| 6.2 | 切换书架不同书 → 切回 | 恢复到该书上次位置 |
| 6.3 | 创建标注 → 关闭 → 重开 | 标注仍在 |
| 6.4 | 关闭整 app → 重启 → 重开书 | 全部状态恢复 |

---

## 7. paged 全屏模式(临时双轨)

> Stage 4 未改 paged 全屏路径,仍走旧 `PDFRenderer.renderPage/renderTextLayer`。
> Phase D 后续切 PDFViewer ScrollMode.PAGE 重写,paged 模式仍是 PR α-3b 状态。

| # | 操作 | 期望结果 |
|---|------|---------|
| 7.1 | scroll 模式下点 ⛶ 进全屏 | 切翻页式 paged 模式,navside collapse |
| 7.2 | paged 内 ← / → 翻页 | 翻页动画(easeOutQuint) |
| 7.3 | paged 单页 / 双页 spread 切换 | 自适应容器宽高比 |
| 7.4 | 按 ESC 退出全屏 | 回 scroll 模式,navside 恢复 |
| 7.5 | paged 期间能看到标注 | 标注跟随显示(共享 PageAnnotation 数据)|

---

## 8. 边界 / 异常

| # | 操作 | 期望结果 |
|---|------|---------|
| 8.1 | 打开损坏 PDF | 错误提示,不挂死 |
| 8.2 | 打开加密 PDF | (Stage 1-5 范围外,可能直接失败,记 followup)|
| 8.3 | 网络断开(本地 file://)| 不影响 PDF 加载(cMap / fonts 走本地)|
| 8.4 | DevTools Network 卡死 | PDF 渲染不受影响(纯 renderer 计算)|
| 8.5 | 多 Workspace 各开一本 PDF | 互不干扰,内存独立 |

---

## 9. 打包验收(Stage 1 Phase D 留洞)

> 上面 8 节都是 `npm start`(dev)验证。`npm run make` 打包后需再跑一次关键项。

| # | 操作 | 期望结果 |
|---|------|---------|
| 9.1 | `npm run make` 生成 dmg | 打包成功,无 worker 资源遗漏 |
| 9.2 | 安装 + 启动打包 app | 启动正常 |
| 9.3 | 打开中日韩 PDF | 字符正常(cMap 路径在 app.asar 内仍可达)|
| 9.4 | DevTools(打包后启用)Console | 无 fake worker 警告 |
| 9.5 | 缩放 / pinch 体验 | 跟 dev 一致 |

---

## 10. 已知遗留 / 限制

- **paged 全屏模式仍走旧 PDFRenderer 路径** — Phase D 重写
- **EPUB 路径不受本次重构影响** — 仍走 foliate-js
- **`maxCanvasPixels = 16MP`** — scale > 5x 时 canvas 自动 CSS 回退缩放,视觉略糊但稳
- **横向 scroll 锚定** — page 比 container 宽时,水平 scroll 跟随 pdfjs 默认(由 `_centerAtPos` 在缩放时计算,用户主动 scroll 后位置保留)

---

## 11. Stage 完成标记(plan §8)

- [x] Stage 1 — commit `819fea5e`
- [x] Stage 2 — commit `a50ae5fb`
- [x] Stage 3 — commit `0ba01a92`
- [x] Stage 4 — commit `3554a7a2`(基础)+ 后续 pinch / 居中 / 鼠标焦点修正多 commit
- [x] Stage 5 — 本文档

## 12. 合 main 前最终检查

- [ ] `npm run typecheck` 全清
- [ ] 上面 1-8 节核心项跑过,无 P0 / P1 失败
- [ ] §9 打包验收(可推迟到一次性 dmg 制作时跑)
- [ ] 跟用户确认 "merge"(显式同意)
- [ ] `git checkout main && git merge feature/pdf-viewer-adapter --no-ff`
- [ ] **不 push origin**(plan §0 决议)
