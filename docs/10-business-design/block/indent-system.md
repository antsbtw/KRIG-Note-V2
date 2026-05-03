# Indent System — Block 缩进系统

> **状态**：P1-P5 已实现
> **涉及模块**：键盘交互（Tab/Shift+Tab）、Block Selection、SlashMenu、Container 嵌套
>
> ### 实现完成情况
>
> | 阶段 | 状态 | 实现位置 |
> |------|------|---------|
> | **P1** 普通 block 视觉缩进 | ✅ 完成 | `plugins/indent.ts` — indentBlock/outdentBlock + Decoration 渲染 |
> | **P2** 列表嵌套缩进 | ✅ 完成 | `plugins/indent.ts` — nestListItem |
> | **P3** 列表提升 | ✅ 完成 | `plugins/indent.ts` — liftListItem |
> | **P4** Block Selection 批量缩进 | ✅ 完成 | `plugins/block-selection.ts` — Tab/Shift-Tab 处理 |
> | **P5** SlashMenu Container 内嵌套 | ✅ 完成 | `components/SlashMenu.tsx` — 通过 `$from.depth` 自然实现 |
>
> **备注**：
> - 当前 `indent` attr 仅定义在 textBlock 上。codeBlock/mathBlock/image 等节点暂不支持块级视觉缩进，后续按需补充 schema attr 即可自动生效（indent plugin 的 Decoration 和 Block Selection 逻辑已就绪）
> - codeBlock 内部 Tab 为代码制表符，块级缩进通过 Block Selection 模式操作

---

## 一、概览

缩进分为两种，**互斥**：

| 类型 | 定义 | 操作对象 |
|------|------|---------|
| **视觉缩进** | `indent` attr 控制 `padding-left`，Block 整体右移 | 整个 Block 作为单元 |
| **结构缩进** | 列表内嵌套/提升，改变容器的父子结构 | 列表容器内部的某一项 |

Tab/Shift+Tab 的行为由上下文决定：

| 上下文 | Tab | Shift+Tab | 类型 |
|--------|-----|-----------|------|
| 普通 textBlock | indent +1 | indent -1 | 视觉缩进 |
| 列表内某一项 | 嵌套为子列表 | 提升到父列表 | 结构缩进 |
| Container 内（blockquote/callout 等） | indent +1 | indent -1 | 视觉缩进 |
| **Block Selection 模式** | **所有选中 block indent +1** | **indent -1** | **视觉缩进（永远）** |

### 关键规则

- **列表内光标 = 结构缩进**：操作的是列表的一项，Tab 嵌套、Shift+Tab 提升
- **Block Selection = 视觉缩进（永远）**：选中的是整个 block（包括整个列表容器），Tab 改 indent attr
- **两者互斥**：列表内不做视觉缩进，Block Selection 不做结构缩进

---

## 二、普通 Block 缩进（视觉缩进）

### 2.1 机制

textBlock 的 `indent` attr 控制视觉缩进：

```typescript
attrs: {
  indent: { default: 0 },  // 0-8，每级 24px
}
```

CSS 渲染：
```css
/* 由 indent attr 动态设置 */
style="padding-left: ${indent * 24}px"
```

### 2.2 键盘

| 按键 | 行为 |
|------|------|
| Tab | `indent = Math.min(indent + 1, 8)` |
| Shift+Tab | `indent = Math.max(indent - 1, 0)` |

### 2.3 适用范围

- textBlock（普通段落、heading）
- RenderBlock（codeBlock、mathBlock、image 等）
- Container 整体（blockquote、callout 等作为一个 block 缩进）

---

## 三、列表缩进（嵌套）

### 3.1 核心规则

列表内的 Tab **不是视觉缩进，而是结构嵌套**：

```
Tab 前：                          Tab 后：
orderedList                       orderedList
  1. 第一项                         1. 第一项
  2. 第二项  ← 光标在这里              orderedList（嵌套）
  3. 第三项                             1. 第二项  ← 光标
                                  2. 第三项

Shift+Tab 前：                    Shift+Tab 后：
orderedList                       orderedList
  1. 第一项                         1. 第一项
    orderedList                     2. 第二项  ← 提升到父级
      1. 第二项  ← 光标              3. 第三项
  2. 第三项
```

### 3.2 嵌套规则

| 列表类型 | Tab 嵌套 | 嵌套后的子列表类型 |
|----------|---------|-----------------|
| bulletList | 当前项包裹进新 bulletList | 同类型（bulletList） |
| orderedList | 当前项包裹进新 orderedList | 同类型（orderedList） |
| taskList | 当前 taskItem 包裹进新 taskList | 同类型（taskList） |

### 3.3 前提条件

- Tab 嵌套要求**当前项不是列表的第一项**（第一项没有上一个兄弟可以合并）
- 或者当前项和上一项一起嵌套

### 3.4 实现方式

