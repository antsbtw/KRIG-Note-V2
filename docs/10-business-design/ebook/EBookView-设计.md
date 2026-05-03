# EBookView 设计

> 状态：Batch 1 已实现，Batch 2+ 设计中
> 独立于 mirro-desktop，从电子书阅读器的本质出发设计 KRIG Note 的阅读能力。
>
> **命名**：统一使用 eBook。用户视角是一个"书架 + 阅读器"，内部根据文件格式分发渲染引擎。
> **ViewType**: `'ebook'`，**WorkMode**: `{ id: 'demo-b', viewType: 'ebook', icon: '📕', label: 'eBook' }`

---

## 一、eBook 文件存储

### 1.1 核心问题：KRIG 管理的是什么？

KRIG 管理的是**用户和电子书之间的阅读关系**：
- 这本书在哪里
- 读到哪里了（阅读进度）
- 标注了什么（高亮、书签、批注、Thought）
- 什么时候读的（时间线）

随着使用深入，用户在电子书上积累的思考投入（高亮、Thought、知识图谱关联）会越来越多。**文件的不可丢失性与用户的思考投入成正比**。因此 KRIG 提供两种存储模式，让用户根据投入程度自行选择。

### 1.2 两种存储模式

#### 模式 A：引用模式（Link）

KRIG 只记录文件路径，不复制文件。适合临时阅读、已有自己文件管理体系的用户。

```
用户文件系统                      KRIG 存储
┌──────────────────────┐         ┌────────────────────────┐
│ ~/Documents/          │         │ bookshelf.json         │
│   机器学习.pdf        │←─引用──│   storage: 'link'      │
│                       │         │   filePath: '/Users/...'│
│ /Volumes/外接硬盘/     │         │                        │
│   教材.pdf            │←─引用──│                        │
└──────────────────────┘         └────────────────────────┘
```

- **文件生命周期**：用户自己管理，KRIG 不碰
- **风险**：用户误删/移动文件 → 标注数据变成"孤儿"
- **空间成本**：零

#### 模式 B：托管模式（Managed）

KRIG 将文件复制到自己的 library 目录下，完整管理文件生命周期。适合长期研读、重度标注的文档。

```
KRIG Library（应用管理）
┌──────────────────────────────────────────┐
│ {userData}/krig-note/ebook/library/       │
│   {id}.pdf              ← KRIG 管理的副本 │
│   {id}.epub                              │
│                                          │
│ bookshelf.json                           │
│   storage: 'managed'                     │
│   filePath: '{library}/{id}.pdf'         │
└──────────────────────────────────────────┘
```

- **文件生命周期**：KRIG 管理。从书架删除时询问"是否同时删除 PDF 文件？"
- **风险**：低。文件在 KRIG 控制下，用户不会误删
- **空间成本**：复制一份（PDF 通常几 MB~几十 MB，可接受）

#### 模式对比

| | 引用模式（Link） | 托管模式（Managed） |
|---|---|---|
| **导入行为** | 记录路径 | 复制文件到 library |
| **文件所有权** | 用户 | KRIG |
| **抗误删** | 低 | 高 |
| **磁盘成本** | 零 | 一份副本 |
| **适合场景** | 临时阅读、浏览型使用 | 长期研读、重度标注 |
| **默认** | — | ✅ 推荐默认 |

#### 导入时的选择

NavSide "+ 导入" 时，默认使用**托管模式**（复制到 library）。用户可在导入对话框中切换为"链接原文件（不复制）"。

**为什么默认托管？** KRIG 的定位是"阅读 + 思考"工具。用户导入 PDF 到 KRIG，通常意味着要认真阅读和标注。默认保护文件安全，符合 P1 原则（组织思考）——思考的载体不应该因为文件系统操作而丢失。

#### 模式切换

- **Link → Managed**：随时可以。KRIG 将文件复制到 library，更新 filePath，无感完成
- **Managed → Link**：用户选择"导出原文件到..."，选择目标目录 → KRIG 移动文件 → 更新为引用模式

### 1.3 标注数据存储

无论哪种模式，标注数据始终存储在 KRIG 自己的目录中，**不修改原 PDF 文件**：

```
{userData}/krig-note/ebook/
  bookshelf.json              ← 书架数据（所有条目）
  library/                    ← 托管模式的文件存储
    {id}.pdf                  ← 扁平化存储
  annotations/
    {bookId}.json             ← 按书架条目 ID 索引的标注数据
```

标注按书架条目 ID（不是 filePath）索引。这意味着：
- 引用模式下，重新定位文件后标注不丢失
- 托管模式下，KRIG 完全控制文件和标注的生命周期

Phase 1 用 JSON 文件，Phase 2 迁移到 SurrealDB。

### 1.4 文件名与显示名

书架条目有两层名称：

| | 说明 | 来源 |
|---|---|---|
| **物理文件名** | 文件系统中的实际文件名 | 导入时从 filePath 提取 |
| **显示名（displayName）** | 用户在书架中看到的名称 | 默认 = 物理文件名，用户可随时修改 |

#### 两种模式下的行为

**托管模式**：物理文件名固定为 `source.pdf`（在 `{id}/` 目录下），用户永远不会直接接触它。用户只操作显示名，改名 = 改 `displayName` 字段，零风险。

**引用模式**：物理文件名由用户在 Finder 中管理。如果用户在 Finder 中重命名了 PDF 文件：
- `filePath` 失效 → 等同于"文件不存在"，走 §1.5 的处理流程
- 显示名不受影响（独立存储）

#### 书架重命名操作

用户在 NavSide 书架中右键 → "重命名"，修改的是 `displayName`，不影响物理文件。

```typescript
interface PDFBookEntry {
  fileName: string;       // 物理文件名（导入时记录，信息参考）
  displayName: string;    // 显示名（用户可编辑，书架/Toolbar 中显示此名称）
  // ...
}
```

导入时：`displayName` 默认设为 `fileName`（去掉 `.pdf` 后缀）。例如 `paper_v3_final.pdf` → 显示名 `paper_v3_final`，用户可以改为"注意力机制论文"。

### 1.5 文件不存在的处理（仅引用模式）

