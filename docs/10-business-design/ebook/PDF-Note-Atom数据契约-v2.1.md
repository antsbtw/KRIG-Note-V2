# PDF → Note Atom 数据契约 v2.1

> 版本：v2.1 | 日期：2026-05-29
> 上游：[v2.0 契约](PDF-Note-Atom数据契约-v2.md)（v2.0 文档保留作历史，本文档仅登记 v2.0 → v2.1 增量）
> 实施依据：5B 设计 §7.5.1 / §节 4 Stage 8 字面拍板

---

## 〇、本版变更概述

v2.1 是 v2.0 的**字段重命名版**，**结构与语义零变更**。仅一项字面增量：

| 项 | v2.0 | v2.1 | 影响范围 |
|---|---|---|---|
| 子结构容器字段名 | `tiptapContent` | **`pmContent`** | `table` / `blockquote` / `callout` / `columnList` 4 类 atom 的 content 子树 |

其余字段名、Atom type 命名规则、InlineElement 形态、容器嵌套语义、sanitize 容错规则等**字面 1:1 继承 v2.0**。

---

## 一、变更原因

**v1.0 历史命名残留清理**。

`tiptapContent` 字段名来自 V1 KRIG-Note 时期（基于 Tiptap 编辑器实现）的命名习惯。V2 重构起项目字面已废 Tiptap 方案，直接用 ProseMirror（详 [feedback memory `tiptap-abandoned`]）。继续保留 `tiptapContent` 字段名：
1. **误导维护者**：字段名暗示绑定 Tiptap，实际是 generic ProseMirror node JSON 子结构
2. **跨上下游不一致**：V2 内部所有 PM 子树/payload/schema 引用都用 `pm`/`prosemirror` 前缀（`PmPayload` / `pm-atom-draft.ts` 等），唯独契约保留 Tiptap 字面
3. **未来契约扩展时累积债**：v2.2 加 7 类媒体 atom（5B §7.5.1）字面也走 `pmContent`，与 v2.0 字段名不一致

→ v2.1 字面 rename 是**单点清算**。

---

## 二、字段映射字面规则

### 2.1 v2.0 → v2.1 字段对照

```
v2.0:                                v2.1:
{                                    {
  "type": "table",                     "type": "table",
  "content": {                         "content": {
    "tiptapContent": [PMNode...]   →     "pmContent": [PMNode...]
  }                                    }
}                                    }
```

同上对 `blockquote` / `callout` / `columnList`。

**字面注意**：
- 字段名是**唯一变化**；子树内部的 PM node JSON 形态字面**不动**
- ProseMirror node JSON 内部规则（`type` / `attrs` / `content` / `marks`）字面不变（仍是 PM 标准 `content` 字段表达子节点）
- 顶层 atom 的 `content` 字段本身**不变**（仍是 `Record<string, unknown>` 形态）

### 2.2 各 atom type 字面新形态

#### 2.2.1 table（[v2.0 §4.7](PDF-Note-Atom数据契约-v2.md) 对照）

```json
{
  "type": "table",
  "content": {
    "pmContent": [
      { "type": "tableRow", "content": [...] },
      ...
    ]
  }
}
```

#### 2.2.2 blockquote（[v2.0 §4.8](PDF-Note-Atom数据契约-v2.md) 对照）

```json
{
  "type": "blockquote",
  "content": {
    "pmContent": [
      { "type": "paragraph", "content": [...] },
      ...
    ]
  }
}
```

#### 2.2.3 callout（[v2.0 §4.12](PDF-Note-Atom数据契约-v2.md) 对照）

```json
{
  "type": "callout",
  "content": {
    "emoji": "💡",
    "iconName": "info",
    "pmContent": [
      { "type": "paragraph", "content": [...] }
    ]
  }
}
```

#### 2.2.4 columnList（[v2.0 §4.13](PDF-Note-Atom数据契约-v2.md) 对照）

```json
{
  "type": "columnList",
  "content": {
    "pmContent": [
      { "type": "column", "content": [...] },
      ...
    ]
  }
}
```

---

## 三、兼容性策略（字面拍板）

### 3.1 V2 端 sanitize 兼容层

`src/capabilities/content-ingest/internal/sanitize-atoms.ts` 字面新增 v2.0 ↔ v2.1 兼容兜底：

