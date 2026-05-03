# KRIG-Note · Help Panel 设计规范

**Design Specification · v1.0 · 2026-04-05**

---

## 一、背景与目标

KRIG-Note 编辑器中存在多个"帮助/参考面板"需求：

| 面板 | 状态 | 帮助对象 | 优先级 |
|------|------|----------|--------|
| LaTeX Formula Reference | 待实现 | 数学公式编辑（mathBlock） | P0 |
| Mermaid Templates | 待实现 | 图表代码编辑（codeBlock） | P1 |
| Dictionary / Translation | 待实现 | 英文阅读查词（学习模块） | P2 |
| Shortcut Reference | 待定 | 键盘快捷键 | P3 |

### 参考来源

本设计基于 mirro-desktop 的 `help-panel/` 框架（已验证可用），适配 KRIG-Note 的架构差异：

| | mirro-desktop | KRIG-Note |
|---|---|---|
| 编辑器 | ProseMirror（纯 PM） | ProseMirror��纯 PM） |
| Block 注册 | 多套系统（Schema + NodeView + 全局 commands） | 统一 BlockRegistry（`BlockDef` 声明式） |
| 窗口模型 | 单 WebContentsView | 多 WebContentsView（左右 Slot） |
| 面板位置 | `position: fixed; right: 0`（与编辑器同一 View） | 同左（面板在 note View 内部渲染） |

---

## 二、核心设计原则

### 2.1 分层独立：Help Panel 框架 ≠ Block 注册

Help Panel 是**独立于 BlockRegistry 的 UI 框架**。两者通过回调函数桥接，互不侵入：

```
BlockRegistry                      Help Panel 框架
─────────────                      ──────────────────
BlockDef（Schema, NodeView,        HelpPanelConfig（id, title）
          Plugin, SlashMenu）       HelpPanelShell（el, bodyEl, show/hide）

math-block NodeView                latex-panel
  enterEditMode()                    showMathPanel(insertFn)
    → showMathPanel(insertFn) ───→    createHelpPanel('latex')
                                      buildContent → tabs + items
  用户点击 Insert ←─────────────    insertFn(latex)  ← 回调执行
  exitEditMode()
    → hideMathPanel() ───────────→    hideHelpPanel('latex')
```

**原则**：
- BlockDef 接口不新增任何 help-panel 相关字段
- Help Panel 不直接操作 EditorView
- 桥接点在 NodeView 的 `enterEditMode()` / `exitEditMode()` 中

### 2.2 先看效果，再学语法（Progressive Disclosure）

所有 Help Panel 的核心教学哲学：

```
用户看到渲染效果 → 点击展开源码/释义 → 操作（插入/收藏/复制）
```

每个条目遵循三态流程：

```
COLLAPSED（默认，只显示预览）→ 点击 → EXPANDED（显示源码+操作）→ 操作 → COLLAPSED
```

### 2.3 上下文触发，自动出现

面板不需要用户手动打开。当用户进入特定编辑上下文时自动弹出：

| 进入上下文 | 面板自动打开 |
|-----------|-------------|
| 点击 mathBlock 进入编辑模式 | LaTeX Reference |
| 光标进入 Mermaid 代码块 | Mermaid Templates |
| 选中英文单词查词 | Dictionary |

退出方式统一（所有面板必须支持全部四种）：
1. 点击面板右上角 **× 关闭按钮**
2. `Esc` 键
3. 点击面板外部区域
4. 离开触发上下文（如退出 mathBlock 编辑模式）

### 2.4 同一位置，互斥显示

所有 Help Panel 占据屏幕右侧同一区域：

```
┌────────────────────────────────┬──────────┐
│                                │          │
│         编辑器主区域             │  Help    │
│                                │  Panel   │
│                                │  360px   │
��                                │          │
└───────────��────────────────────┴──��───────┘
```

**严格互斥**：同一时刻只允许一个 Help Panel 可见。新面板打开时旧面板自动关闭。

