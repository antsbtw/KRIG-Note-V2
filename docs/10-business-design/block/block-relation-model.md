# Block 统一模型 — 两个基类 + 组合容器

> **文档类型**：架构设计
> **状态**：草案 v3 | 创建日期：2026-04-03
> **前置**：`design-philosophy.md` P3/P5 原则
>
> **本文档目的**：定义 Block 系统的最终架构——两个基类、组合容器、可注册的运行环境。

---

## 一、核心思想

### 1.1 Block 只有两种基类

```
Block（基类）
  ├── TextBlock  — 内容是文字流（用户直接打字）
  └── RenderBlock — 内容是独立运行容器（注册渲染器）
```

### 1.2 容器是组合，不是嵌套

```
容器 = 一组连续的 Block，通过 groupType 在视觉上形成整体
```

### 1.3 三条不变原则

1. **回车 = 新 Block**，没有例外
2. **所有 Block 共享基类能力**（groupType、indent、align、Handle）
3. **RenderBlock 通过注册扩展**——注册什么就能跑什么

---

## 二、两个基类

### 2.1 TextBlock — 文字流

| 属性 | 说明 |
|------|------|
| 内容 | `inline*`（文字 + inline 节点） |
| 格式化 | bold / italic / underline / strike / code / link / highlight / textStyle |
| 用户交互 | 直接在里面打字 |
| 例子 | paragraph, heading, noteTitle |

```typescript
// TextBlock 就是当前的 paragraph / heading
// 内容：inline*（文字 + hardBreak + mathInline + noteLink）
// 所有文字格式化能力
```

### 2.2 RenderBlock — 运行容器

| 属性 | 说明 |
|------|------|
| 内容 | 由注册的 renderer 决定（代码、图片、视频等） |
| 格式化 | 无（内容不是文字流） |
| 用户交互 | 通过专属 UI（编辑器、上传、URL 输入等） |
| 例子 | codeBlock, image, mathBlock, video, audio, tweet |

```typescript
// RenderBlock 是一个可注册的运行容器
// 注册什么 renderer = 就能跑什么
interface RenderBlockDef {
  type: string;              // 'code' | 'image' | 'math' | 'video' | 'python' | ...
  renderer: NodeViewFactory; // 渲染器（ProseMirror NodeView）
  attrs: Record<string, AttributeSpec>;  // 专属属性
  slashMenu?: SlashMenuDef;  // SlashMenu 注册
}
```

### 2.3 共享能力（基类）

两个基类共享的 attrs 和行为：

```typescript
interface BlockBaseAttrs {
  // 排版
  indent: number;
  textIndent: boolean;
  align: 'left' | 'center' | 'right' | 'justify';

  // 组合（决定视觉容器）
  groupType: string | null;
  groupAttrs: Record<string, unknown> | null;
}
```

共享的操作：
- Handle（+ 按钮 / ⠿ 手柄 / 菜单）
- 拖拽移动
- 删除
- Block Selection（ESC 选中）
- 参与视觉容器（groupType）

---

## 三、RenderBlock 注册制

### 3.1 注册方式

```typescript
registerRenderBlock({
  type: 'code',
  renderer: codeBlockRenderer,
  attrs: { language: { default: '' } },
  slashMenu: { label: 'Code Block', icon: '</>', keywords: ['code'] },
});

registerRenderBlock({
  type: 'image',
  renderer: imageRenderer,
  attrs: { src: { default: null }, alt: { default: '' }, width: { default: null } },
  slashMenu: { label: 'Image', icon: '🖼', keywords: ['image'] },
});

registerRenderBlock({
  type: 'math',
  renderer: mathBlockRenderer,
  attrs: { latex: { default: '' } },
  slashMenu: { label: 'Math Block', icon: '∑', keywords: ['math'] },
});
```

### 3.2 当前 RenderBlock 清单

