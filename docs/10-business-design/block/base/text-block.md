# TextBlock — 文字流基类

> **文档类型**：基类契约
> **状态**：v3 | 更新日期：2026-04-04
> **约束力**：所有文字类 Block 必须遵循本文档定义
> **继承**：Block 抽象基类（见 `base-classes.md`）

---

## 一、定义

TextBlock 的内容是 **inline 流**——文字和 inline 节点自由混排。用户直接在里面打字。

```typescript
content: 'inline*'
```

这是编辑器中最基础、最常用的 Block 类型。paragraph、heading、noteTitle 都是 TextBlock 的 attrs 变体，**共享同一个 Schema 节点类型**。

> **注意**：列表、引用、提示框等容器功能由 ContainerBlock 基类实现（见 `container-block.md`），不再是 TextBlock 的 attrs 变体。

---

## 二、内容模型：inline 流

### 2.1 当前 inline 节点

| 节点 | 说明 | atom | 创建方式 |
|------|------|------|----------|
| text | 纯文字，可携带 marks | 否 | 直接打字 |
| hardBreak | 软换行 `<br>` | 否 | Shift+Enter |
| mathInline | 行内公式（KaTeX 渲染） | 是 | SlashMenu /math |
| noteLink | 笔记链接（📄 标签） | 是 | SlashMenu /link |

### 2.2 可扩展的 inline 节点（未来注册即可用）

| 节点 | 说明 |
|------|------|
| mention | @提及（用户/文档/概念） |
| inlineImage | 行内小图（icon、缩略图） |
| date | 日期选择器 |
| emoji | 自定义 emoji 图片 |
| tag | 标签（知识图谱节点引用） |

新增 inline 节点不需要修改 TextBlock——注册到 Schema 后自动在所有 TextBlock 中可用。

---

## 三、Marks（文字格式化）

| Mark | 快捷键 | 视觉 | 说明 |
|------|--------|------|------|
| bold | Cmd+B | **加粗** | |
| italic | Cmd+I | *斜体* | |
| underline | Cmd+U | 下划线 | |
| strike | Cmd+Shift+S | ~~删除线~~ | |
| code | Cmd+E | `行内代码` | 等宽字体 |
| link | FloatingToolbar 🔗 | 蓝色下划线 | Web URL 或 krig://note/ |
| textStyle | FloatingToolbar A | 文字颜色 | 6 色 |
| highlight | FloatingToolbar H | 背景高亮 | 5 色 |

---

## 四、专属 Attrs

```typescript
interface TextBlockAttrs {
  level: 1 | 2 | 3 | null;    // null = paragraph, 1/2/3 = H1/H2/H3
  isTitle: boolean;             // true = 文档标题（40px）
  open: boolean;                // heading 折叠状态

  indent: number;               // 缩进层级（0-8，每级 24px）
  textIndent: boolean;          // 首行缩进 2em
  align: 'left' | 'center' | 'right' | 'justify';
}
```

### 4.1 level 视觉变体

| level | 视觉 | 字号 | 字重 |
|-------|------|------|------|
| null | 普通段落 | 16px | normal |
| 1 | H1 标题 | 30px | 700 |
| 2 | H2 标题 | 24px | 600 |
| 3 | H3 标题 | 20px | 600 |

### 4.2 noteTitle

特殊的 TextBlock：

- `level = null`，`isTitle: true`
- 字号 40px，加粗
- 文档固定首行，不可删除，不可拖拽
- 空内容时显示 "Untitled" placeholder
- 内容变化自动同步到 NavSide 文件名

---

## 五、键盘行为

### 5.1 Enter（回车）

| 条件 | 行为 |
|------|------|
| 有内容，光标在中间 | 分裂为两个 TextBlock |
| 有内容，光标在末尾 | 创建新空 TextBlock |
| 空行 + 有 level | 清除 level（标题变段落） |
| 空行 + 普通段落 | 创建新空 TextBlock |

> **在 Container 内**的 TextBlock，Enter 行为由 `container-keyboard.ts` 统一处理：
> 有内容 → 在 Container 内创建新行；空行 → 退出 Container。

### 5.2 Shift+Enter

插入 hardBreak（`<br>` 软换行），不创建新 Block。

### 5.3 Backspace（行首）

| 条件 | 行为 |
|------|------|
| 有 level | 清除 level（标题变段落，保留文字） |
| 普通段落 | 与上一个 Block 合并 |
| 空行 | 删除当前 Block |

> **在 Container 内**首子节点行首 Backspace → unwrap 退出 Container。

### 5.4 Tab / Shift-Tab

```
Tab → indent += 1（最大 8）
Shift-Tab → indent -= 1（最小 0）
```

indent 用 `padding-left`（纯文字缩进）。

### 5.5 快捷键

```
Cmd+Alt+0 → 转为文本（清除 level）
Cmd+Alt+1 → level = 1（已是 H1 则清除）
Cmd+Alt+2 → level = 2
Cmd+Alt+3 → level = 3
Cmd+Shift+T → 首行缩进 toggle
Cmd+. → Heading 折叠 toggle
```

---

## 六、Markdown 输入规则

在行首输入以下模式 + 空格，自动转换：

| 输入 | 效果 |
|------|------|
| `# ` | level = 1 |
| `## ` | level = 2 |
| `### ` | level = 3 |
| `- ` 或 `* ` | 包裹进 bulletList Container |
| `1. ` | 包裹进 orderedList Container |
| `[] ` 或 `[ ] ` | 包裹进 taskList Container |
| `> ` | 包裹进 blockquote Container |
| ` ``` ` | 替换为 codeBlock |
| `---` | 替换为 horizontalRule |

---

## 七、FloatingToolbar

选中文字后弹出浮动工具栏：

```
[B] [I] [U] [S] [<>]
```

| 按钮 | 功能 | 说明 |
|------|------|------|
| B | 加粗 | Cmd+B |
| I | 斜体 | Cmd+I |
| U | 下划线 | Cmd+U |
| S | 删除线 | Cmd+Shift+S |
| <> | 行内代码 | Cmd+E |

---

## 八、HandleMenu

| 菜单项 | 快捷键 | 行为 |
|--------|--------|------|
| 文本 | ⌘⌥0 | 清除 level |
| 标题 1/2/3 | ⌘⌥1/2/3 | 设置 level |
| 删除 | | 删除 Block |

---

## 九、ContextMenu（右键）

| 菜单项 | 说明 |
|--------|------|
| Cut / Copy / Paste | 剪贴板操作 |
| Delete | 删除当前 Block |

---

## 十、与知识图谱的关系

TextBlock 是知识图谱的基础数据单元（P3 原则）：

- 每个 TextBlock 可以被引用（noteLink 指向）
- 文字内容可被全文搜索
- inline 节点（mathInline、noteLink、未来的 mention/tag）是节点间的连接点

---

*本文档为 TextBlock 基类契约。修改需全体评审。*
