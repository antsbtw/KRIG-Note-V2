# Callout-as-Container 测试清单

> Feature 分支：`feature/callout-as-container`
> 目标：让 callout 成为通用容器 — 任意 block 可拖入、slash 创建在内、空行回车跳出
> 改动文件：
> - `src/drivers/text-editing-driver/api.ts`
> - `src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts`
> - `src/drivers/text-editing-driver/capability-integrations/dnd-targets.ts`
> - `src/drivers/text-editing-driver/pm-host.css` (callout Notion 风格 + 修 emoji height bug)
> - `src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx` (emoji-mart 包装)
> - `src/capabilities/text-editing/ui/emoji-picker/EmojiPickerTabs.tsx` (4 tab 栏)
> - `src/capabilities/text-editing/ui/emoji-picker/callout-emojis.ts` (Callouts 24 emoji)
> - `src/capabilities/text-editing/ui/popups.ts` (estimatedSize 调整)
> - `src/views/note/note.css` (picker 容器样式)
> - `package.json` (+ emoji-mart@^5.6.0 + @emoji-mart/data@^1.2.1)

---

## 测试前提

- **完整重启 Electron**（不是 Cmd+R 热重载，热重载可能拿不到 driver plugin 新代码）
- 新建或打开一篇笔记

---

## A. Slash 在 callout 内创建 block

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| A1 | 空行输入 `/callout` 回车 | 出现 💡 callout，光标在内部空段落 | ✅ |
| A2 | callout 内段落输入 `/h1` 回车 | callout 内段落变 H1，**callout 容器仍在外面** | ✅ |
| A3 | callout 内输入 `/bullet`、`/ordered`、`/task` | callout 内变对应列表 | ✅ |
| A4 | callout 内输入 `/quote` | callout 内嵌套 blockquote | ✅ |
| A5 | callout 内输入 `/callout` | 双层 💡 嵌套 callout | ✅ |
| A6 | callout 内输入 `/image` | image placeholder 在 callout **内部** | ⏳ |
| A7 | callout 内输入 `/math` | math block 在 callout 内 | ✅ |
| A8 | callout 内输入 `/table` | table 在 callout 内 | ✅ |
| A9 | callout 内输入 `/toggle` | toggle list 在 callout 内 | ✅ |
| A10 | callout 内输入 `/code` | code block 在 callout 内 | ⏳ |
| A11 | callout 内输入 `/divider` | 水平线在 callout 内，下方多空段 | ⏳ |

---

## B. 空行回车跳出 callout（PM 内置 liftEmptyBlock，应保持）

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| B1 | callout 内段末按一次回车 | callout 内多一行空段，光标在新段 | ⏳ |
| B2 | 在 B1 空段上**再**按一次回车 | 光标跳出 callout 到外层新空段 | ⏳ |
| B3 | blockquote 空行二次回车 | 跳出 blockquote | ⏳ |
| B4 | toggle 空行二次回车 | 跳出 toggle | ⏳ |

---

## C. Block Handle ⋮⋮ 在容器内可见

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| C1 | callout 内 H1/list/paragraph/math 各行 hover | **第 2 行及以后**每行左侧出现 ⋮⋮（第一行隐藏，对齐 emoji 视觉） | ✅ |
| C2 | callout 内 mathBlock 行 hover | ⋮⋮ 紧贴 mathBlock 左侧（若 mathBlock 是第一行则隐） | ⏳ |
| C3 | hover ⋮⋮ 上方 | ⋮⋮ **保持显示，不闪走** | ✅ |
| C4 | hover callout 顶部 padding 区（emoji 旁） | ⋮⋮ 切换到 callout 容器自身 | ⏳ |
| C5 | 在 callout 内 paragraph A → B 横向移动 | ⋮⋮ 跟随切换 | ⏳ |
| C6 | 点 ⋮⋮ 弹菜单 → 选 H1 | **只**该 paragraph 变 H1，callout 不变（第一行无 handle，只能键盘改） | ⏳ |
| C7 | blockquote / toggle 内同 C1 | 内部子 block 都有 ⋮⋮（仅 callout 第一行 opt-out，blockquote/toggle 不受影响） | ⏳ |
| C8 | bullet list 第 2 项 hover | ⋮⋮ 对应 listItem（不是 item 内的 paragraph） | ⏳ |
| C9 | callout **第一行** hover | ⋮⋮ **不显示**（避免与 emoji 撞挤） | ✅ |
| C10 | 嵌套 callout：外层第一行是内层 callout，hover 内层 | 内层 callout 自己的 handle **不显示**（它是外层第一个 child） | ⏳ |

---

## D. 拖拽进出 callout

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| D1 | 顶层 paragraph 拖进 callout | 落点蓝线在 callout 内，释放后段落进 callout | ❌ |
| D2 | callout 内 paragraph 拖到 callout 外 | 段落移到 callout 外 | ✅ |
| D3 | callout 内 A/B/C 三段，拖 C 到 A 上方 | 顺序变 C/A/B | ⏳ |
| D4 | hover callout 顶部 padding 拿到 callout 自己的 ⋮⋮，拖动 | 整个 callout 移动（含所有 child） | ⏳ |
| D5 | 顶层 image 拖进 callout | image 进 callout 内 | ❌ |
| D6 | callout 内 mathBlock 拖出 callout | mathBlock 移到 callout 外 | ✅ |

---

