# RenderBlock — 运行容器基类

> **文档类型**：基类契约
> **状态**：草案 v1 | 创建日期：2026-04-03
> **约束力**：所有渲染类 Block 必须遵循本文档定义
> **继承**：Block 抽象基类（见 `base-classes.md`）

---

## 一、定义

RenderBlock 是独立的 **运行容器**——内容由注册的 renderer 决定，用户通过专属 UI 交互。

```
RenderBlock = 一个可注册的运行环境
注册什么 renderer = 就能跑什么
```

图片查看器、视频播放器、甚至 Python 运行时——都是 RenderBlock 的实例。

> **注**：`content: 'text*'` + `contentDOM` 的节点（codeBlock、mathBlock）需要 ProseMirror 管理文本内容，不适合 RenderBlock 基类，作为独立 Block 实现。

---

## 二、注册接口

```typescript
interface RenderBlockDef {
  type: string;                              // 唯一标识：'image' | 'video' | 'audio' | ...
  renderer: NodeViewFactory;                 // ProseMirror NodeView 工厂函数
  attrs: Record<string, AttributeSpec>;      // 专属 attrs（加在基类 attrs 之上）
  slashMenu?: SlashMenuDef | null;           // SlashMenu 注册
}
```

### 注册方式

```typescript
registerRenderBlock({
  type: 'image',
  renderer: imageRenderer,
  attrs: { src: { default: '' }, alt: { default: '' } },
  slashMenu: { label: 'Image', icon: '🖼', keywords: ['image', '图片'] },
});
```

**注册 = 新能力。不修改框架。**

---

## 三、共享 Attrs

RenderBlock 继承基类的所有共享 attrs：

```typescript
interface RenderBlockAttrs extends BlockBaseAttrs {
  renderType: string;    // 对应注册的 type（'image' | 'video' | 'audio' | ...）
  // + 各 renderer 的专属 attrs
}
```

---

## 四、与 TextBlock 的区别

| | TextBlock | RenderBlock |
|---|---|---|
| **内容** | inline 流（文字 + inline 节点） | 由 renderer 决定 |
| **用户输入** | 直接打字 | 通过专属 UI（编辑器、上传、URL 输入等） |
| **Marks** | ✅ bold/italic/link/... | ❌ 不支持 |
| **FloatingToolbar** | ✅ 选中文字后显示 | ❌ 不显示 |
| **Markdown 输入** | ✅ 自动转换 | ❌ 不适用 |
| **回车行为** | 分裂为两个 TextBlock | 在外部创建新 TextBlock |
| **Backspace** | 合并上一行 | 删除整个 RenderBlock |
| **扩展方式** | 新增 inline 节点 / mark | 注册新 renderer |

共享的：Handle、拖拽、删除、Block Selection、groupType 组合、indent。

---

## 五、Renderer 的能力与职责

### 5.1 Renderer 必须实现

| 能力 | 说明 |
|------|------|
| **dom** | 返回外层 DOM 元素 |
| **update** | 响应 attrs 变化，更新渲染 |
| **destroy** | 清理资源（事件监听、定时器等） |
| **ignoreMutation** | 声明哪些 DOM 变化不需要 ProseMirror 处理 |

### 5.2 Renderer 可选实现

| 能力 | 说明 |
|------|------|
| **contentDOM** | 如果有可编辑子区域（如 caption） |
| **stopEvent** | 拦截键盘/鼠标事件，不传递给 ProseMirror |
| **selectNode / deselectNode** | Block 选中/取消选中的视觉反馈 |
| **自定义 Toolbar** | renderer 可以在内部创建自己的操作栏 |
| **getFullscreenContent** | 返回全屏时要显示的内容（详见 §七） |

### 5.3 Renderer 不应该做的

| 禁止 | 原因 |
|------|------|
| 覆盖 Handle 行为 | Handle 是基类能力 |
| 覆盖拖拽行为 | 拖拽是基类能力 |
| 覆盖 Block Selection | 选中是基类能力 |
| 直接修改其他 Block | 只能修改自身 attrs |

---

## 六、全屏能力（基类提供）

所有 RenderBlock 都可以全屏显示——这是**基类能力**，不需要各 renderer 独立实现。

### 6.1 架构分工

```
基类提供：
  - 全屏 overlay 框架（黑色遮罩 85% + 关闭按钮 + Escape 关闭）
  - 缩放/平移基础能力（滚轮缩放 + 拖拽平移）
  - 全屏入口（Handle 菜单 / Toolbar 按钮 / 快捷键）

Renderer 提供：
  - getFullscreenContent(): HTMLElement | null
  - 返回全屏时要显示的内容（SVG / 图片 / 视频 / 画布等）
  - 返回 null 表示不支持全屏
```

### 6.2 Renderer 接口

```typescript
interface RenderBlockRenderer {
  // ...其他必须/可选方法

  /** 返回全屏内容。返回 null = 不支持全屏。 */
  getFullscreenContent?: () => HTMLElement | null;
}
```

### 6.3 各 renderer 的全屏内容

| type | 全屏内容 | 交互 |
|------|---------|------|
| image | 原始大图 | 缩放 + 平移 |
| video | 视频播放器 | 播放控制 |
| excalidraw | 完整画布 | 画布交互 |
| chart | 完整图表 | 缩放 + 平移 |
| audio | null（不全屏） | — |
| tweet | null（不全屏） | — |

### 6.4 全屏入口