托管模式下文件在 KRIG 控制中，不存在此问题。引用模式下：

| 状态 | 检测时机 | 用户看到的 | 可执行操作 |
|------|----------|-----------|-----------|
| 文件存在 | 正常 | 正常显示 | 打开、阅读 |
| 文件不存在 | 打开时检测 | 灰色条目 + ⚠️ "文件未找到" | 重新定位、转为托管模式、从书架移除 |

- **重新定位**：弹出文件选择对话框 → 选择新位置 → 更新 filePath，标注不丢失
- **转为托管模式**：如果用户找到了文件，可以选择"导入到 KRIG 管理"，以后不再依赖外部路径
- **启动时不批量检测**：外接硬盘未连接不代表文件丢失，延迟到打开时检测

### 1.5 书架数据模型

```typescript
interface EBookEntry {
  id: string;                    // 唯一 ID（UUID）
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';  // 文件格式（决定渲染引擎）
  storage: 'link' | 'managed';  // 存储模式
  filePath: string;              // link: 用户目录绝对路径; managed: library 内部路径
  originalPath?: string;         // managed 模式下保留原始导入路径（信息参考）
  fileName: string;              // 物理文件名（导入时记录，不随用户改名变化）
  displayName: string;           // 显示名（用户可编辑，书架和 Toolbar 中显示此名称）
  fileHash?: string;             // 文件内容 hash（用于去重和重定位）
  pageCount?: number;            // 总页数（EPUB 可能无固定页数，可选）
  addedAt: number;               // 导入时间
  lastOpenedAt: number;          // 最后打开时间
  lastPosition?: BookPosition;   // 上次阅读位置（格式相关）
}
```

---

## 二、EBookToolbar 能力设计

### 2.1 设计原则

Toolbar 是 EBookView 的操作入口，遵循 `view.md` 的定义：Toolbar 属于 View 自己，框架不管理其内容。

**参考对象**：macOS Preview、PDF Expert、Sioyek
**KRIG 特色**：为"阅读 + 思考"场景优化，不是通用 PDF 编辑器

### 2.2 Toolbar 区域布局

```
┌────────────────────────────────────────────────────────────────────┐
│ [侧栏] │ 文件名.pdf              ‹ [3] of 42 ›  │ − [100%▾] + │ [更多] │
│  Left   │      Left Info            Center Nav     │  Right Zoom │ Right  │
└────────────────────────────────────────────────────────────────────┘
```

### 2.3 功能清单（按区域）

#### Left 区域

| 功能 | 说明 | Batch |
|------|------|-------|
| 侧栏切换 | 展开/收起左侧面板（目录/缩略图/书签） | 3 |
| 文件名显示 | 当前 PDF 文件名（溢出省略） | 1 |

#### Center 区域（导航）

| 功能 | 说明 | Batch |
|------|------|-------|
| 上一页 / 下一页 | ‹ › 按钮 | 1 |
| 页码输入 | 点击可输入页码跳转 | 1 |
| 总页数显示 | "of 42" | 1 |
| 搜索按钮 | 🔍 打开搜索栏（Cmd+F） | 3 |

#### Right 区域（视图控制）

| 功能 | 说明 | Batch |
|------|------|-------|
| 缩小 / 放大 | − + 按钮 | 1 |
| 缩放下拉 | 预设值 + 适应宽度 + 适应页面 | 1 |
| 标注模式 | 切换：线框标注 / 横线标注 / 关闭 | 2 |
| 显示模式 | 连续滚动 / 单页 / 双页 | 3 |
| 旋转 | 顺时针 90° 旋转 | 3 |
| 更多菜单 | 文件信息、打印、导出... | 4+ |

### 2.4 Toolbar 不包含的功能

以下功能**不在 Toolbar 上**，有其他入口：

| 功能 | 入口 | 原因 |
|------|------|------|
| 打开 PDF | NavSide 书架 / Cmd+O | 文件管理不是 View 的职责 |
| 标注颜色选择 | 标注完成后的浮动工具栏 | 上下文操作，不是全局工具 |
| 书签添加 | Cmd+D 或右键菜单 | 快捷键触发更快 |
| Thought 创建 | 标注后的浮动工具栏 | 绑定到具体标注 |

### 2.5 侧栏面板（Batch 3+）

Toolbar 左侧的侧栏按钮控制 EBookView 内部的左侧面板（不是 NavSide）：

```
┌─ 侧栏 ──┬─ Toolbar ──────────────────────┐
│ [目录]   │                                │
│ [缩略图] │                                │
│ [书签]   │        PDF 内容                │
│          │                                │
│ ► Ch.1   │                                │
│   ► 1.1  │                                │
│   ► 1.2  │                                │
│ ► Ch.2   │                                │
└──────────┴────────────────────────────────┘
```

| 面板 | 内容 | Batch |
|------|------|-------|
| 目录 | PDF 原生 outline/bookmark tree | 3 |
| 缩略图 | 所有页面的虚拟缩略图 | 3 |
| 书签 | 用户添加的页面书签 | 3 |
| 批注 | 所有高亮/批注列表 | 4 |

---

## 三、EBookView 完整能力矩阵

按 KRIG Note 的定位（阅读 + 思考工具，不是 PDF 编辑器），梳理所有能力和批次规划。

### 3.1 Batch 1：基础阅读（P0）

最小可用 PDF 阅读器。用户能打开、阅读、导航。

| 能力 | 说明 |
|------|------|
| **页面渲染** | Canvas 渲染，HiDPI 支持 |
| **连续滚动** | 默认模式，所有页面连续排列 |
| **虚拟化渲染** | 只渲染可见页 ± buffer，支持大 PDF |
| **页码导航** | 上一页/下一页/输入页码跳转 |
| **缩放** | 预设（50%-200%）+ 步进 + Cmd+滚轮 + 键盘快捷键 |
| **适应宽度** | 自动计算 scale 使页面宽度适应容器 |
| **空状态** | 引导文字："在左侧书架中选择电子书" |

### 3.2 Batch 2：空间标注（核心能力）

KRIG 的标注以**空间标注**为核心，不依赖 text layer 质量。适用于所有固定页面格式（PDF、DjVu、CBZ）。

