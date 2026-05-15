# Callout-as-Container 测试清单

> Feature 分支：`feature/callout-as-container`
> 目标：让 callout 成为通用容器 — 任意 block 可拖入、slash 创建在内、空行回车跳出
> 改动文件：
> - `src/drivers/text-editing-driver/api.ts`
> - `src/drivers/text-editing-driver/plugins/build-block-handle-plugin.ts`
> - `src/drivers/text-editing-driver/capability-integrations/dnd-targets.ts`

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
| C1 | callout 内 H1/list/paragraph/math 各行 hover | 每行左侧都出现 ⋮⋮ | ⏳ |
| C2 | callout 内 mathBlock 行 hover | ⋮⋮ 紧贴 mathBlock 左侧 | ⏳ |
| C3 | hover ⋮⋮ 上方 | ⋮⋮ **保持显示，不闪走** | ✅ |
| C4 | hover callout 顶部 padding 区（emoji 旁） | ⋮⋮ 切换到 callout 容器自身 | ⏳ |
| C5 | 在 callout 内 paragraph A → B 横向移动 | ⋮⋮ 跟随切换 | ⏳ |
| C6 | 点 ⋮⋮ 弹菜单 → 选 H1 | **只**该 paragraph 变 H1，callout 不变 | ⏳ |
| C7 | blockquote / toggle 内同 C1 | 内部子 block 都有 ⋮⋮ | ⏳ |
| C8 | bullet list 第 2 项 hover | ⋮⋮ 对应 listItem（不是 item 内的 paragraph） | ⏳ |

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

## F. Callout emoji 切换（回归）

| # | 步骤 | 期望 | 状态 |
|---|------|------|------|
| F1 | 点击 callout 的 💡 | emoji picker popup 弹在 emoji 下方/上方紧贴位置 | ❌ |
| F2 | picker 内点击新 emoji | callout 头部 emoji 立即更新 | ⏳ |
| F3 | 嵌套 callout（外层内层都是 💡），点内层 💡 | picker 弹在**内层** emoji 旁 | ❌ |

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

### 2. F1 / F3 — emoji picker popup 远离 emoji
**现象**：点击 callout 💡 后，popup 出现在屏幕远处（如左下角），不在 emoji 紧邻位置。
**待排查方向**：
- `PopupBinding` 的 `useLayoutEffect` 测量时 popupRef 是否拿到正确 rect
- `anchorEl.getBoundingClientRect()` 是否在 PM re-render 后 emoji 元素引用失效
- PopupFrame 的祖先是否有 `transform` 创造 stacking context 让 `position: fixed` 失效

---

## 历史改动记录

| 日期 | 改动 | 提交 |
|------|------|------|
| 2026-05-15 | 初版 — turnInto 深层 + 业务插入深层 + block-handle 扩展 + 拖拽校验 | 未 commit |
| 2026-05-15 | handle 闪烁修复 — hover 冻结 + relatedTarget + 祖先保留 | 未 commit |
