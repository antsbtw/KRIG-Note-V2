# Marks — 内联格式标记

> **类型**：Mark（附加在 text 上的格式信息）
> **状态**：部分已实现

---

## 一、已实现的 Mark（6 种）

| Mark | 快捷键 | 说明 | 状态 |
|------|--------|------|------|
| **bold** | Cmd+B | 粗体 | ✅ |
| **italic** | Cmd+I | 斜体 | ✅ |
| **underline** | Cmd+U | 下划线 | ✅ |
| **strike** | Cmd+Shift+S | 删除线 | ✅ |
| **code** | Cmd+E | 行内代码 | ✅ |
| **link** | Cmd+K | 统一链接（Note 内链 / Web 外链 / Block 引用） | ✅ 注册，待扩展（见 `note-link.md`） |

---

## 二、待实现的 Mark（3 种）

### textStyle — 文本颜色

```typescript
{
  attrs: {
    color: { default: null },
  },
}
```

用途：改变文字颜色（红/蓝/绿/...）。

### highlight — 背景高亮

```typescript
{
  attrs: {
    color: { default: 'yellow' },
  },
}
```

用途：给文字加背景色（黄色高亮、蓝色高亮...）。和 textStyle 的区别：textStyle 改文字颜色，highlight 改背景色。

### thought — 思考锚点

```typescript
{
  attrs: {
    thoughtId: {},
  },
}
```

用途：标记文字为思考锚点——关联到 ThoughtView 中的一条 Thought。这是 NoteView 和 ThoughtView（NoteView:thought variant）之间协同通信的基础。

---

## 三、Mark 在架构中的位置

Mark 不是 Block——它是附加在 text 上的格式信息。当前 Mark 在 `BlockRegistry.buildSchema()` 中硬编码。

### 未来方向：MarkDef 注册制

类似 BlockDef，每种 Mark 也应该可以注册：

```typescript
interface MarkDef {
  name: string;
  markSpec: MarkSpec;
  shortcut?: string;
  floatingToolbar?: { icon: string; label: string };
}
```

但当前阶段 Mark 数量少（9 种），硬编码在 registry 中足够。等需要动态扩展 Mark 时再引入注册制。

---

## 四、设计原则

1. **Mark 不是 Block** — Mark 附加在 text 上，不占独立位置
2. **FloatingToolbar 驱动** — Mark 操作由 Block 的 `capabilities.marks` 声明，FloatingToolbar 从中派生
3. **codeBlock 排除所有 Mark** — 代码块内不允许格式化（`marks: ''`）
4. **noteTitle 限制 Mark** — 标题只允许 bold/italic/code/link