#### 空间标注 = 坐标 + OCR + 截图

```
用户框选区域（线框或横线）
  → 记录坐标（pageNum, rect）
  → OCR 识别区域文字（平台 OCR）
  → 生成区域截图缩略图
  → 标注 = {
      空间坐标,        ← 精确定位：第几页、什么位置
      OCR 文本,        ← 可搜索、可引用、可关联
      区域截图,        ← 视觉预览
      颜色 / 类型,     ← 用户分类
    }
```

#### 两种标注形式

| 形式 | 交互 | 适合标注 |
|------|------|---------|
| **线框（Rectangle）** | 拖拽画矩形框 | 图表、公式、表格、段落、任意区域 |
| **横线（Underline）** | 在行间拖拽画线 | 单行或连续几行文字 |

#### 与传统文本高亮的关系

| | 传统文本高亮 | KRIG 空间标注 |
|---|---|---|
| 依赖 | text layer（PDF 质量决定） | 页面坐标（与 PDF 质量无关） |
| 适用范围 | 仅排版良好的纯文本 | 文本、图表、公式、表格、扫描件 |
| 文本内容 | 从 text layer 提取 | OCR 识别（更可靠，适用更广） |
| 定位信息 | 字符偏移量（脆弱） | 空间坐标（稳定） |

传统文本高亮是空间标注的一个退化特例（恰好选中的是排版良好的纯文本区域）。

#### 标注交互流程

```
1. 用户在 Toolbar 选择标注模式（线框 / 横线）
2. 光标变为十字准星
3. 用户在页面上拖拽画出区域
4. 松开鼠标 → 弹出浮动工具栏：
   ┌──────────────────────────────┐
   │ 🟡 🟢 🔵 🟣 🔴 │ 💭 Thought │ ✕ │
   └──────────────────────────────┘
   - 颜色选择（默认黄色）
   - 创建 Thought（Batch 4）
   - 取消
5. 选择颜色 → 标注创建完成
6. 后台异步：OCR 识别区域文字 + 生成截图缩略图
```

#### 标注数据模型

```typescript
interface EBookAnnotation {
  id: string;
  bookId: string;                // 所属书架条目
  type: 'rect' | 'underline';   // 线框 / 横线
  color: 'yellow' | 'green' | 'blue' | 'purple' | 'red';
  anchor: SpatialAnchor;        // { pageNum, rect: {x, y, w, h} }，坐标基于 scale=1
  ocrText?: string;             // OCR 识别的文字
  thumbnail?: string;           // 区域截图（base64 或文件路径）
  thoughtId?: string;           // 关联的 Thought ID（Batch 4）
  createdAt: number;
}
```

存储位置：`{userData}/krig-note/ebook/annotations/{bookId}.json`

#### EPUB 格式的标注差异

EPUB 使用 CFI 锚点而非空间坐标：

```typescript
// 固定页面格式（PDF/DjVu/CBZ）→ SpatialAnchor
{ type: 'spatial', pageNum: 12, rect: { x: 50, y: 200, w: 300, h: 80 } }

// 可重排格式（EPUB）→ CFIAnchor
{ type: 'cfi', cfiRange: 'epubcfi(/6/4[chap01]!/4/2/16,/1:0,/1:100)', textContent: '被标注的文字' }
```

标注 UI 不同：EPUB 不需要线框模式（有 DOM 文本），直接使用文本选择 + 高亮。

#### Batch 2 能力清单

| 能力 | 说明 |
|------|------|
| **线框标注** | 拖拽画矩形，框选任意区域（fixed-page 格式） |
| **横线标注** | 行间画线，标注文字行（fixed-page 格式） |
| **OCR 识别** | 标注区域自动 OCR 提取文字（平台 OCR） |
| **区域截图** | 标注区域自动生成缩略图 |
| **标注颜色** | 5 种颜色，浮动工具栏选择 |
| **标注持久化** | 存储在 KRIG 目录，不修改原文件 |
| **阅读进度** | 记住上次阅读位置，下次打开自动恢复 |
| **Text Layer** | 透明文本覆盖层，支持基础文本选择和 Cmd+C 复制（基础能力，不是标注入口） |

### 3.3 Batch 3：导航增强

| 能力 | 说明 |
|------|------|
| **PDF Outline** | 读取 PDF 原生目录，侧栏树形显示 |
| **缩略图面板** | 虚拟缩略图列表，点击跳转 |
| **页面书签** | 用户标记重要页面，Cmd+D 添加 |
| **文本搜索** | Cmd+F 搜索，高亮所有匹配，前后导航 |
| **Annotation Layer** | 渲染 PDF 内嵌链接（内部跳转 + 外部 URL） |
| **页面旋转** | 顺时针 90° 旋转 |
| **显示模式** | 连续滚动 / 单页 / 双页 |

### 3.4 Batch 4：思考集成

KRIG 特色——空间标注与思考系统的联动。

| 能力 | 说明 |
|------|------|
| **标注 → Thought** | 从空间标注创建 Thought（截图 + OCR 文本 + 用户思考） |
| **anchor 协议** | EBookView + NoteView:thought 协同，点击 Thought → 跳转到 PDF 精确位置 |
| **page-sync 协议** | EBookView + NoteView 页码同步 |
| **标注面板** | 侧栏显示所有标注列表（截图缩略图 + OCR 文本预览） |
| **空间引用** | 标注携带位置描述（"第 12 页，区域坐标"），可在 Note 中作为引用 |

### 3.5 OCR 架构（跨平台）

空间标注的 OCR 需要兼容 macOS 和 Windows。设计为**接口 + 平台实现**：

```typescript
interface IOCRProvider {
  recognize(image: Buffer, lang?: string): Promise<OCRResult>;
  isAvailable(): boolean;
}

interface OCRResult {
  text: string;                    // 识别的完整文本
  blocks: OCRBlock[];              // 文本块（带坐标，用于未来的行级定位）
  confidence: number;              // 置信度 0-1
}
```

**平台选择策略**：

```
OCR 请求
  → macOS? → Vision Framework（系统级，免费，离线，高质量）
  → Windows? → WinRT OCR（系统级，免费，离线）
  → 兜底 → Tesseract.js（跨平台，纯 JS/WASM，离线）
```

