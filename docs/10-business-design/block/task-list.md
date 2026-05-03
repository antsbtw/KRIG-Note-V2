# taskList — 任务列表

> **类型**：ContainerBlock（见 `base/container-block.md`）
> **位置**：文档中任意位置
> **状态**：待实现

---

## 一、定义

taskList 是任务列表容器——每个列表项带有勾选框，用于追踪待办事项。

```
☐ 未完成的任务
☑ 已完成的任务
☐ 另一个待办
```

### taskList vs bulletList

| 维度 | bulletList | taskList |
|------|-----------|---------|
| 标记 | • ◦ ▪ | ☐ / ☑ |
| 子节点 | listItem | taskItem |
| 交互 | 纯文本列表 | 点击勾选框切换状态 |
| 互转 | → taskList（保留内容，加勾选框） | → bulletList（保留内容，去勾选框） |

---

## 二、Schema

```typescript
nodeSpec: {
  content: 'taskItem+',
  group: 'block',
}
```

---

## 三、Capabilities

```typescript
capabilities: {
  turnInto: ['paragraph', 'bulletList'],
  canDelete: true,
  canDrag: true,
}
```

---

## 四、EnterBehavior

无声明——由 taskItem 的 enterBehavior 控制。

---

## 五、SlashMenu

```typescript
slashMenu: {
  label: 'Task List',
  icon: '☐',
  group: 'basic',
  keywords: ['task', 'todo', 'checkbox', 'checklist'],
  order: 7,
}
```

### Markdown 快捷输入

`[] ` 或 `[ ] ` + 空格 → 创建 taskList。

---

## 六、与 bulletList 的互转

taskList ↔ bulletList 直接互转，保留所有内容：
- taskList → bulletList：taskItem 变 listItem，丢失 checked 状态
- bulletList → taskList：listItem 变 taskItem，默认 checked=false

---

## 七、BlockDef

```typescript
export const taskListBlock: BlockDef = {
  name: 'taskList',
  group: 'block',
  nodeSpec: {
    content: 'taskItem+',
    group: 'block',
  },
  capabilities: {
    turnInto: ['paragraph', 'bulletList'],
    canDelete: true,
    canDrag: true,
  },
  containerRule: {},
  slashMenu: {
    label: 'Task List',
    icon: '☐',
    group: 'basic',
    keywords: ['task', 'todo', 'checkbox', 'checklist'],
    order: 7,
  },
};
```
