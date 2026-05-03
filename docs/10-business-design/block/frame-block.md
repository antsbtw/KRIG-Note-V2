# frameBlock — 彩框

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

frameBlock 是带彩色边框的容器——纯视觉分组，用于强调一组内容。

```
┌─ 蓝色边框 ──────────────────┐
│ 重要内容...                  │
│ 更多内容...                  │
└─────────────────────────────┘
```

和 callout 的区别：callout 有 emoji 图标 + 提示语义，frameBlock 只有边框颜色。

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'block+',
  group: 'block',
  attrs: {
    color: { default: 'blue' },   // 边框颜色
  },
}
```

---

## 三、BlockDef

```typescript
export const frameBlockBlock: BlockDef = {
  name: 'frameBlock',
  group: 'block',
  nodeSpec: {
    content: 'block+',
    group: 'block',
    attrs: { color: { default: 'blue' } },
  },
  capabilities: {
    turnInto: ['paragraph'],
    canDelete: true,
    canDrag: true,
    canColor: true,
  },
  enterBehavior: {
    action: 'split',
    exitCondition: 'empty-enter',
  },
  containerRule: {},
  slashMenu: {
    label: 'Frame',
    icon: '▢',
    group: 'layout',
    keywords: ['frame', 'border', 'box'],
    order: 1,
  },
};
```