| 实现 | 平台 | 中文 | 英文 | 离线 | 依赖 |
|------|------|------|------|------|------|
| Vision Framework | macOS | 优 | 优 | 是 | 系统内置 |
| WinRT OCR | Windows | 良 | 优 | 是 | 系统内置 |
| Tesseract.js | 跨平台 | 中 | 良 | 是 | ~15MB WASM + 语言包 |

#### 两层 OCR

KRIG 的 OCR 分为两个层级，各自独立：

| | 本地 OCR（标注用） | 云端 OCR（全书提取） |
|---|---|---|
| **触发** | 用户框选区域，即时识别 | 用户主动发起"全书提取" |
| **输入** | 小区域截图（几百像素） | 整本 PDF（几百页） |
| **延迟** | < 1 秒 | 分钟级，后台运行 |
| **执行** | 本地（离线） | 云端后台服务 |
| **质量** | 平台原生（够用） | 云端 API（最高质量） |
| **用途** | 标注的文字内容、快速引用 | 全文搜索索引、知识图谱、AI 提取 |
| **Batch** | 2 | 5+ |

两层互补：本地 OCR 保证标注时的即时体验（离线可用、低延迟），云端 OCR 服务于深度处理（全书文字提取、版面分析、表格识别）。

### 3.6 Batch 5+：高级能力

| 能力 | 说明 |
|------|------|
| **暗色模式渲染** | 反转 PDF 页面颜色适应暗色主题 |
| **打印** | 系统打印对话框 |
| **导出图片** | 导出页面或标注区域为 PNG |
| **文件信息** | 显示 PDF 元数据（作者、创建日期、版本） |
| **AI 提取** | 连续分段提取 PDF 内容到 Note |
| **全页 OCR** | 整页 OCR 生成可搜索的文本索引 |

### 3.7 不做的能力

以下是通用电子书编辑器的功能，**KRIG 不做**：

| 不做 | 原因 |
|------|------|
| PDF 编辑（修改原文） | KRIG 是阅读工具，不是编辑器 |
| 表单填写 | 超出"阅读 + 思考"范围 |
| 数字签名 | 专业签名工具的领域 |
| PDF 合并/拆分 | 文件管理工具的职责 |
| 页面重排 | 编辑器功能 |
| 便签/图章 | 传统批注模式，KRIG 用 Thought 替代 |
| 绘图/手绘标注 | 编辑器功能 |
| 协作批注 | V1 不考虑多用户 |
| 云同步 | 文件在用户文件系统，KRIG 不管 |

---

## 四、键盘快捷键

| 快捷键 | 功能 | Batch |
|--------|------|-------|
| `Cmd+O` | 导入电子书（通过 Menu） | 1 |
| `Space` / `Shift+Space` | 向下/向上滚动一屏 | 1 |
| `↑` / `↓` | 向上/向下滚动 | 1 |
| `Cmd+=` / `Cmd+-` | 放大 / 缩小 | 1 |
| `Cmd+0` | 重置缩放到 100% | 1 |
| `Cmd+滚轮` | 连续缩放 | 1 |
| `Home` / `End` | 跳到首页 / 末页 | 1 |
| `Cmd+C` | 复制选中文本 | 2 |
| `Cmd+F` | 搜索 | 3 |
| `Cmd+D` | 添加/移除页面书签 | 3 |
| `Cmd+G` / `Cmd+Shift+G` | 下一个/上一个搜索结果 | 3 |

---

## 五、已确认的决策

| # | 决策 | 结论 |
|---|------|------|
| 1 | 适应宽度 | Batch 1 支持 |
| 2 | 书架作用域 | 全局共享（所有 Workspace 看到同一个书架），Workspace 单独记忆阅读状态 |
| 3 | 侧栏面板位置 | EBookView 内部（View 自管理），不占用 NavSide |
| 4 | 单页模式 | 滚动时 snap 到页面边界（保留连续滚动流畅感） |
| 5 | 托管目录结构 | 扁平化 `{id}.pdf`，用户不直接操作 library 目录 |
| 6 | 导入去重 | fileHash 检测 → 提示"此文件已在书架中" → 跳转到已有条目 |
| 7 | 书架文件夹 | 支持，复用 Note 的交互模式（创建、嵌套、拖拽、重命名、删除） |
| 8 | 导入提示 | 两步流程：选文件 → 弹窗选模式（托管默认）→ 导入 |
| 9 | 书本重命名 | 双击或右键 → 重命名 displayName，不影响物理文件名 |
| 10 | pdfjs-dist 版本 | 4.9.155（5.x 的 Map.getOrInsertComputed 与 Electron 40 不兼容） |

---

## 六、渲染引擎架构（已实现）

### 6.1 两种渲染模式

电子书格式分为两种渲染模式，需要不同的渲染策略和 Content 组件：

| 渲染模式 | 格式 | 渲染方式 | 位置标记 | 标注方式 |
|----------|------|---------|---------|---------|
| **fixed-page** | PDF, DjVu, CBZ | Canvas 逐页渲染 | `PagePosition(page, offset)` | 空间坐标 `SpatialAnchor` |
| **reflowable** | EPUB | iframe + HTML 重排 | `CFIPosition(cfi)` | DOM 锚点 `CFIAnchor` |

### 6.2 接口继承体系

```
IBookRenderer（基础接口）
  │  fileType, renderMode
  │  load(), destroy(), getToolbarConfig(), goTo(), getTOC()
  │
  ├── IFixedPageRenderer（固定页面）
  │     getPageDimensions(), getTotalPages()
  │     setScale(), getScale()
  │     renderPage(pageNum, canvas, scale)
  │     invalidateAll()
  │     └── PDFRenderer（已实现）
  │     └── DjVuRenderer, CBZRenderer（未来）
  │
  └── IReflowableRenderer（可重排）
        renderTo(container)
        setFontSize(), getFontSize()
        getProgress(), nextChapter(), prevChapter()
        setDisplayMode('paginated' | 'scrolled')
        onResize()
        └── EPUBRenderer（未来）
```

