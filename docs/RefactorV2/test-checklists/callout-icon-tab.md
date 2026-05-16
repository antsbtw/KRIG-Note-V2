# Callout Icons Tab 测试清单(D023)

> Feature 分支:`feature/callout-icon-tab`
> 目标:callout emoji picker 增加 Icons tab — lucide 1952 个 icon 全库分组 + 搜索(emoji-mart 同款)
> 决议:[023-callout-icon-tab.md](../data-model/persistence/decisions/023-callout-icon-tab.md)
>
> 改动文件(13 个 commit 范围 `6e28dd0..bc81784`):
> - `src/drivers/text-editing-driver/blocks/callout/spec.ts`(加 `iconName` attr)
> - `src/drivers/text-editing-driver/blocks/callout/node-view.ts`(iconName 渲染分支)
> - `src/drivers/text-editing-driver/blocks/callout/icon-handler.ts`(新增,renderer 注入点)
> - `src/drivers/text-editing-driver/api.ts`(`setCalloutIcon` + `setCalloutEmoji` 互斥清 iconName)
> - `src/capabilities/text-editing/converters/atoms-to-pm.ts`(iconName 透传)
> - `src/capabilities/text-editing/ui/emoji-picker/callout-icon-renderer.tsx`(新增,静态+动态双 path)
> - `src/capabilities/text-editing/ui/emoji-picker/callout-icons.ts`(68 置顶 picks)
> - `src/capabilities/text-editing/ui/emoji-picker/IconsTabPanel.tsx`(全库分组 + 搜索 + IO lazy)
> - `src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx`(Icons tab 解 disabled)
> - `src/capabilities/text-editing/ui/emoji-picker/lucide-manifest.json`(新增,1952 icon 元数据)
> - `src/views/note/note.css`(Icons tab 暗色样式 + flex shrink 修复)
> - `scripts/build-lucide-manifest.mjs`(新增,一次性 manifest 生成脚本)
> - `package.json`(+ `lucide-react@^1.14.0` + `build:lucide-manifest` npm script)

---

## 测试前提

- **完整重启 Electron**(不是 Cmd+R 热重载,首次需让 Vite 重打 IconsTabPanel chunk)
- 新建或打开一篇笔记

---

## A. Icons tab UI 基础

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| A1 | 创建 callout(slash `/callout`),点 💡 弹 picker | picker 弹出,Emojis tab active,4 tab 栏(Emojis/Icons/Upload/Remove) | ⏳ |
| A2 | 点 Icons tab | tab active,顶部一行 icon-only 分类导航(43 个,横向可滚),下方一行 search 输入框,再下方滚动区起首 "CALLOUTS" section | ⏳ |
| A3 | nav 横向滚动 | 鼠标滚轮或拖动滚动条,看到所有 43 个 category icon(lightbulb / accessibility / wallet / dog / arrow-right / building-2 / ... / circle-help 兜底) | ⏳ |

---

## B. 分类跳转 + lazy render

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| B1 | 点 nav 第 2 个 chip(accessibility) | scroll 区平滑滚到 "ACCESSIBILITY" section,icon 渐进渲出(IntersectionObserver 触发) | ⏳ |
| B2 | 点 nav weather chip(cloud 图标) | 滚到 "WEATHER" section,看到 cloud/sun/moon/snowflake 等 | ⏳ |
| B3 | 滚动 scroll 区到底部 | "OTHERS" section 兜底显示 249 个 alias/deprecated icon(sort-desc / alarm-check 等) | ⏳ |
| B4 | 滚回顶部 | "CALLOUTS" section 68 个 icon 立即显示(静态 path,无 lazy 延迟) | ⏳ |
| B5 | section title sticky | 滚动时 section 标题(CALLOUTS / ACCESSIBILITY / ...)粘顶,不被遮挡 | ⏳ |

---