### 2.5 数据与视图分离

```
数据文件（latex-data.ts / mermaid-data.ts）   ← 定义分类 + 模板
         ↓
面板模块（latex-panel.ts / mermaid-panel.ts）  ← 填充 Shell body，渲染内容
         ↓
核心框架（help-panel-core.ts）                 ← 通用 Shell + 互斥 + 关闭行为
         ↓
集成点（NodeView enterEditMode）               ← 调用 show/hide
```

---

## 三、通用 DOM 结构

所有 Help Panel 共享同一 DOM 骨架：

```html
<div class="help-panel" data-panel-id="{panelId}" style="display:none">
  <!-- 标题栏（core 构建） -->
  <div class="help-panel__header">
    <span class="help-panel__title">{标���}</span>
    <button class="help-panel__close-btn">×</button>
  </div>

  <!-- Body（core 提供空容器，各面板自行填充） -->
  <div class="help-panel__body">
    <!-- Tab 栏（各面板自行构建） -->
    <div class="help-panel__tabs">
      <button class="help-panel__tab help-panel__tab--active" data-cat="{id}">
        {分类名}
      </button>
    </div>

    <!-- 内容区（可滚动） -->
    <div class="help-panel__content">
      <div class="help-panel__cat-panel" data-cat="{id}">
        <div class="help-panel__item">
          <div class="help-panel__preview">{渲染预览}</div>
          <div class="help-panel__detail" style="display:none">
            <code class="help-panel__code">{源码}</code>
            <button class="help-panel__action-btn">{操作}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### DOM 定制范围

| 组件 | core 负责（固定） | 面板模块负责（可定制） |
|------|------|--------|
| 面板容器 | 位置、尺寸、背景、display 切换 | `data-panel-id` |
| 标题栏 | 布局、关闭按钮、互斥逻辑 | 标题文字 |
| Body | 提供空容器 | 全部内容（Tab、条目、渲染方式） |

---

## 四、注册模式

### 4.1 核心面板注册（LaTeX、Mermaid）

框架管理 DOM、缓存、互斥。面板模块负责填充内容：

```typescript
// latex-panel.ts
import { createHelpPanel, showHelpPanel, hideHelpPanel } from '../help-panel-core';

let shell: HelpPanelShell | null = null;
let contentBuilt = false;

export function showMathPanel(insertFn: (latex: string) => void): void {
  currentInsertFn = insertFn;

  if (!shell) {
    shell = createHelpPanel({
      id: 'latex',
      title: 'Formula Reference',
      excludeFromClickOutside: ['.math-block-wrapper'],
    });
  }

  if (!contentBuilt) {
    buildContent(shell);     // 面板自行构建 tabs + items
    contentBuilt = true;
  }

  showHelpPanel('latex');    // 触发互斥 + 显示
}

export function hideMathPanel(): void {
  hideHelpPanel('latex');
}
```

### 4.2 外部面板注册（Dictionary 等学习模块）

自建 DOM 但参与互斥的面板：

```typescript
// dictionary-panel.ts（未来学习模块）
import {
  registerExternalPanel,
  notifyExternalShow,
  notifyExternalHide,
} from '../help-panel/help-panel-core';

// 注册：只提供 hide 回调，参与互斥
registerExternalPanel('dictionary', () => hideDictionaryPanel());

// 显示时通知 core（会自动关闭其他面板）
notifyExternalShow('dictionary');

// 隐藏时通知 core
notifyExternalHide('dictionary');
```

### 4.3 为什么两种注册模式？

| | 核心面板 | 外部面板 |
|---|---|---|
| DOM 谁管 | core 创建 Shell，面板填充 body | 面板完全自建 DOM |
| 互斥 | core 自动管理 | 通过 notify API 参与 |
| 缓存 | core 缓存 Shell，复用 | 面板自行管理 |
| 适用场景 | Tab + 条目展开/折叠的标准面板 | 布局差异大的面板（如 Dictionary 有搜索框、生词本 Tab） |

---

## 五、API 契约

### 5.1 框架 Core API

```typescript
// help-panel-core.ts