类型守卫：`isFixedPage(renderer)` / `isReflowable(renderer)`

### 6.3 EBookView 分发逻辑

```tsx
// EBookView.tsx — 根据 renderMode 分发 Content 组件
{isFixedPage(renderer) && <FixedPageContent renderer={renderer} ... />}
{isReflowable(renderer) && <ReflowableContent renderer={renderer} ... />}
```

- **FixedPageContent**：Canvas 虚拟滚动，IntersectionObserver 检测可见页，渲染队列
- **ReflowableContent**：渲染引擎注入 DOM 容器，ResizeObserver 响应重排

### 6.4 位置与标注类型系统

```typescript
// 位置
type BookPosition =
  | PagePosition    // { type: 'page', page: number, scrollOffset?: number }
  | CFIPosition;    // { type: 'cfi', cfi: string, display?: string }

// 标注锚点
type AnnotationAnchor =
  | SpatialAnchor   // { type: 'spatial', pageNum, rect: {x,y,w,h} }
  | CFIAnchor;      // { type: 'cfi', cfiRange, textContent? }
```

### 6.5 各格式能力差异

| 能力 | PDF | EPUB | DjVu | CBZ |
|------|-----|------|------|-----|
| 渲染模式 | fixed-page | reflowable | fixed-page | fixed-page |
| 页码导航 | 固定页码 | 章节 + 进度 | 固定页码 | 固定页码 |
| 缩放 | 整页缩放 | 字体大小 | 整页缩放 | 整页缩放 |
| 标注方式 | 空间坐标 | CFI 锚点 | 空间坐标 | 空间坐标 |
| OCR | 区域截图 → OCR | 不需要（有文本） | 区域截图 → OCR | 区域截图 → OCR |
| 渲染引擎 | pdfjs-dist | epub.js / foliate-js | 待定 | 图片查看 |

### 6.6 电子书格式支持

#### 主流格式总览

| 格式 | 全称 | 特点 | 使用场景 |
|------|------|------|---------|
| **PDF** | Portable Document Format | 固定版面，所见即所得 | 学术论文、教材、技术文档、官方出版物 |
| **EPUB** | Electronic Publication | 可重排 HTML，响应式 | 小说、非虚构、通用电子书 |
| **MOBI** | Mobipocket | Kindle 早期格式，已停止支持 | 历史遗留 Kindle 书 |
| **AZW3/KFX** | Kindle Format | Amazon 专有，基于 EPUB | Kindle 生态 |
| **DjVu** | — | 扫描文档高压缩 | 扫描书籍、历史文献 |
| **CBZ/CBR** | Comic Book Archive | 图片打包（ZIP/RAR） | 漫画、图像小说 |
| **FB2** | FictionBook | XML 格式，俄语系流行 | 俄语电子书 |
| **TXT** | Plain Text | 纯文本 | 网络小说、简单文档 |

#### KRIG 支持策略

| 格式 | 渲染模式 | 支持方式 | 实现状态 | 优先级 |
|------|---------|---------|---------|--------|
| **PDF** | fixed-page | 直接支持（pdfjs-dist） | PDFRenderer 已实现 | P0 |
| **EPUB** | reflowable | 直接支持（epub.js / foliate-js） | 接口已定义，renderer 未实现 | P1 |
| **DjVu** | fixed-page | 直接支持（IFixedPageRenderer 兼容） | renderer 未实现 | P2 |
| **CBZ/CBR** | fixed-page | 直接支持（图片解压 + Canvas 渲染） | renderer 未实现 | P2 |
| **FB2** | reflowable | 直接支持（foliate-js 支持 FB2） | renderer 未实现 | P3 |
| **MOBI/AZW3** | reflowable | 导入时转换为 EPUB | 不需要独立 renderer | P3 |
| **TXT/DOCX** | — | 不属于 eBook 范畴 | 不支持 | — |

#### 架构适配

两层接口天然覆盖所有电子书格式：

- **IFixedPageRenderer**：PDF、DjVu、CBZ — 固定页面 + Canvas + 空间坐标标注
- **IReflowableRenderer**：EPUB、FB2 — HTML 重排 + DOM + CFI 标注
- **格式转换**：MOBI/AZW3 → 导入时转 EPUB（参考 Calibre 策略），不需要独立引擎

导入对话框的文件过滤器已预留所有格式：`['pdf', 'epub', 'djvu', 'cbz']`。

### 6.7 命名映射

| 层级 | 名称 |
|------|------|
| ViewType | `'ebook'` |
| WorkMode | `{ id: 'ebook', viewType: 'ebook', icon: '📕', label: 'eBook' }` |
| 插件目录 | `src/plugins/ebook/` |
| HTML 入口 | `ebook.html` |
| Vite 配置 | `vite.ebook.config.mts` |
| IPC 前缀 | `ebook:*` |
| NavSide 面板 | "书架" |
| 书架存储 | `{userData}/krig-note/ebook/library/` |

---

## 七、代码架构（已实现）

### 7.1 目录结构

```
src/plugins/ebook/                    ← eBook 插件（renderer process）
  types.ts                            ← 类型系统（接口 + 位置 + 标注 + 类型守卫）
  renderer.tsx                        ← 渲染入口（挂载 EBookView）
  ebook.css                           ← 暗色主题样式
  components/
    EBookView.tsx                     ← 顶层 View（被动加载 + renderMode 分发）
    EBookToolbar.tsx                  ← 工具栏（导航 + 缩放）
    FixedPageContent.tsx              ← 固定页面渲染（PDF/DjVu/CBZ 共用）
    ReflowableContent.tsx             ← 可重排渲染（EPUB 用，骨架）
  renderers/
    index.ts                          ← 工厂函数 createRenderer(fileType)
    pdf/
      index.ts                        ← PDFRenderer（pdfjs-dist 4.9.155）

src/main/ebook/                       ← eBook main process
  file-loader.ts                      ← 文件加载（读取 Buffer）
  bookshelf-store.ts                  ← 书架 + 文件夹存储（JSON）

src/main/navside/                     ← NavSide 注册制
  registry.ts                         ← NavSideRegistry

src/renderer/navside/                 ← NavSide renderer
  NavSide.tsx                         ← 框架层（注册制分发 ActionBar + Content）
  EBookPanel.tsx                      ← 书架面板（树形列表 + 拖拽 + 导入弹窗）

构建配置:
  ebook.html                          ← 入口 HTML
  vite.ebook.config.mts               ← Vite 构建配置
  forge.config.ts                     ← renderer: ebook_view

IPC + Preload:
  src/shared/types.ts                 ← eBook IPC 通道（书架 + 文件夹 + 数据传输 + 注册制）
  src/main/preload/view.ts            ← ebookGetData / onEbookLoaded / ebookClose
  src/main/preload/navside.ts         ← 书架 API + 文件夹 API + 注册查询
  src/main/ipc/handlers.ts            ← 全部 IPC handler
  src/main/window/shell.ts            ← viewType='ebook' 路由
  src/main/app.ts                     ← WorkMode 注册 + NavSide 注册 + Menu
```