```ts
// 5B Stage 8 兼容层 (字面拍板兜底 1 个 V2 release):
// v2.0 后端字面发 tiptapContent;v2.1 后端字面发 pmContent.
// 读侧字面 tiptapContent ?? pmContent 二者均可消费;
// 未来 (v2.2 发布 + 1 release) 删除 tiptapContent 兼容,老备份 restore 报错.
const pmSubtree = atom.content?.tiptapContent ?? atom.content?.pmContent;
```

### 3.2 兼容期长度（5B §节 5 Open Question 8）

**字面 1 个 V2 release（30-60 天）**。届时：
- sanitize 删除 `tiptapContent ?? pmContent` 兼容兜底，仅读 `pmContent`
- 老备份 restore 直接报错"contract v2.0 not supported, please re-export from KRIG Knowledge Platform"
- migration 不字面提供（备份用户极少 + 字面拍板"未启动迁移路径"）

### 3.3 后端 KRIG Knowledge Platform 协调

**项目外协调**：后端 `glm-ocr-service`（192.168.1.240:8080）需同步实施 v2.1 字段输出。

字面任务：
- 后端发 v2.1 contract（`pmContent`）→ V2 sanitize 走 `pmContent` 分支
- 后端兼容期内可双发（`tiptapContent` + `pmContent` 同时填同子树）→ V2 兼容层字面 `??` 优先 `tiptapContent`（向后兼容老 V2 客户端）
- 后端版本切换后单发 `pmContent` → V2 兼容期内 `??` 兜底 → V2 删兼容后字面消费 `pmContent`

**本文档不字面规定后端实施时机**，后端按自身节奏切换。

---

## 四、其它未变更项的字面再确认

以下事项 v2.1 字面**完全继承 v2.0**：

| 项 | v2.0 字面位置 |
|---|---|
| Atom type 命名规则（camelCase） | [v2.0 §三 Atom Type 命名规范](PDF-Note-Atom数据契约-v2.md) |
| InlineElement 命名（kebab-case：`math-inline` / `code-inline`）| [v2.0 §五 InlineElement 规范](PDF-Note-Atom数据契约-v2.md) |
| from 字段（pdfPage / extractedAt 等）| [v2.0 §三 Atom 基础结构](PDF-Note-Atom数据契约-v2.md) |
| sanitize 8 条容错规则 | [v2.0 §九](PDF-Note-Atom数据契约-v2.md) |
| 13 类 Atom type 完整定义 | [v2.0 §四](PDF-Note-Atom数据契约-v2.md) |
| 后端 API 响应结构（PageResult / Atom / 等）| [v2.0 §二](PDF-Note-Atom数据契约-v2.md) |

---

## 五、v2.2 前瞻（不在本期范围）

5B §7.5.1 字面登记 v2.2 媒体扩展 7 类 atom type：

```
fileBlock / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual / externalRef
```

**本期 v2.1 字面不实施 v2.2**。v2.2 启动时另起 `PDF-Note-Atom数据契约-v2.2.md`（同款 delta 形态），届时：
- v2.2 字面**继承 v2.1 的 `pmContent` 字段名**
- v2.2 字面新增 7 类 atom type 的 `content.<field>` schema 定义
- v2.2 启动条件：媒体 atom 类型在 V2 编辑场景字面有需求（决议层驱动）

---

## 六、本契约的字面消费方

V2 代码消费本契约的位置：

| 位置 | 角色 |
|---|---|
| `src/capabilities/content-ingest/internal/sanitize-atoms.ts` | v2.0/v2.1 兼容入口，读 `tiptapContent ?? pmContent` |
| `src/capabilities/content-ingest/internal/table-adapter.ts` | 字面消费 `content.tiptapContent`（待 sanitize 兼容层落地后改 `pmContent`）|
| `src/capabilities/content-ingest/internal/krig-batch-to-atoms.ts` | 字面消费 `content.tiptapContent`（同上） |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts` | V1NoteViewAtom 反向兼容路径，字面消费 `content.tiptapContent`（canvas-text-node 用，规范外，不在 v2.1 范围）|

5B Stage 8 字面仅实施 sanitize-atoms.ts 兼容层（**单点兼容**）。其它消费方在 v2.2 启动前不动 — 它们字面消费的是 sanitize 兜底后的内部形态（字面同形）。

---

*PDF-Note-Atom 数据契约 v2.1 · 2026-05-29 · 5B Stage 8 实施*