/** 创建面板 Shell（缓存复用），不显示 */
export function createHelpPanel(config: HelpPanelConfig): HelpPanelShell;

/** 显示面板（触发互斥） */
export function showHelpPanel(id: string): void;

/** 隐藏面板 */
export function hideHelpPanel(id?: string): void;

/** 当前活跃面板 ID */
export function activeHelpPanelId(): string | null;

/** 外部面板注册/注销 */
export function registerExternalPanel(id: string, hideFn: () => void): void;
export function unregisterExternalPanel(id: string): void;

/** 外部面板通知 */
export function notifyExternalShow(id: string): void;
export function notifyExternalHide(id: string): void;
```

### 5.2 类型定义

```typescript
// help-panel-types.ts

interface HelpPanelConfig {
  id: string;                          // 面板唯一标识
  title: string;                       // 标题栏文字
  excludeFromClickOutside?: string[];  // 点击不触发关闭的 CSS 选择器
}

interface HelpPanelShell {
  el: HTMLElement;        // 根 .help-panel 元素
  headerEl: HTMLElement;  // 标题栏
  bodyEl: HTMLElement;    // 空 body 容器（面板自行填充）
  show(): void;
  hide(): void;
  destroy(): void;
}
```

### 5.3 各面板对外 API

统一签名模式：

```typescript
// LaTeX
export function showMathPanel(insertFn: (latex: string) => void): void;
export function hideMathPanel(): void;

// Mermaid
export function showMermaidPanel(insertFn: (code: string) => void): void;
export function hideMermaidPanel(): void;

// Dictionary（外部面板，无 insertFn）
export function showDictionaryPanel(word: string, sentence?: string): void;
export function hideDictionaryPanel(): void;
```

**核心约定**：
1. 面板不知道编辑器 — 只通过 callback 通信
2. 调用方（NodeView）负责在正确时机 show/hide
3. 严格互斥 — show 内部自动关闭其他面板

---

## 六、数据模型

### 6.1 LaTeX 数据

```typescript
// latex-data.ts

interface MathTemplate {
  label: string;           // LaTeX（用于 KaTeX 渲染预览）
  latex: string;           // 插入的 LaTeX 文本
  cursorOffset?: number;   // 插入后光标偏移
}

interface MathCategory {
  id: string;
  name: string;
  icon: string;
  templates: MathTemplate[];
}