### 7.2 关键依赖关系

```
EBookView  ──→  types.ts (IBookRenderer, isFixedPage, isReflowable)
    │
    ├── FixedPageContent  ──→  types.ts (IFixedPageRenderer)
    │                           不依赖 pdfjs-dist
    │
    ├── ReflowableContent ──→  types.ts (IReflowableRenderer)
    │                           不依赖 epub.js
    │
    └── createRenderer()  ──→  renderers/pdf/index.ts
                                 └── pdfjs-dist（唯一依赖点）
```

**pdfjs-dist 被完全封装在 `renderers/pdf/` 内部**，框架层和 Content 组件不 import 它。

### 7.3 新增格式的步骤

1. 在 `renderers/` 下新建目录，实现 `IFixedPageRenderer` 或 `IReflowableRenderer`
2. 在 `renderers/index.ts` 的 `createRenderer()` 中注册
3. 如果是新的渲染模式（既不是 fixed-page 也不是 reflowable），新增 Content 组件

当前已实现的格式只有 PDF。EPUB / DjVu / CBZ 的 renderer 骨架已预留，打开时会报 "not yet implemented"。

---

## 八、NavSide 书架设计

### 8.1 NavSide 内容注册制

遵循 `workmode.md` §四。NavSide 的 ActionBar 和 ContentList 由 WorkMode 驱动，不硬编码。

#### 注册数据（Main Process）

```typescript
interface NavSideRegistration {
  workModeId: string;
  actionBar: {
    title: string;
    actions: { id: string; label: string }[];
  };
  contentType: string;    // NavSide renderer 用此值路由到对应组件
}
```

在 `app.ts` 的 `registerPlugins()` 中注册：

```typescript
navSideRegistry.register({
  workModeId: 'demo-a',   // Note WorkMode
  actionBar: { title: '笔记目录', actions: [
    { id: 'create-folder', label: '+ 文件夹' },
    { id: 'create-note', label: '+ 新建' },
  ]},
  contentType: 'note-list',
});

navSideRegistry.register({
  workModeId: 'demo-b',   // eBook WorkMode
  actionBar: { title: '书架', actions: [
    { id: 'create-ebook-folder', label: '+ 文件夹' },
    { id: 'import-ebook', label: '+ 导入' },
  ]},
  contentType: 'ebook-bookshelf',
});
```

#### NavSide Renderer 的消费方式

```typescript
// NavSide.tsx
const registration = await navSideAPI.getNavSideRegistration(activeWorkModeId);

// ActionBar: 根据 registration.actionBar 渲染标题和按钮
// ContentList: 根据 registration.contentType 路由到对应组件
```

ActionBar 按钮点击时，NavSide 调用对应的 IPC 方法（如 `import-ebook` → `navSideAPI.ebookImport()`）。

#### 新增 WorkMode 的步骤

1. Main: `navSideRegistry.register({ workModeId, actionBar, contentType })`
2. NavSide: 新增 `contentType` 对应的面板组件

### 8.2 书架面板（ebook-bookshelf）

#### 用户看到的界面

```
┌─────────────────────────────┐
│ 书架    + 文件夹    + 导入   │  ← ActionBar
├─────────────────────────────┤
│ 🔍 搜索书架...               │
├─────────────────────────────┤
│ 📁 学术论文                  │  ← 文件夹（可展开/收起）
│   📄 注意力机制论文        ●  │  ← 书本（● = 当前打开）
│      42 页 · 刚刚            │
│   📄 Transformer 综述        │
│      128 页 · 3 天前         │
│ 📁 教材                      │
│   📄 高等数学                 │
│      612 页 · 1 周前         │
│ 📄 临时阅读.pdf              │  ← 根目录的书（无文件夹）
│    86 页 · 昨天              │
└─────────────────────────────┘
```

#### 文件夹组织（复用 Note 的模式）

和 Note 的文件夹系统保持一致的交互：

| 能力 | 说明 |
|------|------|
| 创建文件夹 | ActionBar "+ 文件夹" 按钮，或右键菜单 → 新建子文件夹 |
| 文件夹嵌套 | 支持多级嵌套，`parent_id` 指向父文件夹 |
| 展开/收起 | 单击文件夹切换展开状态（▸/▾） |
| 拖拽移动 | 拖拽书本到文件夹中，拖拽文件夹到其他文件夹中 |
| 拖到根目录 | 拖拽到空白区域 → 移动到根目录 |
| 文件夹重命名 | 右键 → 重命名 → 行内编辑 |
| 文件夹删除 | 右键 → 删除（子文件夹递归删除，书本回到根目录） |
| 展开状态持久化 | 保存到 WorkspaceState，切换 Workspace 时恢复 |

**数据模型**：eBook 文件夹独立于 Note 文件夹（不同的存储），但接口一致。

```typescript
interface EBookFolder {
  id: string;
  title: string;
  parent_id: string | null;    // null = 根目录
  sort_order: number;
  created_at: number;
}
```

EBookEntry 添加 `folderId` 字段：

```typescript
interface EBookEntry {
  // ...现有字段...
  folderId: string | null;     // 所属文件夹（null = 根目录）
}
```

#### 导入提示

用户点击 "+ 导入" 或 Cmd+O 后，选择文件 → 弹出提示：