## C. 搜索

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| C1 | search 输入 "heart" | nav 隐藏,显示单 flat grid:Heart / HeartCrack / HeartHandshake / HeartOff / HeartPulse 等(命中 name + tags) | ⏳ |
| C2 | search 输入 "love" | 显示 Heart 等(命中 tags 中的 "love") | ⏳ |
| C3 | search 输入 "📷" | 显示 Camera(命中 callout-icons.ts keywords 中的 '📷') | ⏳ |
| C4 | search 输入 "weather" | 命中 weather category 的 icon(因为搜索 includes categories 字段) | ⏳ |
| C5 | search 输入 "xyzzy_no_match"(乱码) | 显示 "No icons match ..." 空状态 | ⏳ |
| C6 | search 清空 | nav 重新显示,回到分组模式 | ⏳ |

---

## D. 选 icon → callout 头部渲染

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| D1 | Callouts 段选 Lightbulb | picker 关闭,callout 头部 emoji 位置渲 lucide Lightbulb svg | ⏳ |
| D2 | 选其他 section 的 icon(如 Music) | callout 头部渲 Music svg(走 DynamicIcon lazy 加载,首次 ~50-200ms 延迟) | ⏳ |
| D3 | 再点头部 svg icon | picker 重弹,Emojis tab active(用户重新选择起点) | ⏳ |
| D4 | 切回 Emojis tab,选 🔥 | callout 头部回 🔥 emoji(iconName 自动清 null,§4.4 互斥) | ⏳ |
| D5 | 重新点头部 emoji 🔥 | picker 弹出,Emojis tab active(iconName 已 null) | ⏳ |

---

## E. 持久化

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| E1 | 选 Lightbulb → Cmd+R 刷新 | callout 仍渲 Lightbulb svg | ⏳ |
| E2 | E1 完整重启 Electron(不是 Cmd+R) | callout 仍渲 Lightbulb svg | ⏳ |
| E3 | 选 emoji 🔥 → 重启 | callout 仍渲 🔥 emoji | ⏳ |
| E4 | 打开 v1 时期创建的旧 callout(无 iconName 字段) | 渲 emoji 默认 💡 或保存的 emoji,行为无变化 | ⏳ |

---

## F. Copy/Paste

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| F1 | 选 Camera icon 的 callout 整块 → Cmd+C → 同 note 内 Cmd+V | 粘贴的 callout 头部仍渲 Camera svg(走 DOMSerializer.toDOM + data-icon-name) | ⏳ |
| F2 | F1 跨 note 粘贴 | 同上,iconName 透传 | ⏳ |

---

## G. 边界 / 性能

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| G1 | Icons tab 首次 mount 瞬间 | ~100ms 内显示 search + nav + Callouts 68 icon,其他 section placeholder 占位无白屏 | ⏳ |
| G2 | DevTools Network tab 观察 | visible section 内每个 icon 单独 chunk 请求(file:// .mjs);非 visible section 无 chunk 请求 | ⏳ |
| G3 | search 频繁输入(每字符) | 无明显卡顿(filter 全 manifest ~50ms,React re-render <16ms) | ⏳ |
| G4 | Upload / Remove tab | 仍 disabled(本 sub-phase 不做) | ⏳ |
| G5 | 切回 Emojis tab | emoji-mart Picker re-mount,~50ms loading 闪现(emoji-mart data 已缓存,re-mount 快) | ⏳ |

---

## H. 回归(不应破坏 v1)

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| H1 | Emojis tab 完整功能 | Callouts 24 emoji 置顶,9 个 emoji-mart 内置 category(frequent/people/nature/...),搜索/最近/肤色/暗色全部正常 | ⏳ |
| H2 | callout 容器内嵌 block(H1/list/math/table/...) | 不破坏 callout-as-container 已有行为(详 [callout-as-container.md](callout-as-container.md)) | ⏳ |
| H3 | block handle ⋮⋮ 在 callout 内可见 | 第 2 行起每行左侧 ⋮⋮(详 callout-as-container.md C 段) | ⏳ |

---

## 通过条件

A–H 全 ✅ → 用户显式确认 merge to main。

---

## 已知非阻塞项

- lint baseline 1 个 warning(`build-block-handle-plugin.ts:114` unused `eslint-disable`),audit §5.4 ESLint config block 互覆盖 bug 已登记,与本 sub-phase 无关。
- lucide-react `1.14 → 1.16` 升级走独立 sub-phase(SDK-policy §4 锁定理由)。
- 249 个 no-meta icon(alias/deprecated)归入 Others section 兜底,后续 v2.5 可加 alias 反向推断进主 category。