export const MATH_CATEGORIES: MathCategory[];
```

分类列表（与 mirro-desktop 一致）：

| 分类 | 内容 |
|------|------|
| Fraction | `\frac`, `\dfrac`, `\binom` 等 |
| Script | 上下标、`\sqrt`, `\hat`, `\vec` 等 |
| Radical | 各种根号 |
| Integral | `\int`, `\iint`, `\oint` 等 |
| Large Op | `\sum`, `\prod`, `\bigcup` 等 |
| Bracket | `\left(`, `\langle`, `\lfloor` 等 |
| Function | `\sin`, `\log`, `\lim` 等 |
| Accent | `\hat`, `\overline`, `\overbrace` 等 |
| Limit | `\lim`, `\limsup`, `\sup` 等 |
| Matrix | `pmatrix`, `bmatrix`, `cases`, `aligned` |
| Greek | 希腊字母（大小写） |
| Operators | 运算符（算术、集合、逻辑） |
| Relations | 关系符（等式、不等式、集合关系） |
| Arrows | 箭头符号 |
| Misc | 量词、微积分、点号、几何等 |
| Letters | `\mathcal`, `\mathbb`, `\mathfrak`, `\text` 等 |

### 6.2 Mermaid 数据（P1）

```typescript
interface MermaidTemplate {
  label: string;       // 模板名称
  preview: string;     // 用于 SVG 渲染的简化源码
  code: string;        // 插入的完整代码
}

interface MermaidCategory {
  id: string;
  name: string;
  templates: MermaidTemplate[];
}
```

---

## 七、视觉规范

### 7.1 CSS 变量

```css
:root {
  --help-panel-width: 360px;
  --help-panel-top: 0;
  --help-panel-bg: #1e1e1e;
  --help-panel-header-bg: #252525;
  --help-panel-border: #3c3c3c;
  --help-panel-text: #e8eaed;
  --help-panel-text-secondary: #9aa0a6;
  --help-panel-accent: #8ab4f8;
  --help-panel-accent-bg: rgba(138, 180, 248, 0.15);
  --help-panel-accent-border: rgba(138, 180, 248, 0.3);
  --help-panel-code-color: #f48fb1;
  --help-panel-z: 50;
  --help-panel-font: -apple-system, BlinkMacSystemFont, sans-serif;
  --help-panel-mono: 'SF Mono', 'Fira Code', monospace;
}
```

### 7.2 共享基础类

| 类名 | 用途 |
|------|------|
| `.help-panel` | 面板容器（fixed 定位，右侧 360px） |
| `.help-panel__header` | 标题栏（标题 + 关闭按钮） |
| `.help-panel__body` | Body 容器（flex column） |
| `.help-panel__tabs` | Tab 栏（flex-wrap，≤8 换行，>8 滚动） |
| `.help-panel__tab` / `--active` | Tab 按钮 |
| `.help-panel__content` | 滚动内容区 |
| `.help-panel__item` / `--expanded` | 可展开条目卡��� |
| `.help-panel__preview` | 预览区（默认可见） |
| `.help-panel__detail` | 详情区（展开后可见） |
| `.help-panel__code` | 源码显示 |
| `.help-panel__action-btn` | 操作按钮（Insert 等） |

### 7.3 面板特化样式

通过 `data-panel-id` 作用域隔离：

```css
/* LaTeX：KaTeX 渲染调整 */
.help-panel[data-panel-id="latex"] .help-panel__preview .katex {
  font-size: 1em;
  color: var(--help-panel-text);
}

/* Mermaid：SVG 缩略图 */
.help-panel[data-panel-id="mermaid"] .help-panel__preview svg {
  max-width: 100%;
  max-height: 140px;
}
```

---

## 八、文件结构

```
src/plugins/note/
├── help-panel/                      ← Help Panel 框架（独立于 BlockRegistry）
│   ├── index.ts                     ← 公共 API 统一导出
│   ├── help-panel-core.ts           ← Shell 创建、缓存、互斥、全局关闭监听
│   ├── help-panel-types.ts          ← HelpPanelConfig, HelpPanelShell
│   ├── help-panel.css               ← 统一 CSS 框架（变量 + 共享类 + 面板特化）
│   │
│   ├── latex/                       ← LaTeX 公式参考面板
│   │   ├── index.ts                 ← showMathPanel / hideMathPanel
│   │   ├── latex-panel.ts           ← buildContent + 渲染逻��
│   │   └── latex-data.ts            ← MATH_CATEGORIES 数据
│   │
│   └── mermaid/                     ← Mermaid 模板面板（P1）
│       ├── index.ts
│       ├── mermaid-panel.ts
│       └─��� mermaid-data.ts
│
├── blocks/
│   ├── math-block.ts                ← 修改：enterEditMode → showMathPanel(insertFn)
│   └── code-block.ts                ← 修改：Mermaid 模式 → showMermaidPanel(insertFn)
│
└── registry.ts                      ← 不修改
```

学习模块（未来独立插件）：
```
src/plugins/learning/                ← P2：独立插件目录
└── dictionary-panel.ts              ← 使用 registerExternalPanel() 参与互斥
```

---

## 九、集成点：math-block 改造

当前 [math-block.ts](src/plugins/note/blocks/math-block.ts) 的 `enterEditMode()` 只管编辑态切换。改造后增加面板联动：

```typescript
// math-block.ts — enterEditMode 增加的逻辑

function enterEditMode() {
  // ... 现有编辑态切换 ...

  // 打开 LaTeX 参考面板，传入插入回调
  showMathPanel((latex: string) => {
    // 在当前 mathBlock 的 contentDOM 光标位置插入 LaTeX 文本
    const pos = getPos();
    if (pos == null) return;
    const { state } = view;
    const tr = state.tr.insertText(latex, state.selection.from);
    view.dispatch(tr);
    view.focus();
  });
}

function exitEditMode() {
  // ... 现有退出逻辑 ...
  hideMathPanel();
}
```

---

## 十、互斥机制详解

```
状态机：activePanelId: string | null

showHelpPanel('latex')
  → activePanelId === 'mermaid'? → hideHelpPanel('mermaid') → 隐藏 mermaid Shell
  → 显示 latex Shell
  → activePanelId = 'latex'

notifyExternalShow('dictionary')
  → activePanelId === 'latex'? → hideHelpPanel('latex') → 隐藏 latex Shell
  → activePanelId = 'dictionary'

hideHelpPanel()
  → 隐藏 activePanelId 对应的 Shell（或调用外部面板的 hideFn）
  ��� activePanelId = null
```

全局监听（安装一次）：
- `keydown Esc` → 如果 activePanelId 是 core 面板 → hideHelpPanel
- `mousedown` outside → 如果点击不在面板内 且 不在 excludeFromClickOutside 内 → hideHelpPanel

---

## 十一、实施计划

### P0：Help Panel 框架 + LaTeX 面板

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `help-panel/help-panel-types.ts` | 类型定义 |
| 2 | `help-panel/help-panel-core.ts` | Shell 创建、缓存、互斥、全局监听 |
| 3 | `help-panel/help-panel.css` | CSS 变量 + 共享类 |
| 4 | `help-panel/index.ts` | 公共 API 导出 |
| 5 | `help-panel/latex/latex-data.ts` | 数据（从 mirro-desktop 移植） |
| 6 | `help-panel/latex/latex-panel.ts` | buildContent + show/hide |
| 7 | `help-panel/latex/index.ts` | 导出 |
| 8 | `blocks/math-block.ts` | enterEditMode → showMathPanel |

### P1：Mermaid 面板

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `help-panel/mermaid/mermaid-data.ts` | 模板数据 |
| 2 | `help-panel/mermaid/mermaid-panel.ts` | buildContent + show/hide |
| 3 | `help-panel/mermaid/index.ts` | 导出 |
| 4 | `blocks/code-block.ts` | Mermaid 模式 → showMermaidPanel |

### P2：学习模块（Dictionary）

外部面板模式，独立插件目录，通过 `registerExternalPanel` 参与互斥。

---

## 十二、新增 Help Panel 检查清单

- [ ] **分层检查**：不修改 BlockDef 接口、不修改 BlockRegistry
- [ ] **使用 core API**：`createHelpPanel` 或 `registerExternalPanel`
- [ ] **API 签名**：`show{Name}Panel(callback)` / `hide{Name}Panel()`
- [ ] **互斥**：show 内部自动关闭其他面板
- [ ] **关闭行为完整**：× 按钮 + Esc + 点击外部 + 离开上下文（四种）
- [ ] **CSS 变量**：使用 `--help-panel-*` token
- [ ] **面板特化**：通过 `data-panel-id` 作用域隔离
- [ ] **Tab 溢出**：≤ 8 wrap，> 8 横向滚动
- [ ] **Progressive Disclosure**：预览 → 展开源码 → 操作
- [ ] **数据分离**：数据文件独立于渲染逻辑

---

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2026-04-05 | 初始版本：基于 mirro-desktop help-panel 框架，适配 KRIG-Note BlockRegistry 架构 |
