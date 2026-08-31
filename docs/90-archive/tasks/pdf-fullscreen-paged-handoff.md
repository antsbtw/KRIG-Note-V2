# PDF 全屏翻页式渲染（接入 navSideCollapsed 架构）

## 任务

KRIG-Note V2 的 EBookView 在 PDF + EPUB 共用。当前状态：
- EPUB 全屏：navSideCollapsed=true 时 toolbar 自动隐 + ESC 退 + foliate-js 原生
  animated 翻页动画（main HEAD 已落地）
- PDF 全屏：navSideCollapsed=true 后只是 NavSide 收起，PDF 仍是 scroll 模式

**任务**：PDF 全屏时切到「翻页式渲染 + 滑动动画」（类 Apple Books / Preview）。
- 单页布局：viewport 高度装一页，trackpad 横向 swipe 翻页
- 双页布局：宽屏自动双页 spread
- 翻页有滑动动画（easeOutQuint 1.5s 或类似）

非全屏（navSideCollapsed=false）保持现在的 scroll 模式不变。

---

## 仓库

- **CWD（每个 Bash 必 cd）**：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- 当前 main HEAD: `c2c773fe` (Merge feature/ebook-fullscreen-esc-exit)
- **从 main 切新分支** `feature/pdf-fullscreen-paged`

---

## 历史代码（git 历史已有完整实现，作参考）

早期（2026-05-22 ~ 2026-05-23）走过独立 overlay panel 路线，2 个核心文件全套删除
在 commit `36649806` (refactor: 全屏改 toggleNavSide 后清理旧 panel -2295 行)。
git 历史仍可读取，**做参考但不复活独立 panel**。

### 必读 commit（按推荐顺序）

```bash
# 1. PDF 翻页式渲染骨架（FullscreenPageView 整文件 + Host 改造）
git show 09b089d2:src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx
git show 09b089d2:src/capabilities/ebook-rendering/Host.tsx
git show 09b089d2 --stat

# 2. PDF 翻页动画（spread 滑入/滑出 easeOutQuint 1.5s,FullscreenPageView 重写）
git show 52ecc290:src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx
git show 52ecc290 -- '*FullscreenPageView*'

# 3. animation 参考关键不变量（commit message body）
git log --format=full 52ecc290 -n 1
```

**核心策略**（commit `52ecc290` msg 摘录）：
- 后台渲染新 spread 像素到 canvas（用户看不见，要么 visibility:hidden 要么屏外）
- 像素就位才启动 transition,无 paint 等待
- next: 老 node zIndex 2 顶层滑出 / 新 node zIndex 1 在原位露出
- prev: 新 node zIndex 2 从屏外滑入 / 老 node zIndex 1 留底层
- spread 节点永远 absolute 居中,从不切 position
- 容器内同时最多 2 个子节点（old + new）,静止时只 1 个
- 静态 useEffect 在 animatingRef.current 期间完全 noop,避免双 source of truth

---

## 架构（不要走回头路）

**❌ 不做**：复活独立 EBookFullscreenPanel + L2 overlay。那是 36649806 已被
拍板放弃的方向，原因：跨实例同步（标注/字号/翻页/cfi）漂移成本高。

**✅ 做**：在当前 EBookView/Host/FixedPageContent 内**加 paged 模式分支**：

```
EBookView (PDF)
  └ Host (renderMode=fixed-page)
      ├ FixedPageContent (现状,scroll 模式)
      └ <新增> PagedFixedPageContent (翻页 + 动画)
```

切换条件：`isFullscreen && renderMode === 'fixed-page'` → 走 paged 分支。

具体实施细节有自由度，参考 09b089d2 / 52ecc290 字面代码，但要：
- 不暴露独立 panel
- 不再开 L2 overlay
- 不引入双 PDFRenderer 实例
- 不破坏 scroll 模式（非全屏路径完全不变）
- 不重复全屏退出逻辑（ESC + toolbar 按钮已存在）

---

## 关键文件

| 路径 | 用途 |
|---|---|
| `src/views/ebook/EBookView.tsx` | 主 view，已订阅 isFullscreen，可传给 Host |
| `src/capabilities/ebook-rendering/Host.tsx` | renderer factory + content 分发 |
| `src/capabilities/ebook-rendering/fixed-page-content/index.tsx` | 当前 scroll 模式实现 |
| `src/capabilities/ebook-rendering/pdf/index.ts` | PDFRenderer（pdfjs-dist 包装） |
| `src/capabilities/ebook-rendering/types.ts` | IFixedPageRenderer 接口 |

---

## 用户已对齐的设计

- 单页/双页**自动适配 viewport 宽高比**（不暴露切换按钮，对齐 Preview 哲学）
- 翻页**有动画**（spread 滑入滑出 easeOutQuint，1500ms 左右）
- 输入源：**trackpad 横向 swipe** + **键盘 ←/→**
- ESC 退出全屏沿用现有机制（main 已实现）
- PDF 标注（rect/underline）保留 — 全屏期仍能标注

---

## 用户操作纪律（项目永久规则，必读）

1. **V2 cwd 漂移**：每个 Bash 都 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`；
   Read 工具用绝对路径。V1 是 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`（只读参考）
2. **merge to main 必须用户显式 OK**；"commit" ≠ "commit + merge"
3. **commit 前**：`npx tsc --noEmit` 0 errors + 触及文件 ESLint 0 new warnings
4. **实施完成后给明确测试清单**：操作步骤 + 期望结果
5. **严禁 fallback 绕过未诊断根因** — 先 log 定位真因，针对性修

---

## 测试清单（实施完成后逐项验证）

### 翻页基础
1. **非全屏**：打开 PDF → 仍是 scroll 模式（鼠标滚轮垂直滚）
2. **全屏单页**：竖窗口 → 一页一屏，trackpad 向右 swipe → 翻下一页（动画）
3. **全屏双页**：宽窗口 → 双页 spread，向右 swipe → 翻一个 spread
4. **键盘 ←/→**：全屏期同样翻页

### 边界
5. **第一页向前** → 无动作或弹回
6. **最后一页向后** → 无动作或弹回
7. **退出全屏**：ESC 退出 → PDF 恢复 scroll 模式，停在之前页面附近

### 不破坏既有
8. **PDF 标注**（rect / underline）全屏期仍能创建
9. **页码输入跳页**（toolbar）全屏期仍能用
10. **TOC 跳转**仍能用

---

## 失败回滚

如果走到一半发现 paged 路径与现有 scroll 路径有难以协调的状态冲突，
**先停下来跟用户讨论**，不要继续打补丁。备选：
- 接受 PDF 全屏没动画（仅切 paged 布局）
- 接受 PDF 全屏纯切 scroll 单页（容器宽度自适应单页宽，scroll 不变）

---

## 立即开始

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout -b feature/pdf-fullscreen-paged main
git show 09b089d2:src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx | head -100
git show 52ecc290:src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx | head -100
```

读完两个 commit 的代码 + 当前 EBookView/Host/FixedPageContent，先和用户讨论
实施方案再动代码（如何切 paged 分支、动画结构、Host 接口扩展、状态同步等）。
