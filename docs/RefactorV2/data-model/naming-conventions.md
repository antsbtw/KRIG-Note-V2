# V2 数据模型字段命名约定（RFC）

> **状态：RFC（Request for Comments / 提案稿）**
> **生效时机**：等 `relations/pm-note.md` 出来 + 字段在真实 block 场景验证后转正式规范。
> **当前定位**：提案讨论稿，**不**作为强约束规范使用。
>
> 本文件提议 V2 数据模型中**字段命名**的总原则与具体决议。代码实施前所有有争议的命名（标 "待决议"）需单独决议。
>
> 参考起点：`atom/spec.md` + `atom/decisions/003-naming-conventions.md`（domain / edge 命名）+ `relations/spec.md`（边字段规约）。

---

## 0. 本文件的角色

V2 数据建模有**三层命名规约**，各管各的：

| 文件 | 管什么 |
|---|---|
| `atom/decisions/003-naming-conventions.md` | **Domain 命名** + **Edge 命名（三段式 source:vocabulary:edge-name）** |
| `relations/spec.md` | Edge **接口结构**（subject / predicate / object / attrs 字段） |
| **本文件** | **字段名本身**的选择 —— 用什么字符串命名某个字段 |

例如：

- 003 说"Edge 三段式命名" —— 是命名结构问题。
- relations/spec.md §3 说"Edge 必带 createdBy / createdAt" —— 是字段存在问题。
- 本文件**提议**"为什么叫 `createdBy` 不叫 `author` 不叫 `agent`" —— 是字段名选择问题。

**为什么是 RFC 而不是规范**：
1. 字段命名涉及 V1→V2 迁移成本，需要看到真实 block 使用场景才能评估。
2. 部分命名变更（如 mark 的 bold→strong）影响范围广，需单独决议。
3. `relations/pm-note.md` 还没写完，缺少真实约束验证。

---

## 1. 字段命名三阶梯（提案）

V2 数据模型的字段命名遵循以下优先级 —— **越上层越优先**：

```
┌───────────────────────────────────────────────────────┐
│ 阶梯 1：Markdown 标准定义的，沿用 Markdown 命名         │
│         （CommonMark / GFM / 等社区共识）              │
└───────────────────┬───────────────────────────────────┘
                    │ 没有就降级到
                    ↓
┌───────────────────────────────────────────────────────┐
│ 阶梯 2：Markdown 未定义但 PM / HTML 定义的             │
│         （ProseMirror schema / HTML 元素属性）          │
│   ⚠ 当 HTML 与 PM 命名冲突时，优先 PM                 │
└───────────────────┬───────────────────────────────────┘
                    │ 没有就降级到
                    ↓
┌───────────────────────────────────────────────────────┐
│ 阶梯 3：都未定义，KRIG 自定义                          │
│         （参考 CSS / GTD / Schema.org / 数据库约定）   │
└───────────────────────────────────────────────────────┘
```

### 1.1 阶梯 1 — Markdown 标准