| type | 渲染器 | 用途 |
|------|--------|------|
| code | 代码编辑器 + 语言选择 + 复制 | 代码展示 |
| mermaid | 代码编辑器 + Mermaid 渲染 | 图表 |
| image | 图片展示 + 上传 + 缩放 | 图片 |
| math | LaTeX 输入 + KaTeX 渲染 | 数学公式 |
| video | URL 输入 + 播放器 | 视频 |
| audio | 文件上传 + 播放器 | 音频 |
| tweet | URL 输入 + 预览 | 社交媒体 |

### 3.3 未来可注册的 RenderBlock

| type | 渲染器 | 用途 |
|------|--------|------|
| python | 代码编辑器 + Python 运行时 + 输出 | 可执行代码 |
| jupyter | Jupyter cell（输入 + 输出） | 数据科学 |
| excalidraw | 画布 + 绘图工具 | 白板 |
| figma | Figma 嵌入 | 设计稿 |
| map | 地图渲染器 | 地理信息 |
| chart | 数据 + 图表渲染（ECharts/D3） | 数据可视化 |
| slides | 幻灯片编辑器 | 演示 |
| terminal | 终端模拟器 | 命令行 |

**注册一个新的 RenderBlock = 一个新的能力。不需要修改框架。**

---

## 四、视觉容器（groupType）

### 4.1 组合规则

相邻的、相同 `groupType` 的 Block 自动形成一组。

```
block { groupType: 'callout' }  ──┐
block { groupType: 'callout' }    ├── 一个 callout 容器
block { groupType: 'callout' }  ──┘
block { groupType: null }       → 普通段落（不在任何容器中）
block { groupType: 'quote' }    ──┐
block { groupType: 'quote' }      ├── 一个 quote 容器
block { groupType: null }       → 组断开
```

### 4.2 groupType 清单

| groupType | 视觉效果 | 首行特殊 | groupAttrs |
|-----------|----------|----------|------------|
| bullet | 每行加 `•` / `◦` / `▪`（按 indent 循环） | 无 | 无 |
| ordered | 每行加序号（按连续同 indent 计数） | 无 | 无 |
| task | 每行加 `☐` / `☑` | 无 | `{ checked: boolean }` |
| callout | 整体加背景 + 边框 + 圆角 | emoji | `{ emoji: string }` |
| quote | 整体加左侧竖线 | 无 | 无 |
| toggle | 首行加 `▾`/`▸`，其余可折叠 | 折叠箭头 | `{ open: boolean }` |
| frame | 整体加彩色左边框 | 无 | `{ color: string }` |

### 4.3 TextBlock 和 RenderBlock 都可以参与组合

```
{ groupType: 'callout', emoji: '💡' }  TextBlock  "提示文字"       → 💡 ┌ 提示文字
{ groupType: 'callout' }               RenderBlock [image]        →    │ 图片
{ groupType: 'callout' }               TextBlock  "更多说明"       →    └ 更多说明
```

---

## 五、组内位置推导

渲染层扫描上下文，推导每个 Block 在组内的位置：

```typescript
type GroupPosition = 'first' | 'middle' | 'last' | 'only';
```

| 条件 | 位置 |
|------|------|
| 上方不同 + 下方不同 | only |
| 上方不同 + 下方相同 | first |
| 上方相同 + 下方相同 | middle |
| 上方相同 + 下方不同 | last |

渲染层根据 `groupType + GroupPosition` 决定 CSS class：

```css
.group-callout.group-first  { border-top-left-radius: 6px; padding-top: 8px; }
.group-callout.group-middle { /* 只有左边框 */ }
.group-callout.group-last   { border-bottom-left-radius: 6px; padding-bottom: 8px; }
.group-callout.group-only   { border-radius: 6px; padding: 8px; }
```

---

## 六、统一键盘行为

### 6.1 Enter

```
有 groupType → 新 Block 继承 groupType + indent + groupAttrs
空行 + Enter → 清除 groupType（脱离组）
```

### 6.2 Tab / Shift-Tab

```
Tab → indent += 1（统一）
Shift-Tab → indent -= 1（最小 0）
```