## E. 右键菜单深层

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| E1 | 右键 callout 内 paragraph | context menu 针对该 paragraph | ⏳ |
| E2 | 右键 callout 外顶层 paragraph | 行为不变 | ⏳ |

---

## F. Callout emoji picker（Notion 风格升级）

> **本 sprint emoji picker 升级要点**：emoji-mart 5.x + Callouts 24 emoji 置顶 + 4 tab 栏（v1 只激活 Emojis）+ 暗色硬编码

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| F1 | 点击 callout 的 💡 | picker popup 紧贴 emoji 下方弹出（短暂 loading… 后 emoji-mart 加载完） | ✅ |
| F2 | picker 内点击新 emoji | callout 头部 emoji 立即更新 + picker 关闭 | ✅ |
| F3 | 嵌套 callout（外层内层都是 💡），点内层 💡 | picker 弹在**内层** emoji 旁 | ✅ |
| F4 | picker 顶部 4 tab 栏 | Emojis 白色 active + 下划线；Icons/Upload/Remove 灰色不可点 | ⏳ |
| F5 | picker 内容区第一个分类 | "Callouts" 置顶，含 24 个 callout-friendly emoji（💡👉☝️👌🔑🚧⚠️🔥📌✂️❓🚫⛔⏰☎️🚨♻️✅🔒📎📖🗣️➡️📣🛠️⚙️） | ⏳ |
| F6 | Callouts 之后的分类顺序 | Frequently used → Smileys & People → ... → Flags（emoji-mart 9 内置类） | ⏳ |
| F7 | 搜索框输入 "fire" | 列出 🔥 等火焰类 emoji（英文搜索，v1 不含中文 i18n） | ⏳ |
| F8 | 点击搜索框右侧 🟡 肤色按钮 | 弹 6 档肤色选择器（emoji-mart 自带） | ⏳ |
| F9 | 选中某 emoji 后重开 picker | Frequently used 区出现该 emoji | ⏳ |
| F10 | 系统主题切 light → V2 | picker **仍是暗色**（V2 现无 light mode，硬编码 dark） | ⏳ |
| F11 | viewport 右下角创建 callout 点 💡 | picker 自动翻上方/左方避让，不溢出 viewport | ⏳ |

---

## G. 持久化 / 序列化（回归）

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| G1 | callout 内塞 H1 + bullet + image + math + 嵌套 callout，切 note 再切回 | 结构完整还原 | ⏳ |
| G2 | Markdown 导出（如使用） | callout 内复杂结构正确导出 | ⏳ |

---

## H. List 内行为不变（回归）

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| H1 | bullet list 内 Tab | 子项嵌套 | ⏳ |
| H2 | bullet list 空项 Enter | 跳出 list | ⏳ |
| H3 | bullet list item 内输入 `/h1` | 该 item 内段落变 H1（新行为，schema 允许） | ⏳ |

---

## I. Title 块（回归）

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| I1 | note title 行输入 `/h1` | 无变化，title 保持 | ⏳ |
| I2 | hover note title 行 | ⋮⋮ **不**出现 | ⏳ |

---

## 状态图例

- ✅ 已通过
- ❌ 已发现问题
- ⏳ 待测
- ⚠️ 有 issue 但可绕开

---

## 已知问题（首轮测试发现）

### 1. D1 / D5 — 无法把外部 block 拖进 callout
**现象**：能从 callout 内拖出（D2/D6 ✓），但反向拖入失败。
**待排查方向**：
- `view.posAtCoords` 在 callout contentDOM 内是否正确解析到内部位置
- `handleDrop` 的 dropPos 计算是否对外来 source 也走深层（非 listItem 分支已改深层，但可能 PM 的默认 drop 抢先处理了拖入）
- 是否需要 dropCursor 在 callout 内额外绘线提示

### 2. F1 / F3 — emoji picker popup 远离 emoji（已修，commit c1e3cc3）
**根因**：`.krig-callout` flex container 默认 `align-items: stretch`，让 `.krig-callout__emoji` span 被拉到容器高度（callout 多行内容时撑到 172px）。popup `top = anchor.bottom + 4 = anchor.top + 172 + 4` 落到 callout 下方而非 emoji 下方。
**修法**：[pm-host.css](../../../src/drivers/text-editing-driver/pm-host.css) `.krig-callout` 加 `align-items: flex-start` + `.krig-callout__emoji` 改 `display: inline-flex` + 固定 24×24 盒子。PopupBinding 算式正确不动。顺手按 Notion 风格重写（浅灰半透明底 + 4px 圆角 + emoji hover 圆角灰底反馈）。

---

## 历史改动记录

| 日期 | 改动 | 提交 |
|------|------|------|
| 2026-05-15 | 初版 — turnInto 深层 + 业务插入深层 + block-handle 扩展 + 拖拽校验 | 0c5f2cc |
| 2026-05-15 | handle 闪烁修复 — hover 冻结 + relatedTarget + 祖先保留 | 0c5f2cc |
| 2026-05-15 | emoji-mart 核心包绑定 + SDK policy v1.8 登记 | 794db28 |
| 2026-05-15 | callout Notion 风格 CSS + 修 emoji height 撑爆导致 popup 飘位（F1/F3）| c1e3cc3 |
| 2026-05-15 | emoji picker 升级 Notion 风格（emoji-mart + Callouts 24 emoji 置顶 + 4 tab 栏）| 4a7c8eb |
| 2026-05-15 | callout 第一个子 block 隐藏 block-handle（避免与 💡 撞挤）| b366fdb |