参考依据：
- **CommonMark 0.31** 标准（[spec.commonmark.org](https://spec.commonmark.org/)）
- **GitHub Flavored Markdown (GFM)** 标准
- **prosemirror-markdown** 包的字段命名（事实上的 PM ↔ Markdown 桥）

适用情形 —— Markdown 标准里有明确规定的字段：

| Markdown 概念 | 标准命名 | 应用于 V2 哪个节点 |
|---|---|---|
| 围栏代码块的语言标识（info string） | `info` | codeBlock.attrs.info |
| 链接目标 | `href` | link mark.attrs.href（PM 标准也用 href） |
| 链接标题 | `title` | link mark.attrs.title |
| 图片的 alt 文本 | `alt` | image.attrs.alt |
| 图片源地址 | `src` | image.attrs.src |
| 表格列对齐（GFM）| `align` | tableCell.attrs.align |
| 标题级别 | `level`（1-6）| heading.attrs.level |

### 1.2 阶梯 2 — PM / HTML 标准

参考依据：
- **prosemirror-schema-basic** 节点 attrs 命名
- **HTML5 标准元素属性** 命名（W3C / WHATWG）

**冲突解决规则**：当 HTML 与 PM 对同一概念用了不同命名时，**默认优先 PM**（V2 节点 type 已沿用 PM 概念命名，attrs 同步对齐，保持一套体系）。

例外清单（PM 优先规则的明示豁免）见 §1.2.1。

| 概念 | V2 采纳 | HTML 标准 | PM 标准 | 选择理由 |
|---|---|---|---|---|
| 有序列表起始数 | `order` | `start` (HTML `<ol start>`) | `order` (PM `ordered_list`) | PM 优先（默认规则） |
| 表格列合并 | `colspan` | `colspan` | (PM 无标准 table) | HTML 唯一来源 |
| 表格行合并 | `rowspan` | `rowspan` | (PM 无标准 table) | HTML 唯一来源 |
| 表头标记 | `isHeader` | （HTML 用 `<th>` 标签区分） | (PM 无标准 table) | KRIG 自定义（HTML 用标签区分，无 attrs） |
| 视频海报图 | `poster` | `poster` | — | HTML 唯一来源 |
| 媒体时长 | `duration` | `duration` | — | HTML 唯一来源 |
| 媒体 MIME 类型 | `mimeType` | `type` | — | KRIG 调整（HTML `type` 过于通用，避免冲突） |
| 图片宽 / 高 | `width` / `height` | `width` / `height` | — | HTML 唯一来源 |

#### 1.2.1 PM 优先规则的例外清单

下列情况**不**适用"PM 优先"默认规则，需采用 HTML 命名 / KRIG 自定义命名 / 其他来源命名：

| 概念 | V2 采纳 | 例外类型 | 理由 |
|---|---|---|---|
| 文字加粗 mark | `bold` | PM 命名语义偏狭 | Markdown / PM 用 `strong` 表达"语义强调"，但用户编辑场景 99% 是"视觉粗体"意图。V2 采用样式命名更准确。决议详 [decisions/004-phase2b-resolutions.md §1](atom/decisions/004-phase2b-resolutions.md#1-n6--mark-命名保留-v1-bold--italic) |
| 文字斜体 mark | `italic` | 同上 | 同上 |

**例外触发条件**（出现下列情况时应在本清单登记例外）：

1. **PM 命名过于内部化**：PM 标准命名仅出现在 PM 内部 schema，缺乏外部生态支持（HTML / Markdown 都用不同名）—— 采用 HTML / Markdown 命名。
2. **PM 命名与 KRIG 既有概念冲突**：PM 名字会跟 V2 已用字段同名导致混淆 —— 采用 KRIG 自定义命名。
3. **PM 命名语义偏狭**：PM 命名仅覆盖 PM 自身的限定场景，KRIG 用法范围更广 —— 采用更通用的命名（HTML / Schema.org / 等）。

**登记格式**：

新增例外时，本清单加一行 + 在 §6 Open Questions 立项（如 N9 / N10 ... 编号），说明决议过程。

→ Phase 2c 写 `relations/pm-note.md` 时如遇 HTML/PM 命名冲突且 PM 优先不合适，需登记本例外清单 + 单独决议。

### 1.3 阶梯 3 — KRIG 自定义

参考依据：
- **CSS 属性** 命名（如 `text-align` → `align`，`text-indent` → `textIndent`）
- **GTD / 任务管理** 通用术语（`due` / `completed`）
- **Schema.org** 数据建模标准（`dateCreated` / `author`）
- **数据库通用约定**（`createdAt` / `updatedAt` / `createdBy`）

适用情形 —— 上面都没有，KRIG 自己定。

| 概念 | KRIG 命名 | 命名来源 |
|---|---|---|
| 段落首行缩进 | `textIndent` | CSS `text-indent` |
| 整段缩进层级 | `indent` | CSS `padding-left` 风格 |
| 任务截止日期 | `due` | GTD 通用术语 |
| 任务完成时间 | `completedAt` | 数据库通用 |
| 任务创建时间 | `createdAt` | 数据库通用 |
| 边的创建者 | `createdBy` | 数据库通用 |
| 边的置信度 | `confidence` | ML / RAG 通用 |
| LaTeX 块的语法标识 | `syntax: 'latex'` | KRIG 自定义（Markdown 没规定 math block） |
| Callout 类别 | `calloutType` | KRIG 自定义（Notion 风格） |
| 引用 atom 的 id | `noteId` / `targetId` / `mediaId` | KRIG 自定义（按引用对象命名） |

---

## 2. 字段标准对照清单（提案）

V2 数据模型中所有用到的字段，逐项标注其阶梯归属 + 决议理由。

**说明**：
- "V1 用过"列：V1 atom-types.ts 是否出现过该字段（用作迁移参考）。
- "V2 提案"列：本 RFC 提议的最终命名 + 处置。**标"待决议"的需单独决议**。
- "阶梯"列：标 1 / 2 / 3 表示该字段命名来自哪个阶梯。

### 2.1 文本内容相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `text` | ✓ | 1 | 保留 | PM `text` node 的标准字段，Markdown text content 概念 |
| `info` | ✗（V1 用 `language`） | 1 | 引入 | Markdown fenced code block info string 标准；V1 `language` 改名为 `info` |
| `level` | ✓ | 1 | 保留并扩展 | Markdown / PM `heading.level`；**取值范围从 V1 的 1-3 扩展为 1-6**（CommonMark 标准） |
| `align` | ✓ | 1（表格）/ 3（段落） | 保留 | GFM 表格 align 标准 + CSS text-align 通用 |
| `latex` | ✓ | 3 | 保留 | KRIG 自定义（Markdown / PM 都没 math block 标准） |
| `syntax` | ✗（V1 没有） | 3 | 引入 | mathBlock / htmlBlock 等"非 markdown 标准 syntax block"的语法标识字段 |

### 2.2 链接 / 引用相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `href` | ✓ | 1 | 保留 | Markdown / HTML 链接目标标准命名 |
| `title` | ✓ | 1 | 保留 | Markdown `[text](href "title")` 标准 + HTML `title` 属性 |
| `noteId` | ✓ | 3 | 保留 | KRIG 自定义（笔记内部引用） |
| `targetId` | ✓ | 3 | 保留 | KRIG mention 引用目标 id |
| `mediaId` | ✓ | 3 | 保留 | KRIG media store 内部 id |

### 2.3 媒体资源相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `src` | ✓ | 1 | 保留 | Markdown `![alt](src)` + HTML `<img src>` 标准 |
| `alt` | ✗（V1 image 没有） | 1 | **新增 attrs 字段** | Markdown `![alt](src)` 标准；alt = "替代文本"（图片无法显示时的文字），供屏幕阅读器 / 加载失败场景 |
| `caption` | ✓（V1 是 attrs） | 2 | **改为 PM content 子节点** | V2 image 已实现为 `content: 'block'` 嵌套 —— 单段 caption 作为内嵌 textBlock。对齐 HTML5 `<figure><img><figcaption>` 结构。详见 §2.3.1 V2 image 节点完整结构 |
| `title` | ✓ | 1 | attrs 字段 | Markdown `(... "title")` / HTML `title` 属性，tooltip |
| `width` / `height` | ✓ | 2 | attrs 字段 | HTML `<img width height>` 标准 |
| `alignment` | ✓（V2 已有） | 3 | attrs 字段 | KRIG 自定义（图片在文档中的对齐 'left' / 'center' / 'right'） |
| `mimeType` | ✓ | 2 | attrs 字段 | HTML `type` 属性 + 通用约定 |
| `size` | ✓ | 3 | attrs 字段 | KRIG 自定义（字节数）；HTTP Content-Length 概念 |
| `poster` | ✓ | 2 | attrs 字段（video） | HTML `<video poster>` 标准 |
| `duration` | ✓ | 2 | attrs 字段（video / audio） | HTML media element duration 属性 |
| `originalSrc` | ✓ | 3 | **删除**（待决议）| V1 历史包袱（保存外部 url 防止 media store 失败时回退）；V2 提议走边表达"originalSourceUrl" 关系；**有 V1 历史数据迁移风险，单独决议** |
| `filename` | ✓ | 3 | attrs 字段 | KRIG 自定义（HTTP `Content-Disposition` 概念） |

#### 2.3.1 V2 image 节点完整结构（决议 004 §3 修正）

V2 image 节点的 caption 是 **PM content 子节点**，不是 attrs（这跟其他媒体节点风格一致）：

```ts
image = {
  content: 'block',              // ← caption 单段 block 嵌套（通常是 textBlock）
  attrs: {
    src: null,
    alt: '',                     // 替代文本（attrs）
    title: '',                   // tooltip（attrs）
    width: null,
    height: null,
    alignment: 'center',
    // KRIG 知识图谱挂钩（过渡字段，按"走法 B"应走边，Phase 2c+ 切换）
    atomId: null,
    sourcePages: null,
    thoughtId: null,
  }
}
```

**caption 的访问方式**：通过 PM 节点的 content 数组取第一个子节点（通常是 textBlock），不是 `image.attrs.caption`。

**alt vs caption 的语义区分**：

| 字段 | 用途 | 标准来源 | 在 V2 image 中的位置 |
|---|---|---|---|
| `alt` | **替代呈现** —— 图片无法显示时的纯文本替代 | Markdown `![alt](src)` / HTML `<img alt>` | attrs.alt |
| `caption` | **可见说明** —— 图片下方 / 旁边的视觉化说明文字 | HTML5 `<figcaption>` | content 子节点 |
| `title` | tooltip / 鼠标悬停 | Markdown `(... "title")` / HTML `title` 属性 | attrs.title |

**关于 alt 的必填严格度**：
- **新建 image atom 时**：推荐必填（capability.text-editing 可在 UI 引导补齐）。
- **存量迁移期**：允许为空（V1 历史数据迁移时部分情况可能没有合适的 alt 文本可填）。
- **导出 / 渲染前**：建议补齐（防止可访问性问题），由对应能力检查。

**KRIG 知识图谱挂钩字段**（V2 image attrs 中的 `atomId` / `sourcePages` / `thoughtId`）—— 是 V1 直迁的**过渡 attrs**。按 V2 决策 003 走法 B 原则，跨 atom 引用应走边。Phase 2c+ 切换为：
- `atomId` 删除（节点本身就是 atom）
- `sourcePages` 走 `*:prov:wasInformedBy` 边的 attrs 扩展
- `thoughtId` 走 thought 系统（待 Phase 2c+ 决议）

→ V1 历史数据无需迁移（V2 当前无 V1 数据）。如未来需要迁，V1 `caption` 字段值搬到 V2 image content 子节点的 textBlock 中（不是搬到 attrs）。

### 2.4 段落 / 文本流相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `textIndent` | ✓ | 3 | 保留 | CSS `text-indent` 风格命名 |
| `indent` | ✓ | 3 | 保留 | CSS `padding-left` 风格 |

### 2.5 表格相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `colspan` | ✓ | 2 | 保留 | HTML `<td colspan>` 标准 |
| `rowspan` | ✓ | 2 | 保留 | HTML `<td rowspan>` 标准 |
| `isHeader` | ✓ | 2 | 保留 | HTML `<th>` 标签概念 |
| `colCount` | ✓ | 3 | **改名为 `columns`** | 跟 HTML colgroup / `<colgroup span>` 对齐；命名更通用 |
| `columns` | ✓（V1 columnList.columns） | 3 | 保留 | KRIG 自定义（多栏布局） |

### 2.6 列表 / 任务相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `order` | ✗（V1 用 `start`） | 2 | **统一命名** | PM `ordered_list.attrs.order` 标准命名；V1 用 HTML 风格 `start`，V2 阶梯 2 PM 优先规则 → 用 `order`。**全文唯一 canonical 字段，不存在 `start` 和 `order` 并存。** |
| `checked` | ✓ | 2 | 保留 | HTML `<input type=checkbox checked>` 标准；GFM task list 概念 |
| `listType` | ✓ | 3 | **删除** | V1 listType 用于运行时识别 'bullet' / 'ordered' / 'task'，V2 通过节点 type 区分（bulletList / orderedList / taskList），不需要 attrs。详见 §4 字段冗余判定准则。 |
| `due` | ✗（V1 用 `deadline`） | 3 | **改名** | GTD 通用术语；V1 `deadline` 改名为 `due` |
| `createdAt` | ✓ | 3 | 保留 | 数据库通用约定 |
| `completedAt` | ✓ | 3 | 保留 | 数据库通用约定 |

### 2.7 派生 / 关系相关

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `parentId` | ✓ | — | **删除** | V2 嵌套通过 PM `content` 字段（不再平铺 + parentId） |
| `order` | ✓ | — | **删除** | 同上，同级顺序由数组下标 |
| `links` | ✓ | — | **走边表达** | 不在 atom 字段里；通过 `user:linksTo` 边 |
| `from` | ✓ | — | **走边表达** | 不在 atom 字段里；通过 `prov:wasDerivedFrom` / `prov:wasInformedBy` 边 |

### 2.8 渲染 / 视图相关（V1 错误字段）

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `frame` | ✓ | — | **删除** | 视图特性，违反原则 1（语义层不知道视图层） |
| `nodeIds` | ✓ | — | **删除** | 渲染节点引用，违反原则 1 |
| `dirty` | ✓ | — | **删除** | 同步状态，违反原则 1 |
| `color`（mathBlock）| ✓ | 3 | **保留** | 数学公式中颜色承载语义意图（教学强调 / 错误标注 / 重要项目高亮），类比 LaTeX `\textcolor{red}{...}` 是公式语义一部分。决议详 [decisions/004-phase2b-resolutions.md §2](atom/decisions/004-phase2b-resolutions.md#2-n4--mathblock-视觉属性) |
| `backgroundColor`（mathBlock）| ✓（V1 名 `bgColor`） | 3 | **保留 + 改名** | V1 `bgColor` 改名 `backgroundColor`，与 CSS 标准对齐（`background-color`）。语义同 `color` 节，承载公式视觉强调 |

### 2.9 Callout / 装饰类

| 字段 | V1 用过 | 阶梯 | V2 提案 | 决议理由 |
|---|---|---|---|---|
| `calloutType` | ✓ | 3 | 保留 | KRIG 自定义（Notion / Obsidian 通用风格） |
| `emoji` | ✓ | 3 | 保留 | KRIG 自定义（callout 头部 emoji） |

### 2.10 来源追溯相关（V1 FromReference）

V1 FromReference 整个**走边表达**（按 decisions/002 + 003），不在 atom 字段里。

但其中部分字段可能成为 **边 attrs 扩展字段**：

| V1 字段 | V2 处置 | 阶梯 |
|---|---|---|
| `extractionType` | 走边名（`*:prov:wasInformedBy` / `wasDerivedFrom`） | — |
| `pdfPage` / `pdfBbox` | 边 attrs 扩展（vocabulary='prov'） | 3 |
| `epubCfi` | 边 attrs 扩展 | 2（EPUB CFI 是 IDPF 标准） |
| `url` | 边 attrs 扩展 / 来源 atom payload | 1（HTTP URL） |
| `conversationId` / `messageIndex` | 边 attrs 扩展 | 3 |
| `citation` 内的 `author` / `publisher` / `year` / `page` / `doi` | 边 attrs 扩展或独立 atom | 2（BibTeX / Schema.org 标准） |
| `extractedAt` | 边 attrs `createdAt` | — |

### 2.11 边 attrs 字段（已在 relations/spec.md §3 定义）

本文件仅说明这些字段的命名来源：

| 字段 | 阶梯 | 命名理由 |
|---|---|---|
| `createdBy` | 3 | 数据库通用约定 |
| `createdAt` | 3 | 数据库通用约定 |
| `confidence` | 3 | ML / RAG 通用术语 |
| `confirmedAt` | 3 | KRIG 自定义 |
| `confirmedBy` | 3 | 同上 |
| `rejectedAt` / `rejectedBy` | 3 | 同上 |
| `comment` | 3 | 通用 |

### 2.12 Mark 类型命名

| V1 命名 | 阶梯 | V2 决议 | 决议理由 |
|---|---|---|---|
| `bold` | 1 | **保留 V1 命名（例外）** | 阶梯 1 PM 优先例外（§1.2.1）—— Markdown / PM 用 `strong` 表"语义强调"，但用户编辑场景 99% 是"视觉粗体"意图。V2 选样式命名。详决议 004 §1 |
| `italic` | 1 | **保留 V1 命名（例外）** | 同上 |
| `code` | 1 | 保留 | Markdown / PM 标准 |
| `link` | 1 | 保留 | Markdown / PM 标准 |
| `strike` | 2 | 保留 | GFM `~~strike~~` 解析为 HTML `<s>`；HTML5 标准 |
| `underline` | 3 | 保留 | KRIG 自定义 |
| `highlight` | 3 | 保留 | KRIG 自定义（HTML5 有 `<mark>` 但不带 attrs；GFM 不支持） |
| `textStyle` | 3 | 保留 | KRIG 自定义（承载 color 属性的"中性" mark） |

**关于 bold / italic 保留的论据**（详 [decisions/004-phase2b-resolutions.md §1](atom/decisions/004-phase2b-resolutions.md#1-n6--mark-命名保留-v1-bold--italic)）：

- HTML5 区分 `<strong>`（语义强调）和 `<b>`（视觉粗体）是两个不同元素，V2 mark 系统选样式命名 `bold` 与编辑器按钮意图准确对齐。
- mark 系统命名风格统一性（`bold` / `italic` / `underline` / `strike` / `highlight` 全是样式命名）。
- V2 现有代码 60+ 处使用 `bold` / `italic`，零迁移成本。
- PM 互操作通过 capability.text-editing 的转换层处理 `bold ↔ strong` 映射。

---

## 3. KRIG 自定义字段命名约定

当一个字段确实需要 KRIG 自定义时（阶梯 3），按以下约定命名。

### 3.1 命名风格（与 V2 现有实现对齐）

| 上下文 | 风格 | 例 |
|---|---|---|
| **节点 type 字符串** | `camelCase` | `'textBlock'` / `'codeBlock'` / `'bulletList'` / `'mathBlock'` |
| **payload / attrs 字段** | `camelCase` | `textIndent` / `mimeType` / `createdBy` |
| **Mark type 字符串** | `camelCase` | `'bold'` / `'highlight'` / `'textStyle'` |
| **目录 / 文件名** | `kebab-case` | `text-editing-driver/blocks/code-block/` |
| **常量 / 枚举值（字符串字面量）** | `lower-kebab-case` | `'left'` / `'right'` / `'ai-generated'` |
| **ts 代码侧的工厂函数 / 变量** | `camelCase` | `createTextBlock` / `createCodeBlock` |

### 3.2 节点命名与 PM 标准的关系

V2 节点 type 采用 `camelCase` 拼写（如 `codeBlock`），**沿用 PM 的概念命名**（PM 标准里 code block 概念叫 `code_block`）。

V2 这样做的理由：

1. **概念对齐**：V2 节点 type 表达的概念跟 PM 标准一致（codeBlock = PM 的 code_block 概念 = Markdown 的 fenced code block）。
2. **拼写风格本地化**：`camelCase` 与 V2 现有实现（80+ 处使用 `textBlock` / `codeBlock` / `bulletList` 等）一致，跟 ts/js 生态主流约定一致。
3. **PM 互操作通过转换层**：V2 与 PM 互操作时，转换层自动处理 `camelCase ↔ snake_case` 映射（如 `codeBlock` ↔ `code_block`）。这是 PM 风格化的"翻译层"，不影响 V2 内部命名。

→ **节点 type 的拼写风格与 PM 不严格一致，但概念命名一致**。这跟 atom domain 命名按"数据模型标签"的原则（详 003）哲学相同 —— 概念对齐，实现细节不绑死。

### 3.3 命名禁区

KRIG 自定义字段必须**避免**以下命名：

| 禁用名 | 理由 | 替代建议 |
|---|---|---|
| `data` | 太泛 | 用具体的字段名（如 `payload` / `attrs` / `content`） |
| `value` | 太泛 | 按具体语义命名（如 `latex` / `info` / `src`） |
| `item` | 太泛 | 按具体语义命名 |
| `obj` / `object` | 太泛且跟 JS 保留概念冲突 | 按具体语义 |
| `info` 当通用元数据用 | 跟 Markdown `info string` 概念冲突 | 用 `meta` 或具体字段名 |
| `name` 当通用标识用 | 太泛 | 用 `id` / `title` / `label` 等更精确的 |
| `kind` 当 atom-type 用 | 跟 V2 three domain 的 `kind` 字段语义冲突 | 用 `type` |

### 3.4 命名风格统一性原则

同一份 schema 内的字段命名**风格必须统一**。例：

✗ 不允许：
```ts
tableCell.attrs = {
  colspan?: number;       // HTML 风格
  is_header?: boolean;    // snake_case
  textAlignment?: string; // camelCase
}
```

✓ 应该是：
```ts
tableCell.attrs = {
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;
  align?: 'left' | 'center' | 'right';
}
```

---

## 4. 字段冗余判定准则

V2 数据模型中，**节点类型（type 字段）能表达的语义，不重复存在 attrs 里**。

### 4.1 判定准则

| 情况 | 处置 | 例子 |
|---|---|---|
| 两种"类别"是**完全不同的节点**（schema 不同 / 嵌套规则不同 / 行为不同） | 拆为**不同的 node type** | bulletList / orderedList / taskList —— 三者节点 type 不同，taskList 含 checked 字段，bulletList 不含 |
| 两种"类别"是**同一节点的子样式**（schema 相同 / 嵌套规则相同 / 仅渲染样式不同） | 用**同一节点 type + attrs 区分** | callout.attrs.calloutType = 'info' \| 'warning' \| 'tip' —— 节点结构一致，仅视觉区分 |

### 4.2 V1 → V2 删除的冗余字段

| V1 字段 | V1 冗余原因 | V2 处置 |
|---|---|---|
| `list.listType` | atom.type 已表达（bulletList / orderedList / taskList） | 删除，走 type 区分 |
| `figure.figureType` | 各 figureType（chart / diagram / photo）实际渲染相同 | 删除或单独决议 |
| `source` （fileBlock）| 同时记录 'ai-generated' / 'user-uploaded' / 'krig-attached'，但本应走 `prov:wasGeneratedBy` 边表达 | 删除，走边 |

---

## 5. 命名变更影响 V1 → V2 迁移

按本 RFC 提议，V1 → V2 的字段变更：

| V1 | V2 提案 | 阶梯升级 | 决议状态 |
|---|---|---|---|
| 合一 `text-block` 节点 + `level` attrs | 拆为 PM 标准 `paragraph` + `heading` 双节点 | 2（PM 标准节点）| **✅ 已实施**（decision 005 / L6-block-decomposition 改造 / commit `c9ae4e4`）|
| `paragraph.children` | `paragraph.content` | 2（PM 标准命名） | **✅ 已实施**（同上） |
| `heading.children` | `heading.content` | 2（PM 标准命名） | **✅ 已实施**（同上） |
| `heading.level: 1-3` | `heading.level: 1-6` | 1（CommonMark 标准范围） | **✅ 已实施**（同上，heading.attrs.level 默认 1，schema 支持 1-6） |
| V1 `noteTitle` 节点 | V2 `paragraph.attrs.isTitle: true` 特殊形态 | — | **✅ 已实施**（decision 005 D1） |
| `codeBlock.language` | `codeBlock.info` | 1（Markdown 标准命名） | 提案 |
| `image.caption`（V1 attrs） | V2 image content 子节点（PM 嵌套） + 新增 `attrs.alt` | 1（Markdown alt）+ 2（HTML5 figcaption 模式） | **V2 已实现**（决议 004 §3） |
| `taskItem.deadline` | `taskItem.due` | 3（GTD 通用） | 提案 |
| `table.colCount` | `table.columns` | 3 | 提案 |
| `list.listType` | （删除字段，通过节点 type 区分） | — | 提案 |
| `mathBlock.bgColor` | `mathBlock.backgroundColor` | 3（CSS 命名标准） | **已决议**（决议 004 §2） |
| `orderedList.start`（V1） | `orderedList.order` | 2（PM 优先） | 提案 |

**已决议保留 V1 命名（PM 优先例外）**：

| V1 命名 | V2 决议 | 理由 |
|---|---|---|
| `bold` mark | 保留 `bold` | 决议 004 §1：用户意图准确 + 命名风格统一 + 零迁移成本 |
| `italic` mark | 保留 `italic` | 同上 |

迁移路径：
- V1 → V2 没有自动迁移工具（按用户拍板：测试数据可丢）。
- 未来如果需要迁移真实数据，按本文件 §2 表格逐项映射。

---

## 6. Open Questions（含临时默认值）

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| N1 | `mathBlock.syntax` 取值是否需要白名单？（'latex' / 'mathml' / 'asciimath' / 等） | **默认 'latex'**，白名单 Phase 2b 决议 | Phase 2b |
| N2 | `info` 字段在 codeBlock 之外是否还需要（如 htmlBlock 是否也用 info）？还是只 codeBlock 用 info、其他用 syntax？ | **只 codeBlock 用 info（Markdown 标准），其他 syntax block 用 syntax** | Phase 2b |
| N3 | ~~`level` 范围 1-6 扩展后，UI 是否真支持 H4-H6 渲染？~~ | **已决议（schema 部分）**：heading schema 支持 level 1-6（L6-block-decomposition commit `c9ae4e4`）；UI 渲染层（capability.text-editing）当前选择性样式化 1-3，4-6 留扩展余地 | ✅ Phase 2c-pre schema 部分完成；UI 渲染范围待 capability 业务决议 |
| N4 | ~~mathBlock 的 `color` / `bgColor` —— 真删除还是保留？~~ | **已决议**：保留 + bgColor 改名 backgroundColor | ✅ 决议 004 §2 |
| N5 | `originalSrc` 删除后，V1 image 历史数据怎么处理（外部 URL 引用丢了） | **走边表达**（`*:prov:wasInformedBy`），但 V2 无历史数据要迁移 | 不阻塞 |
| **N6** | ~~Mark 命名是否对齐 PM/Markdown 标准？~~ | **已决议**：保留 V1 `bold` / `italic`，登记为 §1.2.1 PM 优先例外 | ✅ 决议 004 §1 |
| N7 | ~~V1 `image.caption` 迁移如何拆分到 V2 alt 字段 vs caption 字段？~~ | **已决议**：V2 已实现 caption 为 content 子节点（HTML5 figure 风格），优于原 RFC 提议；详 §2.3.1 | ✅ 决议 004 §3 |
| N8 | 当 HTML 与 PM 命名冲突时（如 `start` vs `order`），本 RFC 规则"PM 优先"是否覆盖所有情况？还是有例外？ | **PM 优先作为默认规则**，例外清单见 §1.2.1（当前 mark `bold`/`italic` 已登记） | Phase 2b 视具体冲突追加 |

---

## 7. 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `atom/spec.md` | spec 定义"有哪些字段"，本文件提议"字段叫什么" |
| `atom/decisions/002-v1-fields-migration.md` | 002 判定"V1 字段哪些保留 / 删除"，本文件提议"保留的字段在 V2 叫什么" |
| `atom/decisions/003-naming-conventions.md` | 003 管 Domain / Edge 命名（结构性），本文件管字段命名（具体字段） |
| `relations/spec.md` | relations spec 定义边的"接口结构"，本文件提议"接口字段叫什么" |
| `mixins/`（Phase 2b 起） | Mixin 是字段的"可复用集合"，本文件的字段命名是 Mixin 内部字段的依据 |
| `relations/pm-note.md`（Phase 2c）| **本 RFC 由 pm-note.md 的真实 block 场景验证后转正式规范** |

---

## 8. RFC 生效流程

本文件是 RFC，**不直接作为强约束规范**。生效流程：

1. **Phase 2a（当前）**：写 RFC（本文件）。
2. **Phase 2b**：基于 RFC 决议 mixin 列表 + 解决 Open Questions（特别是 N6 mark 命名 / N7 image 字段拆分 / N4 math color）。
3. **Phase 2c**：写 `relations/pm-note.md` 主索引 + block 子文档，**用真实场景验证 RFC 字段命名**。验证过程中如发现命名问题，回头修 RFC。
4. **Phase 2c 完成后**：本文件转正式规范，§0 移除 "RFC" 状态标识，"代码以本文件为准" 才生效。
5. **未来 Phase 实施代码**：以转正后的本文件 §2 表格为准。

→ **在转正前**：业务实施代码可参考本 RFC 建议，但**遇到本 RFC 与 V2 现有实现冲突时，以 V2 现有实现为准**（避免双标准）。

---

## 9. 影响清单（RFC 通过 + 转正后）

如本 RFC 转为正式规范，下一步要做：

1. **Phase 2b** —— 基于本文件结论，重新决议 Mixin 列表（哪些字段值得抽 mixin / 哪些是各 block 各自命名）。
2. **Phase 2c** —— 写 `relations/pm-note.md` 时字段命名按本文件 §2 表格执行。
3. **未来代码实施** —— `src/semantic/atom/pm/` 下定义的 schema attrs 字段名以本文件为准。
4. **架构文档反向更新** —— Phase N 稳定后，把"字段命名三阶梯"原则反向更新到 `docs/00-architecture/charter.md`。