```
Tab（列表内）：
  1. 找到当前 block 在列表中的位置
  2. 创建新的同类型子列表
  3. 将当前 block 移入子列表
  4. 如果上一项已经有子列表，合并进去

Shift+Tab（嵌套列表内）：
  1. 将当前 block 从子列表中提取出来
  2. 插入到父列表中（子列表的下一个位置）
  3. 如果子列表变空，删除子列表
```

---

## 四、Container 内嵌套（SlashMenu）

### 4.1 规则

在 Container 内通过 SlashMenu 创建新 Container = **在当前位置嵌套**：

```
操作：在 orderedList 第 2 项输入 /bullet → 选择 Bullet List

结果：
orderedList
  1. 第一项
  2.                    ← 当前项保留（或删除如果为空）
    bulletList          ← 嵌套在 orderedList 内部
      • 光标在这里
  3. 第三项
```

### 4.2 SlashMenu 改造

当前 SlashMenu 的 `executeItem` 总是在**顶层替换** block。需要改为：

```
if (光标在 Container 内部) {
  在当前位置嵌套新 Container（作为子节点）
} else {
  在顶层替换当前 block（现有行为）
}
```

---

## 五、Block Selection 批量缩进

### 5.1 规则

选中多个 block 后 Tab/Shift+Tab：

```
ESC 选中 block B、C、D：
  A
  [B]  ← 选中
  [C]  ← 选中
  [D]  ← 选中
  E

Tab → 所有选中 block indent +1：
  A
    B
    C
    D
  E

Shift+Tab → 所有选中 block indent -1
```

### 5.2 列表内的批量缩进

如果选中的 block 都在同一个列表内，Tab = 批量嵌套：

```
bulletList
  [• B]  ← 选中
  [• C]  ← 选中

Tab →
bulletList
  • A
    bulletList
      • B
      • C
```

### 5.3 实现

在 `block-selection.ts` 的 `handleKeyDown` 中增加 Tab/Shift+Tab 处理：

```typescript
if (event.key === 'Tab' && active) {
  event.preventDefault();
  if (event.shiftKey) {
    outdentSelectedBlocks(view, selectedPositions);
  } else {
    indentSelectedBlocks(view, selectedPositions);
  }
  return true;
}
```

---

## 六、与手柄的关系

缩进是 Block 基类共享能力（CLAUDE.md §二），不受具体 block 类型影响：

- 手柄始终在固定垂直线上（不因缩进偏移）
- 缩进后的 block 通过 `padding-left` 视觉右移，手柄位置不变
- 列表嵌套后，内层列表是新的 Container，手柄对齐到内层 block

---

## 七、文件结构

```
src/plugins/note/
├── plugins/
│   ├── indent.ts              ← 缩进 Plugin（Tab/Shift+Tab 处理）
│   └── block-selection.ts     ← 扩展：批量缩进
├── commands.ts                ← indent/outdent 命令函数
└── components/
    └── SlashMenu.tsx           ← 改造：Container 内嵌套
```

---

## 八、实施顺序

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P1** | 普通 block 视觉缩进（Tab → indent attr） | 无 |
| **P2** | 列表嵌套缩进（Tab → 嵌套同类型子列表） | P1 |
| **P3** | Shift+Tab 列表提升（从子列表提取到父列表） | P2 |
| **P4** | Block Selection 批量缩进 | P1 |
| **P5** | SlashMenu Container 内嵌套 | P2 |

### P1 检查清单

- [ ] `commands.ts` — `indentBlock(view, pos)` / `outdentBlock(view, pos)` 命令
- [ ] `plugins/indent.ts` — Tab/Shift+Tab 键盘处理 Plugin
- [ ] `NoteEditor.tsx` — 注册 indent Plugin
- [ ] `note.css` — indent 视觉渲染（`padding-left: ${indent * 24}px`）
- [ ] 验证：textBlock、heading、codeBlock、mathBlock 都支持缩进
- [ ] 验证：indent 0-8 范围限制

### P2 检查清单

- [ ] `commands.ts` — `nestListItem(view, pos)` / `liftListItem(view, pos)` 命令
- [ ] `plugins/indent.ts` — 检测列表上下文，Tab 走嵌套而非视觉缩进
- [ ] 验证：bulletList、orderedList、taskList 嵌套/提升
- [ ] 验证：嵌套后编号重置（orderedList 子列表从 1 开始）
- [ ] 验证：Shift+Tab 从嵌套列表提升到父列表

---

## 九、设计原则

1. **Tab 语义由上下文决定**：列表内 = 嵌套，其他 = 视觉缩进
2. **缩进是基类能力**：所有 Block 都支持，不需要各 block 单独实现
3. **列表嵌套保持同类型**：bulletList 内 Tab → 嵌套 bulletList，不混合类型
4. **手柄不受影响**：缩进用 `padding-left`，不改变 `getBoundingClientRect().left`（手柄固定）
5. **结构操作不可逆要谨慎**：列表嵌套是结构变化，必须支持 Undo
