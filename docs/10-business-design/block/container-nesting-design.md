# Container 嵌套设计方案

> **文档类型**：架构设计
> **状态**：v2 已确认 | 更新日期：2026-04-04
> **决策**：采用纯 Container 方案，废弃 groupType

---

## 一、问题

groupType 用 TextBlock 的 attrs 模拟容器行为，有根本缺陷：

1. **无法视觉包裹**：callout 背景不能延伸到嵌套的 bullet
2. **扁平结构**：没有物理父子关系，嵌套靠 indent 模拟
3. **两套系统**：Container 节点 + groupType 变体并存，概念混乱
4. **违反基类体系**：Container 应该是独立基类，不是 TextBlock 的 attrs 变体

---

## 二、方案：纯 ContainerBlock

所有容器统一为 ContainerBlock 基类的实例，废弃 groupType。

详见基类契约：`docs/block/base/container-block.md`

```
Block（抽象基类）
  ├── TextBlock        — inline 流
  ├── RenderBlock      — 运行容器
  └── ContainerBlock   — 嵌套容器
        ├── bulletList
        ├── orderedList
        ├── taskList
        ├── blockquote
        ├── callout（已实现）
        ├── toggleList（已实现）
        ├── frameBlock（已实现）
        └── table（已实现）
```

---

## 三、嵌套示例

```
callout
  ├── textBlock "提示信息"
  ├── orderedList
  │     ├── textBlock "步骤一"
  │     ├── bulletList                ← Container 嵌套 Container
  │     │     ├── textBlock "要点 A"
  │     │     └── textBlock "要点 B"
  │     └── textBlock "步骤二"
  └── textBlock "继续提示"
```

渲染从内到外：
1. textBlock → `<p>`
2. bulletList 包裹 → `<ul>` + bullet 标记
3. orderedList 包裹 → `<ol>` + 编号标记
4. callout 包裹 → `<div class="callout">` + 背景色 + emoji

callout 的背景色**自然延伸到 orderedList 和 bulletList 的所有内容**。

---

## 四、TextBlock 瘦身

废弃 groupType 后，TextBlock 回归纯文字流：

```typescript
// 移除
groupType: string | null;        // 废弃
groupAttrs: Record<string, unknown> | null;  // 废弃

// 保留
level: 1 | 2 | 3 | null;
isTitle: boolean;
open: boolean;
indent: number;
textIndent: boolean;
align: string;
```

---

## 五、废弃清单

| 文件 | 操作 |
|------|------|
| `plugins/group-decoration.ts` | 删除（Container NodeView 自行渲染标记） |
| `plugins/group-keyboard.ts` | 删除（键盘行为移入各 Container 的 plugin） |
| `plugins/format-inherit.ts` | 简化（移除 groupType 继承） |
| `blocks/text-block.ts` | 移除 groupType/groupAttrs attrs |
| `components/SlashMenu.tsx` | 创建 Container 节点而非设置 groupType |
| `components/HandleMenu.tsx` | 转换为 Container 包裹而非设置 groupType |

---

## 六、实施阶段

### Phase 1：补全 Container 节点

新建 `bulletList`、`orderedList`、`taskList` 的 BlockDef + NodeView。
现有 Container（callout、blockquote、toggleList、frameBlock）确认 content: 'block+' 兼容。

### Phase 2：修改创建入口

SlashMenu、Markdown 快捷、HandleMenu 改为创建 Container 节点。

### Phase 3：键盘交互

Enter 分裂/退出、Tab 嵌套/提升、Backspace 退出。
统一的 Container 键盘行为（类似 enter-handler.ts 的 enterBehavior 声明）。

### Phase 4：废弃 groupType

移除 groupType 相关代码，TextBlock 瘦身，数据迁移。

---

## 七、数据迁移

旧文档中的 `textBlock { groupType: 'bullet' }` 需要迁移：

```
// 旧格式
{ type: 'textBlock', attrs: { groupType: 'bullet' }, content: [...] }
{ type: 'textBlock', attrs: { groupType: 'bullet' }, content: [...] }

// 新格式
{ type: 'bulletList', content: [
  { type: 'textBlock', content: [...] },
  { type: 'textBlock', content: [...] },
]}
```

迁移在文档加载时自动执行（类似现有的 noteTitle 迁移逻辑）。

---

*本方案已确认，按阶段实施。*