### 6.3 Backspace（行首）

```
有 groupType → 清除 groupType（变普通，保留文字）
普通段落 → 与上一个 Block 合并
```

### 6.4 Markdown 输入

```
- / * + 空格   → groupType = 'bullet'
1. + 空格      → groupType = 'ordered'
[] / [ ] + 空格 → groupType = 'task', checked = false
[x] + 空格     → groupType = 'task', checked = true
> + 空格       → groupType = 'quote'
```

---

## 七、Handle 行为

**每个 Block 都有 Handle**——因为每个 Block 都是独立的。

| 操作 | 行为 |
|------|------|
| + 按钮 | 在下方创建新 Block（继承 groupType） |
| ⠿ 拖拽 | 移动单个 Block |
| ⠿ 点击 | 弹出菜单（转换成 / 格式 / 删除） |
| 拖拽组首行 | 自动选中整组一起移动 |

---

## 八、SlashMenu 行为

```
/bullet  → 设置 groupType = 'bullet'
/ordered → 设置 groupType = 'ordered'
/task    → 设置 groupType = 'task'
/callout → 设置 groupType = 'callout', groupAttrs = { emoji: '💡' }
/quote   → 设置 groupType = 'quote'
/toggle  → 设置 groupType = 'toggle', groupAttrs = { open: true }
/frame   → 设置 groupType = 'frame', groupAttrs = { color: 'blue' }
/code    → 创建 RenderBlock type='code'
/image   → 创建 RenderBlock type='image'
/math    → 创建 RenderBlock type='math'
/mermaid → 创建 RenderBlock type='code', language='mermaid'
```

TextBlock 的组合：修改当前 Block 的 attrs。
RenderBlock 的创建：替换当前 Block 为新的 RenderBlock。

---

## 九、Tab Container 升级路径

RenderBlock 未来可升级为 Tab Container（多个 renderer 并存）：

```
RenderBlock type='code'
  升级为 →
  TabContainer
    ├── Tab "代码"  → code renderer
    ├── Tab "翻译"  → translation renderer
    └── Tab "笔记"  → text editor
```

这和 P5（Tab 是阅读思考流程容器）完全一致。

---

## 十、例外

**table** 保持 ProseMirror 原生嵌套（`table > tableRow > tableCell`）。二维网格不适合展平。

**columnList** 同理——并排关系不是上下序列。

---

## 十一、迁移路径

### Phase 1：基础设施

1. Block 基类 attrs：`groupType` + `groupAttrs`
2. Group Decoration Plugin（位置推导 + CSS class + 列表符号）
3. 统一键盘行为（Enter 继承 / 空行退出 / Backspace 清除）

### Phase 2：序列型迁移

1. bullet / ordered / task 的渲染和交互
2. 删除 bulletList / orderedList / taskList / listItem / taskItem
3. 数据迁移

### Phase 3：容器型迁移

1. callout / quote / toggle / frame 的渲染和交互
2. 删除 callout / blockquote / toggleList / frameBlock
3. 数据迁移

### Phase 4：RenderBlock 注册制

1. 统一 RenderBlock 注册 API
2. 现有 RenderBlock（code/image/math/video/audio/tweet）迁移到注册制
3. 新 renderer 开发模板

---

## 十二、设计意义

**旧模型**：Block 有多种类型，Container 是 DOM 嵌套，扩展需要改框架。

**新模型**：

```
TextBlock + groupType = 文字容器（列表、引用、提示框...）
RenderBlock + renderer = 运行容器（代码、图表、视频...）
注册 = 扩展
```

- **基类操作统一**：所有 Block 共享 Handle、拖拽、组合能力
- **容器是组合结果**：不是预定义的类型，而是 Block 关联的视觉呈现
- **RenderBlock 可无限扩展**：注册新 renderer = 新能力，不修改框架
- **复杂度在注册侧**：框架简单稳定，复杂度由各 renderer 自己管理

---

*本文档为草案 v3。每一阶段实现后回顾设计决策。*
