# Slot Close Button — 每个 Slot View 自带关闭按钮

:::callout[NOTE]
**目标**：为每个装载在 Slot 中的 View 添加关闭按钮，关闭后另一侧 Slot 扩展占满。
补充 milestone-2 双栏布局的交互完整性。
:::

---

:::toggle-heading[## 一、问题与动机]

### 当前状况

- 关闭右侧 Slot 的唯一入口在 **左侧 View 的 Toolbar**（NoteToolbar 的 `switchRightView('close')`）
- View 自身没有关闭按钮 — 用户在右侧操作时，必须切到左侧 Toolbar 才能关闭右侧
- 违反 **操作就近原则**：用户正在看右侧 Thought/AI/PDF，最直觉的关闭动作应该在当前 View 上

### 设计目标

1. 每个 Slot View 自带关闭按钮，用户可以就地关闭
2. 关闭行为左右对称 — 关闭任意一侧，另一侧扩展占满
3. 保证至少一个 Slot 存在，不允许全部关闭

:::

:::toggle-heading[## 二、left→right 方向性分析]

### 现状：left→right 不是主从关系

从 PRESET_MAP 可以看到，left 和 right 没有固定的"主/副"语义：

| 模式 | left | right | 说明 |
|------|------|-------|------|
| `note-thought` | Note | Thought | Note 为主 |
| `note-ai` | Note | AI | Note 为主 |
| `ai-note` | AI | Note | AI 为主，Note 在右侧 |
| `pdf` | PDF | Note | PDF 为主，Note 在右侧 |

Note 已经可以出现在右侧（`ai-note`、`pdf` 模式），说明 left→right 只是 **默认打开方向**（符合从左到右阅读习惯），不是架构约束。

### 结论

- **保持 left→right 作为默认打开方向**：新 View 默认先放 left
- **关闭行为完全对称**：不存在"left 不可关闭"的硬约束
- left→right 是启发规则，不是架构限制

:::

:::toggle-heading[## 三、核心规则]

### 3.1 关闭按钮显示条件

| 条件 | 显示关闭按钮 | 原因 |
|------|-------------|------|
| 双 Slot 模式 | 显示 | 关闭后另一侧可以扩展 |
| 单 Slot 模式 | **隐藏** | 防止关掉最后一个 Slot |

### 3.2 关闭后的行为

- 关闭右侧 Slot → 左侧扩展占满（切到 `*-only` 模式）
- 关闭左侧 Slot → 右侧扩展占满（切到对应 `*-only` 模式）
- 不允许两边都关闭

### 3.3 按钮位置

每个 View 内部的 **Toolbar 右上角**，统一放置 `×` 关闭按钮。

各 View 的 Toolbar：
- NoteToolbar（Note View）
- PDF Toolbar（PDF View）
- Thought View toolbar
- AI/Web View toolbar

:::

:::toggle-heading[## 四、影响范围]

### 4.1 IPC 层

当前只有 `switchRightView('close')` — 语义绑定了右侧。

需要统一为对称的关闭接口：

```
方案：closeSlot('left' | 'right')
```

每个 View 只需要知道"自己在哪个 slot"，然后调用 `closeSlot(mySlot)` 即可。

### 4.2 需要添加关闭按钮的 View

| View | Toolbar 文件 | 说明 |
|------|-------------|------|
| Note | NoteToolbar.tsx | 已有 `switchRightView('close')`，需改为通用 |
| PDF | pdfToolbar | 需新增 |
| Thought | thought view | 需新增 |
| AI/Web | web toolbar | 需新增 |

### 4.3 LayoutManager

- 需要新增 `closeSlot(side: 'left' | 'right')` 方法
- 根据当前模式和被关闭的 side，推导出目标 `*-only` 模式
- 现有的 `toggleSplit()` / `toggleLeftPanel()` 逻辑可复用

:::

:::toggle-heading[## 五、UI 规格]

### 按钮样式

- 位置：View Toolbar 最右侧
- 图标：`×`（与系统风格一致）
- 大小：与 Toolbar 其他按钮一致
- hover 状态：背景高亮

### 交互

- 单击关闭当前 Slot
- 无确认弹窗（轻量操作，可通过重新打开恢复）

:::