| 入口 | 说明 |
|------|------|
| Toolbar 全屏按钮（⛶） | renderer 的 Toolbar 中可选 |
| Handle 菜单 "全屏" | 基类统一提供（如果 renderer 支持） |
| 双击内容区域 | 可选（如点击 Mermaid 预览区） |

### 6.5 全屏 overlay 规范

```
┌──────────────────────────────────┐
│                          [×] ← 关闭按钮（右上角）
│                                  │
│        [全屏内容]                 │ ← 居中，可缩放/平移
│                                  │
│                                  │
└──────────────────────────────────┘
  背景：rgba(0,0,0,0.85)
  关闭：× 按钮 / Escape / 点击遮罩
  缩放：滚轮（朝光标方向）
  平移：拖拽
  缩放范围：0.2x - 5x
```

---

## 七、键盘行为

| 按键 | 条件 | 行为 |
|------|------|------|
| **Enter** | RenderBlock 被选中 | 在下方创建新 TextBlock |
| **Backspace** | RenderBlock 被选中 | 删除整个 RenderBlock |
| **Tab** | 任何 | indent += 1（整体缩进） |
| **Shift+Tab** | 任何 | indent -= 1 |
| **其他** | 在 RenderBlock 内部 | 由 renderer 的 stopEvent 决定是否拦截 |

---

## 七、Toolbar 规范

RenderBlock 可以有自己的内部 Toolbar，但须遵循：

### 7.1 通用规范

- Toolbar 默认隐藏，hover 时显示（`display: none` → `display: flex`）
- 不占据 Block 高度（隐藏时不影响布局）
- 深色背景 `#252525`，和编辑器主题一致

### 7.2 结构

```
[左侧：类型标识/设置] ──── [右侧：操作按钮]
```

- **左侧固定**：类型标识（如语言选择下拉）
- **中间可扩展**：类型专属按钮（如 Mermaid 的模式切换）
- **右侧固定**：通用操作（如复制按钮）

### 7.3 示例

```
Image：  ──────────────────── [🔄 替换]
Video：  ──────────────────── [📋 复制]
```

---

## 八、当前 RenderBlock 清单

| type | 渲染器 | 专属 attrs | Toolbar | 用途 |
|------|--------|-----------|---------|------|
| image | 图片显示 + 上传 | src, alt, width | 替换 | 图片 |
| video | URL 输入 + 播放器 | src, title, poster | — | 视频 |
| audio | 文件上传 + 播放器 | src, title, artist | — | 音频 |
| tweet | URL 输入 + 预览 | tweetUrl, author, text | — | 社交媒体 |

> **注**：code 和 math 使用 `content: 'text*'` + `contentDOM`，需要 ProseMirror 管理文本内容，
> 不适合 RenderBlock 基类的 `atom` + `attrs` 模式，因此作为独立 Block 实现。

---

## 九、未来可注册的 RenderBlock

| type | 渲染器 | 用途 |
|------|--------|------|
| python | 代码编辑 + Python 运行时 + 输出 | 可执行代码 |
| jupyter | Jupyter cell（输入 + 输出） | 数据科学 |
| excalidraw | 画布 + 绘图工具 | 白板 |
| figma | Figma 嵌入 | 设计稿 |
| map | 地图渲染器 | 地理信息 |
| chart | 数据 + 图表渲染（ECharts/D3） | 数据可视化 |
| slides | 幻灯片编辑器 | 演示 |
| terminal | 终端模拟器 | 命令行 |
| pdf | PDF 渲染器 | 文档嵌入 |
| web | iframe 嵌入 | 网页嵌入 |
| ai | AI 对话界面 | AI 交互 |

**每一个都只需要注册一个 renderer。框架零改动。**

---

## 十、升级路径：Tab Container

任何 RenderBlock 可升级为 Tab Container（P5 原则）：

```
单一 renderer：
  RenderBlock type='video'
    └── video renderer

升级为多 Tab：
  TabContainer type='video'
    ├── Tab "视频"    → video renderer
    ├── Tab "元数据"  → metadata card
    ├── Tab "字幕"    → subtitle editor（TextBlock）
    └── Tab "笔记"    → text editor（TextBlock）
```

每个 Tab 可以是另一个 renderer 或一个 TextBlock 编辑器。

升级条件：用户显式操作（不自动升级）。

---

## 十一、与知识图谱的关系

RenderBlock 是知识图谱的富媒体节点（P3 原则）：

- 每个 RenderBlock 是一个实体节点（图片、视频、公式等）
- attrs 携带语义信息（latex 是公式内容、src 是媒体地址）
- 可以被 noteLink 引用
- groupType 关联关系成为图谱的边
- Tab Container 的多个 Tab 是同一节点的不同视角

---

## 十二、开发新 RenderBlock 的检查清单

新增一个 RenderBlock 时，确认以下事项：

- [ ] 实现 `RenderBlockDef`（type + renderer + attrs + slashMenu）
- [ ] renderer 返回 `dom`（外层容器）
- [ ] renderer 实现 `update`（响应 attrs 变化）
- [ ] renderer 实现 `destroy`（清理资源）
- [ ] renderer 实现 `ignoreMutation`（声明自管理的 DOM）
- [ ] 如果有内部键盘交互，实现 `stopEvent`
- [ ] 如果有 Toolbar，遵循 Toolbar 规范（§七）
- [ ] CSS 暗色主题一致
- [ ] SlashMenu 注册
- [ ] 不覆盖基类行为（Handle、拖拽、选中）

---

*本文档为 RenderBlock 基类契约。修改需全体评审。*
*新增 renderer 只需遵循检查清单，不需要修改本文档。*