```
┌──────────────────────────────────────┐
│ 导入电子书                            │
├──────────────────────────────────────┤
│                                      │
│  📄 高等数学·上册 第七版.pdf           │
│                                      │
│  ○ 拷贝到 KRIG 管理（推荐）           │
│    文件将被复制到 KRIG 的资料库中，     │
│    不会因为原文件移动或删除而丢失。     │
│                                      │
│  ○ 链接原文件                         │
│    仅记录文件路径，不复制文件。         │
│    移动或删除原文件后将无法打开。       │
│                                      │
│           [取消]    [导入]            │
└──────────────────────────────────────┘
```

- 默认选中"拷贝到 KRIG 管理"（托管模式）
- 用户可切换为"链接原文件"（引用模式）
- 记住用户上次的选择（下次导入时默认使用相同模式）

#### 书本交互操作

| 操作 | 触发 | 行为 |
|------|------|------|
| 打开 | 单击书本 | IPC → Main 加载文件 → 通知 EBookView |
| 导入 | "+ 导入" 按钮 | 文件对话框 → 导入提示 → 导入书架 → 自动打开 |
| 重命名 | 右键 → 重命名 | 行内编辑 displayName（不影响物理文件名） |
| 删除 | 右键 → 删除 | 托管模式：询问是否同时删除文件；引用模式：仅从书架移除 |
| 移动到文件夹 | 拖拽 | 拖拽到目标文件夹 |
| 移出文件夹 | 右键 → 移出文件夹 | 移到根目录 |
| 重新定位 | 右键 → 重新定位（仅 Link 模式） | 弹文件选择对话框 → 更新 filePath |
| 转为托管 | 右键 → 拷贝到 KRIG 管理（仅 Link 模式） | 复制文件到 library → 更新 storage 模式 |

#### 列表项信息

| 字段 | 来源 | 说明 |
|------|------|------|
| 图标 | fileType | 📄 PDF / 📖 EPUB |
| 名称 | displayName | 用户可编辑的显示名 |
| 副信息 | pageCount + lastOpenedAt | "42 页 · 3 天前" |
| 状态标记 | activeBookId | 当前打开的条目显示 ● |
| 排序 | 文件夹内按 sort_order；根目录书本按 lastOpenedAt 降序 |

### 8.3 IPC 通道

```typescript
// 书架操作（NavSide 使用）
EBOOK_BOOKSHELF_LIST: 'ebook:bookshelf-list',
EBOOK_BOOKSHELF_IMPORT: 'ebook:bookshelf-import',    // 对话框 + 导入提示 + 导入 + 自动打开
EBOOK_BOOKSHELF_OPEN: 'ebook:bookshelf-open',        // 点击书架项 → 加载
EBOOK_BOOKSHELF_REMOVE: 'ebook:bookshelf-remove',
EBOOK_BOOKSHELF_RENAME: 'ebook:bookshelf-rename',
EBOOK_BOOKSHELF_MOVE: 'ebook:bookshelf-move',        // 移动到文件夹
EBOOK_BOOKSHELF_RELOCATE: 'ebook:bookshelf-relocate', // 重新定位（Link 模式）
EBOOK_BOOKSHELF_CHANGED: 'ebook:bookshelf-changed',   // Main → NavSide 书架变更通知

// 书架文件夹操作
EBOOK_FOLDER_CREATE: 'ebook:folder-create',
EBOOK_FOLDER_RENAME: 'ebook:folder-rename',
EBOOK_FOLDER_DELETE: 'ebook:folder-delete',
EBOOK_FOLDER_MOVE: 'ebook:folder-move',
EBOOK_FOLDER_LIST: 'ebook:folder-list',

// 数据传输（EBookView 使用）
EBOOK_GET_DATA: 'ebook:get-data',
EBOOK_LOADED: 'ebook:loaded',       // Main → EBookView: 文件已加载
EBOOK_CLOSE: 'ebook:close',

// NavSide 注册制
NAVSIDE_GET_REGISTRATION: 'navside:get-registration',
```

### 8.4 NavSide Preload 扩展

```typescript
// 在 navside.ts preload 中添加：

// NavSide 注册查询
getNavSideRegistration: (workModeId: string) =>
  ipcRenderer.invoke(IPC.NAVSIDE_GET_REGISTRATION, workModeId),

// eBook 书架操作
ebookBookshelfList: () => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_LIST),
ebookBookshelfImport: () => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_IMPORT),
ebookBookshelfOpen: (id: string) => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_OPEN, id),
ebookBookshelfRemove: (id: string) => ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_REMOVE, id),
ebookBookshelfRename: (id: string, displayName: string) =>
  ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_RENAME, id, displayName),
ebookBookshelfRelocate: (id: string) =>
  ipcRenderer.invoke(IPC.EBOOK_BOOKSHELF_RELOCATE, id),

onEbookBookshelfChanged: (callback: (list: unknown[]) => void) => {
  const listener = (_event: any, list: unknown[]) => callback(list);
  ipcRenderer.on(IPC.EBOOK_BOOKSHELF_CHANGED, listener);
  return () => ipcRenderer.removeListener(IPC.EBOOK_BOOKSHELF_CHANGED, listener);
},
```

### 8.5 数据流（已实现）

#### 导入流程（两步：选文件 → 选模式）

```
EBookPanel                     Main Process                    EBookView
  │                                │                               │
  │── ebookPickFile() ───────────→ │                               │
  │                                │── dialog.showOpenDialog       │
  │←─ { filePath, fileName,       │                               │
  │     fileType } ────────────── │                               │
  │                                │                               │
  │ [显示导入弹窗：托管/引用选择]    │                               │
  │ [用户点击"导入"]                │                               │
  │                                │                               │
  │── ebookBookshelfAdd(           │                               │
  │     filePath, fileType,        │                               │
  │     'managed'|'link') ───────→ │                               │
  │                                │── bookshelfStore.add()        │
  │                                │── broadcastChanged ──────────→ EBookPanel 刷新
  │                                │── loadEBook(filePath)         │
  │                                │── EBOOK_LOADED ──────────────→│
  │                                │                               │── ebookGetData()
  │                                │                               │── createRenderer()
  │                                │                               │── 渲染
```

