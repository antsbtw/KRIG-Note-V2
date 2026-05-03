# hardBreak — 硬换行

> **类型**：Inline 节点
> **位置**：任何接受 inline 内容的 Block 内部
> **状态**：待实现

---

## 一、定义

hardBreak 是行内的强制换行——在同一个 Block 内换行，不创建新 Block。

```
这是第一行
这是第二行（同一个 paragraph 内）
```

区别于 Enter（创建新 paragraph），Shift+Enter 创建 hardBreak。

---

## 二、Schema

```typescript
nodeSpec: {
  inline: true,
  group: 'inline',
  selectable: false,
  parseDOM: [{ tag: 'br' }],
  toDOM() { return ['br']; },
}
```

---

## 三、触发方式

- **Shift+Enter** → 在当前 Block 内插入 `<br>` 换行

---

## 四、BlockDef

```typescript
export const hardBreakBlock: BlockDef = {
  name: 'hardBreak',
  group: 'inline',
  nodeSpec: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() { return ['br']; },
  },
  capabilities: {},
  slashMenu: null,
};
```

---

## 五、设计原则

1. **Shift+Enter 而非 Enter** — Enter 创建新 Block，Shift+Enter 行内换行
2. **最简的 Inline 节点** — 无 attrs、无 NodeView、无 capabilities
