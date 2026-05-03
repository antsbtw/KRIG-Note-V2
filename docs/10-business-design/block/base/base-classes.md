# Block 基类定义

> **文档类型**：架构契约索引
> **状态**：v2 | 更新日期：2026-04-04
>
> **本文档目的**：定义 Block 继承体系和共享能力。三个基类的详细契约见独立文档。

---

## 一、继承体系

```
Block（抽象基类）
  ├── TextBlock        — inline 流（文字 + inline 节点混排）
  │     详细契约：text-block.md
  │
  ├── RenderBlock      — 独立运行容器（注册渲染器）
  │     详细契约：render-block.md
  │
  └── ContainerBlock   — 嵌套容器（包裹子 Block）
        详细契约：container-block.md
        ├── bulletList     — 无序列表
        ├── orderedList    — 有序列表
        ├── taskList       — 任务列表
        ├── blockquote     — 引用
        ├── callout        — 提示框
        ├── toggleList     — 折叠列表
        ├── frameBlock     — 彩框
        └── table          — 表格（特殊 Container）
```

所有具体 Block 必须继承其中一个基类，不允许跳过基类直接实现。

---

## 二、三基类对比

| | TextBlock | RenderBlock | ContainerBlock |
|---|---|---|---|
| **内容** | inline 流（文字混排） | renderer 决定 | 子 Block 组织 |
| **content** | `inline*` | 由 renderer 决定 | `block+` |
| **用户输入** | 直接打字 | 专属 UI | 在子 Block 中操作 |
| **嵌套** | 不嵌套 | 不嵌套 | ✅ 可嵌套任何 Block |
| **Marks** | ✅ bold/italic/... | ❌ | ❌（在子 TextBlock 上） |
| **视觉装饰** | 文字格式化 | toolbar + 渲染区 | 背景/边框/标记符号 |
| **扩展方式** | 新增 inline/mark | 注册 renderer | 创建新 Container |
| **回车** | 分裂 TextBlock | 在外部创建 TextBlock | 在 Container 内分裂 |

---

## 三、Block 抽象基类：共享 Attrs

所有 Block（无论哪个基类）共享以下 attrs：

```typescript
interface BlockBaseAttrs {
  indent: number;                // 缩进级别（0-8），Tab/Shift-Tab
  textIndent: boolean;           // 首行缩进（CSS text-indent: 2em）
  align: 'left' | 'center' | 'right' | 'justify';  // 文本对齐
}
```

---

## 四、Block 抽象基类：共享操作

| 操作 | 入口 | 行为 |
|------|------|------|
| Handle 显示 | 鼠标靠近 Block | 显示 + 和 ⠿ 按钮 |
| + 新建 | Handle + 按钮 | 在下方创建同类 Block |
| 拖拽移动 | Handle ⠿ 拖拽 | 移动 Block 位置 |
| 菜单 | Handle ⠿ 点击 | 弹出操作菜单 |
| 删除 | HandleMenu / ContextMenu / Backspace | 删除 Block |
| Block Selection | ESC | 选中当前 Block |
| 多选 | Shift+↑↓ / Shift+点击 | 扩展选中范围 |
| 复制/剪切 | Cmd+C/X（选中状态） | Block 级操作 |
| 粘贴 | Cmd+V | Block 级粘贴 |
| Undo/Redo | Cmd+Z / Cmd+Shift+Z | 撤销/重做 |
| 缩进 | Tab / Shift+Tab | indent ±1 |

---

## 五、约束

1. **必须继承基类**——不允许绕过基类直接创建 Block 类型
2. **基类行为不可覆盖**——Handle、拖拽、删除、选中等操作，子类不能修改
3. **扩展在子类侧**——TextBlock 通过 inline 节点/mark 扩展，RenderBlock 通过注册 renderer 扩展，ContainerBlock 通过定义 content 表达式和 NodeView 装饰扩展
4. **回车 = 新 Block**——没有例外
5. **Container 整体移动**——Container 拖动时容器 + 全部子节点一起移动，不可拆解

---

## 六、详细契约

- **TextBlock**：`text-block.md` — inline 流、marks、level、键盘行为、FloatingToolbar
- **RenderBlock**：`render-block.md` — 注册制、renderer 接口、Toolbar 规范、升级路径
- **ContainerBlock**：`container-block.md` — 嵌套容器、子节点标记、渲染从内到外、Enter 退出

---

*修改基类行为需要全体评审。*