#### 点击已有条目打开

```
EBookPanel                     Main Process                    EBookView
  │                                │                               │
  │── ebookBookshelfOpen(id) ────→ │                               │
  │                                │── bookshelfStore.get(id)      │
  │                                │── checkExists → loadEBook()   │
  │                                │── EBOOK_LOADED ──────────────→│（同上）
```

### 8.6 当前实现状态

```
src/renderer/navside/
  NavSide.tsx          ← 框架层 + Note 笔记目录（共存，按 contentType 条件渲染）
  EBookPanel.tsx       ← eBook 书架面板（独立组件，~500 行）

src/main/navside/
  registry.ts          ← NavSideRegistry（已实现）

src/main/ebook/
  file-loader.ts       ← 文件加载（已实现）
  bookshelf-store.ts   ← 书架 + 文件夹存储（已实现）
```

**未来重构**：将 NavSide.tsx 中的 Note 笔记目录逻辑提取为独立的 NotePanel.tsx，使 NavSide.tsx 成为纯框架层。当前 Note 逻辑仍内联在 NavSide.tsx 中。

---

## 九、Workspace 状态集成

### 9.1 全局书架 vs Workspace 状态

书架是全局的（所有 Workspace 共享同一份书架数据），但每个 Workspace 独立记忆阅读状态。

| 数据 | 作用域 | 存储位置 |
|------|--------|---------|
| 书架条目列表 | 全局 | `bookshelf.json` |
| 文件夹结构 | 全局 | `bookshelf.json` |
| 标注数据 | 全局（按 bookId） | `annotations/{bookId}.json` |
| 当前打开的书 | Workspace | `WorkspaceState` |
| 阅读位置（页码/偏移） | Workspace | `WorkspaceState` |
| 缩放比例 | Workspace | `WorkspaceState` |
| 书架文件夹展开状态 | Workspace | `WorkspaceState` |

### 9.2 WorkspaceState 扩展（待实现）

```typescript
interface WorkspaceState {
  // ...现有字段...
  activeBookId: string | null;           // 当前打开的电子书
  ebookExpandedFolders: string[];        // 书架文件夹展开状态
  ebookReadingState?: {                  // 阅读状态
    position: BookPosition;              // 当前位置
    scale: number;                       // 缩放
  };
}
```

### 9.3 场景

- **切换 Workspace**：恢复该 Workspace 上次打开的电子书和阅读位置
- **切换 WorkMode**：Note → eBook → Note → eBook，书架状态保持
- **多 Workspace 读同一本书**：各自独立的阅读位置，标注数据共享

---

## 十、EPUB 渲染器设计（待实现）

### 10.1 库选择

| 库 | 状态 | 特点 |
|---|---|---|
| **epub.js** | 停止维护（4 年） | 最成熟，iframe + CSS columns |
| **foliate-js** | 活跃维护 | 现代重写，支持 EPUB/MOBI/FB2/CBZ |
| **readium** | 活跃维护 | 企业级，规范合规，重量级 |

**建议选择 foliate-js**：
- 活跃维护，现代 API
- 支持多种格式（EPUB + MOBI + FB2），一个库覆盖所有 reflowable 格式
- 比 epub.js 更轻量，比 readium 更简单

### 10.2 EPUBRenderer 接口实现

```typescript
class EPUBRenderer implements IReflowableRenderer {
  readonly fileType = 'epub';
  readonly renderMode = 'reflowable';

  // 使用 foliate-js 渲染到 container
  renderTo(container: HTMLElement): void;

  // 字体大小调整（不是页面缩放）
  setFontSize(size: number): void;
  getFontSize(): number;

  // 章节导航
  getProgress(): { chapter: string; percentage: number };
  nextChapter(): void;
  prevChapter(): void;

  // 分页 / 滚动模式
  setDisplayMode(mode: 'paginated' | 'scrolled'): void;

  // 视口变化时重排
  onResize(): void;
}
```

### 10.3 EPUB 标注方式

EPUB 不使用空间标注（没有固定页面坐标），使用 DOM 文本选择 + CFI 锚点：

```
用户选中文本
  → 弹出高亮工具栏（和 NoteView 的 FloatingToolbar 类似）
  → 选择颜色 → 创建标注
  → 锚点 = CFI range + 选中文本内容
```

### 10.4 Toolbar 差异

| 能力 | PDF Toolbar | EPUB Toolbar |
|------|------------|-------------|
| 导航 | ‹ [page] of N › | ‹ [chapter] › + 进度条 |
| 缩放 | − [100%] + | A− [字号] A+ |
| 显示模式 | 连续/单页/双页 | 分页/滚动 |
| 标注模式 | 线框/横线 | 不需要（文本选择即标注入口） |

EBookToolbar 通过 `renderer.getToolbarConfig()` 获取配置，动态调整 UI。

---

## 十一、入口汇总

| 入口 | 触发方式 | 说明 |
|------|----------|------|
| **NavSide 书架** | 点击列表项 | 主要入口。切换到 eBook WorkMode 后，NavSide 显示书架 |
| **NavSide 导入** | "+ 导入" → 选文件 → 选模式 → 导入 | 两步流程，弹窗选择托管/引用 |
| **Application Menu** | Cmd+O | eBook 菜单 → 文件对话框 → 直接托管导入 |

EBookView 本身不提供 Open 按钮。空状态显示："在左侧书架中选择电子书"。

---

## 十二、待讨论

1. **用户是否需要参与 KRIG 的 library 目录管理？** 当前设计是不透明的（`{id}.pdf`），用户通过书架操作。是否需要提供一个"打开 Library 文件夹"的设置入口？

2. **WorkspaceState 的 eBook 状态何时持久化？** 每次翻页都保存，还是定时保存？建议：页面切换时 debounce 保存（500ms）。

3. **EPUB 库的最终选择**：foliate-js 还是 epub.js？需要实际集成测试后确认。

4. **标注的跨格式统一搜索**：PDF 标注（OCR 文本）和 EPUB 标注（原始文本）能否在同一个搜索界面中查找？
